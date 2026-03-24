"""
Backend tests for 4-step service creation with packages
Tests: POST /api/services with packages, GET /api/services/{id}, validation, permissions
Iteration 28 - New stepper form with packages
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://product-showcase-461.preview.emergentagent.com"

# Dates dynamiques (toujours dans le futur)
_FUTURE_DATE_1 = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
_FUTURE_DATE_2 = (datetime.now() + timedelta(days=35)).strftime("%Y-%m-%d")


@pytest.fixture(scope="module")
def coach_token():
    """Get authentication token for coach"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "coach@winek.app",
        "password": "WinekCoach2024!"
    })
    assert response.status_code == 200
    return response.json()["token"]


@pytest.fixture(scope="module")
def user_token():
    """Get authentication token for regular user"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "user@winek.app",
        "password": "WinekUser2024!"
    })
    assert response.status_code == 200
    return response.json()["token"]


@pytest.fixture(scope="module")
def coach_client(coach_token):
    """HTTP session for coach with auth headers"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {coach_token}"
    })
    return session


@pytest.fixture(scope="module")
def user_client(user_token):
    """HTTP session for regular user"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {user_token}"
    })
    return session


# --- Auth tests ---

class TestAuth:
    """Authentication and role checks"""

    def test_coach_login(self):
        """Coach login works and returns token + role"""
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "coach@winek.app",
            "password": "WinekCoach2024!"
        })
        assert r.status_code == 200
        data = r.json()
        assert "token" in data
        assert data.get("user", {}).get("role") == "coach"

    def test_user_login(self):
        """Regular user login works"""
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "user@winek.app",
            "password": "WinekUser2024!"
        })
        assert r.status_code == 200
        data = r.json()
        assert data.get("user", {}).get("role") in ("user", "coach"), \
            f"Expected 'user' or 'coach' role, got {data.get('user', {}).get('role')} " \
            f"(Note: user_demo001 is promoted to coach by the demo seed)"

    def test_invalid_credentials(self):
        """Invalid credentials return 401"""
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "coach@winek.app",
            "password": "wrong_password"
        })
        assert r.status_code == 401


# --- POST /api/services - package creation ---

class TestCreateServiceWithPackages:
    """Test POST /api/services with the new packages model"""

    created_service_id = None

    def test_create_service_single_package(self, coach_client):
        """Create service with 1 package (individual) and 1 slot"""
        payload = {
            "title": "TEST_Cours Tennis Individuel",
            "description": "Coach professionnel 10 ans expérience",
            "address": "Paris 75001",
            "price": None,
            "packages": [
                {
                    "type_id": "individual",
                    "type_label": "Cours individuel",
                    "duration_min": 60,
                    "max_participants": 1,
                    "price": 80.0,
                    "slots": [
                        {
                            "slot_date": _FUTURE_DATE_1,
                            "start_time": "10:00",
                            "end_time": "11:00"
                        }
                    ]
                }
            ],
            "locations": [],
            "slots": []
        }
        r = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert r.status_code == 200
        data = r.json()

        # Validate service fields
        assert "service_id" in data
        assert data["title"] == "TEST_Cours Tennis Individuel"
        assert data["address"] == "Paris 75001"

        # Validate packages in response
        assert "packages" in data
        assert len(data["packages"]) == 1

        pkg = data["packages"][0]
        assert pkg["type_id"] == "individual"
        assert pkg["type_label"] == "Cours individuel"
        assert pkg["duration_min"] == 60
        assert pkg["max_participants"] == 1
        assert float(pkg["price"]) == 80.0
        assert len(pkg["slots"]) == 1

        slot = pkg["slots"][0]
        assert slot["slot_date"] == _FUTURE_DATE_1
        assert slot["start_time"] == "10:00"
        assert slot["end_time"] == "11:00"

        # Store for subsequent tests
        TestCreateServiceWithPackages.created_service_id = data["service_id"]
        print(f"Created service: {data['service_id']}")

    def test_create_service_multiple_packages(self, coach_client):
        """Create service with multiple packages (individual + group_small)"""
        payload = {
            "title": "TEST_Multi-package Service",
            "description": "Service avec plusieurs types de prestations",
            "address": "Lyon 69001",
            "price": None,
            "packages": [
                {
                    "type_id": "individual",
                    "type_label": "Cours individuel",
                    "duration_min": 60,
                    "max_participants": 1,
                    "price": 80.0,
                    "slots": [
                        {"slot_date": _FUTURE_DATE_1, "start_time": "09:00", "end_time": "10:00"}
                    ]
                },
                {
                    "type_id": "group_small",
                    "type_label": "Petit groupe",
                    "duration_min": 90,
                    "max_participants": 6,
                    "price": 30.0,
                    "slots": [
                        {"slot_date": _FUTURE_DATE_2, "start_time": "14:00", "end_time": "15:30"}
                    ]
                }
            ],
            "locations": [],
            "slots": []
        }
        r = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert r.status_code == 200
        data = r.json()

        assert len(data["packages"]) == 2
        # Verify price is minimum of packages (30.0)
        assert float(data["price"]) == 30.0
        print(f"Multi-package service: {data['service_id']}, price={data['price']}")

    def test_service_price_computed_from_packages(self, coach_client):
        """When price=None, service price = min of package prices"""
        payload = {
            "title": "TEST_Price From Packages",
            "description": "Test prix auto",
            "packages": [
                {"type_id": "individual", "type_label": "Cours individuel", "price": 120.0, "duration_min": 60, "max_participants": 1, "slots": []},
                {"type_id": "online", "type_label": "Coaching en ligne", "price": 50.0, "duration_min": 45, "max_participants": 1, "slots": []},
            ],
            "locations": [],
            "slots": []
        }
        r = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert r.status_code == 200
        data = r.json()
        # Min price should be 50.0
        assert float(data["price"]) == 50.0

    def test_create_service_all_package_types(self, coach_client):
        """Create service with all 6 package types"""
        package_types = [
            {"type_id": "individual", "type_label": "Cours individuel", "price": 80.0, "max_participants": 1},
            {"type_id": "group_small", "type_label": "Petit groupe", "price": 30.0, "max_participants": 6},
            {"type_id": "group_large", "type_label": "Grand groupe", "price": 20.0, "max_participants": 15},
            {"type_id": "intensive", "type_label": "Stage intensif", "price": 200.0, "max_participants": 10},
            {"type_id": "online", "type_label": "Coaching en ligne", "price": 50.0, "max_participants": 1},
            {"type_id": "workshop", "type_label": "Atelier collectif", "price": 25.0, "max_participants": 20},
        ]
        packages = [{**pt, "duration_min": 60, "slots": []} for pt in package_types]
        payload = {
            "title": "TEST_All Package Types",
            "description": "Test avec tous les types de packages",
            "packages": packages,
            "locations": [],
            "slots": []
        }
        r = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert len(data["packages"]) == 6
        type_ids_returned = {p["type_id"] for p in data["packages"]}
        assert type_ids_returned == {"individual", "group_small", "group_large", "intensive", "online", "workshop"}

    def test_create_service_with_location(self, coach_client):
        """Create service with package + location"""
        payload = {
            "title": "TEST_With Location",
            "description": "Service avec adresse et coordonnées",
            "address": "Stade de France, Paris",
            "packages": [
                {"type_id": "individual", "type_label": "Cours individuel", "price": 70.0, "duration_min": 60, "max_participants": 1, "slots": []}
            ],
            "locations": [
                {"latitude": 48.924, "longitude": 2.36, "precision": "exact", "description": "Stade de France"}
            ],
            "slots": []
        }
        r = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert len(data["locations"]) == 1
        assert len(data["packages"]) == 1

    def test_create_service_without_auth(self):
        """Creating service without auth returns 401"""
        r = requests.post(f"{BASE_URL}/api/services", json={
            "title": "Unauthorized service",
            "packages": []
        })
        assert r.status_code == 401

    def test_create_service_unauthenticated_returns_401(self):
        """Unauthenticated request cannot create services (401)"""
        r = requests.post(f"{BASE_URL}/api/services", json={
            "title": "Test without auth",
            "packages": [{"type_id": "individual", "type_label": "Cours", "price": 50.0, "duration_min": 60, "max_participants": 1, "slots": []}]
        })
        assert r.status_code == 401, f"Expected 401 (no auth), got {r.status_code}"

    def test_get_created_service_has_packages(self, coach_client):
        """GET /api/services/{id} returns packages with slots"""
        svc_id = TestCreateServiceWithPackages.created_service_id
        if not svc_id:
            pytest.skip("No service created in previous test")

        r = coach_client.get(f"{BASE_URL}/api/services/{svc_id}")
        assert r.status_code == 200
        data = r.json()
        assert data["service_id"] == svc_id
        assert "packages" in data
        assert len(data["packages"]) >= 1

        pkg = data["packages"][0]
        assert "package_id" in pkg
        assert "slots" in pkg
        assert len(pkg["slots"]) == 1


# --- GET /api/services ---

class TestGetServices:
    """Test GET service endpoints"""

    def test_get_services_list(self):
        """GET /api/services returns a list"""
        r = requests.get(f"{BASE_URL}/api/services")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_get_my_services_requires_auth(self):
        """GET /api/services/mine requires auth"""
        r = requests.get(f"{BASE_URL}/api/services/mine")
        assert r.status_code == 401

    def test_get_my_services_coach(self, coach_client):
        """GET /api/services/mine returns coach's services"""
        r = coach_client.get(f"{BASE_URL}/api/services/mine")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # All returned services should belong to this coach
        for svc in data:
            assert "service_id" in svc
            assert "packages" in svc  # enriched response includes packages

    def test_get_services_have_packages_field(self):
        """GET /api/services returns services with packages field"""
        r = requests.get(f"{BASE_URL}/api/services")
        assert r.status_code == 200
        data = r.json()
        for svc in data:
            assert "packages" in svc


# --- Cleanup: delete TEST_ services ---

class TestCleanup:
    """Remove TEST_ services created during testing"""

    def test_cleanup_test_services(self, coach_client):
        """Delete all TEST_ services created during tests"""
        r = coach_client.get(f"{BASE_URL}/api/services/mine")
        assert r.status_code == 200
        services = r.json()

        deleted = 0
        for svc in services:
            if svc.get("title", "").startswith("TEST_"):
                del_r = coach_client.delete(f"{BASE_URL}/api/services/{svc['service_id']}")
                assert del_r.status_code == 200
                deleted += 1

        print(f"Cleaned up {deleted} TEST_ services")
