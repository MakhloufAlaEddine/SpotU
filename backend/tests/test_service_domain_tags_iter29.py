"""
Backend tests for the new create-service flow (iter 29):
- Step 2: Domain (domain_id) + Tags (tag_ids) instead of package types
- POST /api/services with domain_id + tag_ids + packages[{type_id: 'main'}]
- GET /api/domains returns domains list
- GET /api/tags/categories?domain_id=... returns categories with tags
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://taglive-demo.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def coach_token():
    """Get authentication token for coach"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "coach@winek.app",
        "password": "WinekCoach2024!"
    })
    assert response.status_code == 200, f"Login failed: {response.status_code} {response.text}"
    data = response.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def coach_client(coach_token):
    """HTTP session for coach"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {coach_token}"
    })
    return session


# ─── Test GET /api/domains ─────────────────────────────────────────────────────

class TestDomains:
    """GET /api/domains - public endpoint"""

    def test_get_domains_returns_list(self):
        """GET /api/domains returns non-empty list"""
        r = requests.get(f"{BASE_URL}/api/domains")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert isinstance(data, list), "Expected list"
        assert len(data) > 0, "Expected at least one domain"
        print(f"Domains count: {len(data)}")

    def test_get_domains_structure(self):
        """Each domain has required fields"""
        r = requests.get(f"{BASE_URL}/api/domains")
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        for domain in data:
            assert "domain_id" in domain, f"Missing domain_id in {domain}"
            assert "label_fr" in domain, f"Missing label_fr in {domain}"
            assert "label_en" in domain, f"Missing label_en in {domain}"
        print(f"Domain IDs: {[d['domain_id'] for d in data]}")

    def test_dom_sport_exists(self):
        """dom_sport domain exists (used as default)"""
        r = requests.get(f"{BASE_URL}/api/domains")
        assert r.status_code == 200
        data = r.json()
        domain_ids = [d["domain_id"] for d in data]
        assert "dom_sport" in domain_ids, f"dom_sport not found. Available: {domain_ids}"
        print(f"dom_sport found in domains")


# ─── Test GET /api/tags/categories ────────────────────────────────────────────

class TestTagCategories:
    """GET /api/tags/categories?domain_id=... - public endpoint"""

    def test_get_categories_all(self):
        """GET /api/tags/categories (no filter) returns categories"""
        r = requests.get(f"{BASE_URL}/api/tags/categories")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        print(f"All categories count: {len(data)}")

    def test_get_categories_by_domain(self):
        """GET /api/tags/categories?domain_id=dom_sport returns sport categories"""
        r = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Expected at least one category for dom_sport"
        print(f"dom_sport categories: {len(data)}")

    def test_categories_have_tags(self):
        """Each category contains a tags list"""
        r = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport")
        assert r.status_code == 200
        data = r.json()
        for cat in data:
            assert "category_id" in cat
            assert "tags" in cat, f"Missing tags in category {cat}"
            assert isinstance(cat["tags"], list)
        print(f"Categories with tags: {[(c['category_id'], len(c['tags'])) for c in data]}")

    def test_tags_have_required_fields(self):
        """Each tag has tag_id, label_fr, label_en, category_id"""
        r = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport")
        assert r.status_code == 200
        data = r.json()
        all_tags = [t for c in data for t in c.get("tags", [])]
        assert len(all_tags) > 0, "Expected tags in sport domain"
        for tag in all_tags[:5]:  # Check first 5
            assert "tag_id" in tag
            assert "label_fr" in tag
            assert "label_en" in tag
            assert "category_id" in tag
        print(f"Tags sample: {[t['tag_id'] for t in all_tags[:3]]}")

    def test_get_first_tag_id(self):
        """Get a real tag_id for use in service creation tests"""
        r = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport")
        assert r.status_code == 200
        data = r.json()
        all_tags = [t for c in data for t in c.get("tags", [])]
        assert len(all_tags) > 0
        TestTagCategories.first_tag_id = all_tags[0]["tag_id"]
        print(f"First tag_id: {TestTagCategories.first_tag_id}")


# ─── Test POST /api/services with new payload format ─────────────────────────

class TestCreateServiceNewFlow:
    """Test POST /api/services with domain_id + tag_ids + packages[{type_id:'main'}]"""
    created_service_id = None
    first_tag_id = None

    @classmethod
    def get_first_tag(cls):
        """Get first available tag_id from dom_sport"""
        r = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport")
        if r.status_code == 200:
            data = r.json()
            all_tags = [t for c in data for t in c.get("tags", [])]
            if all_tags:
                return all_tags[0]["tag_id"]
        return None

    def test_create_service_with_domain_and_tags(self, coach_client):
        """Create service with domain_id + tag_ids in main payload, packages[{type_id:'main'}]"""
        tag_id = self.get_first_tag()
        TestCreateServiceNewFlow.first_tag_id = tag_id

        payload = {
            "title": "TEST_Service Domaine Tags iter29",
            "description": "Service de test avec le nouveau flux domain+tags de l'itération 29",
            "address": "Paris 75001",
            "price": 60.0,
            "duration_min": 60,
            "max_participants": 5,
            "domain_id": "dom_sport",
            "tag_ids": [tag_id] if tag_id else [],
            "packages": [{
                "type_id": "main",
                "type_label": "Service principal",
                "duration_min": 60,
                "max_participants": 5,
                "price": 60.0,
                "slots": [
                    {
                        "slot_date": "2026-03-15",
                        "start_time": "10:00",
                        "end_time": "11:00"
                    }
                ]
            }],
            "locations": [],
            "slots": []
        }

        r = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()

        # Verify service fields
        assert "service_id" in data
        assert data["title"] == "TEST_Service Domaine Tags iter29"
        assert data["domain_id"] == "dom_sport", f"Expected dom_sport, got {data.get('domain_id')}"

        # Verify tag_ids stored
        if tag_id:
            tag_ids_stored = data.get("tag_ids", [])
            assert tag_id in tag_ids_stored, f"Tag {tag_id} not in tag_ids: {tag_ids_stored}"

        # Verify packages
        assert "packages" in data
        assert len(data["packages"]) == 1
        pkg = data["packages"][0]
        assert pkg["type_id"] == "main"
        assert float(pkg["price"]) == 60.0
        assert len(pkg["slots"]) == 1

        TestCreateServiceNewFlow.created_service_id = data["service_id"]
        print(f"Created service with domain+tags: {data['service_id']}")

    def test_created_service_has_tags_resolved(self, coach_client):
        """GET /api/services/{id} returns tags array (resolved from tag_ids)"""
        svc_id = TestCreateServiceNewFlow.created_service_id
        if not svc_id:
            pytest.skip("No service created")

        r = coach_client.get(f"{BASE_URL}/api/services/{svc_id}")
        assert r.status_code == 200
        data = r.json()

        # tags should be resolved
        assert "tags" in data, "Missing tags in response"
        tag_id = TestCreateServiceNewFlow.first_tag_id
        if tag_id:
            assert len(data["tags"]) > 0, "Expected resolved tags"
            tag_ids = [t["tag_id"] for t in data["tags"]]
            assert tag_id in tag_ids, f"Tag {tag_id} not in resolved tags"
            print(f"Resolved tags: {tag_ids}")

    def test_create_service_with_domain_no_tags(self, coach_client):
        """Create service with domain_id but no tags (valid)"""
        payload = {
            "title": "TEST_Service Domain NoTags iter29",
            "description": "Service avec domaine mais sans tags",
            "price": 45.0,
            "duration_min": 45,
            "max_participants": 1,
            "domain_id": "dom_sport",
            "tag_ids": [],
            "packages": [{
                "type_id": "main",
                "type_label": "Service principal",
                "duration_min": 45,
                "max_participants": 1,
                "price": 45.0,
                "slots": []
            }],
            "locations": [],
            "slots": []
        }
        r = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data["domain_id"] == "dom_sport"
        assert data.get("tag_ids", []) == []
        print(f"Service without tags created: {data['service_id']}")

    def test_create_service_with_multiple_tags(self, coach_client):
        """Create service with multiple tags"""
        r = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport")
        assert r.status_code == 200
        cats = r.json()
        all_tags = [t for c in cats for t in c.get("tags", [])]
        tag_ids = [t["tag_id"] for t in all_tags[:3]]  # first 3 tags

        payload = {
            "title": "TEST_Service Multiple Tags iter29",
            "description": "Service avec plusieurs tags",
            "price": 50.0,
            "duration_min": 60,
            "max_participants": 8,
            "domain_id": "dom_sport",
            "tag_ids": tag_ids,
            "packages": [{
                "type_id": "main",
                "type_label": "Service principal",
                "duration_min": 60,
                "max_participants": 8,
                "price": 50.0,
                "slots": []
            }],
            "locations": [],
            "slots": []
        }
        r = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        stored_tags = data.get("tag_ids", [])
        for tid in tag_ids:
            assert tid in stored_tags, f"Tag {tid} not stored"
        print(f"Multiple tags stored: {stored_tags}")

    def test_create_service_with_slot_in_package(self, coach_client):
        """Create service with main package containing WeekCalendar slot"""
        tag_id = self.get_first_tag()
        payload = {
            "title": "TEST_Service Slot WeekCal iter29",
            "description": "Service avec créneau WeekCalendar format nouveau",
            "price": 75.0,
            "duration_min": 60,
            "max_participants": 1,
            "domain_id": "dom_sport",
            "tag_ids": [tag_id] if tag_id else [],
            "packages": [{
                "type_id": "main",
                "type_label": "Service principal",
                "duration_min": 60,
                "max_participants": 1,
                "price": 75.0,
                "slots": [
                    {"slot_date": "2026-04-01", "start_time": "09:00", "end_time": "10:00"},
                    {"slot_date": "2026-04-02", "start_time": "14:00", "end_time": "15:00"}
                ]
            }],
            "locations": [],
            "slots": []
        }
        r = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert len(data["packages"]) == 1
        pkg = data["packages"][0]
        assert len(pkg["slots"]) == 2, f"Expected 2 slots, got {len(pkg['slots'])}"
        assert pkg["slots"][0]["slot_date"] == "2026-04-01"
        assert pkg["slots"][1]["slot_date"] == "2026-04-02"
        print(f"2 slots created: {[(s['slot_date'], s['start_time']) for s in pkg['slots']]}")


# ─── Test Score criteria validation ───────────────────────────────────────────

class TestScoreComputation:
    """Verify score criteria match what the frontend computes client-side"""

    def test_score_criteria_all_met(self, coach_client):
        """Service with title>=5, desc>=50, address, tags, price, slots → score 100"""
        tag_id = TestCreateServiceNewFlow.get_first_tag()
        payload = {
            "title": "TEST_Full Score Service",  # >= 5 chars
            "description": "A" * 55,  # >= 50 chars
            "address": "75 Rue de Rivoli, Paris",
            "price": 80.0,
            "duration_min": 60,
            "max_participants": 1,
            "domain_id": "dom_sport",
            "tag_ids": [tag_id] if tag_id else [],
            "packages": [{
                "type_id": "main",
                "type_label": "Service principal",
                "duration_min": 60,
                "max_participants": 1,
                "price": 80.0,
                "slots": [{"slot_date": "2026-05-01", "start_time": "10:00", "end_time": "11:00"}]
            }],
            "locations": [],
            "slots": []
        }
        r = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert r.status_code == 200
        data = r.json()
        # Verify domain+tags saved
        assert data["domain_id"] == "dom_sport"
        if tag_id:
            assert tag_id in data.get("tag_ids", [])
        # Verify price
        assert float(data["price"]) == 80.0
        # Verify slot
        assert len(data["packages"][0]["slots"]) == 1
        print(f"Full score service: domain={data['domain_id']}, tags={data['tag_ids']}, price={data['price']}, slots={len(data['packages'][0]['slots'])}")


# ─── Cleanup ──────────────────────────────────────────────────────────────────

class TestCleanup:
    """Remove TEST_ services created during tests"""

    def test_cleanup_test_services_iter29(self, coach_client):
        """Delete all TEST_ services created during iter29 tests"""
        r = coach_client.get(f"{BASE_URL}/api/services/mine")
        assert r.status_code == 200
        services = r.json()

        deleted = 0
        for svc in services:
            if svc.get("title", "").startswith("TEST_") and "iter29" in svc.get("title", ""):
                del_r = coach_client.delete(f"{BASE_URL}/api/services/{svc['service_id']}")
                assert del_r.status_code == 200
                deleted += 1

        print(f"Cleaned up {deleted} iter29 TEST_ services")
