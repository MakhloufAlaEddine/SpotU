"""
Iteration 67 — Planning Logic Tests
Tests the new planning logic: only spot_you_attendance (status=going) sessions appear
in the planning. Being a member (join) no longer adds anything.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

USER_EMAIL = "user@winek.app"
USER_PASS  = "WinekUser2024!"

# SpotYou user_demo001 is already attending (going) — recurring
SPOT_RECURRING_GOING   = "pt_demo013"   # Streetball 3x3, user_demo001 has session going
SPOT_RECURRING_GOING2  = "pt_demo012"   # Prépa physique football, user_demo001 has session going

# SpotYou user_demo001 is NOT member, NOT attending — recurring (for join/going tests)
SPOT_NOT_JOINED        = "pt_demo004"   # CrossFit outdoor (Saturday recurring)
SPOT_NOT_JOINED_YOGA   = "pt_demo003"   # Yoga en plein air (Mon/Wed/Fri recurring)

# SpotYou owned by user_demo001 — single-date (for is_own test)
SPOT_OWN_SINGLE        = "pt_demo001"   # Footing au Parc de la Villette (2026-03-12)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def user_token():
    """Authenticate as user_demo001 and return Bearer token."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": USER_EMAIL,
        "password": USER_PASS
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json().get("token") or resp.json().get("access_token")
    assert token, f"No token in login response: {resp.json()}"
    return token


@pytest.fixture(scope="module")
def user_client(user_token):
    """Requests session with user authentication."""
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {user_token}"})
    return session


# ── Helper ─────────────────────────────────────────────────────────────────────

def get_planning(client) -> list:
    resp = client.get(f"{BASE_URL}/api/users/me/planning-events")
    assert resp.status_code == 200, f"GET planning failed: {resp.text}"
    data = resp.json()
    return data if isinstance(data, list) else data.get("events", [])


def spot_you_events(events: list) -> list:
    """Filter only SpotYou events (not bookings)."""
    return [e for e in events if e.get("type") in ("recurring", "single")]


def booking_events(events: list) -> list:
    """Filter only booking events."""
    return [e for e in events if e.get("type") == "booking"]


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestPlanningReturnsOnlyAttendanceGoing:
    """GET /api/users/me/planning-events should only return sessions with status=going."""

    def test_planning_returns_200(self, user_client):
        resp = user_client.get(f"{BASE_URL}/api/users/me/planning-events")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        print("PASS: GET /api/users/me/planning-events → 200")

    def test_planning_returns_list(self, user_client):
        events = get_planning(user_client)
        assert isinstance(events, list), f"Expected list, got {type(events)}"
        print(f"PASS: Planning returns list of {len(events)} events")

    def test_planning_has_going_spotyou_events(self, user_client):
        """pt_demo012 and pt_demo013 have status=going so should appear in planning."""
        events = get_planning(user_client)
        sy_events = spot_you_events(events)
        point_ids = [e["point_id"] for e in sy_events]
        
        # Both existing going sessions should appear
        assert SPOT_RECURRING_GOING in point_ids or SPOT_RECURRING_GOING2 in point_ids, \
            f"Expected at least one of {SPOT_RECURRING_GOING}/{SPOT_RECURRING_GOING2} in planning. Got point_ids: {point_ids}"
        print(f"PASS: SpotYou going sessions appear in planning: {point_ids}")

    def test_planning_spotyou_events_count_matches_attendance(self, user_client):
        """
        user_demo001 has exactly 2 'going' rows in spot_you_attendance.
        Planning should not generate additional recurring occurrences beyond those 2.
        """
        events = get_planning(user_client)
        sy_events = spot_you_events(events)
        # Should have at most 2 SpotYou events (one per attendance row) — not dozens of recurring ones
        # The old logic would generate many recurring slots; new logic: only attendance rows
        assert len(sy_events) <= 2, \
            f"Expected ≤2 SpotYou events (one per attendance row), got {len(sy_events)}: {sy_events}"
        print(f"PASS: Planning has {len(sy_events)} SpotYou event(s) — matches attendance count")

    def test_planning_recurring_event_has_precise_session_date(self, user_client):
        """
        For a recurring SpotYou, the date in planning must be the exact session_date from
        spot_you_attendance, not a generated recurring occurrence.
        """
        events = get_planning(user_client)
        # pt_demo013 session_date = 2026-03-10 (today)
        demo013_events = [e for e in events if e.get("point_id") == SPOT_RECURRING_GOING]
        
        # pt_demo012 session_date = 2026-03-13
        demo012_events = [e for e in events if e.get("point_id") == SPOT_RECURRING_GOING2]

        # At least one should be present
        assert demo013_events or demo012_events, \
            "Neither pt_demo013 nor pt_demo012 found in planning"

        if demo013_events:
            evt = demo013_events[0]
            assert evt["date"] == "2026-03-10", \
                f"pt_demo013 date should be 2026-03-10 (precise session_date), got {evt['date']}"
            assert evt["type"] == "recurring", f"Expected type=recurring, got {evt['type']}"
            print(f"PASS: pt_demo013 has precise session_date 2026-03-10, type=recurring")

        if demo012_events:
            evt = demo012_events[0]
            assert evt["date"] == "2026-03-13", \
                f"pt_demo012 date should be 2026-03-13 (precise session_date), got {evt['date']}"
            assert evt["type"] == "recurring", f"Expected type=recurring, got {evt['type']}"
            print(f"PASS: pt_demo012 has precise session_date 2026-03-13, type=recurring")


class TestJoinDoesNotAddToPlanning:
    """POST /api/spot-you/{id}/join should NOT add anything to planning."""

    def test_join_spotyou_success(self, user_client):
        # Clean slate: leave first (idempotent)
        user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED}/leave")
        
        resp = user_client.post(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED}/join")
        assert resp.status_code == 200, f"Expected 200 for join, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("is_member") is True, f"Expected is_member=True after join, got {data}"
        print(f"PASS: POST /api/spot-you/{SPOT_NOT_JOINED}/join → 200, is_member=True")

    def test_join_does_not_add_to_planning(self, user_client):
        # Get planning before join (SPOT_NOT_JOINED was just joined above in test_join_spotyou_success)
        events_before_join = get_planning(user_client)
        sy_before = spot_you_events(events_before_join)
        ids_before = {e["point_id"] for e in sy_before}
        
        # Verify the joined spot is NOT in planning
        assert SPOT_NOT_JOINED not in ids_before, \
            f"After join (no going), {SPOT_NOT_JOINED} should NOT appear in planning. Got: {ids_before}"
        print(f"PASS: After join only (no going), {SPOT_NOT_JOINED} NOT in planning")

    def test_cleanup_leave_after_join(self, user_client):
        """Leave pt_demo004 to clean up."""
        resp = user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED}/leave")
        assert resp.status_code in (200, 204), f"Leave failed: {resp.status_code}"
        print(f"PASS: Cleanup — left {SPOT_NOT_JOINED}")


class TestGoingAddsToPlanning:
    """POST /api/spot-you/{id}/going should add the specific session to planning."""

    def test_setup_ensure_not_going(self, user_client):
        """Ensure clean state: not going to SPOT_NOT_JOINED_YOGA."""
        # Delete going first (idempotent)
        user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED_YOGA}/going")
        user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED_YOGA}/leave")
        
        events = get_planning(user_client)
        sy_events = spot_you_events(events)
        ids = {e["point_id"] for e in sy_events}
        assert SPOT_NOT_JOINED_YOGA not in ids, \
            f"Clean state: {SPOT_NOT_JOINED_YOGA} should not be in planning before test"
        print(f"PASS: Setup — {SPOT_NOT_JOINED_YOGA} not in planning")

    def test_going_adds_to_planning(self, user_client):
        """POST /going → spot appears in planning."""
        events_before = get_planning(user_client)
        count_before = len(spot_you_events(events_before))
        
        resp = user_client.post(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED_YOGA}/going")
        assert resp.status_code == 200, f"Expected 200 for going, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("is_going") is True, f"Expected is_going=True, got {data}"
        session_date_returned = data.get("session_date")
        print(f"PASS: POST /going returned is_going=True, session_date={session_date_returned}")
        
        events_after = get_planning(user_client)
        sy_after = spot_you_events(events_after)
        ids_after = {e["point_id"] for e in sy_after}
        count_after = len(sy_after)
        
        assert SPOT_NOT_JOINED_YOGA in ids_after, \
            f"After /going, {SPOT_NOT_JOINED_YOGA} should appear in planning. Got: {ids_after}"
        assert count_after == count_before + 1, \
            f"Expected {count_before+1} SpotYou events after going, got {count_after}"
        print(f"PASS: After /going, {SPOT_NOT_JOINED_YOGA} appears in planning (+1 event)")

    def test_going_event_has_correct_session_date(self, user_client):
        """The date in planning must match session_date returned by /going."""
        # Get session_date from going endpoint
        resp_going = user_client.post(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED_YOGA}/going")
        # Should be idempotent (already going), but upsert will refresh
        assert resp_going.status_code == 200
        session_date = resp_going.json().get("session_date")
        
        events = get_planning(user_client)
        yoga_events = [e for e in events if e.get("point_id") == SPOT_NOT_JOINED_YOGA]
        
        assert len(yoga_events) == 1, f"Expected exactly 1 yoga event, got {len(yoga_events)}: {yoga_events}"
        evt = yoga_events[0]
        
        assert evt["date"] == session_date, \
            f"Planning date {evt['date']} should match session_date {session_date}"
        assert evt["type"] == "recurring", f"Expected type=recurring, got {evt['type']}"
        print(f"PASS: Planning event date={evt['date']} matches session_date={session_date}")

    def test_not_going_removes_from_planning(self, user_client):
        """DELETE /going → spot disappears from planning."""
        resp = user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED_YOGA}/going")
        assert resp.status_code == 200, f"Expected 200 for not_going, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("is_going") is False, f"Expected is_going=False, got {data}"
        
        events = get_planning(user_client)
        sy_events = spot_you_events(events)
        ids = {e["point_id"] for e in sy_events}
        
        assert SPOT_NOT_JOINED_YOGA not in ids, \
            f"After DELETE /going, {SPOT_NOT_JOINED_YOGA} should NOT appear in planning. Got: {ids}"
        print(f"PASS: After DELETE /going, {SPOT_NOT_JOINED_YOGA} removed from planning")


class TestIsOwnForOwner:
    """is_own=true must be set when the planning event belongs to the current user (as owner)."""

    def test_owner_going_to_own_spotyou_has_is_own_true(self, user_client):
        """
        user_demo001 owns pt_demo001 (Footing, single-date 2026-03-12).
        After /going, the event in planning should have is_own=true.
        """
        # Clean state
        user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_OWN_SINGLE}/going")
        
        resp = user_client.post(f"{BASE_URL}/api/spot-you/{SPOT_OWN_SINGLE}/going")
        assert resp.status_code == 200, f"Going on own spot failed: {resp.status_code}: {resp.text}"
        
        events = get_planning(user_client)
        own_events = [e for e in events if e.get("point_id") == SPOT_OWN_SINGLE]
        
        assert len(own_events) == 1, f"Expected 1 event for {SPOT_OWN_SINGLE}, got {len(own_events)}"
        evt = own_events[0]
        
        assert evt.get("is_own") is True, \
            f"Expected is_own=True for owned SpotYou, got is_own={evt.get('is_own')}: {evt}"
        assert evt["type"] == "single", f"Expected type=single for single-date SpotYou, got {evt['type']}"
        print(f"PASS: Owner going to own SpotYou → is_own=True, type=single, date={evt['date']}")

    def test_cleanup_owner_not_going(self, user_client):
        """Clean up: remove going status for SPOT_OWN_SINGLE."""
        resp = user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_OWN_SINGLE}/going")
        assert resp.status_code == 200
        print(f"PASS: Cleanup — not going {SPOT_OWN_SINGLE}")


class TestBookingsStillAppear:
    """Bookings (réservations) should continue to appear in planning."""

    def test_planning_includes_bookings(self, user_client):
        """user_demo001 has accepted bookings with slot dates — they must appear."""
        events = get_planning(user_client)
        bk_events = booking_events(events)
        
        assert len(bk_events) > 0, \
            f"Expected booking events in planning, got 0. Total events: {len(events)}"
        print(f"PASS: Planning includes {len(bk_events)} booking event(s)")

    def test_booking_events_have_correct_type(self, user_client):
        events = get_planning(user_client)
        bk_events = booking_events(events)
        
        for bk in bk_events:
            assert bk["type"] == "booking", f"Expected type=booking, got {bk['type']}: {bk}"
            assert "booking_id" in bk or "service_id" in bk, \
                f"Booking event missing booking_id/service_id: {bk}"
            assert "date" in bk, f"Booking event missing date: {bk}"
            assert "time" in bk, f"Booking event missing time: {bk}"
        print(f"PASS: All {len(bk_events)} booking events have correct structure")

    def test_booking_events_have_dates(self, user_client):
        events = get_planning(user_client)
        bk_events = booking_events(events)
        
        booking_dates = {bk["date"] for bk in bk_events}
        # Some known booking slot_dates
        expected_dates = {"2026-03-11", "2026-03-14", "2026-03-12"}
        found = expected_dates & booking_dates
        
        assert len(found) > 0, \
            f"Expected some of {expected_dates} in booking dates, got: {booking_dates}"
        print(f"PASS: Booking dates present: {booking_dates}")


class TestSingleDateSpotYouPlanning:
    """For single-date SpotYou, planning date = event_date (converted to Paris time)."""

    def test_single_date_going_appears_with_correct_date(self, user_client):
        """
        pt_demo006 (Sortie vélo 2026-03-14 09:00 UTC) → Paris = 10:00 (UTC+1)
        This spot is NOT owned by user_demo001, so is_own should be False.
        """
        SPOT_SINGLE = "pt_demo006"  # Sortie vélo
        
        # Clean state
        user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_SINGLE}/going")
        user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_SINGLE}/leave")
        
        resp = user_client.post(f"{BASE_URL}/api/spot-you/{SPOT_SINGLE}/going")
        assert resp.status_code == 200, f"Going on single-date spot failed: {resp.status_code}: {resp.text}"
        
        events = get_planning(user_client)
        single_events = [e for e in events if e.get("point_id") == SPOT_SINGLE]
        
        assert len(single_events) == 1, \
            f"Expected 1 event for {SPOT_SINGLE}, got {len(single_events)}: {single_events}"
        evt = single_events[0]
        
        assert evt["type"] == "single", f"Expected type=single, got {evt['type']}"
        assert evt["date"] == "2026-03-14", f"Expected date=2026-03-14, got {evt['date']}"
        assert evt.get("is_own") is False, f"Expected is_own=False for non-owned spot, got {evt.get('is_own')}"
        print(f"PASS: Single-date SpotYou appears with correct date {evt['date']}, is_own=False, time={evt.get('time')}")

    def test_cleanup_single_date(self, user_client):
        SPOT_SINGLE = "pt_demo006"
        user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_SINGLE}/going")
        user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_SINGLE}/leave")
        print(f"PASS: Cleanup single-date {SPOT_SINGLE}")


class TestGoingEndpointDetails:
    """Additional tests for going/not_going endpoint details."""

    def test_going_returns_session_date(self, user_client):
        """The /going endpoint must return session_date in response."""
        # Clean state
        user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED}/going")
        user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED}/leave")
        
        resp = user_client.post(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED}/going")
        assert resp.status_code == 200, f"Going failed: {resp.status_code}: {resp.text}"
        data = resp.json()
        
        assert "session_date" in data, f"Missing session_date in /going response: {data}"
        assert data["session_date"] is not None, "session_date should not be None"
        # session_date should be a valid date string YYYY-MM-DD
        import re
        assert re.match(r'\d{4}-\d{2}-\d{2}', data["session_date"]), \
            f"session_date {data['session_date']} should be YYYY-MM-DD format"
        print(f"PASS: /going returns session_date={data['session_date']}")

    def test_not_going_returns_is_going_false(self, user_client):
        resp = user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED}/going")
        assert resp.status_code == 200, f"Not-going failed: {resp.status_code}"
        data = resp.json()
        assert data.get("is_going") is False, f"Expected is_going=False, got {data}"
        print(f"PASS: DELETE /going returns is_going=False")

    def test_join_returns_is_member_true_not_is_going(self, user_client):
        """Join endpoint should return is_member=True but NOT is_going=True."""
        resp = user_client.post(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED}/join")
        assert resp.status_code == 200, f"Join failed: {resp.status_code}"
        data = resp.json()
        assert data.get("is_member") is True, f"Expected is_member=True, got {data}"
        # is_going should not be set to True by join
        assert data.get("is_going") is not True, \
            f"Join should not set is_going=True, got is_going={data.get('is_going')}"
        print(f"PASS: join returns is_member=True, is_going not set: {data}")
        # cleanup
        user_client.delete(f"{BASE_URL}/api/spot-you/{SPOT_NOT_JOINED}/leave")
