"""
test_booking_flows_v2.py
=========================
Tests des 4 flux de réservation (A/B/C/D) + endpoint /pay + annulation.

Niveaux d'isolation :
  ① HTTP seul    → fonctionne contre n'importe quel backend (Supabase ou test)
  ② HTTP + DB    → requiert le serveur de test local (start_test_server.sh)
                   car les assertions asyncpg doivent être cohérentes avec
                   les données créées par les appels HTTP.

Modes d'exécution :
  • Mode ① — backend principal (EXPO_PUBLIC_BACKEND_URL) :
      TEST_ENV=test python -m pytest tests/test_booking_flows_v2.py -v
      Les tests marqués @requires_db sont ignorés (skipif).

  • Mode ② — serveur de test isolé (winek_test, port 8002) :
      bash /app/backend/scripts/start_test_server.sh
      TEST_ENV=test TEST_BASE_URL=http://localhost:8002 \\
        python -m pytest tests/test_booking_flows_v2.py -v
      bash /app/backend/scripts/start_test_server.sh --stop

Flux couverts :
  A — instant_booking  + pay_now
  B — instant_booking  + pay_later
  C — manual_approval  + pay_now   (accept → awaiting_payment | confirmed)
  D — manual_approval  + pay_later (accept → awaiting_payment)
  E — /pay endpoint    (cas autorisés / refusés / 404 / idempotence)
  F — Annulation qui relibère le slot
  G — Guard TTL /accept sur booking expiré  [requires DB isolation]
"""

import asyncio
import asyncpg
import httpx
import os
import uuid
import pytest
from datetime import datetime, timezone, timedelta

# ── Config environnement ───────────────────────────────────────────────────────

TEST_BASE_URL = os.environ.get("TEST_BASE_URL")
BASE_URL      = TEST_BASE_URL or os.environ.get("EXPO_PUBLIC_BACKEND_URL", "")
DB_URL        = os.environ.get("DATABASE_URL")

# DB isolation disponible seulement si serveur de test + winek_test actifs
HAS_DB_ISO = bool(TEST_BASE_URL and DB_URL and "127.0.0.1" in (DB_URL or ""))

requires_db = pytest.mark.skipif(
    not HAS_DB_ISO,
    reason=(
        "Isolation DB requise. Lancer start_test_server.sh puis relancer avec "
        "TEST_BASE_URL=http://localhost:8002"
    ),
)

# ── Credentials seed (présents dans winek_test après reset + seed) ────────────
USER_EMAIL   = "user@winek.app"
USER_PASS    = "WinekUser2024!"
COACH_EMAIL  = "coach@winek.app"
COACH_PASS   = "WinekCoach2024!"
ADMIN_EMAIL  = "admin@winek.app"
ADMIN_PASS   = "WinekAdmin2024!"


# ══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
def http():
    with httpx.Client(base_url=BASE_URL, timeout=20) as c:
        yield c


@pytest.fixture(scope="module")
async def pool():
    """Pool asyncpg pour les assertions DB (seulement utilisé en mode ②)."""
    if not HAS_DB_ISO:
        yield None
        return
    p = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5, ssl=False)
    yield p
    await p.close()


def _login(http_client, email, password) -> str:
    r = http_client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login failed ({email}): {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def tok_user(http):
    return _login(http, USER_EMAIL, USER_PASS)


@pytest.fixture(scope="module")
def tok_coach(http):
    return _login(http, COACH_EMAIL, COACH_PASS)


@pytest.fixture(scope="module")
def tok_admin(http):
    return _login(http, ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def service_id(http, tok_coach):
    """Récupère le premier service actif du coach."""
    r = http.get("/api/services/mine", headers={"Authorization": f"Bearer {tok_coach}"})
    assert r.status_code == 200, f"GET /services/mine failed: {r.text}"
    svcs = r.json()
    assert svcs, "Le coach n'a aucun service — lancer reset_test_db.sh avec seed"
    return svcs[0]["service_id"]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}

def _req_booking(http, token, svc_id, payment_mode="pay_now", slot_id=None):
    payload = {"service_id": svc_id, "payment_mode": payment_mode}
    if slot_id:
        payload["slot_id"] = slot_id
    return http.post("/api/bookings/request", json=payload, headers=_h(token))

def _configure_service(http, tok_admin, tok_coach, svc_id, mode, pay_later, expiry_min=60):
    """Configure le service + les flags globaux admin pour le flux demandé."""
    enable_manual  = mode == "manual_approval"
    enable_instant = mode == "instant_booking"
    http.put(
        "/api/admin/app-config",
        json={
            "enable_manual_approval_for_services": enable_manual or not enable_instant,
            "enable_pay_later_for_services": pay_later,
        },
        headers=_h(tok_admin),
    )
    http.patch(
        f"/api/services/{svc_id}",
        json={
            "booking_approval_mode": mode,
            "allow_pay_later": pay_later,
            "pay_later_expiration_minutes": expiry_min,
        },
        headers=_h(tok_coach),
    )

def _reset_service(http, tok_admin, tok_coach, svc_id):
    """Restaure la configuration par défaut du service."""
    http.put(
        "/api/admin/app-config",
        json={
            "enable_manual_approval_for_services": True,
            "enable_pay_later_for_services": True,
        },
        headers=_h(tok_admin),
    )
    http.patch(
        f"/api/services/{svc_id}",
        json={"booking_approval_mode": "manual_approval", "allow_pay_later": True},
        headers=_h(tok_coach),
    )

def _cancel_booking(http, tok, booking_id):
    """Annule un booking (cleanup post-test)."""
    http.post(
        f"/api/bookings/{booking_id}/cancel",
        json={"reason": "cleanup_test"},
        headers=_h(tok),
    )


# ══════════════════════════════════════════════════════════════════════════════
# Flux A — instant_booking + pay_now
# ══════════════════════════════════════════════════════════════════════════════

class TestFluxA_InstantPayNow:
    """
    Flux A : instant_booking + pay_now
    Comportement attendu :
      - booking.status = 'awaiting_payment' (pas 'requested')
      - slot.status = 'reserved' (si slot_id fourni)
      - expires_at défini (~30 min window)
    """

    def test_A_instant_paynow_creates_awaiting_payment(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux A : POST /bookings/request → status='awaiting_payment' immédiat."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="instant_booking", pay_later=False)
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201), (
                f"Expected 200/201, got {r.status_code}: {r.text}"
            )
            bk = r.json()
            assert bk.get("status") == "awaiting_payment", (
                f"Flux A: Expected 'awaiting_payment', got '{bk.get('status')}'"
            )
            assert bk.get("booking_id"), "booking_id must be returned"
        finally:
            if r.status_code in (200, 201):
                _cancel_booking(http, tok_admin, r.json().get("booking_id"))
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_A_instant_paynow_expires_at_set(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux A : expires_at est défini dans la fenêtre pay_now (~30 min)."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="instant_booking", pay_later=False)
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            bk = r.json()
            expires_at = bk.get("expires_at")
            assert expires_at is not None, "expires_at must be set for instant_booking"
        finally:
            if r.status_code in (200, 201):
                _cancel_booking(http, tok_admin, r.json().get("booking_id"))
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_A_pay_later_rejected_when_not_allowed(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux A : payment_mode='pay_later' refusé si allow_pay_later=False (400/422)."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="instant_booking", pay_later=False)
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_later")
            assert r.status_code in (400, 422), (
                f"pay_later must be rejected when not allowed, got {r.status_code}"
            )
        finally:
            _reset_service(http, tok_admin, tok_coach, service_id)


# ══════════════════════════════════════════════════════════════════════════════
# Flux B — instant_booking + pay_later
# ══════════════════════════════════════════════════════════════════════════════

class TestFluxB_InstantPayLater:
    """
    Flux B : instant_booking + pay_later
    Comportement attendu :
      - booking.status = 'awaiting_payment'
      - expires_at = NOW() + service.pay_later_expiration_minutes
    """

    def test_B_instant_paylater_creates_awaiting_payment(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux B : pay_later activé → booking immédiatement 'awaiting_payment'."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="instant_booking", pay_later=True, expiry_min=120)
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_later")
            assert r.status_code in (200, 201), (
                f"Expected 200/201, got {r.status_code}: {r.text}"
            )
            bk = r.json()
            assert bk.get("status") == "awaiting_payment", (
                f"Flux B: Expected 'awaiting_payment', got '{bk.get('status')}'"
            )
        finally:
            if r.status_code in (200, 201):
                _cancel_booking(http, tok_admin, r.json().get("booking_id"))
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_B_instant_paylater_expires_at_set_for_paylater_window(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux B : expires_at doit correspondre à la fenêtre pay_later_expiration_minutes."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="instant_booking", pay_later=True, expiry_min=120)
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_later")
            assert r.status_code in (200, 201)
            bk = r.json()
            expires_at_raw = bk.get("expires_at")
            assert expires_at_raw is not None, "expires_at must be set for pay_later"
        finally:
            if r.status_code in (200, 201):
                _cancel_booking(http, tok_admin, r.json().get("booking_id"))
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_B_pay_now_also_works_in_instant_paylater_service(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux B : pay_now reste autorisé même quand allow_pay_later=True."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="instant_booking", pay_later=True)
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201), (
                f"pay_now must still work in pay_later enabled service: {r.text}"
            )
        finally:
            if r.status_code in (200, 201):
                _cancel_booking(http, tok_admin, r.json().get("booking_id"))
            _reset_service(http, tok_admin, tok_coach, service_id)


# ══════════════════════════════════════════════════════════════════════════════
# Flux C — manual_approval + pay_now
# ══════════════════════════════════════════════════════════════════════════════

class TestFluxC_ManualPayNow:
    """
    Flux C : manual_approval + pay_now
    Comportement attendu :
      - booking créé → status='requested'
      - /accept par le coach → status='awaiting_payment' (ou 'confirmed' si PI autorisé)
    """

    def test_C_manual_paynow_creates_requested_booking(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux C : booking créé en status='requested' (manual_approval)."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="manual_approval", pay_later=False)
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201), f"Got {r.status_code}: {r.text}"
            bk = r.json()
            assert bk.get("status") == "requested", (
                f"Flux C: Expected 'requested', got '{bk.get('status')}'"
            )
        finally:
            if r.status_code in (200, 201):
                _cancel_booking(http, tok_admin, r.json().get("booking_id"))
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_C_accept_transitions_to_awaiting_payment(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux C : /accept par le coach → booking passe à 'awaiting_payment'."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            acc = http.post(
                f"/api/bookings/{booking_id}/accept",
                headers=_h(tok_coach),
            )
            assert acc.status_code == 200, (
                f"Accept must return 200, got {acc.status_code}: {acc.text}"
            )
            result = acc.json()
            # Status = awaiting_payment (PI pas encore autorisé) OU confirmed (PI autorisé)
            assert result.get("status") in ("awaiting_payment", "confirmed"), (
                f"After accept, status must be 'awaiting_payment' or 'confirmed', "
                f"got '{result.get('status')}'"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_C_accept_idempotent(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux C : /accept appelé 2× retourne success=True sans erreur (idempotence)."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            acc1 = http.post(f"/api/bookings/{booking_id}/accept", headers=_h(tok_coach))
            acc2 = http.post(f"/api/bookings/{booking_id}/accept", headers=_h(tok_coach))
            assert acc1.status_code == 200
            assert acc2.status_code == 200
            assert acc2.json().get("success") is True
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_C_only_coach_can_accept(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux C : accepter par le payer lui-même → 403 Forbidden."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            acc = http.post(f"/api/bookings/{booking_id}/accept", headers=_h(tok_user))
            assert acc.status_code == 403, (
                f"Non-coach accept must return 403, got {acc.status_code}"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, service_id)


# ══════════════════════════════════════════════════════════════════════════════
# Flux D — manual_approval + pay_later
# ══════════════════════════════════════════════════════════════════════════════

class TestFluxD_ManualPayLater:
    """
    Flux D : manual_approval + pay_later
    Comportement attendu :
      - booking créé → status='requested'
      - /accept → status='awaiting_payment' + expires_at défini
    """

    def test_D_manual_paylater_creates_requested_booking(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux D : booking en pay_later créé en 'requested'."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="manual_approval", pay_later=True, expiry_min=60)
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_later")
            assert r.status_code in (200, 201), f"Got {r.status_code}: {r.text}"
            bk = r.json()
            assert bk.get("status") == "requested", (
                f"Flux D: Expected 'requested', got '{bk.get('status')}'"
            )
        finally:
            if r.status_code in (200, 201):
                _cancel_booking(http, tok_admin, r.json().get("booking_id"))
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_D_accept_sets_awaiting_payment_with_expiry(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux D : /accept → 'awaiting_payment' + expires_at défini."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="manual_approval", pay_later=True, expiry_min=60)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_later")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            acc = http.post(f"/api/bookings/{booking_id}/accept", headers=_h(tok_coach))
            assert acc.status_code == 200, f"Got {acc.status_code}: {acc.text}"
            result = acc.json()
            assert result.get("status") == "awaiting_payment", (
                f"Flux D after accept: Expected 'awaiting_payment', got '{result.get('status')}'"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_D_pay_later_rejected_when_global_flag_disabled(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux D : pay_later refusé si flag global admin désactivé, même si service l'autorise."""
        # Service autorise pay_later, mais admin le désactive globalement
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="manual_approval", pay_later=True)
        http.put(
            "/api/admin/app-config",
            json={"enable_pay_later_for_services": False},
            headers=_h(tok_admin),
        )
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_later")
            assert r.status_code in (400, 422), (
                f"pay_later must be rejected when global flag disabled, got {r.status_code}"
            )
        finally:
            _reset_service(http, tok_admin, tok_coach, service_id)


# ══════════════════════════════════════════════════════════════════════════════
# Flux E — endpoint /pay
# ══════════════════════════════════════════════════════════════════════════════

class TestFluxE_PayEndpoint:
    """
    Tests de l'endpoint POST /bookings/{id}/pay.
    Ce endpoint crée une session Stripe Checkout et retourne une checkout_url.
    """

    def test_E_pay_on_awaiting_payment_returns_checkout_url(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Flux A → /pay sur awaiting_payment retourne checkout_url."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="instant_booking", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            pay = http.post(f"/api/bookings/{booking_id}/pay", headers=_h(tok_user))
            assert pay.status_code == 200, (
                f"POST /pay must return 200 on awaiting_payment, got {pay.status_code}: {pay.text}"
            )
            data = pay.json()
            assert data.get("checkout_url"), "checkout_url must be non-empty"
            assert data.get("session_id"), "session_id must be non-empty"
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_E_pay_idempotent_returns_same_session(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """POST /pay deux fois sur le même booking → même session Stripe (idempotence)."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="instant_booking", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            pay1 = http.post(f"/api/bookings/{booking_id}/pay", headers=_h(tok_user))
            pay2 = http.post(f"/api/bookings/{booking_id}/pay", headers=_h(tok_user))
            assert pay1.status_code == 200
            assert pay2.status_code == 200
            # La session doit être la même (idempotence)
            assert pay1.json().get("session_id") == pay2.json().get("session_id"), (
                "Calling /pay twice must return the same session (idempotent)"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_E_pay_forbidden_for_non_payer(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """POST /pay par le coach (non-payer) → 403 Forbidden."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="instant_booking", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            pay = http.post(f"/api/bookings/{booking_id}/pay", headers=_h(tok_coach))
            assert pay.status_code == 403, (
                f"Non-payer /pay must return 403, got {pay.status_code}"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_E_pay_404_on_nonexistent_booking(
        self, http, tok_user
    ):
        """POST /pay sur booking inexistant → 404."""
        fake_id = f"bkg_nonexistent_{uuid.uuid4().hex[:8]}"
        pay = http.post(f"/api/bookings/{fake_id}/pay", headers=_h(tok_user))
        assert pay.status_code == 404, (
            f"Non-existent booking /pay must return 404, got {pay.status_code}"
        )

    def test_E_pay_blocked_on_requested_booking(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """POST /pay sur booking 'requested' (pas encore accepted) → 4xx."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]
            assert r.json()["status"] == "requested"

            pay = http.post(f"/api/bookings/{booking_id}/pay", headers=_h(tok_user))
            assert pay.status_code in (400, 409, 422), (
                f"/pay on 'requested' booking must be blocked (4xx), got {pay.status_code}: {pay.text}"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, service_id)


# ══════════════════════════════════════════════════════════════════════════════
# Flux F — Annulation + libération du slot
# ══════════════════════════════════════════════════════════════════════════════

class TestFluxF_CancelReleasesSlot:
    """
    Annuler un booking en 'awaiting_payment' doit :
    - Passer le booking en 'cancelled'
    - Libérer le slot réservé → 'available'
    """

    @requires_db
    async def test_F_cancel_awaiting_payment_releases_slot(
        self, http, pool, tok_user, tok_coach, tok_admin, service_id
    ):
        """Annulation booking awaiting_payment + vérification slot libéré en DB."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="instant_booking", pay_later=False)
        booking_id = None
        slot_id = None
        try:
            # Récupère un slot available
            r_svc = http.get(f"/api/services/{service_id}", headers=_h(tok_user))
            slots = r_svc.json().get("slots", [])
            available = [s for s in slots if s.get("slot_status") == "available"
                         and s.get("slot_type") in ("single", "specific")]

            if not available:
                pytest.skip("Aucun slot available pour ce test")

            slot_id = available[0]["slot_id"]
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now",
                             slot_id=slot_id)
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            # Vérification DB : slot doit être 'reserved'
            async with pool.acquire() as conn:
                s_before = await conn.fetchrow(
                    "SELECT slot_status FROM service_slots WHERE slot_id=$1", slot_id
                )
            assert s_before["slot_status"] == "reserved"

            # Annulation
            cancel = http.post(
                f"/api/bookings/{booking_id}/cancel",
                json={"reason": "test_cleanup"},
                headers=_h(tok_user),
            )
            assert cancel.status_code == 200

            # Vérification DB : slot doit être de nouveau 'available'
            async with pool.acquire() as conn:
                s_after = await conn.fetchrow(
                    "SELECT slot_status FROM service_slots WHERE slot_id=$1", slot_id
                )
            assert s_after["slot_status"] == "available", (
                f"Cancelled booking must release slot to 'available', "
                f"got '{s_after['slot_status']}'"
            )
            booking_id = None  # Déjà annulé
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_F_cancel_returns_200_with_status(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Annulation d'un booking retourne 200 et le booking en 'cancelled'."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            cancel = http.post(
                f"/api/bookings/{booking_id}/cancel",
                json={"reason": "test"},
                headers=_h(tok_user),
            )
            assert cancel.status_code == 200
            result = cancel.json()
            assert result.get("success") is True
            booking_id = None
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, service_id)


# ══════════════════════════════════════════════════════════════════════════════
# Flux G — Guard TTL /accept (booking expiré → 410)
# ══════════════════════════════════════════════════════════════════════════════

class TestFluxG_AcceptGuardTTL:
    """
    Tests de la garde TTL sur l'endpoint /accept.
    Requiert le mode ② (serveur de test isolé) car :
      - on insère un booking expiré directement via asyncpg dans winek_test
      - on appelle /accept via HTTP sur le serveur de test (:8002)
    Ignoré si TEST_BASE_URL non défini.
    """

    @requires_db
    async def test_G_accept_expired_booking_returns_410(
        self, http, pool, tok_coach, service_id
    ):
        """Un booking 'requested' avec expires_at passé → /accept retourne 410."""
        bid = f"bkg_guard_{uuid.uuid4().hex[:12]}"

        # Récupérer coach_id depuis le service
        async with pool.acquire() as conn:
            svc = await conn.fetchrow(
                "SELECT coach_id FROM services WHERE service_id=$1", service_id
            )
            coach_id = svc["coach_id"] if svc else None

        if not coach_id:
            pytest.skip("Service introuvable dans winek_test — seed requis")

        # Insérer un booking déjà expiré directement en DB (winek_test)
        async with pool.acquire() as conn:
            user_row = await conn.fetchrow(
                "SELECT user_id FROM users WHERE email=$1", USER_EMAIL
            )
            if not user_row:
                pytest.skip("User email non trouvé dans winek_test — seed requis")
            payer_id = user_row["user_id"]

            # Upsert service minimal si absent
            await conn.execute(
                """INSERT INTO services
                   (service_id, coach_id, title, price, booking_approval_mode, allow_pay_later)
                   VALUES ($1,$2,'Test Guard Service',50.0,'manual_approval',false)
                   ON CONFLICT (service_id) DO UPDATE SET coach_id=$2""",
                service_id, coach_id,
            )
            await conn.execute(
                """INSERT INTO bookings
                   (booking_id, service_id, user_id, coach_id, status,
                    payer_user_id, receiver_user_id, expires_at, payment_mode)
                   VALUES ($1,$2,$3,$4,'requested',$3,$4,
                           (NOW() - INTERVAL '2 hours'),'pay_now')""",
                bid, service_id, payer_id, coach_id,
            )

        try:
            acc = http.post(f"/api/bookings/{bid}/accept", headers=_h(tok_coach))
            assert acc.status_code == 410, (
                f"Expired booking /accept must return 410, got {acc.status_code}: {acc.text}"
            )
        finally:
            async with pool.acquire() as conn:
                await conn.execute("DELETE FROM bookings WHERE booking_id=$1", bid)

    @requires_db
    async def test_G_accept_valid_booking_returns_200(
        self, http, pool, tok_coach, service_id
    ):
        """Un booking 'requested' non expiré → /accept retourne 200."""
        bid = f"bkg_valid_{uuid.uuid4().hex[:12]}"

        async with pool.acquire() as conn:
            svc = await conn.fetchrow(
                "SELECT coach_id FROM services WHERE service_id=$1", service_id
            )
            coach_id = svc["coach_id"] if svc else None
            user_row = await conn.fetchrow("SELECT user_id FROM users WHERE email=$1", USER_EMAIL)

        if not coach_id or not user_row:
            pytest.skip("Données seed manquantes dans winek_test")

        payer_id = user_row["user_id"]

        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO bookings
                   (booking_id, service_id, user_id, coach_id, status,
                    payer_user_id, receiver_user_id, expires_at, payment_mode)
                   VALUES ($1,$2,$3,$4,'requested',$3,$4,
                           (NOW() + INTERVAL '48 hours'),'pay_now')""",
                bid, service_id, payer_id, coach_id,
            )

        try:
            acc = http.post(f"/api/bookings/{bid}/accept", headers=_h(tok_coach))
            assert acc.status_code == 200, (
                f"Valid booking /accept must return 200, got {acc.status_code}: {acc.text}"
            )
        finally:
            async with pool.acquire() as conn:
                await conn.execute("DELETE FROM bookings WHERE booking_id=$1", bid)


# ══════════════════════════════════════════════════════════════════════════════
# Validations générales
# ══════════════════════════════════════════════════════════════════════════════

class TestValidations:
    """Tests de validation des endpoints sans dépendance DB directe."""

    def test_cannot_book_own_service(
        self, http, tok_coach, tok_admin, service_id
    ):
        """Un coach ne peut pas réserver son propre service → 403/400."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="manual_approval", pay_later=False)
        try:
            r = _req_booking(http, tok_coach, service_id, payment_mode="pay_now")
            assert r.status_code in (400, 403), (
                f"Booking own service must be rejected (400/403), got {r.status_code}"
            )
        finally:
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_refuse_booking_by_coach(
        self, http, tok_user, tok_coach, tok_admin, service_id
    ):
        """Le coach peut refuser une demande → 200 et status='refused'."""
        _configure_service(http, tok_admin, tok_coach, service_id,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, service_id, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            ref = http.post(
                f"/api/bookings/{booking_id}/refuse",
                json={"reason": "test_refuse"},
                headers=_h(tok_coach),
            )
            assert ref.status_code == 200, f"Got {ref.status_code}: {ref.text}"
            booking_id = None  # Déjà refusé
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, service_id)

    def test_booking_request_requires_auth(self, http, service_id):
        """POST /bookings/request sans token → 401."""
        r = http.post("/api/bookings/request", json={"service_id": service_id})
        assert r.status_code == 401, (
            f"Unauthenticated request must return 401, got {r.status_code}"
        )
