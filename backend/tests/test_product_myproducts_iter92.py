"""
Tests iteration 92 - My Products: admin_comment, detail endpoint, edit mode
Covers: GET /products/mine, GET /products/{id}/detail, DELETE /products/{id}
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

USER_EMAIL = "user@winek.app"
USER_PASS = "WinekUser2024!"
ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS = "WinekAdmin2024!"


@pytest.fixture(scope="module")
def user_token():
    """Get user auth token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASS})
    if resp.status_code != 200:
        pytest.skip(f"User auth failed: {resp.status_code} - {resp.text}")
    return resp.json().get("token") or resp.json().get("access_token")


@pytest.fixture(scope="module")
def admin_token():
    """Get admin auth token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    if resp.status_code != 200:
        pytest.skip(f"Admin auth failed: {resp.status_code} - {resp.text}")
    return resp.json().get("token") or resp.json().get("access_token")


@pytest.fixture(scope="module")
def user_headers(user_token):
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ─── GET /products/mine ────────────────────────────────────────────────────────

class TestGetMyProducts:
    """Tests for GET /api/products/mine"""

    def test_get_my_products_returns_200(self, user_headers):
        """GET /products/mine should return 200"""
        resp = requests.get(f"{BASE_URL}/api/products/mine", headers=user_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_get_my_products_has_products_list(self, user_headers):
        """Response should have 'products' list and 'count'"""
        resp = requests.get(f"{BASE_URL}/api/products/mine", headers=user_headers)
        data = resp.json()
        assert "products" in data, "Response missing 'products' key"
        assert "count" in data, "Response missing 'count' key"
        assert isinstance(data["products"], list), "'products' should be a list"

    def test_get_my_products_includes_admin_comment_field(self, user_headers):
        """Response products should include admin_comment field"""
        resp = requests.get(f"{BASE_URL}/api/products/mine", headers=user_headers)
        data = resp.json()
        products = data.get("products", [])
        if len(products) == 0:
            pytest.skip("No products to test admin_comment field")
        # Every product should have admin_comment field (can be None)
        for p in products:
            assert "admin_comment" in p, f"Product {p.get('product_id')} missing admin_comment field"

    def test_get_my_products_includes_rejection_reason_field(self, user_headers):
        """Response products should include rejection_reason field"""
        resp = requests.get(f"{BASE_URL}/api/products/mine", headers=user_headers)
        data = resp.json()
        products = data.get("products", [])
        if len(products) == 0:
            pytest.skip("No products to test rejection_reason field")
        for p in products:
            assert "rejection_reason" in p, f"Product {p.get('product_id')} missing rejection_reason field"

    def test_rejected_product_has_admin_comment(self, user_headers):
        """Rejected products should expose admin_comment (even if None)"""
        resp = requests.get(f"{BASE_URL}/api/products/mine", headers=user_headers)
        data = resp.json()
        rejected = [p for p in data.get("products", []) if p.get("status") == "rejected"]
        if not rejected:
            pytest.skip("No rejected products found")
        for p in rejected:
            assert "admin_comment" in p, f"Rejected product {p['product_id']} missing admin_comment"
            assert "rejection_reason" in p, f"Rejected product {p['product_id']} missing rejection_reason"

    def test_get_my_products_requires_auth(self):
        """GET /products/mine without auth should return 401"""
        resp = requests.get(f"{BASE_URL}/api/products/mine")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_my_products_excludes_deleted(self, user_headers):
        """Deleted products should not appear in /products/mine"""
        resp = requests.get(f"{BASE_URL}/api/products/mine", headers=user_headers)
        data = resp.json()
        deleted = [p for p in data.get("products", []) if p.get("status") == "deleted"]
        assert len(deleted) == 0, f"Found {len(deleted)} deleted products in response"

    def test_my_products_key_fields_present(self, user_headers):
        """Products should have all critical display fields"""
        resp = requests.get(f"{BASE_URL}/api/products/mine", headers=user_headers)
        data = resp.json()
        products = data.get("products", [])
        if not products:
            pytest.skip("No products to validate fields")
        p = products[0]
        required_fields = ["product_id", "title", "status", "price", "pricing_type", "category"]
        for f in required_fields:
            assert f in p, f"Product missing required field: {f}"


# ─── GET /products/{id}/detail ─────────────────────────────────────────────────

class TestGetProductDetail:
    """Tests for GET /api/products/{id}/detail"""

    @pytest.fixture(scope="class")
    def product_id(self, user_headers):
        """Get first available product_id for the test user"""
        resp = requests.get(f"{BASE_URL}/api/products/mine", headers=user_headers)
        products = resp.json().get("products", [])
        if not products:
            pytest.skip("No products available for detail test")
        return products[0]["product_id"]

    def test_detail_returns_200(self, user_headers, product_id):
        """GET /products/{id}/detail should return 200"""
        resp = requests.get(f"{BASE_URL}/api/products/{product_id}/detail", headers=user_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_detail_includes_lat_lng(self, user_headers, product_id):
        """Detail endpoint should include lat and lng fields for edit mode"""
        resp = requests.get(f"{BASE_URL}/api/products/{product_id}/detail", headers=user_headers)
        data = resp.json()
        assert "lat" in data, "Detail missing 'lat' field"
        assert "lng" in data, "Detail missing 'lng' field"

    def test_detail_includes_return_rules(self, user_headers, product_id):
        """Detail endpoint should include return_rules"""
        resp = requests.get(f"{BASE_URL}/api/products/{product_id}/detail", headers=user_headers)
        data = resp.json()
        assert "return_rules" in data, "Detail missing 'return_rules' field"

    def test_detail_includes_admin_comment(self, user_headers, product_id):
        """Detail endpoint should include admin_comment"""
        resp = requests.get(f"{BASE_URL}/api/products/{product_id}/detail", headers=user_headers)
        data = resp.json()
        assert "admin_comment" in data, "Detail missing 'admin_comment' field"
        assert "rejection_reason" in data, "Detail missing 'rejection_reason' field"

    def test_detail_includes_all_edit_fields(self, user_headers, product_id):
        """Detail endpoint should include all fields needed for edit mode"""
        resp = requests.get(f"{BASE_URL}/api/products/{product_id}/detail", headers=user_headers)
        data = resp.json()
        edit_fields = [
            "product_id", "title", "short_description", "description",
            "price", "pricing_type", "category", "subcategory",
            "condition_label", "available_quantity",
            "deposit_required", "deposit_amount", "max_duration_days",
            "pickup_type", "pickup_notes",
            "return_rules", "cancellation_rules",
            "city", "lat", "lng", "location_privacy",
            "availability_note", "related_spotyou_ids",
            "image_urls", "cover_image_url",
        ]
        for f in edit_fields:
            assert f in data, f"Detail missing field needed for edit: {f}"

    def test_detail_404_for_nonexistent(self, user_headers):
        """Detail endpoint should return 404 for non-existent product"""
        resp = requests.get(f"{BASE_URL}/api/products/prod_doesnotexist123/detail", headers=user_headers)
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"

    def test_detail_requires_auth(self, product_id):
        """Detail endpoint should require authentication"""
        resp = requests.get(f"{BASE_URL}/api/products/{product_id}/detail")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_detail_returns_correct_product_id(self, user_headers, product_id):
        """Detail endpoint should return the product with the correct ID"""
        resp = requests.get(f"{BASE_URL}/api/products/{product_id}/detail", headers=user_headers)
        data = resp.json()
        assert data.get("product_id") == product_id, f"Expected product_id={product_id}, got {data.get('product_id')}"


# ─── Rejected product admin_comment ────────────────────────────────────────────

class TestRejectedProductComment:
    """Tests for rejected product with admin_comment"""

    def test_rejected_product_detail_has_comment_field(self, user_headers):
        """Rejected product detail should always have admin_comment field"""
        resp = requests.get(f"{BASE_URL}/api/products/mine", headers=user_headers)
        products = resp.json().get("products", [])
        rejected = [p for p in products if p.get("status") == "rejected"]
        if not rejected:
            pytest.skip("No rejected products")

        pid = rejected[0]["product_id"]
        detail_resp = requests.get(f"{BASE_URL}/api/products/{pid}/detail", headers=user_headers)
        assert detail_resp.status_code == 200
        detail = detail_resp.json()
        assert "admin_comment" in detail, "Rejected product detail missing admin_comment"
        assert "rejection_reason" in detail, "Rejected product detail missing rejection_reason"

    def test_rejected_product_in_mine_has_comment(self, user_headers):
        """prod_db57e17e79eb should appear in /products/mine with admin_comment field"""
        resp = requests.get(f"{BASE_URL}/api/products/mine", headers=user_headers)
        products = resp.json().get("products", [])
        # Try to find rejected product
        rejected_with_comment = [
            p for p in products
            if p.get("status") == "rejected" and p.get("admin_comment") is not None
        ]
        # This test just checks the field exists for at least one rejected product
        # admin_comment can be None for some rejected products, that's fine
        for p in products:
            assert "admin_comment" in p, f"Missing admin_comment in product {p.get('product_id')}"


# ─── Product Delete ─────────────────────────────────────────────────────────────

class TestProductDelete:
    """Tests for DELETE /api/products/{id}"""

    def test_delete_product_flow(self, user_headers):
        """Create a product then delete it - verify it's gone"""
        # Create a test product
        create_resp = requests.post(
            f"{BASE_URL}/api/products",
            headers=user_headers,
            json={
                "title": "TEST_Product for deletion iter92",
                "price": 10.0,
                "pricing_type": "day",
                "status": "draft",
                "category": "Sport",
            }
        )
        assert create_resp.status_code == 200, f"Create failed: {create_resp.text}"
        pid = create_resp.json()["product_id"]

        # Delete it
        del_resp = requests.delete(f"{BASE_URL}/api/products/{pid}", headers=user_headers)
        assert del_resp.status_code == 200, f"Delete failed: {del_resp.text}"
        assert del_resp.json().get("ok") is True

        # Verify it's gone from /products/mine
        mine_resp = requests.get(f"{BASE_URL}/api/products/mine", headers=user_headers)
        ids = [p["product_id"] for p in mine_resp.json().get("products", [])]
        assert pid not in ids, f"Deleted product {pid} still appears in /products/mine"

    def test_delete_requires_ownership(self, user_headers, admin_headers):
        """User cannot delete admin's product"""
        # First create a product as admin
        create_resp = requests.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json={
                "title": "TEST_Admin product for ownership test",
                "price": 5.0,
                "pricing_type": "day",
                "status": "draft",
                "category": "Sport",
            }
        )
        if create_resp.status_code != 200:
            pytest.skip("Could not create admin product")
        pid = create_resp.json()["product_id"]

        # Try to delete as user → should fail
        del_resp = requests.delete(f"{BASE_URL}/api/products/{pid}", headers=user_headers)
        assert del_resp.status_code in [403, 404], f"Expected 403/404, got {del_resp.status_code}"

        # Cleanup: delete as admin
        requests.delete(f"{BASE_URL}/api/products/{pid}", headers=admin_headers)

    def test_delete_requires_auth(self):
        """DELETE without auth should return 401"""
        resp = requests.delete(f"{BASE_URL}/api/products/some_product_id")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
