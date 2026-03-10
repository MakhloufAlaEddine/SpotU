"""
test_spotyou_chat_access.py — Backend tests for SpotYou group chat access control
===================================================================================
Tests:
  1. POST /api/spot-you/{id}/join  → auto-adds user to group conv (status='active')
  2. DELETE /api/spot-you/{id}/leave → sets status='blocked' in conversation_participants
  3. GET /api/conversations → is_blocked=true for blocked conv
  4. GET /api/conversations → is_blocked=false for active conv
  5. POST /api/conversations tagpoint_group → 403 for non-members
  6. GET /api/conversations/{id}/messages → accessible for blocked user (read-only)
  7. Re-join SpotYou → resets status to 'active' (is_blocked=false)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

# Known demo data
SPOTYOU_ID = "pt_demo013"   # Streetball 3x3 - République
GROUP_CONV_ID = "conv_demo002"

USER_EMAIL = "user@winek.app"
USER_PASS  = "WinekUser2024!"

COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def user_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": USER_EMAIL, "password": USER_PASS})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def coach_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": COACH_EMAIL, "password": COACH_PASS})
    assert r.status_code == 200, f"Coach login failed: {r.text}"
    return r.json()["token"]


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Helper: get conversation status from list ──────────────────────────────────

def get_conv_from_list(token: str, conv_id: str):
    r = requests.get(f"{BASE_URL}/api/conversations", headers=auth_headers(token))
    assert r.status_code == 200
    convs = r.json()
    return next((c for c in convs if c["conversation_id"] == conv_id), None)


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestJoinSetsActiveStatus:
    """POST /api/spot-you/{id}/join auto-adds user to group conv with status='active'"""

    def test_join_spotyou_success(self, user_token):
        """Join SpotYou → returns is_member=True"""
        r = requests.post(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/join",
                          headers=auth_headers(user_token))
        assert r.status_code == 200, f"Join failed: {r.text}"
        data = r.json()
        assert data.get("is_member") is True
        assert data.get("success") is True
        print(f"PASS: join → is_member={data.get('is_member')}, count={data.get('participants_count')}")

    def test_join_sets_active_in_conv_list(self, user_token):
        """After join, conversation appears with is_blocked=False"""
        # Ensure joined first
        requests.post(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/join",
                      headers=auth_headers(user_token))
        conv = get_conv_from_list(user_token, GROUP_CONV_ID)
        assert conv is not None, f"Conversation {GROUP_CONV_ID} not found in list"
        assert conv.get("is_blocked") is False, \
            f"Expected is_blocked=False after join, got {conv.get('is_blocked')}"
        print(f"PASS: after join, is_blocked={conv.get('is_blocked')}")


class TestNonMemberCannotCreateGroupConv:
    """POST /api/conversations with tagpoint_group → 403 for non-members"""

    def test_leave_before_403_test(self, user_token):
        """Leave first to ensure non-member state"""
        r = requests.delete(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/leave",
                            headers=auth_headers(user_token))
        # OK if 200 or if already not member
        assert r.status_code in (200, 403, 404), f"Unexpected leave status: {r.status_code}"
        print(f"PASS: leave returned {r.status_code}")

    def test_non_member_gets_403(self, user_token):
        """Non-member cannot POST /api/conversations with tagpoint_group → 403"""
        # Make sure user is NOT a member first (leave is idempotent)
        requests.delete(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/leave",
                        headers=auth_headers(user_token))
        r = requests.post(
            f"{BASE_URL}/api/conversations",
            json={"type": "tagpoint_group", "context_id": SPOTYOU_ID},
            headers=auth_headers(user_token),
        )
        assert r.status_code == 403, \
            f"Expected 403 for non-member, got {r.status_code}: {r.text}"
        data = r.json()
        assert "member" in data.get("detail", "").lower() or "membre" in data.get("detail", "").lower()
        print(f"PASS: non-member got 403 — {data.get('detail')}")


class TestLeaveBlocksConversation:
    """DELETE /api/spot-you/{id}/leave sets status='blocked' in group conversation"""

    def test_leave_after_join(self, user_token):
        """Join then leave → leave returns is_member=False"""
        # Join first
        join_r = requests.post(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/join",
                               headers=auth_headers(user_token))
        assert join_r.status_code == 200
        # Leave
        r = requests.delete(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/leave",
                            headers=auth_headers(user_token))
        assert r.status_code == 200, f"Leave failed: {r.text}"
        data = r.json()
        assert data.get("is_member") is False
        assert data.get("success") is True
        print(f"PASS: leave → is_member={data.get('is_member')}")

    def test_leave_sets_is_blocked_true(self, user_token):
        """After leave, conversation appears in list with is_blocked=True"""
        # Join then leave
        requests.post(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/join",
                      headers=auth_headers(user_token))
        requests.delete(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/leave",
                        headers=auth_headers(user_token))

        conv = get_conv_from_list(user_token, GROUP_CONV_ID)
        assert conv is not None, f"Conversation {GROUP_CONV_ID} not found after leave"
        assert conv.get("is_blocked") is True, \
            f"Expected is_blocked=True after leave, got {conv.get('is_blocked')}"
        print(f"PASS: after leave, is_blocked={conv.get('is_blocked')}")


class TestBlockedUserReadOnly:
    """Blocked user can still GET messages (read-only) but cannot send via WS"""

    def test_blocked_user_can_read_messages(self, user_token):
        """Blocked user can GET /api/conversations/{id}/messages"""
        # Ensure blocked state: join then leave
        requests.post(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/join",
                      headers=auth_headers(user_token))
        requests.delete(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/leave",
                        headers=auth_headers(user_token))

        r = requests.get(f"{BASE_URL}/api/conversations/{GROUP_CONV_ID}/messages",
                         headers=auth_headers(user_token))
        assert r.status_code == 200, \
            f"Expected 200 for blocked user reading messages, got {r.status_code}: {r.text}"
        data = r.json()
        assert isinstance(data, list), "Expected list of messages"
        print(f"PASS: blocked user can read {len(data)} messages")

    def test_blocked_conv_still_in_list(self, user_token):
        """Blocked conversation still appears in GET /api/conversations"""
        # Ensure blocked state
        requests.post(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/join",
                      headers=auth_headers(user_token))
        requests.delete(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/leave",
                        headers=auth_headers(user_token))

        r = requests.get(f"{BASE_URL}/api/conversations", headers=auth_headers(user_token))
        assert r.status_code == 200
        conv_ids = [c["conversation_id"] for c in r.json()]
        assert GROUP_CONV_ID in conv_ids, \
            f"Blocked conversation {GROUP_CONV_ID} should still appear in list"
        print(f"PASS: blocked conv still in list. Total convs: {len(r.json())}")


class TestRejoinResetsActive:
    """Re-joining a SpotYou resets status to 'active' (is_blocked=False)"""

    def test_rejoin_after_leave_resets_to_active(self, user_token):
        """Join → leave → rejoin → is_blocked=False"""
        # Step 1: join
        requests.post(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/join",
                      headers=auth_headers(user_token))
        # Step 2: leave (blocked)
        requests.delete(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/leave",
                        headers=auth_headers(user_token))

        # Verify blocked
        conv_after_leave = get_conv_from_list(user_token, GROUP_CONV_ID)
        assert conv_after_leave is not None
        assert conv_after_leave.get("is_blocked") is True, "Should be blocked after leave"
        print(f"  Interim: is_blocked={conv_after_leave.get('is_blocked')} (expected True)")

        # Step 3: rejoin
        r = requests.post(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/join",
                          headers=auth_headers(user_token))
        assert r.status_code == 200
        assert r.json().get("is_member") is True

        # Step 4: verify is_blocked=False
        conv_after_rejoin = get_conv_from_list(user_token, GROUP_CONV_ID)
        assert conv_after_rejoin is not None
        assert conv_after_rejoin.get("is_blocked") is False, \
            f"Expected is_blocked=False after rejoin, got {conv_after_rejoin.get('is_blocked')}"
        print(f"PASS: after rejoin, is_blocked={conv_after_rejoin.get('is_blocked')}")


class TestOwnerAlwaysActive:
    """Coach (SpotYou owner) always has is_blocked=False for the group conversation"""

    def test_owner_conv_is_not_blocked(self, coach_token):
        """Owner's group conversation should have is_blocked=False"""
        conv = get_conv_from_list(coach_token, GROUP_CONV_ID)
        if conv is None:
            # Owner may not be in conv list if no participant record — create it
            r = requests.post(
                f"{BASE_URL}/api/conversations",
                json={"type": "tagpoint_group", "context_id": SPOTYOU_ID},
                headers=auth_headers(coach_token),
            )
            assert r.status_code == 200, f"Owner failed to open group conv: {r.text}"
            conv = get_conv_from_list(coach_token, GROUP_CONV_ID)

        assert conv is not None, "Owner should have the group conversation"
        assert conv.get("is_blocked") is False, \
            f"Owner's conv should not be blocked, got is_blocked={conv.get('is_blocked')}"
        print(f"PASS: owner is_blocked={conv.get('is_blocked')}")


class TestConversationsStructure:
    """GET /api/conversations returns correct structure with is_blocked field"""

    def test_conversations_have_is_blocked_field(self, user_token):
        """Each conversation in the list has an is_blocked field"""
        # Join to have at least one conv
        requests.post(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/join",
                      headers=auth_headers(user_token))

        r = requests.get(f"{BASE_URL}/api/conversations", headers=auth_headers(user_token))
        assert r.status_code == 200
        convs = r.json()
        assert len(convs) > 0, "Expected at least one conversation"
        for c in convs:
            assert "is_blocked" in c, \
                f"Conversation {c.get('conversation_id')} missing 'is_blocked' field"
        print(f"PASS: all {len(convs)} conversations have is_blocked field")

    def test_active_conv_has_is_blocked_false(self, user_token):
        """Active conversation has is_blocked=False"""
        # Ensure member
        requests.post(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/join",
                      headers=auth_headers(user_token))
        conv = get_conv_from_list(user_token, GROUP_CONV_ID)
        assert conv is not None
        assert conv["is_blocked"] is False, \
            f"Active member conv should have is_blocked=False, got {conv['is_blocked']}"
        print(f"PASS: active member conv has is_blocked={conv['is_blocked']}")


# ── Cleanup ────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True, scope="module")
def cleanup_after_all(user_token):
    """Ensure user is a member after all tests run (restore state)"""
    yield
    # Leave clean state: user is a member
    requests.post(f"{BASE_URL}/api/spot-you/{SPOTYOU_ID}/join",
                  headers={"Authorization": f"Bearer {user_token}"})
    print("\nCleanup: re-joined SpotYou to restore membership")
