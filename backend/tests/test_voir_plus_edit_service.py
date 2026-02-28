"""
Backend tests for:
1. Service detail API (slots/dates for Voir Plus feature)
2. Edit service (PUT /services/{id}) for edit mode feature
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/')
SERVICE_ID = 'svc_b184a9f7f6db'

# Credentials
OWNER_EMAIL = 'user@winek.app'
OWNER_PASSWORD = 'WinekUser2024!'
COACH_EMAIL = 'coach@winek.app'
COACH_PASSWORD = 'WinekCoach2024!'


@pytest.fixture(scope='module')
def owner_token():
    """Get auth token for service owner (user@winek.app = user_demo001)"""
    resp = requests.post(f'{BASE_URL}/api/auth/login', json={
        'email': OWNER_EMAIL,
        'password': OWNER_PASSWORD
    })
    assert resp.status_code == 200, f"Owner login failed: {resp.text}"
    data = resp.json()
    token = data.get('token') or data.get('access_token')
    assert token, "No token in login response"
    return token


@pytest.fixture(scope='module')
def coach_token():
    """Get auth token for coach@winek.app (user_coach001 - not the service owner)"""
    resp = requests.post(f'{BASE_URL}/api/auth/login', json={
        'email': COACH_EMAIL,
        'password': COACH_PASSWORD
    })
    assert resp.status_code == 200, f"Coach login failed: {resp.text}"
    data = resp.json()
    token = data.get('token') or data.get('access_token')
    assert token, "No token in login response"
    return token


class TestServiceDetailAPI:
    """Tests for service detail page data - validate slot/date data for Voir Plus"""

    def test_get_service_returns_200(self, owner_token):
        """Service GET returns 200"""
        resp = requests.get(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}'}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_service_has_5_unique_dates(self, owner_token):
        """Service has exactly 5 unique slot_dates (2026-02-28, 03-03, 03-04, 03-10, 03-11)"""
        resp = requests.get(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}'}
        )
        assert resp.status_code == 200
        data = resp.json()
        slots = data.get('slots', [])
        assert len(slots) > 0, "Service should have slots"
        # Collect unique dates
        unique_dates = set()
        for s in slots:
            if s.get('slot_type') == 'single' and s.get('slot_date'):
                unique_dates.add(s['slot_date'])
        assert len(unique_dates) == 5, f"Expected 5 unique dates, got {len(unique_dates)}: {sorted(unique_dates)}"
        expected_dates = {'2026-02-28', '2026-03-03', '2026-03-04', '2026-03-10', '2026-03-11'}
        assert unique_dates == expected_dates, f"Dates mismatch: {unique_dates}"

    def test_voir_plus_logic_4_dates_default_1_more(self, owner_token):
        """With visibleCount=4 and 5 dates, button shows '(1 DE PLUS)' - Math.min(3, 5-4)=1"""
        resp = requests.get(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}'}
        )
        assert resp.status_code == 200
        data = resp.json()
        slots = data.get('slots', [])
        unique_dates = set()
        for s in slots:
            if s.get('slot_type') == 'single' and s.get('slot_date'):
                unique_dates.add(s['slot_date'])
        total = len(unique_dates)
        visible_count = 4
        # Voir Plus logic: sortedKeys.length > visibleCount
        assert total > visible_count, f"Should have more dates ({total}) than visibleCount ({visible_count})"
        # Button label: Math.min(3, total - visible_count)
        more_count = min(3, total - visible_count)
        assert more_count == 1, f"Expected 1 more, got {more_count}"

    def test_service_owner_is_user_demo001(self, owner_token):
        """Service is owned by user_demo001 (user@winek.app)"""
        resp = requests.get(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}'}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get('coach_id') == 'user_demo001', f"Expected owner user_demo001, got {data.get('coach_id')}"

    def test_service_title_is_string(self, owner_token):
        """Service title is a non-empty string"""
        resp = requests.get(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}'}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get('title'), "Service title should be non-empty"
        assert isinstance(data['title'], str)

    def test_service_has_description(self, owner_token):
        """Service has description field"""
        resp = requests.get(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}'}
        )
        assert resp.status_code == 200
        data = resp.json()
        # description may be set
        assert 'description' in data

    def test_service_has_locations(self, owner_token):
        """Service has at least one location with address"""
        resp = requests.get(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}'}
        )
        assert resp.status_code == 200
        data = resp.json()
        locations = data.get('locations', [])
        assert len(locations) > 0, "Service should have at least one location"
        first_loc = locations[0]
        assert first_loc.get('description'), "Location should have description"


class TestEditServiceAPI:
    """Tests for PUT /services/{id} - edit mode feature"""

    def test_put_service_by_owner_success(self, owner_token):
        """Owner can PUT/update service - returns 200 with updated data"""
        new_title = 'Coaching Football Paris TEST'
        resp = requests.put(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}', 'Content-Type': 'application/json'},
            json={'title': new_title}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get('title') == new_title, f"Title not updated: {data.get('title')}"

    def test_put_service_reflects_in_get(self, owner_token):
        """After PUT, GET returns the updated title"""
        new_title = 'Coaching Football Paris VERIFY'
        # PUT
        put_resp = requests.put(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}', 'Content-Type': 'application/json'},
            json={'title': new_title}
        )
        assert put_resp.status_code == 200

        # GET to verify persistence
        get_resp = requests.get(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}'}
        )
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data.get('title') == new_title, f"Title not persisted: {data.get('title')}"

    def test_put_service_by_non_owner_fails(self, coach_token):
        """Non-owner (coach@winek.app = user_coach001) cannot PUT service owned by user_demo001"""
        resp = requests.put(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {coach_token}', 'Content-Type': 'application/json'},
            json={'title': 'Hacked title'}
        )
        # Should return 403 Forbidden or 401 Unauthorized
        assert resp.status_code in [401, 403], f"Expected 401/403 for non-owner, got {resp.status_code}: {resp.text}"

    def test_put_service_unauthenticated_fails(self):
        """Unauthenticated PUT should fail"""
        resp = requests.put(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Content-Type': 'application/json'},
            json={'title': 'No auth title'}
        )
        assert resp.status_code in [401, 403], f"Expected 401/403 without auth, got {resp.status_code}: {resp.text}"

    def test_restore_service_title(self, owner_token):
        """Restore service title to 'Coaching Football Paris' after tests"""
        resp = requests.put(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}', 'Content-Type': 'application/json'},
            json={'title': 'Coaching Football Paris'}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get('title') == 'Coaching Football Paris'
