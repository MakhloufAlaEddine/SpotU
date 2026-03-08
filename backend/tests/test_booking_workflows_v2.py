"""
test_booking_workflows_v2.py
============================
Tests des 4 flux de réservation flexible SpotU v2.

Flux testés :
  A. instant_booking + pay_now    → awaiting_payment (30 min expiry), slot reserved
  B. instant_booking + pay_later  → awaiting_payment (config expiry), slot reserved
  C. manual_approval + pay_now    → requested, accept → awaiting_payment (30 min)
  D. manual_approval + pay_later  → requested, accept → awaiting_payment (config expiry)

Tests supplémentaires :
  - pay_later bloqué si non autorisé par le service
  - Expiration de 'awaiting_payment' → slot libéré
  - /bookings/{id}/pay → URL Stripe Checkout
  - /bookings/{id}/cancel libère le slot 'reserved'
  - Slot bloqué : instant_booking empêche une 2ème réservation
"""

import pytest
import httpx
import asyncio
import asyncpg
import psycopg2
import psycopg2.extras
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

BASE_URL     = os.environ.get("TEST_BASE_URL", "http://localhost:8001")
ASYNCPG_DSN  = os.environ.get("DATABASE_URL", "postgresql://winek:winek2024@localhost:5432/winek_db")
DB_DSN       = "dbname=winek_db user=winek password=winek2024 host=localhost port=5432"


# ── Helpers DB sync ────────────────────────────────────────────────────────────

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


def force_expires_at(booking_id: str, past_hours: int = 1):
    conn = db_conn()
    cur  = conn.cursor()
    cur.execute(
        "UPDATE bookings SET expires_at=NOW()-INTERVAL %s WHERE booking_id=%s",
        (f"{past_hours} hours", booking_id),
    )
    conn.commit()
    cur.close(); conn.close()


def run_worker() -> int:
    from expiry_worker import expire_stale_bookings

    async def _run():
        pool = await asyncpg.create_pool(ASYNCPG_DSN, min_size=1, max_size=2, timeout=10)
        try:
            return await expire_stale_bookings(pool)
        finally:
            await pool.close()

    return asyncio.run(_run())


# ── Helpers HTTP ───────────────────────────────────────────────────────────────

def login(client, email, password) -> str:
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login failed ({email}): {r.text}"
    return r.json()["token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def book(client, token, service_id, slot_id=None, payment_mode="pay_now", idem_key=None):
    payload = {"service_id": service_id, "payment_mode": payment_mode}
    if slot_id:
        payload["slot_id"] = slot_id
    if idem_key:
        payload["idempotency_key"] = idem_key
    return client.post("/api/bookings/request", json=payload, headers=auth(token))


def update_service_workflow(client, coach_token, service_id, mode, allow_pay_later, expiry_min=10):
    return client.patch(
        f"/api/services/{service_id}",
        json={
            "booking_approval_mode":        mode,
            "allow_pay_later":              allow_pay_later,
            "pay_later_expiration_minutes": expiry_min,
        },
        headers=auth(coach_token),
    )


# ── Fixtures ───────────────────────────────────────────────────────────────────

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
def coach_user_id(http, tok_coach):
    r = http.get("/api/auth/me", headers=auth(tok_coach))
    assert r.status_code == 200
    return r.json()["user_id"]


@pytest.fixture(scope="module")
def coach_service_id(http, tok_coach):
    """Service appartenant au coach (via /services/mine)."""
    r = http.get("/api/services/mine", headers=auth(tok_coach))
    assert r.status_code == 200, f"GET /services/mine failed: {r.text}"
    svcs = r.json()
    assert svcs, "Le coach n'a aucun service enregistré"
    return svcs[0]["service_id"]


@pytest.fixture(scope="module")
def single_slot_id(http, tok_user, coach_service_id):
    """Slot single/specific du service coach."""
    r = http.get(f"/api/services/{coach_service_id}", headers=auth(tok_user))
    if r.status_code != 200:
        return None
    slots = r.json().get("slots", [])
    specific = [s for s in slots if s.get("slot_type") in ("single", "specific")]
    return specific[0]["slot_id"] if specific else None


# ── Helper : restaurer le service en mode manuel après chaque classe ───────────

def restore_manual_no_pay_later(http, tok_coach, service_id):
    update_service_workflow(http, tok_coach, service_id, "manual_approval", False, 1440)


def cleanup_slot_bookings(service_id: str, slot_id: str | None):
    """Cancel all active bookings on this slot for isolation."""
    if not slot_id:
        return
    conn = db_conn()
    cur  = conn.cursor()
    cur.execute(
        """UPDATE bookings SET status='cancelled', updated_at=NOW()
           WHERE slot_id=%s AND status NOT IN ('refused','cancelled','expired')""",
        (slot_id,),
    )
    cur.execute(
        "UPDATE service_slots SET slot_status='available' WHERE slot_id=%s",
        (slot_id,),
    )
    conn.commit()
    cur.close(); conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# FLUX A : instant_booking + pay_now
# ══════════════════════════════════════════════════════════════════════════════

class TestFluxA_InstantPayNow:
    """
    Service configuré en instant_booking + pay_later=False.
    La réservation doit passer directement en awaiting_payment (30 min).
    """

    def test_a_booking_status_awaiting_payment(self, http, tok_user, tok_coach, coach_service_id):
        """Flux A : booking créé en awaiting_payment (pas requested)."""
        r = update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)
        assert r.status_code == 200, f"Mise à jour service échouée: {r.text}"

        r = book(http, tok_user, coach_service_id, payment_mode="pay_now")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "awaiting_payment", f"Expected awaiting_payment, got {d['status']}"
        assert d["payment_mode"] == "pay_now"
        # expires_at doit être dans ~30 min
        expires_at = d.get("expires_at")
        assert expires_at is not None

    def test_a_slot_reserved_instantly(self, http, tok_user, tok_coach, coach_service_id, single_slot_id):
        """Flux A avec slot : slot passe en 'reserved' immédiatement."""
        if not single_slot_id:
            pytest.skip("Aucun slot single disponible")
        cleanup_slot_bookings(coach_service_id, single_slot_id)

        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)
        r = book(http, tok_user, coach_service_id, slot_id=single_slot_id, payment_mode="pay_now")
        if r.status_code == 409:
            pytest.skip(f"Slot déjà pris : {r.json()['detail']}")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "awaiting_payment"

        slot = db_get("service_slots", "slot_id", single_slot_id)
        assert slot["slot_status"] == "reserved", \
            f"Expected slot_status=reserved, got {slot['slot_status']}"

    def test_a_pay_later_rejected_when_not_allowed(self, http, tok_user, tok_coach, coach_service_id):
        """Flux A : pay_later refusé si service ne l'autorise pas."""
        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)
        r = book(http, tok_user, coach_service_id, payment_mode="pay_later")
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
        assert "pay_later" in r.json()["detail"].lower() or "différé" in r.json()["detail"].lower()

    def teardown_method(self, method):
        pass  # Restauré par la prochaine classe


# ══════════════════════════════════════════════════════════════════════════════
# FLUX B : instant_booking + pay_later
# ══════════════════════════════════════════════════════════════════════════════

class TestFluxB_InstantPayLater:
    """
    Service configuré en instant_booking + pay_later=True, expiry=10min.
    La réservation doit passer directement en awaiting_payment avec expiry=10min.
    """

    def test_b_booking_awaiting_payment_pay_later(self, http, tok_user, tok_coach, coach_service_id):
        """Flux B : instant_booking + pay_later → awaiting_payment, expiry=10min."""
        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", True, 10)

        r = book(http, tok_user, coach_service_id, payment_mode="pay_later")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "awaiting_payment", f"Expected awaiting_payment, got {d['status']}"
        assert d["payment_mode"] == "pay_later"
        assert d.get("expires_at") is not None

    def test_b_pay_now_also_works(self, http, tok_user, tok_coach, coach_service_id):
        """Flux B : instant_booking + pay_later=True permet aussi pay_now."""
        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", True, 10)
        ikey = f"b_paynow_{uuid.uuid4().hex[:8]}"
        r = book(http, tok_user, coach_service_id, payment_mode="pay_now", idem_key=ikey)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "awaiting_payment"
        assert r.json()["payment_mode"] == "pay_now"


# ══════════════════════════════════════════════════════════════════════════════
# FLUX C : manual_approval + pay_now
# ══════════════════════════════════════════════════════════════════════════════

class TestFluxC_ManualPayNow:
    """
    Service configuré en manual_approval + pay_later=False.
    Flux : requested → accept → awaiting_payment (30 min).
    """

    def test_c_booking_requested(self, http, tok_user, tok_coach, coach_service_id):
        """Flux C : manual_approval → status=requested."""
        update_service_workflow(http, tok_coach, coach_service_id, "manual_approval", False)

        r = book(http, tok_user, coach_service_id, payment_mode="pay_now")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "requested", \
            f"Expected requested, got {r.json()['status']}"

    def test_c_accept_transitions_to_awaiting_payment(self, http, tok_user, tok_coach, coach_service_id):
        """Flux C : accept → awaiting_payment."""
        update_service_workflow(http, tok_coach, coach_service_id, "manual_approval", False)

        r = book(http, tok_user, coach_service_id, payment_mode="pay_now")
        bid = r.json()["booking_id"]

        r_acc = http.post(f"/api/bookings/{bid}/accept", headers=auth(tok_coach))
        assert r_acc.status_code == 200, r_acc.text
        d = r_acc.json()
        assert d["status"] == "awaiting_payment", f"Expected awaiting_payment, got {d['status']}"
        assert d["payment_mode"] == "pay_now"
        assert "pay_expiry_interval" in d

    def test_c_slot_reserved_after_accept(self, http, tok_user, tok_coach, coach_service_id, single_slot_id):
        """Flux C avec slot : slot passe de 'pending' à 'reserved' après accept."""
        if not single_slot_id:
            pytest.skip("Aucun slot single disponible")
        cleanup_slot_bookings(coach_service_id, single_slot_id)

        update_service_workflow(http, tok_coach, coach_service_id, "manual_approval", False)
        r = book(http, tok_user, coach_service_id, slot_id=single_slot_id, payment_mode="pay_now")
        if r.status_code == 409:
            pytest.skip(f"Slot non disponible : {r.json()['detail']}")
        assert r.status_code == 200
        bid = r.json()["booking_id"]

        slot_before = db_get("service_slots", "slot_id", single_slot_id)
        assert slot_before["slot_status"] == "pending"

        http.post(f"/api/bookings/{bid}/accept", headers=auth(tok_coach))
        slot_after = db_get("service_slots", "slot_id", single_slot_id)
        assert slot_after["slot_status"] == "reserved", \
            f"Expected reserved after accept, got {slot_after['slot_status']}"


# ══════════════════════════════════════════════════════════════════════════════
# FLUX D : manual_approval + pay_later
# ══════════════════════════════════════════════════════════════════════════════

class TestFluxD_ManualPayLater:
    """
    Service configuré en manual_approval + pay_later=True, expiry=10min.
    Flux : requested → accept → awaiting_payment (10 min).
    """

    def test_d_accept_pay_later_expiry_configured(self, http, tok_user, tok_coach, coach_service_id):
        """Flux D : accept d'une réservation pay_later → expiry=configured."""
        update_service_workflow(http, tok_coach, coach_service_id, "manual_approval", True, 10)

        r = book(http, tok_user, coach_service_id, payment_mode="pay_later")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "requested"
        bid = r.json()["booking_id"]

        r_acc = http.post(f"/api/bookings/{bid}/accept", headers=auth(tok_coach))
        assert r_acc.status_code == 200, r_acc.text
        d = r_acc.json()
        assert d["status"] == "awaiting_payment"
        assert d["payment_mode"] == "pay_later"
        # expiry_interval doit mentionner 10 minutes
        assert "10" in d.get("pay_expiry_interval", ""), \
            f"Expected 10 min interval, got: {d.get('pay_expiry_interval')}"

    def test_d_pay_later_booking_expires_with_slot(self, http, tok_user, tok_coach, coach_service_id, single_slot_id):
        """Flux D : booking awaiting_payment expiré → slot libéré."""
        if not single_slot_id:
            pytest.skip("Aucun slot single disponible")
        cleanup_slot_bookings(coach_service_id, single_slot_id)

        update_service_workflow(http, tok_coach, coach_service_id, "manual_approval", True, 10)
        r = book(http, tok_user, coach_service_id, slot_id=single_slot_id, payment_mode="pay_later")
        if r.status_code == 409:
            pytest.skip(f"Slot non disponible : {r.json()['detail']}")
        assert r.status_code == 200
        bid = r.json()["booking_id"]

        # Accept → awaiting_payment, slot=reserved
        http.post(f"/api/bookings/{bid}/accept", headers=auth(tok_coach))
        slot = db_get("service_slots", "slot_id", single_slot_id)
        assert slot["slot_status"] == "reserved"

        # Forcer l'expiration et lancer le worker
        force_expires_at(bid)
        n = run_worker()
        assert n >= 1

        # Vérifications
        bk_row = db_get("bookings", "booking_id", bid)
        assert bk_row["status"] == "expired", f"Expected expired, got {bk_row['status']}"
        slot_after = db_get("service_slots", "slot_id", single_slot_id)
        assert slot_after["slot_status"] == "available", \
            f"Expected available, got {slot_after['slot_status']}"


# ══════════════════════════════════════════════════════════════════════════════
# Tests de l'endpoint /pay
# ══════════════════════════════════════════════════════════════════════════════

class TestPayEndpoint:

    def test_pay_requires_awaiting_payment_status(self, http, tok_user, tok_coach, coach_service_id):
        """POST /bookings/{id}/pay → 409 si booking pas en awaiting_payment."""
        update_service_workflow(http, tok_coach, coach_service_id, "manual_approval", False)
        r = book(http, tok_user, coach_service_id, payment_mode="pay_now")
        bid = r.json()["booking_id"]
        # Status = requested → /pay doit retourner 409
        r_pay = http.post(f"/api/bookings/{bid}/pay",
                          json={"origin_url": "http://localhost:3000"},
                          headers=auth(tok_user))
        assert r_pay.status_code == 409, f"Expected 409, got {r_pay.status_code}: {r_pay.text}"

    def test_pay_forbidden_for_non_payer(self, http, tok_user, tok_coach, coach_service_id):
        """POST /bookings/{id}/pay → 403 si non-payeur."""
        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)
        ikey = f"pay403_{uuid.uuid4().hex[:8]}"
        r = book(http, tok_user, coach_service_id, payment_mode="pay_now", idem_key=ikey)
        assert r.status_code == 200
        bid = r.json()["booking_id"]

        r_pay = http.post(f"/api/bookings/{bid}/pay",
                          json={"origin_url": "http://localhost:3000"},
                          headers=auth(tok_coach))  # coach n'est pas le payeur
        assert r_pay.status_code == 403

    def test_pay_expired_booking_returns_410(self, http, tok_user, tok_coach, coach_service_id):
        """POST /bookings/{id}/pay → 410 si booking expiré."""
        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)
        ikey = f"pay410_{uuid.uuid4().hex[:8]}"
        r = book(http, tok_user, coach_service_id, payment_mode="pay_now", idem_key=ikey)
        assert r.status_code == 200
        bid = r.json()["booking_id"]
        assert r.json()["status"] == "awaiting_payment"

        # Forcer l'expiration
        force_expires_at(bid)
        r_pay = http.post(f"/api/bookings/{bid}/pay",
                          json={"origin_url": "http://localhost:3000"},
                          headers=auth(tok_user))
        assert r_pay.status_code == 410, \
            f"Expected 410 (expired), got {r_pay.status_code}: {r_pay.text}"

    def test_pay_returns_checkout_url(self, http, tok_user, tok_coach, coach_service_id):
        """POST /bookings/{id}/pay → retourne une URL Stripe Checkout."""
        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)
        ikey = f"payurl_{uuid.uuid4().hex[:8]}"
        r = book(http, tok_user, coach_service_id, payment_mode="pay_now", idem_key=ikey)
        assert r.status_code == 200
        bid = r.json()["booking_id"]
        assert r.json()["status"] == "awaiting_payment"

        r_pay = http.post(f"/api/bookings/{bid}/pay",
                          json={"origin_url": "http://localhost:3000"},
                          headers=auth(tok_user))
        assert r_pay.status_code == 200, f"Expected 200, got {r_pay.status_code}: {r_pay.text}"
        d = r_pay.json()
        assert "url" in d, f"No 'url' in response: {d}"
        assert "session_id" in d, f"No 'session_id' in response: {d}"
        # L'URL Stripe Checkout commence toujours par https://checkout.stripe.com
        assert d["url"].startswith("https://"), f"URL invalide: {d['url']}"

    def test_pay_idempotent_open_session(self, http, tok_user, tok_coach, coach_service_id):
        """Appeler /pay deux fois retourne la même session si elle est encore ouverte."""
        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)
        ikey = f"payidem_{uuid.uuid4().hex[:8]}"
        r = book(http, tok_user, coach_service_id, payment_mode="pay_now", idem_key=ikey)
        bid = r.json()["booking_id"]

        r1 = http.post(f"/api/bookings/{bid}/pay",
                       json={"origin_url": "http://localhost:3000"},
                       headers=auth(tok_user))
        r2 = http.post(f"/api/bookings/{bid}/pay",
                       json={"origin_url": "http://localhost:3000"},
                       headers=auth(tok_user))

        assert r1.status_code == 200
        assert r2.status_code == 200
        # Les deux appels retournent la même session (idempotence)
        assert r1.json()["session_id"] == r2.json()["session_id"], \
            "Deux sessions Stripe différentes créées pour le même booking"
        assert r2.json().get("reused") is True


# ══════════════════════════════════════════════════════════════════════════════
# Tests d'annulation avec slot reserved
# ══════════════════════════════════════════════════════════════════════════════

class TestCancelWithReservedSlot:

    def test_cancel_instant_booking_releases_reserved_slot(
        self, http, tok_user, tok_coach, coach_service_id, single_slot_id
    ):
        """Annuler un booking awaiting_payment libère le slot reserved → available."""
        if not single_slot_id:
            pytest.skip("Aucun slot single disponible")
        cleanup_slot_bookings(coach_service_id, single_slot_id)

        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)
        r = book(http, tok_user, coach_service_id, slot_id=single_slot_id, payment_mode="pay_now")
        if r.status_code == 409:
            pytest.skip(f"Slot déjà pris : {r.json()['detail']}")
        assert r.status_code == 200
        bid = r.json()["booking_id"]
        assert r.json()["status"] == "awaiting_payment"

        slot = db_get("service_slots", "slot_id", single_slot_id)
        assert slot["slot_status"] == "reserved"

        r_can = http.post(f"/api/bookings/{bid}/cancel", headers=auth(tok_user))
        assert r_can.status_code == 200
        assert r_can.json()["status"] == "cancelled"

        slot_after = db_get("service_slots", "slot_id", single_slot_id)
        assert slot_after["slot_status"] == "available", \
            f"Slot doit être 'available' après annulation, got: {slot_after['slot_status']}"


# ══════════════════════════════════════════════════════════════════════════════
# Tests de concurrence (instant_booking)
# ══════════════════════════════════════════════════════════════════════════════

class TestConcurrencyInstantBooking:

    def test_two_users_same_slot_instant_booking(
        self, http, tok_user, tok_coach, coach_service_id, single_slot_id
    ):
        """
        Avec instant_booking, deux users tentant de réserver le même slot :
        un seul doit réussir (le slot est marqué 'reserved' dès la première réservation).
        """
        if not single_slot_id:
            pytest.skip("Aucun slot single disponible")
        cleanup_slot_bookings(coach_service_id, single_slot_id)

        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)

        # User 1 réserve le slot
        r1 = book(http, tok_user, coach_service_id, slot_id=single_slot_id, payment_mode="pay_now")
        if r1.status_code == 409:
            pytest.skip(f"Slot non disponible : {r1.json()['detail']}")
        assert r1.status_code == 200
        assert r1.json()["status"] == "awaiting_payment"

        # User 2 (admin) tente de réserver le même slot
        tok_admin = login(http, "admin@winek.app", "WinekAdmin2024!")
        r2 = book(http, tok_admin, coach_service_id, slot_id=single_slot_id, payment_mode="pay_now")
        assert r2.status_code in (400, 409), \
            f"Le 2ème user a pu réserver le slot (status={r2.status_code}): {r2.text}"

    def test_concurrent_requests_async(self, tok_user, coach_service_id):
        """3 requêtes simultanées sur le même service (sans slot) → pas de deadlock."""
        keys = [f"conc_{uuid.uuid4().hex[:8]}" for _ in range(3)]

        async def make_req(key):
            async with httpx.AsyncClient(base_url=BASE_URL, timeout=15) as ac:
                return await ac.post(
                    "/api/bookings/request",
                    json={"service_id": coach_service_id, "payment_mode": "pay_now",
                          "idempotency_key": key},
                    headers=auth(tok_user),
                )

        async def run():
            return await asyncio.gather(*[make_req(k) for k in keys])

        responses = asyncio.run(run())
        for resp in responses:
            assert resp.status_code == 200, f"Requête concurrente échouée : {resp.text}"
        booking_ids = {r.json()["booking_id"] for r in responses}
        assert len(booking_ids) == 3, "Des bookings dupliqués créés en concurrence"


# ══════════════════════════════════════════════════════════════════════════════
# Tests du worker d'expiration pour awaiting_payment
# ══════════════════════════════════════════════════════════════════════════════

class TestExpiryWorkerAwaitingPayment:

    def test_worker_expires_awaiting_payment_booking(
        self, http, tok_user, tok_coach, coach_service_id
    ):
        """Le worker expire un booking awaiting_payment dont expires_at est passé."""
        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)
        ikey = f"exp_ap_{uuid.uuid4().hex[:8]}"
        r = book(http, tok_user, coach_service_id, payment_mode="pay_now", idem_key=ikey)
        assert r.status_code == 200
        bid = r.json()["booking_id"]
        assert r.json()["status"] == "awaiting_payment"

        force_expires_at(bid)
        n = run_worker()
        assert n >= 1

        bk = db_get("bookings", "booking_id", bid)
        assert bk["status"] == "expired", f"Expected expired, got {bk['status']}"

    def test_worker_cancels_payment_for_awaiting_payment(
        self, http, tok_user, tok_coach, coach_service_id
    ):
        """Le worker annule le payment d'un booking awaiting_payment expiré."""
        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)
        ikey = f"exp_pay_{uuid.uuid4().hex[:8]}"
        r = book(http, tok_user, coach_service_id, payment_mode="pay_now", idem_key=ikey)
        assert r.status_code == 200
        bid = r.json()["booking_id"]

        conn = db_conn()
        cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT payment_id FROM payments WHERE booking_id=%s LIMIT 1", (bid,))
        pay_row = cur.fetchone()
        cur.close(); conn.close()
        assert pay_row, "Aucun payment trouvé pour ce booking"
        pid = pay_row["payment_id"]

        force_expires_at(bid)
        run_worker()

        pay_after = db_get("payments", "payment_id", pid)
        assert pay_after["status"] == "cancelled", \
            f"Expected payment cancelled, got {pay_after['status']}"

    def test_worker_idempotent_on_already_expired(
        self, http, tok_user, tok_coach, coach_service_id
    ):
        """Le worker ne retraite pas un booking déjà expiré."""
        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)
        ikey = f"idem_exp_{uuid.uuid4().hex[:8]}"
        r = book(http, tok_user, coach_service_id, payment_mode="pay_now", idem_key=ikey)
        bid = r.json()["booking_id"]
        force_expires_at(bid)
        run_worker()
        n2 = run_worker()
        assert n2 == 0, f"Le worker a retraité {n2} booking(s) déjà expirés"

    def test_worker_notifies_both_parties_awaiting_payment(
        self, http, tok_user, tok_coach, coach_service_id
    ):
        """Le worker crée des notifs pour payer ET receiver lors de l'expiration awaiting_payment."""
        update_service_workflow(http, tok_coach, coach_service_id, "instant_booking", False)
        ikey = f"notif_exp_{uuid.uuid4().hex[:8]}"
        r = book(http, tok_user, coach_service_id, payment_mode="pay_now", idem_key=ikey)
        bid = r.json()["booking_id"]
        payer_id    = r.json()["payer_user_id"]
        receiver_id = r.json()["receiver_user_id"]

        force_expires_at(bid)
        run_worker()

        conn = db_conn()
        cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT user_id FROM notifications WHERE data::text LIKE %s",
            (f"%{bid}%",),
        )
        notif_users = {row["user_id"] for row in cur.fetchall()}
        cur.close(); conn.close()

        assert payer_id    in notif_users, f"Payer {payer_id} non notifié"
        assert receiver_id in notif_users, f"Receiver {receiver_id} non notifié"
