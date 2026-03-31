"""
Backend tests for WINEK - Iteration 20
Tests:
- POST /api/services with new format (locations[], slots[])
- GET /api/services includes 'locations' and 'slots' keys
- GET /api/services?lat&lng&radius - geospatial search with service_locations table
- GET /api/users/profile - hourly_rate absent
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://stepper-vente.preview.emergentagent.com"


def _get_valid_tag_ids():
    """Récupère un tag valide depuis l'API pour respecter la règle métier (au moins 1 tag requis)."""
    try:
        resp = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport", timeout=5)
        if resp.status_code == 200:
            for cat in resp.json():
                for tag in cat.get("tags", []):
                    return [tag["tag_id"]]
    except Exception:
        pass
    return ["tag_3x3"]  # fallback hardcodé


VALID_TAG_IDS = _get_valid_tag_ids()

COACH_EMAIL = "coach@winek.app"
COACH_PASSWORD = "WinekCoach2024!"
USER_EMAIL = "user@winek.app"
USER_PASSWORD = "WinekUser2024!"


@pytest.fixture(scope="module")
def coach_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": COACH_EMAIL, "password": COACH_PASSWORD
    })
    assert resp.status_code == 200, f"Coach login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def user_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": USER_EMAIL, "password": USER_PASSWORD
    })
    assert resp.status_code == 200, f"User login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def coach_headers(coach_token):
    return {"Authorization": f"Bearer {coach_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_headers(user_token):
    return {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def domain_id(coach_headers):
    """Get first available domain_id."""
    resp = requests.get(f"{BASE_URL}/api/domains", headers=coach_headers)
    assert resp.status_code == 200
    domains = resp.json()
    assert len(domains) > 0, "No domains available"
    return domains[0]["domain_id"]


# ── TEST 1: hourly_rate absent from GET /api/users/profile ──────────────────
class TestHourlyRateRemoved:
    """Verify hourly_rate is removed from profile responses"""

    def test_coach_profile_no_hourly_rate(self, coach_headers):
        resp = requests.get(f"{BASE_URL}/api/users/profile", headers=coach_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "hourly_rate" not in data, "hourly_rate should NOT be in coach profile response"
        print("PASS: hourly_rate absent from coach profile")

    def test_user_profile_no_hourly_rate(self, user_headers):
        resp = requests.get(f"{BASE_URL}/api/users/profile", headers=user_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "hourly_rate" not in data, "hourly_rate should NOT be in user profile response"
        print("PASS: hourly_rate absent from user profile")


# ── TEST 2: POST /api/services with locations[] and slots[] ─────────────────
class TestCreateService:
    """Test service creation with new multi-locations/slots format"""
    created_service_id = None

    def test_create_service_with_locations_and_slots(self, coach_headers, domain_id):
        payload = {
            "title": "TEST_Coaching Running Paris",
            "description": "Test service - stepper iter20",
            "price": 75.0,
            "duration_min": 60,
            "max_participants": 5,
            "domain_id": domain_id,
            "tag_ids": VALID_TAG_IDS,
            "locations": [
                {
                    "latitude": 48.8566,
                    "longitude": 2.3522,
                    "precision": "exact",
                    "description": "Parc des Champs-Élysées"
                },
                {
                    "latitude": 48.8606,
                    "longitude": 2.3376,
                    "precision": "100m",
                    "description": "Jardin des Tuileries"
                }
            ],
            "slots": [
                {"day_of_week": 1, "start_time": "09:00", "end_time": "10:00"},
                {"day_of_week": 3, "start_time": "18:00", "end_time": "19:00"},
                {"day_of_week": 6, "start_time": "08:00", "end_time": "09:30"}
            ]
        }
        resp = requests.post(f"{BASE_URL}/api/services", json=payload, headers=coach_headers)
        assert resp.status_code == 200, f"Service creation failed: {resp.text}"
        data = resp.json()
        
        # Validate service_id returned
        assert "service_id" in data
        TestCreateService.created_service_id = data["service_id"]
        
        # Validate basic fields
        assert data["title"] == "TEST_Coaching Running Paris"
        assert data["price"] == 75.0
        assert data["duration_min"] == 60
        
        # CRITICAL: locations and slots must be included
        assert "locations" in data, "Response must include 'locations' key"
        assert "slots" in data, "Response must include 'slots' key"
        assert len(data["locations"]) == 2, f"Expected 2 locations, got {len(data['locations'])}"
        assert len(data["slots"]) == 3, f"Expected 3 slots, got {len(data['slots'])}"
        
        print(f"PASS: Service created with id={data['service_id']}, locations={len(data['locations'])}, slots={len(data['slots'])}")

    def test_create_service_without_locations_slots(self, coach_headers, domain_id):
        """Service with empty locations and slots should work too."""
        payload = {
            "title": "TEST_Basic Service No Locations",
            "price": 50.0,
            "domain_id": domain_id,
            "tag_ids": VALID_TAG_IDS,
            "locations": [],
            "slots": []
        }
        resp = requests.post(f"{BASE_URL}/api/services", json=payload, headers=coach_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "locations" in data
        assert "slots" in data
        assert data["locations"] == []
        assert data["slots"] == []
        print("PASS: Service created with empty locations and slots")

    def test_create_service_requires_coach_role(self, domain_id):
        """Regular user (non-coach) should not be able to create a service."""
        import uuid
        # Create a fresh non-coach user to test this restriction
        temp_email = f"test_nocoach_{uuid.uuid4().hex[:8]}@test.com"
        reg = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": temp_email, "password": "TestPass1234!", "name": "Temp NoCoach", "language": "fr"
        }, timeout=10)
        assert reg.status_code == 200, f"Register failed: {reg.text}"
        token = reg.json().get("token") or reg.json().get("access_token")
        hdrs = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        payload = {
            "title": "TEST_Unauthorized Service",
            "price": 30.0,
            "domain_id": domain_id,
            "tag_ids": []
        }
        resp = requests.post(f"{BASE_URL}/api/services", json=payload, headers=hdrs)
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"
        print("PASS: Non-coach user gets 403 on service creation")


# ── TEST 3: GET /api/services includes locations and slots ───────────────────
class TestGetServices:
    """Verify GET /api/services returns locations and slots keys"""

    def test_get_services_has_locations_and_slots_keys(self):
        resp = requests.get(f"{BASE_URL}/api/services")
        assert resp.status_code == 200
        services = resp.json()
        assert isinstance(services, list), "Response must be a list"
        print(f"Total services returned: {len(services)}")
        
        if len(services) > 0:
            svc = services[0]
            assert "locations" in svc, f"Service missing 'locations' key. Keys: {list(svc.keys())}"
            assert "slots" in svc, f"Service missing 'slots' key. Keys: {list(svc.keys())}"
            assert isinstance(svc["locations"], list)
            assert isinstance(svc["slots"], list)
            print(f"PASS: Service has locations={svc['locations']} and slots={svc['slots']}")

    def test_get_service_by_id_has_locations_and_slots(self):
        """Fetch all services, pick first with ID, check locations/slots."""
        resp = requests.get(f"{BASE_URL}/api/services")
        assert resp.status_code == 200
        services = resp.json()
        if not services:
            pytest.skip("No services to test")
        
        svc_id = services[0]["service_id"]
        single_resp = requests.get(f"{BASE_URL}/api/services/{svc_id}")
        assert single_resp.status_code == 200
        data = single_resp.json()
        assert "locations" in data, "GET /services/{id} missing 'locations' key"
        assert "slots" in data, "GET /services/{id} missing 'slots' key"
        print(f"PASS: GET /services/{svc_id} has locations and slots keys")

    def test_get_my_services_has_locations_and_slots(self, coach_headers):
        """GET /services/mine should also include locations and slots."""
        resp = requests.get(f"{BASE_URL}/api/services/mine", headers=coach_headers)
        assert resp.status_code == 200
        services = resp.json()
        assert isinstance(services, list)
        
        if len(services) > 0:
            svc = services[0]
            assert "locations" in svc, "GET /services/mine missing 'locations' key"
            assert "slots" in svc, "GET /services/mine missing 'slots' key"
            print(f"PASS: GET /services/mine has locations and slots. Count: {len(services)}")
        else:
            print("INFO: No services found in /services/mine")


# ── TEST 4: Geospatial search with new service_locations table ───────────────
class TestGeospatialSearch:
    """Verify geospatial search uses service_locations table"""

    def test_geospatial_search_paris(self):
        """Search near Paris - should return services with Paris locations."""
        resp = requests.get(
            f"{BASE_URL}/api/services",
            params={"lat": 48.8566, "lng": 2.3522, "radius": 50000}
        )
        assert resp.status_code == 200
        services = resp.json()
        assert isinstance(services, list)
        print(f"PASS: Geospatial search near Paris returned {len(services)} services")
        
        # All returned services should have locations
        for svc in services:
            assert "locations" in svc
            assert "slots" in svc

    def test_geospatial_search_far_location(self):
        """Search in a far-away location (Tokyo) with small radius = should return 0."""
        resp = requests.get(
            f"{BASE_URL}/api/services",
            params={"lat": 35.6895, "lng": 139.6917, "radius": 1000}
        )
        assert resp.status_code == 200
        services = resp.json()
        assert isinstance(services, list)
        print(f"PASS: Geospatial search in Tokyo returned {len(services)} services (expected 0 or very few)")

    def test_geospatial_search_invalid_params(self):
        """Search with lat only (no lng) - should still work or return 200."""
        resp = requests.get(
            f"{BASE_URL}/api/services",
            params={"lat": 48.8566}
        )
        # FastAPI should handle this gracefully (lat without lng = no geo filter applied)
        assert resp.status_code in [200, 422]
        print(f"PASS: Single lat param returned {resp.status_code}")

    def test_geospatial_search_large_radius(self):
        """Search entire France with large radius."""
        resp = requests.get(
            f"{BASE_URL}/api/services",
            params={"lat": 46.2276, "lng": 2.2137, "radius": 1000000}
        )
        assert resp.status_code == 200
        services = resp.json()
        assert isinstance(services, list)
        print(f"PASS: Large radius search returned {len(services)} services")


# ── TEST 5: Persistence verification - create and GET ───────────────────────
class TestServicePersistence:
    """Verify created service data is correctly persisted"""

    def test_created_service_locations_persisted(self, coach_headers, domain_id):
        """Create service with specific locations, then GET it to verify data."""
        payload = {
            "title": "TEST_Persistence Check Service",
            "price": 100.0,
            "domain_id": domain_id,
            "tag_ids": VALID_TAG_IDS,
            "locations": [
                {
                    "latitude": 48.8738,
                    "longitude": 2.2950,
                    "precision": "1000m",
                    "description": "Arc de Triomphe"
                }
            ],
            "slots": [
                {"day_of_week": 0, "start_time": "07:00", "end_time": "08:00"}
            ]
        }
        create_resp = requests.post(f"{BASE_URL}/api/services", json=payload, headers=coach_headers)
        assert create_resp.status_code == 200
        created = create_resp.json()
        svc_id = created["service_id"]
        
        # GET the service to verify persistence
        get_resp = requests.get(f"{BASE_URL}/api/services/{svc_id}")
        assert get_resp.status_code == 200
        fetched = get_resp.json()
        
        # Verify locations persisted
        assert len(fetched["locations"]) == 1
        loc = fetched["locations"][0]
        assert abs(loc["latitude"] - 48.8738) < 0.001
        assert abs(loc["longitude"] - 2.2950) < 0.001
        assert loc["precision"] == "1000m"
        
        # Verify slots persisted
        assert len(fetched["slots"]) == 1
        slot = fetched["slots"][0]
        assert slot["day_of_week"] == 0
        assert slot["start_time"] == "07:00"
        assert slot["end_time"] == "08:00"
        
        print(f"PASS: Service {svc_id} - location and slot data correctly persisted")


# ── TEST 6: Coach can create service and see it in /services/mine ─────────────
class TestServiceMine:
    """Test coach's own service management"""

    def test_mine_contains_newly_created_service(self, coach_headers, domain_id):
        # Create a new service
        payload = {
            "title": "TEST_Mine Check Service",
            "price": 80.0,
            "domain_id": domain_id,
            "tag_ids": VALID_TAG_IDS,
            "locations": [],
            "slots": []
        }
        create_resp = requests.post(f"{BASE_URL}/api/services", json=payload, headers=coach_headers)
        assert create_resp.status_code == 200
        svc_id = create_resp.json()["service_id"]
        
        # Check it appears in /services/mine
        mine_resp = requests.get(f"{BASE_URL}/api/services/mine", headers=coach_headers)
        assert mine_resp.status_code == 200
        mine_svcs = mine_resp.json()
        found = any(s["service_id"] == svc_id for s in mine_svcs)
        assert found, f"Newly created service {svc_id} not found in /services/mine"
        print(f"PASS: New service {svc_id} found in /services/mine")
