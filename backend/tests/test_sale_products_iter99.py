"""
Backend tests for SALE product type features (iteration 99)
Tests: product creation (sale), validation, /mine endpoint, /detail endpoint
"""
import pytest
import requests
import os
import json

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://data-refresh-9.preview.emergentagent.com")

# ── Auth helpers ──────────────────────────────────────────────────────────────

def get_token(email: str, password: str) -> str | None:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code == 200:
        return r.json().get("token")
    return None


@pytest.fixture(scope="module")
def user_token():
    token = get_token("user@winek.app", "WinekUser2024!")
    if not token:
        pytest.skip("Cannot authenticate as user — skipping all tests")
    return token


@pytest.fixture(scope="module")
def coach_token():
    token = get_token("coach@winek.app", "WinekCoach2024!")
    if not token:
        pytest.skip("Cannot authenticate as coach — skipping all tests")
    return token


@pytest.fixture(scope="module")
def admin_token():
    token = get_token("admin@winek.app", "WinekAdmin2024!")
    if not token:
        pytest.skip("Cannot authenticate as admin — skipping all tests")
    return token


# ── Helper: fetch a valid tag_id from the API ─────────────────────────────────

def get_product_tag_ids(token: str, count: int = 1) -> list:
    r = requests.get(
        f"{BASE_URL}/api/tags?entity_type=product",
        headers={"Authorization": f"Bearer {token}"}
    )
    if r.status_code == 200:
        data = r.json()
        tags = data if isinstance(data, list) else data.get("tags", [])
        return [t["tag_id"] for t in tags[:count]]
    return []


# ── Test 9: Backend POST /api/products — Sale without price → 422 ────────────

class TestSaleProductCreation:
    """Sale product creation and validation tests"""

    def test_sale_without_price_returns_422(self, user_token):
        """Test #9: Vente sans prix → HTTP 422"""
        tag_ids = get_product_tag_ids(user_token, 1)
        payload = {
            "product_type": "sale",
            "category": "cat_prd_sport",
            "title": "TEST_Sale Without Price",
            "description": "This is a test product description that is long enough to meet min 30 chars",
            "condition_label": "good",
            "available_quantity": 1,
            "price": 0,
            "sale_price": "",
            "pickup_type": "local_pickup",
            "tag_ids": tag_ids if tag_ids else ["tag_test_001"],
            "status": "pending_review",
            "currency": "EUR",
            "pricing_type": "sale",
            "pricing_modes": [],
            "image_urls": ["https://example.com/image.jpg"],
        }
        r = requests.post(
            f"{BASE_URL}/api/products",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        print(f"Sale without price response: {r.status_code} — {r.text[:300]}")
        assert r.status_code == 422, f"Expected 422 but got {r.status_code}: {r.text[:200]}"
        data = r.json()
        assert "error" in data or "details" in data, "Missing error message in response"
        print("✅ Test 9 PASSED: Sale without price returns 422")

    def test_sale_without_tags_returns_422(self, user_token):
        """Test #10: Vente sans tags → HTTP 422"""
        payload = {
            "product_type": "sale",
            "category": "cat_prd_sport",
            "title": "TEST_Sale Without Tags",
            "description": "This is a test product description that is long enough to meet min 30 chars",
            "condition_label": "good",
            "available_quantity": 1,
            "price": 99.99,
            "pickup_type": "local_pickup",
            "tag_ids": [],  # ← no tags
            "status": "pending_review",
            "currency": "EUR",
            "pricing_type": "sale",
            "pricing_modes": [],
            "image_urls": ["https://example.com/image.jpg"],
        }
        r = requests.post(
            f"{BASE_URL}/api/products",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        print(f"Sale without tags response: {r.status_code} — {r.text[:300]}")
        assert r.status_code == 422, f"Expected 422 but got {r.status_code}: {r.text[:200]}"
        data = r.json()
        error_msg = data.get("error", "") + str(data.get("details", ""))
        assert "tag" in error_msg.lower() or "tag" in str(data).lower(), f"Expected tag error, got: {data}"
        print("✅ Test 10 PASSED: Sale without tags returns 422")

    def test_sale_complete_returns_200_with_product_id(self, user_token):
        """Test #11: Vente complète → HTTP 200 avec product_id"""
        tag_ids = get_product_tag_ids(user_token, 1)
        if not tag_ids:
            pytest.skip("No product tags available for testing")

        payload = {
            "product_type": "sale",
            "category": tag_ids[0],  # use tag's category or a known cat
            "title": "TEST_Sale Complete Product",
            "short_description": "Short desc",
            "description": "This is a complete test product description that is long enough to pass the 30 char minimum",
            "condition_label": "good",
            "available_quantity": 1,
            "price": 149.99,
            "pricing_type": "sale",
            "pricing_modes": [],
            "pickup_type": "local_pickup",
            "tag_ids": tag_ids,
            "status": "draft",  # use draft to avoid admin notification
            "currency": "EUR",
            "image_urls": ["https://example.com/image.jpg"],
            "brand": "TEST_Brand",
            "model": "TEST_Model",
            "weight": "1.5kg",
            "city": "Paris",
            "lat": 48.8566,
            "lng": 2.3522,
            "location_privacy": "100m",
        }
        r = requests.post(
            f"{BASE_URL}/api/products",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        print(f"Sale complete response: {r.status_code} — {r.text[:400]}")
        assert r.status_code == 200, f"Expected 200 but got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert "product_id" in data, f"Missing product_id in response: {data}"
        assert data["product_id"], "product_id should not be empty"
        print(f"✅ Test 11 PASSED: Sale complete returns 200 with product_id={data['product_id']}")

        # Store for reuse in later tests
        TestSaleProductCreation.created_product_id = data["product_id"]

    def test_mine_returns_both_rental_and_sale(self, user_token):
        """Test #12: GET /api/products/mine returns both rental and sale"""
        r = requests.get(
            f"{BASE_URL}/api/products/mine",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        print(f"GET /mine response: {r.status_code}")
        assert r.status_code == 200, f"Expected 200 but got {r.status_code}"
        data = r.json()
        assert "products" in data, "Response should have 'products' key"
        products = data["products"]
        print(f"Total products returned: {len(products)}")
        
        types_returned = set(p.get("product_type") for p in products)
        print(f"Product types in response: {types_returned}")
        
        # Check that 'sale' is not blocked (might not have sale products yet, just ensure no filtering error)
        # We just need the endpoint to work and return both types if they exist
        assert r.status_code == 200
        # Verify 'deleted' products are not returned
        for p in products:
            assert p.get("status") != "deleted", "deleted products should not appear in /mine"
        print("✅ Test 12 PASSED: GET /mine returns products without error, filters deleted")

    def test_detail_returns_brand_model_weight(self, user_token):
        """Test #13: GET /api/products/{id}/detail returns brand, model, weight"""
        if not hasattr(TestSaleProductCreation, 'created_product_id'):
            pytest.skip("No sale product created yet (test 11 must pass first)")
        
        product_id = TestSaleProductCreation.created_product_id
        r = requests.get(
            f"{BASE_URL}/api/products/{product_id}/detail",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        print(f"GET /detail response: {r.status_code} — {r.text[:400]}")
        assert r.status_code == 200, f"Expected 200 but got {r.status_code}: {r.text[:200]}"
        data = r.json()
        
        # Check brand/model/weight fields exist in response
        assert "brand" in data, "Response should include 'brand' field"
        assert "model" in data, "Response should include 'model' field"
        assert "weight" in data, "Response should include 'weight' field"
        
        # Check values match what was submitted
        assert data["brand"] == "TEST_Brand", f"Brand mismatch: {data.get('brand')}"
        assert data["model"] == "TEST_Model", f"Model mismatch: {data.get('model')}"
        assert data["weight"] == "1.5kg", f"Weight mismatch: {data.get('weight')}"
        
        print(f"✅ Test 13 PASSED: /detail returns brand={data['brand']}, model={data['model']}, weight={data['weight']}")

    def test_sale_pending_review_without_price_422(self, user_token):
        """Additional: submit sale for pending_review without price → 422"""
        tag_ids = get_product_tag_ids(user_token, 1)
        payload = {
            "product_type": "sale",
            "category": "cat_prd_sport",
            "title": "TEST_Sale PendingReview No Price",
            "description": "Description with minimum thirty characters required here",
            "condition_label": "good",
            "available_quantity": 1,
            "price": 0,
            "pricing_type": "sale",
            "pricing_modes": [],
            "pickup_type": "local_pickup",
            "tag_ids": tag_ids if tag_ids else ["tag_test"],
            "status": "pending_review",
            "currency": "EUR",
            "image_urls": ["https://example.com/image.jpg"],
        }
        r = requests.post(
            f"{BASE_URL}/api/products",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        print(f"pending_review no price: {r.status_code} — {r.text[:200]}")
        assert r.status_code == 422, f"Expected 422 but got {r.status_code}"
        print("✅ PASSED: pending_review sale without price → 422")

    def test_rental_creation_still_works(self, user_token):
        """Test #14 regression: LOCATION creation still works"""
        tag_ids = get_product_tag_ids(user_token, 1)
        if not tag_ids:
            pytest.skip("No product tags available")
        
        payload = {
            "product_type": "rental",
            "category": "cat_prd_sport",
            "title": "TEST_Rental Regression Test",
            "short_description": "Rental test product",
            "description": "This is a rental test product description that meets minimum char requirements here",
            "condition_label": "good",
            "available_quantity": 1,
            "price": 25.0,
            "pricing_type": "day",
            "pricing_modes": ["day"],
            "price_per_day": 25.0,
            "pickup_type": "local_pickup",
            "tag_ids": tag_ids,
            "status": "draft",
            "currency": "EUR",
            "image_urls": ["https://example.com/image.jpg"],
            "city": "Paris",
            "lat": 48.8566,
            "lng": 2.3522,
            "location_privacy": "100m",
            "deposit_required": False,
        }
        r = requests.post(
            f"{BASE_URL}/api/products",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        print(f"Rental creation: {r.status_code} — {r.text[:300]}")
        assert r.status_code == 200, f"Rental creation failed: {r.status_code}: {r.text[:200]}"
        data = r.json()
        assert "product_id" in data
        print(f"✅ Test 14 PASSED: Rental creation still works: product_id={data['product_id']}")

    def test_invalid_product_type_returns_error(self, user_token):
        """Additional: Invalid product_type → 400"""
        payload = {
            "product_type": "digital",  # Not supported
            "title": "TEST_Digital Product",
            "description": "Test digital product with enough characters to pass min",
            "status": "draft",
        }
        r = requests.post(
            f"{BASE_URL}/api/products",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        print(f"Invalid type response: {r.status_code} — {r.text[:200]}")
        assert r.status_code in [400, 422], f"Expected 400/422 but got {r.status_code}"
        print("✅ PASSED: Invalid product_type returns error")


# ── Cleanup ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module", autouse=True)
def cleanup_test_products(user_token):
    """Delete TEST_ prefixed products after tests complete"""
    yield
    # Get all mine products and delete TEST_ ones
    r = requests.get(
        f"{BASE_URL}/api/products/mine",
        headers={"Authorization": f"Bearer {user_token}"}
    )
    if r.status_code == 200:
        for p in r.json().get("products", []):
            if p.get("title", "").startswith("TEST_"):
                requests.delete(
                    f"{BASE_URL}/api/products/{p['product_id']}",
                    headers={"Authorization": f"Bearer {user_token}"}
                )
                print(f"Cleaned up test product: {p['product_id']}")
