"""
Backend tests — Product creation flow (iteration 90)
Tests: GET /api/products/mine, POST /api/products, DELETE /api/products/{id}
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

# ── credentials ──────────────────────────────────────────────────────────────
USER_EMAIL    = "user@winek.app"
USER_PASSWORD = "WinekUser2024!"
ADMIN_EMAIL   = "admin@winek.app"
ADMIN_PASSWORD = "WinekAdmin2024!"


@pytest.fixture(scope="module")
def user_token():
    """Authenticate as regular user, return token."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    data = resp.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"No token in response: {data}"
    return token


@pytest.fixture(scope="module")
def user_client(user_token):
    """Requests session with user auth headers."""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {user_token}",
    })
    return session


@pytest.fixture(scope="module")
def created_product_id(user_client):
    """Create a product and return its ID (used across tests)."""
    payload = {
        "title": "TEST_Vélo de route carbone",
        "product_type": "rental",
        "category": "velo",
        "subcategory": "route",
        "short_description": "Location vélo carbone test",
        "description": "Vélo de route carbone 28 pouces, idéal pour longues randonnées",
        "price": 25.0,
        "pricing_type": "day",
        "available_quantity": 1,
        "condition_label": "good",
        "status": "draft",
    }
    resp = user_client.post(f"{BASE_URL}/api/products", json=payload)
    assert resp.status_code == 200, f"Create product failed: {resp.text}"
    data = resp.json()
    pid = data.get("product_id")
    assert pid, f"No product_id in response: {data}"
    return pid


class TestProductCreationAuth:
    """Authentication guard tests for product endpoints."""

    def test_get_mine_without_auth_returns_401(self):
        """GET /api/products/mine without auth should return 401."""
        resp = requests.get(f"{BASE_URL}/api/products/mine")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✅ GET /products/mine without auth → 401")

    def test_post_product_without_auth_returns_401(self):
        """POST /api/products without auth should return 401."""
        resp = requests.post(f"{BASE_URL}/api/products", json={"title": "Test"})
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✅ POST /products without auth → 401")

    def test_delete_product_without_auth_returns_401(self):
        """DELETE /api/products/{id} without auth should return 401."""
        resp = requests.delete(f"{BASE_URL}/api/products/prod_dummy123")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✅ DELETE /products/{id} without auth → 401")


class TestGetMyProducts:
    """GET /api/products/mine tests."""

    def test_get_mine_returns_200(self, user_client):
        """GET /api/products/mine should return 200."""
        resp = user_client.get(f"{BASE_URL}/api/products/mine")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        print("✅ GET /products/mine → 200")

    def test_get_mine_response_structure(self, user_client):
        """Response should contain 'products' list and 'count'."""
        resp = user_client.get(f"{BASE_URL}/api/products/mine")
        assert resp.status_code == 200
        data = resp.json()
        assert "products" in data, f"'products' key missing: {data}"
        assert "count" in data, f"'count' key missing: {data}"
        assert isinstance(data["products"], list), f"'products' should be a list: {data}"
        assert isinstance(data["count"], int), f"'count' should be int: {data}"
        print(f"✅ Response structure OK — count={data['count']}")

    def test_get_mine_products_have_required_fields(self, user_client, created_product_id):
        """Each product in the list should have key fields."""
        resp = user_client.get(f"{BASE_URL}/api/products/mine")
        assert resp.status_code == 200
        data = resp.json()
        # ensure our test product is in the list
        products = data["products"]
        assert len(products) > 0, "Expected at least one product (created in fixture)"
        # check required fields on first product
        p = products[0]
        required_fields = ["product_id", "title", "status", "price", "product_type", "category"]
        for field in required_fields:
            assert field in p, f"Field '{field}' missing from product: {p.keys()}"
        print(f"✅ Product fields OK: {list(p.keys())[:8]}")

    def test_get_mine_no_deleted_products(self, user_client):
        """Deleted products should not appear in the list."""
        resp = user_client.get(f"{BASE_URL}/api/products/mine")
        data = resp.json()
        for p in data["products"]:
            assert p["status"] != "deleted", f"Deleted product appeared: {p['product_id']}"
        print("✅ No deleted products in /mine response")


class TestCreateProduct:
    """POST /api/products tests."""

    def test_create_product_minimal_draft(self, user_client):
        """Create a minimal draft product."""
        payload = {
            "title": "TEST_Raquettes de padel location",
            "product_type": "rental",
            "category": "raquette",
            "price": 10.0,
            "status": "draft",
        }
        resp = user_client.post(f"{BASE_URL}/api/products", json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "product_id" in data, f"No product_id in response: {data}"
        assert data.get("status") == "draft", f"Expected status=draft: {data}"
        print(f"✅ Create minimal draft → product_id={data['product_id']}")

    def test_create_product_all_fields(self, user_client):
        """Create a product with all fields populated."""
        payload = {
            "title": "TEST_Vélo fitness Décathlon",
            "product_type": "rental",
            "category": "fitness",
            "subcategory": "velo_salle",
            "short_description": "Vélo fitness en excellent état",
            "description": "Décathlon B'Twin domyos, peu utilisé, siège réglable, écran",
            "price": 15.0,
            "pricing_type": "day",
            "available_quantity": 2,
            "condition_label": "very_good",
            "included_items": "Casque, gants",
            "brand_model": "Domyos VM 190",
            "deposit_required": True,
            "deposit_amount": 50.0,
            "max_duration_days": 7,
            "pickup_type": "local_pickup",
            "pickup_notes": "Disponible le matin",
            "return_rules": "Retour en bon état",
            "cancellation_rules": "Annulation 24h avant",
            "city": "Paris",
            "location_privacy": "100m",
            "status": "draft",
        }
        resp = user_client.post(f"{BASE_URL}/api/products", json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "product_id" in data
        assert data["status"] == "draft"
        print(f"✅ Create full product → product_id={data['product_id']}")

    def test_create_product_missing_title_returns_400(self, user_client):
        """POST without title should return 400."""
        payload = {
            "product_type": "rental",
            "category": "velo",
            "price": 10.0,
        }
        resp = user_client.post(f"{BASE_URL}/api/products", json=payload)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "error" in data, f"No error message: {data}"
        print(f"✅ Missing title → 400 with error: {data['error']}")

    def test_create_product_pending_review_status(self, user_client):
        """Create a product with status=pending_review."""
        payload = {
            "title": "TEST_Snowboard Rossignol",
            "product_type": "rental",
            "category": "glisse",
            "price": 30.0,
            "status": "pending_review",
        }
        resp = user_client.post(f"{BASE_URL}/api/products", json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("status") == "pending_review", f"Expected pending_review: {data}"
        print(f"✅ Create pending_review → {data}")

    def test_update_existing_product_via_product_id(self, user_client, created_product_id):
        """POST with existing product_id should update the draft."""
        payload = {
            "product_id": created_product_id,
            "title": "TEST_Vélo de route carbone UPDATED",
            "product_type": "rental",
            "category": "velo",
            "price": 30.0,
            "status": "draft",
        }
        resp = user_client.post(f"{BASE_URL}/api/products", json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("product_id") == created_product_id, f"product_id mismatch: {data}"
        print(f"✅ Update via product_id → {data}")

    def test_update_then_verify_via_mine(self, user_client, created_product_id):
        """After updating, verify the change via GET /mine."""
        # update
        updated_title = "TEST_Vélo vérifié après update"
        user_client.post(f"{BASE_URL}/api/products", json={
            "product_id": created_product_id,
            "title": updated_title,
            "product_type": "rental",
            "category": "velo",
            "price": 35.0,
            "status": "draft",
        })
        # verify
        resp = user_client.get(f"{BASE_URL}/api/products/mine")
        assert resp.status_code == 200
        data = resp.json()
        matching = [p for p in data["products"] if p["product_id"] == created_product_id]
        assert len(matching) == 1, f"Product not found after update: {created_product_id}"
        assert matching[0]["title"] == updated_title, f"Title not updated: {matching[0]['title']}"
        print(f"✅ Update persisted via /mine: title='{matching[0]['title']}'")


class TestDeleteProduct:
    """DELETE /api/products/{id} tests."""

    def test_delete_own_product(self, user_client):
        """Create then delete a product — soft delete (status=deleted)."""
        # create
        create_resp = user_client.post(f"{BASE_URL}/api/products", json={
            "title": "TEST_A supprimer",
            "product_type": "rental",
            "category": "autre",
            "price": 5.0,
            "status": "draft",
        })
        assert create_resp.status_code == 200
        pid = create_resp.json()["product_id"]

        # delete
        del_resp = user_client.delete(f"{BASE_URL}/api/products/{pid}")
        assert del_resp.status_code == 200, f"Expected 200, got {del_resp.status_code}: {del_resp.text}"
        data = del_resp.json()
        assert data.get("ok") is True, f"Expected ok=True: {data}"
        print(f"✅ DELETE /products/{pid} → ok=True")

        # verify not in /mine list
        mine_resp = user_client.get(f"{BASE_URL}/api/products/mine")
        products = mine_resp.json()["products"]
        pids = [p["product_id"] for p in products]
        assert pid not in pids, f"Deleted product {pid} still in /mine response"
        print(f"✅ Deleted product not in /mine list")

    def test_delete_nonexistent_product_returns_404(self, user_client):
        """DELETE on non-existent product should return 404."""
        resp = user_client.delete(f"{BASE_URL}/api/products/prod_notexistent999")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "error" in data, f"No error message: {data}"
        print(f"✅ DELETE non-existent → 404: {data['error']}")

    def test_delete_other_user_product_returns_404(self):
        """User cannot delete another user's product — should return 404."""
        # Login as admin and create a product
        admin_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
        })
        if admin_resp.status_code != 200:
            pytest.skip("Admin login failed")
        admin_token = admin_resp.json().get("token") or admin_resp.json().get("access_token")
        admin_session = requests.Session()
        admin_session.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {admin_token}",
        })
        # Create product as admin
        cr = admin_session.post(f"{BASE_URL}/api/products", json={
            "title": "TEST_Admin product to not delete",
            "product_type": "rental",
            "category": "autre",
            "price": 5.0,
            "status": "draft",
        })
        if cr.status_code != 200:
            pytest.skip("Admin product creation failed")
        admin_pid = cr.json()["product_id"]

        # Try to delete as user
        user_token = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": USER_EMAIL, "password": USER_PASSWORD
        }).json().get("token")
        user_session = requests.Session()
        user_session.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {user_token}",
        })
        del_resp = user_session.delete(f"{BASE_URL}/api/products/{admin_pid}")
        assert del_resp.status_code == 404, f"Expected 404, got {del_resp.status_code}: {del_resp.text}"
        print(f"✅ User cannot delete admin's product → 404")

        # cleanup
        admin_session.delete(f"{BASE_URL}/api/products/{admin_pid}")
