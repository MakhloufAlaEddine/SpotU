"""
test_notifications_iter53.py — Tests des notifications branchées sur le workflow booking/payment/subscription
============================================================================================================

Couvre TOUS les événements générateurs de notifications :

  Booking (booking_routes.py) :
    01. booking_accepted   → notif payer
    02. booking_refused    → notif payer
    03. booking_cancelled  → notif receiver

  Payment (webhook_handlers.py) :
    04. payment_authorized (checkout.session.completed unpaid) → notif receiver
    05. payment_authorized (payment_intent.amount_capturable_updated) → notif receiver
    06. payment_captured   (payment_intent.succeeded)  → notif payer
    07. payment_failed     (payment_intent.payment_failed) → notif payer
    08. payment_refunded   (charge.refunded full)        → notif payer
    09. payment_partially_refunded (charge.refunded partial) → notif payer

  Abonnement (webhook_handlers.py) :
    10. subscription_activated  (customer.subscription.created) → notif user
    11. subscription_cancelling (customer.subscription.updated cancel_at_period_end) → notif user
    12. subscription_cancelled  (customer.subscription.deleted) → notif user
    13. subscription_renewed    (invoice.paid) → notif user
    14. subscription_payment_failed (invoice.payment_failed) → notif user

  Anti-doublon :
    15. Webhook idempotent — pas de notification en double

Architecture des tests :
  - Chaque test crée ses propres fixtures en DB (isolation totale)
  - Les notifications sont consultées via SELECT dans la table 'notifications'
  - Un timeout de 2s est accordé aux notifications async
  - Cleanup systématique même en cas d'erreur (try/finally)
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone, timedelta

import asyncpg
import httpx
import pytest
import requests

DB_URL   = "postgresql://winek:winek2024@127.0.0.1/winek_db"
BASE_URL = "https://marketplace-modal.preview.emergentagent.com"

USER_EMAIL  = "user@winek.app"
USER_PASS   = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"


# ── Utilitaires ────────────────────────────────────────────────────────────────

def make_id(prefix="id"):
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def make_event(event_type, obj, event_id=None):
    return {"id": event_id or make_id("evt"), "type": event_type, "data": {"object": obj}}


def login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login échoué : {r.text}"
    return {"Authorization": f"Bearer {r.json()['token']}"}


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
async def ids(db):
    user  = await db.fetchrow("SELECT user_id FROM users WHERE email=$1", USER_EMAIL)
    coach = await db.fetchrow("SELECT user_id FROM users WHERE email=$1", COACH_EMAIL)
    plan  = await db.fetchrow("SELECT plan_id FROM subscription_plans WHERE active=TRUE LIMIT 1")
    svc   = await db.fetchrow("SELECT service_id FROM services LIMIT 1")
    slot  = await db.fetchrow(
        "SELECT slot_id FROM service_slots WHERE slot_status='available' LIMIT 1"
    )
    return {
        "user":    user["user_id"],
        "coach":   coach["user_id"],
        "plan_id": plan["plan_id"] if plan else "plan_basic",
        "svc_id":  svc["service_id"] if svc else None,
        "slot_id": slot["slot_id"] if slot else None,
    }


@pytest.fixture(scope="module")
def user_headers():
    return login(USER_EMAIL, USER_PASS)


@pytest.fixture(scope="module")
def coach_headers():
    return login(COACH_EMAIL, COACH_PASS)


# ── Helpers DB ─────────────────────────────────────────────────────────────────

async def insert_payment(db, payer_id, receiver_id, *, status="requires_authorization",
                         pi_id=None, cs_id=None, ch_id=None, amount=50.0,
                         booking_id=None) -> str:
    pay_id = make_id("pay")
    await db.execute(
        """INSERT INTO payments
           (payment_id, payer_user_id, receiver_user_id, product_type,
            base_amount, payer_total_amount, receiver_net_amount,
            platform_total_fee, status, currency,
            stripe_payment_intent_id, stripe_checkout_session_id,
            stripe_charge_id, booking_id, created_at, updated_at)
           VALUES ($1,$2,$3,'service',$4,$4,$4,0,$5,'eur',$6,$7,$8,$9,NOW(),NOW())""",
        pay_id, payer_id, receiver_id, amount, status, pi_id, cs_id, ch_id, booking_id,
    )
    return pay_id


async def insert_subscription(db, user_id, plan_id, stripe_sub_id, *,
                               status="active", expires_days=30) -> str:
    sub_id     = make_id("sub")
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


async def create_booking(db, user_id, receiver_id, svc_id, slot_id=None) -> str:
    """Crée une réservation directement en DB (skip API pour isolation)."""
    booking_id = make_id("bk")
    await db.execute(
        """INSERT INTO bookings
           (booking_id, service_id, user_id, receiver_user_id,
            status, payment_status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'requested','unpaid',NOW(),NOW())""",
        booking_id, svc_id, user_id, receiver_id,
    )
    return booking_id


async def get_notifications(db, user_id, notif_type, *, since_seconds=10) -> list:
    """Retourne les notifications d'un type précis créées dans les N dernières secondes."""
    return await db.fetch(
        """SELECT type, title, body, data
           FROM notifications
           WHERE user_id=$1 AND type=$2
             AND created_at >= NOW() - make_interval(secs => $3)
           ORDER BY created_at DESC""",
        user_id, notif_type, float(since_seconds),
    )


async def post_webhook_async(event: dict) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{BASE_URL}/api/webhook/stripe", json=event)
    assert r.status_code == 200, f"Webhook HTTP {r.status_code}: {r.text}"
    return r.json()


async def cleanup(db, **kwargs):
    """Nettoie les objets de test."""
    if payment_id := kwargs.get("payment_id"):
        await db.execute("DELETE FROM payments WHERE payment_id=$1", payment_id)
    if sub_id := kwargs.get("stripe_sub_id"):
        await db.execute(
            "DELETE FROM user_subscriptions WHERE stripe_subscription_id=$1", sub_id
        )
    if booking_id := kwargs.get("booking_id"):
        await db.execute("DELETE FROM bookings WHERE booking_id=$1", booking_id)
    for evt_id in kwargs.get("event_ids", []):
        await db.execute(
            "DELETE FROM stripe_webhook_events WHERE event_id=$1", evt_id
        )


# ══════════════════════════════════════════════════════════════════════════════
# PARTIE 1 — NOTIFICATIONS BOOKING
# ══════════════════════════════════════════════════════════════════════════════

class TestBookingNotifications:
    """Tests des notifications sur les transitions de réservation."""

    def _create_booking_via_api(self, user_headers, notes="") -> dict:
        """Crée une réservation via l'API."""
        svcs = requests.get(f"{BASE_URL}/api/services", timeout=15).json()
        assert svcs, "Aucun service disponible"
        svc = svcs[0]

        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={
                "service_id": svc["service_id"],
                "slot_id":    svc.get("slots", [{}])[0].get("slot_id"),
                "notes":      notes,
            },
            headers=user_headers,
            timeout=15,
        )
        assert r.status_code in (200, 201), f"Création booking échouée : {r.text}"
        return r.json()

    @pytest.mark.asyncio
    async def test_01_booking_accepted_notifies_payer(self, db, ids, coach_headers):
        """
        accept_booking → notification 'booking_accepted' envoyée au payer.
        """
        svc_id     = ids["svc_id"]
        booking_id = await create_booking(db, ids["user"], ids["coach"], svc_id)
        try:
            r = requests.post(
                f"{BASE_URL}/api/bookings/{booking_id}/accept",
                headers=coach_headers, timeout=15,
            )
            assert r.status_code in (200, 201), f"Accept échoué : {r.text}"
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["user"], "booking_accepted")
            assert len(notifs) > 0, "Notification 'booking_accepted' non reçue par le payer"
            assert "acceptée" in notifs[0]["title"].lower(), f"Titre inattendu: {notifs[0]['title']}"
            print(f"PASS: booking_accepted → notif payer ✓ [{notifs[0]['title']}]")
        finally:
            await cleanup(db, booking_id=booking_id)

    @pytest.mark.asyncio
    async def test_02_booking_refused_notifies_payer(self, db, ids, coach_headers):
        """
        refuse_booking → notification 'booking_refused' envoyée au payer.
        """
        svc_id     = ids["svc_id"]
        booking_id = await create_booking(db, ids["user"], ids["coach"], svc_id)
        # Ajouter un paiement associé (pour que le refuse ne plante pas sur le PI)
        await db.execute(
            "UPDATE bookings SET status='requested' WHERE booking_id=$1", booking_id
        )
        try:
            r = requests.post(
                f"{BASE_URL}/api/bookings/{booking_id}/refuse",
                headers=coach_headers, timeout=15,
            )
            assert r.status_code in (200, 201), f"Refuse échoué : {r.text}"
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["user"], "booking_refused")
            assert len(notifs) > 0, "Notification 'booking_refused' non reçue par le payer"
            assert "refus" in notifs[0]["title"].lower(), f"Titre inattendu: {notifs[0]['title']}"
            print(f"PASS: booking_refused → notif payer ✓ [{notifs[0]['title']}]")
        finally:
            await cleanup(db, booking_id=booking_id)

    @pytest.mark.asyncio
    async def test_03_booking_cancelled_notifies_receiver(self, db, ids, user_headers):
        """
        cancel_booking → notification 'booking_cancelled' envoyée au receiver (coach).
        """
        svc_id     = ids["svc_id"]
        booking_id = await create_booking(db, ids["user"], ids["coach"], svc_id)
        try:
            r = requests.post(
                f"{BASE_URL}/api/bookings/{booking_id}/cancel",
                headers=user_headers, timeout=15,
            )
            assert r.status_code in (200, 201), f"Cancel échoué : {r.text}"
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["coach"], "booking_cancelled")
            assert len(notifs) > 0, "Notification 'booking_cancelled' non reçue par le receiver"
            assert "annul" in notifs[0]["title"].lower(), f"Titre inattendu: {notifs[0]['title']}"
            print(f"PASS: booking_cancelled → notif receiver ✓ [{notifs[0]['title']}]")
        finally:
            await cleanup(db, booking_id=booking_id)


# ══════════════════════════════════════════════════════════════════════════════
# PARTIE 2 — NOTIFICATIONS PAIEMENT
# ══════════════════════════════════════════════════════════════════════════════

class TestPaymentNotifications:
    """Tests des notifications sur les transitions de paiement via webhooks."""

    @pytest.mark.asyncio
    async def test_04_payment_authorized_checkout_notifies_receiver(self, db, ids):
        """
        checkout.session.completed (unpaid) → 'payment_authorized' → notif receiver (coach).
        """
        cs_id  = make_id("cs_test")
        pay_id = await insert_payment(db, ids["user"], ids["coach"], cs_id=cs_id)
        evt_id = make_id("evt")
        try:
            event = make_event("checkout.session.completed", {
                "id":             cs_id,
                "mode":           "payment",
                "payment_status": "unpaid",
                "metadata":       {"payment_id": pay_id},
            }, event_id=evt_id)
            body = await post_webhook_async(event)
            assert body.get("received") is True
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["coach"], "payment_authorized")
            assert len(notifs) > 0, "Notification 'payment_authorized' non reçue par le receiver"
            assert "autorisé" in notifs[0]["title"].lower() or "autoris" in notifs[0]["body"].lower()
            print(f"PASS: checkout unpaid → payment_authorized notif receiver ✓")
        finally:
            await cleanup(db, payment_id=pay_id, event_ids=[evt_id])

    @pytest.mark.asyncio
    async def test_05_payment_authorized_pi_notifies_receiver(self, db, ids):
        """
        payment_intent.amount_capturable_updated → 'payment_authorized' → notif receiver.
        """
        pi_id  = make_id("pi")
        pay_id = await insert_payment(db, ids["user"], ids["coach"], pi_id=pi_id)
        evt_id = make_id("evt")
        try:
            event = make_event("payment_intent.amount_capturable_updated", {
                "id":       pi_id,
                "metadata": {"payment_id": pay_id},
            }, event_id=evt_id)
            body = await post_webhook_async(event)
            assert body.get("received") is True
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["coach"], "payment_authorized")
            assert len(notifs) > 0, "Notification 'payment_authorized' non reçue"
            print(f"PASS: amount_capturable_updated → payment_authorized notif receiver ✓")
        finally:
            await cleanup(db, payment_id=pay_id, event_ids=[evt_id])

    @pytest.mark.asyncio
    async def test_06_payment_captured_notifies_payer(self, db, ids):
        """
        payment_intent.succeeded → notification de type 'booking_confirmed' → notif payer (user).
        Note: Le webhook envoie 'booking_confirmed' quand un booking_id est lié au paiement.
        """
        pi_id    = make_id("pi")
        ch_id    = make_id("ch")
        # Crée d'abord un booking pour que la notification soit envoyée
        bk_id    = await create_booking(db, ids["user"], ids["coach"], "svc_demo001")
        pay_id   = await insert_payment(db, ids["user"], ids["coach"], pi_id=pi_id,
                                        status="authorized", booking_id=bk_id)
        evt_id   = make_id("evt")
        try:
            event = make_event("payment_intent.succeeded", {
                "id":            pi_id,
                "latest_charge": ch_id,
                "metadata":      {"payment_id": pay_id, "booking_id": bk_id},
            }, event_id=evt_id)
            body = await post_webhook_async(event)
            assert body.get("received") is True
            await asyncio.sleep(1)

            # Le webhook envoie 'booking_confirmed' (pas 'payment_captured') quand booking_id est présent
            notifs = await get_notifications(db, ids["user"], "booking_confirmed")
            assert len(notifs) > 0, "Notification 'booking_confirmed' non reçue par le payer (payment_intent.succeeded + booking_id)"
            print(f"PASS: payment_intent.succeeded → booking_confirmed notif payer ✓")
        finally:
            await cleanup(db, payment_id=pay_id, event_ids=[evt_id])
            # Clean up booking
            await db.execute("DELETE FROM bookings WHERE booking_id = $1", bk_id)

    @pytest.mark.asyncio
    async def test_07_payment_failed_notifies_payer(self, db, ids):
        """
        payment_intent.payment_failed → 'payment_failed' → notif payer.
        """
        pi_id  = make_id("pi")
        pay_id = await insert_payment(db, ids["user"], ids["coach"], pi_id=pi_id)
        evt_id = make_id("evt")
        try:
            event = make_event("payment_intent.payment_failed", {
                "id":       pi_id,
                "metadata": {"payment_id": pay_id},
            }, event_id=evt_id)
            body = await post_webhook_async(event)
            assert body.get("received") is True
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["user"], "payment_failed")
            assert len(notifs) > 0, "Notification 'payment_failed' non reçue par le payer"
            assert "échoué" in notifs[0]["title"].lower() or "échoué" in notifs[0]["body"].lower()
            print(f"PASS: payment_intent.payment_failed → payment_failed notif payer ✓")
        finally:
            await cleanup(db, payment_id=pay_id, event_ids=[evt_id])

    @pytest.mark.asyncio
    async def test_08_payment_refunded_full_notifies_payer(self, db, ids):
        """
        charge.refunded (full) → 'payment_refunded' → notif payer.
        """
        ch_id  = make_id("ch")
        pay_id = await insert_payment(db, ids["user"], ids["coach"], ch_id=ch_id,
                                      status="captured", amount=100.0)
        evt_id = make_id("evt")
        try:
            event = make_event("charge.refunded", {
                "id":              ch_id,
                "amount_refunded": 10000,
                "refunded":        True,
                "payment_intent":  make_id("pi"),
                "metadata":        {"payment_id": pay_id},
            }, event_id=evt_id)
            body = await post_webhook_async(event)
            assert body.get("received") is True
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["user"], "payment_refunded")
            assert len(notifs) > 0, "Notification 'payment_refunded' non reçue par le payer"
            assert "remboursement" in notifs[0]["title"].lower()
            # Vérifier que le montant est mentionné dans le message
            assert "100" in notifs[0]["body"] or "100.00" in notifs[0]["body"]
            print(f"PASS: charge.refunded → payment_refunded notif payer ✓ [{notifs[0]['body']}]")
        finally:
            await cleanup(db, payment_id=pay_id, event_ids=[evt_id])

    @pytest.mark.asyncio
    async def test_09_payment_partial_refund_notifies_payer(self, db, ids):
        """
        charge.refunded (partial) → 'payment_refunded' → notif payer (partiel).
        """
        ch_id  = make_id("ch")
        pay_id = await insert_payment(db, ids["user"], ids["coach"], ch_id=ch_id,
                                      status="captured", amount=100.0)
        evt_id = make_id("evt")
        try:
            event = make_event("charge.refunded", {
                "id":              ch_id,
                "amount_refunded": 3000,   # 30€ sur 100€
                "refunded":        False,  # partiel
                "payment_intent":  make_id("pi"),
                "metadata":        {"payment_id": pay_id},
            }, event_id=evt_id)
            body = await post_webhook_async(event)
            assert body.get("received") is True
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["user"], "payment_refunded")
            assert len(notifs) > 0, "Notification 'payment_refunded' (partiel) non reçue"
            assert "partiel" in notifs[0]["title"].lower() or "30" in notifs[0]["body"]
            print(f"PASS: charge.refunded partial → notif payer ✓ [{notifs[0]['title']}]")
        finally:
            await cleanup(db, payment_id=pay_id, event_ids=[evt_id])

    @pytest.mark.asyncio
    async def test_no_payment_notif_already_captured(self, db, ids):
        """
        Anti-doublon : si le payment est DÉJÀ 'captured', le webhook payment_intent.succeeded
        ne doit PAS générer de notification (rows_updated = 0).
        """
        pi_id  = make_id("pi")
        pay_id = await insert_payment(db, ids["user"], ids["coach"], pi_id=pi_id,
                                      status="captured")
        evt_id = make_id("evt")
        # Compter les notifs AVANT
        before = await db.fetchval(
            "SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND type='payment_captured'",
            ids["user"],
        )
        try:
            event = make_event("payment_intent.succeeded", {
                "id":            pi_id,
                "latest_charge": make_id("ch"),
                "metadata":      {"payment_id": pay_id},
            }, event_id=evt_id)
            body = await post_webhook_async(event)
            assert body.get("received") is True
            await asyncio.sleep(1)

            after = await db.fetchval(
                "SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND type='payment_captured'",
                ids["user"],
            )
            assert after == before, (
                f"Doublon de notification ! Avant={before}, Après={after} "
                "(payment déjà capturé ne devrait pas notifier)"
            )
            print(f"PASS: pas de doublon notif pour payment déjà captured ✓")
        finally:
            await cleanup(db, payment_id=pay_id, event_ids=[evt_id])


# ══════════════════════════════════════════════════════════════════════════════
# PARTIE 3 — NOTIFICATIONS ABONNEMENT
# ══════════════════════════════════════════════════════════════════════════════

class TestSubscriptionNotifications:
    """Tests des notifications sur les transitions d'abonnement."""

    @pytest.mark.asyncio
    async def test_10_subscription_created_notifies_user(self, db, ids):
        """
        customer.subscription.created → 'subscription_activated' → notif user.
        """
        stripe_sub_id = make_id("sub_stripe")
        evt_id        = make_id("evt")
        period_end    = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
        try:
            event = make_event("customer.subscription.created", {
                "id":                   stripe_sub_id,
                "status":               "active",
                "current_period_end":   period_end,
                "cancel_at_period_end": False,
                "metadata": {
                    "plan_id": ids["plan_id"],
                    "user_id": ids["user"],
                },
            }, event_id=evt_id)
            body = await post_webhook_async(event)
            assert body.get("received") is True
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["user"], "subscription_activated")
            assert len(notifs) > 0, "Notification 'subscription_activated' non reçue"
            assert "activé" in notifs[0]["title"].lower() or "activ" in notifs[0]["body"].lower()
            print(f"PASS: subscription.created → subscription_activated notif user ✓")
        finally:
            await cleanup(db, stripe_sub_id=stripe_sub_id, event_ids=[evt_id])

    @pytest.mark.asyncio
    async def test_11_subscription_cancelling_notifies_user(self, db, ids):
        """
        customer.subscription.updated (cancel_at_period_end=True)
        → 'subscription_cancelling' → notif user.
        """
        stripe_sub_id = make_id("sub_stripe")
        await insert_subscription(db, ids["user"], ids["plan_id"], stripe_sub_id)
        evt_id     = make_id("evt")
        period_end = int((datetime.now(timezone.utc) + timedelta(days=25)).timestamp())
        try:
            event = make_event("customer.subscription.updated", {
                "id":                   stripe_sub_id,
                "status":               "active",
                "cancel_at_period_end": True,
                "current_period_end":   period_end,
            }, event_id=evt_id)
            body = await post_webhook_async(event)
            assert body.get("received") is True
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["user"], "subscription_cancelling")
            assert len(notifs) > 0, "Notification 'subscription_cancelling' non reçue"
            assert "annul" in notifs[0]["title"].lower()
            print(f"PASS: subscription.updated cancelling → notif user ✓")
        finally:
            await cleanup(db, stripe_sub_id=stripe_sub_id, event_ids=[evt_id])

    @pytest.mark.asyncio
    async def test_12_subscription_deleted_notifies_user(self, db, ids):
        """
        customer.subscription.deleted → 'subscription_cancelled' → notif user.
        """
        stripe_sub_id = make_id("sub_stripe")
        await insert_subscription(db, ids["user"], ids["plan_id"], stripe_sub_id)
        evt_id = make_id("evt")
        try:
            event = make_event("customer.subscription.deleted", {
                "id": stripe_sub_id,
            }, event_id=evt_id)
            body = await post_webhook_async(event)
            assert body.get("received") is True
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["user"], "subscription_cancelled")
            assert len(notifs) > 0, "Notification 'subscription_cancelled' non reçue"
            assert "résilié" in notifs[0]["title"].lower() or "annul" in notifs[0]["title"].lower()
            print(f"PASS: subscription.deleted → subscription_cancelled notif user ✓")
        finally:
            await cleanup(db, stripe_sub_id=stripe_sub_id, event_ids=[evt_id])

    @pytest.mark.asyncio
    async def test_13_invoice_paid_renewal_notifies_user(self, db, ids):
        """
        invoice.paid → 'subscription_renewed' → notif user.
        """
        stripe_sub_id = make_id("sub_stripe")
        await insert_subscription(db, ids["user"], ids["plan_id"], stripe_sub_id)
        evt_id     = make_id("evt")
        period_end = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
        try:
            event = make_event("invoice.paid", {
                "subscription": stripe_sub_id,
                "lines": {
                    "data": [{"period": {"end": period_end}}],
                },
            }, event_id=evt_id)
            body = await post_webhook_async(event)
            assert body.get("received") is True
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["user"], "subscription_renewed")
            assert len(notifs) > 0, "Notification 'subscription_renewed' non reçue"
            assert "renouvelé" in notifs[0]["title"].lower()
            print(f"PASS: invoice.paid → subscription_renewed notif user ✓")
        finally:
            await cleanup(db, stripe_sub_id=stripe_sub_id, event_ids=[evt_id])

    @pytest.mark.asyncio
    async def test_14_invoice_payment_failed_notifies_user(self, db, ids):
        """
        invoice.payment_failed → 'subscription_payment_failed' → notif user.
        """
        stripe_sub_id = make_id("sub_stripe")
        await insert_subscription(db, ids["user"], ids["plan_id"], stripe_sub_id)
        evt_id = make_id("evt")
        try:
            event = make_event("invoice.payment_failed", {
                "subscription": stripe_sub_id,
            }, event_id=evt_id)
            body = await post_webhook_async(event)
            assert body.get("received") is True
            await asyncio.sleep(1)

            notifs = await get_notifications(db, ids["user"], "subscription_payment_failed")
            assert len(notifs) > 0, "Notification 'subscription_payment_failed' non reçue"
            assert "échoué" in notifs[0]["title"].lower()
            print(f"PASS: invoice.payment_failed → subscription_payment_failed notif user ✓")
        finally:
            await cleanup(db, stripe_sub_id=stripe_sub_id, event_ids=[evt_id])


# ══════════════════════════════════════════════════════════════════════════════
# PARTIE 4 — ANTI-DOUBLON ET ROBUSTESSE
# ══════════════════════════════════════════════════════════════════════════════

class TestNoDoubleNotifications:
    """Tests d'anti-doublon : s'assurer qu'on n'envoie pas 2× la même notification."""

    @pytest.mark.asyncio
    async def test_15_idempotent_webhook_no_double_notif(self, db, ids):
        """
        Même event_id envoyé deux fois → notification envoyée une seule fois.
        """
        pi_id  = make_id("pi")
        pay_id = await insert_payment(db, ids["user"], ids["coach"], pi_id=pi_id,
                                      status="requires_authorization")
        evt_id = make_id("evt")
        evt    = make_event("payment_intent.payment_failed", {
            "id":       pi_id,
            "metadata": {"payment_id": pay_id},
        }, event_id=evt_id)
        try:
            # Envoi 1
            r1 = await post_webhook_async(evt)
            assert r1.get("received") is True
            assert not r1.get("idempotent_skip")

            # Envoi 2 (même event_id)
            r2 = await post_webhook_async(evt)
            assert r2.get("received") is True
            assert r2.get("idempotent_skip") is True, "Le doublon n'a pas été détecté !"

            await asyncio.sleep(1)
            notifs = await get_notifications(db, ids["user"], "payment_failed")
            assert len(notifs) == 1, (
                f"Attendu 1 notification, reçu {len(notifs)} "
                "(doublon de notification malgré l'idempotence)"
            )
            print(f"PASS: idempotent webhook → 1 seule notification ✓")
        finally:
            await cleanup(db, payment_id=pay_id, event_ids=[evt_id])

    @pytest.mark.asyncio
    async def test_16_booking_idempotent_accept_no_double_notif(self, db, ids, coach_headers):
        """
        Appel accept_booking deux fois → notification envoyée une seule fois.
        (2ème appel retourne idempotent=True, pas de nouvelle notif)
        """
        svc_id     = ids["svc_id"]
        booking_id = await create_booking(db, ids["user"], ids["coach"], svc_id)
        try:
            # Accepter une première fois
            r1 = requests.post(
                f"{BASE_URL}/api/bookings/{booking_id}/accept",
                headers=coach_headers, timeout=15,
            )
            assert r1.status_code in (200, 201)
            await asyncio.sleep(1)
            before = await db.fetchval(
                """SELECT COUNT(*) FROM notifications
                   WHERE user_id=$1 AND type='booking_accepted'
                     AND created_at >= NOW() - make_interval(secs => 15)""",
                ids["user"],
            )

            # Accepter une deuxième fois (idempotent)
            r2 = requests.post(
                f"{BASE_URL}/api/bookings/{booking_id}/accept",
                headers=coach_headers, timeout=15,
            )
            assert r2.status_code in (200, 201)
            body2 = r2.json()
            assert body2.get("idempotent") is True, "2ème accept devrait être idempotent"
            await asyncio.sleep(1)

            after = await db.fetchval(
                """SELECT COUNT(*) FROM notifications
                   WHERE user_id=$1 AND type='booking_accepted'
                     AND created_at >= NOW() - make_interval(secs => 15)""",
                ids["user"],
            )
            assert after == before, (
                f"Doublon de notification ! Avant={before}, Après={after} "
                "(2ème accept idempotent ne devrait pas renvoyer de notif)"
            )
            print(f"PASS: accept idempotent → pas de doublon ✓ ({before} notif)")
        finally:
            await cleanup(db, booking_id=booking_id)
