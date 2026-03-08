"""
test_booking_expiry.py
======================
Tests du worker d'expiration automatique des bookings SpotU.

Stratégie :
- HTTP via httpx (sync) pour les appels API
- psycopg2 (sync) pour les assertions/mutations directes en DB
- asyncio.run() + asyncpg fresh pool pour appeler expire_stale_bookings()
  → élimine tout conflit de boucle event loop
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

# Ajouter le répertoire backend au path (pour importer expiry_worker)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

BASE_URL   = os.environ.get("TEST_BASE_URL", "http://localhost:8001")
DB_DSN     = "dbname=winek_db user=winek password=winek2024 host=localhost port=5432"
ASYNCPG_DSN = os.environ.get("DATABASE_URL",
              "postgresql://winek:winek2024@localhost:5432/winek_db")


# ── Helpers sync ──────────────────────────────────────────────────────────────

def db():
    """Connexion psycopg2 RealDictCursor."""
    conn = psycopg2.connect(DB_DSN)
    conn.autocommit = False
    return conn


def run_worker() -> int:
    """Lance expire_stale_bookings() avec un pool asyncpg frais."""
    from expiry_worker import expire_stale_bookings

    async def _run():
        pool = await asyncpg.create_pool(ASYNCPG_DSN, min_size=1, max_size=2, timeout=10)
        try:
            return await expire_stale_bookings(pool)
        finally:
            await pool.close()

    return asyncio.run(_run())


def login(client, email, password):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def insert_expired_booking(service_id: str, with_slot: bool = False) -> dict:
    """
    Insère en DB un booking 'requested' dont expires_at est dans le passé.
    Si with_slot=True, cherche un slot specific disponible et le verrouille.
    Retourne {booking_id, payment_id, slot_id, payer_id, receiver_id}.
    """
    from models import new_id as _nid

    bid = _nid("bkg")
    pid = _nid("pay")
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()

    conn = db()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # Récupérer coach du service
        cur.execute("SELECT coach_id FROM services WHERE service_id=%s", (service_id,))
        svc = cur.fetchone()
        assert svc, f"Service {service_id} introuvable"
        receiver_id = svc["coach_id"]
        payer_id    = "user_demo001"

        slot_id = None
        if with_slot:
            cur.execute(
                """SELECT slot_id FROM service_slots
                   WHERE service_id=%s AND slot_status='available'
                     AND slot_type IN ('single','specific')
                     AND slot_id NOT IN (
                         SELECT slot_id FROM bookings
                         WHERE slot_id IS NOT NULL
                           AND user_id=%s
                           AND status NOT IN ('refused','cancelled','expired')
                     )
                   LIMIT 1""",
                (service_id, payer_id),
            )
            slot_row = cur.fetchone()
            slot_id  = slot_row["slot_id"] if slot_row else None

        cur.execute(
            """INSERT INTO bookings
               (booking_id, service_id, user_id, coach_id, status,
                payer_user_id, receiver_user_id, amount, currency,
                pricing_snapshot, payment_status, slot_id, expires_at)
               VALUES (%s,%s,%s,%s,'requested',%s,%s,60,'EUR',
                       '{}'::jsonb,'pending',%s,%s)""",
            (bid, service_id, payer_id, receiver_id,
             payer_id, receiver_id, slot_id, past),
        )
        cur.execute(
            """INSERT INTO payments
               (payment_id, payer_user_id, receiver_user_id,
                product_type, booking_id, status, currency,
                base_amount, payer_total_amount, receiver_net_amount,
                platform_total_fee, payer_fixed_fee, payer_percent_fee_amount,
                receiver_fixed_fee, receiver_percent_fee_amount, pricing_rule_snapshot)
               VALUES (%s,%s,%s,'service_booking',%s,'requires_authorization','EUR',
                       60,63,55,8,1.5,1.5,1,1,'{}')""",
            (pid, payer_id, receiver_id, bid),
        )
        if slot_id:
            cur.execute(
                "UPDATE service_slots SET slot_status='pending' WHERE slot_id=%s", (slot_id,)
            )
        conn.commit()
        return {
            "booking_id": bid, "payment_id": pid,
            "slot_id": slot_id, "payer_id": payer_id, "receiver_id": receiver_id,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def get_row(table: str, pk_col: str, pk_val: str) -> dict | None:
    """Lecture directe d'une ligne en DB."""
    conn = db()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(f"SELECT * FROM {table} WHERE {pk_col}=%s", (pk_val,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return dict(row) if row else None


def force_expires_at(booking_id: str, past_hours: int = 1):
    """Force expires_at dans le passé sans changer le status."""
    conn = db()
    cur  = conn.cursor()
    cur.execute(
        "UPDATE bookings SET expires_at=NOW()-INTERVAL %s WHERE booking_id=%s",
        (f"{past_hours} hours", booking_id),
    )
    conn.commit()
    cur.close()
    conn.close()


# ── Fixtures ──────────────────────────────────────────────────────────────────

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
def service_id(http, tok_coach):
    """Récupère le service du coach (always owned by tok_coach for accept/refuse tests)."""
    r = http.get("/api/services/mine", headers={"Authorization": f"Bearer {tok_coach}"})
    assert r.status_code == 200, f"GET /services/mine failed: {r.text}"
    svcs = r.json()
    assert svcs, "Le coach n'a aucun service enregistré"
    return svcs[0]["service_id"]


@pytest.fixture(scope="module", autouse=True)
def ensure_manual_approval_mode(http, tok_coach, service_id):
    """Reset service to manual_approval + allow_pay_later=True before/after all tests in this module."""
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
    # Restore after all tests
    http.patch(
        f"/api/services/{service_id}",
        json=reset_payload,
        headers={"Authorization": f"Bearer {tok_coach}"},
    )


# ══════════════════════════════════════════════════════════════════════════════
# 1. expires_at posé à la création
# ══════════════════════════════════════════════════════════════════════════════

class TestExpiresAtCreation:

    def test_expires_at_set_on_booking_request(self, http, tok_user, service_id):
        """Un booking créé via API doit avoir expires_at = created_at + TTL."""
        r = http.post("/api/bookings/request",
                      json={"service_id": service_id},
                      headers={"Authorization": f"Bearer {tok_user}"})
        assert r.status_code == 200, r.text
        bid = r.json()["booking_id"]
        row = get_row("bookings", "booking_id", bid)
        assert row["expires_at"] is not None, "expires_at non posé"
        delta = row["expires_at"] - row["created_at"]
        ttl_hours = int(os.environ.get("BOOKING_EXPIRY_HOURS", "48"))
        assert abs(delta.total_seconds() - ttl_hours * 3600) < 300, \
            f"expires_at incorrect : delta={delta}"

    def test_expires_at_returned_in_api(self, http, tok_user, service_id):
        """expires_at doit être exposé dans la réponse JSON."""
        r = http.post("/api/bookings/request",
                      json={"service_id": service_id},
                      headers={"Authorization": f"Bearer {tok_user}"})
        assert r.status_code == 200
        assert r.json().get("expires_at") is not None, "expires_at absent de la réponse"


# ══════════════════════════════════════════════════════════════════════════════
# 2. Worker d'expiration
# ══════════════════════════════════════════════════════════════════════════════

class TestExpiryWorker:

    def test_worker_expires_booking(self, service_id):
        """Le worker passe requested → expired."""
        fixture = insert_expired_booking(service_id)
        bid = fixture["booking_id"]
        n = run_worker()
        assert n >= 1
        assert get_row("bookings", "booking_id", bid)["status"] == "expired"

    def test_worker_releases_slot(self, service_id):
        """Le worker libère le slot (pending → available)."""
        fixture = insert_expired_booking(service_id, with_slot=True)
        slot_id = fixture["slot_id"]
        if not slot_id:
            pytest.skip("Aucun slot specific disponible")
        run_worker()
        assert get_row("service_slots", "slot_id", slot_id)["slot_status"] == "available"

    def test_worker_cancels_payment(self, service_id):
        """Le worker annule le payment (requires_authorization → cancelled)."""
        fixture = insert_expired_booking(service_id)
        pid = fixture["payment_id"]
        run_worker()
        assert get_row("payments", "payment_id", pid)["status"] == "cancelled"

    def test_worker_creates_notifications(self, service_id):
        """Le worker crée des notifs pour le payer ET le receiver."""
        fixture = insert_expired_booking(service_id)
        bid     = fixture["booking_id"]
        run_worker()
        conn = db()
        cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT user_id FROM notifications WHERE data::text LIKE %s",
            (f"%{bid}%",),
        )
        notif_users = {r["user_id"] for r in cur.fetchall()}
        cur.close(); conn.close()
        assert fixture["payer_id"]    in notif_users, "Payer non notifié"
        assert fixture["receiver_id"] in notif_users, "Receiver non notifié"

    def test_worker_idempotent(self, service_id):
        """Lancer le worker deux fois ne retraite pas les bookings déjà expirés."""
        insert_expired_booking(service_id)   # au moins un booking expiré
        run_worker()
        n2 = run_worker()
        assert n2 == 0, f"Le worker a retraité {n2} booking(s) déjà expirés"

    def test_worker_skips_non_expired_bookings(self, http, tok_user, service_id):
        """Le worker ne touche pas les bookings non expirés."""
        r = http.post("/api/bookings/request",
                      json={"service_id": service_id},
                      headers={"Authorization": f"Bearer {tok_user}"})
        assert r.status_code == 200
        bid = r.json()["booking_id"]
        run_worker()
        assert get_row("bookings", "booking_id", bid)["status"] == "requested"

    def test_worker_expires_awaiting_payment(self, http, tok_user, tok_coach, service_id):
        """
        Un booking 'awaiting_payment' dont expires_at est passé DOIT être expiré.
        Comportement voulu du nouveau workflow v2.
        """
        r = http.post("/api/bookings/request",
                      json={"service_id": service_id},
                      headers={"Authorization": f"Bearer {tok_user}"})
        bid = r.json()["booking_id"]
        # Accept → awaiting_payment
        r_acc = http.post(f"/api/bookings/{bid}/accept",
                          headers={"Authorization": f"Bearer {tok_coach}"})
        assert r_acc.status_code == 200
        assert r_acc.json()["status"] == "awaiting_payment"

        # Forcer l'expiration
        force_expires_at(bid)
        run_worker()
        # Le worker DOIT expirer ce booking (l'utilisateur n'a pas payé à temps)
        assert get_row("bookings", "booking_id", bid)["status"] == "expired"

    def test_worker_skips_completed_booking(self, http, tok_user, service_id):
        """Un booking 'completed' ne doit PAS être expiré par le worker."""
        # Créer un booking et le marquer directement 'completed' en DB
        r = http.post("/api/bookings/request",
                      json={"service_id": service_id},
                      headers={"Authorization": f"Bearer {tok_user}"})
        bid = r.json()["booking_id"]
        conn = db()
        cur  = conn.cursor()
        cur.execute("UPDATE bookings SET status='completed', expires_at=NOW()-INTERVAL '1 hour' WHERE booking_id=%s", (bid,))
        conn.commit()
        cur.close(); conn.close()

        run_worker()
        assert get_row("bookings", "booking_id", bid)["status"] == "completed"


# ══════════════════════════════════════════════════════════════════════════════
# 3. Guard TTL sur /accept
# ══════════════════════════════════════════════════════════════════════════════

class TestAcceptExpiredGuard:

    def test_accept_expired_booking_returns_410(self, http, tok_user, tok_coach, service_id):
        """Accepter un booking expiré → 410 Gone."""
        r = http.post("/api/bookings/request",
                      json={"service_id": service_id},
                      headers={"Authorization": f"Bearer {tok_user}"})
        assert r.status_code == 200
        bid = r.json()["booking_id"]
        force_expires_at(bid)

        r_acc = http.post(f"/api/bookings/{bid}/accept",
                          headers={"Authorization": f"Bearer {tok_coach}"})
        assert r_acc.status_code == 410, \
            f"Expected 410, got {r_acc.status_code}: {r_acc.text}"
        assert "expiré" in r_acc.json()["detail"].lower()

    def test_accept_valid_booking_succeeds(self, http, tok_user, tok_coach, service_id):
        """Accepter un booking non expiré → 200, status=awaiting_payment."""
        r = http.post("/api/bookings/request",
                      json={"service_id": service_id},
                      headers={"Authorization": f"Bearer {tok_user}"})
        assert r.status_code == 200
        bid = r.json()["booking_id"]
        r_acc = http.post(f"/api/bookings/{bid}/accept",
                          headers={"Authorization": f"Bearer {tok_coach}"})
        assert r_acc.status_code == 200
        assert r_acc.json()["status"] == "awaiting_payment"


# ══════════════════════════════════════════════════════════════════════════════
# 4. Slot libéré → re-réservable
# ══════════════════════════════════════════════════════════════════════════════

class TestSlotReleasedAfterExpiry:

    def test_slot_rebooked_after_expiry(self, http, tok_user, service_id):
        """Après expiration + worker, le slot redevient available et peut être re-réservé."""
        fixture = insert_expired_booking(service_id, with_slot=True)
        slot_id = fixture["slot_id"]
        if not slot_id:
            pytest.skip("Aucun slot specific libre sans conflit de booking demo")

        # Worker libère le slot
        run_worker()

        slot_status = get_row("service_slots", "slot_id", slot_id)["slot_status"]
        assert slot_status == "available", f"Slot toujours '{slot_status}' après worker"

        # Re-réservation via API (avec slot_id) — doit réussir
        r = http.post("/api/bookings/request",
                      json={"service_id": service_id, "slot_id": slot_id},
                      headers={"Authorization": f"Bearer {tok_user}"})
        assert r.status_code == 200, f"Rebooking échoué : {r.text}"
