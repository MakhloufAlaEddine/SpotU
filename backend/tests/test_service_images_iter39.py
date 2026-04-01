"""
Iteration 39 - Backend tests for service images feature:
- GET /services/{id} returns 'images' field
- PUT /services/{id} with images updates correctly
- POST /services with images creates correctly
- Ownership check on PUT (non-owner → 403)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://buyer-checkout-ui.preview.emergentagent.com').rstrip('/')

SERVICE_ID = None  # Set dynamically in setup_module

# ─── Setup / Teardown ────────────────────────────────────────────────────────

def setup_module(module):
    """Create a test service as coach@winek.app for image tests."""
    global SERVICE_ID

    tag_resp = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport", timeout=5)
    tag_ids = ["tag_3x3"]
    if tag_resp.status_code == 200:
        for cat in tag_resp.json():
            for tag in cat.get("tags", []):
                tag_ids = [tag["tag_id"]]
                break

    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "coach@winek.app",
        "password": "WinekCoach2024!"
    })
    assert r.status_code == 200, f"Coach login failed: {r.text}"
    coach_token = r.json()["token"]

    payload = {
        "title": "TEST_Service Images Iter39",
        "description": "Service de test pour les images",
        "price": 60.0,
        "duration_min": 60,
        "domain_id": "dom_sport",
        "tag_ids": tag_ids,
        "images": [],
        "locations": [],
        "packages": [{
            "type_id": "main",
            "type_label": "Session",
            "duration_min": 60,
            "max_participants": 1,
            "price": 60.0,
            "slots": []
        }],
        "slots": []
    }
    svc_r = requests.post(
        f"{BASE_URL}/api/services",
        headers={"Authorization": f"Bearer {coach_token}", "Content-Type": "application/json"},
        json=payload
    )
    assert svc_r.status_code == 200, f"Service creation failed: {svc_r.text}"
    SERVICE_ID = svc_r.json()["service_id"]
    print(f"[setup] Created test service: {SERVICE_ID}")


def teardown_module(module):
    """Delete the test service after all tests."""
    if not SERVICE_ID:
        return
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "coach@winek.app",
        "password": "WinekCoach2024!"
    })
    if r.status_code == 200:
        token = r.json()["token"]
        requests.delete(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers={"Authorization": f"Bearer {token}"}
        )
        print(f"[teardown] Deleted test service: {SERVICE_ID}")


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def owner_token():
    """coach@winek.app = owner of the test service"""
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "coach@winek.app",
        "password": "WinekCoach2024!"
    })
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def nonowner_token():
    """user@winek.app = NOT owner of the test service"""
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "user@winek.app",
        "password": "WinekUser2024!"
    })
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestServiceImagesGet:
    """GET /services/{id} must include 'images' field"""

    def test_get_service_has_images_field(self, owner_token):
        """Images field present in GET response"""
        r = requests.get(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers={"Authorization": f"Bearer {owner_token}"}
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "images" in data, "Field 'images' missing from service response"
        assert isinstance(data["images"], list), f"'images' should be a list, got {type(data['images'])}"
        print(f"[PASS] GET service has images field: {data['images']}")

    def test_get_service_no_auth_still_returns_images(self):
        """Images field accessible without auth (public endpoint)"""
        r = requests.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        assert "images" in data, "Field 'images' missing from service response (unauthenticated)"
        print(f"[PASS] GET service (no auth) has images field: {data['images']}")


class TestServiceImagesPut:
    """PUT /services/{id} with images field"""

    def test_put_images_as_owner(self, owner_token):
        """Owner can update images"""
        test_images = ["http://test.com/photo1.jpg", "http://test.com/photo2.jpg"]
        r = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
            json={"images": test_images}
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "images" in data, "Response missing 'images' field after update"
        # Verify persistence via GET
        get_r = requests.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        assert get_r.status_code == 200
        get_data = get_r.json()
        assert "images" in get_data, "GET after PUT missing 'images' field"
        returned_images = get_data["images"]
        assert isinstance(returned_images, list), f"images should be list, got {type(returned_images)}"
        assert returned_images == test_images, f"Expected {test_images}, got {returned_images}"
        print(f"[PASS] PUT images as owner: {returned_images}")

    def test_put_images_as_nonowner_returns_403(self, nonowner_token):
        """Non-owner cannot update images → 403"""
        r = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers={"Authorization": f"Bearer {nonowner_token}", "Content-Type": "application/json"},
            json={"images": ["http://hacker.com/photo.jpg"]}
        )
        assert r.status_code == 403, f"Expected 403 for non-owner, got {r.status_code}: {r.text}"
        print(f"[PASS] PUT images non-owner → 403")

    def test_put_empty_images_clears_images(self, owner_token):
        """Owner can clear images with empty list"""
        # First set images
        requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
            json={"images": ["http://test.com/old.jpg"]}
        )
        # Now clear
        r = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
            json={"images": []}
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        # Verify
        get_r = requests.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        returned_images = get_r.json().get("images", "NOT_PRESENT")
        assert isinstance(returned_images, list), f"images should be list"
        assert returned_images == [], f"Expected empty list, got {returned_images}"
        print(f"[PASS] PUT empty images clears correctly")


class TestServiceImagesPost:
    """POST /services with images field"""

    created_service_id = None

    def test_post_service_with_images(self, owner_token):
        """Create service with images in payload (coach creates)"""
        test_images = ["http://test.com/img1.jpg", "http://test.com/img2.jpg"]
        payload = {
            "title": "TEST_Service avec Photos iter39b",
            "description": "Description de test pour vérifier les images dans le service créé",
            "price": 50.0,
            "duration_min": 60,
            "domain_id": "dom_sport",
            "tag_ids": ["tag_3x3"],
            "images": test_images,
            "locations": [],
            "packages": [{
                "type_id": "main",
                "type_label": "Session principale",
                "duration_min": 60,
                "max_participants": 1,
                "price": 50.0,
                "slots": []
            }],
            "slots": []
        }
        r = requests.post(
            f"{BASE_URL}/api/services",
            headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
            json=payload
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "service_id" in data or "id" in data, "Missing service_id in response"
        TestServiceImagesPost.created_service_id = data.get("service_id") or data.get("id")
        assert "images" in data, "images field missing from POST response"
        returned_images = data["images"]
        assert isinstance(returned_images, list), f"images should be list, got {type(returned_images)}"
        assert returned_images == test_images, f"Expected {test_images}, got {returned_images}"
        print(f"[PASS] POST service with images: {returned_images}, service_id={TestServiceImagesPost.created_service_id}")

    def test_post_service_images_persisted(self, owner_token):
        """GET after POST verifies images persist"""
        if not TestServiceImagesPost.created_service_id:
            pytest.skip("Service creation failed in previous test")
        sid = TestServiceImagesPost.created_service_id
        r = requests.get(
            f"{BASE_URL}/api/services/{sid}",
            headers={"Authorization": f"Bearer {owner_token}"}
        )
        assert r.status_code == 200, f"GET after POST failed: {r.status_code}"
        data = r.json()
        assert "images" in data, "images field missing from GET after POST"
        assert isinstance(data["images"], list), "images should be list"
        assert len(data["images"]) == 2, f"Expected 2 images, got {len(data['images'])}"
        print(f"[PASS] GET after POST returns images: {data['images']}")

    def test_cleanup_created_service(self, owner_token):
        """Cleanup: delete test service"""
        if not TestServiceImagesPost.created_service_id:
            pytest.skip("No service to clean up")
        sid = TestServiceImagesPost.created_service_id
        r = requests.delete(
            f"{BASE_URL}/api/services/{sid}",
            headers={"Authorization": f"Bearer {owner_token}"}
        )
        assert r.status_code == 200, f"Cleanup failed: {r.status_code}"
        print(f"[PASS] Cleanup: service {sid} deleted")


class TestServiceImagesSeed:
    """Seed main test service with realistic images"""

    def test_seed_images(self, owner_token):
        """Set images on the test service"""
        seed_images = [
            "https://images.pexels.com/photos/1552252/pexels-photo-1552252.jpeg",
            "https://images.pexels.com/photos/841130/pexels-photo-841130.jpeg"
        ]
        r = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
            json={"images": seed_images}
        )
        assert r.status_code == 200, f"Seed failed: {r.status_code}: {r.text}"
        get_r = requests.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        returned = get_r.json().get("images", [])
        assert returned == seed_images, f"Seed not persisted: {returned}"
        print(f"[PASS] Seeded images for frontend test: {returned}")
