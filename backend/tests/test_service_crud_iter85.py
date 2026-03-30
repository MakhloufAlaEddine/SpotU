"""
Service CRUD API Tests - Iteration 85
Tests for service creation, editing, tags loading, and image handling
"""
import pytest
import requests
import os
import json

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://spot-you-products.preview.emergentagent.com')

@pytest.fixture
def coach_token():
    """Login as coach user and get token"""
    response = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "coach@winek.app", "password": "WinekCoach2024!"}
    )
    if response.status_code != 200:
        pytest.skip("Coach login failed")
    return response.json()["token"]


@pytest.fixture
def api_client(coach_token):
    """Session with auth header"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {coach_token}"
    })
    return session


class TestServiceRead:
    """Test GET service endpoints"""
    
    def test_get_service_demo001_exists(self):
        """Verify demo service exists with expected fields"""
        response = requests.get(f"{BASE_URL}/api/services/svc_demo001")
        assert response.status_code == 200
        
        data = response.json()
        assert data["service_id"] == "svc_demo001"
        assert data["domain_id"] == "dom_coaching"
        assert data["title"] == "Coaching fitness & running personnalisé"
        assert "coach" in data
        assert "images" in data
        
    def test_get_service_tags_are_present(self):
        """Verify service has tags array with expected tags"""
        response = requests.get(f"{BASE_URL}/api/services/svc_demo001")
        assert response.status_code == 200
        
        data = response.json()
        tag_ids = data.get("tag_ids", [])
        assert isinstance(tag_ids, list)
        assert len(tag_ids) == 4
        # Expected tags: tag_musculation, tag_cardio, tag_hiit, tag_coach_perso
        expected_tags = {"tag_musculation", "tag_cardio", "tag_hiit", "tag_coach_perso"}
        assert set(tag_ids) == expected_tags
        
    def test_get_service_images_are_urls(self):
        """Verify service images are valid URLs"""
        response = requests.get(f"{BASE_URL}/api/services/svc_demo001")
        assert response.status_code == 200
        
        data = response.json()
        images = data.get("images", [])
        assert isinstance(images, list)
        assert len(images) > 0
        for img in images:
            assert img.startswith("http")


class TestTagsAndDomains:
    """Test tags and domains API"""
    
    def test_get_domains_list(self):
        """Verify domains endpoint returns list"""
        response = requests.get(f"{BASE_URL}/api/domains")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        
        # Check dom_coaching exists
        coaching = next((d for d in data if d["domain_id"] == "dom_coaching"), None)
        assert coaching is not None
        assert coaching["label_fr"] == "Coaching"
        
    def test_get_tags_for_coaching_domain(self):
        """Verify tags can be fetched for coaching domain"""
        response = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_coaching")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        # Flatten all tags
        all_tags = []
        for cat in data:
            all_tags.extend(cat.get("tags", []))
        
        # tag_coach_perso should be in coaching domain
        coach_perso = next((t for t in all_tags if t["tag_id"] == "tag_coach_perso"), None)
        assert coach_perso is not None
        assert coach_perso["domain_id"] == "dom_coaching"
        
    def test_get_tags_for_sport_domain(self):
        """Verify tags can be fetched for sport domain"""
        response = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        # Flatten all tags
        all_tags = []
        for cat in data:
            all_tags.extend(cat.get("tags", []))
        
        # tag_musculation should be in sport domain
        musculation = next((t for t in all_tags if t["tag_id"] == "tag_musculation"), None)
        assert musculation is not None
        assert musculation["domain_id"] == "dom_sport"


class TestServiceUpdate:
    """Test PUT service endpoint"""
    
    def test_update_service_requires_auth(self):
        """Verify update service requires authentication"""
        response = requests.put(
            f"{BASE_URL}/api/services/svc_demo001",
            json={"title": "Test Update"}
        )
        assert response.status_code == 401
        
    def test_update_service_with_auth(self, api_client):
        """Verify service can be updated with auth"""
        # First get current service
        get_response = api_client.get(f"{BASE_URL}/api/services/svc_demo001")
        assert get_response.status_code == 200
        current = get_response.json()
        
        # Update with same data (no actual change)
        response = api_client.put(
            f"{BASE_URL}/api/services/svc_demo001",
            json={
                "title": current["title"],
                "description": current["description"]
            }
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data["title"] == current["title"]


class TestImageUpload:
    """Test image upload endpoint"""
    
    def test_upload_requires_auth(self):
        """Verify upload requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/upload-image?category=services"
        )
        assert response.status_code in [401, 422]  # 422 if missing file, 401 if auth checked first
        
    def test_upload_with_auth_but_no_file(self, api_client):
        """Verify upload with auth but no file returns error"""
        response = api_client.post(
            f"{BASE_URL}/api/upload-image?category=services"
        )
        assert response.status_code == 422  # Missing file


class TestMyServices:
    """Test coach's services endpoint"""
    
    def test_get_my_services_requires_auth(self):
        """Verify my services requires authentication"""
        response = requests.get(f"{BASE_URL}/api/services/mine")
        assert response.status_code == 401
        
    def test_get_my_services_returns_coach_services(self, api_client):
        """Verify my services returns services owned by coach"""
        response = api_client.get(f"{BASE_URL}/api/services/mine")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        # Coach user_coach001 should have at least svc_demo001
        assert len(data) >= 1
        
        # Verify all services belong to the coach
        for svc in data:
            assert svc["coach_id"] == "user_coach001"
