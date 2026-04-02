"""
MediaNotifWorker — Phase C, worker 2/2

Rôle :
  À J+83 (7 jours avant purge), envoyer une notification push in-app à l'utilisateur
  propriétaire de chaque entité dont les médias seront supprimés dans 7 jours.

  Idempotence stricte :
    - Skip si `media_purge_notified_at IS NOT NULL` (déjà notifiée)
    - Skip si `reactivated_at IS NOT NULL AND reactivated_at >= deleted_at`
    - Marque `media_purge_notified_at=NOW()` après envoi réussi

  Fenêtre de détection : media_purge_scheduled_at BETWEEN NOW() AND NOW()+7j

  Démarrage : worker asyncio cadencé toutes les INTERVAL_SECS secondes.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta

from push_service import send_push_to_user

logger = logging.getLogger("media_notif_worker")

INTERVAL_SECS = 900   # toutes les 15 minutes
WARN_WINDOW_DAYS = 7  # 7 jours avant purge = J+83


class MediaNotifWorker:
    def __init__(self, pool, interval_secs: int = INTERVAL_SECS):
        self._pool = pool
        self._interval = interval_secs
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

    def start(self):
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="media_notif_worker")
        logger.info("MediaNotifWorker démarré (intervalle=%ds, fenêtre=%dj)", self._interval, WARN_WINDOW_DAYS)

    async def stop(self):
        self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("MediaNotifWorker arrêté")

    async def _run_loop(self):
        while not self._stop_event.is_set():
            try:
                result = await run_media_notif(self._pool)
                if result["notified"] > 0:
                    logger.info(
                        "[NOTIF-MEDIA] %d notification(s) envoyée(s) — tag_points:%d services:%d products:%d users:%d",
                        result["notified"],
                        result.get("tag_points", 0),
                        result.get("services", 0),
                        result.get("products", 0),
                        result.get("users", 0),
                    )
            except Exception as exc:
                logger.error("[NOTIF-MEDIA] Erreur cycle : %s", exc, exc_info=True)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self._interval)
            except asyncio.TimeoutError:
                pass


async def run_media_notif(pool) -> dict:
    """
    Scanne les entités dont media_purge_scheduled_at est entre NOW() et NOW()+7j,
    media_purge_notified_at IS NULL, et qui sont encore supprimées (non réactivées).
    Envoie une notification push à l'owner puis marque media_purge_notified_at.
    """
    now = datetime.now(timezone.utc)
    window_end = now + timedelta(days=WARN_WINDOW_DAYS)
    counts = {"notified": 0, "tag_points": 0, "services": 0, "products": 0, "users": 0}

    # (table, id_col, owner_col, title_col, label, del_check)
    entity_specs = [
        ("tag_points",           "point_id",   "user_id",    "title", "SpotYou",  "deleted_at IS NOT NULL AND active=FALSE"),
        ("services",             "service_id", "coach_id",   "title", "service",  "deleted_at IS NOT NULL AND active=FALSE"),
        ("marketplace_products", "product_id", "seller_id",  "title", "produit",  "deleted_at IS NOT NULL AND status='deleted'"),
        ("users",                "user_id",    "user_id",    "name",  "profil",   "deleted_at IS NOT NULL"),
    ]
    stat_keys = ["tag_points", "services", "products", "users"]

    async with pool.acquire() as conn:
        for (table, id_col, owner_col, title_col, label, del_check), stat_key in zip(entity_specs, stat_keys):
            rows = await conn.fetch(
                f"""SELECT {id_col}, {owner_col} AS owner_id, {title_col} AS title, media_purge_scheduled_at
                    FROM {table}
                    WHERE media_purge_scheduled_at BETWEEN $1 AND $2
                      AND media_purge_notified_at IS NULL
                      AND media_purged = FALSE
                      AND {del_check}
                      AND (reactivated_at IS NULL OR reactivated_at < deleted_at)""",
                now, window_end
            )
            for row in rows:
                entity_id = row[id_col]
                owner_id = row["owner_id"]
                title = row.get("title") or label
                mpsa = row["media_purge_scheduled_at"]
                delta = (mpsa.replace(tzinfo=timezone.utc) if mpsa.tzinfo is None else mpsa) - now
                days_left = max(0, delta.days)

                # Envoi notification push
                try:
                    await send_push_to_user(
                        pool=pool,
                        user_id=owner_id,
                        title="Médias bientôt supprimés",
                        body=(
                            f"Votre {label} « {title} » est désactivé. "
                            f"Ses médias seront supprimés dans {days_left} jour(s). "
                            "Réactivez-le pour les conserver."
                        ),
                        data={
                            "type":       "media_purge_warning",
                            "entity_type": table,
                            "entity_id":  entity_id,
                            "days_left":  days_left,
                        },
                    )
                except Exception as exc:
                    logger.warning("[NOTIF-MEDIA] Notif échouée pour %s %s : %s", label, entity_id, exc)
                    # On marque quand même pour éviter la boucle infinie
                    # (en cas de token expiré côté Expo, re-tenter ne servirait à rien)

                # Marquer notifié (idempotence)
                await conn.execute(
                    f"UPDATE {table} SET media_purge_notified_at=$1 WHERE {id_col}=$2",
                    now, entity_id
                )
                counts[stat_key] += 1
                counts["notified"] += 1

    return counts
