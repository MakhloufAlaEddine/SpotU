"""
webhook_handlers.py — Couche centralisée des handlers de webhooks Stripe
=========================================================================
Point unique de traitement pour TOUS les événements Stripe.
Appelé depuis l'endpoint /api/webhook/stripe de payment_routes.py.

Architecture :
  dispatch(pool, raw_event_id, event_type, obj)
    ├── _claim_event()          → idempotence (table stripe_webhook_events)
    ├── _resolve_payment_id()   → retrouver le payment local depuis l'event
    ├── _handle_payment_event() → transitions paiements + notifications
    ├── _handle_charge_event()  → remboursements + notifications
    └── _handle_subscription_event() → transitions abonnements + notifications

Idempotence :
  Chaque event_id Stripe est inséré en PRIMARY KEY avant traitement.
  Un event_id déjà présent → doublon détecté → skip avec 200 silencieux.
  Stripe réessaie les webhooks : cette table protège contre les doubles traitements.

Source de vérité :
  Les statuts DB (payments.status, user_subscriptions.status) sont TOUJOURS
  mis à jour DEPUIS les webhooks Stripe, jamais déduits de la logique applicative.
  Exception : l'endpoint /bookings/{id}/accept capture via l'API Stripe ET
  le webhook payment_intent.succeeded confirme ensuite (double mise à jour idempotente).

Notifications :
  Chaque transition significative génère une notification stockée en DB
  (via push_service.store_notification) et diffusée via WebSocket.
  Protection anti-doublon : la notification n'est émise que si le nombre
  de lignes mises à jour (rows_updated > 0) confirme une vraie transition.

Événements supportés + notifications associées :
  Payment :
    checkout.session.completed (unpaid)  → authorized   → notif receiver
    checkout.session.completed (paid)    → captured     → notif payer
    payment_intent.amount_capturable_updated → authorized → notif receiver
    payment_intent.succeeded             → captured     → notif payer
    payment_intent.payment_failed        → failed       → notif payer
    payment_intent.canceled              → cancelled    (pas de notif — booking déjà notifié)

  Charge / Remboursement :
    charge.refunded (full)               → refunded             → notif payer
    charge.refunded (partial)            → partially_refunded   → notif payer
    refund.updated                       → sync statut          (pas de notif — charge.refunded suffit)

  Abonnement :
    checkout.session.completed (subscription) → active → notif user
    customer.subscription.created             → active → notif user
    customer.subscription.updated (cancelling)→ cancelling → notif user
    customer.subscription.updated (cancelled) → cancelled → notif user
    customer.subscription.deleted             → cancelled → notif user
    invoice.paid                              → active (renouvellement) → notif user
    invoice.payment_failed                    → past_due → notif user
"""

import json
import logging
from datetime import datetime, timezone, timedelta

log = logging.getLogger("webhook_handlers")


# ── Utilitaire d'accès unifié ──────────────────────────────────────────────────

def _get(obj, key, default=None):
    """Accède à une clé sur un dict ou un objet Stripe indifféremment."""
    return obj.get(key, default) if isinstance(obj, dict) else getattr(obj, key, default)


def _rows(result: str) -> int:
    """Extrait le nombre de lignes depuis un command tag asyncpg ex. 'UPDATE 1'."""
    try:
        return int(result.strip().split()[-1])
    except (ValueError, IndexError):
        return 0


# ── Idempotence ────────────────────────────────────────────────────────────────

async def _claim_event(conn, event_id: str, event_type: str) -> bool:
    """
    Réserve l'event atomiquement en DB.

    Retourne True  si l'événement est NOUVEAU (à traiter).
    Retourne False si l'événement est déjà en cours / traité (doublon → skip).

    Utilise INSERT … ON CONFLICT DO NOTHING + SELECT pour l'atomicité.
    Le statut 'processing' est mis à jour en 'success'/'error' par _mark_done().
    """
    result = await conn.execute(
        """INSERT INTO stripe_webhook_events
               (event_id, event_type, status, processed_at, updated_at)
           VALUES ($1, $2, 'processing', NOW(), NOW())
           ON CONFLICT (event_id) DO NOTHING""",
        event_id, event_type,
    )
    # asyncpg retourne "INSERT 0 1" si inséré, "INSERT 0 0" si conflit
    inserted = result.split()[-1] == "1"
    if not inserted:
        log.debug("Webhook doublon ignoré : event_id=%s type=%s", event_id, event_type)
    return inserted


async def _mark_done(
    conn,
    event_id: str,
    status: str,         # 'success', 'error', 'ignored'
    related_id: str | None = None,
    error_message: str | None = None,
) -> None:
    """Met à jour le statut de l'event après traitement."""
    await conn.execute(
        """UPDATE stripe_webhook_events
           SET status=$1, related_id=$2, error_message=$3, updated_at=NOW()
           WHERE event_id=$4""",
        status, related_id, error_message, event_id,
    )


# ── Résolution payment_id ──────────────────────────────────────────────────────

async def _resolve_payment_id(conn, event_type: str, obj) -> tuple[str | None, str | None]:
    """
    Retrouve (payment_id, booking_id) associés à un event Stripe.

    Stratégie de lookup (ordre de priorité) :
      1. metadata.payment_id (le plus fiable — inséré à la création)
      2. stripe_payment_intent_id  (lookup direct)
      3. stripe_checkout_session_id  (fallback checkout)
      4. stripe_charge_id  (fallback remboursement)

    Retourne (None, None) si introuvable (event non lié à un paiement local).
    """
    metadata = _get(obj, "metadata", {}) or {}
    payment_id      = _get(metadata, "payment_id") if isinstance(metadata, dict) else None
    booking_id_meta = _get(metadata, "booking_id") if isinstance(metadata, dict) else None

    if payment_id:
        return payment_id, booking_id_meta

    # Déterminer le payment_intent_id ou charge_id depuis l'objet
    if "payment_intent" in event_type:
        event_pi_id = _get(obj, "id")
    elif event_type in ("charge.refunded",):
        event_pi_id = _get(obj, "payment_intent")
    elif event_type in ("refund.updated",):
        event_pi_id = _get(obj, "payment_intent")
    else:
        event_pi_id = _get(obj, "payment_intent")

    if event_pi_id:
        row = await conn.fetchrow(
            "SELECT payment_id, booking_id FROM payments WHERE stripe_payment_intent_id=$1 LIMIT 1",
            event_pi_id,
        )
        if row:
            return row["payment_id"], row["booking_id"]

    # Fallback par checkout session ID
    if "checkout.session" in event_type:
        cs_id = _get(obj, "id")
        if cs_id:
            row = await conn.fetchrow(
                "SELECT payment_id, booking_id FROM payments WHERE stripe_checkout_session_id=$1 LIMIT 1",
                cs_id,
            )
            if row:
                return row["payment_id"], row["booking_id"]

    # Fallback par charge_id (pour refunds)
    charge_id = _get(obj, "id") if event_type.startswith("charge.") else _get(obj, "charge")
    if charge_id and isinstance(charge_id, str) and charge_id.startswith("ch_"):
        row = await conn.fetchrow(
            "SELECT payment_id, booking_id FROM payments WHERE stripe_charge_id=$1 LIMIT 1",
            charge_id,
        )
        if row:
            return row["payment_id"], row["booking_id"]

    return None, None


# ── Handler : événements payment_intent + checkout ─────────────────────────────

async def _handle_payment_event(
    conn, event_type: str, obj, payment_id: str, booking_id: str | None,
    pending_notifs: list,
) -> None:
    """
    Transitions de statut pour les paiements transactionnels.

    Idempotentes : chaque UPDATE utilise des guards sur le statut actuel
    (WHERE status NOT IN (...)) pour éviter les régressions d'état.

    Notification émise uniquement si rows_updated > 0 (vraie transition).

    Mapping :
      checkout.session.completed (unpaid) → authorized   (capture_method=manual)
      checkout.session.completed (paid)   → captured     (capture immédiate)
      amount_capturable_updated           → authorized   (PI prêt à capturer)
      payment_intent.succeeded            → captured     (+ stripe_charge_id)
      payment_intent.payment_failed       → failed
      payment_intent.canceled             → cancelled
    """
    if event_type == "checkout.session.completed":
        mode = _get(obj, "mode", "")
        if mode == "subscription":
            return  # géré dans _handle_subscription_event
        ps = _get(obj, "payment_status", "")
        if ps == "unpaid":
            # capture_method=manual : autorisé, capture différée
            res = await conn.execute(
                """UPDATE payments SET status='authorized', updated_at=NOW()
                   WHERE payment_id=$1
                     AND status NOT IN ('authorized','captured','refunded','cancelled')""",
                payment_id,
            )
            if _rows(res) > 0:
                row = await conn.fetchrow(
                    "SELECT receiver_user_id FROM payments WHERE payment_id=$1", payment_id
                )
                if row:
                    pending_notifs.append({
                        "user_id": row["receiver_user_id"],
                        "type": "payment_authorized",
                        "title": "Paiement autorisé",
                        "body": "Le paiement pour votre prestation a été autorisé.",
                        "data": {"type": "payment_authorized", "payment_id": payment_id,
                                 "booking_id": booking_id},
                    })
        elif ps == "paid":
            async with conn.transaction():
                res = await conn.execute(
                    """UPDATE payments SET status='captured', updated_at=NOW()
                       WHERE payment_id=$1 AND status NOT IN ('captured','refunded')""",
                    payment_id,
                )
                rows_captured = _rows(res)
                if booking_id:
                    await conn.execute(
                        """UPDATE bookings SET payment_status='paid', updated_at=NOW()
                           WHERE booking_id=$1 AND payment_status != 'paid'""",
                        booking_id,
                    )
            if rows_captured > 0:
                row = await conn.fetchrow(
                    "SELECT payer_user_id FROM payments WHERE payment_id=$1", payment_id
                )
                if row:
                    pending_notifs.append({
                        "user_id": row["payer_user_id"],
                        "type": "payment_captured",
                        "title": "Paiement confirmé",
                        "body": "Votre paiement a été confirmé avec succès.",
                        "data": {"type": "payment_captured", "payment_id": payment_id,
                                 "booking_id": booking_id},
                    })

    elif event_type == "payment_intent.amount_capturable_updated":
        res = await conn.execute(
            """UPDATE payments SET status='authorized', updated_at=NOW()
               WHERE payment_id=$1
                 AND status NOT IN ('authorized','captured','refunded','cancelled')""",
            payment_id,
        )
        if _rows(res) > 0:
            row = await conn.fetchrow(
                "SELECT receiver_user_id FROM payments WHERE payment_id=$1", payment_id
            )
            if row:
                pending_notifs.append({
                    "user_id": row["receiver_user_id"],
                    "type": "payment_authorized",
                    "title": "Paiement autorisé",
                    "body": "Le paiement pour votre prestation est confirmé — vous pouvez procéder.",
                    "data": {"type": "payment_authorized", "payment_id": payment_id,
                             "booking_id": booking_id},
                })

    elif event_type == "payment_intent.succeeded":
        # Récupérer le charge_id pour traçabilité
        charge_id = _get(obj, "latest_charge")
        rows_captured = 0
        if isinstance(charge_id, str) and charge_id.startswith("ch_"):
            async with conn.transaction():
                res = await conn.execute(
                    """UPDATE payments
                       SET status='captured', stripe_charge_id=$1, updated_at=NOW()
                       WHERE payment_id=$2 AND status NOT IN ('captured','refunded')""",
                    charge_id, payment_id,
                )
                rows_captured = _rows(res)
                if booking_id:
                    await conn.execute(
                        """UPDATE bookings SET payment_status='paid', updated_at=NOW()
                           WHERE booking_id=$1 AND payment_status != 'paid'""",
                        booking_id,
                    )
        else:
            async with conn.transaction():
                res = await conn.execute(
                    """UPDATE payments SET status='captured', updated_at=NOW()
                       WHERE payment_id=$1 AND status NOT IN ('captured','refunded')""",
                    payment_id,
                )
                rows_captured = _rows(res)
                if booking_id:
                    await conn.execute(
                        """UPDATE bookings SET payment_status='paid', updated_at=NOW()
                           WHERE booking_id=$1 AND payment_status != 'paid'""",
                        booking_id,
                    )
        if rows_captured > 0:
            row = await conn.fetchrow(
                "SELECT payer_user_id FROM payments WHERE payment_id=$1", payment_id
            )
            if row:
                pending_notifs.append({
                    "user_id": row["payer_user_id"],
                    "type": "payment_captured",
                    "title": "Paiement confirmé",
                    "body": "Votre paiement a été capturé avec succès.",
                    "data": {"type": "payment_captured", "payment_id": payment_id,
                             "booking_id": booking_id},
                })

    elif event_type == "payment_intent.payment_failed":
        res = await conn.execute(
            """UPDATE payments SET status='failed', updated_at=NOW()
               WHERE payment_id=$1 AND status NOT IN ('captured','refunded','failed')""",
            payment_id,
        )
        if _rows(res) > 0:
            row = await conn.fetchrow(
                "SELECT payer_user_id FROM payments WHERE payment_id=$1", payment_id
            )
            if row:
                pending_notifs.append({
                    "user_id": row["payer_user_id"],
                    "type": "payment_failed",
                    "title": "Paiement échoué",
                    "body": "Votre paiement n'a pas pu être traité. Veuillez vérifier votre moyen de paiement.",
                    "data": {"type": "payment_failed", "payment_id": payment_id,
                             "booking_id": booking_id},
                })

    elif event_type == "payment_intent.canceled":
        # Pas de notification : la réservation a déjà notifié via refuse/cancel
        await conn.execute(
            """UPDATE payments SET status='cancelled', updated_at=NOW()
               WHERE payment_id=$1 AND status NOT IN ('captured','refunded','cancelled')""",
            payment_id,
        )

    log.info(
        "Payment event traité : type=%s | payment=%s | booking=%s",
        event_type, payment_id, booking_id,
    )


# ── Handler : charge + remboursements ─────────────────────────────────────────

async def _handle_charge_event(
    conn, event_type: str, obj, payment_id: str | None,
    pending_notifs: list,
) -> None:
    """
    Traite les événements de remboursement.

    charge.refunded :
      - Montant remboursé → refund_amount (centimes → euros)
      - Remboursement complet (charge.refunded=True) → status='refunded'
      - Remboursement partiel → status='partially_refunded'
      - Notification → payer

    refund.updated :
      - Mise à jour du statut de remboursement (succeeded/failed/canceled)
      - Pas de notification supplémentaire (charge.refunded l'a déjà envoyée)
    """
    if event_type == "charge.refunded":
        if not payment_id:
            # Tenter de trouver via charge_id
            charge_id = _get(obj, "id")
            if charge_id:
                row = await conn.fetchrow(
                    "SELECT payment_id FROM payments WHERE stripe_charge_id=$1 LIMIT 1",
                    charge_id,
                )
                if row:
                    payment_id = row["payment_id"]
            if not payment_id:
                log.debug("charge.refunded : payment_id introuvable (charge=%s)", _get(obj, "id"))
                return

        amount_refunded_cents = _get(obj, "amount_refunded", 0)
        amount_refunded       = round(amount_refunded_cents / 100, 2)
        fully_refunded        = bool(_get(obj, "refunded", False))
        charge_id             = _get(obj, "id")

        new_status    = "refunded" if fully_refunded else "partially_refunded"
        refund_status = "succeeded"

        res = await conn.execute(
            """UPDATE payments
               SET status=$1,
                   refund_amount=$2,
                   refund_status=$3,
                   stripe_charge_id=COALESCE(stripe_charge_id, $4),
                   updated_at=NOW()
               WHERE payment_id=$5
                 AND status NOT IN ('refunded')""",
            new_status, amount_refunded, refund_status,
            charge_id, payment_id,
        )
        log.info(
            "Remboursement : payment=%s | amount=%.2f€ | full=%s → status=%s",
            payment_id, amount_refunded, fully_refunded, new_status,
        )
        if _rows(res) > 0:
            row = await conn.fetchrow(
                "SELECT payer_user_id FROM payments WHERE payment_id=$1", payment_id
            )
            if row:
                if fully_refunded:
                    title = "Remboursement effectué"
                    body  = f"Vous avez été remboursé de {amount_refunded:.2f} €."
                else:
                    title = "Remboursement partiel"
                    body  = f"Un remboursement partiel de {amount_refunded:.2f} € a été initié."
                pending_notifs.append({
                    "user_id": row["payer_user_id"],
                    "type": "payment_refunded",
                    "title": title,
                    "body": body,
                    "data": {
                        "type": "payment_refunded",
                        "payment_id": payment_id,
                        "refund_amount": amount_refunded,
                        "fully_refunded": fully_refunded,
                    },
                })

    elif event_type == "refund.updated":
        refund_id     = _get(obj, "id")
        refund_status = _get(obj, "status", "")     # pending/succeeded/failed/canceled
        charge_id     = _get(obj, "charge")
        amount_cents  = _get(obj, "amount", 0)
        amount        = round(amount_cents / 100, 2)

        # Chercher le payment via charge_id si payment_id pas encore résolu
        if not payment_id and charge_id:
            row = await conn.fetchrow(
                "SELECT payment_id, payer_total_amount FROM payments WHERE stripe_charge_id=$1 LIMIT 1",
                charge_id,
            )
            if row:
                payment_id = row["payment_id"]
                total = float(row["payer_total_amount"] or 0)
                # Si le montant remboursé = montant total → full refund
                if refund_status == "succeeded" and abs(amount - total) < 0.02:
                    await conn.execute(
                        """UPDATE payments
                           SET refund_status=$1, refund_amount=$2,
                               status='refunded', updated_at=NOW()
                           WHERE payment_id=$3 AND status != 'refunded'""",
                        refund_status, amount, payment_id,
                    )
                    log.info(
                        "refund.updated → remboursement complet confirmé : refund=%s | payment=%s",
                        refund_id, payment_id,
                    )
                    return

        if payment_id:
            await conn.execute(
                """UPDATE payments
                   SET refund_status=$1, updated_at=NOW()
                   WHERE payment_id=$2""",
                refund_status, payment_id,
            )
            log.info(
                "refund.updated : refund=%s | status=%s | payment=%s",
                refund_id, refund_status, payment_id,
            )
        else:
            log.debug("refund.updated : payment introuvable (refund=%s charge=%s)", refund_id, charge_id)


# ── Handler : abonnements ──────────────────────────────────────────────────────

async def _handle_subscription_event(
    conn, event_type: str, obj,
    pending_notifs: list,
) -> None:
    """
    Transitions de statut pour les abonnements Stripe.

    Source de vérité unique pour TOUTES les transitions d'abonnement.

    Mapping + notifications :
      checkout.session.completed (subscription) → active    → notif user
      customer.subscription.created             → active    → notif user
      customer.subscription.updated (cancelling)→ cancelling → notif user
      customer.subscription.updated (cancelled) → cancelled → notif user
      customer.subscription.deleted             → cancelled → notif user
      invoice.paid                              → active + expires_at → notif user
      invoice.payment_failed                    → past_due → notif user
    """
    from models import new_id

    def _ts_to_dt(ts) -> datetime | None:
        if ts:
            try:
                return datetime.fromtimestamp(int(ts), tz=timezone.utc)
            except Exception:
                pass
        return None

    # ── Helper : récupérer user_id depuis user_subscriptions (pour updated/deleted/invoice) ──
    async def _get_user_id_for_sub(stripe_sub_id: str) -> str | None:
        if not stripe_sub_id:
            return None
        row = await conn.fetchrow(
            "SELECT user_id FROM user_subscriptions WHERE stripe_subscription_id=$1 LIMIT 1",
            stripe_sub_id,
        )
        return row["user_id"] if row else None

    # ── Helper : récupérer le nom du plan ──────────────────────────────────────
    async def _get_plan_name(plan_id: str) -> str:
        if not plan_id:
            return "votre abonnement"
        row = await conn.fetchrow(
            "SELECT name FROM subscription_plans WHERE plan_id=$1", plan_id
        )
        return row["name"] if row else plan_id

    # ── checkout.session.completed (mode=subscription) ─────────────────────────
    if event_type == "checkout.session.completed":
        mode = _get(obj, "mode", "")
        if mode != "subscription":
            return  # payment mode → géré par _handle_payment_event

        meta          = _get(obj, "metadata", {}) or {}
        plan_id       = _get(meta, "plan_id")   if isinstance(meta, dict) else None
        user_id       = _get(meta, "user_id")   if isinstance(meta, dict) else None
        stripe_sub_id = _get(obj, "subscription")

        if not plan_id or not user_id or not stripe_sub_id:
            log.warning(
                "checkout.session subscription : données incomplètes meta=%s sub=%s",
                meta, stripe_sub_id,
            )
            return

        # Idempotence : ne pas recréer si déjà présent
        existing = await conn.fetchrow(
            "SELECT subscription_id FROM user_subscriptions WHERE stripe_subscription_id=$1",
            stripe_sub_id,
        )
        if existing:
            log.debug(
                "checkout.session subscription déjà enregistré : sub=%s",
                existing["subscription_id"],
            )
            return

        plan_row = await conn.fetchrow(
            "SELECT * FROM subscription_plans WHERE plan_id=$1", plan_id
        )
        if not plan_row:
            log.warning("Plan %s introuvable pour webhook checkout subscription", plan_id)
            return

        plan = dict(plan_row)
        benefits = _build_benefits_snapshot(plan)

        expires_at = None
        try:
            import stripe_service
            stripe_sub = await stripe_service.retrieve_subscription(stripe_sub_id)
            expires_at = _ts_to_dt(_get(stripe_sub, "current_period_end"))
        except Exception as exc:
            log.warning("Impossible de récupérer la subscription Stripe %s : %s", stripe_sub_id, exc)

        sub_id = new_id("sub")
        await conn.execute(
            """INSERT INTO user_subscriptions
               (subscription_id, user_id, plan_id, status,
                started_at, expires_at, stripe_subscription_id,
                benefits_snapshot, updated_at)
               VALUES ($1,$2,$3,'active',NOW(),$4,$5,$6,NOW())""",
            sub_id, user_id, plan_id,
            expires_at, stripe_sub_id,
            json.dumps(benefits),
        )
        plan_name = plan.get("name", "votre abonnement")
        log.info(
            "Abonnement activé (checkout) : sub=%s | user=%s | plan=%s",
            sub_id, user_id, plan_id,
        )
        pending_notifs.append({
            "user_id": user_id,
            "type": "subscription_activated",
            "title": "Abonnement activé !",
            "body": f"Votre abonnement {plan_name} est maintenant actif.",
            "data": {
                "type": "subscription_activated",
                "subscription_id": sub_id,
                "plan_id": plan_id,
                "plan_name": plan_name,
            },
        })

    # ── customer.subscription.created ──────────────────────────────────────────
    elif event_type == "customer.subscription.created":
        stripe_sub_id = _get(obj, "id")
        meta          = _get(obj, "metadata", {}) or {}
        plan_id       = _get(meta, "plan_id") if isinstance(meta, dict) else None
        user_id       = _get(meta, "user_id") if isinstance(meta, dict) else None

        if not plan_id or not user_id:
            return  # Pas assez d'info (souscription depuis Dashboard Stripe)

        existing = await conn.fetchrow(
            "SELECT subscription_id FROM user_subscriptions WHERE stripe_subscription_id=$1",
            stripe_sub_id,
        )
        if existing:
            return  # Déjà traité via checkout.session.completed

        plan_row = await conn.fetchrow(
            "SELECT * FROM subscription_plans WHERE plan_id=$1", plan_id
        )
        if not plan_row:
            return

        plan     = dict(plan_row)
        benefits = _build_benefits_snapshot(plan)
        expires_at = _ts_to_dt(_get(obj, "current_period_end"))

        sub_id = new_id("sub")
        await conn.execute(
            """INSERT INTO user_subscriptions
               (subscription_id, user_id, plan_id, status,
                started_at, expires_at, stripe_subscription_id,
                benefits_snapshot, updated_at)
               VALUES ($1,$2,$3,'active',NOW(),$4,$5,$6,NOW())""",
            sub_id, user_id, plan_id,
            expires_at, stripe_sub_id,
            json.dumps(benefits),
        )
        plan_name = plan.get("name", "votre abonnement")
        log.info("Abonnement créé (sub.created) : sub=%s | user=%s | plan=%s", sub_id, user_id, plan_id)
        pending_notifs.append({
            "user_id": user_id,
            "type": "subscription_activated",
            "title": "Abonnement activé !",
            "body": f"Votre abonnement {plan_name} est maintenant actif.",
            "data": {
                "type": "subscription_activated",
                "subscription_id": sub_id,
                "plan_id": plan_id,
                "plan_name": plan_name,
            },
        })

    # ── customer.subscription.updated ──────────────────────────────────────────
    elif event_type == "customer.subscription.updated":
        stripe_sub_id        = _get(obj, "id")
        stripe_status        = _get(obj, "status", "")
        cancel_at_period_end = bool(_get(obj, "cancel_at_period_end", False))
        period_end           = _get(obj, "current_period_end")
        expires_at           = _ts_to_dt(period_end)

        # Mapping statut Stripe → statut interne
        if stripe_status == "active" and cancel_at_period_end:
            new_status = "cancelling"
        elif stripe_status == "active":
            new_status = "active"
        elif stripe_status in ("canceled", "cancelled"):
            new_status = "cancelled"
        elif stripe_status == "past_due":
            new_status = "past_due"
        elif stripe_status == "trialing":
            new_status = "trialing"
        else:
            new_status = stripe_status

        if expires_at:
            res = await conn.execute(
                """UPDATE user_subscriptions
                   SET status=$1, expires_at=$2, updated_at=NOW()
                   WHERE stripe_subscription_id=$3
                     AND status NOT IN ('cancelled')""",
                new_status, expires_at, stripe_sub_id,
            )
        else:
            res = await conn.execute(
                """UPDATE user_subscriptions
                   SET status=$1, updated_at=NOW()
                   WHERE stripe_subscription_id=$2
                     AND status NOT IN ('cancelled')""",
                new_status, stripe_sub_id,
            )

        log.info(
            "Abonnement mis à jour : stripe=%s | status=%s | cancel_at_period_end=%s",
            stripe_sub_id, new_status, cancel_at_period_end,
        )
        if _rows(res) > 0:
            user_id = await _get_user_id_for_sub(stripe_sub_id)
            if user_id:
                if new_status == "cancelling":
                    pending_notifs.append({
                        "user_id": user_id,
                        "type": "subscription_cancelling",
                        "title": "Annulation d'abonnement programmée",
                        "body": "Votre abonnement sera annulé à la fin de la période en cours.",
                        "data": {
                            "type": "subscription_cancelling",
                            "stripe_subscription_id": stripe_sub_id,
                        },
                    })
                elif new_status == "cancelled":
                    pending_notifs.append({
                        "user_id": user_id,
                        "type": "subscription_cancelled",
                        "title": "Abonnement annulé",
                        "body": "Votre abonnement a été annulé.",
                        "data": {
                            "type": "subscription_cancelled",
                            "stripe_subscription_id": stripe_sub_id,
                        },
                    })

    # ── customer.subscription.deleted ──────────────────────────────────────────
    elif event_type == "customer.subscription.deleted":
        stripe_sub_id = _get(obj, "id")
        # Obtenir user_id avant la mise à jour
        user_id = await _get_user_id_for_sub(stripe_sub_id)
        res = await conn.execute(
            """UPDATE user_subscriptions
               SET status='cancelled', cancelled_at=NOW(), updated_at=NOW()
               WHERE stripe_subscription_id=$1""",
            stripe_sub_id,
        )
        log.info("Abonnement désactivé (sub.deleted) : stripe=%s", stripe_sub_id)
        if _rows(res) > 0 and user_id:
            pending_notifs.append({
                "user_id": user_id,
                "type": "subscription_cancelled",
                "title": "Abonnement résilié",
                "body": "Votre abonnement a été résilié.",
                "data": {
                    "type": "subscription_cancelled",
                    "stripe_subscription_id": stripe_sub_id,
                },
            })

    # ── invoice.paid → renouvellement ──────────────────────────────────────────
    elif event_type == "invoice.paid":
        stripe_sub_id = _get(obj, "subscription")
        if not stripe_sub_id:
            return
        # Extraire la nouvelle période depuis les lignes de la facture
        lines     = _get(obj, "lines", {})
        data_list = (
            lines.get("data", []) if isinstance(lines, dict)
            else getattr(lines, "data", [])
        )
        period_end = None
        if data_list:
            first_line = data_list[0]
            period = (
                first_line.get("period", {}) if isinstance(first_line, dict)
                else getattr(first_line, "period", {})
            )
            period_end = (
                period.get("end") if isinstance(period, dict)
                else getattr(period, "end", None)
            )

        expires_at = _ts_to_dt(period_end)
        if expires_at:
            res = await conn.execute(
                """UPDATE user_subscriptions
                   SET expires_at=$1, status='active', updated_at=NOW()
                   WHERE stripe_subscription_id=$2
                     AND status NOT IN ('cancelled')""",
                expires_at, stripe_sub_id,
            )
            log.info(
                "Renouvellement abonnement : stripe=%s | expires_at=%s",
                stripe_sub_id, expires_at,
            )
            if _rows(res) > 0:
                user_id = await _get_user_id_for_sub(stripe_sub_id)
                if user_id:
                    pending_notifs.append({
                        "user_id": user_id,
                        "type": "subscription_renewed",
                        "title": "Abonnement renouvelé",
                        "body": "Votre abonnement a été renouvelé avec succès.",
                        "data": {
                            "type": "subscription_renewed",
                            "stripe_subscription_id": stripe_sub_id,
                            "expires_at": expires_at.isoformat(),
                        },
                    })
        else:
            log.warning(
                "invoice.paid : pas de period_end trouvé (stripe_sub=%s)", stripe_sub_id
            )

    # ── invoice.payment_failed ─────────────────────────────────────────────────
    elif event_type == "invoice.payment_failed":
        stripe_sub_id = _get(obj, "subscription")
        if stripe_sub_id:
            res = await conn.execute(
                """UPDATE user_subscriptions
                   SET status='past_due', updated_at=NOW()
                   WHERE stripe_subscription_id=$1
                     AND status NOT IN ('cancelled')""",
                stripe_sub_id,
            )
            log.warning("Paiement abonnement échoué : stripe_sub=%s", stripe_sub_id)
            if _rows(res) > 0:
                user_id = await _get_user_id_for_sub(stripe_sub_id)
                if user_id:
                    pending_notifs.append({
                        "user_id": user_id,
                        "type": "subscription_payment_failed",
                        "title": "Paiement abonnement échoué",
                        "body": "Le renouvellement de votre abonnement a échoué. Veuillez mettre à jour votre moyen de paiement.",
                        "data": {
                            "type": "subscription_payment_failed",
                            "stripe_subscription_id": stripe_sub_id,
                        },
                    })


def _build_benefits_snapshot(plan: dict) -> dict:
    """Construit le snapshot des bénéfices au moment de la souscription."""
    return {
        "plan_id":                 plan["plan_id"],
        "plan_name":               plan.get("name"),
        "exempt_payer_fixed":      plan.get("exempt_payer_fixed", False),
        "exempt_payer_percent":    plan.get("exempt_payer_percent", False),
        "exempt_receiver_fixed":   plan.get("exempt_receiver_fixed", False),
        "exempt_receiver_percent": plan.get("exempt_receiver_percent", False),
        "snapshotted_at":          datetime.now(timezone.utc).isoformat(),
    }


# ── Dispatcher principal ───────────────────────────────────────────────────────

# Événements qui concernent les abonnements
_SUBSCRIPTION_EVENTS = frozenset({
    "checkout.session.completed",   # mode=subscription uniquement
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
})

# Événements qui concernent les paiements transactionnels
_PAYMENT_EVENTS = frozenset({
    "checkout.session.completed",   # mode=payment uniquement
    "payment_intent.amount_capturable_updated",
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "payment_intent.canceled",
})

# Événements de remboursement
_CHARGE_EVENTS = frozenset({
    "charge.refunded",
    "refund.updated",
})


async def dispatch(
    pool,
    event_id: str,
    event_type: str,
    obj,
) -> dict:
    """
    Dispatcher principal du webhook Stripe.

    1. Réserve l'event (idempotence via stripe_webhook_events)
    2. Résout le payment_id si applicable
    3. Route vers le/les bon(s) handler(s)
    4. Collecte les notifications à envoyer (pending_notifs)
    5. Marque l'event 'success' ou 'error'
    6. Envoie les notifications APRÈS libération de la connexion

    Retourne un dict {"received": True} dans tous les cas (200 OK pour Stripe).
    """
    related_id     = None
    pending_notifs = []   # Notifications collectées pendant le traitement

    async with pool.acquire() as conn:
        # ── 1. Idempotence ────────────────────────────────────────────────────
        is_new = await _claim_event(conn, event_id, event_type)
        if not is_new:
            # Event déjà traité — retourner 200 sans re-traiter
            return {"received": True, "idempotent_skip": True}

        # ── 2. Résolution du payment_id ───────────────────────────────────────
        payment_id, booking_id = await _resolve_payment_id(conn, event_type, obj)
        related_id = payment_id

        # ── 3. Dispatch ───────────────────────────────────────────────────────
        try:
            if event_type in _CHARGE_EVENTS:
                await _handle_charge_event(conn, event_type, obj, payment_id, pending_notifs)
                related_id = payment_id

            if event_type in _PAYMENT_EVENTS:
                if payment_id:
                    await _handle_payment_event(
                        conn, event_type, obj, payment_id, booking_id, pending_notifs
                    )
                elif event_type != "checkout.session.completed":
                    # checkout.session peut être subscription → OK sans payment_id
                    log.debug(
                        "Webhook payment sans payment_id : type=%s", event_type
                    )

            if event_type in _SUBSCRIPTION_EVENTS:
                sub_related = await _dispatch_subscription(conn, event_type, obj, pending_notifs)
                related_id = related_id or sub_related

            # ── 4. Marquer succès ─────────────────────────────────────────────
            await _mark_done(conn, event_id, "success", related_id=related_id)

        except Exception as exc:
            log.exception(
                "Erreur handler webhook event=%s id=%s : %s", event_type, event_id, exc
            )
            await _mark_done(
                conn, event_id, "error",
                related_id=related_id,
                error_message=str(exc)[:500],
            )
            # On ne relève PAS l'exception : Stripe doit recevoir 200
            # (sinon il réessaie indéfiniment)

    # ── 5. Envoi des notifications APRÈS libération de la connexion ───────────
    # Utilise pool.acquire() indépendamment pour ne pas bloquer le webhook.
    if pending_notifs:
        from push_service import store_notification
        for notif in pending_notifs:
            try:
                await store_notification(
                    pool,
                    notif["user_id"],
                    notif["type"],
                    notif["title"],
                    notif["body"],
                    notif.get("data"),
                )
                log.info(
                    "Notification envoyée : type=%s | user=%s",
                    notif["type"], notif["user_id"],
                )
            except Exception as exc:
                log.warning(
                    "Erreur envoi notification type=%s user=%s : %s",
                    notif["type"], notif.get("user_id"), exc,
                )

    return {"received": True}


async def _dispatch_subscription(conn, event_type: str, obj, pending_notifs: list) -> str | None:
    """
    Sous-dispatcher pour les événements abonnement.
    Retourne l'ID de l'objet local créé/modifié (pour related_id), ou None.
    """
    # Pour checkout.session.completed, vérifier le mode avant de traiter
    if event_type == "checkout.session.completed":
        mode = _get(obj, "mode", "")
        if mode != "subscription":
            return None  # Pas un event abonnement

    await _handle_subscription_event(conn, event_type, obj, pending_notifs)

    # Récupérer l'ID Stripe de l'objet pour le related_id
    stripe_sub_id = None
    if event_type == "checkout.session.completed":
        stripe_sub_id = _get(obj, "subscription")
    elif "subscription" in event_type:
        stripe_sub_id = _get(obj, "id")
    elif event_type in ("invoice.paid", "invoice.payment_failed"):
        stripe_sub_id = _get(obj, "subscription")

    if stripe_sub_id:
        row = await conn.fetchrow(
            "SELECT subscription_id FROM user_subscriptions WHERE stripe_subscription_id=$1 LIMIT 1",
            stripe_sub_id,
        )
        if row:
            return row["subscription_id"]

    return None
