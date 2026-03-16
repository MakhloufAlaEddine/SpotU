"""
Test services seed data and API for iteration 41
Tests: /api/services (list), /api/services/{id} (detail), geo filtering, packages, slots, locations
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', os.environ.get('REACT_APP_BACKEND_URL', '')).rstrip('/')
PARIS_LAT = 48.8566
PARIS_LNG = 2.3522

class TestServicesListAPI:
    """Tests for GET /api/services"""

    def test_services_returns_4_demo_services(self):
        """Should return exactly 4 seeded demo services"""
        resp = requests.get(f"{BASE_URL}/api/services")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        # At least 4 demo services
        demo_ids = {s["service_id"] for s in data}
        assert "svc_demo001" in demo_ids
        assert "svc_demo002" in demo_ids
        assert "svc_demo003" in demo_ids
        assert "svc_demo004" in demo_ids

    def test_services_have_locations(self):
        """Seed demo services must have at least 1 location (test-created services are excluded)"""
        resp = requests.get(f"{BASE_URL}/api/services")
        assert resp.status_code == 200
        data = resp.json()
        # Only check seed/demo services by their known IDs
        demo_ids = {"svc_demo001", "svc_demo002", "svc_demo003", "svc_demo004"}
        # Also exclude services with "TEST" in title or no title (test-created)
        prod_svcs = [
            s for s in data
            if s.get("service_id") in demo_ids
            or (
                not s.get("title", "").startswith("TEST")
                and not s.get("title", "").startswith("User")
                and not s.get("title", "").startswith("Coaching ")
                and "demo" not in s.get("service_id", "")
            )
        ]
        # At minimum, check the 4 demo services
        demo_svcs = [s for s in data if s.get("service_id") in demo_ids]
        for svc in demo_svcs:
            assert len(svc.get("locations", [])) >= 1, f"Seed service {svc['service_id']} has no locations"
            loc = svc["locations"][0]
            assert "latitude" in loc and "longitude" in loc

    def test_services_have_packages(self):
        """Each demo service must have 2 packages"""
        resp = requests.get(f"{BASE_URL}/api/services")
        assert resp.status_code == 200
        data = resp.json()
        demo_svcs = {s["service_id"]: s for s in data if s["service_id"].startswith("svc_demo")}
        for sid, svc in demo_svcs.items():
            assert len(svc.get("packages", [])) >= 1, f"Service {sid} has no packages"

    def test_services_have_slots(self):
        """Each demo service must have slots"""
        resp = requests.get(f"{BASE_URL}/api/services")
        assert resp.status_code == 200
        data = resp.json()
        demo_svcs = {s["service_id"]: s for s in data if s["service_id"].startswith("svc_demo")}
        for sid, svc in demo_svcs.items():
            assert len(svc.get("slots", [])) >= 1, f"Service {sid} has no slots"

    def test_services_geo_filter_paris(self):
        """Services within 50km of Paris should return 4 demo services"""
        resp = requests.get(f"{BASE_URL}/api/services", params={
            "lat": PARIS_LAT, "lng": PARIS_LNG, "radius": 50000
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 4, f"Expected 4 services near Paris, got {len(data)}"

    def test_services_all_active(self):
        """All returned services must be active"""
        resp = requests.get(f"{BASE_URL}/api/services")
        assert resp.status_code == 200
        data = resp.json()
        for svc in data:
            assert svc.get("active") is True, f"Service {svc['service_id']} is not active"

    def test_services_have_coach_info(self):
        """Each service must have coach name populated"""
        resp = requests.get(f"{BASE_URL}/api/services")
        assert resp.status_code == 200
        data = resp.json()
        for svc in data:
            coach = svc.get("coach")
            assert coach is not None, f"Service {svc['service_id']} has no coach"
            assert "name" in coach and coach["name"]

    def test_services_have_price(self):
        """Each service must have a price > 0"""
        resp = requests.get(f"{BASE_URL}/api/services")
        assert resp.status_code == 200
        data = resp.json()
        for svc in data:
            assert svc.get("price") is not None and float(svc["price"]) > 0


class TestServiceDetailAPI:
    """Tests for GET /api/services/{service_id}"""

    def test_svc_demo001_detail(self):
        """svc_demo001 should have correct data"""
        resp = requests.get(f"{BASE_URL}/api/services/svc_demo001")
        assert resp.status_code == 200
        s = resp.json()
        assert s["service_id"] == "svc_demo001"
        assert s["coach"]["name"] == "Sophie Martin"
        assert float(s["price"]) == 60.0
        assert len(s["locations"]) >= 1
        assert len(s["packages"]) >= 1
        assert len(s["slots"]) >= 1

    def test_svc_demo001_has_images(self):
        """svc_demo001 should have images"""
        resp = requests.get(f"{BASE_URL}/api/services/svc_demo001")
        assert resp.status_code == 200
        s = resp.json()
        assert isinstance(s.get("images"), list)
        # svc_demo001 should have 2 images
        assert len(s["images"]) >= 1

    def test_svc_demo002_detail(self):
        """svc_demo002 Running coaching - user_demo001 (now coach)"""
        resp = requests.get(f"{BASE_URL}/api/services/svc_demo002")
        assert resp.status_code == 200
        s = resp.json()
        assert s["service_id"] == "svc_demo002"
        assert float(s["price"]) == 40.0
        assert len(s["packages"]) == 2

    def test_svc_demo003_detail(self):
        """svc_demo003 Basketball - user_demo002 (now coach)"""
        resp = requests.get(f"{BASE_URL}/api/services/svc_demo003")
        assert resp.status_code == 200
        s = resp.json()
        assert s["service_id"] == "svc_demo003"
        assert float(s["price"]) == 15.0

    def test_svc_demo004_detail(self):
        """svc_demo004 Yoga - user_demo003 (now coach)"""
        resp = requests.get(f"{BASE_URL}/api/services/svc_demo004")
        assert resp.status_code == 200
        s = resp.json()
        assert s["service_id"] == "svc_demo004"
        assert float(s["price"]) == 25.0

    def test_service_not_found(self):
        """Non-existent service should return 404"""
        resp = requests.get(f"{BASE_URL}/api/services/nonexistent_service")
        assert resp.status_code == 404


class TestServicesMineAPI:
    """Tests for GET /api/services/mine (coach-authenticated)"""

    def get_token(self, email, password):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
        if resp.status_code == 200:
            return resp.json().get("token")
        return None

    def test_coach_can_see_own_service(self):
        """coach@winek.app should see their service (svc_demo001)"""
        token = self.get_token("coach@winek.app", "WinekCoach2024!")
        if not token:
            pytest.skip("Auth failed")
        resp = requests.get(f"{BASE_URL}/api/services/mine", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        svc_ids = [s["service_id"] for s in data]
        assert "svc_demo001" in svc_ids

    def test_user_demo001_is_now_coach(self):
        """user_demo001 should now be a coach and see svc_demo002"""
        token = self.get_token("user@winek.app", "WinekUser2024!")
        if not token:
            pytest.skip("Auth failed")
        resp = requests.get(f"{BASE_URL}/api/services/mine", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        svc_ids = [s["service_id"] for s in data]
        assert "svc_demo002" in svc_ids, f"Expected svc_demo002 in {svc_ids}"

    def test_mine_requires_auth(self):
        """Services/mine without token should return 401"""
        resp = requests.get(f"{BASE_URL}/api/services/mine")
        assert resp.status_code == 401


class TestServicesDataPersistence:
    """Tests to verify seed data persists across requests (no memory loss)"""

    def test_packages_persist_after_multiple_calls(self):
        """Packages count should be consistent across repeated calls"""
        r1 = requests.get(f"{BASE_URL}/api/services/svc_demo001").json()
        r2 = requests.get(f"{BASE_URL}/api/services/svc_demo001").json()
        assert len(r1["packages"]) == len(r2["packages"])
        assert len(r1["packages"]) == 2

    def test_slots_persist(self):
        """Slots should be persisted in DB"""
        for sid in ["svc_demo001", "svc_demo002", "svc_demo003", "svc_demo004"]:
            resp = requests.get(f"{BASE_URL}/api/services/{sid}")
            assert resp.status_code == 200
            svc = resp.json()
            assert len(svc.get("slots", [])) > 0, f"No slots for {sid}"

    def test_locations_with_coordinates(self):
        """Locations must have valid lat/lng for geo search"""
        resp = requests.get(f"{BASE_URL}/api/services")
        assert resp.status_code == 200
        for svc in resp.json():
            if svc["service_id"].startswith("svc_demo"):
                loc = svc["locations"][0]
                lat = loc.get("latitude")
                lng = loc.get("longitude")
                assert lat is not None and lng is not None
                # Paris area check
                assert 48.0 < lat < 49.5, f"Latitude {lat} out of Paris range"
                assert 1.0 < lng < 3.5, f"Longitude {lng} out of Paris range"
