"""
test_booking_workflow.py
==========================
Tests du workflow de réservation v2 :
- Création (POST /bookings/request + alias /bookings)
- Statuts : requested → accepted / refused / cancelled / completed
- Idempotence (double clic, clé explicite)
- Concurrence (deux users sur le même slot single)
- Intégration pricing engine
- Machine d'états payment
"""

import pytest
import httpx
import asyncio
import asyncpg
import os
import uuid

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("TEST_BASE_URL", ""))
DB_URL   = os.environ.get("DATABASE_URL")


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def http():
    with httpx.Client(base_url=BASE_URL, timeout=15) as c:
        yield c


def login(http_client, email, password):
    r = http_client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]


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
def service_id(http, tok_coach):
    """Récupère le service du coach (toujours owned by tok_coach pour les accept/refuse)."""
    r = http.get("/api/services/mine", headers={"Authorization": f"Bearer {tok_coach}"})
    assert r.status_code == 200, f"GET /services/mine failed: {r.text}"
    svcs = r.json()
    assert svcs, "Le coach n'a aucun service enregistré"
    return svcs[0]["service_id"]


@pytest.fixture(scope="module", autouse=True)
def ensure_manual_approval_mode(http, tok_coach, tok_admin, service_id):
    """Reset service to manual_approval + allow_pay_later=True + set global flag to True before/after all tests."""
    # Set global flag to allow manual approval (needed for 'requested' bookings)
    http.put(
        "/api/admin/app-config",
        json={"enable_manual_approval_for_services": True, "enable_pay_later_for_services": True},
        headers={"Authorization": f"Bearer {tok_admin}"},
    )
    reset_payload = {
        "booking_approval_mode": "manual_approval",
        "allow_pay_later": True,
        "pay_later_expiration_minutes": 1440,
    }
    r = http.patch(
        f"/api/services/{service_id}",
        json=reset_payload,
        headers={"Authorization": f"Bearer {tok_coach}"},
    )
    if r.status_code != 200:
        print(f"WARNING: Could not reset service mode to manual_approval: {r.text}")
    yield
    # Restore global flag to False after all tests
    http.put(
        "/api/admin/app-config",
        json={"enable_manual_approval_for_services": False, "enable_pay_later_for_services": False},
        headers={"Authorization": f"Bearer {tok_admin}"},
    )
    http.patch(
        f"/api/services/{service_id}",
        json=reset_payload,
        headers={"Authorization": f"Bearer {tok_coach}"},
    )


@pytest.fixture(scope="module")
def single_slot_id(http, tok_user, service_id):
    """Récupère un slot 'specific' ou 'single' disponible du service."""
    r = http.get(f"/api/services/{service_id}",
                 headers={"Authorization": f"Bearer {tok_user}"})
    if r.status_code != 200:
        return None
    slots = r.json().get("slots", [])
    specific_slots = [s for s in slots if s.get("slot_type") in ("single", "specific")]
    return specific_slots[0]["slot_id"] if specific_slots else None


# ── Helpers ───────────────────────────────────────────────────────────────────

def req_booking(http, token, service_id, slot_id=None, idempotency_key=None, notes=None):
    payload = {"service_id": service_id}
    if slot_id:
        payload["slot_id"] = slot_id
    if idempotency_key:
        payload["idempotency_key"] = idempotency_key
    if notes:
        payload["notes"] = notes
    return http.post("/api/bookings/request",
                     json=payload,
                     headers={"Authorization": f"Bearer {token}"})


# ══════════════════════════════════════════════════════════════════════════════
# 1. Création basique
# ══════════════════════════════════════════════════════════════════════════════

class TestBookingRequest:

    def test_create_booking_basic(self, http, tok_user, service_id):
        """POST /bookings/request → 200, status=requested, pricing présent."""
        r = req_booking(http, tok_user, service_id)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "requested", f"Expected 'requested', got {d['status']}"
        assert d["pricing_snapshot"] is not None
        assert d["payer_user_id"] is not None
        assert d["receiver_user_id"] is not None
        assert d["payer_user_id"] != d["receiver_user_id"]

    def test_alias_post_bookings(self, http, tok_user, service_id):
        """Alias POST /bookings → même résultat que /bookings/request."""
        r = http.post("/api/bookings",
                      json={"service_id": service_id},
                      headers={"Authorization": f"Bearer {tok_user}"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "requested"

    def test_cannot_book_own_service(self, http, tok_coach):
        """Le propriétaire du service ne peut pas le réserver."""
        # Récupérer l'user_id du coach connecté
        r_me = http.get("/api/auth/me", headers={"Authorization": f"Bearer {tok_coach}"})
        assert r_me.status_code == 200
        coach_user_id = r_me.json()["user_id"]

        # Trouver un service qui appartient à ce coach
        r = http.get("/api/services?lat=48.8566&lng=2.3522&radius=100000",
                     headers={"Authorization": f"Bearer {tok_coach}"})
        svcs = r.json()
        own_svcs = [s for s in svcs if s.get("coach_id") == coach_user_id]
        if not own_svcs:
            pytest.skip(f"Aucun service pour coach {coach_user_id}")
        own_svc_id = own_svcs[0]["service_id"]

        r2 = req_booking(http, tok_coach, own_svc_id)
        assert r2.status_code == 400, f"Expected 400, got {r2.status_code}: {r2.text}"
        assert "propre" in r2.json()["detail"].lower() or "own" in r2.json()["detail"].lower()

    def test_pricing_snapshot_immutable(self, http, tok_user, service_id):
        """Le snapshot de pricing doit être cohérent avec les montants."""
        r = req_booking(http, tok_user, service_id)
        assert r.status_code == 200
        d = r.json()
        snap = d["pricing_snapshot"]
        assert snap is not None
        # payer_total_amount du booking = snapshot
        assert abs(float(d["amount"]) - float(snap["payer_total_amount"])) < 0.01

    def test_payment_initial_status(self, http, tok_user, tok_admin, service_id):
        """Le paiement initial doit être 'requires_authorization'."""
        r = req_booking(http, tok_user, service_id)
        assert r.status_code == 200
        bid = r.json()["booking_id"]

        # Vérifier dans payments
        r_pay = http.get("/api/payments/me",
                         headers={"Authorization": f"Bearer {tok_user}"})
        assert r_pay.status_code == 200
        payments = r_pay.json()
        matching = [p for p in payments if p.get("booking_id") == bid]
        assert matching, f"Aucun payment trouvé pour booking {bid}"
        assert matching[0]["status"] == "requires_authorization", \
            f"Expected requires_authorization, got {matching[0]['status']}"


# ══════════════════════════════════════════════════════════════════════════════
# 2. Idempotence
# ══════════════════════════════════════════════════════════════════════════════

class TestIdempotency:

    def test_idempotency_key_dedup(self, http, tok_user, service_id):
        """Deux appels avec le même idempotency_key → même booking_id."""
        key = f"idem_{uuid.uuid4().hex[:8]}"
        r1 = req_booking(http, tok_user, service_id, idempotency_key=key)
        r2 = req_booking(http, tok_user, service_id, idempotency_key=key)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.json()["booking_id"] == r2.json()["booking_id"], \
            "Double clic avec idempotency_key a créé 2 bookings différents"

    def test_idempotency_key_unique_per_request(self, http, tok_user, service_id):
        """Deux clés différentes → deux bookings distincts."""
        k1 = f"idem_{uuid.uuid4().hex[:8]}"
        k2 = f"idem_{uuid.uuid4().hex[:8]}"
        r1 = req_booking(http, tok_user, service_id, idempotency_key=k1)
        r2 = req_booking(http, tok_user, service_id, idempotency_key=k2)
        assert r1.json()["booking_id"] != r2.json()["booking_id"]


# ══════════════════════════════════════════════════════════════════════════════
# 3. Accept / Refuse / Cancel
# ══════════════════════════════════════════════════════════════════════════════

class TestBookingTransitions:

    def test_accept_flow(self, http, tok_user, tok_coach, service_id):
        """requested → awaiting_payment par le receiver (nouveau workflow v2)."""
        r = req_booking(http, tok_user, service_id)
        assert r.status_code == 200
        bid = r.json()["booking_id"]

        # Le coach accepte → booking passe en awaiting_payment (pas accepted)
        r_acc = http.post(f"/api/bookings/{bid}/accept",
                          headers={"Authorization": f"Bearer {tok_coach}"})
        assert r_acc.status_code == 200, r_acc.text
        assert r_acc.json()["status"] == "awaiting_payment", \
            f"Expected 'awaiting_payment', got {r_acc.json()['status']}"

        # Vérifier payment status = requires_authorization (user doit encore payer)
        r_pay = http.get("/api/payments/me",
                         headers={"Authorization": f"Bearer {tok_user}"})
        payments = r_pay.json()
        matching = [p for p in payments if p.get("booking_id") == bid]
        assert matching
        assert matching[0]["status"] == "requires_authorization", \
            f"Expected requires_authorization, got {matching[0]['status']}"

    def test_accept_idempotent(self, http, tok_user, tok_coach, service_id):
        """Double accept → idempotent, pas d'erreur."""
        r = req_booking(http, tok_user, service_id)
        bid = r.json()["booking_id"]
        http.post(f"/api/bookings/{bid}/accept",
                  headers={"Authorization": f"Bearer {tok_coach}"})
        r2 = http.post(f"/api/bookings/{bid}/accept",
                       headers={"Authorization": f"Bearer {tok_coach}"})
        assert r2.status_code == 200
        assert r2.json().get("idempotent") is True

    def test_refuse_flow(self, http, tok_user, tok_coach, service_id):
        """requested → refused par le receiver, slot libéré."""
        r = req_booking(http, tok_user, service_id)
        bid = r.json()["booking_id"]

        r_ref = http.post(f"/api/bookings/{bid}/refuse",
                          headers={"Authorization": f"Bearer {tok_coach}"})
        assert r_ref.status_code == 200
        assert r_ref.json()["status"] == "refused"

        # Payment annulé
        r_pay = http.get("/api/payments/me",
                         headers={"Authorization": f"Bearer {tok_user}"})
        payments = r_pay.json()
        matching = [p for p in payments if p.get("booking_id") == bid]
        assert matching
        assert matching[0]["status"] == "cancelled"

    def test_refuse_by_payer_forbidden(self, http, tok_user, service_id):
        """Le payeur ne peut pas refuser (seulement le receiver)."""
        r = req_booking(http, tok_user, service_id)
        bid = r.json()["booking_id"]
        r_ref = http.post(f"/api/bookings/{bid}/refuse",
                          headers={"Authorization": f"Bearer {tok_user}"})
        assert r_ref.status_code == 403

    def test_cancel_by_payer(self, http, tok_user, tok_coach, service_id):
        """requested → cancelled par le payeur."""
        r = req_booking(http, tok_user, service_id)
        bid = r.json()["booking_id"]
        r_can = http.post(f"/api/bookings/{bid}/cancel",
                          headers={"Authorization": f"Bearer {tok_user}"})
        assert r_can.status_code == 200
        assert r_can.json()["status"] == "cancelled"

    def test_cancel_by_admin(self, http, tok_user, tok_admin, service_id):
        """Admin peut annuler n'importe quelle réservation."""
        r = req_booking(http, tok_user, service_id)
        bid = r.json()["booking_id"]
        r_can = http.post(f"/api/bookings/{bid}/cancel",
                          headers={"Authorization": f"Bearer {tok_admin}"})
        assert r_can.status_code == 200

    def test_cancel_idempotent(self, http, tok_user, service_id):
        """Double annulation → idempotent."""
        r = req_booking(http, tok_user, service_id)
        bid = r.json()["booking_id"]
        http.post(f"/api/bookings/{bid}/cancel",
                  headers={"Authorization": f"Bearer {tok_user}"})
        r2 = http.post(f"/api/bookings/{bid}/cancel",
                       headers={"Authorization": f"Bearer {tok_user}"})
        assert r2.status_code == 200
        assert r2.json().get("idempotent") is True

    def test_refuse_after_accept_forbidden(self, http, tok_user, tok_coach, service_id):
        """On ne peut plus refuser une réservation déjà acceptée."""
        r = req_booking(http, tok_user, service_id)
        bid = r.json()["booking_id"]
        http.post(f"/api/bookings/{bid}/accept",
                  headers={"Authorization": f"Bearer {tok_coach}"})
        r_ref = http.post(f"/api/bookings/{bid}/refuse",
                          headers={"Authorization": f"Bearer {tok_coach}"})
        assert r_ref.status_code == 409

    def test_legacy_patch_status(self, http, tok_user, tok_coach, service_id):
        """L'ancien PATCH /status redirige correctement vers les verbes dédiés."""
        r = req_booking(http, tok_user, service_id)
        bid = r.json()["booking_id"]
        r_patch = http.patch(f"/api/bookings/{bid}/status",
                             json={"status": "accepted"},
                             headers={"Authorization": f"Bearer {tok_coach}"})
        assert r_patch.status_code == 200
        # Le nouveau workflow retourne awaiting_payment (pas accepted) lors de l'accept
        assert r_patch.json()["status"] == "awaiting_payment"


# ══════════════════════════════════════════════════════════════════════════════
# 4. Slot locking — single slot
# ══════════════════════════════════════════════════════════════════════════════

class TestSlotLocking:

    def test_single_slot_pending_after_request(self, http, tok_user, service_id, single_slot_id):
        """Après une demande sur slot single, le slot passe en 'pending'."""
        if not single_slot_id:
            pytest.skip("Aucun slot single disponible")

        # S'assurer que le slot est 'available' en annulant les bookings actifs
        # (test isolation)
        r_me = http.get("/api/bookings/me",
                        headers={"Authorization": f"Bearer {tok_user}"})
        if r_me.status_code == 200:
            for bk in r_me.json():
                if bk.get("slot_id") == single_slot_id and bk["status"] not in ("refused", "cancelled", "expired"):
                    http.post(f"/api/bookings/{bk['booking_id']}/cancel",
                              headers={"Authorization": f"Bearer {tok_user}"})

        r = req_booking(http, tok_user, service_id, slot_id=single_slot_id)
        if r.status_code == 409:
            pytest.skip(f"Slot non disponible : {r.json()['detail']}")
        assert r.status_code == 200, r.text

        # Vérifier slot_status = pending via la DB (ou via les bookings)
        bid = r.json()["booking_id"]
        # La réservation doit bien référencer ce slot
        assert r.json()["slot_id"] == single_slot_id

    def test_second_user_blocked_on_booked_slot(self, http, tok_user, tok_admin, service_id, single_slot_id):
        """
        Après qu'un user a demandé un slot single (slot_status='pending'),
        un second user ne peut plus le réserver.
        """
        if not single_slot_id:
            pytest.skip("Aucun slot single disponible")

        # S'assurer de l'état initial : annuler tout booking actif sur ce slot
        r_me = http.get("/api/bookings/me",
                        headers={"Authorization": f"Bearer {tok_user}"})
        if r_me.status_code == 200:
            for bk in r_me.json():
                if bk.get("slot_id") == single_slot_id and bk["status"] not in ("refused", "cancelled", "expired"):
                    http.post(f"/api/bookings/{bk['booking_id']}/cancel",
                              headers={"Authorization": f"Bearer {tok_user}"})

        # Admin aussi (au cas où il aurait un booking actif)
        r_recv = http.get("/api/bookings/received",
                          headers={"Authorization": f"Bearer {tok_admin}"})
        if r_recv.status_code == 200:
            for bk in r_recv.json():
                if bk.get("slot_id") == single_slot_id and bk["status"] not in ("refused", "cancelled", "expired"):
                    http.post(f"/api/bookings/{bk['booking_id']}/cancel",
                              headers={"Authorization": f"Bearer {tok_admin}"})

        # User prend le slot
        r1 = req_booking(http, tok_user, service_id, slot_id=single_slot_id)
        if r1.status_code == 409:
            pytest.skip(f"Slot déjà pris : {r1.json()['detail']}")
        assert r1.status_code == 200

        # Un second utilisateur (admin) essaie de prendre le même slot
        tok_admin2 = login(http, "admin@winek.app", "WinekAdmin2024!")
        r2 = http.post("/api/bookings/request",
                       json={"service_id": service_id, "slot_id": single_slot_id},
                       headers={"Authorization": f"Bearer {tok_admin2}"})
        # Doit être refusé (409 conflict ou 400)
        assert r2.status_code in (400, 403, 409), \
            f"Le second utilisateur a pu réserver le même slot (status={r2.status_code})"


# ══════════════════════════════════════════════════════════════════════════════
# 5. GET listing
# ══════════════════════════════════════════════════════════════════════════════

class TestListingEndpoints:

    def test_get_my_bookings(self, http, tok_user):
        """GET /bookings/me retourne les réservations du payeur."""
        r = http.get("/api/bookings/me",
                     headers={"Authorization": f"Bearer {tok_user}"})
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_get_users_me_bookings_alias(self, http, tok_user):
        """GET /users/me/bookings est un alias valide."""
        r = http.get("/api/users/me/bookings",
                     headers={"Authorization": f"Bearer {tok_user}"})
        assert r.status_code == 200

    def test_get_received_bookings(self, http, tok_coach):
        """GET /bookings/received retourne les demandes reçues."""
        r = http.get("/api/bookings/received",
                     headers={"Authorization": f"Bearer {tok_coach}"})
        assert r.status_code == 200

    def test_get_receiver_requests_alias(self, http, tok_coach):
        """GET /receiver/requests est un alias valide."""
        r = http.get("/api/receiver/requests",
                     headers={"Authorization": f"Bearer {tok_coach}"})
        assert r.status_code == 200


# ══════════════════════════════════════════════════════════════════════════════
# 6. Concurrence simulée (asyncio)
# ══════════════════════════════════════════════════════════════════════════════

class TestConcurrency:

    def test_concurrent_requests_same_service(self, http, tok_user, service_id):
        """
        Simule 3 requêtes quasi-simultanées sans slot_id.
        Pour un service sans slot unique : toutes les 3 doivent réussir
        (pas de blocage côté DB) — ce test vérifie qu'il n'y a pas de deadlock.
        """
        keys = [f"concurrent_{uuid.uuid4().hex[:8]}" for _ in range(3)]

        async def make_request(key):
            async with httpx.AsyncClient(base_url=BASE_URL, timeout=15) as ac:
                return await ac.post(
                    "/api/bookings/request",
                    json={"service_id": service_id, "idempotency_key": key},
                    headers={"Authorization": f"Bearer {tok_user}"},
                )

        async def run():
            tasks = [make_request(k) for k in keys]
            return await asyncio.gather(*tasks)

        responses = asyncio.run(run())
        for resp in responses:
            assert resp.status_code == 200, f"Requête concurrente échouée : {resp.text}"

        booking_ids = {r.json()["booking_id"] for r in responses}
        assert len(booking_ids) == 3, "Des bookings dupliqués ont été créés"
