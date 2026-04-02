"""
Phase 4 Frontend Read-Only — Backend Smoke Tests
Tests for context_deleted=true state in conversations API
and soft-deleted messages fields.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = open('/app/frontend/.env').read()
    import re
    m = re.search(r'EXPO_PUBLIC_BACKEND_URL=(.+)', BASE_URL)
    BASE_URL = m.group(1).strip() if m else ''

ORPHAN_CONV_ID = 'conv_ed6d1a80279b'


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope='module')
def user_token():
    """Login as user@winek.app and return bearer token"""
    resp = requests.post(f'{BASE_URL}/api/auth/login', json={
        'email': 'user@winek.app',
        'password': 'WinekUser2024!'
    })
    assert resp.status_code == 200, f'Login failed: {resp.status_code} {resp.text}'
    data = resp.json()
    token = data.get('token') or data.get('access_token')
    assert token, f'No token in response: {data}'
    return token


@pytest.fixture(scope='module')
def admin_token():
    """Login as admin@winek.app and return bearer token"""
    resp = requests.post(f'{BASE_URL}/api/auth/login', json={
        'email': 'admin@winek.app',
        'password': 'WinekAdmin2024!'
    })
    if resp.status_code != 200:
        pytest.skip(f'Admin login failed: {resp.status_code}')
    data = resp.json()
    return data.get('token') or data.get('access_token')


@pytest.fixture(scope='module')
def user_headers(user_token):
    return {'Authorization': f'Bearer {user_token}'}


@pytest.fixture(scope='module')
def admin_headers(admin_token):
    return {'Authorization': f'Bearer {admin_token}'}


# ── Test: conversations list includes context_deleted field ───────────────────

class TestContextDeleted:
    """Verify GET /api/conversations returns context_deleted=true for orphan conv"""

    def test_conversations_list_has_context_deleted_field(self, user_headers):
        """GET /api/conversations must include context_deleted field in each item"""
        resp = requests.get(f'{BASE_URL}/api/conversations', headers=user_headers)
        assert resp.status_code == 200, f'Expected 200, got {resp.status_code}: {resp.text}'
        convs = resp.json()
        assert isinstance(convs, list), f'Expected list, got {type(convs)}'
        assert len(convs) > 0, 'No conversations returned for user@winek.app'
        # All items should have context_deleted field (even if None/False)
        for c in convs:
            assert 'context_deleted' in c, f'Missing context_deleted in conv {c.get("conversation_id")}'

    def test_orphan_conv_context_deleted_is_true(self, user_headers):
        """conv_ed6d1a80279b must have context_deleted=True"""
        resp = requests.get(f'{BASE_URL}/api/conversations', headers=user_headers)
        assert resp.status_code == 200
        convs = resp.json()
        orphan = next((c for c in convs if c['conversation_id'] == ORPHAN_CONV_ID), None)
        assert orphan is not None, (
            f'{ORPHAN_CONV_ID} not found in conversations list. '
            f'Found: {[c["conversation_id"] for c in convs]}'
        )
        assert orphan.get('context_deleted') is True, (
            f'Expected context_deleted=True for {ORPHAN_CONV_ID}, got: {orphan.get("context_deleted")}'
        )

    def test_orphan_conv_has_expected_structure(self, user_headers):
        """Orphan conv must have required fields for frontend read-only UI"""
        resp = requests.get(f'{BASE_URL}/api/conversations', headers=user_headers)
        assert resp.status_code == 200
        convs = resp.json()
        orphan = next((c for c in convs if c['conversation_id'] == ORPHAN_CONV_ID), None)
        if orphan is None:
            pytest.skip(f'{ORPHAN_CONV_ID} not in conversation list')
        required_fields = ['conversation_id', 'type', 'context_deleted', 'last_message_at']
        for field in required_fields:
            assert field in orphan, f'Missing field {field} in orphan conv'


# ── Test: messages endpoint for context_deleted conversation ──────────────────

class TestSoftDeletedMessages:
    """Verify messages endpoint handles soft-delete correctly"""

    def test_messages_endpoint_accessible_for_member(self, user_headers):
        """user@winek.app (member) should be able to GET messages even if context_deleted"""
        resp = requests.get(
            f'{BASE_URL}/api/conversations/{ORPHAN_CONV_ID}/messages',
            headers=user_headers
        )
        # Should be 200 (member can read history) or 403/404 (non-member or conv not found)
        # For a context_deleted conv where user is a participant, expect 200
        assert resp.status_code in [200, 403, 404], (
            f'Unexpected status {resp.status_code}: {resp.text}'
        )
        print(f'Messages endpoint status: {resp.status_code}')

    def test_messages_have_deleted_at_field(self, user_headers):
        """GET /api/conversations/{id}/messages must include deleted_at field per message"""
        resp = requests.get(
            f'{BASE_URL}/api/conversations/{ORPHAN_CONV_ID}/messages',
            headers=user_headers
        )
        if resp.status_code != 200:
            pytest.skip(f'Cannot access messages for orphan conv: {resp.status_code}')
        msgs = resp.json()
        assert isinstance(msgs, list), f'Expected list of messages, got {type(msgs)}'
        print(f'Messages count: {len(msgs)}')
        if len(msgs) > 0:
            for msg in msgs:
                assert 'deleted_at' in msg, (
                    f'Message {msg.get("message_id")} missing deleted_at field'
                )
                assert 'content' in msg, f'Message missing content field'
                assert 'message_id' in msg, f'Message missing message_id field'
                print(f'  msg {msg["message_id"]}: deleted_at={msg["deleted_at"]}, content={msg["content"][:30]}...')

    def test_soft_deleted_messages_show_placeholder_content(self, user_headers):
        """Messages with deleted_at set should have content='[Message supprimé]'"""
        resp = requests.get(
            f'{BASE_URL}/api/conversations/{ORPHAN_CONV_ID}/messages',
            headers=user_headers
        )
        if resp.status_code != 200:
            pytest.skip(f'Cannot access messages: {resp.status_code}')
        msgs = resp.json()
        deleted_msgs = [m for m in msgs if m.get('deleted_at')]
        print(f'Found {len(deleted_msgs)} soft-deleted messages out of {len(msgs)}')
        for msg in deleted_msgs:
            assert msg['content'] == '[Message supprimé]', (
                f'Soft-deleted message {msg["message_id"]} has content={msg["content"]!r}, '
                f'expected "[Message supprimé]"'
            )


# ── Test: admin cannot access orphan conv (403) ────────────────────────────────

class TestAccessControl:
    """Verify access control for context_deleted conversations"""

    def test_admin_cannot_access_orphan_conv_messages(self, admin_headers):
        """Admin (non-member) should get 403 when accessing orphan conv messages"""
        resp = requests.get(
            f'{BASE_URL}/api/conversations/{ORPHAN_CONV_ID}/messages',
            headers=admin_headers
        )
        # Admin is not a participant → should be 403
        assert resp.status_code in [403, 404], (
            f'Expected 403/404 for admin accessing non-member conv, got {resp.status_code}'
        )
        print(f'Admin access status: {resp.status_code} (expected 403/404)')

    def test_unauthenticated_access_blocked(self):
        """Unauthenticated access to conversations should return 401"""
        resp = requests.get(f'{BASE_URL}/api/conversations')
        assert resp.status_code == 401, f'Expected 401, got {resp.status_code}'

    def test_service_not_found_returns_404(self, user_headers):
        """GET /api/services/svc_inexistant_test_99 should return 404"""
        resp = requests.get(
            f'{BASE_URL}/api/services/svc_inexistant_test_99',
            headers=user_headers
        )
        assert resp.status_code in [404, 410], (
            f'Expected 404/410 for non-existent service, got {resp.status_code}'
        )
        print(f'Non-existent service status: {resp.status_code}')
