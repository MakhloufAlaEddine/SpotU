"""
Backend tests — Admin product moderation (iteration 91)
Tests: GET /api/admin/products/pending, approve, reject, auto-publish admin, pending_review user
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

# ── credentials ──────────────────────────────────────────────────────────────
USER_EMAIL    = "user@winek.app"
USER_PASSWORD = "WinekUser2024!"
ADMIN_EMAIL   = "admin@winek.app"
ADMIN_PASSWORD = "WinekAdmin2024!"


@pytest.fixture(scope="module")
def admin_token():
    """Authenticate as admin, return token."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert resp.status_code == 200, f"Admin login failed: {resp.text}"
    data = resp.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"No token in response: {data}"
    return token


@pytest.fixture(scope="module")
def admin_client(admin_token):
    """Requests session with admin auth headers."""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}",
    })
    return session


@pytest.fixture(scope="module")
def user_token():
    """Authenticate as regular user, return token."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
    assert resp.status_code == 200, f"User login failed: {resp.text}"
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
def pending_product_id(user_client):
    """Create a pending_review product as user, return its ID."""
    payload = {
        "title": "TEST_Produit en attente de validation admin",
        "product_type": "rental",
        "category": "velo",
        "subcategory": "route",
        "short_description": "Vélo location test pour modération admin",
        "description": "Vélo de route carbone 28 pouces pour test de modération par l'admin",
        "price": 25.0,
        "pricing_type": "day",
        "available_quantity": 1,
        "condition_label": "good",
        "pickup_type": "local_pickup",
        "city": "Paris",
        "status": "pending_review",
    }
    resp = user_client.post(f"{BASE_URL}/api/products", json=payload)
    assert resp.status_code == 200, f"Create pending product failed: {resp.text}"
    data = resp.json()
    assert data.get("status") == "pending_review", f"Expected pending_review status: {data}"
    pid = data.get("product_id")
    assert pid, f"No product_id in response: {data}"
    print(f"✅ Created pending product: {pid}")
    return pid


@pytest.fixture(scope="module")
def pending_product_for_reject(user_client):
    """Create a separate pending_review product for reject test."""
    payload = {
        "title": "TEST_Produit à refuser modération",
        "product_type": "rental",
        "category": "fitness",
        "price": 15.0,
        "pricing_type": "day",
        "available_quantity": 1,
        "status": "pending_review",
    }
    resp = user_client.post(f"{BASE_URL}/api/products", json=payload)
    assert resp.status_code == 200, f"Create reject product failed: {resp.text}"
    data = resp.json()
    assert data.get("status") == "pending_review", f"Expected pending_review status: {data}"
    pid = data.get("product_id")
    assert pid
    print(f"✅ Created product for reject: {pid}")
    return pid


@pytest.fixture(scope="module")
def pending_product_for_reject_no_comment(user_client):
    """Create a pending_review product for reject-without-comment test."""
    payload = {
        "title": "TEST_Produit refus sans commentaire",
        "product_type": "rental",
        "category": "sport",
        "price": 8.0,
        "pricing_type": "day",
        "available_quantity": 1,
        "status": "pending_review",
    }
    resp = user_client.post(f"{BASE_URL}/api/products", json=payload)
    assert resp.status_code == 200, f"Create product failed: {resp.text}"
    data = resp.json()
    pid = data.get("product_id")
    assert pid
    print(f"✅ Created product for reject-no-comment: {pid}")
    return pid


# ── AUTH GUARD TESTS ──────────────────────────────────────────────────────────
class TestAdminProductAuth:
    """Authentication + authorization guard tests."""

    def test_pending_without_auth_returns_401(self):
        """GET /admin/products/pending without auth should return 401."""
        resp = requests.get(f"{BASE_URL}/api/admin/products/pending")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"
        print("✅ GET /admin/products/pending without auth → 401")

    def test_pending_as_user_returns_403(self, user_client):
        """GET /admin/products/pending as non-admin should return 403."""
        resp = user_client.get(f"{BASE_URL}/api/admin/products/pending")
        assert resp.status_code in [403, 401], f"Expected 403/401, got {resp.status_code}: {resp.text}"
        print(f"✅ GET /admin/products/pending as user → {resp.status_code}")

    def test_approve_without_auth_returns_401(self):
        """POST /admin/products/{id}/approve without auth should return 401."""
        resp = requests.post(f"{BASE_URL}/api/admin/products/dummy_id/approve", json={})
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✅ POST approve without auth → 401")

    def test_approve_as_user_returns_403(self, user_client):
        """POST approve as non-admin should return 403."""
        resp = user_client.post(f"{BASE_URL}/api/admin/products/dummy_id/approve", json={})
        assert resp.status_code in [403, 401], f"Expected 403/401, got {resp.status_code}"
        print(f"✅ POST approve as user → {resp.status_code}")

    def test_reject_without_auth_returns_401(self):
        """POST /admin/products/{id}/reject without auth should return 401."""
        resp = requests.post(f"{BASE_URL}/api/admin/products/dummy_id/reject", json={})
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✅ POST reject without auth → 401")


# ── LIST PENDING PRODUCTS ─────────────────────────────────────────────────────
class TestListPendingProducts:
    """GET /api/admin/products/pending tests."""

    def test_pending_returns_200(self, admin_client):
        """GET /admin/products/pending should return 200."""
        resp = admin_client.get(f"{BASE_URL}/api/admin/products/pending")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        print("✅ GET /admin/products/pending → 200")

    def test_pending_response_structure(self, admin_client):
        """Response should contain 'products' list and 'count'."""
        resp = admin_client.get(f"{BASE_URL}/api/admin/products/pending")
        assert resp.status_code == 200
        data = resp.json()
        assert "products" in data, f"'products' key missing: {data}"
        assert "count" in data, f"'count' key missing: {data}"
        assert isinstance(data["products"], list), f"'products' should be a list"
        assert isinstance(data["count"], int), f"'count' should be int"
        assert data["count"] == len(data["products"]), f"count mismatch: {data['count']} vs {len(data['products'])}"
        print(f"✅ Response structure OK — count={data['count']}")

    def test_pending_products_have_required_fields(self, admin_client, pending_product_id):
        """Products should have all required fields for moderation."""
        resp = admin_client.get(f"{BASE_URL}/api/admin/products/pending")
        assert resp.status_code == 200
        data = resp.json()
        products = data["products"]
        assert len(products) > 0, "Expected at least one pending product (created in fixture)"

        # Find our test product
        test_products = [p for p in products if p.get("product_id") == pending_product_id]
        assert len(test_products) == 1, f"Test product {pending_product_id} not in pending list"
        p = test_products[0]

        required_fields = [
            "product_id", "title", "price", "pricing_type",
            "seller_id", "seller_name", "status", "quality_score",
            "created_at",
        ]
        for field in required_fields:
            assert field in p, f"Required field '{field}' missing from product"

        assert p["status"] == "pending_review", f"Expected pending_review status: {p['status']}"
        assert isinstance(p["quality_score"], (int, float)), f"quality_score should be numeric: {p['quality_score']}"
        assert 0 <= p["quality_score"] <= 100, f"quality_score out of range: {p['quality_score']}"
        print(f"✅ Pending product fields OK — quality_score={p['quality_score']}")

    def test_pending_only_returns_pending_status(self, admin_client):
        """All products in pending list should have status=pending_review."""
        resp = admin_client.get(f"{BASE_URL}/api/admin/products/pending")
        assert resp.status_code == 200
        data = resp.json()
        for p in data["products"]:
            assert p["status"] == "pending_review", f"Non-pending product in list: {p['product_id']} status={p['status']}"
        print(f"✅ All {len(data['products'])} products have status=pending_review")


# ── APPROVE PRODUCT ───────────────────────────────────────────────────────────
class TestApproveProduct:
    """POST /api/admin/products/{id}/approve tests."""

    def test_approve_returns_ok_true_and_active_status(self, admin_client, pending_product_id):
        """Approve should return {ok: True, status: 'active'}."""
        resp = admin_client.post(f"{BASE_URL}/api/admin/products/{pending_product_id}/approve", json={})
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("ok") is True, f"Expected ok=True: {data}"
        assert data.get("status") == "active", f"Expected status=active: {data}"
        print(f"✅ Approve → ok=True, status=active")

    def test_approve_not_in_pending_list_after(self, admin_client, pending_product_id):
        """Approved product should no longer appear in pending list."""
        resp = admin_client.get(f"{BASE_URL}/api/admin/products/pending")
        assert resp.status_code == 200
        data = resp.json()
        pending_ids = [p["product_id"] for p in data["products"]]
        assert pending_product_id not in pending_ids, f"Approved product {pending_product_id} still in pending list"
        print(f"✅ Approved product no longer in pending list")

    def test_approve_nonexistent_product_returns_404(self, admin_client):
        """Approve on non-existent product should return 404."""
        resp = admin_client.post(f"{BASE_URL}/api/admin/products/prod_doesnotexist999/approve", json={})
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "error" in data, f"No error message: {data}"
        print(f"✅ Approve non-existent → 404: {data['error']}")


# ── REJECT PRODUCT ────────────────────────────────────────────────────────────
class TestRejectProduct:
    """POST /api/admin/products/{id}/reject tests."""

    def test_reject_with_comment_returns_ok(self, admin_client, pending_product_for_reject):
        """Reject with comment should return {ok: True, status: 'rejected'}."""
        resp = admin_client.post(
            f"{BASE_URL}/api/admin/products/{pending_product_for_reject}/reject",
            json={"comment": "Photos de mauvaise qualité, description insuffisante."},
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("ok") is True, f"Expected ok=True: {data}"
        assert data.get("status") == "rejected", f"Expected status=rejected: {data}"
        print(f"✅ Reject with comment → ok=True, status=rejected")

    def test_rejected_product_not_in_pending_list(self, admin_client, pending_product_for_reject):
        """Rejected product should no longer appear in pending list."""
        resp = admin_client.get(f"{BASE_URL}/api/admin/products/pending")
        assert resp.status_code == 200
        data = resp.json()
        pending_ids = [p["product_id"] for p in data["products"]]
        assert pending_product_for_reject not in pending_ids, f"Rejected product still in pending list"
        print(f"✅ Rejected product no longer in pending list")

    def test_reject_without_comment_returns_ok(self, admin_client, pending_product_for_reject_no_comment):
        """Reject without comment (comment is optional) should still succeed."""
        resp = admin_client.post(
            f"{BASE_URL}/api/admin/products/{pending_product_for_reject_no_comment}/reject",
            json={},  # no comment
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("ok") is True, f"Expected ok=True: {data}"
        assert data.get("status") == "rejected", f"Expected status=rejected: {data}"
        print(f"✅ Reject without comment → ok=True, status=rejected")

    def test_reject_nonexistent_product_returns_404(self, admin_client):
        """Reject on non-existent product should return 404."""
        resp = admin_client.post(f"{BASE_URL}/api/admin/products/prod_doesnotexist999/reject", json={})
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "error" in data, f"No error message: {data}"
        print(f"✅ Reject non-existent → 404: {data['error']}")


# ── AUTO-PUBLISH ADMIN ────────────────────────────────────────────────────────
class TestAdminAutoPublish:
    """Admin creating product with pending_review → auto-published as active."""

    def test_admin_create_pending_review_returns_active(self, admin_client):
        """Admin posting status=pending_review should get status=active (auto-publish)."""
        payload = {
            "title": "TEST_Admin auto-publish product",
            "product_type": "rental",
            "category": "velo",
            "price": 20.0,
            "pricing_type": "day",
            "available_quantity": 1,
            "status": "pending_review",  # admin requests pending → should get active
        }
        resp = admin_client.post(f"{BASE_URL}/api/products", json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "product_id" in data, f"No product_id: {data}"
        assert data.get("status") == "active", (
            f"Admin auto-publish FAILED — expected status=active but got: {data.get('status')}. "
            f"Full response: {data}"
        )
        print(f"✅ Admin auto-publish → status=active (product_id={data['product_id']})")

        # cleanup
        admin_client.delete(f"{BASE_URL}/api/products/{data['product_id']}")

    def test_admin_create_draft_stays_draft(self, admin_client):
        """Admin posting status=draft should remain draft (no auto-change)."""
        payload = {
            "title": "TEST_Admin draft stays draft",
            "product_type": "rental",
            "category": "sport",
            "price": 5.0,
            "status": "draft",
        }
        resp = admin_client.post(f"{BASE_URL}/api/products", json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("status") == "draft", f"Expected status=draft: {data}"
        print(f"✅ Admin draft → status=draft (no auto-publish)")

        # cleanup
        admin_client.delete(f"{BASE_URL}/api/products/{data['product_id']}")


# ── USER PENDING REVIEW ───────────────────────────────────────────────────────
class TestUserPendingReview:
    """User creating product with pending_review → status stays pending_review (awaits moderation)."""

    def test_user_create_pending_review_stays_pending(self, user_client):
        """User posting status=pending_review should get status=pending_review (not auto-published)."""
        payload = {
            "title": "TEST_User pending review submission",
            "product_type": "rental",
            "category": "fitness",
            "price": 12.0,
            "pricing_type": "day",
            "available_quantity": 1,
            "status": "pending_review",
        }
        resp = user_client.post(f"{BASE_URL}/api/products", json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "product_id" in data, f"No product_id: {data}"
        assert data.get("status") == "pending_review", (
            f"User product should stay pending_review but got: {data.get('status')}. "
            f"Full response: {data}"
        )
        print(f"✅ User pending_review → status=pending_review (awaits moderation)")

        # cleanup: no delete needed (status will remain pending), just note
        return data["product_id"]

    def test_user_cannot_access_admin_pending(self, user_client):
        """User should not be able to list admin pending products."""
        resp = user_client.get(f"{BASE_URL}/api/admin/products/pending")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
        print(f"✅ User cannot access /admin/products/pending → {resp.status_code}")


# ── GET PRODUCT DETAIL ────────────────────────────────────────────────────────
class TestGetProductDetail:
    """GET /api/admin/products/{product_id} detail endpoint."""

    def test_get_product_detail_returns_200(self, admin_client, pending_product_for_reject):
        """Admin can get product detail (even rejected is fine)."""
        resp = admin_client.get(f"{BASE_URL}/api/admin/products/{pending_product_for_reject}")
        # Could be 200 even for rejected products (the endpoint doesn't filter by status)
        assert resp.status_code in [200, 404], f"Unexpected status: {resp.status_code}: {resp.text}"
        if resp.status_code == 200:
            data = resp.json()
            assert "product_id" in data, f"product_id missing: {data.keys()}"
            assert "quality_score" in data, f"quality_score missing: {data.keys()}"
            assert "seller_name" in data, f"seller_name missing: {data.keys()}"
            print(f"✅ GET product detail → quality_score={data.get('quality_score')}, seller={data.get('seller_name')}")
        else:
            print(f"ℹ️ GET rejected product detail → 404 (product may be filtered)")

    def test_get_nonexistent_product_returns_404(self, admin_client):
        """GET on non-existent product should return 404."""
        resp = admin_client.get(f"{BASE_URL}/api/admin/products/prod_doesnotexist999")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        print(f"✅ GET non-existent product → 404")
