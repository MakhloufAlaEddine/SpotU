"""
Test iteration 93 — Validation backend produits pending_review
Checks: 422 validations manquantes, draft OK sans validation, GET /detail, mode édition
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

# ── Auth ─────────────────────────────────────────────────────────────────────
USER_EMAIL    = "user@winek.app"
USER_PASSWORD = "WinekUser2024!"

EDIT_PRODUCT_ID = "prod_e8c1e7a2e742"  # category=velo, max_duration_days=2, condition_label=good


@pytest.fixture(scope="module")
def user_token():
    """Login as regular user and return token."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": USER_EMAIL,
        "password": USER_PASSWORD,
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    data = resp.json()
    token = data.get("token") or data.get("access_token") or data.get("auth_token")
    assert token, f"No token in response: {data}"
    return token


@pytest.fixture(scope="module")
def auth_headers(user_token):
    return {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}


# ── Payload de base valide ────────────────────────────────────────────────────
VALID_PAYLOAD = {
    "title": "TEST_Vélo de route carbone 28 pouces",
    "category": "velo",
    "condition_label": "good",
    "price": 15.0,
    "pricing_type": "day",
    "image_urls": ["https://example.com/photo1.jpg"],
    "pickup_type": "local_pickup",
    "max_duration_days": 7,
    "deposit_required": False,
    "product_type": "rental",
    "status": "pending_review",
    "currency": "EUR",
    "available_quantity": 1,
}


# ────────────────────────────────────────────────────────────────────────────
# Test 1 — pending_review sans catégorie → 422
# ────────────────────────────────────────────────────────────────────────────
class TestPendingReviewMissingCategory:
    """POST /api/products pending_review sans catégorie → 422"""

    def test_missing_category_returns_422(self, auth_headers):
        payload = {**VALID_PAYLOAD, "category": "", "status": "pending_review"}
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ 422 sans catégorie: {data}")
        assert "catégorie" in (data.get("error") or "").lower() or \
               any("catégorie" in str(d).lower() for d in data.get("details", [])), \
            f"Message 'catégorie' manquant dans: {data}"

    def test_null_category_returns_422(self, auth_headers):
        payload = {**VALID_PAYLOAD, "category": None, "status": "pending_review"}
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        print(f"✓ 422 catégorie null: OK")


# ────────────────────────────────────────────────────────────────────────────
# Test 2 — pending_review sans photo → 422
# ────────────────────────────────────────────────────────────────────────────
class TestPendingReviewMissingPhoto:
    """POST /api/products pending_review sans image_urls → 422"""

    def test_empty_image_urls_returns_422(self, auth_headers):
        payload = {**VALID_PAYLOAD, "image_urls": [], "status": "pending_review"}
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ 422 sans photo: {data}")
        assert "photo" in (data.get("error") or "").lower() or \
               any("photo" in str(d).lower() for d in data.get("details", [])), \
            f"Message 'photo' manquant dans: {data}"

    def test_no_image_urls_field_returns_422(self, auth_headers):
        payload = {k: v for k, v in VALID_PAYLOAD.items() if k != "image_urls"}
        payload["status"] = "pending_review"
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        print(f"✓ 422 image_urls absent: OK")


# ────────────────────────────────────────────────────────────────────────────
# Test 3 — pending_review sans condition_label → 422
# ────────────────────────────────────────────────────────────────────────────
class TestPendingReviewMissingCondition:
    """POST /api/products pending_review sans condition_label → 422"""

    def test_empty_condition_returns_422(self, auth_headers):
        payload = {**VALID_PAYLOAD, "condition_label": "", "status": "pending_review"}
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ 422 sans condition_label: {data}")
        assert "état" in (data.get("error") or "").lower() or \
               any("état" in str(d).lower() for d in data.get("details", [])), \
            f"Message 'état' manquant dans: {data}"

    def test_null_condition_returns_422(self, auth_headers):
        payload = {**VALID_PAYLOAD, "condition_label": None, "status": "pending_review"}
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        print(f"✓ 422 condition_label null: OK")


# ────────────────────────────────────────────────────────────────────────────
# Test 4 — pending_review sans max_duration_days (pricing_type=day) → 422
# ────────────────────────────────────────────────────────────────────────────
class TestPendingReviewMissingMaxDuration:
    """POST /api/products pending_review pricing_type=day sans max_duration_days → 422"""

    def test_missing_max_duration_returns_422(self, auth_headers):
        payload = {**VALID_PAYLOAD, "max_duration_days": None, "pricing_type": "day", "status": "pending_review"}
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ 422 sans max_duration_days: {data}")
        assert "durée" in (data.get("error") or "").lower() or \
               any("durée" in str(d).lower() for d in data.get("details", [])), \
            f"Message 'durée' manquant dans: {data}"

    def test_zero_max_duration_returns_422(self, auth_headers):
        payload = {**VALID_PAYLOAD, "max_duration_days": 0, "pricing_type": "day", "status": "pending_review"}
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        print(f"✓ 422 max_duration_days=0: OK")

    def test_session_pricing_no_max_days_ok(self, auth_headers):
        """pricing_type=session → max_duration_days non requis → 200"""
        payload = {**VALID_PAYLOAD, "pricing_type": "session", "max_duration_days": None, "status": "pending_review"}
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        # Should succeed since session pricing doesn't require max_duration_days
        assert resp.status_code in [200, 201], f"Expected 200 pour session pricing, got {resp.status_code}: {resp.text}"
        data = resp.json()
        prod_id = data.get("product_id")
        print(f"✓ pricing_type=session sans max_duration_days: OK → {prod_id}")
        # Cleanup
        if prod_id:
            requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)


# ────────────────────────────────────────────────────────────────────────────
# Test 5 — deposit_required=true sans deposit_amount → 422
# ────────────────────────────────────────────────────────────────────────────
class TestPendingReviewMissingDepositAmount:
    """POST /api/products deposit_required=true sans deposit_amount → 422"""

    def test_deposit_required_no_amount_returns_422(self, auth_headers):
        payload = {
            **VALID_PAYLOAD,
            "deposit_required": True,
            "deposit_amount": None,
            "status": "pending_review",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ 422 deposit_required sans montant: {data}")
        assert "caution" in (data.get("error") or "").lower() or \
               any("caution" in str(d).lower() for d in data.get("details", [])), \
            f"Message 'caution' manquant dans: {data}"

    def test_deposit_required_zero_amount_returns_422(self, auth_headers):
        payload = {
            **VALID_PAYLOAD,
            "deposit_required": True,
            "deposit_amount": 0,
            "status": "pending_review",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        print(f"✓ 422 deposit_amount=0: OK")

    def test_deposit_required_with_amount_ok(self, auth_headers):
        """deposit_required=true avec montant valide → 200"""
        payload = {
            **VALID_PAYLOAD,
            "deposit_required": True,
            "deposit_amount": 50.0,
            "status": "pending_review",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code in [200, 201], f"Expected 200 avec caution valide, got {resp.status_code}: {resp.text}"
        data = resp.json()
        prod_id = data.get("product_id")
        print(f"✓ deposit_required avec montant: OK → {prod_id}")
        # Cleanup
        if prod_id:
            requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)


# ────────────────────────────────────────────────────────────────────────────
# Test 6 — pending_review avec tous les champs valides → 200 {status: pending_review}
# ────────────────────────────────────────────────────────────────────────────
class TestPendingReviewAllFieldsValid:
    """POST /api/products avec tous les champs valides → 200 {status: pending_review}"""

    def test_valid_pending_review_returns_200(self, auth_headers):
        payload = {**VALID_PAYLOAD, "status": "pending_review"}
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code in [200, 201], f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ Soumission valide: {data}")
        assert data.get("status") == "pending_review", f"Status attendu 'pending_review', got: {data}"
        assert "product_id" in data, f"product_id manquant: {data}"
        prod_id = data.get("product_id")
        # Verify product exists via GET detail
        get_resp = requests.get(f"{BASE_URL}/api/products/{prod_id}/detail", headers=auth_headers)
        assert get_resp.status_code == 200, f"GET detail failed: {get_resp.text}"
        detail = get_resp.json()
        assert detail.get("status") == "pending_review", f"Status dans detail: {detail.get('status')}"
        print(f"✓ GET /products/{prod_id}/detail: status=pending_review ✓")
        # Cleanup
        requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)


# ────────────────────────────────────────────────────────────────────────────
# Test 7 — draft sans photo ni catégorie → 200 OK (pas de validation)
# ────────────────────────────────────────────────────────────────────────────
class TestDraftNoValidation:
    """POST /api/products status=draft sans photo ni catégorie → 200 OK"""

    def test_draft_without_photo_and_category_ok(self, auth_headers):
        payload = {
            "title": "TEST_Brouillon sans photo ni catégorie",
            "category": "",
            "image_urls": [],
            "price": 0,
            "status": "draft",
            "product_type": "rental",
            "currency": "EUR",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code in [200, 201], f"Expected 200 pour draft, got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ Draft sans photo/catégorie: {data}")
        assert "product_id" in data, f"product_id manquant: {data}"
        prod_id = data.get("product_id")
        # Cleanup
        if prod_id:
            requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)

    def test_draft_no_condition_label_ok(self, auth_headers):
        payload = {
            "title": "TEST_Brouillon sans condition_label",
            "condition_label": "",
            "image_urls": [],
            "price": 0,
            "status": "draft",
            "product_type": "rental",
            "currency": "EUR",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code in [200, 201], f"Expected 200 pour draft, got {resp.status_code}: {resp.text}"
        print(f"✓ Draft sans condition_label: OK")
        prod_id = resp.json().get("product_id")
        if prod_id:
            requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)


# ────────────────────────────────────────────────────────────────────────────
# Test 8 — GET /api/products/{id}/detail retourne category, max_duration_days, condition_label
# ────────────────────────────────────────────────────────────────────────────
class TestGetProductDetail:
    """GET /api/products/{id}/detail retourne category, max_duration_days, condition_label correctement"""

    def test_get_detail_returns_all_edit_fields(self, auth_headers):
        resp = requests.get(
            f"{BASE_URL}/api/products/{EDIT_PRODUCT_ID}/detail",
            headers=auth_headers,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ GET /products/{EDIT_PRODUCT_ID}/detail: {data}")

        # Vérifie les champs essentiels
        assert "category" in data, f"'category' manquant dans: {data.keys()}"
        assert "max_duration_days" in data, f"'max_duration_days' manquant dans: {data.keys()}"
        assert "condition_label" in data, f"'condition_label' manquant dans: {data.keys()}"

        # Vérifie les valeurs attendues
        assert data["category"] == "velo", f"category attendu 'velo', got: {data['category']}"
        assert data["max_duration_days"] == 2, f"max_duration_days attendu 2, got: {data['max_duration_days']}"
        assert data["condition_label"] == "good", f"condition_label attendu 'good', got: {data['condition_label']}"

        print(f"✓ category={data['category']}, max_duration_days={data['max_duration_days']}, condition_label={data['condition_label']}")

    def test_get_detail_unauthorized_returns_404(self):
        """GET sans authentification → 401 ou 403"""
        resp = requests.get(f"{BASE_URL}/api/products/{EDIT_PRODUCT_ID}/detail")
        assert resp.status_code in [401, 403, 422], f"Expected 401/403, got {resp.status_code}: {resp.text}"
        print(f"✓ GET detail sans auth → {resp.status_code}: OK")

    def test_get_detail_nonexistent_product(self, auth_headers):
        """GET d'un produit inexistant → 404"""
        resp = requests.get(f"{BASE_URL}/api/products/prod_doesnotexist123/detail", headers=auth_headers)
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        print(f"✓ GET detail produit inexistant → 404: OK")

    def test_get_detail_includes_lat_lng(self, auth_headers):
        """GET /detail inclut lat, lng pour mode édition"""
        resp = requests.get(
            f"{BASE_URL}/api/products/{EDIT_PRODUCT_ID}/detail",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "lat" in data, f"'lat' manquant dans: {data.keys()}"
        assert "lng" in data, f"'lng' manquant dans: {data.keys()}"
        print(f"✓ lat={data.get('lat')}, lng={data.get('lng')}")

    def test_get_detail_includes_return_rules(self, auth_headers):
        """GET /detail inclut return_rules, pickup_type"""
        resp = requests.get(
            f"{BASE_URL}/api/products/{EDIT_PRODUCT_ID}/detail",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "return_rules" in data
        assert "pickup_type" in data
        print(f"✓ return_rules et pickup_type présents")


# ────────────────────────────────────────────────────────────────────────────
# Test 9 — Validation multiple erreurs - details contient toutes les erreurs
# ────────────────────────────────────────────────────────────────────────────
class TestMultipleValidationErrors:
    """POST pending_review avec plusieurs manquants → 422 avec details liste"""

    def test_multiple_missing_fields_returns_details_list(self, auth_headers):
        payload = {
            "title": "TEST_Produit avec multiples manquants",
            "status": "pending_review",
            "product_type": "rental",
            "price": 10.0,
            "pricing_type": "day",
            # Manquant: category, image_urls, condition_label, pickup_type, max_duration_days
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ 422 multiples manquants: error='{data.get('error')}', details={data.get('details')}")
        # L'API retourne le 1er erreur dans 'error' et la liste complète dans 'details'
        assert "error" in data, "Champ 'error' manquant dans la réponse 422"
        # details should be a list
        details = data.get("details")
        if details:
            assert isinstance(details, list), f"'details' devrait être une liste: {details}"
            print(f"✓ Nombre d'erreurs dans details: {len(details)}")
