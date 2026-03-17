"""
Iteration 13: Owner Actions Backend Tests
Tests: PATCH /visibility toggle, DELETE (soft-delete), PUT update, GET is_public field
Owner tagPoint: pt_f3d97e5b3271 belongs to user@winek.app (user_demo001)
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
    return 'https://spotmap-fix.preview.emergentagent.com'

BASE_URL = _load_base_url()


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
USER_EMAIL = "user@winek.app"
USER_PASS = "WinekUser2024!"
OWNED_POINT_ID = None  # sera défini dans setup_module


def setup_module(module):
    """Crée un tag-point pour les tests de cette suite (règle métier : tag requis)."""
    global OWNED_POINT_ID
    login = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": USER_EMAIL, "password": USER_PASS},
        headers={"Content-Type": "application/json"},
    )
    assert login.status_code == 200, f"Login failed in setup_module: {login.text}"
    token = login.json()["token"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "title": "TEST_Owned Point owner_actions",
        "latitude": 48.8566,
        "longitude": 2.3522,
        "precision": "exact",
        "tag_ids": VALID_TAG_IDS,
        "domain_id": "dom_sport",
        "images": [],
    }
    create_resp = requests.post(f"{BASE_URL}/api/tag-points", json=payload, headers=headers)
    assert create_resp.status_code == 200, f"Setup create failed: {create_resp.text}"
    OWNED_POINT_ID = create_resp.json()["point_id"]
    print(f"setup_module: created OWNED_POINT_ID={OWNED_POINT_ID}")


def teardown_module(module):
    """Supprime le tag-point créé dans setup_module."""
    if not OWNED_POINT_ID:
        return
    login = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": USER_EMAIL, "password": USER_PASS},
        headers={"Content-Type": "application/json"},
    )
    if login.status_code != 200:
        return
    token = login.json()["token"]
    requests.delete(
        f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    print(f"teardown_module: deleted OWNED_POINT_ID={OWNED_POINT_ID}")


@pytest.fixture(scope="module")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def user_token(api_client):
    """Login as owner user and return token"""
    resp = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": USER_EMAIL,
        "password": USER_PASS
    })
    assert resp.status_code == 200, f"User login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(user_token):
    return {"Authorization": f"Bearer {user_token}"}


# ─── Test 1: GET TagPoint includes is_public field ──────────────────────────────
class TestGetTagPoint:
    """GET /api/tag-points/{id} should include is_public field"""

    def test_get_returns_is_public_field(self, api_client):
        """GET /api/tag-points/{id} includes is_public in response"""
        resp = api_client.get(f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "is_public" in data, "Response must include 'is_public' field"
        assert isinstance(data["is_public"], bool), f"is_public must be bool, got {type(data['is_public'])}"

    def test_get_returns_all_required_fields(self, api_client):
        """GET /api/tag-points/{id} returns title, description, point_id, user_id, is_public"""
        resp = api_client.get(f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}")
        assert resp.status_code == 200
        data = resp.json()
        for field in ["point_id", "user_id", "title", "description", "is_public", "active", "owner"]:
            assert field in data, f"Missing field: {field}"
        assert data["point_id"] == OWNED_POINT_ID
        assert data["user_id"] == "user_demo001"

    def test_get_unknown_tagpoint_returns_404(self, api_client):
        """GET /api/tag-points/nonexistent returns 404"""
        resp = api_client.get(f"{BASE_URL}/api/tag-points/nonexistent_id_xyz")
        assert resp.status_code == 404


# ─── Test 2: PATCH /visibility toggle ───────────────────────────────────────────
class TestVisibilityToggle:
    """PATCH /api/tag-points/{id}/visibility toggles is_public"""

    def test_visibility_requires_auth(self, api_client):
        """PATCH /visibility without token returns 401 or 403"""
        resp = api_client.patch(f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}/visibility", json={})
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"

    def test_visibility_toggle_first_call(self, api_client, auth_headers):
        """First call to PATCH /visibility toggles is_public to opposite value"""
        # Get current state
        get_resp = api_client.get(f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}")
        assert get_resp.status_code == 200
        current_is_public = get_resp.json()["is_public"]

        # Toggle
        resp = api_client.patch(
            f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}/visibility",
            json={},
            headers=auth_headers
        )
        assert resp.status_code == 200, f"PATCH visibility failed: {resp.status_code} - {resp.text}"
        data = resp.json()
        assert "is_public" in data, "Response must contain 'is_public'"
        assert data["is_public"] != current_is_public, \
            f"Expected toggle from {current_is_public} to {not current_is_public}, got {data['is_public']}"

    def test_visibility_toggle_second_call_restores(self, api_client, auth_headers):
        """Second call to PATCH /visibility toggles back to original value"""
        # Get state after first toggle
        get_resp = api_client.get(f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}")
        assert get_resp.status_code == 200
        current_is_public = get_resp.json()["is_public"]

        # Toggle again
        resp = api_client.patch(
            f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}/visibility",
            json={},
            headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "is_public" in data
        assert data["is_public"] != current_is_public, \
            f"Second toggle should flip back: expected {not current_is_public}, got {data['is_public']}"

    def test_visibility_persisted_in_db(self, api_client, auth_headers):
        """After toggle, GET confirms new is_public value persisted"""
        # Get initial
        get1 = api_client.get(f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}")
        initial_public = get1.json()["is_public"]

        # Toggle
        patch_resp = api_client.patch(
            f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}/visibility",
            json={},
            headers=auth_headers
        )
        assert patch_resp.status_code == 200
        toggled_val = patch_resp.json()["is_public"]

        # Verify persistence with GET
        get2 = api_client.get(f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}")
        assert get2.status_code == 200
        assert get2.json()["is_public"] == toggled_val, \
            "Toggled value not persisted in DB"

        # Restore original state
        api_client.patch(
            f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}/visibility",
            json={},
            headers=auth_headers
        )
        get3 = api_client.get(f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}")
        assert get3.json()["is_public"] == initial_public, "Failed to restore original is_public"


# ─── Test 3: PUT /tag-points/{id} update ────────────────────────────────────────
class TestUpdateTagPoint:
    """PUT /api/tag-points/{id} updates title and description"""

    ORIGINAL_TITLE = "Foot 3x3 - bezon"  # Known original title
    TEST_TITLE = "Foot 3x3 - bezon EDITED"
    TEST_DESC = "Description mise à jour pour le test iter13"

    def test_update_requires_auth(self, api_client):
        """PUT without token returns 401 or 403"""
        resp = api_client.put(
            f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}",
            json={"title": "Unauthorized update"}
        )
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"

    def test_update_title_and_description(self, api_client, auth_headers):
        """PUT updates title and description correctly"""
        resp = api_client.put(
            f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}",
            json={"title": self.TEST_TITLE, "description": self.TEST_DESC},
            headers=auth_headers
        )
        assert resp.status_code == 200, f"PUT failed: {resp.status_code} - {resp.text}"
        data = resp.json()
        assert data["title"] == self.TEST_TITLE, f"Expected title '{self.TEST_TITLE}', got '{data['title']}'"
        assert data["description"] == self.TEST_DESC, f"Expected desc '{self.TEST_DESC}', got '{data['description']}'"
        assert data["point_id"] == OWNED_POINT_ID

    def test_update_persisted_in_db(self, api_client, auth_headers):
        """After PUT, GET confirms new title/description persisted"""
        # Update
        api_client.put(
            f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}",
            json={"title": self.TEST_TITLE},
            headers=auth_headers
        )
        # Verify with GET
        get_resp = api_client.get(f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}")
        assert get_resp.status_code == 200
        assert get_resp.json()["title"] == self.TEST_TITLE

    def test_update_restores_original_title(self, api_client, auth_headers):
        """Restore original title after tests"""
        resp = api_client.put(
            f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}",
            json={"title": self.ORIGINAL_TITLE, "description": "Vfseebeb"},
            headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == self.ORIGINAL_TITLE, "Failed to restore original title"


# ─── Test 4: DELETE (soft delete) ───────────────────────────────────────────────
class TestDeleteTagPoint:
    """DELETE /api/tag-points/{id} sets active=FALSE (soft delete). 
    IMPORTANT: We test with a TEMP tagPoint, not pt_f3d97e5b3271."""

    def test_delete_temp_point_sets_active_false(self, api_client, auth_headers):
        """Create a temp tagPoint, delete it, verify active=FALSE"""
        # Create temp tagPoint
        create_resp = api_client.post(
            f"{BASE_URL}/api/tag-points",
            json={
                "title": "TEST_Iter13 DeleteTest",
                "description": "Temp tagpoint for delete test",
                "latitude": 48.8566,
                "longitude": 2.3522,
                "precision": "exact",
                "tag_ids": VALID_TAG_IDS,
                "domain_id": "dom_sport"
            },
            headers=auth_headers
        )
        assert create_resp.status_code == 200, f"Create failed: {create_resp.status_code} - {create_resp.text}"
        temp_id = create_resp.json()["point_id"]
        assert temp_id is not None

        # Delete the temp tagPoint
        del_resp = api_client.delete(
            f"{BASE_URL}/api/tag-points/{temp_id}",
            headers=auth_headers
        )
        assert del_resp.status_code == 200, f"DELETE failed: {del_resp.status_code} - {del_resp.text}"
        del_data = del_resp.json()
        assert del_data.get("success") == True, "DELETE should return {success: True}"

    def test_delete_requires_auth(self, api_client):
        """DELETE without token returns 401 or 403"""
        resp = api_client.delete(f"{BASE_URL}/api/tag-points/{OWNED_POINT_ID}")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"

    def test_delete_nonexistent_returns_404(self, api_client, auth_headers):
        """DELETE nonexistent tagPoint returns 404"""
        resp = api_client.delete(
            f"{BASE_URL}/api/tag-points/nonexistent_xyz_123",
            headers=auth_headers
        )
        assert resp.status_code == 404

    def test_delete_other_user_point_returns_403(self, api_client, auth_headers):
        """DELETE someone else's tagPoint returns 403"""
        # Get a tagPoint not owned by user@winek.app
        all_resp = api_client.get(f"{BASE_URL}/api/tag-points?lat=48.8566&lng=2.3522&radius=50000")
        assert all_resp.status_code == 200
        points = all_resp.json()
        # Find one not owned by user_demo001
        other_point = next(
            (p for p in points if p.get("user_id") != "user_demo001" and p.get("active")),
            None
        )
        if other_point is None:
            pytest.skip("No other user's tagPoint available for 403 test")
        resp = api_client.delete(
            f"{BASE_URL}/api/tag-points/{other_point['point_id']}",
            headers=auth_headers
        )
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"
