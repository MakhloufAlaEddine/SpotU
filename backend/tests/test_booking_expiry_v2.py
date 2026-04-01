"""
test_booking_expiry_v2.py
=========================
Tests du worker d'expiration des bookings sur winek_test.

Stratégie :
  - asyncpg DIRECT → DATABASE_URL (winek_test si TEST_ENV=test)
  - Import direct de expiry_worker.expire_stale_bookings()
  - Zéro appel HTTP : 100% isolé sur winek_test
  - Chaque test crée ses données, les nettoie après assertion

Prérequis :
  - Base winek_test initialisée (bash /app/backend/scripts/reset_test_db.sh)
  - Variable DATABASE_URL pointant sur winek_test

Usage :
    TEST_ENV=test python -m pytest tests/test_booking_expiry_v2.py -v
    bash /app/backend/scripts/run_tests.sh tests/test_booking_expiry_v2.py -v
"""

import asyncio
import asyncpg
import os
import uuid
import pytest
from datetime import datetime, timezone, timedelta

# ── Import du worker à tester (pythonpath = . via pytest.ini) ─────────────────
from expiry_worker import expire_stale_bookings

DB_URL = os.environ.get("DATABASE_URL")

# ── IDs stables pour les entités partagées (module scope) ─────────────────────
_PAYER_ID    = "usr_exp_payer_v2_test"
_RECEIVER_ID = "usr_exp_rcv_v2_test"
_SERVICE_ID  = "svc_exp_v2_test"


# ── Générateurs d'IDs uniques ─────────────────────────────────────────────────

def _bkg_id() -> str:
    return f"bkg_exp_{uuid.uuid4().hex[:14]}"

def _pay_id() -> str:
    return f"pay_exp_{uuid.uuid4().hex[:14]}"

def _slot_id() -> str:
    return f"slot_exp_{uuid.uuid4().hex[:14]}"

def _past(minutes: int = 60) -> datetime:
    """Datetime dans le passé (booking expiré)."""
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)

def _future(hours: int = 48) -> datetime:
    """Datetime dans le futur (booking non expiré)."""
    return datetime.now(timezone.utc) + timedelta(hours=hours)


# ══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
async def pool():
    """Pool asyncpg pointant sur DATABASE_URL (winek_test en TEST_ENV=test)."""
    assert DB_URL, (
        "DATABASE_URL non défini.\n"
        "Lancer avec : TEST_ENV=test python -m pytest ..."
        " ou bash /app/backend/scripts/run_tests.sh"
    )
    is_local = "127.0.0.1" in DB_URL or "localhost" in DB_URL
    p = await asyncpg.create_pool(
        DB_URL,
        min_size=2,
        max_size=5,
        ssl=False if is_local else None,
    )
    yield p
    await p.close()


@pytest.fixture(scope="module")
async def test_entities(pool):
    """
    Crée les entités stables (users + service) nécessaires à tous les tests.
    ON CONFLICT DO NOTHING : idempotent si ces IDs existent déjà dans winek_test.
    Teardown : supprime toutes les notifications liées à ces entités.
    """
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO users (user_id, name, role, email)
               VALUES
                 ($1, 'Payer Expiry Test',    'user',  'payer_exptest@test.local'),
                 ($2, 'Receiver Expiry Test', 'coach', 'receiver_exptest@test.local')
               ON CONFLICT (user_id) DO NOTHING""",
            _PAYER_ID, _RECEIVER_ID,
        )
        await conn.execute(
            """INSERT INTO services
               (service_id, coach_id, title, price, booking_approval_mode, allow_pay_later)
               VALUES ($1, $2, 'Service ExpTest v2', 50.0, 'manual_approval', false)
               ON CONFLICT (service_id) DO NOTHING""",
            _SERVICE_ID, _RECEIVER_ID,
        )

    yield {"payer_id": _PAYER_ID, "receiver_id": _RECEIVER_ID, "service_id": _SERVICE_ID}

    # Teardown : suppression des notifications liées à ces users de test
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM notifications WHERE user_id = ANY($1::text[])",
            [_PAYER_ID, _RECEIVER_ID],
        )
        await conn.execute("DELETE FROM services WHERE service_id=$1", _SERVICE_ID)
        await conn.execute(
            "DELETE FROM users WHERE user_id = ANY($1::text[])",
            [_PAYER_ID, _RECEIVER_ID],
        )


# ── Helpers d'insertion / nettoyage ───────────────────────────────────────────

async def _insert_expired_booking(
    conn,
    entities: dict,
    *,
    status: str = "requested",
    slot_id: str | None = None,
    payment_status: str | None = None,
    slot_type: str = "single",
) -> dict:
    """
    Insère un booking expiré (expires_at = il y a 60 min) avec optionnellement
    un slot et/ou un payment.  Retourne un dict {booking_id, payment_id, slot_id}.
    """
    bid = _bkg_id()
    pid = None

    # Slot (optionnel) : pending pour requested, reserved pour awaiting_payment
    if slot_id:
        initial_slot_status = "reserved" if status == "awaiting_payment" else "pending"
        await conn.execute(
            """INSERT INTO service_slots
               (slot_id, service_id, start_time, end_time, slot_type, slot_status)
               VALUES ($1, $2, '10:00', '11:00', $3, $4)
               ON CONFLICT (slot_id) DO NOTHING""",
            slot_id, entities["service_id"], slot_type, initial_slot_status,
        )

    # Booking expiré
    await conn.execute(
        """INSERT INTO bookings
           (booking_id, service_id, user_id, coach_id, status,
            payer_user_id, receiver_user_id, expires_at, payment_mode)
           VALUES ($1, $2, $3, $4, $5, $3, $4, $6, 'pay_now')""",
        bid,
        entities["service_id"],
        entities["payer_id"],
        entities["receiver_id"],
        status,
        _past(60),
    )
    if slot_id:
        await conn.execute(
            "UPDATE bookings SET slot_id=$1 WHERE booking_id=$2",
            slot_id, bid,
        )

    # Payment (optionnel)
    if payment_status:
        pid = _pay_id()
        await conn.execute(
            """INSERT INTO payments
               (payment_id, payer_user_id, receiver_user_id, product_type,
                booking_id, base_amount, payer_total_amount, receiver_net_amount,
                platform_total_fee, status, currency,
                stripe_payment_intent_id)
               VALUES ($1, $2, $3, 'service_booking',
                       $4, 50, 50, 50, 0, $5, 'eur', NULL)""",
            pid,
            entities["payer_id"],
            entities["receiver_id"],
            bid,
            payment_status,
        )

    return {"booking_id": bid, "payment_id": pid, "slot_id": slot_id}


async def _cleanup(conn, bid: str, pid: str | None = None, sid: str | None = None):
    """Supprime le booking + payment + slot + leurs notifications de test."""
    await conn.execute(
        "DELETE FROM notifications WHERE data::text LIKE $1",
        f'%"bookingId": "{bid}"%',
    )
    if pid:
        await conn.execute("DELETE FROM payments WHERE payment_id=$1", pid)
    await conn.execute("DELETE FROM bookings WHERE booking_id=$1", bid)
    if sid:
        await conn.execute("DELETE FROM service_slots WHERE slot_id=$1", sid)


# ══════════════════════════════════════════════════════════════════════════════
# [1] expires_at stocké en base
# ══════════════════════════════════════════════════════════════════════════════

class TestExpiresAtStorage:

    async def test_expires_at_stored_for_requested_booking(self, pool, test_entities):
        """Un booking 'requested' créé avec expires_at passé est bien persisté en DB."""
        bid = _bkg_id()
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO bookings
                   (booking_id, service_id, user_id, coach_id, status,
                    payer_user_id, receiver_user_id, expires_at, payment_mode)
                   VALUES ($1,$2,$3,$4,'requested',$3,$4,$5,'pay_now')""",
                bid,
                test_entities["service_id"],
                test_entities["payer_id"],
                test_entities["receiver_id"],
                _past(10),
            )
            row = await conn.fetchrow(
                "SELECT booking_id, expires_at, status FROM bookings WHERE booking_id=$1", bid
            )
            assert row is not None
            assert row["expires_at"] is not None
            assert row["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc)
            assert row["status"] == "requested"
            await conn.execute("DELETE FROM bookings WHERE booking_id=$1", bid)

    async def test_expires_at_stored_for_awaiting_payment_booking(self, pool, test_entities):
        """Un booking 'awaiting_payment' avec expires_at passé est bien persisté en DB."""
        bid = _bkg_id()
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO bookings
                   (booking_id, service_id, user_id, coach_id, status,
                    payer_user_id, receiver_user_id, expires_at, payment_mode)
                   VALUES ($1,$2,$3,$4,'awaiting_payment',$3,$4,$5,'pay_now')""",
                bid,
                test_entities["service_id"],
                test_entities["payer_id"],
                test_entities["receiver_id"],
                _past(10),
            )
            row = await conn.fetchrow(
                "SELECT status, expires_at FROM bookings WHERE booking_id=$1", bid
            )
            assert row["status"] == "awaiting_payment"
            assert row["expires_at"] is not None
            await conn.execute("DELETE FROM bookings WHERE booking_id=$1", bid)


# ══════════════════════════════════════════════════════════════════════════════
# [2] Worker d'expiration — transitions de statut
# ══════════════════════════════════════════════════════════════════════════════

class TestExpiryWorkerStatusTransitions:

    async def test_worker_expires_requested_booking(self, pool, test_entities):
        """Le worker transite un booking 'requested' expiré → 'expired'."""
        async with pool.acquire() as conn:
            data = await _insert_expired_booking(conn, test_entities, status="requested")

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT status FROM bookings WHERE booking_id=$1", data["booking_id"]
            )
            assert row["status"] == "expired", (
                f"Expected 'expired', got '{row['status']}'"
            )
            await _cleanup(conn, data["booking_id"])

    async def test_worker_expires_awaiting_payment_booking(self, pool, test_entities):
        """Le worker transite un booking 'awaiting_payment' expiré → 'expired'."""
        async with pool.acquire() as conn:
            data = await _insert_expired_booking(conn, test_entities, status="awaiting_payment")

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT status FROM bookings WHERE booking_id=$1", data["booking_id"]
            )
            assert row["status"] == "expired", (
                f"Expected 'expired', got '{row['status']}'"
            )
            await _cleanup(conn, data["booking_id"])

    async def test_worker_skips_non_expired_booking(self, pool, test_entities):
        """Un booking avec expires_at dans le futur N'EST PAS expiré par le worker."""
        bid = _bkg_id()
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO bookings
                   (booking_id, service_id, user_id, coach_id, status,
                    payer_user_id, receiver_user_id, expires_at, payment_mode)
                   VALUES ($1,$2,$3,$4,'requested',$3,$4,$5,'pay_now')""",
                bid,
                test_entities["service_id"],
                test_entities["payer_id"],
                test_entities["receiver_id"],
                _future(48),
            )

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT status FROM bookings WHERE booking_id=$1", bid
            )
            assert row["status"] == "requested", (
                f"Non-expired booking must stay 'requested', got '{row['status']}'"
            )
            await conn.execute("DELETE FROM bookings WHERE booking_id=$1", bid)

    async def test_worker_skips_confirmed_booking(self, pool, test_entities):
        """Un booking 'confirmed' (même avec expires_at passé) N'EST PAS touché."""
        bid = _bkg_id()
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO bookings
                   (booking_id, service_id, user_id, coach_id, status,
                    payer_user_id, receiver_user_id, expires_at, payment_mode)
                   VALUES ($1,$2,$3,$4,'confirmed',$3,$4,$5,'pay_now')""",
                bid,
                test_entities["service_id"],
                test_entities["payer_id"],
                test_entities["receiver_id"],
                _past(60),
            )

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT status FROM bookings WHERE booking_id=$1", bid
            )
            assert row["status"] == "confirmed", (
                f"Confirmed booking must stay 'confirmed', got '{row['status']}'"
            )
            await conn.execute("DELETE FROM bookings WHERE booking_id=$1", bid)

    async def test_worker_returns_correct_count(self, pool, test_entities):
        """Le worker retourne le nombre exact de bookings expirés dans ce run."""
        bids = []
        async with pool.acquire() as conn:
            for _ in range(3):
                data = await _insert_expired_booking(conn, test_entities, status="requested")
                bids.append(data["booking_id"])

        count = await expire_stale_bookings(pool)

        assert count >= 3, f"Expected at least 3, got {count}"

        async with pool.acquire() as conn:
            for bid in bids:
                await conn.execute("DELETE FROM bookings WHERE booking_id=$1", bid)


# ══════════════════════════════════════════════════════════════════════════════
# [3] Worker d'expiration — libération des slots
# ══════════════════════════════════════════════════════════════════════════════

class TestExpiryWorkerSlotRelease:

    async def test_worker_releases_pending_slot_to_available(self, pool, test_entities):
        """Le worker libère un slot 'pending' → 'available' (booking requested expiré)."""
        sid = _slot_id()
        async with pool.acquire() as conn:
            data = await _insert_expired_booking(
                conn, test_entities, status="requested", slot_id=sid
            )

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            slot = await conn.fetchrow(
                "SELECT slot_status FROM service_slots WHERE slot_id=$1", sid
            )
            assert slot["slot_status"] == "available", (
                f"Pending slot must be released to 'available', got '{slot['slot_status']}'"
            )
            await _cleanup(conn, data["booking_id"], sid=sid)

    async def test_worker_releases_reserved_slot_to_available(self, pool, test_entities):
        """Le worker libère un slot 'reserved' → 'available' (booking awaiting_payment expiré)."""
        sid = _slot_id()
        async with pool.acquire() as conn:
            data = await _insert_expired_booking(
                conn, test_entities, status="awaiting_payment", slot_id=sid
            )

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            slot = await conn.fetchrow(
                "SELECT slot_status FROM service_slots WHERE slot_id=$1", sid
            )
            assert slot["slot_status"] == "available", (
                f"Reserved slot must be released to 'available', got '{slot['slot_status']}'"
            )
            await _cleanup(conn, data["booking_id"], sid=sid)

    async def test_worker_does_not_release_recurring_slot(self, pool, test_entities):
        """Un slot 'recurring' N'EST PAS libéré par le worker (seuls single/specific le sont)."""
        sid = _slot_id()
        async with pool.acquire() as conn:
            data = await _insert_expired_booking(
                conn, test_entities,
                status="requested",
                slot_id=sid,
                slot_type="recurring",  # pas dans ('single', 'specific')
            )

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            slot = await conn.fetchrow(
                "SELECT slot_status FROM service_slots WHERE slot_id=$1", sid
            )
            assert slot["slot_status"] == "pending", (
                "Recurring slot should NOT be released by expiry worker"
            )
            await _cleanup(conn, data["booking_id"], sid=sid)

    async def test_slot_rereservable_after_expiry(self, pool, test_entities):
        """Après expiration, le slot libéré peut être re-verrouillé (nouveau booking)."""
        sid = _slot_id()
        async with pool.acquire() as conn:
            data = await _insert_expired_booking(
                conn, test_entities, status="awaiting_payment", slot_id=sid
            )

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            # Vérifie que le slot est available
            slot = await conn.fetchrow(
                "SELECT slot_status FROM service_slots WHERE slot_id=$1", sid
            )
            assert slot["slot_status"] == "available"

            # Simule une nouvelle réservation : UPDATE pending WHERE available
            updated = await conn.fetchval(
                """UPDATE service_slots
                   SET slot_status='pending'
                   WHERE slot_id=$1 AND slot_status='available'
                   RETURNING slot_id""",
                sid,
            )
            assert updated is not None, (
                "Slot libéré par le worker doit pouvoir être re-réservé"
            )

            await _cleanup(conn, data["booking_id"], sid=sid)


# ══════════════════════════════════════════════════════════════════════════════
# [4] Worker d'expiration — gestion des paiements
# ══════════════════════════════════════════════════════════════════════════════

class TestExpiryWorkerPaymentCancellation:

    async def test_worker_cancels_requires_authorization_payment(self, pool, test_entities):
        """Le worker annule un payment 'requires_authorization' quand le booking expire."""
        async with pool.acquire() as conn:
            data = await _insert_expired_booking(
                conn, test_entities,
                status="requested",
                payment_status="requires_authorization",
            )

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            pay = await conn.fetchrow(
                "SELECT status FROM payments WHERE payment_id=$1", data["payment_id"]
            )
            assert pay["status"] == "cancelled", (
                f"Payment must be cancelled, got '{pay['status']}'"
            )
            await _cleanup(conn, data["booking_id"], data["payment_id"])

    async def test_worker_cancels_authorized_payment(self, pool, test_entities):
        """Le worker annule un payment 'authorized' quand le booking expire."""
        async with pool.acquire() as conn:
            data = await _insert_expired_booking(
                conn, test_entities,
                status="awaiting_payment",
                payment_status="authorized",
            )

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            pay = await conn.fetchrow(
                "SELECT status FROM payments WHERE payment_id=$1", data["payment_id"]
            )
            assert pay["status"] == "cancelled"
            await _cleanup(conn, data["booking_id"], data["payment_id"])

    async def test_worker_does_not_cancel_captured_payment(self, pool, test_entities):
        """Le worker NE touche PAS un payment déjà 'captured' (état terminal)."""
        async with pool.acquire() as conn:
            data = await _insert_expired_booking(
                conn, test_entities,
                status="requested",
                payment_status="captured",
            )

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            pay = await conn.fetchrow(
                "SELECT status FROM payments WHERE payment_id=$1", data["payment_id"]
            )
            assert pay["status"] == "captured", (
                f"Captured payment must stay 'captured', got '{pay['status']}'"
            )
            await _cleanup(conn, data["booking_id"], data["payment_id"])

    async def test_worker_does_not_cancel_pending_payment(self, pool, test_entities):
        """Le worker NE touche PAS un payment 'pending' (pas encore autorisé)."""
        async with pool.acquire() as conn:
            data = await _insert_expired_booking(
                conn, test_entities,
                status="requested",
                payment_status="pending",
            )

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            pay = await conn.fetchrow(
                "SELECT status FROM payments WHERE payment_id=$1", data["payment_id"]
            )
            assert pay["status"] == "pending", (
                f"Pending payment (not yet authorized) must stay 'pending', got '{pay['status']}'"
            )
            await _cleanup(conn, data["booking_id"], data["payment_id"])


# ══════════════════════════════════════════════════════════════════════════════
# [5] Worker d'expiration — notifications
# ══════════════════════════════════════════════════════════════════════════════

class TestExpiryWorkerNotifications:

    async def test_worker_creates_two_notifications(self, pool, test_entities):
        """Le worker crée exactement 2 notifications (payer + receiver) par booking expiré."""
        async with pool.acquire() as conn:
            before = await conn.fetchval(
                "SELECT COUNT(*) FROM notifications WHERE user_id = ANY($1::text[])",
                [test_entities["payer_id"], test_entities["receiver_id"]],
            )
            data = await _insert_expired_booking(conn, test_entities, status="requested")

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            after = await conn.fetchval(
                "SELECT COUNT(*) FROM notifications WHERE user_id = ANY($1::text[])",
                [test_entities["payer_id"], test_entities["receiver_id"]],
            )
            assert after == before + 2, (
                f"Expected exactly 2 new notifications, got {after - before}"
            )
            await _cleanup(conn, data["booking_id"])

    async def test_worker_notifications_type_booking_expired(self, pool, test_entities):
        """Les notifications créées par le worker sont de type 'booking_expired'."""
        async with pool.acquire() as conn:
            data = await _insert_expired_booking(conn, test_entities, status="requested")

        await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            notifs = await conn.fetch(
                """SELECT type, user_id FROM notifications
                   WHERE data::text LIKE $1
                   ORDER BY created_at DESC""",
                f'%"bookingId": "{data["booking_id"]}"%',
            )
            assert len(notifs) >= 2, f"Expected >= 2 notifications, got {len(notifs)}"
            for n in notifs:
                assert n["type"] == "booking_expired", (
                    f"Notification type must be 'booking_expired', got '{n['type']}'"
                )
            notif_users = {n["user_id"] for n in notifs}
            assert test_entities["payer_id"] in notif_users, "Payer must be notified"
            assert test_entities["receiver_id"] in notif_users, "Receiver must be notified"
            await _cleanup(conn, data["booking_id"])

    async def test_worker_idempotent_no_duplicate_notifications(self, pool, test_entities):
        """Exécuter le worker 2× sur un booking déjà expiré ne crée pas de doublons."""
        async with pool.acquire() as conn:
            data = await _insert_expired_booking(conn, test_entities, status="requested")

        # 1er run : expire le booking, crée les notifs
        count_run1 = await expire_stale_bookings(pool)
        assert count_run1 >= 1

        async with pool.acquire() as conn:
            notif_after_run1 = await conn.fetchval(
                "SELECT COUNT(*) FROM notifications WHERE data::text LIKE $1",
                f'%"bookingId": "{data["booking_id"]}"%',
            )

        # 2ème run : booking déjà 'expired', ne doit plus être traité
        count_run2 = await expire_stale_bookings(pool)

        async with pool.acquire() as conn:
            notif_after_run2 = await conn.fetchval(
                "SELECT COUNT(*) FROM notifications WHERE data::text LIKE $1",
                f'%"bookingId": "{data["booking_id"]}"%',
            )
            assert count_run2 == 0, (
                f"2nd worker run must expire 0 bookings (already expired), got {count_run2}"
            )
            assert notif_after_run2 == notif_after_run1, (
                f"No duplicate notifications on 2nd run "
                f"({notif_after_run1} → {notif_after_run2})"
            )
            await _cleanup(conn, data["booking_id"])
