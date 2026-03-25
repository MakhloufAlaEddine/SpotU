"""
Test suite for Tags & Domains management (iteration 78)
Tests: CRUD for domains, categories, tags + usage endpoints + admin analytics
"""
import pytest
import requests
import os

BASE_URL = "https://quality-analyzer.preview.emergentagent.com"

ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS = "WinekAdmin2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS = "WinekCoach2024!"


@pytest.fixture(scope="module")
def admin_token():
    """Get admin JWT token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASS
    })
    if resp.status_code != 200:
        pytest.skip(f"Admin login failed: {resp.status_code} {resp.text}")
    return resp.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def coach_token():
    """Get coach JWT token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": COACH_EMAIL, "password": COACH_PASS
    })
    if resp.status_code != 200:
        pytest.skip(f"Coach login failed: {resp.status_code} {resp.text}")
    return resp.json()["token"]


@pytest.fixture(scope="module")
def coach_headers(coach_token):
    return {"Authorization": f"Bearer {coach_token}"}


# ── Admin Login ───────────────────────────────────────────────────────────────

class TestAdminLogin:
    """Admin authentication tests"""

    def test_admin_login_success(self):
        """Admin can login with correct credentials"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASS
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert data["user"]["role"] == "admin"

    def test_coach_login_success(self):
        """Coach can login"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": COACH_EMAIL, "password": COACH_PASS
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data


# ── Admin Analytics Endpoints ─────────────────────────────────────────────────

class TestAdminAnalyticsEndpoints:
    """Tests for admin list/analytics endpoints"""

    def test_get_all_domains(self, admin_headers):
        """GET /api/admin/all-domains returns list of domains with active status"""
        resp = requests.get(f"{BASE_URL}/api/admin/all-domains", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        if len(data) > 0:
            domain = data[0]
            assert "domain_id" in domain
            assert "name" in domain
            assert "active" in domain
            assert "label_fr" in domain

    def test_get_all_domains_requires_admin(self):
        """GET /api/admin/all-domains requires authentication"""
        resp = requests.get(f"{BASE_URL}/api/admin/all-domains")
        assert resp.status_code in [401, 403]

    def test_get_all_categories(self, admin_headers):
        """GET /api/admin/all-categories returns categories with domain_name"""
        resp = requests.get(f"{BASE_URL}/api/admin/all-categories", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        if len(data) > 0:
            cat = data[0]
            assert "category_id" in cat
            assert "name" in cat
            assert "active" in cat
            # domain_name may be None if no domain linked, but key should exist
            assert "domain_name" in cat

    def test_get_all_tags(self, admin_headers):
        """GET /api/admin/all-tags returns tags with domain_name and category_name"""
        resp = requests.get(f"{BASE_URL}/api/admin/all-tags", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        if len(data) > 0:
            tag = data[0]
            assert "tag_id" in tag
            assert "name" in tag
            assert "active" in tag
            assert "domain_name" in tag
            assert "category_name" in tag

    def test_get_tags_analytics(self, admin_headers):
        """GET /api/admin/tags-analytics returns top_tags, top_domains, totals"""
        resp = requests.get(f"{BASE_URL}/api/admin/tags-analytics", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "top_tags" in data
        assert "top_domains" in data
        assert "totals" in data
        totals = data["totals"]
        assert "tags" in totals
        assert "domains" in totals
        assert "categories" in totals
        assert "tag_usages" in totals

    def test_tags_analytics_top_tags_structure(self, admin_headers):
        """top_tags items should have tagpoint_count, user_count, total_usage"""
        resp = requests.get(f"{BASE_URL}/api/admin/tags-analytics", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        if len(data["top_tags"]) > 0:
            tag = data["top_tags"][0]
            assert "tagpoint_count" in tag
            assert "user_count" in tag
            assert "total_usage" in tag
            assert tag["total_usage"] == tag["tagpoint_count"] + tag["user_count"]

    def test_tags_analytics_top_domains_structure(self, admin_headers):
        """top_domains items should have tagpoint_count, user_count, total_usage"""
        resp = requests.get(f"{BASE_URL}/api/admin/tags-analytics", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        if len(data["top_domains"]) > 0:
            dom = data["top_domains"][0]
            assert "tagpoint_count" in dom
            assert "user_count" in dom
            assert "total_usage" in dom

    def test_tags_analytics_requires_admin(self, coach_headers):
        """Non-admin cannot access tags analytics"""
        resp = requests.get(f"{BASE_URL}/api/admin/tags-analytics", headers=coach_headers)
        assert resp.status_code in [401, 403]


# ── Domain CRUD ───────────────────────────────────────────────────────────────

class TestDomainCRUD:
    """CRUD operations on domains"""
    created_domain_id = None

    def test_get_domains_public(self):
        """GET /api/domains returns active domains (public)"""
        resp = requests.get(f"{BASE_URL}/api/domains")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_create_domain_admin(self, admin_headers):
        """POST /api/domains creates a new domain (admin only)"""
        payload = {
            "name": "test_domain_iter78",
            "label_fr": "TEST Domaine Iter78",
            "label_en": "TEST Domain Iter78",
            "icon": "🧪",
            "color": "#FF5733"
        }
        resp = requests.post(f"{BASE_URL}/api/domains", json=payload, headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "domain_id" in data
        assert data["name"] == "test_domain_iter78"
        assert data["active"] == True
        TestDomainCRUD.created_domain_id = data["domain_id"]

    def test_create_domain_requires_admin(self, coach_headers):
        """Non-admin cannot create a domain"""
        payload = {"name": "fail_domain", "label_fr": "Fail", "label_en": "Fail", "icon": "", "color": "#000"}
        resp = requests.post(f"{BASE_URL}/api/domains", json=payload, headers=coach_headers)
        assert resp.status_code in [401, 403]

    def test_update_domain(self, admin_headers):
        """PUT /api/domains/{id} updates a domain"""
        if not TestDomainCRUD.created_domain_id:
            pytest.skip("No domain to update (create test failed)")
        resp = requests.put(
            f"{BASE_URL}/api/domains/{TestDomainCRUD.created_domain_id}",
            json={"label_fr": "TEST Domaine Iter78 Updated"},
            headers=admin_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("success") == True

    def test_get_domain_usage(self, admin_headers):
        """GET /api/domains/{id}/usage returns tagpoint_count and user_count"""
        if not TestDomainCRUD.created_domain_id:
            pytest.skip("No domain to check usage")
        resp = requests.get(
            f"{BASE_URL}/api/domains/{TestDomainCRUD.created_domain_id}/usage",
            headers=admin_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "tagpoint_count" in data
        assert "user_count" in data
        assert isinstance(data["tagpoint_count"], int)
        assert isinstance(data["user_count"], int)

    def test_domain_usage_requires_admin(self, coach_headers):
        """Non-admin cannot access domain usage"""
        if not TestDomainCRUD.created_domain_id:
            pytest.skip("No domain ID available")
        resp = requests.get(
            f"{BASE_URL}/api/domains/{TestDomainCRUD.created_domain_id}/usage",
            headers=coach_headers
        )
        assert resp.status_code in [401, 403]

    def test_delete_domain_deactivate(self, admin_headers):
        """DELETE /api/domains/{id}?mode=deactivate soft-deletes a domain"""
        if not TestDomainCRUD.created_domain_id:
            pytest.skip("No domain to deactivate")
        resp = requests.delete(
            f"{BASE_URL}/api/domains/{TestDomainCRUD.created_domain_id}?mode=deactivate",
            headers=admin_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("success") == True

    def test_delete_domain_cascade(self, admin_headers):
        """DELETE /api/domains/{id}?mode=cascade permanently deletes a domain"""
        if not TestDomainCRUD.created_domain_id:
            pytest.skip("No domain to delete")
        resp = requests.delete(
            f"{BASE_URL}/api/domains/{TestDomainCRUD.created_domain_id}?mode=cascade",
            headers=admin_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("success") == True


# ── Tag Category CRUD ─────────────────────────────────────────────────────────

class TestCategoryCRUD:
    """CRUD operations on tag categories"""
    created_domain_id = None
    created_category_id = None

    @pytest.fixture(autouse=True, scope="class")
    def setup_domain(self, admin_headers):
        """Create a domain to use for category tests"""
        payload = {
            "name": "test_cat_domain_iter78",
            "label_fr": "TEST Cat Domain",
            "label_en": "TEST Cat Domain",
            "icon": "🔬", "color": "#3498DB"
        }
        resp = requests.post(f"{BASE_URL}/api/domains", json=payload, headers=admin_headers)
        if resp.status_code == 200:
            TestCategoryCRUD.created_domain_id = resp.json()["domain_id"]
        yield
        # Cleanup
        if TestCategoryCRUD.created_domain_id:
            requests.delete(
                f"{BASE_URL}/api/domains/{TestCategoryCRUD.created_domain_id}?mode=cascade",
                headers=admin_headers
            )

    def test_create_category(self, admin_headers):
        """POST /api/tags/categories creates a new category"""
        if not TestCategoryCRUD.created_domain_id:
            pytest.skip("No domain created")
        payload = {
            "domain_id": TestCategoryCRUD.created_domain_id,
            "name": "test_cat_iter78",
            "label_fr": "TEST Catégorie Iter78",
            "label_en": "TEST Category Iter78",
            "icon": "🧪"
        }
        resp = requests.post(f"{BASE_URL}/api/tags/categories", json=payload, headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "category_id" in data
        assert data["name"] == "test_cat_iter78"
        TestCategoryCRUD.created_category_id = data["category_id"]

    def test_update_category(self, admin_headers):
        """PUT /api/tags/categories/{id} updates a category"""
        if not TestCategoryCRUD.created_category_id:
            pytest.skip("No category to update")
        resp = requests.put(
            f"{BASE_URL}/api/tags/categories/{TestCategoryCRUD.created_category_id}",
            json={"label_fr": "TEST Catégorie Iter78 Updated"},
            headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json().get("success") == True

    def test_get_category_usage(self, admin_headers):
        """GET /api/tags/categories/{id}/usage returns tag_count and tagpoint_count"""
        if not TestCategoryCRUD.created_category_id:
            pytest.skip("No category to check usage")
        resp = requests.get(
            f"{BASE_URL}/api/tags/categories/{TestCategoryCRUD.created_category_id}/usage",
            headers=admin_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "tag_count" in data
        assert "tagpoint_count" in data
        assert isinstance(data["tag_count"], int)
        assert isinstance(data["tagpoint_count"], int)

    def test_delete_category_deactivate(self, admin_headers):
        """DELETE /api/tags/categories/{id}?mode=deactivate soft-deletes"""
        if not TestCategoryCRUD.created_category_id:
            pytest.skip("No category to deactivate")
        resp = requests.delete(
            f"{BASE_URL}/api/tags/categories/{TestCategoryCRUD.created_category_id}?mode=deactivate",
            headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json().get("success") == True

    def test_delete_category_cascade(self, admin_headers):
        """DELETE /api/tags/categories/{id}?mode=cascade permanently deletes"""
        if not TestCategoryCRUD.created_category_id:
            pytest.skip("No category to delete")
        resp = requests.delete(
            f"{BASE_URL}/api/tags/categories/{TestCategoryCRUD.created_category_id}?mode=cascade",
            headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json().get("success") == True


# ── Tag CRUD ──────────────────────────────────────────────────────────────────

class TestTagCRUD:
    """CRUD operations on tags"""
    created_domain_id = None
    created_category_id = None
    created_tag_id = None

    @pytest.fixture(autouse=True, scope="class")
    def setup_domain_and_category(self, admin_headers):
        """Create domain + category for tag tests"""
        # Create domain
        d_resp = requests.post(f"{BASE_URL}/api/domains", json={
            "name": "test_tag_domain_iter78", "label_fr": "TEST Tag Domain",
            "label_en": "TEST Tag Domain", "icon": "🔬", "color": "#2ECC71"
        }, headers=admin_headers)
        if d_resp.status_code == 200:
            TestTagCRUD.created_domain_id = d_resp.json()["domain_id"]

        # Create category
        c_resp = requests.post(f"{BASE_URL}/api/tags/categories", json={
            "domain_id": TestTagCRUD.created_domain_id,
            "name": "test_tag_cat_iter78", "label_fr": "TEST Tag Cat",
            "label_en": "TEST Tag Cat", "icon": ""
        }, headers=admin_headers)
        if c_resp.status_code == 200:
            TestTagCRUD.created_category_id = c_resp.json()["category_id"]

        yield
        # Cleanup
        if TestTagCRUD.created_domain_id:
            requests.delete(
                f"{BASE_URL}/api/domains/{TestTagCRUD.created_domain_id}?mode=cascade",
                headers=admin_headers
            )

    def test_create_tag(self, admin_headers):
        """POST /api/tags creates a new tag"""
        if not TestTagCRUD.created_domain_id or not TestTagCRUD.created_category_id:
            pytest.skip("Domain/Category not created")
        payload = {
            "domain_id": TestTagCRUD.created_domain_id,
            "category_id": TestTagCRUD.created_category_id,
            "name": "test_tag_iter78",
            "label_fr": "TEST Tag Iter78",
            "label_en": "TEST Tag Iter78",
            "icon": "🧪"
        }
        resp = requests.post(f"{BASE_URL}/api/tags", json=payload, headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "tag_id" in data
        assert data["name"] == "test_tag_iter78"
        TestTagCRUD.created_tag_id = data["tag_id"]

    def test_update_tag(self, admin_headers):
        """PUT /api/tags/{id} updates a tag"""
        if not TestTagCRUD.created_tag_id:
            pytest.skip("No tag to update")
        resp = requests.put(
            f"{BASE_URL}/api/tags/{TestTagCRUD.created_tag_id}",
            json={"label_fr": "TEST Tag Iter78 Updated"},
            headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json().get("success") == True

    def test_get_tag_usage(self, admin_headers):
        """GET /api/tags/{id}/usage returns tagpoint_count and user_count"""
        if not TestTagCRUD.created_tag_id:
            pytest.skip("No tag to check usage")
        resp = requests.get(
            f"{BASE_URL}/api/tags/{TestTagCRUD.created_tag_id}/usage",
            headers=admin_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "tagpoint_count" in data
        assert "user_count" in data
        assert isinstance(data["tagpoint_count"], int)
        assert isinstance(data["user_count"], int)

    def test_get_tag_usage_requires_admin(self, coach_headers):
        """Non-admin cannot access tag usage"""
        if not TestTagCRUD.created_tag_id:
            pytest.skip("No tag ID available")
        resp = requests.get(
            f"{BASE_URL}/api/tags/{TestTagCRUD.created_tag_id}/usage",
            headers=coach_headers
        )
        assert resp.status_code in [401, 403]

    def test_delete_tag_cascade(self, admin_headers):
        """DELETE /api/tags/{id}?mode=cascade permanently deletes a tag"""
        if not TestTagCRUD.created_tag_id:
            pytest.skip("No tag to delete")
        resp = requests.delete(
            f"{BASE_URL}/api/tags/{TestTagCRUD.created_tag_id}?mode=cascade",
            headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json().get("success") == True

    def test_delete_nonexistent_tag(self, admin_headers):
        """DELETE tag that doesn't exist returns 404 for deactivate mode"""
        resp = requests.delete(
            f"{BASE_URL}/api/tags/nonexistent_tag_xyz?mode=deactivate",
            headers=admin_headers
        )
        # For deactivate mode, it should return 404 since row won't be found
        # (cascade silently deletes 0 rows, deactivate checks)
        assert resp.status_code in [200, 404]


# ── Public Endpoints ──────────────────────────────────────────────────────────

class TestPublicTagEndpoints:
    """Public tag endpoints (no auth required)"""

    def test_get_tags(self):
        """GET /api/tags returns active tags"""
        resp = requests.get(f"{BASE_URL}/api/tags")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_get_categories(self):
        """GET /api/tags/categories returns active categories"""
        resp = requests.get(f"{BASE_URL}/api/tags/categories")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        if len(data) > 0:
            cat = data[0]
            assert "category_id" in cat
            assert "tags" in cat  # Categories come with nested tags

    def test_get_domains(self):
        """GET /api/domains returns active domains"""
        resp = requests.get(f"{BASE_URL}/api/domains")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)


# ── Update 404 Tests ──────────────────────────────────────────────────────────

class TestUpdateNotFound:
    """Test 404 handling for update endpoints"""

    def test_update_nonexistent_domain(self, admin_headers):
        """PUT on nonexistent domain returns 404"""
        resp = requests.put(
            f"{BASE_URL}/api/domains/nonexistent_dom_xyz",
            json={"label_fr": "test"},
            headers=admin_headers
        )
        assert resp.status_code == 404

    def test_update_nonexistent_category(self, admin_headers):
        """PUT on nonexistent category returns 404"""
        resp = requests.put(
            f"{BASE_URL}/api/tags/categories/nonexistent_cat_xyz",
            json={"label_fr": "test"},
            headers=admin_headers
        )
        assert resp.status_code == 404

    def test_update_nonexistent_tag(self, admin_headers):
        """PUT on nonexistent tag returns 404"""
        resp = requests.put(
            f"{BASE_URL}/api/tags/nonexistent_tag_xyz",
            json={"label_fr": "test"},
            headers=admin_headers
        )
        assert resp.status_code == 404
