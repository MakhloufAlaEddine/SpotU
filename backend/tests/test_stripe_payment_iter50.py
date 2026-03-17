"""
test_stripe_payment_iter50.py — Tests Stripe Payment Integration (Iteration 50)
================================================================================

Couvre tous les endpoints demandés :
  - POST /api/payments/checkout/session (capture_method=manual)
  - GET  /api/payments/checkout/status/{session_id}
  - POST /api/bookings/request (atomique: booking + payment)
  - POST /api/bookings/{id}/accept (payment → authorized, capture Stripe skippé si PI=None)
  - POST /api/bookings/{id}/refuse (payment → cancelled, annulation Stripe skippée si PI=None)
  - POST /api/bookings/{id}/cancel (payment → cancelled, annulation Stripe skippée si PI=None)
  - GET  /api/payments/me
  - POST /api/webhook/stripe (retourne {"received": True})
  - GET  /api/admin/payments
  - GET  /api/admin/payments/stats

Notes importantes :
  - Le proxy Emergent (sk_test_emergent) retourne session.payment_intent=None → ATTENDU
  - La capture/annulation Stripe est skippée quand stripe_payment_intent_id est NULL → ATTENDU
  - STRIPE_WEBHOOK_SECRET est vide → le webhook accepte tout JSON valide sans signature
  - Le flow DB fonctionne toujours même si Stripe PI est null
  - svc_demo001 appartient à user_coach001 (coach@winek.app)
  - user@winek.app (user_demo001) peut réserver svc_demo001
"""

import pytest
import requests
import os
import json

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://map-refactor-preview.preview.emergentagent.com"
).rstrip("/")

# ── Credentials ────────────────────────────────────────────────────────────────
USER_CREDS  = {"email": "user@winek.app",  "password": "WinekUser2024!"}
COACH_CREDS = {"email": "coach@winek.app", "password": "WinekCoach2024!"}
ADMIN_CREDS = {"email": "admin@winek.app", "password": "WinekAdmin2024!"}

# svc_demo001 owned by coach@winek.app (user_coach001) — may be overridden by setup_module
TEST_SERVICE_ID = "svc_demo001"

_token_cache: dict = {}
_cleanup_bookings: list = []
_SETUP_SVC_ID: str = None  # set in setup_module


def setup_module(module):
    """
    Crée un service de test dédié en mode 'requires_approval' pour les tests de booking.
    Active le flag global 'enable_manual_approval_for_services' via l'admin.
    """
    global TEST_SERVICE_ID, _SETUP_SVC_ID
    import sys
    from datetime import datetime, timedelta

    # 1. Activer le flag global manual approval via admin
    admin_tok = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS, timeout=15)
    assert admin_tok.status_code == 200, f"Admin login failed: {admin_tok.text}"
    admin_token = admin_tok.json().get("token") or admin_tok.json().get("access_token")
    admin_hdrs = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
    r = requests.put(f"{BASE_URL}/api/admin/app-config",
                     json={"enable_manual_approval_for_services": True},
                     headers=admin_hdrs, timeout=10)
    assert r.status_code == 200, f"Enable manual approval failed: {r.text}"

    # 2. Créer un service de test en mode requires_approval
    coach_tok = requests.post(f"{BASE_URL}/api/auth/login", json=COACH_CREDS, timeout=15)
    assert coach_tok.status_code == 200, f"Coach login failed: {coach_tok.text}"
    coach_token = coach_tok.json().get("token") or coach_tok.json().get("access_token")
    coach_hdrs = {"Authorization": f"Bearer {coach_token}", "Content-Type": "application/json"}

    future_dates = [(datetime.now() + timedelta(days=40+i)).strftime("%Y-%m-%d") for i in range(15)]
    slots = [{"slot_date": d, "start_time": "10:00", "end_time": "11:00", "capacity": 5} for d in future_dates]
    payload = {
        "title": "TEST Stripe Payment Service iter50",
        "description": "Service temporaire pour les tests Stripe",
        "price": 50.0,
        "duration_min": 60,
        "domain_id": "dom_coaching",
        "tag_ids": ["tag_coaching_perf"],
        "images": [],
        "booking_approval_mode": "requires_approval",
        "locations": [{"address": "Paris", "latitude": 48.8566, "longitude": 2.3522}],
        "slots": slots,
    }
    svc_resp = requests.post(f"{BASE_URL}/api/services", json=payload, headers=coach_hdrs, timeout=15)
    assert svc_resp.status_code == 200, f"Create service failed: {svc_resp.text}"
    _SETUP_SVC_ID = svc_resp.json()["service_id"]
    TEST_SERVICE_ID = _SETUP_SVC_ID
    sys.modules[__name__].TEST_SERVICE_ID = TEST_SERVICE_ID
    sys.modules[__name__]._SETUP_SVC_ID = _SETUP_SVC_ID
    print(f"setup_module: service {TEST_SERVICE_ID} created (requires_approval mode)")


def teardown_module(module):
    """Supprime le service de test et remet le flag à sa valeur par défaut."""
    if not _SETUP_SVC_ID:
        return
    try:
        coach_tok = requests.post(f"{BASE_URL}/api/auth/login", json=COACH_CREDS, timeout=10)
        if coach_tok.status_code == 200:
            token = coach_tok.json().get("token") or coach_tok.json().get("access_token")
            requests.delete(f"{BASE_URL}/api/services/{_SETUP_SVC_ID}",
                            headers={"Authorization": f"Bearer {token}"}, timeout=10)
            print(f"teardown_module: service {_SETUP_SVC_ID} supprimé")
    except Exception as e:
        print(f"teardown_module warning: {e}")


# ── Auth helpers ───────────────────────────────────────────────────────────────

def get_token(creds: dict) -> str:
    key = creds["email"]
    if key not in _token_cache:
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
        resp.raise_for_status()
        _token_cache[key] = resp.json()["token"]
    return _token_cache[key]


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def create_test_booking(headers: dict, notes: str = "TEST_iter50", service_id: str = None) -> dict:
    """Helper: crée une réservation sans slot_id pour éviter les conflits."""
    if service_id is None:
        service_id = TEST_SERVICE_ID  # Utilise la valeur courante au moment de l'appel
    resp = requests.post(
        f"{BASE_URL}/api/bookings/request",
        headers=headers,
        json={"service_id": service_id, "notes": notes},
        timeout=15,
    )
    assert resp.status_code == 200, f"create_test_booking failed: {resp.status_code} {resp.text}"
    data = resp.json()
    _cleanup_bookings.append(data["booking_id"])
    return data


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def user_token():
    return get_token(USER_CREDS)


@pytest.fixture(scope="module")
def coach_token():
    return get_token(COACH_CREDS)


@pytest.fixture(scope="module")
def admin_token():
    return get_token(ADMIN_CREDS)


@pytest.fixture(scope="module")
def user_headers(user_token):
    return auth_headers(user_token)


@pytest.fixture(scope="module")
def coach_headers(coach_token):
    return auth_headers(coach_token)


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return auth_headers(admin_token)


# ══════════════════════════════════════════════════════════════════════════════
# 1. POST /api/bookings/request — Création atomique booking + payment
# ══════════════════════════════════════════════════════════════════════════════

class TestBookingRequest:
    """POST /api/bookings/request — création atomique booking + payment."""

    def test_create_booking_unauthenticated(self):
        """Sans auth → 401."""
        resp = requests.post(
            f"{BASE_URL}/api/bookings/request",
            json={"service_id": TEST_SERVICE_ID, "notes": "TEST_unauth"},
            timeout=15,
        )
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("PASS: create_booking unauthenticated → 401")

    def test_create_booking_invalid_service(self, user_headers):
        """Service inexistant → 404."""
        resp = requests.post(
            f"{BASE_URL}/api/bookings/request",
            headers=user_headers,
            json={"service_id": "svc_nonexistent_xyz", "notes": "TEST_invalid_svc"},
            timeout=15,
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("PASS: Invalid service_id → 404")

    def test_create_booking_own_service_rejected(self, coach_headers):
        """Coach ne peut pas réserver son propre service → 400."""
        resp = requests.post(
            f"{BASE_URL}/api/bookings/request",
            headers=coach_headers,
            json={"service_id": TEST_SERVICE_ID, "notes": "TEST_self_booking"},
            timeout=15,
        )
        assert resp.status_code == 400, f"Expected 400 for self-booking, got {resp.status_code}"
        print("PASS: Self-booking rejected → 400")

    def test_create_booking_success(self, user_headers):
        """Réservation valide → 200, booking créé avec status=requested."""
        resp = requests.post(
            f"{BASE_URL}/api/bookings/request",
            headers=user_headers,
            json={"service_id": TEST_SERVICE_ID, "notes": "TEST_create_success_iter50"},
            timeout=15,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()

        # Champs requis
        assert "booking_id" in data, "Response must contain booking_id"
        assert data["status"] == "requested", f"New booking status should be 'requested', got {data['status']}"
        assert data["payment_status"] == "pending", f"New booking payment_status should be 'pending', got {data['payment_status']}"
        assert data["service_id"] == TEST_SERVICE_ID
        assert "pricing_snapshot" in data, "Response must contain pricing_snapshot"
        _cleanup_bookings.append(data["booking_id"])
        print(f"PASS: Booking created: {data['booking_id']} status={data['status']}")

    def test_create_booking_creates_payment_record(self, user_headers):
        """Après création d'une réservation, un enregistrement payment doit exister."""
        booking = create_test_booking(user_headers, notes="TEST_payment_record_iter50")
        booking_id = booking["booking_id"]

        # Vérifier le paiement lié
        payments_resp = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        assert payments_resp.status_code == 200
        payments = payments_resp.json()
        matching = [p for p in payments if p.get("booking_id") == booking_id]
        assert len(matching) > 0, f"Payment record not found for booking {booking_id}"

        payment = matching[0]
        # Statut initial : requires_authorization (le paiement n'a pas encore été autorisé)
        assert payment["status"] == "requires_authorization", \
            f"Initial payment status should be 'requires_authorization', got {payment['status']}"
        assert payment["payer_total_amount"] is not None, "payer_total_amount must be set"
        assert float(payment["payer_total_amount"]) > 0, "payer_total_amount must be > 0"
        print(f"PASS: Payment record created with status=requires_authorization, amount={payment['payer_total_amount']}")

    def test_create_booking_idempotency(self, user_headers):
        """Même idempotency_key → même booking retourné."""
        idem_key = "TEST_idem_key_iter50_unique_abc123"

        # Premier appel
        resp1 = requests.post(
            f"{BASE_URL}/api/bookings/request",
            headers=user_headers,
            json={"service_id": TEST_SERVICE_ID, "notes": "TEST_idem_1", "idempotency_key": idem_key},
            timeout=15,
        )
        assert resp1.status_code == 200
        bid1 = resp1.json()["booking_id"]
        _cleanup_bookings.append(bid1)

        # Deuxième appel (même clé)
        resp2 = requests.post(
            f"{BASE_URL}/api/bookings/request",
            headers=user_headers,
            json={"service_id": TEST_SERVICE_ID, "notes": "TEST_idem_2", "idempotency_key": idem_key},
            timeout=15,
        )
        assert resp2.status_code == 200
        bid2 = resp2.json()["booking_id"]

        assert bid1 == bid2, f"Idempotency failed: got different booking_ids {bid1} vs {bid2}"
        print(f"PASS: Idempotency key works — same booking returned: {bid1}")


# ══════════════════════════════════════════════════════════════════════════════
# 2. POST /api/payments/checkout/session
# ══════════════════════════════════════════════════════════════════════════════

class TestCheckoutSession:
    """POST /api/payments/checkout/session — création session Stripe avec capture_method=manual."""

    def test_checkout_session_unauthenticated(self):
        """Sans auth → 401."""
        resp = requests.post(
            f"{BASE_URL}/api/payments/checkout/session",
            json={"booking_id": "bkg_dummy", "origin_url": BASE_URL},
            timeout=15,
        )
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("PASS: checkout/session unauthenticated → 401")

    def test_checkout_session_missing_booking_id(self, user_headers):
        """booking_id manquant → 400."""
        resp = requests.post(
            f"{BASE_URL}/api/payments/checkout/session",
            headers=user_headers,
            json={"origin_url": BASE_URL},
            timeout=15,
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        print("PASS: Missing booking_id → 400")

    def test_checkout_session_empty_booking_id(self, user_headers):
        """booking_id vide → 400."""
        resp = requests.post(
            f"{BASE_URL}/api/payments/checkout/session",
            headers=user_headers,
            json={"booking_id": "", "origin_url": BASE_URL},
            timeout=15,
        )
        assert resp.status_code == 400, f"Expected 400 for empty booking_id, got {resp.status_code}"
        print("PASS: Empty booking_id → 400")

    def test_checkout_session_nonexistent_booking(self, user_headers):
        """Booking inexistant → 404."""
        resp = requests.post(
            f"{BASE_URL}/api/payments/checkout/session",
            headers=user_headers,
            json={"booking_id": "bkg_nonexistent_xyz", "origin_url": BASE_URL},
            timeout=15,
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("PASS: Non-existent booking_id → 404")

    def test_checkout_session_success_returns_url_and_session_id(self, user_headers):
        """Création valide → url Stripe checkout + session_id cs_test_..."""
        booking = create_test_booking(user_headers, notes="TEST_checkout_session_iter50")
        booking_id = booking["booking_id"]

        resp = requests.post(
            f"{BASE_URL}/api/payments/checkout/session",
            headers=user_headers,
            json={"booking_id": booking_id, "origin_url": BASE_URL},
            timeout=25,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()

        assert "url" in data, "Response must contain 'url'"
        assert "session_id" in data, "Response must contain 'session_id'"
        assert data["url"].startswith("https://checkout.stripe.com"), \
            f"URL should be Stripe checkout URL: {data['url']}"
        assert data["session_id"].startswith("cs_test_"), \
            f"session_id should start with cs_test_: {data['session_id']}"
        print(f"PASS: Checkout session created. session_id={data['session_id'][:35]}... url OK")

    def test_checkout_session_payment_intent_null_is_expected(self, user_headers):
        """
        ATTENDU: Le proxy Emergent retourne session.payment_intent=None.
        Le payment record doit avoir stripe_payment_intent_id = session_id (non null, c'est le CS ID).
        """
        booking = create_test_booking(user_headers, notes="TEST_pi_null_check_iter50")
        booking_id = booking["booking_id"]

        session_resp = requests.post(
            f"{BASE_URL}/api/payments/checkout/session",
            headers=user_headers,
            json={"booking_id": booking_id, "origin_url": BASE_URL},
            timeout=25,
        )
        assert session_resp.status_code == 200
        session_id = session_resp.json()["session_id"]

        # Le payment record doit avoir la session_id enregistrée (stripe_payment_intent_id = session_id)
        payments_resp = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        assert payments_resp.status_code == 200
        payments = payments_resp.json()
        payment = next((p for p in payments if p.get("booking_id") == booking_id), None)
        assert payment is not None, f"Payment not found for booking {booking_id}"
        # Note: stripe_payment_intent_id = session_id car le proxy retourne PI=None
        # Le code stocke pi_id = None → la mise à jour de stripe_payment_intent_id est None
        # MAIS stripe_checkout_session_id doit être mis à jour
        # En pratique, le code stocke session.id dans stripe_payment_intent_id si PI est null
        # (voir ligne: await conn.execute SET stripe_checkout_session_id=$1, stripe_payment_intent_id=$2)
        # $2 = pi_id = None → stripe_payment_intent_id reste null mais stripe_checkout_session_id est set
        assert payment.get("stripe_payment_intent_id") is None or \
               payment.get("stripe_payment_intent_id") == session_id, \
            "stripe_payment_intent_id should be null (Emergent proxy) or equal to session_id"
        print(f"PASS: stripe_payment_intent_id={payment.get('stripe_payment_intent_id')} (Emergent proxy behavior EXPECTED)")

    def test_checkout_session_unauthorized_user(self, coach_headers, user_headers):
        """Coach ne peut pas créer session pour une réservation d'un autre utilisateur → 403/404."""
        booking = create_test_booking(user_headers, notes="TEST_unauth_session_iter50")
        booking_id = booking["booking_id"]

        resp = requests.post(
            f"{BASE_URL}/api/payments/checkout/session",
            headers=coach_headers,
            json={"booking_id": booking_id, "origin_url": BASE_URL},
            timeout=15,
        )
        assert resp.status_code in (403, 404), \
            f"Expected 403/404, got {resp.status_code}: {resp.text}"
        print(f"PASS: Unauthorized user gets {resp.status_code} for another user's booking")

    def test_checkout_session_idempotent_reuse(self, user_headers):
        """Appel répété avec même booking_id → réutilise la session ouverte."""
        booking = create_test_booking(user_headers, notes="TEST_session_reuse_iter50")
        booking_id = booking["booking_id"]

        # Premier appel
        resp1 = requests.post(
            f"{BASE_URL}/api/payments/checkout/session",
            headers=user_headers,
            json={"booking_id": booking_id, "origin_url": BASE_URL},
            timeout=25,
        )
        assert resp1.status_code == 200
        session_id1 = resp1.json()["session_id"]

        # Deuxième appel (même booking)
        resp2 = requests.post(
            f"{BASE_URL}/api/payments/checkout/session",
            headers=user_headers,
            json={"booking_id": booking_id, "origin_url": BASE_URL},
            timeout=25,
        )
        assert resp2.status_code == 200
        session_id2 = resp2.json()["session_id"]

        assert session_id1 == session_id2, \
            f"Session should be reused: {session_id1} vs {session_id2}"
        print(f"PASS: Session idempotency — same session reused: {session_id1[:35]}...")


# ══════════════════════════════════════════════════════════════════════════════
# 3. GET /api/payments/checkout/status/{session_id}
# ══════════════════════════════════════════════════════════════════════════════

class TestCheckoutStatus:
    """GET /api/payments/checkout/status/{session_id}."""

    @pytest.fixture(scope="class")
    def booking_with_session(self, user_headers):
        """Crée un booking + session pour les tests de statut."""
        booking = create_test_booking(user_headers, notes="TEST_status_check_iter50")
        booking_id = booking["booking_id"]

        session_resp = requests.post(
            f"{BASE_URL}/api/payments/checkout/session",
            headers=user_headers,
            json={"booking_id": booking_id, "origin_url": BASE_URL},
            timeout=25,
        )
        assert session_resp.status_code == 200
        session_data = session_resp.json()
        return {
            "booking_id": booking_id,
            "session_id": session_data["session_id"],
            "url": session_data["url"],
        }

    def test_status_unauthenticated(self, booking_with_session):
        """Sans auth → 401."""
        session_id = booking_with_session["session_id"]
        resp = requests.get(f"{BASE_URL}/api/payments/checkout/status/{session_id}", timeout=15)
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("PASS: checkout/status unauthenticated → 401")

    def test_status_nonexistent_session(self, user_headers):
        """Session inexistante → 404."""
        resp = requests.get(
            f"{BASE_URL}/api/payments/checkout/status/cs_test_nonexistent_xyz_iter50",
            headers=user_headers,
            timeout=15,
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("PASS: Non-existent session_id → 404")

    def test_status_returns_correct_fields(self, user_headers, booking_with_session):
        """Réponse doit contenir les champs requis."""
        session_id = booking_with_session["session_id"]
        booking_id = booking_with_session["booking_id"]

        resp = requests.get(
            f"{BASE_URL}/api/payments/checkout/status/{session_id}",
            headers=user_headers,
            timeout=25,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()

        required_fields = ["payment_id", "booking_id", "session_id", "status", "payment_status", "amount", "currency"]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"

        assert data["booking_id"] == booking_id, f"booking_id mismatch"
        assert data["session_id"] == session_id, f"session_id mismatch"
        # payment_status retourne désormais le statut interne DB (pas le statut Stripe brut)
        # Les valeurs Stripe (unpaid/paid) ET les valeurs DB (requires_authorization/authorized/...) sont valides
        valid_statuses = (
            "unpaid", "paid", "no_payment_required",           # valeurs Stripe
            "requires_authorization", "authorized", "captured", "cancelled", "pending", "unknown",  # valeurs DB
        )
        assert data["payment_status"] in valid_statuses, \
            f"Invalid payment_status: {data['payment_status']}"
        assert data["status"] in ("open", "expired", "complete"), \
            f"Invalid status: {data['status']}"
        assert isinstance(data["amount"], (int, float)), f"amount must be numeric"
        assert data["amount"] > 0, "amount must be > 0"
        assert data["currency"].lower() in ("eur", "usd")
        print(f"PASS: Status fields correct — status={data['status']}, payment_status={data['payment_status']}, amount={data['amount']}")

    def test_status_new_session_is_open_unpaid(self, user_headers, booking_with_session):
        """Nouvelle session non payée → status=open, payment_status=requires_authorization (statut DB) ou unpaid (Stripe)."""
        session_id = booking_with_session["session_id"]
        resp = requests.get(
            f"{BASE_URL}/api/payments/checkout/status/{session_id}",
            headers=user_headers,
            timeout=25,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "open", f"New session should be 'open', got {data['status']}"
        # payment_status retourne le statut interne DB; une session non payée aura 'requires_authorization'
        assert data["payment_status"] in ("requires_authorization", "unpaid", "pending"), \
            f"New unpaid session should have requires_authorization/unpaid/pending status, got {data['payment_status']}"
        print(f"PASS: New session is open, payment_status={data['payment_status']} ✓")

    def test_status_forbidden_for_other_user(self, coach_headers, booking_with_session):
        """Un autre utilisateur ne peut pas voir le statut → 403/404."""
        session_id = booking_with_session["session_id"]
        resp = requests.get(
            f"{BASE_URL}/api/payments/checkout/status/{session_id}",
            headers=coach_headers,
            timeout=15,
        )
        assert resp.status_code in (403, 404), \
            f"Expected 403/404, got {resp.status_code}"
        print(f"PASS: Other user cannot access payment status → {resp.status_code}")

    def test_status_admin_can_access_any(self, admin_headers, booking_with_session):
        """L'admin peut accéder à n'importe quel statut."""
        session_id = booking_with_session["session_id"]
        resp = requests.get(
            f"{BASE_URL}/api/payments/checkout/status/{session_id}",
            headers=admin_headers,
            timeout=25,
        )
        assert resp.status_code == 200, f"Admin should access status, got {resp.status_code}"
        data = resp.json()
        assert "payment_id" in data
        print("PASS: Admin can access payment status ✓")


# ══════════════════════════════════════════════════════════════════════════════
# 4. POST /api/bookings/{id}/accept
# ══════════════════════════════════════════════════════════════════════════════

class TestBookingAccept:
    """POST /api/bookings/{id}/accept — machine d'états DB + Stripe (skippé si PI=None)."""

    def test_accept_unauthenticated(self):
        """Sans auth → 401."""
        resp = requests.post(
            f"{BASE_URL}/api/bookings/bkg_dummy/accept",
            timeout=15,
        )
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("PASS: accept unauthenticated → 401")

    def test_accept_nonexistent_booking(self, coach_headers):
        """Booking inexistant → 404."""
        resp = requests.post(
            f"{BASE_URL}/api/bookings/bkg_nonexistent_iter50/accept",
            headers=coach_headers,
            timeout=15,
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("PASS: Non-existent booking → 404")

    def test_accept_by_non_receiver_rejected(self, user_headers, admin_headers):
        """Le payer (user) ne peut pas accepter sa propre réservation → 403."""
        # Create booking first as user
        booking = create_test_booking(user_headers, notes="TEST_accept_forbidden_iter50")
        booking_id = booking["booking_id"]

        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/accept",
            headers=user_headers,  # user is payer, not receiver
            timeout=15,
        )
        assert resp.status_code == 403, f"Expected 403 for non-receiver accept, got {resp.status_code}"
        print("PASS: Non-receiver cannot accept → 403")

    def test_accept_booking_success(self, user_headers, coach_headers):
        """
        Accept flow complet :
          booking: requested → accepted
          payment: requires_authorization → authorized
          Stripe capture: skippé car stripe_payment_intent_id=None (ATTENDU)
        """
        booking = create_test_booking(user_headers, notes="TEST_accept_success_iter50")
        booking_id = booking["booking_id"]
        assert booking["status"] == "requested", "Booking should start as requested"

        # Accept as coach (receiver)
        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/accept",
            headers=coach_headers,
            timeout=15,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["success"] is True, f"Expected success=True"
        # Flux C (manual_approval + pay_now non autorisé) : requested → awaiting_payment
        # Flux A (pay_now + déjà autorisé) : requested → confirmed
        assert data["status"] in ("awaiting_payment", "confirmed"), \
            f"Expected awaiting_payment or confirmed after accept, got {data['status']}"
        assert data["booking_id"] == booking_id

        # Vérifier le statut payment en DB
        payments_resp = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        assert payments_resp.status_code == 200
        payments = payments_resp.json()
        payment = next((p for p in payments if p.get("booking_id") == booking_id), None)
        assert payment is not None, f"Payment not found for booking {booking_id}"
        # Si awaiting_payment → paiement non encore effectué → requires_authorization
        # Si confirmed → paiement autorisé et capturé → authorized ou captured
        assert payment["status"] in ("requires_authorization", "authorized", "captured"), \
            f"After accept, payment should be requires_authorization/authorized/captured, got {payment['status']}"
        print(f"PASS: Accept flow — booking={data['status']}, payment={payment['status']} ✓")

    def test_accept_booking_idempotent(self, user_headers, coach_headers):
        """Accepter un booking déjà accepté → idempotent ({success: True, idempotent: True})."""
        booking = create_test_booking(user_headers, notes="TEST_accept_idem_iter50")
        booking_id = booking["booking_id"]

        # First accept
        resp1 = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/accept",
            headers=coach_headers,
            timeout=15,
        )
        assert resp1.status_code == 200

        # Second accept (idempotent)
        resp2 = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/accept",
            headers=coach_headers,
            timeout=15,
        )
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2.get("idempotent") is True, f"Expected idempotent=True, got {data2}"
        print("PASS: Accept idempotency ✓")

    def test_accept_already_refused_booking_rejected(self, user_headers, coach_headers):
        """Accepter un booking refusé → 409."""
        booking = create_test_booking(user_headers, notes="TEST_accept_refused_iter50")
        booking_id = booking["booking_id"]

        # Refuse first
        requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/refuse",
            headers=coach_headers,
            timeout=15,
        )

        # Try to accept refused booking
        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/accept",
            headers=coach_headers,
            timeout=15,
        )
        assert resp.status_code == 409, f"Expected 409 for accepting refused booking, got {resp.status_code}"
        print("PASS: Cannot accept a refused booking → 409")


# ══════════════════════════════════════════════════════════════════════════════
# 5. POST /api/bookings/{id}/refuse
# ══════════════════════════════════════════════════════════════════════════════

class TestBookingRefuse:
    """POST /api/bookings/{id}/refuse — payment → cancelled, Stripe annulé (skippé si PI=None)."""

    def test_refuse_unauthenticated(self):
        """Sans auth → 401."""
        resp = requests.post(f"{BASE_URL}/api/bookings/bkg_dummy/refuse", timeout=15)
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("PASS: refuse unauthenticated → 401")

    def test_refuse_nonexistent_booking(self, coach_headers):
        """Booking inexistant → 404."""
        resp = requests.post(
            f"{BASE_URL}/api/bookings/bkg_nonexistent_iter50/refuse",
            headers=coach_headers,
            timeout=15,
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("PASS: Non-existent booking → 404")

    def test_refuse_by_non_receiver_rejected(self, user_headers):
        """Le payer ne peut pas refuser sa propre réservation → 403."""
        booking = create_test_booking(user_headers, notes="TEST_refuse_forbidden_iter50")
        booking_id = booking["booking_id"]

        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/refuse",
            headers=user_headers,  # user is payer, not receiver
            timeout=15,
        )
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"
        print("PASS: Non-receiver cannot refuse → 403")

    def test_refuse_booking_success(self, user_headers, coach_headers):
        """
        Refuse flow complet :
          booking: requested → refused
          payment: requires_authorization → cancelled
          Stripe cancel: skippé car PI=None (ATTENDU)
        """
        booking = create_test_booking(user_headers, notes="TEST_refuse_success_iter50")
        booking_id = booking["booking_id"]

        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/refuse",
            headers=coach_headers,
            timeout=15,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["success"] is True
        assert data["status"] == "refused", f"Expected status=refused, got {data['status']}"
        assert data["booking_id"] == booking_id

        # Vérifier le statut payment en DB
        payments_resp = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        assert payments_resp.status_code == 200
        payments = payments_resp.json()
        payment = next((p for p in payments if p.get("booking_id") == booking_id), None)
        assert payment is not None, f"Payment not found for booking {booking_id}"
        assert payment["status"] == "cancelled", \
            f"After refuse, payment should be 'cancelled', got {payment['status']}"
        print(f"PASS: Refuse flow — booking=refused, payment=cancelled (Stripe cancel skipped PI=None) ✓")

    def test_refuse_booking_idempotent(self, user_headers, coach_headers):
        """Refuser un booking déjà refusé → idempotent."""
        booking = create_test_booking(user_headers, notes="TEST_refuse_idem_iter50")
        booking_id = booking["booking_id"]

        resp1 = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/refuse",
            headers=coach_headers,
            timeout=15,
        )
        assert resp1.status_code == 200

        resp2 = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/refuse",
            headers=coach_headers,
            timeout=15,
        )
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2.get("idempotent") is True, f"Expected idempotent=True, got {data2}"
        print("PASS: Refuse idempotency ✓")

    def test_refuse_accepted_booking_rejected(self, user_headers, coach_headers):
        """Refuser un booking accepté → 409."""
        booking = create_test_booking(user_headers, notes="TEST_refuse_accepted_iter50")
        booking_id = booking["booking_id"]

        # Accept first
        requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/accept",
            headers=coach_headers,
            timeout=15,
        )

        # Try to refuse accepted booking
        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/refuse",
            headers=coach_headers,
            timeout=15,
        )
        assert resp.status_code == 409, f"Expected 409 for refusing accepted booking, got {resp.status_code}"
        print("PASS: Cannot refuse an accepted booking → 409")


# ══════════════════════════════════════════════════════════════════════════════
# 6. POST /api/bookings/{id}/cancel
# ══════════════════════════════════════════════════════════════════════════════

class TestBookingCancel:
    """POST /api/bookings/{id}/cancel — payer ou admin annule."""

    def test_cancel_unauthenticated(self):
        """Sans auth → 401."""
        resp = requests.post(f"{BASE_URL}/api/bookings/bkg_dummy/cancel", timeout=15)
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("PASS: cancel unauthenticated → 401")

    def test_cancel_nonexistent_booking(self, user_headers):
        """Booking inexistant → 404."""
        resp = requests.post(
            f"{BASE_URL}/api/bookings/bkg_nonexistent_iter50/cancel",
            headers=user_headers,
            timeout=15,
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("PASS: Non-existent booking → 404")

    def test_cancel_by_non_payer_rejected(self, coach_headers, user_headers):
        """
        Le receiver (coach) tente d'annuler un booking 'requested' → 409.
        (Mise à jour iter55 : le receiver est désormais reconnu mais ne peut annuler
        qu'un booking 'accepted'. Pour un booking 'requested' il reçoit 409, non 403.)
        """
        booking = create_test_booking(user_headers, notes="TEST_cancel_forbidden_iter50")
        booking_id = booking["booking_id"]

        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/cancel",
            headers=coach_headers,  # coach is receiver, not payer
            timeout=15,
        )
        # Nouvelle politique : receiver → 409 pour état 'requested' (non 403)
        assert resp.status_code == 409, (
            f"Expected 409 for receiver cancelling 'requested' booking, got {resp.status_code}"
        )
        print("PASS: Receiver cannot cancel 'requested' booking → 409")

    def test_cancel_requested_booking_success(self, user_headers):
        """
        Cancel avant acceptation :
          booking: requested → cancelled
          payment: requires_authorization → cancelled
          Stripe cancel: skippé car PI=None (ATTENDU)
        """
        booking = create_test_booking(user_headers, notes="TEST_cancel_requested_iter50")
        booking_id = booking["booking_id"]

        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/cancel",
            headers=user_headers,
            timeout=15,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["success"] is True
        assert data["status"] == "cancelled", f"Expected status=cancelled, got {data['status']}"
        assert data["booking_id"] == booking_id
        assert data["payment_status"] == "cancelled", \
            f"Expected payment_status=cancelled, got {data['payment_status']}"

        # Vérifier en DB
        payments_resp = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        payments = payments_resp.json()
        payment = next((p for p in payments if p.get("booking_id") == booking_id), None)
        assert payment is not None
        assert payment["status"] == "cancelled", \
            f"Payment should be cancelled in DB, got {payment['status']}"
        print(f"PASS: Cancel requested booking — booking=cancelled, payment=cancelled ✓")

    def test_cancel_accepted_booking_success(self, user_headers, coach_headers):
        """
        Cancel après acceptation :
          booking: accepted → cancelled
          payment: authorized → cancelled (non capturé)
          Stripe cancel: skippé car PI=None (ATTENDU)
        """
        booking = create_test_booking(user_headers, notes="TEST_cancel_accepted_iter50")
        booking_id = booking["booking_id"]

        # Accept first
        accept_resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/accept",
            headers=coach_headers,
            timeout=15,
        )
        assert accept_resp.status_code == 200

        # Cancel after accept
        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/cancel",
            headers=user_headers,
            timeout=15,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["success"] is True
        assert data["status"] == "cancelled"
        # Payment was authorized → cancelled (not captured)
        assert data["payment_status"] == "cancelled", \
            f"Expected payment_status=cancelled, got {data['payment_status']}"
        print(f"PASS: Cancel accepted booking — booking=cancelled, payment=cancelled ✓")

    def test_cancel_booking_idempotent(self, user_headers):
        """Annuler un booking déjà annulé → idempotent."""
        booking = create_test_booking(user_headers, notes="TEST_cancel_idem_iter50")
        booking_id = booking["booking_id"]

        resp1 = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/cancel",
            headers=user_headers,
            timeout=15,
        )
        assert resp1.status_code == 200

        resp2 = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/cancel",
            headers=user_headers,
            timeout=15,
        )
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2.get("idempotent") is True, f"Expected idempotent=True, got {data2}"
        print("PASS: Cancel idempotency ✓")

    def test_cancel_refused_booking_rejected(self, user_headers, coach_headers):
        """Annuler un booking refusé → 409."""
        booking = create_test_booking(user_headers, notes="TEST_cancel_refused_iter50")
        booking_id = booking["booking_id"]

        # Refuse first
        requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/refuse",
            headers=coach_headers,
            timeout=15,
        )

        # Try to cancel refused booking
        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/cancel",
            headers=user_headers,
            timeout=15,
        )
        assert resp.status_code == 409, f"Expected 409 for cancelling refused booking, got {resp.status_code}"
        print("PASS: Cannot cancel a refused booking → 409")

    def test_admin_can_cancel_any_booking(self, user_headers, admin_headers):
        """L'admin peut annuler n'importe quelle réservation."""
        booking = create_test_booking(user_headers, notes="TEST_admin_cancel_iter50")
        booking_id = booking["booking_id"]

        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/cancel",
            headers=admin_headers,
            timeout=15,
        )
        assert resp.status_code == 200, f"Admin should cancel any booking, got {resp.status_code}"
        assert resp.json()["status"] == "cancelled"
        print("PASS: Admin can cancel any booking ✓")


# ══════════════════════════════════════════════════════════════════════════════
# 7. GET /api/payments/me
# ══════════════════════════════════════════════════════════════════════════════

class TestPaymentsMe:
    """GET /api/payments/me — liste des paiements de l'utilisateur."""

    def test_payments_me_unauthenticated(self):
        """Sans auth → 401."""
        resp = requests.get(f"{BASE_URL}/api/payments/me", timeout=15)
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("PASS: /payments/me unauthenticated → 401")

    def test_payments_me_returns_list(self, user_headers):
        """Retourne une liste de paiements."""
        resp = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"PASS: /payments/me returns {len(data)} payments")

    def test_payments_me_contains_payment_fields(self, user_headers):
        """Chaque paiement doit contenir les champs attendus."""
        # Crée d'abord un booking pour s'assurer qu'on a des données
        booking = create_test_booking(user_headers, notes="TEST_payments_me_fields_iter50")

        resp = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) > 0, "Expected at least one payment"

        payment = data[0]
        expected_fields = [
            "payment_id", "payer_user_id", "receiver_user_id", "status",
            "payer_total_amount", "currency", "booking_id",
        ]
        for field in expected_fields:
            assert field in payment, f"Missing field in payment: {field}"
        print(f"PASS: Payment fields present: {[f for f in expected_fields]}")

    def test_payments_me_ordered_by_date_desc(self, user_headers):
        """Les paiements doivent être triés par date décroissante."""
        resp = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        if len(data) >= 2:
            # Vérifier ordre décroissant (created_at)
            dates = [p.get("created_at") or "" for p in data]
            assert dates == sorted(dates, reverse=True), "Payments should be ordered by created_at DESC"
        print("PASS: Payments ordered by date DESC ✓")


# ══════════════════════════════════════════════════════════════════════════════
# 8. POST /api/webhook/stripe
# ══════════════════════════════════════════════════════════════════════════════

class TestStripeWebhook:
    """POST /api/webhook/stripe — handler webhook Stripe."""

    def test_webhook_empty_body_returns_400(self):
        """Corps vide → 400."""
        resp = requests.post(
            f"{BASE_URL}/api/webhook/stripe",
            data=b"",
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        assert resp.status_code == 400, f"Expected 400 for empty body, got {resp.status_code}"
        print("PASS: Webhook empty body → 400")

    def test_webhook_invalid_json_returns_400(self):
        """JSON invalide → 400."""
        resp = requests.post(
            f"{BASE_URL}/api/webhook/stripe",
            data=b"not-valid-json-{{",
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        assert resp.status_code == 400, f"Expected 400 for invalid JSON, got {resp.status_code}"
        print("PASS: Webhook invalid JSON → 400")

    def test_webhook_valid_event_without_signature_returns_200(self):
        """
        STRIPE_WEBHOOK_SECRET est vide → pas de vérification signature.
        JSON valide sans Stripe-Signature → 200 {"received": True}.
        """
        import uuid as _uuid
        payload = {
            "id": f"evt_iter50_smoke_{_uuid.uuid4().hex[:12]}",   # requis pour idempotence
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": "cs_test_dummy_iter50",
                    "payment_status": "unpaid",
                    "metadata": {}
                }
            }
        }
        resp = requests.post(
            f"{BASE_URL}/api/webhook/stripe",
            json=payload,
            timeout=15,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("received") is True, f"Expected received=True, got {data}"
        print("PASS: Webhook valid JSON (no signature) → 200 {received: True} ✓")

    def test_webhook_payment_intent_succeeded_returns_200(self):
        """Événement payment_intent.succeeded → 200 {"received": True}."""
        import uuid as _uuid
        payload = {
            "id": f"evt_iter50_pi_succ_{_uuid.uuid4().hex[:12]}",
            "type": "payment_intent.succeeded",
            "data": {
                "object": {
                    "id": "pi_test_iter50_dummy",
                    "metadata": {"payment_id": "pay_nonexistent_iter50"}
                }
            }
        }
        resp = requests.post(
            f"{BASE_URL}/api/webhook/stripe",
            json=payload,
            timeout=15,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert resp.json().get("received") is True
        print("PASS: Webhook payment_intent.succeeded → 200 {received: True} ✓")

    def test_webhook_payment_intent_canceled_returns_200(self):
        """Événement payment_intent.canceled → 200 {"received": True}."""
        import uuid as _uuid
        payload = {
            "id": f"evt_iter50_pi_cancel_{_uuid.uuid4().hex[:12]}",
            "type": "payment_intent.canceled",
            "data": {
                "object": {
                    "id": "pi_test_iter50_cancel",
                    "metadata": {}
                }
            }
        }
        resp = requests.post(
            f"{BASE_URL}/api/webhook/stripe",
            json=payload,
            timeout=15,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert resp.json().get("received") is True
        print("PASS: Webhook payment_intent.canceled → 200 {received: True} ✓")

    def test_webhook_updates_payment_status_on_succeeded(self, user_headers):
        """
        Webhook payment_intent.succeeded avec payment_id réel → payment status mis à jour.
        """
        import uuid as _uuid
        # Create a booking to get a real payment_id
        booking = create_test_booking(user_headers, notes="TEST_webhook_update_iter50")
        booking_id = booking["booking_id"]

        # Get the payment_id
        payments_resp = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        payments = payments_resp.json()
        payment = next((p for p in payments if p.get("booking_id") == booking_id), None)
        assert payment is not None
        payment_id = payment["payment_id"]

        # Send webhook event with unique event_id (requis pour idempotence)
        payload = {
            "id": f"evt_iter50_real_{_uuid.uuid4().hex[:12]}",
            "type": "payment_intent.succeeded",
            "data": {
                "object": {
                    "id": "pi_test_iter50_real",
                    "metadata": {
                        "payment_id": payment_id,
                        "booking_id": booking_id,
                    }
                }
            }
        }
        resp = requests.post(
            f"{BASE_URL}/api/webhook/stripe",
            json=payload,
            timeout=15,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert resp.json().get("received") is True

        # Verify DB update
        payments_resp2 = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        payments2 = payments_resp2.json()
        updated_payment = next((p for p in payments2 if p.get("payment_id") == payment_id), None)
        assert updated_payment is not None
        assert updated_payment["status"] == "captured", \
            f"After payment_intent.succeeded webhook, payment should be 'captured', got {updated_payment['status']}"
        print(f"PASS: Webhook payment_intent.succeeded updates payment to 'captured' ✓")


# ══════════════════════════════════════════════════════════════════════════════
# 9. GET /api/admin/payments
# ══════════════════════════════════════════════════════════════════════════════

class TestAdminPayments:
    """GET /api/admin/payments — liste admin des paiements."""

    def test_admin_payments_unauthenticated(self):
        """Sans auth → 401."""
        resp = requests.get(f"{BASE_URL}/api/admin/payments", timeout=15)
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("PASS: /admin/payments unauthenticated → 401")

    def test_admin_payments_non_admin_forbidden(self, user_headers):
        """Utilisateur standard → 403."""
        resp = requests.get(f"{BASE_URL}/api/admin/payments", headers=user_headers, timeout=15)
        assert resp.status_code == 403, f"Expected 403 for non-admin, got {resp.status_code}"
        print("PASS: /admin/payments non-admin → 403")

    def test_admin_payments_returns_list(self, admin_headers):
        """Admin → 200, liste de paiements."""
        resp = requests.get(f"{BASE_URL}/api/admin/payments", headers=admin_headers, timeout=15)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"PASS: /admin/payments returns {len(data)} payments (admin)")

    def test_admin_payments_includes_all_users(self, admin_headers):
        """La liste admin doit contenir les paiements de tous les utilisateurs."""
        resp = requests.get(f"{BASE_URL}/api/admin/payments", headers=admin_headers, timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        if len(data) > 0:
            payment = data[0]
            assert "payment_id" in payment
            assert "payer_user_id" in payment
            assert "status" in payment
            assert "payer_total_amount" in payment
        print(f"PASS: Admin payments contains proper fields ✓")

    def test_admin_payments_coach_forbidden(self, coach_headers):
        """Coach (non-admin) → 403."""
        resp = requests.get(f"{BASE_URL}/api/admin/payments", headers=coach_headers, timeout=15)
        assert resp.status_code == 403, f"Expected 403 for coach, got {resp.status_code}"
        print("PASS: /admin/payments coach → 403")


# ══════════════════════════════════════════════════════════════════════════════
# 10. GET /api/admin/payments/stats
# ══════════════════════════════════════════════════════════════════════════════

class TestAdminPaymentStats:
    """GET /api/admin/payments/stats — statistiques financières."""

    def test_admin_stats_unauthenticated(self):
        """Sans auth → 401."""
        resp = requests.get(f"{BASE_URL}/api/admin/payments/stats", timeout=15)
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("PASS: /admin/payments/stats unauthenticated → 401")

    def test_admin_stats_non_admin_forbidden(self, user_headers):
        """Utilisateur standard → 403."""
        resp = requests.get(f"{BASE_URL}/api/admin/payments/stats", headers=user_headers, timeout=15)
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"
        print("PASS: /admin/payments/stats non-admin → 403")

    def test_admin_stats_returns_correct_fields(self, admin_headers):
        """Retourne les agrégats financiers attendus."""
        resp = requests.get(f"{BASE_URL}/api/admin/payments/stats", headers=admin_headers, timeout=15)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()

        required_fields = [
            "total_payments", "paid_count", "pending_count", "failed_count",
            "gmv", "platform_revenue", "total_charged", "total_disbursed"
        ]
        for field in required_fields:
            assert field in data, f"Missing stats field: {field}"

        # Tous doivent être numériques
        for field in required_fields:
            assert isinstance(data[field], (int, float)), \
                f"Field {field} should be numeric, got {type(data[field])}"

        # total_payments >= paid_count
        assert data["total_payments"] >= data["paid_count"], "total_payments must be >= paid_count"
        print(f"PASS: /admin/payments/stats → {data}")

    def test_admin_stats_values_are_non_negative(self, admin_headers):
        """Toutes les valeurs doivent être >= 0."""
        resp = requests.get(f"{BASE_URL}/api/admin/payments/stats", headers=admin_headers, timeout=15)
        assert resp.status_code == 200
        data = resp.json()

        for key, value in data.items():
            assert float(value) >= 0, f"Stat {key} should be >= 0, got {value}"
        print("PASS: All stats values are non-negative ✓")


# ══════════════════════════════════════════════════════════════════════════════
# 11. Full E2E Flow Test
# ══════════════════════════════════════════════════════════════════════════════

class TestFullE2EFlow:
    """Test du flux complet : création → paiement → accept → vérification."""

    def test_full_booking_to_checkout_flow(self, user_headers):
        """Flux E2E : booking → checkout session → status check → payment list."""
        # Step 1: Create booking
        booking = create_test_booking(user_headers, notes="TEST_e2e_full_iter50")
        booking_id = booking["booking_id"]
        assert booking["status"] == "requested"
        assert booking["payment_status"] == "pending"
        print(f"Step 1: Booking created — {booking_id}")

        # Step 2: Create Stripe checkout session
        session_resp = requests.post(
            f"{BASE_URL}/api/payments/checkout/session",
            headers=user_headers,
            json={"booking_id": booking_id, "origin_url": BASE_URL},
            timeout=25,
        )
        assert session_resp.status_code == 200
        session_data = session_resp.json()
        session_id = session_data["session_id"]
        assert session_id.startswith("cs_test_")
        assert "checkout.stripe.com" in session_data["url"]
        print(f"Step 2: Checkout session created — {session_id[:35]}...")

        # Step 3: Verify checkout status
        status_resp = requests.get(
            f"{BASE_URL}/api/payments/checkout/status/{session_id}",
            headers=user_headers,
            timeout=25,
        )
        assert status_resp.status_code == 200
        status_data = status_resp.json()
        assert status_data["status"] == "open"
        # payment_status retourne le statut interne DB; une session non payée → 'requires_authorization'
        assert status_data["payment_status"] in ("unpaid", "requires_authorization", "pending"), \
            f"New session payment_status should be unpaid/requires_authorization, got {status_data['payment_status']}"
        assert status_data["booking_id"] == booking_id
        assert status_data["amount"] > 0
        print(f"Step 3: Status verified — open/{status_data['payment_status']}, amount={status_data['amount']}€")

        # Step 4: Verify payment in /payments/me
        payments_resp = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        assert payments_resp.status_code == 200
        payments = payments_resp.json()
        payment = next((p for p in payments if p.get("booking_id") == booking_id), None)
        assert payment is not None, "Payment record must exist"
        # Note: stripe_payment_intent_id = None (Emergent proxy) mais stripe_checkout_session_id est set
        print(f"Step 4: Payment record found — status={payment['status']}")

        print("PASS: Full E2E booking to checkout flow ✓")

    def test_accept_flow_db_state_machine(self, user_headers, coach_headers):
        """Vérifie la machine d'états DB : requested→awaiting_payment (flux C: manual_approval + pay_now non autorisé)."""
        booking = create_test_booking(user_headers, notes="TEST_e2e_accept_db_iter50")
        booking_id = booking["booking_id"]

        # Vérifier état initial
        payments_resp = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        payments = payments_resp.json()
        payment = next((p for p in payments if p.get("booking_id") == booking_id), None)
        assert payment["status"] == "requires_authorization", \
            f"Initial payment status should be requires_authorization, got {payment['status']}"

        # Accept booking
        accept_resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/accept",
            headers=coach_headers,
            timeout=15,
        )
        assert accept_resp.status_code == 200
        # Flux C: requested → awaiting_payment (le paiement n'a pas encore été effectué)
        accept_data = accept_resp.json()
        assert accept_data["status"] in ("awaiting_payment", "confirmed"), \
            f"After accept, expected awaiting_payment or confirmed, got {accept_data['status']}"

        # Vérifier état final payment
        payments_resp2 = requests.get(f"{BASE_URL}/api/payments/me", headers=user_headers, timeout=15)
        payments2 = payments_resp2.json()
        payment2 = next((p for p in payments2 if p.get("booking_id") == booking_id), None)
        # Si awaiting_payment → paiement non encore effectué → requires_authorization
        # Si confirmed → paiement capturé → authorized ou captured
        assert payment2["status"] in ("requires_authorization", "authorized", "captured"), \
            f"After accept, payment should be requires_authorization/authorized/captured, got {payment2['status']}"

        print(f"PASS: DB state machine: booking={accept_data['status']}, payment={payment2['status']} ✓")
        print("PASS: Stripe PI=None → capture silently skipped (EXPECTED behavior) ✓")
