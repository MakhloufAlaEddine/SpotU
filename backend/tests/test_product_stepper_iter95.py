"""
Test iteration 95 — Stepper produit refactoré :
  1. TAGS OBLIGATOIRES - tag_ids=[] → 422 pour pending_review
  2. SESSION SANS SPOTYOU → 422 pour pending_review
  3. PRICING MODES VALIDATION step4 (day sans max_duration_days → 422)
  4. DRAFT COMPLET avec pricing_modes ['hour','day'], tag_ids → 200
  5. EDIT MODE PRE-FILL - GET /detail retourne tag_ids, pricing_modes, price_per_*
  6. UPDATE produit existant (correction bug SQL doublon UPDATE)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

USER_EMAIL    = "user@winek.app"
USER_PASSWORD = "WinekUser2024!"
COACH_EMAIL   = "coach@winek.app"
COACH_PASS    = "WinekCoach2024!"
ADMIN_EMAIL   = "admin@winek.app"
ADMIN_PASS    = "WinekAdmin2024!"

# Produit existant appartenant à user@winek.app (vérifié via GET /products/mine)
EDIT_PRODUCT_ID = "mp_demo003"


@pytest.fixture(scope="module")
def user_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": USER_EMAIL,
        "password": USER_PASSWORD,
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    data = resp.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"No token: {data}"
    return token


@pytest.fixture(scope="module")
def auth_headers(user_token):
    return {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASS,
    })
    assert resp.status_code == 200, f"Admin login failed: {resp.text}"
    return resp.json().get("token")


# ──────────────────────────────────────────────────────────────────────────────
# Payload de base VALIDE (avec tag_ids)
# ──────────────────────────────────────────────────────────────────────────────
VALID_PAYLOAD_WITH_TAGS = {
    "title": "TEST_Vélo de route carbone 28 pouces iter95",
    "category": "velo",
    "condition_label": "good",
    "price": 15.0,
    "pricing_modes": ["day"],
    "pricing_type": "day",
    "price_per_day": 15.0,
    "image_urls": ["https://example.com/photo_test.jpg"],
    "pickup_type": "local_pickup",
    "max_duration_days": 7,
    "deposit_required": False,
    "product_type": "rental",
    "status": "pending_review",
    "currency": "EUR",
    "available_quantity": 1,
    "tag_ids": ["tag_aventure"],  # Tag produit existant
}


# ══════════════════════════════════════════════════════════════════════════════
# Test 1 — TAGS OBLIGATOIRES (feature #1 & #2)
# POST /api/products tag_ids=[] status=pending_review → 422
# ══════════════════════════════════════════════════════════════════════════════
class TestTagsRequiredPendingReview:
    """POST /api/products with tag_ids=[] and status=pending_review must return 422"""

    def test_empty_tag_ids_returns_422(self, auth_headers):
        """tag_ids=[] → 422 avec message 'tag'"""
        payload = {**VALID_PAYLOAD_WITH_TAGS, "tag_ids": [], "status": "pending_review"}
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ 422 tag_ids=[]: error='{data.get('error')}'")
        error_msg = (data.get("error") or "").lower()
        details = [str(d).lower() for d in data.get("details", [])]
        assert "tag" in error_msg or any("tag" in d for d in details), \
            f"Message 'tag' manquant dans: {data}"

    def test_null_tag_ids_returns_422(self, auth_headers):
        """tag_ids=null → 422"""
        payload = {**VALID_PAYLOAD_WITH_TAGS, "tag_ids": None, "status": "pending_review"}
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        print(f"✓ 422 tag_ids=null: OK")

    def test_missing_tag_ids_field_returns_422(self, auth_headers):
        """tag_ids absent → 422"""
        payload = {k: v for k, v in VALID_PAYLOAD_WITH_TAGS.items() if k != "tag_ids"}
        payload["status"] = "pending_review"
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        print(f"✓ 422 tag_ids manquant: OK")

    def test_valid_tag_ids_pending_review_ok(self, auth_headers):
        """tag_ids=['tag_aventure'] → pending_review créé"""
        payload = {**VALID_PAYLOAD_WITH_TAGS, "status": "pending_review"}
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code in [200, 201], f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        prod_id = data.get("product_id")
        assert prod_id, f"product_id manquant: {data}"
        assert data.get("status") == "pending_review", f"Status attendu pending_review: {data}"
        print(f"✓ pending_review avec tag_ids: OK → {prod_id}")
        # Cleanup
        if prod_id:
            requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)


# ══════════════════════════════════════════════════════════════════════════════
# Test 2 — TAGS VALIDES pour DRAFT (pas de validation) (feature #7)
# Draft sans tag_ids → 200 OK
# ══════════════════════════════════════════════════════════════════════════════
class TestTagsNotRequiredForDraft:
    """Draft ne requiert PAS tag_ids"""

    def test_draft_without_tag_ids_ok(self, auth_headers):
        """Draft sans tag_ids → 200"""
        payload = {
            "title": "TEST_Brouillon sans tags iter95",
            "category": "",
            "tag_ids": [],
            "image_urls": [],
            "price": 0,
            "status": "draft",
            "product_type": "rental",
            "currency": "EUR",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code in [200, 201], f"Expected 200 pour draft, got {resp.status_code}: {resp.text}"
        prod_id = resp.json().get("product_id")
        assert prod_id, "product_id absent"
        print(f"✓ Draft sans tags: OK → {prod_id}")
        if prod_id:
            requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)

    def test_draft_with_pricing_modes_and_prices_ok(self, auth_headers):
        """Draft COMPLET avec pricing_modes=['hour','day'], price_per_hour, price_per_day, tag_ids → 200 (feature #7)"""
        payload = {
            "title": "TEST_Draft complet pricing iter95",
            "category": "cat_prd_fitness_eq",
            "tag_ids": ["tag_aventure"],
            "pricing_modes": ["hour", "day"],
            "pricing_type": "day",
            "price_per_hour": 12.0,
            "price_per_day": 40.0,
            "price": 12.0,
            "image_urls": [],
            "pickup_type": "local_pickup",
            "deposit_required": False,
            "product_type": "rental",
            "status": "draft",
            "currency": "EUR",
            "available_quantity": 1,
            "condition_label": "good",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code in [200, 201], f"Expected 200 pour draft, got {resp.status_code}: {resp.text}"
        data = resp.json()
        prod_id = data.get("product_id")
        assert prod_id, f"product_id absent: {data}"
        print(f"✓ Draft complet pricing_modes=['hour','day']: OK → {prod_id}")

        # GET detail → vérifie pricing_modes et price_per_hour/day
        get_resp = requests.get(f"{BASE_URL}/api/products/{prod_id}/detail", headers=auth_headers)
        assert get_resp.status_code == 200, f"GET detail failed: {get_resp.text}"
        detail = get_resp.json()
        assert detail.get("pricing_modes") == ["hour", "day"], \
            f"pricing_modes attendu ['hour','day'], got: {detail.get('pricing_modes')}"
        assert detail.get("price_per_hour") == 12.0, \
            f"price_per_hour attendu 12.0, got: {detail.get('price_per_hour')}"
        assert detail.get("price_per_day") == 40.0, \
            f"price_per_day attendu 40.0, got: {detail.get('price_per_day')}"
        assert detail.get("tag_ids") == ["tag_aventure"], \
            f"tag_ids attendu ['tag_aventure'], got: {detail.get('tag_ids')}"
        print(f"✓ GET detail: pricing_modes={detail['pricing_modes']}, price_per_hour={detail['price_per_hour']}, price_per_day={detail['price_per_day']}")
        # Cleanup
        requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)


# ══════════════════════════════════════════════════════════════════════════════
# Test 3 — VALIDATION SESSION SANS SPOTYOU (feature #4 & #5)
# POST /api/products pricing_modes=['session'] related_spotyou_ids=[] → 422
# ══════════════════════════════════════════════════════════════════════════════
class TestSessionRequiresSpotYou:
    """pricing_modes=['session'] sans related_spotyou_ids → 422 pour pending_review"""

    def test_session_without_spotyou_returns_422(self, auth_headers):
        """session sans SpotYou → 422"""
        payload = {
            **VALID_PAYLOAD_WITH_TAGS,
            "pricing_modes": ["session"],
            "pricing_type": "session",
            "price": 20.0,
            "price_per_day": None,
            "related_spotyou_ids": [],
            "max_duration_days": None,
            "status": "pending_review",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ 422 session sans SpotYou: error='{data.get('error')}'")
        error_msg = (data.get("error") or "").lower()
        details = [str(d).lower() for d in data.get("details", [])]
        assert "spotyou" in error_msg or "séance" in error_msg or \
               any("spotyou" in d or "séance" in d for d in details), \
            f"Message SpotYou manquant dans: {data}"

    def test_session_without_spotyou_null_returns_422(self, auth_headers):
        """related_spotyou_ids=null avec session → 422"""
        payload = {
            **VALID_PAYLOAD_WITH_TAGS,
            "pricing_modes": ["session"],
            "pricing_type": "session",
            "price": 20.0,
            "price_per_day": None,
            "related_spotyou_ids": None,
            "max_duration_days": None,
            "status": "pending_review",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        print(f"✓ 422 session related_spotyou_ids=null: OK")

    def test_session_draft_without_spotyou_ok(self, auth_headers):
        """session en DRAFT sans SpotYou → 200 OK (pas de validation stricte)"""
        payload = {
            "title": "TEST_Session brouillon iter95",
            "pricing_modes": ["session"],
            "pricing_type": "session",
            "price": 20.0,
            "related_spotyou_ids": [],
            "status": "draft",
            "product_type": "rental",
            "currency": "EUR",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code in [200, 201], f"Expected 200 draft session, got {resp.status_code}: {resp.text}"
        prod_id = resp.json().get("product_id")
        print(f"✓ Draft session sans SpotYou: OK → {prod_id}")
        if prod_id:
            requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)


# ══════════════════════════════════════════════════════════════════════════════
# Test 4 — VALIDATION STEP 4 PRICING MODES (feature #3)
# pricing_modes includes 'day' et max_duration_days vide → 422
# ══════════════════════════════════════════════════════════════════════════════
class TestPricingModesMaxDurationValidation:
    """pricing_modes inclut 'day'/'week'/'month' sans max_duration_days → 422"""

    def test_day_mode_without_max_duration_returns_422(self, auth_headers):
        """pricing_modes=['day'] sans max_duration_days → 422"""
        payload = {
            **VALID_PAYLOAD_WITH_TAGS,
            "pricing_modes": ["day"],
            "max_duration_days": None,
            "status": "pending_review",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ 422 pricing_modes=['day'] sans max_duration_days: {data.get('error')}")
        assert "durée" in (data.get("error") or "").lower() or \
               any("durée" in str(d).lower() for d in data.get("details", [])), \
            f"Message 'durée' manquant: {data}"

    def test_week_mode_without_max_duration_returns_422(self, auth_headers):
        """pricing_modes=['week'] sans max_duration_days → 422"""
        payload = {
            **VALID_PAYLOAD_WITH_TAGS,
            "pricing_modes": ["week"],
            "price_per_day": None,
            "price_per_week": 80.0,
            "price": 80.0,
            "max_duration_days": None,
            "status": "pending_review",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        print(f"✓ 422 pricing_modes=['week'] sans max_duration_days: OK")

    def test_hour_mode_no_max_duration_ok(self, auth_headers):
        """pricing_modes=['hour'] n'exige pas max_duration_days → 200"""
        payload = {
            **VALID_PAYLOAD_WITH_TAGS,
            "pricing_modes": ["hour"],
            "pricing_type": "hour",
            "price": 12.0,
            "price_per_day": None,
            "price_per_hour": 12.0,
            "max_duration_days": None,
            "status": "pending_review",
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=auth_headers)
        assert resp.status_code in [200, 201], f"Expected 200 pour hour sans max_days, got {resp.status_code}: {resp.text}"
        prod_id = resp.json().get("product_id")
        print(f"✓ pricing_modes=['hour'] sans max_duration_days: OK → {prod_id}")
        if prod_id:
            requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)


# ══════════════════════════════════════════════════════════════════════════════
# Test 5 — EDIT MODE PRE-FILL (feature #6)
# GET /api/products/{id}/detail → tag_ids, pricing_modes, price_per_* retournés
# ══════════════════════════════════════════════════════════════════════════════
class TestEditModePreFill:
    """GET /api/products/{id}/detail retourne tag_ids, pricing_modes, price_per_*"""

    def test_detail_returns_tag_ids(self, auth_headers):
        """GET detail d'un produit existant avec tag_ids retourne tag_ids non-null"""
        resp = requests.get(
            f"{BASE_URL}/api/products/{EDIT_PRODUCT_ID}/detail",
            headers=auth_headers
        )
        assert resp.status_code == 200, f"GET detail failed: {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "tag_ids" in data, f"'tag_ids' absent dans: {list(data.keys())}"
        assert isinstance(data["tag_ids"], list), f"tag_ids doit être une liste: {data['tag_ids']}"
        print(f"✓ tag_ids présent: {data['tag_ids']}")

    def test_detail_returns_pricing_modes(self, auth_headers):
        """GET detail retourne pricing_modes"""
        resp = requests.get(f"{BASE_URL}/api/products/{EDIT_PRODUCT_ID}/detail", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "pricing_modes" in data, f"'pricing_modes' absent: {list(data.keys())}"
        assert isinstance(data["pricing_modes"], list), f"pricing_modes doit être une liste: {data['pricing_modes']}"
        print(f"✓ pricing_modes: {data['pricing_modes']}")

    def test_detail_returns_price_per_fields(self, auth_headers):
        """GET detail retourne les champs price_per_hour/day/week/month"""
        resp = requests.get(f"{BASE_URL}/api/products/{EDIT_PRODUCT_ID}/detail", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        for field in ["price_per_hour", "price_per_day", "price_per_week", "price_per_month"]:
            assert field in data, f"'{field}' absent dans: {list(data.keys())}"
        print(f"✓ price_per_hour={data['price_per_hour']}, price_per_day={data['price_per_day']}, "
              f"price_per_week={data['price_per_week']}, price_per_month={data['price_per_month']}")

    def test_detail_returns_related_spotyou_ids(self, auth_headers):
        """GET detail retourne related_spotyou_ids"""
        resp = requests.get(f"{BASE_URL}/api/products/{EDIT_PRODUCT_ID}/detail", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "related_spotyou_ids" in data, f"'related_spotyou_ids' absent: {list(data.keys())}"
        print(f"✓ related_spotyou_ids: {data['related_spotyou_ids']}")


# ══════════════════════════════════════════════════════════════════════════════
# Test 6 — UPDATE PRODUIT EXISTANT (bug fix doublon SQL)
# POST /api/products avec product_id existant → UPDATE fonctionne
# ══════════════════════════════════════════════════════════════════════════════
class TestProductUpdate:
    """POST /api/products avec product_id existant doit UPDATE sans erreur SQL"""

    def test_update_existing_product_draft_ok(self, auth_headers):
        """Créer un produit, puis le mettre à jour → UPDATE ne doit pas 500"""
        # Step 1: Create a draft
        create_payload = {
            "title": "TEST_Product update iter95 - initial",
            "status": "draft",
            "product_type": "rental",
            "currency": "EUR",
            "price": 10.0,
            "pricing_modes": ["day"],
            "price_per_day": 10.0,
            "tag_ids": [],
            "image_urls": [],
        }
        create_resp = requests.post(f"{BASE_URL}/api/products", json=create_payload, headers=auth_headers)
        assert create_resp.status_code in [200, 201], f"Create failed: {create_resp.status_code}: {create_resp.text}"
        prod_id = create_resp.json().get("product_id")
        assert prod_id, "product_id absent après création"
        print(f"✓ Produit créé: {prod_id}")

        # Step 2: UPDATE via POST with same product_id
        update_payload = {
            "product_id": prod_id,
            "title": "TEST_Product update iter95 - modifié",
            "status": "draft",
            "product_type": "rental",
            "currency": "EUR",
            "price": 20.0,
            "pricing_modes": ["day", "week"],
            "price_per_day": 20.0,
            "price_per_week": 90.0,
            "tag_ids": ["tag_aventure"],
            "image_urls": [],
            "max_duration_days": 14,
            "pickup_type": "local_pickup",
            "condition_label": "very_good",
        }
        update_resp = requests.post(f"{BASE_URL}/api/products", json=update_payload, headers=auth_headers)
        assert update_resp.status_code in [200, 201], \
            f"UPDATE failed (expected 200, not 500): {update_resp.status_code}: {update_resp.text}"
        update_data = update_resp.json()
        assert update_data.get("product_id") == prod_id, \
            f"product_id devrait rester {prod_id}: {update_data}"
        print(f"✓ UPDATE OK: {update_data}")

        # Step 3: GET detail to verify update persisted
        get_resp = requests.get(f"{BASE_URL}/api/products/{prod_id}/detail", headers=auth_headers)
        assert get_resp.status_code == 200, f"GET detail after update failed: {get_resp.text}"
        detail = get_resp.json()
        assert detail.get("title") == "TEST_Product update iter95 - modifié", \
            f"Title non mis à jour: {detail.get('title')}"
        assert detail.get("pricing_modes") == ["day", "week"], \
            f"pricing_modes non mis à jour: {detail.get('pricing_modes')}"
        assert detail.get("tag_ids") == ["tag_aventure"], \
            f"tag_ids non mis à jour: {detail.get('tag_ids')}"
        print(f"✓ GET detail après UPDATE: title OK, pricing_modes OK, tag_ids OK")

        # Cleanup
        requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)

    def test_update_pricing_modes_with_prices_persisted(self, auth_headers):
        """UPDATE produit → pricing_modes + price_per_* persistés correctement"""
        # Create
        create_resp = requests.post(f"{BASE_URL}/api/products", json={
            "title": "TEST_Pricing modes persist iter95",
            "status": "draft",
            "product_type": "rental",
            "currency": "EUR",
            "price": 10.0,
        }, headers=auth_headers)
        assert create_resp.status_code in [200, 201]
        prod_id = create_resp.json().get("product_id")

        # Update with pricing details
        update_resp = requests.post(f"{BASE_URL}/api/products", json={
            "product_id": prod_id,
            "title": "TEST_Pricing modes persist iter95",
            "status": "draft",
            "product_type": "rental",
            "currency": "EUR",
            "pricing_modes": ["hour", "day"],
            "price_per_hour": 12.0,
            "price_per_day": 40.0,
            "price": 12.0,
        }, headers=auth_headers)
        assert update_resp.status_code in [200, 201], \
            f"UPDATE pricing failed: {update_resp.status_code}: {update_resp.text}"

        # Verify
        get_resp = requests.get(f"{BASE_URL}/api/products/{prod_id}/detail", headers=auth_headers)
        assert get_resp.status_code == 200
        detail = get_resp.json()
        assert detail.get("pricing_modes") == ["hour", "day"], \
            f"pricing_modes: {detail.get('pricing_modes')}"
        assert detail.get("price_per_hour") == 12.0, \
            f"price_per_hour: {detail.get('price_per_hour')}"
        assert detail.get("price_per_day") == 40.0, \
            f"price_per_day: {detail.get('price_per_day')}"
        print(f"✓ pricing_modes={detail['pricing_modes']}, per_hour={detail['price_per_hour']}, per_day={detail['price_per_day']}")

        # Cleanup
        requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)


# ══════════════════════════════════════════════════════════════════════════════
# Test 7 — FINAL STEP7 VALIDATION (feature #10)
# validateStep(7) doit bloquer si tag_ids vide via backend (soumission finale)
# ══════════════════════════════════════════════════════════════════════════════
class TestStep7FinalValidation:
    """La soumission finale (pending_review) bloque si tag_ids vide"""

    def test_final_submit_no_tags_blocked(self, auth_headers):
        """POST pending_review complet mais tag_ids=[] → 422"""
        full_payload = {
            "title": "TEST_Final submit no tags iter95",
            "category": "velo",
            "condition_label": "good",
            "price": 15.0,
            "pricing_modes": ["day"],
            "pricing_type": "day",
            "price_per_day": 15.0,
            "image_urls": ["https://example.com/photo.jpg"],
            "pickup_type": "local_pickup",
            "max_duration_days": 7,
            "deposit_required": False,
            "product_type": "rental",
            "status": "pending_review",
            "currency": "EUR",
            "available_quantity": 1,
            "tag_ids": [],  # INTENTIONELLEMENT VIDE
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=full_payload, headers=auth_headers)
        assert resp.status_code == 422, f"Expected 422 (step7 tag block), got {resp.status_code}: {resp.text}"
        data = resp.json()
        print(f"✓ Step7 bloque tag_ids=[]: {data.get('error')}")

    def test_final_submit_with_tags_succeeds(self, auth_headers):
        """POST pending_review complet avec tag_ids=['tag_aventure'] → 200"""
        full_payload = {
            "title": "TEST_Final submit with tags iter95",
            "category": "velo",
            "condition_label": "good",
            "price": 15.0,
            "pricing_modes": ["day"],
            "pricing_type": "day",
            "price_per_day": 15.0,
            "image_urls": ["https://example.com/photo.jpg"],
            "pickup_type": "local_pickup",
            "max_duration_days": 7,
            "deposit_required": False,
            "product_type": "rental",
            "status": "pending_review",
            "currency": "EUR",
            "available_quantity": 1,
            "tag_ids": ["tag_aventure"],
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=full_payload, headers=auth_headers)
        assert resp.status_code in [200, 201], f"Expected 200 final submit, got {resp.status_code}: {resp.text}"
        prod_id = resp.json().get("product_id")
        print(f"✓ Final submit avec tags: OK → {prod_id}")
        if prod_id:
            requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=auth_headers)


# ══════════════════════════════════════════════════════════════════════════════
# Test 8 — ADMIN DIRECT PUBLISH
# Admin soumit en pending_review → status=active directement
# ══════════════════════════════════════════════════════════════════════════════
class TestAdminDirectPublish:
    """Admin: pending_review → status=active directement"""

    def test_admin_submit_goes_active(self, admin_token):
        admin_headers = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
        payload = {
            "title": "TEST_Admin publish direct iter95",
            "category": "velo",
            "condition_label": "good",
            "price": 25.0,
            "pricing_modes": ["day"],
            "pricing_type": "day",
            "price_per_day": 25.0,
            "image_urls": ["https://example.com/photo.jpg"],
            "pickup_type": "local_pickup",
            "max_duration_days": 5,
            "deposit_required": False,
            "product_type": "rental",
            "status": "pending_review",
            "currency": "EUR",
            "available_quantity": 1,
            "tag_ids": ["tag_aventure"],
        }
        resp = requests.post(f"{BASE_URL}/api/products", json=payload, headers=admin_headers)
        assert resp.status_code in [200, 201], f"Admin create failed: {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("status") == "active", \
            f"Admin should publish directly to 'active', got: {data.get('status')}"
        prod_id = data.get("product_id")
        print(f"✓ Admin direct publish: status=active, product_id={prod_id}")
        # Cleanup (admin can delete their own product)
        if prod_id:
            requests.delete(f"{BASE_URL}/api/products/{prod_id}", headers=admin_headers)
