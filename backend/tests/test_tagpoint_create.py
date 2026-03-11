"""
WINEK TagPoint Creation Tests - Iteration 6
Tests: POST /api/tag-points (with images field), GET /api/tag-points
Focus: New create screen features - images, precision, domain, schedule
"""
import pytest
import requests
import os

def _load_base_url():
    url = os.environ.get('EXPO_PUBLIC_BACKEND_URL') or os.environ.get('REACT_APP_BACKEND_URL')
    if url:
        return url.rstrip('/')
    env_path = os.path.join(os.path.dirname(__file__), '../../frontend/.env')
    try:
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                    return line.split('=', 1)[1].strip().rstrip('/')
    except Exception:
        pass
    return 'https://connectivity-guard.preview.emergentagent.com'

BASE_URL = _load_base_url()

USER_EMAIL = "user@winek.app"
USER_PASS = "WinekUser2024!"

PARIS_LAT = 48.8566
PARIS_LNG = 2.3522


@pytest.fixture(scope="module")
def api():
    """Requests session"""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user_token(api):
    """Authenticate as standard user"""
    resp = api.post(f"{BASE_URL}/api/auth/login", json={
        "email": USER_EMAIL,
        "password": USER_PASS
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json()["token"]
    return token


@pytest.fixture(scope="module")
def auth_headers(user_token):
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture(scope="module")
def domain_id(api):
    """Get first domain ID (Sport)"""
    resp = api.get(f"{BASE_URL}/api/domains")
    assert resp.status_code == 200
    domains = resp.json()
    # Prefer dom_sport
    for d in domains:
        if d["domain_id"] == "dom_sport":
            return d["domain_id"]
    return domains[0]["domain_id"]


# ─── Test: POST /api/tag-points ───────────────────────────────────────────────

class TestCreateTagPoint:
    """Tests for POST /api/tag-points endpoint"""

    created_point_id = None

    def test_create_tagpoint_basic(self, api, auth_headers, domain_id):
        """Create a basic TagPoint - minimum required fields"""
        payload = {
            "title": "TEST_Footing Matinal",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": [],
            "domain_id": domain_id,
            "images": []
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create basic: {resp.status_code} - {resp.text[:200]}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "point_id" in data, "Response must have point_id"
        assert data["title"] == "TEST_Footing Matinal"
        assert "owner" in data, "Response must have owner"
        TestCreateTagPoint.created_point_id = data["point_id"]

    def test_create_tagpoint_with_images_empty(self, api, auth_headers, domain_id):
        """Create TagPoint with empty images array (frontend sends images:[] always)"""
        payload = {
            "title": "TEST_TagPoint with images field",
            "description": "Testing images field",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": [],
            "domain_id": domain_id,
            "images": []  # Frontend always sends empty array
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create with images=[]: {resp.status_code} - {resp.text[:200]}")
        assert resp.status_code == 200
        data = resp.json()
        assert "point_id" in data
        # images returned as string '[]' (JSONB double-encoded) or empty list or None
        images_val = data.get("images")
        assert images_val in [[], None, "[]", '[]'], f"images should be empty array/string, got {images_val!r}"
        # Cleanup
        cleanup_id = data["point_id"]
        api.delete(f"{BASE_URL}/api/tag-points/{cleanup_id}", headers=auth_headers)

    def test_create_tagpoint_with_description(self, api, auth_headers, domain_id):
        """Create TagPoint with description"""
        payload = {
            "title": "TEST_TagPoint with description",
            "description": "Un footing matinal dans le bois de Vincennes",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": [],
            "domain_id": domain_id,
            "images": []
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create with description: {resp.status_code}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["description"] == "Un footing matinal dans le bois de Vincennes"
        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{data['point_id']}", headers=auth_headers)

    def test_create_tagpoint_precision_100m(self, api, auth_headers, domain_id):
        """Create TagPoint with 100m precision"""
        payload = {
            "title": "TEST_TagPoint precision 100m",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "100m",
            "tag_ids": [],
            "domain_id": domain_id,
            "images": []
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create with 100m precision: {resp.status_code}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["precision"] == "100m"
        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{data['point_id']}", headers=auth_headers)

    def test_create_tagpoint_precision_1000m(self, api, auth_headers, domain_id):
        """Create TagPoint with 1000m precision"""
        payload = {
            "title": "TEST_TagPoint precision 1000m",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "1000m",
            "tag_ids": [],
            "domain_id": domain_id,
            "images": []
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create with 1000m precision: {resp.status_code}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["precision"] == "1000m"
        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{data['point_id']}", headers=auth_headers)

    def test_create_tagpoint_with_event_date(self, api, auth_headers, domain_id):
        """Create TagPoint with event_date (once schedule)"""
        payload = {
            "title": "TEST_TagPoint with event date",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": [],
            "domain_id": domain_id,
            "images": [],
            "event_date": "2026-06-15T10:00:00"
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create with event_date: {resp.status_code} - {resp.text[:300]}")
        assert resp.status_code == 200
        data = resp.json()
        assert "point_id" in data
        assert data.get("event_date") is not None, "event_date should be set"
        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{data['point_id']}", headers=auth_headers)

    def test_create_tagpoint_with_recurring_schedule(self, api, auth_headers, domain_id):
        """Create TagPoint with recurring schedule"""
        payload = {
            "title": "TEST_TagPoint recurring",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": [],
            "domain_id": domain_id,
            "images": [],
            "event_schedule": {"type": "weekly", "day": 0, "time": "18:30"}  # Monday 18:30
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create with schedule: {resp.status_code} - {resp.text[:300]}")
        assert resp.status_code == 200
        data = resp.json()
        assert "point_id" in data
        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{data['point_id']}", headers=auth_headers)

    def test_create_tagpoint_all_domains(self, api, auth_headers):
        """Create TagPoints for all 4 domains"""
        domains_resp = api.get(f"{BASE_URL}/api/domains")
        assert domains_resp.status_code == 200
        domains = domains_resp.json()
        assert len(domains) == 4, f"Expected 4 domains, got {len(domains)}"

        domain_ids = [d["domain_id"] for d in domains]
        assert "dom_sport" in domain_ids
        assert "dom_coaching" in domain_ids
        assert "dom_service" in domain_ids
        assert "dom_social" in domain_ids

        for domain in domains:
            payload = {
                "title": f"TEST_Point {domain['name']}",
                "latitude": PARIS_LAT,
                "longitude": PARIS_LNG,
                "precision": "exact",
                "tag_ids": [],
                "domain_id": domain["domain_id"],
                "images": []
            }
            resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
            print(f"Create for domain {domain['domain_id']}: {resp.status_code}")
            assert resp.status_code == 200, f"Failed for domain {domain['domain_id']}: {resp.text}"
            # Cleanup immediately
            api.delete(f"{BASE_URL}/api/tag-points/{resp.json()['point_id']}", headers=auth_headers)

    def test_create_tagpoint_unauthenticated(self, api, domain_id):
        """Create TagPoint without auth returns 401"""
        payload = {
            "title": "Unauthorized TagPoint",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": [],
            "domain_id": domain_id,
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload)
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_create_tagpoint_missing_title(self, api, auth_headers, domain_id):
        """Create TagPoint without title should fail (422)"""
        payload = {
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "domain_id": domain_id,
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create without title: {resp.status_code}")
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"


# ─── Test: GET /api/tag-points ────────────────────────────────────────────────

class TestGetTagPoints:
    """Tests for GET /api/tag-points endpoint"""

    def test_get_tagpoints_returns_list(self, api):
        """GET /api/tag-points returns a list"""
        resp = api.get(f"{BASE_URL}/api/tag-points?lat={PARIS_LAT}&lng={PARIS_LNG}&radius=50000")
        print(f"GET tag-points: {resp.status_code}, count: {len(resp.json()) if resp.status_code == 200 else 'N/A'}")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_get_tagpoints_has_required_fields(self, api):
        """GET /api/tag-points items have required fields"""
        resp = api.get(f"{BASE_URL}/api/tag-points?lat={PARIS_LAT}&lng={PARIS_LNG}&radius=50000")
        assert resp.status_code == 200
        data = resp.json()
        if len(data) == 0:
            pytest.skip("No tag points found near Paris")
        point = data[0]
        required_fields = ["point_id", "title", "latitude", "longitude", "precision", "domain_id"]
        for field in required_fields:
            assert field in point, f"Missing field: {field}"

    def test_get_tagpoint_created_is_retrievable(self, api, auth_headers):
        """TagPoint created via POST is retrievable via GET"""
        # Create a point
        domains_resp = api.get(f"{BASE_URL}/api/domains")
        domain_id = domains_resp.json()[0]["domain_id"]
        create_resp = api.post(
            f"{BASE_URL}/api/tag-points",
            json={
                "title": "TEST_Retrievable Point",
                "latitude": PARIS_LAT,
                "longitude": PARIS_LNG,
                "precision": "exact",
                "tag_ids": [],
                "domain_id": domain_id,
                "images": []
            },
            headers=auth_headers
        )
        assert create_resp.status_code == 200
        point_id = create_resp.json()["point_id"]

        # GET the specific point
        get_resp = api.get(f"{BASE_URL}/api/tag-points/{point_id}")
        print(f"GET specific point: {get_resp.status_code}")
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data["point_id"] == point_id
        assert data["title"] == "TEST_Retrievable Point"

        # Verify it appears in list query
        list_resp = api.get(f"{BASE_URL}/api/tag-points?lat={PARIS_LAT}&lng={PARIS_LNG}&radius=50000")
        assert list_resp.status_code == 200
        point_ids = [p["point_id"] for p in list_resp.json()]
        assert point_id in point_ids, "Created point should appear in list results"

        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{point_id}", headers=auth_headers)

    def test_get_tagpoints_with_tags(self, api, auth_headers):
        """Create TagPoint with tags and verify tags returned"""
        # Get available tags
        cats_resp = api.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport")
        assert cats_resp.status_code == 200
        cats = cats_resp.json()

        tag_ids = []
        for cat in cats:
            for tag in cat.get("tags", []):
                tag_ids.append(tag["tag_id"])
                if len(tag_ids) >= 2:
                    break
            if len(tag_ids) >= 2:
                break

        if not tag_ids:
            pytest.skip("No tags available for sport domain")

        create_resp = api.post(
            f"{BASE_URL}/api/tag-points",
            json={
                "title": "TEST_Point with tags",
                "latitude": PARIS_LAT,
                "longitude": PARIS_LNG,
                "precision": "exact",
                "tag_ids": tag_ids,
                "domain_id": "dom_sport",
                "images": []
            },
            headers=auth_headers
        )
        assert create_resp.status_code == 200
        data = create_resp.json()
        point_id = data["point_id"]
        assert "tag_ids" in data or "tags" in data, "Response should include tags"

        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{point_id}", headers=auth_headers)

    def test_cleanup_test_basic_point(self, api, auth_headers):
        """Cleanup the basic test point from TestCreateTagPoint"""
        if TestCreateTagPoint.created_point_id:
            resp = api.delete(
                f"{BASE_URL}/api/tag-points/{TestCreateTagPoint.created_point_id}",
                headers=auth_headers
            )
            print(f"Cleanup basic point: {resp.status_code}")
            assert resp.status_code == 200
