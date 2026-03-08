"""
expiry_worker.py — Worker d'expiration automatique des bookings SpotU
======================================================================

Responsabilités :
  1. Trouver les bookings 'requested' dont expires_at < NOW()
  2. Pour chaque booking expiré (en transaction atomique + SKIP LOCKED) :
     a. booking  : requested → expired
     b. slot     : pending   → available  (single/specific uniquement)
     c. payment  : requires_authorization|authorized → cancelled
     d. notifs   : payer + receiver
  3. Tourner en boucle, s'arrêter proprement sur shutdown signal

Garanties :
  - SELECT … FOR UPDATE SKIP LOCKED : multi-worker safe, aucun deadlock
  - Toute la transition est dans une seule transaction atomique
  - Idempotent : les bookings déjà 'expired' ne sont jamais retraités
    (la WHERE clause les exclut d'emblée)
"""

import asyncio
import logging
import os
from datetime import timezone, datetime

log = logging.getLogger("expiry_worker")

EXPIRY_BATCH_SIZE = 50          # max bookings traités par tick


async def expire_stale_bookings(pool) -> int:
    """
    Traite TOUS les bookings expirés en attente, par batch de EXPIRY_BATCH_SIZE.
    Retourne le nombre total d'expirations effectuées.
    Peut être appelée directement dans les tests sans démarrer le worker.
    """
    total = 0
    while True:
        count = await _expire_batch(pool, EXPIRY_BATCH_SIZE)
        total += count
        if count < EXPIRY_BATCH_SIZE:
            break   # plus rien à traiter
    return total


async def _expire_batch(pool, batch_size: int) -> int:
    """
    Traite un seul batch de bookings expirés.
    Retourne le nombre de bookings expirés dans ce batch.
    """
    processed = 0

    async with pool.acquire() as conn:
        # ── Lecture lockée des bookings à expirer ────────────────────────────
        # SKIP LOCKED : si un autre worker/transaction a déjà locké une ligne,
        # on la saute — aucun deadlock, aucune attente.
        rows = await conn.fetch(
            """
            SELECT
                b.booking_id,
                b.slot_id,
                b.payer_user_id,
                b.receiver_user_id,
                b.service_id,
                p.payment_id,
                p.status  AS pay_status
            FROM bookings b
            LEFT JOIN payments p ON p.booking_id = b.booking_id
            WHERE b.status = 'requested'
              AND b.expires_at IS NOT NULL
              AND b.expires_at < NOW()
            ORDER BY b.expires_at ASC
            LIMIT $1
            FOR UPDATE OF b SKIP LOCKED
            """,
            batch_size,
        )

        if not rows:
            return 0

        for row in rows:
            bk = dict(row)
            bid         = bk["booking_id"]
            slot_id     = bk["slot_id"]
            payer_id    = bk["payer_user_id"]
            receiver_id = bk["receiver_user_id"]
            service_id  = bk["service_id"]
            payment_id  = bk.get("payment_id")
            pay_status  = bk.get("pay_status", "")

            try:
                async with conn.transaction():
                    # a. Booking → expired
                    updated = await conn.fetchval(
                        """UPDATE bookings
                           SET status = 'expired', updated_at = NOW()
                           WHERE booking_id = $1 AND status = 'requested'
                           RETURNING booking_id""",
                        bid,
                    )
                    if not updated:
                        # Déjà traité par un autre worker (race impossible avec SKIP LOCKED,
                        # mais protection défensive)
                        continue

                    # b. Slot → available  (single/specific uniquement)
                    if slot_id:
                        await conn.execute(
                            """UPDATE service_slots
                               SET slot_status = 'available'
                               WHERE slot_id = $1
                                 AND slot_status = 'pending'
                                 AND slot_type IN ('single', 'specific')""",
                            slot_id,
                        )

                    # c. Payment → cancelled
                    if payment_id and pay_status in (
                        "requires_authorization", "authorized", "capture_pending"
                    ):
                        await conn.execute(
                            """UPDATE payments
                               SET status = 'cancelled', updated_at = NOW()
                               WHERE payment_id = $1""",
                            payment_id,
                        )

                    # d. Notifications (payer + receiver) dans la même transaction
                    svc_row = await conn.fetchrow(
                        "SELECT title FROM services WHERE service_id = $1", service_id
                    )
                    svc_title = svc_row["title"] if svc_row else "un service"

                    notif_data = {
                        "type": "booking_expired",
                        "bookingId": bid,
                        "service_id": service_id,
                        "service_title": svc_title,
                    }

                    # Notif payer
                    await _insert_notif(
                        conn, payer_id,
                        notif_type="booking_expired",
                        title="Demande expirée",
                        body=f"Votre demande pour « {svc_title} » n'a pas reçu de réponse et a expiré.",
                        data=notif_data,
                    )
                    # Notif receiver
                    await _insert_notif(
                        conn, receiver_id,
                        notif_type="booking_expired",
                        title="Demande non traitée",
                        body=f"Une demande de réservation pour « {svc_title} » a expiré sans avoir été traitée.",
                        data={**notif_data, "payer_id": payer_id},
                    )

                processed += 1
                log.info("Booking expiré : %s (slot=%s, pay=%s→cancelled)", bid, slot_id, pay_status)

            except Exception as exc:
                log.exception("Erreur lors de l'expiration du booking %s : %s", bid, exc)
                # La transaction a été rollbackée automatiquement — on continue avec les suivants

    return processed


async def _insert_notif(conn, user_id: str, notif_type: str, title: str, body: str, data: dict):
    """Insère une notification dans la table notifications."""
    import json as _json
    from models import new_id
    await conn.execute(
        """INSERT INTO notifications (notif_id, user_id, type, title, body, data)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        new_id("ntf"), user_id, notif_type, title, body, _json.dumps(data),
    )


# ── Boucle de fond ────────────────────────────────────────────────────────────

class ExpiryWorker:
    """
    Worker d'expiration tournant en arrière-plan dans une tâche asyncio.
    Démarré par server.py au startup, arrêté proprement au shutdown.
    """

    def __init__(self, pool, interval_secs: int = 60):
        self._pool     = pool
        self._interval = interval_secs
        self._task: asyncio.Task | None = None

    def start(self):
        """Lance la boucle de fond."""
        self._task = asyncio.create_task(self._run(), name="expiry_worker")
        log.info(
            "ExpiryWorker démarré (intervalle=%ds, batch=%d)",
            self._interval, EXPIRY_BATCH_SIZE,
        )

    async def stop(self):
        """Arrête proprement la boucle (attend la fin du tick courant)."""
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        log.info("ExpiryWorker arrêté")

    async def _run(self):
        """Boucle principale — s'endort entre chaque tick."""
        # Tick immédiat au démarrage pour traiter les éventuels backlog
        await self._tick()
        while True:
            await asyncio.sleep(self._interval)
            await self._tick()

    async def _tick(self):
        try:
            n = await expire_stale_bookings(self._pool)
            if n:
                log.info("ExpiryWorker : %d booking(s) expiré(s) ce tick", n)
        except Exception as exc:
            log.exception("ExpiryWorker : erreur inattendue lors du tick : %s", exc)
