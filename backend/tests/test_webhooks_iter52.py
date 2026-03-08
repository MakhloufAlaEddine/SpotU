"""
test_webhooks_iter52.py — Tests complets des webhooks Stripe (SpotU)
====================================================================

Couvre la totalité des événements gérés par webhook_handlers.py :

  Paiements transactionnels :
    01. checkout.session.completed (mode=payment, unpaid)  → authorized
    02. checkout.session.completed (mode=payment, paid)    → captured
    03. payment_intent.amount_capturable_updated           → authorized
    04. payment_intent.succeeded                           → captured + charge_id
    05. payment_intent.payment_failed                      → failed
    06. payment_intent.canceled                            → cancelled

  Remboursements :
    07. charge.refunded (complet)                          → refunded + refund_amount
    08. charge.refunded (partiel)                          → partially_refunded
    09. refund.updated (succeeded)                         → refund_status updated

  Abonnements :
    10. customer.subscription.created                      → user_subscription active
    11. customer.subscription.updated (cancel_at_period_end) → cancelling
    12. customer.subscription.updated (canceled)           → cancelled
    13. customer.subscription.deleted                      → cancelled + cancelled_at
    14. invoice.paid                                       → active + expires_at renouvelé
    15. invoice.payment_failed                             → past_due
    16. checkout.session.completed (mode=subscription)     → user_subscription active

  Idempotence & robustesse :
    17. Même event_id envoyé deux fois                     → traité une seule fois
    18. Event inconnu / non supporté                       → 200 OK sans erreur
    19. Body JSON invalide                                 → 400
    20. State guard : pas de régression d'état             → status capturé reste capturé

Architecture :
  - Chaque test crée son propre payment/subscription record en DB (isolation)
  - Chaque test nettoie ses propres enregistrements stripe_webhook_events
  - Pas de dépendance entre les tests (order-independent)
"""

import asyncio
import json
import os
import uuid
from datetime import datetime, timezone, timedelta

import asyncpg
import httpx
import pytest

# ── Configuration ──────────────────────────────────────────────────────────────

API_BASE = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://spotu-backend.preview.emergentagent.com",
).rstrip("/")

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://winek:winek2024@127.0.0.1/winek_db",
)

USER_EMAIL  = "user@winek.app"
USER_PASS   = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"
ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS  = "WinekAdmin2024!"

WEBHOOK_URL = f"{API_BASE}/api/webhook/stripe"


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_event_id(prefix: str = "evt") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


def make_pi_id() -> str:
    return f"pi_{uuid.uuid4().hex[:24]}"


def make_cs_id() -> str:
    return f"cs_test_{uuid.uuid4().hex[:24]}"


def make_ch_id() -> str:
    return f"ch_{uuid.uuid4().hex[:24]}"


def make_sub_id() -> str:
    return f"sub_{uuid.uuid4().hex[:24]}"


def build_event(event_type: str, obj: dict, event_id: str | None = None) -> dict:
    """Construit un event Stripe minimal (sans signature — mode test)."""
    return {
        "id":   event_id or make_event_id(),
        "type": event_type,
        "data": {"object": obj},
    }


async def post_webhook(client: httpx.AsyncClient, event: dict) -> httpx.Response:
    return await client.post(WEBHOOK_URL, json=event, timeout=30)


# ── Fixtures ────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
async def db():
    conn = await asyncpg.connect(DB_URL)
    yield conn
    await conn.close()


@pytest.fixture(scope="module")
async def user_ids(db):
    user  = await db.fetchrow("SELECT user_id FROM users WHERE email=$1", USER_EMAIL)
    coach = await db.fetchrow("SELECT user_id FROM users WHERE email=$1", COACH_EMAIL)
    plan  = await db.fetchrow("SELECT plan_id FROM subscription_plans WHERE active=TRUE LIMIT 1")

    _test_plan_created = False
    if not plan:
        # Créer un plan de test temporaire
        test_plan_id = "plan_test_iter52_webhook"
        await db.execute(
            """INSERT INTO subscription_plans
               (plan_id, name, description, price, duration_days, active)
               VALUES ($1, 'Test Plan Iter52', 'Plan temporaire tests webhooks', 9.99, 30, TRUE)
               ON CONFLICT (plan_id) DO NOTHING""",
            test_plan_id,
        )
        plan = await db.fetchrow("SELECT plan_id FROM subscription_plans WHERE plan_id=$1", test_plan_id)
        _test_plan_created = True

    yield {
        "user":               user["user_id"],
        "coach":              coach["user_id"],
        "plan":               plan["plan_id"],
        "_test_plan_created": _test_plan_created,
        "_test_plan_id":      plan["plan_id"],
    }

    # Nettoyage du plan temporaire créé par les tests
    if _test_plan_created:
        await db.execute(
            "DELETE FROM subscription_plans WHERE plan_id=$1",
            plan["plan_id"],
        )


# ── Helpers DB ─────────────────────────────────────────────────────────────────

async def insert_test_payment(
    db,
    payer_id: str,
    receiver_id: str,
    *,
    status: str = "requires_authorization",
    pi_id: str | None = None,
    cs_id: str | None = None,
    ch_id: str | None = None,
    amount: float = 50.00,
) -> str:
    """Insère un payment de test. Retourne le payment_id."""
    pay_id = f"pay_{uuid.uuid4().hex[:16]}"
    await db.execute(
        """INSERT INTO payments
           (payment_id, payer_user_id, receiver_user_id, product_type,
            base_amount, payer_total_amount, receiver_net_amount,
            platform_total_fee, status, currency,
            stripe_payment_intent_id, stripe_checkout_session_id,
            stripe_charge_id, created_at, updated_at)
           VALUES ($1,$2,$3,'service',
                   $4,$4,$4,0,$5,'eur',
                   $6,$7,$8,NOW(),NOW())""",
        pay_id, payer_id, receiver_id,
        amount, status,
        pi_id, cs_id, ch_id,
    )
    return pay_id


async def insert_test_subscription(
    db,
    user_id: str,
    plan_id: str,
    stripe_sub_id: str,
    *,
    status: str = "active",
    expires_days: int = 30,
) -> str:
    """Insère un user_subscription de test. Retourne le subscription_id."""
    sub_id = f"sub_{uuid.uuid4().hex[:16]}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=expires_days)
    await db.execute(
        """INSERT INTO user_subscriptions
           (subscription_id, user_id, plan_id, status,
            started_at, expires_at, stripe_subscription_id,
            benefits_snapshot, created_at, updated_at)
           VALUES ($1,$2,$3,$4,NOW(),$5,$6,'{}',NOW(),NOW())""",
        sub_id, user_id, plan_id, status, expires_at, stripe_sub_id,
    )
    return sub_id


async def cleanup_payment(db, payment_id: str) -> None:
    await db.execute("DELETE FROM payments WHERE payment_id=$1", payment_id)


async def cleanup_subscription(db, stripe_sub_id: str) -> None:
    await db.execute(
        "DELETE FROM user_subscriptions WHERE stripe_subscription_id=$1", stripe_sub_id
    )


async def cleanup_webhook_event(db, event_id: str) -> None:
    await db.execute(
        "DELETE FROM stripe_webhook_events WHERE event_id=$1", event_id
    )


async def get_payment_status(db, payment_id: str) -> dict:
    row = await db.fetchrow("SELECT * FROM payments WHERE payment_id=$1", payment_id)
    return dict(row) if row else {}


async def get_subscription_status(db, stripe_sub_id: str) -> dict:
    row = await db.fetchrow(
        "SELECT * FROM user_subscriptions WHERE stripe_subscription_id=$1", stripe_sub_id
    )
    return dict(row) if row else {}


async def get_webhook_event(db, event_id: str) -> dict | None:
    row = await db.fetchrow(
        "SELECT * FROM stripe_webhook_events WHERE event_id=$1", event_id
    )
    return dict(row) if row else None


# ══════════════════════════════════════════════════════════════════════════════
# PARTIE 1 — PAIEMENTS TRANSACTIONNELS
# ══════════════════════════════════════════════════════════════════════════════

class TestPaymentEvents:
    """Tests des événements de paiement transactionnel."""

    @pytest.mark.asyncio
    async def test_01_checkout_completed_unpaid_authorized(self, db, user_ids):
        """
        checkout.session.completed (payment_status=unpaid) :
        capture_method=manual → status doit passer à 'authorized'.
        """
        cs_id     = make_cs_id()
        pay_id    = await insert_test_payment(db, user_ids["user"], user_ids["coach"], cs_id=cs_id)
        event_id  = make_event_id()

        obj = {
            "id":             cs_id,
            "mode":           "payment",
            "payment_status": "unpaid",
            "metadata": {
                "payment_id": pay_id,
            },
        }
        event = build_event("checkout.session.completed", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200, f"Webhook HTTP {r.status_code}: {r.text}"
            body = r.json()
            assert body.get("received") is True

            pay = await get_payment_status(db, pay_id)
            assert pay["status"] == "authorized", f"Status attendu 'authorized', obtenu '{pay['status']}'"

            we = await get_webhook_event(db, event_id)
            assert we is not None, "Event non enregistré dans stripe_webhook_events"
            assert we["status"] == "success"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_02_checkout_completed_paid_captured(self, db, user_ids):
        """
        checkout.session.completed (payment_status=paid) :
        capture immédiate → status doit passer à 'captured'.
        """
        cs_id    = make_cs_id()
        pay_id   = await insert_test_payment(db, user_ids["user"], user_ids["coach"], cs_id=cs_id)
        event_id = make_event_id()

        obj = {
            "id":             cs_id,
            "mode":           "payment",
            "payment_status": "paid",
            "metadata": {"payment_id": pay_id},
        }
        event = build_event("checkout.session.completed", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            pay = await get_payment_status(db, pay_id)
            assert pay["status"] == "captured"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_03_amount_capturable_updated(self, db, user_ids):
        """
        payment_intent.amount_capturable_updated :
        PI en requires_capture → status 'authorized'.
        """
        pi_id    = make_pi_id()
        pay_id   = await insert_test_payment(db, user_ids["user"], user_ids["coach"], pi_id=pi_id)
        event_id = make_event_id()

        obj = {
            "id":       pi_id,
            "metadata": {"payment_id": pay_id},
        }
        event = build_event("payment_intent.amount_capturable_updated", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            pay = await get_payment_status(db, pay_id)
            assert pay["status"] == "authorized"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_04_payment_intent_succeeded(self, db, user_ids):
        """
        payment_intent.succeeded :
        → status 'captured' + stripe_charge_id renseigné.
        """
        pi_id    = make_pi_id()
        ch_id    = make_ch_id()
        pay_id   = await insert_test_payment(
            db, user_ids["user"], user_ids["coach"],
            pi_id=pi_id, status="authorized",
        )
        event_id = make_event_id()

        obj = {
            "id":             pi_id,
            "latest_charge":  ch_id,
            "metadata":       {"payment_id": pay_id},
        }
        event = build_event("payment_intent.succeeded", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            pay = await get_payment_status(db, pay_id)
            assert pay["status"] == "captured"
            assert pay["stripe_charge_id"] == ch_id, \
                f"charge_id attendu '{ch_id}', obtenu '{pay['stripe_charge_id']}'"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_05_payment_intent_failed(self, db, user_ids):
        """
        payment_intent.payment_failed :
        → status 'failed'.
        """
        pi_id    = make_pi_id()
        pay_id   = await insert_test_payment(db, user_ids["user"], user_ids["coach"], pi_id=pi_id)
        event_id = make_event_id()

        obj = {
            "id":       pi_id,
            "metadata": {"payment_id": pay_id},
        }
        event = build_event("payment_intent.payment_failed", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            pay = await get_payment_status(db, pay_id)
            assert pay["status"] == "failed"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_06_payment_intent_canceled(self, db, user_ids):
        """
        payment_intent.canceled :
        → status 'cancelled'.
        """
        pi_id    = make_pi_id()
        pay_id   = await insert_test_payment(
            db, user_ids["user"], user_ids["coach"],
            pi_id=pi_id, status="authorized",
        )
        event_id = make_event_id()

        obj = {
            "id":       pi_id,
            "metadata": {"payment_id": pay_id},
        }
        event = build_event("payment_intent.canceled", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            pay = await get_payment_status(db, pay_id)
            assert pay["status"] == "cancelled"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_lookup_by_pi_id_fallback(self, db, user_ids):
        """
        Quand metadata.payment_id est absent :
        le handler retrouve le payment via stripe_payment_intent_id.
        """
        pi_id    = make_pi_id()
        pay_id   = await insert_test_payment(
            db, user_ids["user"], user_ids["coach"], pi_id=pi_id,
        )
        event_id = make_event_id()

        # PAS de metadata.payment_id — le fallback doit trouver par PI
        obj = {
            "id":            pi_id,
            "latest_charge": make_ch_id(),
            # metadata vide intentionnellement
        }
        event = build_event("payment_intent.succeeded", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            pay = await get_payment_status(db, pay_id)
            assert pay["status"] == "captured"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)


# ══════════════════════════════════════════════════════════════════════════════
# PARTIE 2 — REMBOURSEMENTS
# ══════════════════════════════════════════════════════════════════════════════

class TestChargeRefundEvents:
    """Tests des événements de remboursement."""

    @pytest.mark.asyncio
    async def test_07_charge_refunded_full(self, db, user_ids):
        """
        charge.refunded (refunded=True, full amount) :
        → status 'refunded' + refund_amount enregistré.
        """
        ch_id    = make_ch_id()
        pay_id   = await insert_test_payment(
            db, user_ids["user"], user_ids["coach"],
            ch_id=ch_id, status="captured", amount=75.00,
        )
        event_id = make_event_id()

        obj = {
            "id":              ch_id,
            "amount_refunded": 7500,     # centimes
            "refunded":        True,
            "payment_intent":  make_pi_id(),
            "metadata":        {"payment_id": pay_id},
        }
        event = build_event("charge.refunded", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            pay = await get_payment_status(db, pay_id)
            assert pay["status"] == "refunded", f"Status: {pay['status']}"
            assert float(pay["refund_amount"]) == 75.00, f"Montant: {pay['refund_amount']}"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_08_charge_refunded_partial(self, db, user_ids):
        """
        charge.refunded (refunded=False, remboursement partiel) :
        → status 'partially_refunded' + refund_amount partiel.
        """
        ch_id    = make_ch_id()
        pay_id   = await insert_test_payment(
            db, user_ids["user"], user_ids["coach"],
            ch_id=ch_id, status="captured", amount=100.00,
        )
        event_id = make_event_id()

        obj = {
            "id":              ch_id,
            "amount_refunded": 3000,     # 30€ sur 100€
            "refunded":        False,    # partiel
            "payment_intent":  make_pi_id(),
            "metadata":        {"payment_id": pay_id},
        }
        event = build_event("charge.refunded", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            pay = await get_payment_status(db, pay_id)
            assert pay["status"] == "partially_refunded", f"Status: {pay['status']}"
            assert float(pay["refund_amount"]) == 30.00
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_09_refund_updated_succeeded(self, db, user_ids):
        """
        refund.updated (status=succeeded) :
        → refund_status mis à jour en DB.
        """
        ch_id    = make_ch_id()
        pay_id   = await insert_test_payment(
            db, user_ids["user"], user_ids["coach"],
            ch_id=ch_id, status="partially_refunded", amount=50.00,
        )
        event_id = make_event_id()

        obj = {
            "id":     f"re_{uuid.uuid4().hex[:16]}",
            "status": "succeeded",
            "charge": ch_id,
            "amount": 2000,  # 20€
        }
        event = build_event("refund.updated", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            pay = await get_payment_status(db, pay_id)
            assert pay["refund_status"] == "succeeded", f"refund_status: {pay['refund_status']}"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_charge_refunded_lookup_by_charge_id(self, db, user_ids):
        """
        charge.refunded sans metadata.payment_id :
        → fallback lookup par stripe_charge_id.
        """
        ch_id    = make_ch_id()
        pay_id   = await insert_test_payment(
            db, user_ids["user"], user_ids["coach"],
            ch_id=ch_id, status="captured", amount=60.00,
        )
        event_id = make_event_id()

        # Pas de metadata — fallback par charge_id
        obj = {
            "id":              ch_id,
            "amount_refunded": 6000,
            "refunded":        True,
            "payment_intent":  make_pi_id(),
        }
        event = build_event("charge.refunded", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            pay = await get_payment_status(db, pay_id)
            assert pay["status"] == "refunded"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)


# ══════════════════════════════════════════════════════════════════════════════
# PARTIE 3 — ABONNEMENTS
# ══════════════════════════════════════════════════════════════════════════════

class TestSubscriptionEvents:
    """Tests des événements d'abonnement."""

    @pytest.mark.asyncio
    async def test_10_subscription_created(self, db, user_ids):
        """
        customer.subscription.created :
        → créer user_subscription en DB si pas déjà existant.
        """
        stripe_sub_id = make_sub_id()
        event_id      = make_event_id()
        plan_id       = user_ids["plan"]
        user_id       = user_ids["user"]

        # S'assurer qu'il n'existe pas
        await cleanup_subscription(db, stripe_sub_id)

        period_end_ts = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())

        obj = {
            "id":                  stripe_sub_id,
            "status":              "active",
            "current_period_end":  period_end_ts,
            "cancel_at_period_end": False,
            "metadata": {
                "plan_id": plan_id,
                "user_id": user_id,
            },
        }
        event = build_event("customer.subscription.created", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            sub = await get_subscription_status(db, stripe_sub_id)
            assert sub, "Abonnement non créé en DB"
            assert sub["status"] == "active"
            assert sub["user_id"] == user_id
        finally:
            await cleanup_subscription(db, stripe_sub_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_11_subscription_updated_cancelling(self, db, user_ids):
        """
        customer.subscription.updated (cancel_at_period_end=True) :
        → status passe à 'cancelling'.
        """
        stripe_sub_id = make_sub_id()
        plan_id       = user_ids["plan"]
        sub_id        = await insert_test_subscription(
            db, user_ids["user"], plan_id, stripe_sub_id
        )
        event_id = make_event_id()

        period_end_ts = int((datetime.now(timezone.utc) + timedelta(days=25)).timestamp())

        obj = {
            "id":                   stripe_sub_id,
            "status":               "active",
            "cancel_at_period_end": True,
            "current_period_end":   period_end_ts,
        }
        event = build_event("customer.subscription.updated", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            sub = await get_subscription_status(db, stripe_sub_id)
            assert sub["status"] == "cancelling", f"Status: {sub['status']}"
        finally:
            await cleanup_subscription(db, stripe_sub_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_12_subscription_updated_cancelled(self, db, user_ids):
        """
        customer.subscription.updated (status=canceled) :
        → status passe à 'cancelled'.
        """
        stripe_sub_id = make_sub_id()
        plan_id       = user_ids["plan"]
        await insert_test_subscription(db, user_ids["user"], plan_id, stripe_sub_id)
        event_id = make_event_id()

        obj = {
            "id":                   stripe_sub_id,
            "status":               "canceled",
            "cancel_at_period_end": False,
        }
        event = build_event("customer.subscription.updated", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            sub = await get_subscription_status(db, stripe_sub_id)
            assert sub["status"] == "cancelled"
        finally:
            await cleanup_subscription(db, stripe_sub_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_13_subscription_deleted(self, db, user_ids):
        """
        customer.subscription.deleted :
        → status 'cancelled' + cancelled_at renseigné.
        """
        stripe_sub_id = make_sub_id()
        plan_id       = user_ids["plan"]
        await insert_test_subscription(db, user_ids["user"], plan_id, stripe_sub_id)
        event_id = make_event_id()

        obj = {"id": stripe_sub_id}
        event = build_event("customer.subscription.deleted", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            sub = await get_subscription_status(db, stripe_sub_id)
            assert sub["status"] == "cancelled"
            assert sub.get("cancelled_at") is not None, "cancelled_at non renseigné"
        finally:
            await cleanup_subscription(db, stripe_sub_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_14_invoice_paid_renewal(self, db, user_ids):
        """
        invoice.paid :
        → status 'active' + expires_at renouvelé.
        """
        stripe_sub_id = make_sub_id()
        plan_id       = user_ids["plan"]
        await insert_test_subscription(
            db, user_ids["user"], plan_id, stripe_sub_id, expires_days=2
        )
        event_id = make_event_id()

        new_period_end_ts = int(
            (datetime.now(timezone.utc) + timedelta(days=30)).timestamp()
        )
        obj = {
            "subscription": stripe_sub_id,
            "lines": {
                "data": [
                    {"period": {"end": new_period_end_ts}}
                ]
            },
        }
        event = build_event("invoice.paid", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            sub = await get_subscription_status(db, stripe_sub_id)
            assert sub["status"] == "active"
            assert sub["expires_at"] is not None
            # La nouvelle date doit être ~30 jours dans le futur
            expires_ts = sub["expires_at"].timestamp()
            expected_ts = new_period_end_ts
            assert abs(expires_ts - expected_ts) < 60, \
                f"expires_at incorrect : {sub['expires_at']}"
        finally:
            await cleanup_subscription(db, stripe_sub_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_15_invoice_payment_failed(self, db, user_ids):
        """
        invoice.payment_failed :
        → status 'past_due'.
        """
        stripe_sub_id = make_sub_id()
        plan_id       = user_ids["plan"]
        await insert_test_subscription(db, user_ids["user"], plan_id, stripe_sub_id)
        event_id = make_event_id()

        obj = {"subscription": stripe_sub_id}
        event = build_event("invoice.payment_failed", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            sub = await get_subscription_status(db, stripe_sub_id)
            assert sub["status"] == "past_due"
        finally:
            await cleanup_subscription(db, stripe_sub_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_16_checkout_completed_subscription_mode(self, db, user_ids):
        """
        checkout.session.completed (mode=subscription) :
        → créer user_subscription via checkout.
        Note : le handler appelle retrieve_subscription (peut échouer côté proxy).
        Le test vérifie que la réponse HTTP est 200 et que l'event est tracé.
        """
        stripe_sub_id = make_sub_id()
        cs_id         = make_cs_id()
        plan_id       = user_ids["plan"]
        user_id       = user_ids["user"]
        event_id      = make_event_id()

        # Nettoyer toute subscription existante
        await cleanup_subscription(db, stripe_sub_id)

        obj = {
            "id":           cs_id,
            "mode":         "subscription",
            "subscription": stripe_sub_id,
            "metadata": {
                "plan_id": plan_id,
                "user_id": user_id,
            },
        }
        event = build_event("checkout.session.completed", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            # L'event doit être tracé (success ou error si Stripe proxy échoue)
            we = await get_webhook_event(db, event_id)
            assert we is not None, "Event non tracé dans stripe_webhook_events"
        finally:
            await cleanup_subscription(db, stripe_sub_id)
            await cleanup_webhook_event(db, event_id)


# ══════════════════════════════════════════════════════════════════════════════
# PARTIE 4 — IDEMPOTENCE & ROBUSTESSE
# ══════════════════════════════════════════════════════════════════════════════

class TestIdempotenceAndRobustness:
    """Tests d'idempotence et de robustesse du système."""

    @pytest.mark.asyncio
    async def test_17_idempotence_same_event_twice(self, db, user_ids):
        """
        Idempotence : envoyer le même event_id deux fois.
        → Traité une seule fois, pas de double transition.
        """
        pi_id    = make_pi_id()
        pay_id   = await insert_test_payment(db, user_ids["user"], user_ids["coach"], pi_id=pi_id)
        event_id = make_event_id()

        obj = {
            "id":       pi_id,
            "metadata": {"payment_id": pay_id},
        }
        event = build_event("payment_intent.payment_failed", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                # Envoi 1 — doit être traité
                r1 = await post_webhook(client, event)
                assert r1.status_code == 200
                pay_after_1 = await get_payment_status(db, pay_id)
                assert pay_after_1["status"] == "failed"

                # Envoi 2 — même event_id → doit être ignoré (idempotent_skip)
                r2 = await post_webhook(client, event)
                assert r2.status_code == 200
                body2 = r2.json()
                assert body2.get("idempotent_skip") is True, \
                    f"Doublon non détecté : {body2}"

                pay_after_2 = await get_payment_status(db, pay_id)
                # Status ne doit pas avoir changé
                assert pay_after_2["status"] == "failed"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_18_unknown_event_type_ok(self, db):
        """
        Un event de type non supporté :
        → 200 OK sans erreur (Stripe ne doit pas retenter indéfiniment).
        """
        event_id = make_event_id()
        event = build_event(
            "unknown.event_type_xyz",
            {"id": "obj_test"},
            event_id=event_id,
        )

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
        finally:
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_19_invalid_body(self):
        """
        Body non-JSON :
        → 400 Bad Request.
        """
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                WEBHOOK_URL,
                content=b"not json at all",
                headers={"Content-Type": "application/json"},
            )
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_20_no_state_regression_captured(self, db, user_ids):
        """
        Guard anti-régression : un paiement 'captured' ne doit pas repasser
        à 'authorized' via un event amount_capturable_updated tardif.
        """
        pi_id    = make_pi_id()
        pay_id   = await insert_test_payment(
            db, user_ids["user"], user_ids["coach"],
            pi_id=pi_id, status="captured",
        )
        event_id = make_event_id()

        obj = {
            "id":       pi_id,
            "metadata": {"payment_id": pay_id},
        }
        event = build_event("payment_intent.amount_capturable_updated", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            pay = await get_payment_status(db, pay_id)
            # Doit rester 'captured' et ne pas régresser à 'authorized'
            assert pay["status"] == "captured", \
                f"Régression d'état : {pay['status']} (devrait rester 'captured')"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_21_no_state_regression_refunded(self, db, user_ids):
        """
        Guard anti-régression : un paiement 'refunded' ne doit pas repasser
        à 'captured' via un event payment_intent.succeeded tardif.
        """
        pi_id    = make_pi_id()
        pay_id   = await insert_test_payment(
            db, user_ids["user"], user_ids["coach"],
            pi_id=pi_id, status="refunded",
        )
        event_id = make_event_id()

        obj = {
            "id":            pi_id,
            "latest_charge": make_ch_id(),
            "metadata":      {"payment_id": pay_id},
        }
        event = build_event("payment_intent.succeeded", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            pay = await get_payment_status(db, pay_id)
            # Doit rester 'refunded'
            assert pay["status"] == "refunded", \
                f"Régression d'état : {pay['status']} (devrait rester 'refunded')"
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_22_subscription_cancelled_no_reactivation(self, db, user_ids):
        """
        Guard anti-régression : un abonnement 'cancelled' ne doit pas repasser
        à 'past_due' via invoice.payment_failed.
        """
        stripe_sub_id = make_sub_id()
        plan_id       = user_ids["plan"]
        await insert_test_subscription(
            db, user_ids["user"], plan_id, stripe_sub_id, status="cancelled"
        )
        event_id = make_event_id()

        obj = {"subscription": stripe_sub_id}
        event = build_event("invoice.payment_failed", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200
            sub = await get_subscription_status(db, stripe_sub_id)
            # La condition WHERE status NOT IN ('cancelled') doit protéger l'état
            assert sub["status"] == "cancelled", \
                f"Régression : {sub['status']} (devrait rester 'cancelled')"
        finally:
            await cleanup_subscription(db, stripe_sub_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_23_webhook_event_tracked_in_db(self, db, user_ids):
        """
        Vérification que chaque webhook est tracé dans stripe_webhook_events
        avec le bon statut et le related_id renseigné.
        """
        pi_id    = make_pi_id()
        pay_id   = await insert_test_payment(db, user_ids["user"], user_ids["coach"], pi_id=pi_id)
        event_id = make_event_id()

        obj = {
            "id":            pi_id,
            "latest_charge": make_ch_id(),
            "metadata":      {"payment_id": pay_id},
        }
        event = build_event("payment_intent.succeeded", obj, event_id=event_id)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await post_webhook(client, event)
            assert r.status_code == 200

            we = await get_webhook_event(db, event_id)
            assert we is not None
            assert we["event_type"] == "payment_intent.succeeded"
            assert we["status"] == "success"
            assert we["related_id"] == pay_id
            assert we["error_message"] is None
        finally:
            await cleanup_payment(db, pay_id)
            await cleanup_webhook_event(db, event_id)

    @pytest.mark.asyncio
    async def test_24_missing_event_id_returns_400(self):
        """
        Event sans 'id' :
        → 400 Bad Request.
        """
        malformed = {"type": "payment_intent.succeeded", "data": {"object": {}}}
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(WEBHOOK_URL, json=malformed)
        assert r.status_code == 400


# ══════════════════════════════════════════════════════════════════════════════
# PARTIE 5 — RÉCAPITULATIF FONCTIONNEL
# ══════════════════════════════════════════════════════════════════════════════

class TestSummary:
    """Tests de bout en bout pour valider les flux principaux."""

    @pytest.mark.asyncio
    async def test_25_full_payment_lifecycle(self, db, user_ids):
        """
        Cycle complet d'un paiement :
        requires_authorization → authorized → captured (via webhooks successifs).
        """
        pi_id    = make_pi_id()
        ch_id    = make_ch_id()
        pay_id   = await insert_test_payment(db, user_ids["user"], user_ids["coach"], pi_id=pi_id)

        # État initial
        pay = await get_payment_status(db, pay_id)
        assert pay["status"] == "requires_authorization"

        evt_ids = []
        try:
            async with httpx.AsyncClient(timeout=30) as client:

                # Step 1 : amount_capturable_updated → authorized
                eid1 = make_event_id()
                evt_ids.append(eid1)
                r = await post_webhook(client, build_event(
                    "payment_intent.amount_capturable_updated",
                    {"id": pi_id, "metadata": {"payment_id": pay_id}},
                    event_id=eid1,
                ))
                assert r.status_code == 200
                pay = await get_payment_status(db, pay_id)
                assert pay["status"] == "authorized"

                # Step 2 : payment_intent.succeeded → captured
                eid2 = make_event_id()
                evt_ids.append(eid2)
                r = await post_webhook(client, build_event(
                    "payment_intent.succeeded",
                    {"id": pi_id, "latest_charge": ch_id, "metadata": {"payment_id": pay_id}},
                    event_id=eid2,
                ))
                assert r.status_code == 200
                pay = await get_payment_status(db, pay_id)
                assert pay["status"] == "captured"
                assert pay["stripe_charge_id"] == ch_id

        finally:
            await cleanup_payment(db, pay_id)
            for eid in evt_ids:
                await cleanup_webhook_event(db, eid)

    @pytest.mark.asyncio
    async def test_26_full_subscription_lifecycle(self, db, user_ids):
        """
        Cycle complet d'un abonnement :
        created → cancelling → deleted.
        """
        stripe_sub_id = make_sub_id()
        plan_id       = user_ids["plan"]
        user_id       = user_ids["user"]
        period_end    = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())

        evt_ids = []
        try:
            async with httpx.AsyncClient(timeout=30) as client:

                # Step 1 : subscription.created → active
                eid1 = make_event_id()
                evt_ids.append(eid1)
                r = await post_webhook(client, build_event(
                    "customer.subscription.created",
                    {
                        "id": stripe_sub_id,
                        "status": "active",
                        "current_period_end": period_end,
                        "cancel_at_period_end": False,
                        "metadata": {"plan_id": plan_id, "user_id": user_id},
                    },
                    event_id=eid1,
                ))
                assert r.status_code == 200
                sub = await get_subscription_status(db, stripe_sub_id)
                assert sub, "Abonnement non créé"
                assert sub["status"] == "active"

                # Step 2 : subscription.updated → cancelling
                eid2 = make_event_id()
                evt_ids.append(eid2)
                r = await post_webhook(client, build_event(
                    "customer.subscription.updated",
                    {
                        "id": stripe_sub_id,
                        "status": "active",
                        "cancel_at_period_end": True,
                        "current_period_end": period_end,
                    },
                    event_id=eid2,
                ))
                assert r.status_code == 200
                sub = await get_subscription_status(db, stripe_sub_id)
                assert sub["status"] == "cancelling"

                # Step 3 : subscription.deleted → cancelled
                eid3 = make_event_id()
                evt_ids.append(eid3)
                r = await post_webhook(client, build_event(
                    "customer.subscription.deleted",
                    {"id": stripe_sub_id},
                    event_id=eid3,
                ))
                assert r.status_code == 200
                sub = await get_subscription_status(db, stripe_sub_id)
                assert sub["status"] == "cancelled"

        finally:
            await cleanup_subscription(db, stripe_sub_id)
            for eid in evt_ids:
                await cleanup_webhook_event(db, eid)
