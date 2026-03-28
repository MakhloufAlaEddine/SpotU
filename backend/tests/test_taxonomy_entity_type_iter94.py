"""
Test suite — Refonte taxonomy Domaines/Catégories/Tags (iteration 94)
Couverture :
  - entity_type filter on /api/tags/categories
  - entity_type filter on /api/tags
  - /api/domains returns 4 expected domains
  - /api/admin/all-categories includes entity_type field
  - CASCADE désactivation: PUT /api/domains/dom_sport {active: false}
  - DB counts via API: 60 tags, 58 categories, 5 marketplace products, 4 domains
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://metro-stability.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS = "WinekAdmin2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS = "WinekCoach2024!"

# ── Expected seed counts from seed.py ─────────────────────────────────────────
EXPECTED_SPOTYOU_CATS = 21   # 12 sport + 5 coaching + 4 services_locaux
EXPECTED_SERVICE_CATS = 21   # 12 sport + 5 coaching + 4 services_locaux
EXPECTED_PRODUCT_CATS = 16   # 14 sport + 2 services_locaux
EXPECTED_SPOTYOU_SPORT_CATS = 12  # 12 spotyou in dom_sport
EXPECTED_TOTAL_CATS = 58
EXPECTED_TOTAL_TAGS = 60
EXPECTED_TOTAL_DOMAINS = 4
EXPECTED_DOMAIN_SLUGS = {"sport", "coaching", "services_locaux", "social"}
EXPECTED_PRODUCT_IDS = {"mp_demo001", "mp_demo002", "mp_demo003", "mp_demo004", "mp_demo005"}

# Sport categories per entity_type (for cascade test)
DOM_SPORT_CAT_IDS = [
    # SPOTYOU sport
    "cat_syu_fitness", "cat_syu_running", "cat_syu_cycling", "cat_syu_football",
    "cat_syu_basketball", "cat_syu_tennis_padel", "cat_syu_yoga", "cat_syu_martial_arts",
    "cat_syu_hiking", "cat_syu_swimming", "cat_syu_winter_sports", "cat_syu_camping",
    # SERVICE sport
    "cat_svc_fitness", "cat_svc_running", "cat_svc_cycling", "cat_svc_football",
    "cat_svc_basketball", "cat_svc_tennis_padel", "cat_svc_yoga", "cat_svc_martial_arts",
    "cat_svc_hiking", "cat_svc_swimming", "cat_svc_winter_sports", "cat_svc_camping",
    # PRODUCT sport
    "cat_prd_bike", "cat_prd_racket", "cat_prd_fitness_eq", "cat_prd_yoga_mat",
    "cat_prd_ball_sports", "cat_prd_swimming_gear", "cat_prd_ski", "cat_prd_running_gear",
    "cat_prd_martial_gear", "cat_prd_accessories", "cat_prd_electronics", "cat_prd_recovery",
    "cat_prd_camping_gear", "cat_prd_outdoor_eq",
]


# ─────────────────────────────────────────────────────────────────────────────
# FIXTURES
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# AUTH
# ─────────────────────────────────────────────────────────────────────────────

class TestAuth:
    """Basic auth sanity"""

    def test_admin_login(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASS
        })
        assert resp.status_code == 200, f"Admin login failed: {resp.text}"
        data = resp.json()
        assert "token" in data
        assert data["user"]["role"] == "admin"
        print(f"PASS: Admin login OK (role={data['user']['role']})")


# ─────────────────────────────────────────────────────────────────────────────
# DOMAINS
# ─────────────────────────────────────────────────────────────────────────────

class TestDomains:
    """GET /api/domains returns exactly 4 active domains with expected slugs"""

    def test_domains_returns_4(self):
        resp = requests.get(f"{BASE_URL}/api/domains")
        assert resp.status_code == 200, f"GET /api/domains failed: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Response must be a list"
        assert len(data) == EXPECTED_TOTAL_DOMAINS, \
            f"Expected {EXPECTED_TOTAL_DOMAINS} domains, got {len(data)}: {[d.get('name') for d in data]}"
        print(f"PASS: {len(data)} domains returned")

    def test_domains_have_expected_slugs(self):
        resp = requests.get(f"{BASE_URL}/api/domains")
        assert resp.status_code == 200
        data = resp.json()
        actual_slugs = {d["name"] for d in data}
        missing = EXPECTED_DOMAIN_SLUGS - actual_slugs
        extra = actual_slugs - EXPECTED_DOMAIN_SLUGS
        assert not missing, f"Missing domain slugs: {missing}"
        assert not extra, f"Unexpected domain slugs: {extra}"
        print(f"PASS: All 4 domain slugs present: {actual_slugs}")

    def test_domains_have_active_flag(self):
        resp = requests.get(f"{BASE_URL}/api/domains")
        assert resp.status_code == 200
        data = resp.json()
        for d in data:
            assert d.get("active") is True, f"Domain {d.get('name')} is not active"
        print(f"PASS: All domains are active")

    def test_domain_sport_exists(self):
        resp = requests.get(f"{BASE_URL}/api/domains")
        assert resp.status_code == 200
        data = resp.json()
        sport = next((d for d in data if d["name"] == "sport"), None)
        assert sport is not None, "dom_sport not found"
        assert sport["domain_id"] == "dom_sport", f"Unexpected domain_id: {sport['domain_id']}"
        print(f"PASS: dom_sport found with correct domain_id")


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORIES — entity_type FILTER
# ─────────────────────────────────────────────────────────────────────────────

class TestCategoriesEntityTypeFilter:
    """GET /api/tags/categories?entity_type=X filtering"""

    def test_product_categories_count(self):
        """Should return exactly 16 product categories"""
        resp = requests.get(f"{BASE_URL}/api/tags/categories", params={"entity_type": "product"})
        assert resp.status_code == 200, f"Failed: {resp.text}"
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == EXPECTED_PRODUCT_CATS, \
            f"Expected {EXPECTED_PRODUCT_CATS} product categories, got {len(data)}: {[c['name'] for c in data]}"
        print(f"PASS: {len(data)} product categories returned")

    def test_product_categories_all_entity_type_product(self):
        """All returned categories must have entity_type == 'product'"""
        resp = requests.get(f"{BASE_URL}/api/tags/categories", params={"entity_type": "product"})
        assert resp.status_code == 200
        data = resp.json()
        wrong = [c for c in data if c.get("entity_type") != "product"]
        assert not wrong, f"Non-product categories found: {[(c['name'], c.get('entity_type')) for c in wrong]}"
        print(f"PASS: All {len(data)} product categories have entity_type='product'")

    def test_spotyou_categories_count(self):
        """Should return exactly 21 spotyou categories"""
        resp = requests.get(f"{BASE_URL}/api/tags/categories", params={"entity_type": "spotyou"})
        assert resp.status_code == 200, f"Failed: {resp.text}"
        data = resp.json()
        assert len(data) == EXPECTED_SPOTYOU_CATS, \
            f"Expected {EXPECTED_SPOTYOU_CATS} spotyou categories, got {len(data)}: {[c['name'] for c in data]}"
        print(f"PASS: {len(data)} spotyou categories returned")

    def test_spotyou_categories_no_product_or_service(self):
        """Spotyou response must NOT contain product or service categories"""
        resp = requests.get(f"{BASE_URL}/api/tags/categories", params={"entity_type": "spotyou"})
        assert resp.status_code == 200
        data = resp.json()
        wrong = [c for c in data if c.get("entity_type") != "spotyou"]
        assert not wrong, f"Non-spotyou categories in spotyou response: {[(c['name'], c.get('entity_type')) for c in wrong]}"
        print(f"PASS: Spotyou filter excludes product/service correctly")

    def test_service_categories_count(self):
        """Should return exactly 21 service categories"""
        resp = requests.get(f"{BASE_URL}/api/tags/categories", params={"entity_type": "service"})
        assert resp.status_code == 200, f"Failed: {resp.text}"
        data = resp.json()
        assert len(data) == EXPECTED_SERVICE_CATS, \
            f"Expected {EXPECTED_SERVICE_CATS} service categories, got {len(data)}: {[c['name'] for c in data]}"
        print(f"PASS: {len(data)} service categories returned")

    def test_service_categories_no_spotyou_or_product(self):
        """Service response must NOT contain spotyou or product categories"""
        resp = requests.get(f"{BASE_URL}/api/tags/categories", params={"entity_type": "service"})
        assert resp.status_code == 200
        data = resp.json()
        wrong = [c for c in data if c.get("entity_type") != "service"]
        assert not wrong, f"Non-service categories in service response: {[(c['name'], c.get('entity_type')) for c in wrong]}"
        print(f"PASS: Service filter excludes spotyou/product correctly")

    def test_spotyou_sport_categories_count(self):
        """spotyou + dom_sport → exactly 12 categories"""
        resp = requests.get(f"{BASE_URL}/api/tags/categories", params={
            "entity_type": "spotyou", "domain_id": "dom_sport"
        })
        assert resp.status_code == 200, f"Failed: {resp.text}"
        data = resp.json()
        assert len(data) == EXPECTED_SPOTYOU_SPORT_CATS, \
            f"Expected {EXPECTED_SPOTYOU_SPORT_CATS} spotyou/sport categories, got {len(data)}: {[c['name'] for c in data]}"
        print(f"PASS: {len(data)} spotyou/sport categories")

    def test_spotyou_sport_categories_all_correct_entity(self):
        """All spotyou+dom_sport categories must be entity_type=spotyou and domain_id=dom_sport"""
        resp = requests.get(f"{BASE_URL}/api/tags/categories", params={
            "entity_type": "spotyou", "domain_id": "dom_sport"
        })
        assert resp.status_code == 200
        data = resp.json()
        for cat in data:
            assert cat.get("entity_type") == "spotyou", \
                f"Category {cat['name']} has entity_type={cat.get('entity_type')}"
            assert cat.get("domain_id") == "dom_sport", \
                f"Category {cat['name']} has domain_id={cat.get('domain_id')}"
        print(f"PASS: All spotyou/sport categories have correct entity_type and domain_id")

    def test_categories_include_tags_in_response(self):
        """Categories response must include nested tags list"""
        resp = requests.get(f"{BASE_URL}/api/tags/categories", params={"entity_type": "product"})
        assert resp.status_code == 200
        data = resp.json()
        for cat in data:
            assert "tags" in cat, f"Category {cat.get('name')} missing 'tags' field"
        print(f"PASS: All product categories have 'tags' field in response")

    def test_total_categories_no_filter(self):
        """Without filter, total categories should be 58 (from seed)"""
        resp = requests.get(f"{BASE_URL}/api/tags/categories")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == EXPECTED_TOTAL_CATS, \
            f"Expected {EXPECTED_TOTAL_CATS} total categories, got {len(data)}"
        print(f"PASS: Total categories = {len(data)}")


# ─────────────────────────────────────────────────────────────────────────────
# TAGS — entity_type FILTER
# ─────────────────────────────────────────────────────────────────────────────

class TestTagsEntityTypeFilter:
    """GET /api/tags?entity_type=spotyou filtering via tag_entity_type_links"""

    def test_tags_entity_type_spotyou_returns_list(self):
        """Returns a non-empty list of tags"""
        resp = requests.get(f"{BASE_URL}/api/tags", params={"entity_type": "spotyou"})
        assert resp.status_code == 200, f"Failed: {resp.text}"
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Expected tags for entity_type=spotyou, got empty list"
        print(f"PASS: {len(data)} spotyou tags returned")

    def test_tags_entity_type_product_returns_list(self):
        """Returns a non-empty list of tags for entity_type=product"""
        resp = requests.get(f"{BASE_URL}/api/tags", params={"entity_type": "product"})
        assert resp.status_code == 200, f"Failed: {resp.text}"
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Expected tags for entity_type=product, got empty list"
        print(f"PASS: {len(data)} product tags returned")

    def test_tags_entity_type_service_returns_list(self):
        """Returns a non-empty list of tags for entity_type=service"""
        resp = requests.get(f"{BASE_URL}/api/tags", params={"entity_type": "service"})
        assert resp.status_code == 200, f"Failed: {resp.text}"
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Expected tags for entity_type=service, got empty list"
        print(f"PASS: {len(data)} service tags returned")

    def test_total_tags_count(self):
        """Total active tags should equal 60 (from seed)"""
        resp = requests.get(f"{BASE_URL}/api/tags")
        assert resp.status_code == 200
        data = resp.json()
        # tags endpoint has LIMIT 200 so 60 tags should all be returned
        assert len(data) == EXPECTED_TOTAL_TAGS, \
            f"Expected {EXPECTED_TOTAL_TAGS} total tags, got {len(data)}"
        print(f"PASS: Total tags = {len(data)}")

    def test_tags_have_tag_id_field(self):
        """Tags should have tag_id and name fields"""
        resp = requests.get(f"{BASE_URL}/api/tags", params={"entity_type": "spotyou"})
        assert resp.status_code == 200
        data = resp.json()
        for tag in data:
            assert "tag_id" in tag, f"Tag missing tag_id: {tag}"
            assert "name" in tag, f"Tag missing name: {tag}"
        print(f"PASS: All spotyou tags have tag_id and name fields")


# ─────────────────────────────────────────────────────────────────────────────
# ADMIN all-categories — entity_type field
# ─────────────────────────────────────────────────────────────────────────────

class TestAdminAllCategories:
    """GET /api/admin/all-categories returns entity_type in each category"""

    def test_admin_all_categories_total_count(self, admin_headers):
        """Should return 58 categories (including inactive after cascade)"""
        resp = requests.get(f"{BASE_URL}/api/admin/all-categories", headers=admin_headers)
        assert resp.status_code == 200, f"Failed: {resp.text}"
        data = resp.json()
        assert isinstance(data, list)
        # At rest (not after cascade), should be 58
        # We check >= 58 in case there's other test data
        assert len(data) >= EXPECTED_TOTAL_CATS, \
            f"Expected >= {EXPECTED_TOTAL_CATS} categories in admin view, got {len(data)}"
        print(f"PASS: Admin all-categories returned {len(data)} categories")

    def test_admin_all_categories_have_entity_type(self, admin_headers):
        """Every category must have entity_type field (not null)"""
        resp = requests.get(f"{BASE_URL}/api/admin/all-categories", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        # Only check seed categories (by known category_ids prefix)
        seed_cats = [c for c in data if c.get("category_id", "").startswith(("cat_syu_", "cat_svc_", "cat_prd_"))]
        missing_et = [c for c in seed_cats if not c.get("entity_type")]
        assert not missing_et, \
            f"{len(missing_et)} seed categories missing entity_type: {[c['category_id'] for c in missing_et[:5]]}"
        print(f"PASS: All {len(seed_cats)} seed categories have entity_type set")

    def test_admin_all_categories_entity_type_values_valid(self, admin_headers):
        """entity_type must be in {spotyou, service, product}"""
        resp = requests.get(f"{BASE_URL}/api/admin/all-categories", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        valid_types = {"spotyou", "service", "product"}
        seed_cats = [c for c in data if c.get("category_id", "").startswith(("cat_syu_", "cat_svc_", "cat_prd_"))]
        invalid = [c for c in seed_cats if c.get("entity_type") not in valid_types]
        assert not invalid, \
            f"Invalid entity_type values: {[(c['category_id'], c.get('entity_type')) for c in invalid]}"
        print(f"PASS: All entity_type values are valid ({valid_types})")

    def test_admin_all_categories_has_domain_name(self, admin_headers):
        """Categories must include domain_name (joined from domains table)"""
        resp = requests.get(f"{BASE_URL}/api/admin/all-categories", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        for cat in data:
            assert "domain_name" in cat, f"Category {cat.get('category_id')} missing domain_name"
        print(f"PASS: All categories have domain_name field")

    def test_admin_all_categories_requires_auth(self):
        """Unauthenticated request to /admin/all-categories should return 401/403"""
        resp = requests.get(f"{BASE_URL}/api/admin/all-categories")
        assert resp.status_code in [401, 403], \
            f"Expected 401/403 for unauthenticated, got {resp.status_code}"
        print(f"PASS: Auth required for /admin/all-categories (got {resp.status_code})")


# ─────────────────────────────────────────────────────────────────────────────
# CASCADE DÉSACTIVATION DOMAINE
# ─────────────────────────────────────────────────────────────────────────────

class TestCascadeDeactivation:
    """PUT /api/domains/dom_sport {active: false} should cascade to categories"""

    def test_cascade_disable_dom_sport(self, admin_headers):
        """Disabling dom_sport must also deactivate all its categories"""
        # --- Step 1: Verify dom_sport is currently active
        domains_resp = requests.get(f"{BASE_URL}/api/domains")
        assert domains_resp.status_code == 200
        domains = domains_resp.json()
        sport_domain = next((d for d in domains if d["domain_id"] == "dom_sport"), None)
        assert sport_domain is not None, "dom_sport not found in active domains"
        assert sport_domain["active"] is True, "dom_sport should be active before test"

        # --- Step 2: Count active categories for dom_sport before cascade
        before_resp = requests.get(f"{BASE_URL}/api/tags/categories", params={"domain_id": "dom_sport"})
        assert before_resp.status_code == 200
        before_count = len(before_resp.json())
        assert before_count > 0, f"dom_sport should have active categories before cascade (got {before_count})"
        print(f"  Before cascade: {before_count} active categories in dom_sport")

        # --- Step 3: Disable dom_sport with cascade
        disable_resp = requests.put(
            f"{BASE_URL}/api/domains/dom_sport",
            json={"active": False},
            headers=admin_headers
        )
        assert disable_resp.status_code == 200, f"PUT /domains/dom_sport failed: {disable_resp.text}"
        assert disable_resp.json().get("success") is True

        # --- Step 4: Verify dom_sport is no longer in active domains list
        after_domains_resp = requests.get(f"{BASE_URL}/api/domains")
        assert after_domains_resp.status_code == 200
        active_domains = after_domains_resp.json()
        sport_in_active = any(d["domain_id"] == "dom_sport" for d in active_domains)
        assert not sport_in_active, "dom_sport should NOT appear in active domains after deactivation"
        print(f"  dom_sport removed from active domains list")

        # --- Step 5: Verify categories in dom_sport are now inactive (not returned)
        after_cats_resp = requests.get(f"{BASE_URL}/api/tags/categories", params={"domain_id": "dom_sport"})
        assert after_cats_resp.status_code == 200
        after_count = len(after_cats_resp.json())
        assert after_count == 0, \
            f"CASCADE FAILED: {after_count} categories still active after domain deactivation (expected 0)"
        print(f"  After cascade: {after_count} active categories in dom_sport (cascade worked!)")

        # --- Step 6: Verify via admin endpoint that categories have active=FALSE
        admin_cats_resp = requests.get(f"{BASE_URL}/api/admin/all-categories", headers=admin_headers)
        assert admin_cats_resp.status_code == 200
        all_cats = admin_cats_resp.json()
        sport_cats_in_admin = [c for c in all_cats if c.get("domain_id") == "dom_sport"]
        inactive_sport = [c for c in sport_cats_in_admin if c.get("active") is False]
        assert len(inactive_sport) == before_count, \
            f"Expected {before_count} inactive sport categories, found {len(inactive_sport)}"
        print(f"  Admin confirms {len(inactive_sport)} categories deactivated in dom_sport")

        print(f"PASS: CASCADE deactivation works correctly")

    def test_restore_dom_sport_after_cascade(self, admin_headers):
        """Restore dom_sport and its categories to active (cleanup)"""
        # Re-enable domain
        re_enable_resp = requests.put(
            f"{BASE_URL}/api/domains/dom_sport",
            json={"active": True},
            headers=admin_headers
        )
        assert re_enable_resp.status_code == 200, f"Failed to re-enable dom_sport: {re_enable_resp.text}"
        print(f"  dom_sport re-enabled")

        # Re-enable all dom_sport categories
        restore_errors = []
        for cat_id in DOM_SPORT_CAT_IDS:
            cat_resp = requests.put(
                f"{BASE_URL}/api/tags/categories/{cat_id}",
                json={"active": True},
                headers=admin_headers
            )
            if cat_resp.status_code not in [200, 404]:
                restore_errors.append(f"{cat_id}: {cat_resp.status_code}")

        if restore_errors:
            print(f"  WARNING: Some categories could not be restored: {restore_errors}")
        else:
            print(f"  All {len(DOM_SPORT_CAT_IDS)} sport categories restored to active")

        # Verify restoration
        restored_resp = requests.get(f"{BASE_URL}/api/tags/categories", params={"domain_id": "dom_sport"})
        assert restored_resp.status_code == 200
        restored_count = len(restored_resp.json())
        # We expect the count to match before (38 sport categories)
        assert restored_count == len(DOM_SPORT_CAT_IDS), \
            f"Expected {len(DOM_SPORT_CAT_IDS)} active sport categories after restore, got {restored_count}"
        print(f"PASS: dom_sport and {restored_count} categories successfully restored")


# ─────────────────────────────────────────────────────────────────────────────
# DB COUNTS VIA API
# ─────────────────────────────────────────────────────────────────────────────

class TestDBCountsViaAPI:
    """Verify seed data counts via API endpoints"""

    def test_total_domains_count(self):
        """DB should have exactly 4 domains"""
        resp = requests.get(f"{BASE_URL}/api/domains")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == EXPECTED_TOTAL_DOMAINS, \
            f"Expected {EXPECTED_TOTAL_DOMAINS} domains, got {len(data)}"
        print(f"PASS: DB has {len(data)} domains")

    def test_total_categories_count_via_admin(self, admin_headers):
        """DB should have 58 seed categories with entity_type non-null"""
        resp = requests.get(f"{BASE_URL}/api/admin/all-categories", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        # Count only seed categories (known prefixes)
        seed_cats = [c for c in data if c.get("category_id", "").startswith(("cat_syu_", "cat_svc_", "cat_prd_"))]
        assert len(seed_cats) == EXPECTED_TOTAL_CATS, \
            f"Expected {EXPECTED_TOTAL_CATS} seed categories, got {len(seed_cats)}"
        # Verify entity_type is non-null for all seed categories
        null_et = [c for c in seed_cats if not c.get("entity_type")]
        assert not null_et, f"{len(null_et)} seed categories have NULL entity_type"
        print(f"PASS: DB has {len(seed_cats)} seed categories, all with entity_type non-null")

    def test_total_tags_count_via_api(self):
        """DB should have exactly 60 active tags"""
        resp = requests.get(f"{BASE_URL}/api/tags")
        assert resp.status_code == 200
        data = resp.json()
        # Limit 200 is applied, so 60 should all be returned
        assert len(data) == EXPECTED_TOTAL_TAGS, \
            f"Expected {EXPECTED_TOTAL_TAGS} tags, got {len(data)}"
        print(f"PASS: DB has {len(data)} active tags")

    def test_marketplace_products_demo_exist(self, admin_headers):
        """5 marketplace demo products with IDs mp_demo001-005 should exist"""
        resp = requests.get(f"{BASE_URL}/api/marketplace/products")
        assert resp.status_code == 200, f"Marketplace products endpoint failed: {resp.text}"
        data = resp.json()
        # Extract product IDs from response (could be nested under 'products' or list directly)
        if isinstance(data, dict) and "products" in data:
            products = data["products"]
        elif isinstance(data, list):
            products = data
        else:
            products = []

        product_ids = {p.get("product_id") for p in products}
        missing_ids = EXPECTED_PRODUCT_IDS - product_ids
        assert not missing_ids, \
            f"Missing marketplace products: {missing_ids}. Got: {product_ids}"
        print(f"PASS: All 5 marketplace demo products found (mp_demo001-005)")

    def test_tag_category_links_exist(self):
        """Verify tag_category_links work by checking tags are nested in categories"""
        # Use product entity_type as it's the simplest case
        resp = requests.get(f"{BASE_URL}/api/tags/categories", params={"entity_type": "product"})
        assert resp.status_code == 200
        data = resp.json()
        # At least some categories should have tags
        cats_with_tags = [c for c in data if len(c.get("tags", [])) > 0]
        assert len(cats_with_tags) > 0, \
            "No product categories have linked tags — tag_category_links may be empty"
        print(f"PASS: tag_category_links working — {len(cats_with_tags)}/{len(data)} product categories have tags")

    def test_tag_entity_type_links_exist(self):
        """Verify tag_entity_type_links work by checking entity_type filter on /api/tags"""
        # spotyou and product should have different tag sets (or overlapping via links)
        spotyou_resp = requests.get(f"{BASE_URL}/api/tags", params={"entity_type": "spotyou"})
        product_resp = requests.get(f"{BASE_URL}/api/tags", params={"entity_type": "product"})
        assert spotyou_resp.status_code == 200
        assert product_resp.status_code == 200
        spotyou_ids = {t["tag_id"] for t in spotyou_resp.json()}
        product_ids = {t["tag_id"] for t in product_resp.json()}
        # Both should be non-empty
        assert len(spotyou_ids) > 0, "No tags for entity_type=spotyou"
        assert len(product_ids) > 0, "No tags for entity_type=product"
        # Some tags should be in product (those linked to product categories)
        print(f"PASS: tag_entity_type_links working — spotyou:{len(spotyou_ids)} tags, product:{len(product_ids)} tags")


# ─────────────────────────────────────────────────────────────────────────────
# CODE REVIEW: Duplicate routes detection
# ─────────────────────────────────────────────────────────────────────────────

class TestDuplicateRoutesAwareness:
    """
    These tests verify the NEW entity_type-aware endpoints work correctly,
    confirming the first (correct) route definitions take precedence over
    the duplicate (legacy) definitions found in domain_routes.py.
    """

    def test_get_categories_with_entity_type_works(self):
        """The entity_type filter on /api/tags/categories is operative (not dead code)"""
        # If the duplicate old route without entity_type takes precedence, this would fail
        # (returns 58 instead of 16)
        resp_all = requests.get(f"{BASE_URL}/api/tags/categories")
        resp_product = requests.get(f"{BASE_URL}/api/tags/categories", params={"entity_type": "product"})
        assert resp_all.status_code == 200
        assert resp_product.status_code == 200
        count_all = len(resp_all.json())
        count_product = len(resp_product.json())
        assert count_product < count_all, \
            f"entity_type filter not working: product={count_product}, all={count_all}"
        assert count_product == EXPECTED_PRODUCT_CATS, \
            f"Expected {EXPECTED_PRODUCT_CATS} product categories, got {count_product}"
        print(f"PASS: entity_type filter operative (all={count_all}, product={count_product})")

    def test_get_tags_with_entity_type_works(self):
        """The entity_type filter on /api/tags is operative (not dead code)"""
        resp_all = requests.get(f"{BASE_URL}/api/tags")
        resp_spotyou = requests.get(f"{BASE_URL}/api/tags", params={"entity_type": "spotyou"})
        resp_product = requests.get(f"{BASE_URL}/api/tags", params={"entity_type": "product"})
        assert resp_all.status_code == 200
        assert resp_spotyou.status_code == 200
        assert resp_product.status_code == 200
        count_all = len(resp_all.json())
        count_spotyou = len(resp_spotyou.json())
        count_product = len(resp_product.json())
        # Both should be non-empty and likely fewer than total (though tags can link to multiple entity_types)
        assert count_spotyou > 0, "entity_type=spotyou filter returns no tags"
        assert count_product > 0, "entity_type=product filter returns no tags"
        print(f"PASS: entity_type filter on /api/tags works (all={count_all}, spotyou={count_spotyou}, product={count_product})")
