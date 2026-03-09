"""
test_webhook_instant_booking_iter62.py
=======================================
Teste le flux webhook pour instant_booking:
- checkout.session.completed avec payment_status='unpaid' ET booking.status='awaiting_payment'
  → booking.status doit devenir 'confirmed' et payment.status doit devenir 'captured'
- Vérifie que les deux parties (payer ET coach) sont notifiées
"""

import pytest
import httpx
import psycopg2
import psycopg2.extras
import uuid
import json
import os

BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:8001")
DB_DSN   = "dbname=winek_db user=winek password=winek2024 host=localhost port=5432"


# ── Helpers DB ─────────────────────────────────────────────────────────────────

def db_conn():
    conn = psycopg2.connect(DB_DSN)
    conn.autocommit = False
    return conn


def db_get(table: str, pk_col: str, pk_val: str) -> dict | None:
    conn = db_conn()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(f"SELECT * FROM {table} WHERE {pk_col}=%s", (pk_val,))
    row = cur.fetchone()
    cur.close(); conn.close()
    return dict(row) if row else None


# ── Helpers HTTP ────────────────────────────────────────────────────────────────

def login(client, email, password) -> str:
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login failed ({email}): {r.text}"
    return r.json()["token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def book_instant(client, tok_user, service_id):
    """Crée un booking en instant_booking + pay_now → awaiting_payment."""
    ikey = f"wh_test_{uuid.uuid4().hex[:8]}"
    r = client.post(
        "/api/bookings/request",
        json={"service_id": service_id, "payment_mode": "pay_now", "idempotency_key": ikey},
        headers=auth(tok_user),
    )
    return r


# ── Fixtures ────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def http():
    with httpx.Client(base_url=BASE_URL, timeout=15) as c:
        yield c


@pytest.fixture(scope="module")
def tok_user(http):
    return login(http, "user@winek.app", "WinekUser2024!")


@pytest.fixture(scope="module")
def tok_coach(http):
    return login(http, "coach@winek.app", "WinekCoach2024!")


@pytest.fixture(scope="module")
def tok_admin(http):
    return login(http, "admin@winek.app", "WinekAdmin2024!")


@pytest.fixture(scope="module")
def coach_service_id(http, tok_coach):
    r = http.get("/api/services/mine", headers=auth(tok_coach))
    assert r.status_code == 200, f"GET /services/mine failed: {r.text}"
    svcs = r.json()
    assert svcs, "Le coach n'a aucun service enregistré"
    return svcs[0]["service_id"]


@pytest.fixture(autouse=True, scope="module")
def ensure_mvp_flags(http, tok_admin):
    """S'assure que les flags sont en mode MVP (all false) pour tous ces tests."""
    r = http.put(
        "/api/admin/app-config",
        json={"enable_manual_approval_for_services": False, "enable_pay_later_for_services": False},
        headers=auth(tok_admin),
    )
    assert r.status_code == 200, f"Flag reset failed: {r.text}"
    yield
    # Restaurer MVP defaults
    http.put(
        "/api/admin/app-config",
        json={"enable_manual_approval_for_services": False, "enable_pay_later_for_services": False},
        headers=auth(tok_admin),
    )


def ensure_instant_booking(http, tok_coach, service_id):
    """Configure le service en instant_booking."""
    r = http.patch(
        f"/api/services/{service_id}",
        json={"booking_approval_mode": "instant_booking", "allow_pay_later": False},
        headers=auth(tok_coach),
    )
    assert r.status_code == 200, f"Service config failed: {r.text}"


# ══════════════════════════════════════════════════════════════════════════════
# Tests Webhook
# ══════════════════════════════════════════════════════════════════════════════

class TestWebhookInstantBooking:
    """
    Simule l'événement Stripe checkout.session.completed avec payment_status='unpaid'
    pour vérifier l'auto-confirmation instant_booking.
    """

    def _get_payment_info(self, booking_id: str) -> dict | None:
        """Récupère les infos payment depuis la DB."""
        conn = db_conn()
        cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM payments WHERE booking_id=%s LIMIT 1", (booking_id,))
        row = cur.fetchone()
        cur.close(); conn.close()
        return dict(row) if row else None

    def test_config_booking_returns_mvp_defaults(self, http):
        """GET /api/config/booking doit retourner les deux flags à false en mode MVP."""
        r = http.get("/api/config/booking")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        d = r.json()
        assert "enable_manual_approval_for_services" in d
        assert "enable_pay_later_for_services" in d
        assert d["enable_manual_approval_for_services"] == False, \
            f"Expected False, got {d['enable_manual_approval_for_services']}"
        assert d["enable_pay_later_for_services"] == False, \
            f"Expected False, got {d['enable_pay_later_for_services']}"

    def test_webhook_checkout_completed_unpaid_confirms_booking(
        self, http, tok_user, tok_coach, coach_service_id
    ):
        """
        Webhook: checkout.session.completed + payment_status='unpaid' + booking='awaiting_payment'
        → booking.status='confirmed', payment.status='captured'
        """
        ensure_instant_booking(http, tok_coach, coach_service_id)

        # 1. Créer une réservation en awaiting_payment
        r = book_instant(http, tok_user, coach_service_id)
        assert r.status_code == 200, f"Booking failed: {r.text}"
        d = r.json()
        booking_id = d["booking_id"]
        assert d["status"] == "awaiting_payment", f"Expected awaiting_payment, got {d['status']}"

        # 2. Récupérer payment_id et stripe_checkout_session_id depuis DB
        pay_row = self._get_payment_info(booking_id)
        assert pay_row is not None, "Aucun payment trouvé pour ce booking"
        payment_id   = pay_row["payment_id"]
        session_id   = pay_row.get("stripe_checkout_session_id") or f"cs_sim_{uuid.uuid4().hex[:12]}"
        payer_id     = pay_row.get("payer_user_id")
        receiver_id  = pay_row.get("receiver_user_id")

        # 3. Simuler l'événement Stripe webhook
        webhook_event = {
            "id": f"evt_{uuid.uuid4().hex[:16]}",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": session_id,
                    "object": "checkout.session",
                    "mode": "payment",
                    "payment_status": "unpaid",  # Clé du test : ps='unpaid' pour instant_booking
                    "metadata": {
                        "booking_id":  booking_id,
                        "payment_id":  payment_id,
                    },
                    "payment_intent": f"pi_sim_{uuid.uuid4().hex[:12]}",
                    "amount_total": 5000,
                    "currency": "eur",
                    "status": "complete",
                }
            }
        }

        r_wh = http.post(
            "/api/webhook/stripe",
            content=json.dumps(webhook_event),
            headers={"Content-Type": "application/json"},
        )
        assert r_wh.status_code == 200, f"Webhook retourné {r_wh.status_code}: {r_wh.text}"

        # 4. Vérifier la DB : booking.status='confirmed'
        bk_after = db_get("bookings", "booking_id", booking_id)
        assert bk_after is not None, "Booking introuvable en DB"
        assert bk_after["status"] == "confirmed", \
            f"Expected booking.status='confirmed', got '{bk_after['status']}'"

        # 5. Vérifier la DB : payment.status='captured'
        pay_after = db_get("payments", "payment_id", payment_id)
        assert pay_after is not None, "Payment introuvable en DB"
        assert pay_after["status"] == "captured", \
            f"Expected payment.status='captured', got '{pay_after['status']}'"

    def test_webhook_confirms_and_notifies_both_parties(
        self, http, tok_user, tok_coach, coach_service_id
    ):
        """
        Webhook: checkout.session.completed + payment_status='unpaid' + awaiting_payment
        → booking confirmé ET payer ET receiver notifiés.
        """
        ensure_instant_booking(http, tok_coach, coach_service_id)

        r = book_instant(http, tok_user, coach_service_id)
        assert r.status_code == 200, f"Booking failed: {r.text}"
        d = r.json()
        booking_id  = d["booking_id"]
        payer_id    = d.get("payer_user_id")
        receiver_id = d.get("receiver_user_id")
        assert d["status"] == "awaiting_payment"

        pay_row    = self._get_payment_info(booking_id)
        assert pay_row
        payment_id = pay_row["payment_id"]
        session_id = pay_row.get("stripe_checkout_session_id") or f"cs_notif_{uuid.uuid4().hex[:12]}"

        # Compter les notifications avant le webhook
        conn = db_conn()
        cur  = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM notifications WHERE data::text LIKE %s", (f"%{booking_id}%",))
        count_before = cur.fetchone()[0]
        cur.close(); conn.close()

        webhook_event = {
            "id": f"evt_{uuid.uuid4().hex[:16]}",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": session_id,
                    "object": "checkout.session",
                    "mode": "payment",
                    "payment_status": "unpaid",
                    "metadata": {"booking_id": booking_id, "payment_id": payment_id},
                    "payment_intent": f"pi_sim_{uuid.uuid4().hex[:12]}",
                    "amount_total": 5000,
                    "currency": "eur",
                    "status": "complete",
                }
            }
        }

        r_wh = http.post(
            "/api/webhook/stripe",
            content=json.dumps(webhook_event),
            headers={"Content-Type": "application/json"},
        )
        assert r_wh.status_code == 200, f"Webhook retourné {r_wh.status_code}: {r_wh.text}"

        # Vérifier que le booking est confirmé
        bk_after = db_get("bookings", "booking_id", booking_id)
        assert bk_after["status"] == "confirmed", \
            f"Booking non confirmé: {bk_after['status']}"

        # Vérifier les notifications (doivent avoir augmenté d'au moins 2)
        conn = db_conn()
        cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT user_id FROM notifications WHERE data::text LIKE %s",
            (f"%{booking_id}%",),
        )
        notif_users = {row["user_id"] for row in cur.fetchall()}
        cur.close(); conn.close()

        assert payer_id in notif_users, f"Payer {payer_id} non notifié après webhook"
        assert receiver_id in notif_users, f"Receiver (coach) {receiver_id} non notifié après webhook"

    def test_webhook_idempotent_double_call(
        self, http, tok_user, tok_coach, coach_service_id
    ):
        """
        Appeler deux fois le même webhook avec le même event_id ne doit pas changer le statut.
        (Idempotence via stripe_webhook_events)
        """
        ensure_instant_booking(http, tok_coach, coach_service_id)

        r = book_instant(http, tok_user, coach_service_id)
        assert r.status_code == 200
        d = r.json()
        booking_id = d["booking_id"]
        assert d["status"] == "awaiting_payment"

        pay_row    = self._get_payment_info(booking_id)
        assert pay_row
        payment_id = pay_row["payment_id"]
        session_id = pay_row.get("stripe_checkout_session_id") or f"cs_idem_{uuid.uuid4().hex[:12]}"

        event_id = f"evt_{uuid.uuid4().hex[:16]}"
        webhook_event = {
            "id": event_id,
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": session_id,
                    "object": "checkout.session",
                    "mode": "payment",
                    "payment_status": "unpaid",
                    "metadata": {"booking_id": booking_id, "payment_id": payment_id},
                    "payment_intent": f"pi_sim_{uuid.uuid4().hex[:12]}",
                    "amount_total": 5000,
                    "currency": "eur",
                    "status": "complete",
                }
            }
        }

        # Premier appel → confirme le booking
        r1 = http.post("/api/webhook/stripe", content=json.dumps(webhook_event),
                       headers={"Content-Type": "application/json"})
        assert r1.status_code == 200

        bk_after_first = db_get("bookings", "booking_id", booking_id)
        assert bk_after_first["status"] == "confirmed"

        # Deuxième appel avec le même event_id → doit être idempotent (200, pas d'erreur)
        r2 = http.post("/api/webhook/stripe", content=json.dumps(webhook_event),
                       headers={"Content-Type": "application/json"})
        assert r2.status_code == 200, f"Second webhook call failed: {r2.text}"

        bk_after_second = db_get("bookings", "booking_id", booking_id)
        assert bk_after_second["status"] == "confirmed", \
            f"Statut changé après deuxième appel: {bk_after_second['status']}"

    def test_webhook_paid_status_also_confirms(
        self, http, tok_user, tok_coach, coach_service_id
    ):
        """
        Webhook: checkout.session.completed + payment_status='paid'
        → booking.status='confirmed', payment.status='captured' (flux alternatif).
        """
        ensure_instant_booking(http, tok_coach, coach_service_id)

        r = book_instant(http, tok_user, coach_service_id)
        assert r.status_code == 200
        d = r.json()
        booking_id = d["booking_id"]

        pay_row    = self._get_payment_info(booking_id)
        assert pay_row
        payment_id = pay_row["payment_id"]
        session_id = pay_row.get("stripe_checkout_session_id") or f"cs_paid_{uuid.uuid4().hex[:12]}"

        webhook_event = {
            "id": f"evt_{uuid.uuid4().hex[:16]}",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": session_id,
                    "object": "checkout.session",
                    "mode": "payment",
                    "payment_status": "paid",  # flux alternatif : paid
                    "metadata": {"booking_id": booking_id, "payment_id": payment_id},
                    "payment_intent": f"pi_sim_{uuid.uuid4().hex[:12]}",
                    "amount_total": 5000,
                    "currency": "eur",
                    "status": "complete",
                }
            }
        }

        r_wh = http.post("/api/webhook/stripe", content=json.dumps(webhook_event),
                         headers={"Content-Type": "application/json"})
        assert r_wh.status_code == 200, f"Webhook retourné {r_wh.status_code}: {r_wh.text}"

        bk_after = db_get("bookings", "booking_id", booking_id)
        assert bk_after["status"] == "confirmed", \
            f"Expected confirmed, got {bk_after['status']}"

        pay_after = db_get("payments", "payment_id", payment_id)
        assert pay_after["status"] == "captured", \
            f"Expected captured, got {pay_after['status']}"
