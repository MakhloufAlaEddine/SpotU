"""
test_booking_business_rules_v2.py
====================================
Tests des règles métier, validations de champs obligatoires et transitions
d'état pour le workflow de réservation SpotU.

Couvre :
  - Validation des champs requis (service_id, payment_mode)
  - Règles d'autorisation (403 non autorisé, 401 non authentifié)
  - Machine d'états : transitions invalides (cancel/refuse sur mauvais états)
  - Idempotence explicite (idempotency_key)
  - Champs de réponse obligatoires (booking_id, status, expires_at, pricing_snapshot)
  - Règle du pricing engine (amount = prix du service)
  - Guard /pay sur booking expiré → 410
  - Cancel par un tiers non autorisé → 403
  - Refuse idempotent → 200

Niveaux d'isolation :
  ① HTTP seul   — fonctionne contre n'importe quel backend
  ② HTTP + DB   — requiert le serveur de test isolé (start_test_server.sh)

Exécution recommandée (mode ②) :
  bash /app/backend/scripts/start_test_server.sh
  TEST_ENV=test TEST_BASE_URL=http://localhost:8002 \\
    DATABASE_URL="postgresql://winek_test:WinekTest2024!@127.0.0.1:5432/winek_test" \\
    python -m pytest tests/test_booking_business_rules_v2.py -v
  bash /app/backend/scripts/start_test_server.sh --stop
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

HAS_DB_ISO = bool(TEST_BASE_URL and DB_URL and "127.0.0.1" in (DB_URL or ""))

requires_db = pytest.mark.skipif(
    not HAS_DB_ISO,
    reason=(
        "Isolation DB requise. Lancer start_test_server.sh puis relancer avec "
        "TEST_BASE_URL=http://localhost:8002 DATABASE_URL=...winek_test..."
    ),
)

# ── Credentials (seed winek_test) ─────────────────────────────────────────────
USER_EMAIL  = "user@winek.app"
USER_PASS   = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"
ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS  = "WinekAdmin2024!"

SVC_DEMO    = "svc_demo001"    # service du coach@winek.app (user_coach001)


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
    assert r.status_code == 200, f"Login échoué ({email}): {r.text}"
    return r.json()["token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _req_booking(http, token, svc_id, payment_mode="pay_now", slot_id=None):
    payload = {"service_id": svc_id, "payment_mode": payment_mode}
    if slot_id:
        payload["slot_id"] = slot_id
    return http.post("/api/bookings/request", json=payload, headers=_h(token))


def _configure_service(http, tok_admin, tok_coach, svc_id, mode, pay_later):
    enable_manual = mode == "manual_approval"
    http.put(
        "/api/admin/app-config",
        json={
            "enable_manual_approval_for_services": enable_manual,
            "enable_pay_later_for_services": pay_later,
        },
        headers=_h(tok_admin),
    )
    http.patch(
        f"/api/services/{svc_id}",
        json={"booking_approval_mode": mode, "allow_pay_later": pay_later},
        headers=_h(tok_coach),
    )


def _reset_service(http, tok_admin, tok_coach, svc_id):
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
    http.post(
        f"/api/bookings/{booking_id}/cancel",
        json={"reason": "cleanup_test"},
        headers=_h(tok),
    )


@pytest.fixture(scope="module")
def tok_user(http):
    return _login(http, USER_EMAIL, USER_PASS)


@pytest.fixture(scope="module")
def tok_coach(http):
    return _login(http, COACH_EMAIL, COACH_PASS)


@pytest.fixture(scope="module")
def tok_admin(http):
    return _login(http, ADMIN_EMAIL, ADMIN_PASS)


# ══════════════════════════════════════════════════════════════════════════════
# Règle 1 — Validation des champs obligatoires
# ══════════════════════════════════════════════════════════════════════════════

class TestRequiredFields:
    """
    Vérifie que l'API rejette correctement les requêtes invalides.
    Aucune isolation DB requise.
    """

    def test_service_id_missing_returns_422(self, http, tok_user):
        """POST /bookings/request sans service_id → 422 (FastAPI validation)."""
        r = http.post(
            "/api/bookings/request",
            json={"payment_mode": "pay_now"},
            headers=_h(tok_user),
        )
        assert r.status_code == 422, (
            f"service_id manquant doit retourner 422, got {r.status_code}"
        )

    def test_invalid_payment_mode_returns_400(self, http, tok_user):
        """POST /bookings/request avec payment_mode invalide → 400."""
        r = http.post(
            "/api/bookings/request",
            json={"service_id": SVC_DEMO, "payment_mode": "bank_transfer"},
            headers=_h(tok_user),
        )
        assert r.status_code == 400, (
            f"payment_mode invalide doit retourner 400, got {r.status_code}: {r.text}"
        )

    def test_nonexistent_service_returns_404(self, http, tok_user):
        """POST /bookings/request avec service_id inexistant → 404."""
        r = http.post(
            "/api/bookings/request",
            json={"service_id": "svc_nonexistent_xyz", "payment_mode": "pay_now"},
            headers=_h(tok_user),
        )
        assert r.status_code == 404, (
            f"Service inexistant doit retourner 404, got {r.status_code}"
        )

    def test_booking_request_without_auth_returns_401(self, http):
        """POST /bookings/request sans token → 401."""
        r = http.post(
            "/api/bookings/request",
            json={"service_id": SVC_DEMO, "payment_mode": "pay_now"},
        )
        assert r.status_code == 401, (
            f"Sans auth doit retourner 401, got {r.status_code}"
        )

    def test_accept_without_auth_returns_401(self, http):
        """POST /bookings/{id}/accept sans token → 401."""
        r = http.post("/api/bookings/bkg_fake/accept")
        assert r.status_code == 401, (
            f"Sans auth doit retourner 401, got {r.status_code}"
        )

    def test_pay_without_auth_returns_401(self, http):
        """POST /bookings/{id}/pay sans token → 401."""
        r = http.post("/api/bookings/bkg_fake/pay")
        assert r.status_code == 401, (
            f"Sans auth doit retourner 401, got {r.status_code}"
        )

    def test_cancel_without_auth_returns_401(self, http):
        """POST /bookings/{id}/cancel sans token → 401."""
        r = http.post("/api/bookings/bkg_fake/cancel", json={"reason": "test"})
        assert r.status_code == 401, (
            f"Sans auth doit retourner 401, got {r.status_code}"
        )


# ══════════════════════════════════════════════════════════════════════════════
# Règle 2 — Champs de réponse obligatoires
# ══════════════════════════════════════════════════════════════════════════════

class TestResponseFields:
    """
    Vérifie que la réponse de création de booking contient tous les champs requis.
    Règle : booking_id, service_id, user_id, coach_id, status, amount,
            payment_mode, expires_at, pricing_snapshot.
    """

    REQUIRED_BOOKING_FIELDS = [
        "booking_id", "service_id", "user_id", "coach_id",
        "status", "amount", "payment_mode", "expires_at",
        "pricing_snapshot",
    ]
    REQUIRED_PRICING_FIELDS = [
        "base_amount", "payer_total_amount", "currency", "product_type",
        "payer_fixed_fee", "payer_percent_fee_amount",
        "receiver_net_amount", "platform_total_fee",
    ]

    def test_booking_response_has_required_fields(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """POST /bookings/request retourne tous les champs obligatoires."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201), (
                f"Booking doit être créé, got {r.status_code}: {r.text}"
            )
            booking_id = r.json().get("booking_id")
            data = r.json()

            missing = [f for f in self.REQUIRED_BOOKING_FIELDS if f not in data or data[f] is None]
            assert not missing, f"Champs manquants dans la réponse booking : {missing}"
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_pricing_snapshot_has_required_fields(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """La pricing_snapshot doit contenir tous les champs financiers."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json().get("booking_id")
            snapshot = r.json().get("pricing_snapshot", {})

            assert isinstance(snapshot, dict), "pricing_snapshot doit être un objet"
            missing = [f for f in self.REQUIRED_PRICING_FIELDS if f not in snapshot]
            assert not missing, (
                f"Champs manquants dans pricing_snapshot : {missing}"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_accept_response_has_required_fields(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """POST /bookings/{id}/accept retourne success, status, booking_id."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            acc = http.post(f"/api/bookings/{booking_id}/accept", headers=_h(tok_coach))
            assert acc.status_code == 200, f"Accept échoué : {acc.text}"
            data = acc.json()
            assert data.get("success") is True, "Champ 'success' doit être True"
            assert "status" in data, "Champ 'status' manquant dans la réponse /accept"
            assert data.get("booking_id") == booking_id, "booking_id incorrect dans /accept"
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)


# ══════════════════════════════════════════════════════════════════════════════
# Règle 3 — Pricing engine : montant = prix du service
# ══════════════════════════════════════════════════════════════════════════════

class TestPricingEngine:
    """
    Vérifie que le montant dans le booking correspond au prix du service.
    """

    def test_booking_amount_matches_service_price(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """booking.amount doit correspondre au prix du service (hors frais supplémentaires)."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            # Récupérer le prix du service
            svc_r = http.get(f"/api/services/{SVC_DEMO}", headers=_h(tok_user))
            assert svc_r.status_code == 200
            svc_price = float(svc_r.json().get("price", 0))
            assert svc_price > 0, "Le service doit avoir un prix > 0"

            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            booking_amount = float(r.json().get("amount", 0))
            snapshot       = r.json().get("pricing_snapshot", {})
            payer_total    = float(snapshot.get("payer_total_amount", 0))
            base_amount    = float(snapshot.get("base_amount", 0))

            # Règle : base_amount = prix du service
            assert abs(base_amount - svc_price) < 0.01, (
                f"base_amount ({base_amount}) doit correspondre au prix du service ({svc_price})"
            )
            # Règle : booking.amount = payer_total_amount (montant réellement facturé)
            assert abs(booking_amount - payer_total) < 0.01, (
                f"booking.amount ({booking_amount}) doit correspondre à payer_total_amount ({payer_total})"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_booking_currency_is_eur(self, http, tok_user, tok_coach, tok_admin):
        """La devise du booking doit être EUR."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]
            assert r.json().get("currency") == "EUR", "La devise doit être EUR"
            snapshot = r.json().get("pricing_snapshot", {})
            assert snapshot.get("currency") == "EUR", "pricing_snapshot.currency doit être EUR"
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)


# ══════════════════════════════════════════════════════════════════════════════
# Règle 4 — Transitions d'état invalides
# ══════════════════════════════════════════════════════════════════════════════

class TestInvalidStateTransitions:
    """
    Vérifie que les transitions d'état interdites retournent 409.
    """

    def test_cancel_refused_booking_returns_409(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """Annuler un booking déjà refusé → 409."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            # Créer + refuser
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            http.post(f"/api/bookings/{booking_id}/refuse", headers=_h(tok_coach))

            # Tenter d'annuler un refusé
            cancel = http.post(
                f"/api/bookings/{booking_id}/cancel",
                json={"reason": "test"},
                headers=_h(tok_user),
            )
            assert cancel.status_code == 409, (
                f"Cancel d'un booking refusé doit retourner 409, got {cancel.status_code}: {cancel.text}"
            )
            booking_id = None  # Déjà terminé
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_refuse_accepted_booking_returns_409(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """Refuser un booking en 'awaiting_payment' (déjà accepté) → 409."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            # Coach accepte → awaiting_payment
            acc = http.post(f"/api/bookings/{booking_id}/accept", headers=_h(tok_coach))
            assert acc.status_code == 200

            # Tenter de refuser un booking déjà accepté
            refuse = http.post(f"/api/bookings/{booking_id}/refuse", headers=_h(tok_coach))
            assert refuse.status_code == 409, (
                f"Refuser un booking awaiting_payment doit retourner 409, got {refuse.status_code}: {refuse.text}"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_accept_nonexistent_booking_returns_404(self, http, tok_coach):
        """/accept sur booking inexistant → 404."""
        r = http.post("/api/bookings/bkg_nonexistent_xyz/accept", headers=_h(tok_coach))
        assert r.status_code == 404, (
            f"/accept sur booking inexistant doit retourner 404, got {r.status_code}"
        )

    def test_refuse_nonexistent_booking_returns_404(self, http, tok_coach):
        """/refuse sur booking inexistant → 404."""
        r = http.post("/api/bookings/bkg_nonexistent_xyz/refuse", headers=_h(tok_coach))
        assert r.status_code == 404, (
            f"/refuse sur booking inexistant doit retourner 404, got {r.status_code}"
        )

    def test_pay_nonexistent_booking_returns_404(self, http, tok_user):
        """/pay sur booking inexistant → 404."""
        r = http.post("/api/bookings/bkg_nonexistent_xyz/pay", headers=_h(tok_user))
        assert r.status_code == 404, (
            f"/pay sur booking inexistant doit retourner 404, got {r.status_code}"
        )

    def test_cancel_nonexistent_booking_returns_404(self, http, tok_user):
        """/cancel sur booking inexistant → 404."""
        r = http.post(
            "/api/bookings/bkg_nonexistent_xyz/cancel",
            json={"reason": "test"},
            headers=_h(tok_user),
        )
        assert r.status_code == 404, (
            f"/cancel sur booking inexistant doit retourner 404, got {r.status_code}"
        )


# ══════════════════════════════════════════════════════════════════════════════
# Règle 5 — Autorisations
# ══════════════════════════════════════════════════════════════════════════════

class TestAuthorization:
    """
    Vérifie les règles d'autorisation :
    - Seul le coach peut accepter/refuser
    - Seul le payeur peut initier le paiement
    - Un tiers non autorisé ne peut pas annuler
    """

    def test_user_cannot_accept_booking(self, http, tok_user, tok_coach, tok_admin):
        """Un user (non-coach) ne peut pas accepter une réservation → 403."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            # Le payeur essaie d'accepter sa propre réservation → 403
            acc = http.post(f"/api/bookings/{booking_id}/accept", headers=_h(tok_user))
            assert acc.status_code == 403, (
                f"User ne peut pas accepter → 403, got {acc.status_code}: {acc.text}"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_user_cannot_refuse_booking(self, http, tok_user, tok_coach, tok_admin):
        """Un user (non-coach) ne peut pas refuser une réservation → 403."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            # Le payeur essaie de refuser sa propre réservation → 403
            ref = http.post(f"/api/bookings/{booking_id}/refuse", headers=_h(tok_user))
            assert ref.status_code == 403, (
                f"User ne peut pas refuser → 403, got {ref.status_code}: {ref.text}"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_third_party_cannot_cancel_booking(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """Un tiers non lié à la réservation ne peut pas l'annuler → 403."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        # Créer un second utilisateur tok_other (user_demo002)
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            # Un autre user non lié essaie d'annuler
            r_other_login = http.post(
                "/api/auth/login",
                json={"email": "mbenali@winek.app", "password": "WinekDemo2024!"},
            )
            if r_other_login.status_code != 200:
                pytest.skip("Utilisateur tiers non disponible dans le seed")

            tok_other = r_other_login.json()["token"]
            cancel = http.post(
                f"/api/bookings/{booking_id}/cancel",
                json={"reason": "malicious"},
                headers=_h(tok_other),
            )
            assert cancel.status_code == 403, (
                f"Tiers ne peut pas annuler → 403, got {cancel.status_code}: {cancel.text}"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_receiver_cannot_cancel_requested_booking(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """Le bénéficiaire ne peut annuler que les bookings 'accepted' → 409 pour 'requested'."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]
            assert r.json()["status"] == "requested"

            # Coach essaie d'annuler alors qu'il peut seulement refuser
            cancel = http.post(
                f"/api/bookings/{booking_id}/cancel",
                json={"reason": "test"},
                headers=_h(tok_coach),
            )
            assert cancel.status_code == 409, (
                f"Receiver ne peut pas cancel 'requested' → 409, "
                f"got {cancel.status_code}: {cancel.text}"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_coach_cannot_pay_user_booking(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """Le coach ne peut pas initier le paiement à la place du payeur → 403."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="instant_booking", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]
            assert r.json()["status"] == "awaiting_payment"

            # Coach tente de payer pour l'utilisateur
            pay = http.post(f"/api/bookings/{booking_id}/pay", headers=_h(tok_coach))
            assert pay.status_code == 403, (
                f"Coach ne peut pas payer à la place du payeur → 403, "
                f"got {pay.status_code}: {pay.text}"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_admin_can_cancel_any_booking(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """L'admin peut annuler n'importe quel booking."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            cancel = http.post(
                f"/api/bookings/{booking_id}/cancel",
                json={"reason": "admin_test"},
                headers=_h(tok_admin),
            )
            assert cancel.status_code == 200, (
                f"L'admin doit pouvoir annuler → 200, got {cancel.status_code}: {cancel.text}"
            )
            assert cancel.json().get("cancelled_by") is not None
            booking_id = None  # Déjà annulé
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)


# ══════════════════════════════════════════════════════════════════════════════
# Règle 6 — Idempotence
# ══════════════════════════════════════════════════════════════════════════════

class TestIdempotence:
    """
    Règles d'idempotence :
    - Même idempotency_key → même booking_id
    - /refuse deux fois → succès idempotent (200)
    - /cancel deux fois → succès idempotent (200)
    - /accept déjà accepté → succès idempotent (200)
    """

    def test_idempotency_key_returns_same_booking(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """POST /bookings/request deux fois avec la même clé → même booking_id."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        idem_key = f"test_idem_{uuid.uuid4().hex[:8]}"
        booking_id = None
        try:
            payload = {
                "service_id": SVC_DEMO,
                "payment_mode": "pay_now",
                "idempotency_key": idem_key,
            }
            r1 = http.post("/api/bookings/request", json=payload, headers=_h(tok_user))
            r2 = http.post("/api/bookings/request", json=payload, headers=_h(tok_user))

            assert r1.status_code in (200, 201), f"Premier appel échoué : {r1.text}"
            assert r2.status_code in (200, 201), f"Deuxième appel échoué : {r2.text}"
            booking_id = r1.json()["booking_id"]

            assert r1.json()["booking_id"] == r2.json()["booking_id"], (
                "Même idempotency_key doit retourner le même booking_id"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_refuse_twice_is_idempotent(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """/refuse deux fois → second appel retourne 200 (idempotent)."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            ref1 = http.post(f"/api/bookings/{booking_id}/refuse", headers=_h(tok_coach))
            ref2 = http.post(f"/api/bookings/{booking_id}/refuse", headers=_h(tok_coach))

            assert ref1.status_code == 200, f"/refuse (1) échoué : {ref1.text}"
            assert ref2.status_code == 200, (
                f"/refuse (2) doit être idempotent → 200, got {ref2.status_code}: {ref2.text}"
            )
            assert ref2.json().get("idempotent") is True, (
                "Second /refuse doit signaler idempotent=True"
            )
        finally:
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_cancel_twice_is_idempotent(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """/cancel deux fois → second appel retourne 200 (idempotent)."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            can1 = http.post(
                f"/api/bookings/{booking_id}/cancel",
                json={"reason": "first"},
                headers=_h(tok_user),
            )
            can2 = http.post(
                f"/api/bookings/{booking_id}/cancel",
                json={"reason": "second"},
                headers=_h(tok_user),
            )

            assert can1.status_code == 200, f"/cancel (1) échoué : {can1.text}"
            assert can2.status_code == 200, (
                f"/cancel (2) doit être idempotent → 200, got {can2.status_code}: {can2.text}"
            )
            assert can2.json().get("idempotent") is True, (
                "Second /cancel doit signaler idempotent=True"
            )
        finally:
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_accept_already_awaiting_is_idempotent(
        self, http, tok_user, tok_coach, tok_admin
    ):
        """/accept sur booking déjà awaiting_payment → idempotent (200)."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        try:
            r = _req_booking(http, tok_user, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]

            acc1 = http.post(f"/api/bookings/{booking_id}/accept", headers=_h(tok_coach))
            acc2 = http.post(f"/api/bookings/{booking_id}/accept", headers=_h(tok_coach))

            assert acc1.status_code == 200, f"/accept (1) échoué : {acc1.text}"
            assert acc2.status_code == 200, (
                f"/accept (2) doit être idempotent → 200, got {acc2.status_code}: {acc2.text}"
            )
            assert acc2.json().get("idempotent") is True, (
                "Second /accept doit signaler idempotent=True"
            )
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)


# ══════════════════════════════════════════════════════════════════════════════
# Règle 7 — Self-booking interdit
# ══════════════════════════════════════════════════════════════════════════════

class TestSelfBookingForbidden:
    """Règle : un coach ne peut pas réserver son propre service."""

    def test_coach_cannot_book_own_service_returns_400(
        self, http, tok_coach, tok_admin
    ):
        """Réserver son propre service → 400."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        try:
            r = _req_booking(http, tok_coach, SVC_DEMO, payment_mode="pay_now")
            assert r.status_code in (400, 403), (
                f"Auto-réservation interdite → 400/403, got {r.status_code}: {r.text}"
            )
        finally:
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)


# ══════════════════════════════════════════════════════════════════════════════
# Règle 8 — /pay sur booking expiré → 410 (mode ②)
# ══════════════════════════════════════════════════════════════════════════════

class TestPayExpiredBooking:
    """
    Vérifie que POST /pay sur un booking avec expires_at passé retourne 410.
    Requiert le mode ② (DB isolation) car on insère un booking expiré en DB.
    """

    @requires_db
    async def test_pay_expired_booking_returns_410(
        self, http, pool, tok_user
    ):
        """POST /pay sur booking 'awaiting_payment' expiré → 410."""
        bid = f"bkg_exp_pay_{uuid.uuid4().hex[:10]}"
        pid = f"pay_exp_{uuid.uuid4().hex[:10]}"

        async with pool.acquire() as conn:
            # Trouver les IDs depuis la DB
            user_row = await conn.fetchrow(
                "SELECT user_id FROM users WHERE email=$1", USER_EMAIL
            )
            coach_row = await conn.fetchrow(
                "SELECT user_id FROM users WHERE email=$1", COACH_EMAIL
            )
            svc_row = await conn.fetchrow(
                "SELECT service_id, price FROM services WHERE service_id=$1", SVC_DEMO
            )
            if not user_row or not coach_row or not svc_row:
                pytest.skip("Données seed manquantes dans winek_test")

            user_id  = user_row["user_id"]
            coach_id = coach_row["user_id"]
            price    = float(svc_row["price"] or 60.0)

            # Insérer booking awaiting_payment avec expires_at passé
            await conn.execute(
                """INSERT INTO bookings
                   (booking_id, service_id, user_id, coach_id, status,
                    payer_user_id, receiver_user_id, expires_at, payment_mode, amount)
                   VALUES ($1,$2,$3,$4,'awaiting_payment',$3,$4,
                           (NOW() - INTERVAL '10 minutes'),'pay_now',$5)""",
                bid, SVC_DEMO, user_id, coach_id, price,
            )
            # Insérer un payment minimal pour éviter le 500 "payment manquant"
            await conn.execute(
                """INSERT INTO payments
                   (payment_id, payer_user_id, receiver_user_id,
                    product_type, product_id, booking_id,
                    stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id,
                    status, currency,
                    base_amount, payer_fixed_fee, payer_percent_fee_amount,
                    receiver_fixed_fee, receiver_percent_fee_amount,
                    platform_total_fee, receiver_net_amount, payer_total_amount,
                    pricing_rule_snapshot)
                   VALUES ($1,$2,$3,'service_booking',$4,$5,NULL,NULL,NULL,
                           'requires_authorization','EUR',
                           $6,0,0,0,0,0,$6,$6,'[]')""",
                pid, user_id, coach_id, SVC_DEMO, bid, price,
            )

        try:
            pay = http.post(f"/api/bookings/{bid}/pay", headers=_h(tok_user))
            assert pay.status_code == 410, (
                f"POST /pay sur booking expiré doit retourner 410, "
                f"got {pay.status_code}: {pay.text}"
            )
        finally:
            async with pool.acquire() as conn:
                await conn.execute("DELETE FROM payments WHERE payment_id=$1", pid)
                await conn.execute("DELETE FROM bookings WHERE booking_id=$1", bid)


# ══════════════════════════════════════════════════════════════════════════════
# Règle 9 — Annulation par le payeur libère le slot (mode ②)
# ══════════════════════════════════════════════════════════════════════════════

class TestCancelByPayerReleasesSlot:
    """
    Le payeur peut annuler une réservation 'requested'.
    Le slot doit repasser à 'available'.
    Requiert le mode ② pour vérifier l'état du slot en DB.
    """

    @requires_db
    async def test_payer_cancel_requested_releases_slot(
        self, http, pool, tok_user, tok_coach, tok_admin
    ):
        """Annulation par payeur d'un booking 'requested' libère le slot."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="manual_approval", pay_later=False)
        booking_id = None
        slot_id = None

        try:
            # Récupère un slot available via l'API
            r_svc = http.get(f"/api/services/{SVC_DEMO}", headers=_h(tok_user))
            slots = r_svc.json().get("slots", [])
            available = [
                s for s in slots
                if s.get("slot_status") == "available"
                and s.get("slot_type") in ("single", "specific")
            ]
            if not available:
                pytest.skip("Aucun slot disponible pour ce test")

            slot_id = available[0]["slot_id"]
            r = _req_booking(http, tok_user, SVC_DEMO,
                             payment_mode="pay_now", slot_id=slot_id)
            assert r.status_code in (200, 201)
            booking_id = r.json()["booking_id"]
            assert r.json()["status"] == "requested"

            # Vérification DB : slot doit être 'pending' (manual_approval)
            async with pool.acquire() as conn:
                s_before = await conn.fetchrow(
                    "SELECT slot_status FROM service_slots WHERE slot_id=$1", slot_id
                )
            assert s_before["slot_status"] == "pending", (
                f"Slot doit être 'pending' après booking requested, "
                f"got '{s_before['slot_status']}'"
            )

            # Annulation par le payeur
            cancel = http.post(
                f"/api/bookings/{booking_id}/cancel",
                json={"reason": "test_payer_cancel"},
                headers=_h(tok_user),
            )
            assert cancel.status_code == 200, f"Cancel échoué : {cancel.text}"

            # Vérification DB : slot libéré
            async with pool.acquire() as conn:
                s_after = await conn.fetchrow(
                    "SELECT slot_status FROM service_slots WHERE slot_id=$1", slot_id
                )
            assert s_after["slot_status"] == "available", (
                f"Slot doit être 'available' après annulation, "
                f"got '{s_after['slot_status']}'"
            )
            booking_id = None  # Déjà annulé
        finally:
            if booking_id:
                _cancel_booking(http, tok_admin, booking_id)
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)


# ══════════════════════════════════════════════════════════════════════════════
# Règle 10 — Slot indisponible → 409
# ══════════════════════════════════════════════════════════════════════════════

class TestSlotUnavailableRejection:
    """
    Réserver un slot déjà réservé → 409.
    Requiert mode ② pour contrôler l'état du slot directement.
    """

    @requires_db
    async def test_booking_reserved_slot_returns_409(
        self, http, pool, tok_user, tok_coach, tok_admin
    ):
        """Réserver un slot en état 'reserved' → 409 Créneau indisponible."""
        _configure_service(http, tok_admin, tok_coach, SVC_DEMO,
                           mode="instant_booking", pay_later=False)
        first_booking_id  = None
        second_booking_id = None
        slot_id = None

        try:
            # Récupère un slot available
            r_svc = http.get(f"/api/services/{SVC_DEMO}", headers=_h(tok_user))
            slots = r_svc.json().get("slots", [])
            available = [
                s for s in slots
                if s.get("slot_status") == "available"
                and s.get("slot_type") in ("single", "specific")
            ]
            if not available:
                pytest.skip("Aucun slot disponible pour ce test")

            slot_id = available[0]["slot_id"]

            # Première réservation → slot 'reserved'
            r1 = _req_booking(http, tok_user, SVC_DEMO,
                              payment_mode="pay_now", slot_id=slot_id)
            assert r1.status_code in (200, 201), f"Première réservation échouée : {r1.text}"
            first_booking_id = r1.json()["booking_id"]

            # Forcer un deuxième utilisateur pour essayer de réserver le même slot
            r_other_login = http.post(
                "/api/auth/login",
                json={"email": "mbenali@winek.app", "password": "WinekDemo2024!"},
            )
            if r_other_login.status_code != 200:
                pytest.skip("Utilisateur tiers non disponible dans le seed")

            # Mettre le slot directement en 'reserved' pour le test
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE service_slots SET slot_status='reserved' WHERE slot_id=$1",
                    slot_id
                )

            # Deuxième réservation sur slot 'reserved' → 409
            tok_other = r_other_login.json()["token"]
            r2 = _req_booking(http, tok_other, SVC_DEMO,
                              payment_mode="pay_now", slot_id=slot_id)
            assert r2.status_code == 409, (
                f"Slot 'reserved' doit retourner 409, got {r2.status_code}: {r2.text}"
            )

        finally:
            if first_booking_id:
                _cancel_booking(http, tok_admin, first_booking_id)
            if second_booking_id:
                _cancel_booking(http, tok_admin, second_booking_id)
            # Remettre le slot en available
            if slot_id:
                async with pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE service_slots SET slot_status='available' WHERE slot_id=$1",
                        slot_id
                    )
            _reset_service(http, tok_admin, tok_coach, SVC_DEMO)
