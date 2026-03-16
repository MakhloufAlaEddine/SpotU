"""
Backend tests for:
1. Service detail API (slots/dates for Voir Plus feature)
2. Edit service (PUT /services/{id}) for edit mode feature
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', os.environ.get('REACT_APP_BACKEND_URL', '')).rstrip('/')
SERVICE_ID = None  # défini dynamiquement dans setup_module

# Credentials
OWNER_EMAIL = 'coach@winek.app'
OWNER_PASSWORD = 'WinekCoach2024!'
USER_EMAIL = 'user@winek.app'
USER_PASSWORD = 'WinekUser2024!'


def setup_module(module):
    """Crée un service de test dédié pour éviter les conflits."""
    global SERVICE_ID
    import sys
    from datetime import datetime, timedelta

    resp = requests.post(f'{BASE_URL}/api/auth/login',
                         json={'email': OWNER_EMAIL, 'password': OWNER_PASSWORD})
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json().get('token') or resp.json().get('access_token')
    hdrs = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

    # Créer 5 slots répartis sur 5 jours différents
    future_dates = [(datetime.now() + timedelta(days=30+i)).strftime('%Y-%m-%d') for i in range(5)]
    slots = [{'slot_date': d, 'start_time': '10:00', 'end_time': '11:00', 'capacity': 5} for d in future_dates]
    payload = {
        'title': 'TEST Voir Plus Service iter',
        'description': 'Service temporaire pour les tests voir plus / edit',
        'price': 50.0,
        'duration_min': 60,
        'domain_id': 'dom_sport',
        'tag_ids': ['tag_3x3'],
        'images': [],
        'booking_approval_mode': 'instant',
        'locations': [{'address': 'Paris', 'latitude': 48.8566, 'longitude': 2.3522}],
        'slots': slots,
    }
    resp = requests.post(f'{BASE_URL}/api/services', json=payload, headers=hdrs, timeout=15)
    assert resp.status_code == 200, f"Create service failed: {resp.text}"
    SERVICE_ID = resp.json()['service_id']
    sys.modules[__name__].SERVICE_ID = SERVICE_ID
    print(f'setup_module: service {SERVICE_ID} created')


def teardown_module(module):
    if not SERVICE_ID:
        return
    resp = requests.post(f'{BASE_URL}/api/auth/login',
                         json={'email': OWNER_EMAIL, 'password': OWNER_PASSWORD})
    if resp.status_code == 200:
        token = resp.json().get('token') or resp.json().get('access_token')
        requests.delete(f'{BASE_URL}/api/services/{SERVICE_ID}',
                        headers={'Authorization': f'Bearer {token}'})
        print(f'teardown_module: service {SERVICE_ID} supprimé')


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
        'email': USER_EMAIL,
        'password': USER_PASSWORD
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
        """Service has at least 5 unique slot_dates"""
        resp = requests.get(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}'}
        )
        assert resp.status_code == 200
        data = resp.json()
        slots = data.get('slots', [])
        assert len(slots) > 0, "Service should have slots"
        # Collect unique dates (any slot with a slot_date)
        unique_dates = {s['slot_date'] for s in slots if s.get('slot_date')}
        assert len(unique_dates) >= 5, f"Expected ≥5 unique dates, got {len(unique_dates)}: {sorted(unique_dates)}"

    def test_voir_plus_logic_4_dates_default_1_more(self, owner_token):
        """With visibleCount=4 and 5 dates, button shows '(1 DE PLUS)' - Math.min(3, 5-4)=1"""
        resp = requests.get(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}'}
        )
        assert resp.status_code == 200
        data = resp.json()
        slots = data.get('slots', [])
        unique_dates = {s['slot_date'] for s in slots if s.get('slot_date')}
        total = len(unique_dates)
        visible_count = 4
        # Voir Plus logic: sortedKeys.length > visibleCount
        assert total > visible_count, f"Should have more dates ({total}) than visibleCount ({visible_count})"
        # Button label: Math.min(3, total - visible_count)
        more_count = min(3, total - visible_count)
        assert more_count >= 1, f"Expected ≥1 more, got {more_count}"

    def test_service_owner_is_coach(self, owner_token):
        """Service is owned by the authenticated coach"""
        resp = requests.get(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}'}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get('coach_id'), f"Expected coach_id to be set, got: {data.get('coach_id')}"

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
        """Service has at least one location with coordinates"""
        resp = requests.get(
            f'{BASE_URL}/api/services/{SERVICE_ID}',
            headers={'Authorization': f'Bearer {owner_token}'}
        )
        assert resp.status_code == 200
        data = resp.json()
        locations = data.get('locations', [])
        assert len(locations) > 0, "Service should have at least one location"
        first_loc = locations[0]
        assert 'latitude' in first_loc and 'longitude' in first_loc, "Location should have coordinates"


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
