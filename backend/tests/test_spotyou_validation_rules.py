"""
Tests des règles de validation métier SpotYou
==============================================

Teste les nouvelles règles imposées côté backend (et frontend) :
  1. Au moins un tag requis (création et mise à jour)
  2. Le nombre minimum de participants ne peut pas dépasser le maximum

Ces règles s'appliquent à :
  - POST /api/tag-points  (création)
  - PUT  /api/tag-points/{point_id}  (mise à jour)
"""
import pytest
import requests
import os

# ─── Helpers URL ──────────────────────────────────────────────────────────────

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
    return 'http://localhost:8001'


BASE_URL = _load_base_url()
USER_EMAIL = "user@winek.app"
USER_PASS = "WinekUser2024!"
PARIS_LAT = 48.8566
PARIS_LNG = 2.3522


def _get_valid_tag_ids():
    """Récupère un ou plusieurs tags valides depuis l'API (dom_sport)."""
    try:
        resp = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport", timeout=5)
        if resp.status_code == 200:
            tags = []
            for cat in resp.json():
                for tag in cat.get("tags", []):
                    tags.append(tag["tag_id"])
                    if len(tags) >= 2:
                        return tags
    except Exception:
        pass
    return ["tag_3x3", "tag_5k"]  # fallback


VALID_TAG_IDS = _get_valid_tag_ids()

# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_headers(api):
    resp = api.post(f"{BASE_URL}/api/auth/login", json={
        "email": USER_EMAIL,
        "password": USER_PASS,
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def existing_point_id(api, auth_headers):
    """Crée un SpotYou valide pour les tests de mise à jour, puis le supprime après."""
    payload = {
        "title": "TEST_VALID_Point pour update tests",
        "latitude": PARIS_LAT,
        "longitude": PARIS_LNG,
        "precision": "exact",
        "tag_ids": VALID_TAG_IDS,
        "domain_id": "dom_sport",
        "images": [],
    }
    resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
    assert resp.status_code == 200, f"Setup failed: {resp.text}"
    pid = resp.json()["point_id"]
    yield pid
    api.delete(f"{BASE_URL}/api/tag-points/{pid}", headers=auth_headers)


# ─── Tests : Règle « au moins un tag » — Création ─────────────────────────────

class TestTagRequiredOnCreate:
    """POST /api/tag-points doit rejeter tag_ids vide."""

    def test_create_without_tags_returns_400(self, api, auth_headers):
        """tag_ids vide → 400 (règle métier)."""
        payload = {
            "title": "TEST_Sans tag",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": [],
            "domain_id": "dom_sport",
            "images": [],
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create without tags: {resp.status_code} - {resp.text[:200]}")
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        assert "tag" in resp.json().get("detail", "").lower(), "Error message should mention 'tag'"

    def test_create_with_one_tag_returns_200(self, api, auth_headers):
        """Un seul tag → 200."""
        payload = {
            "title": "TEST_Avec un tag",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": [VALID_TAG_IDS[0]],
            "domain_id": "dom_sport",
            "images": [],
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create with one tag: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        api.delete(f"{BASE_URL}/api/tag-points/{resp.json()['point_id']}", headers=auth_headers)

    def test_create_with_multiple_tags_returns_200(self, api, auth_headers):
        """Plusieurs tags → 200."""
        payload = {
            "title": "TEST_Avec plusieurs tags",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create with multiple tags: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        api.delete(f"{BASE_URL}/api/tag-points/{resp.json()['point_id']}", headers=auth_headers)


# ─── Tests : Règle « au moins un tag » — Mise à jour ──────────────────────────

class TestTagRequiredOnUpdate:
    """PUT /api/tag-points/{id} doit rejeter tag_ids vide."""

    def test_update_tags_to_empty_returns_400(self, api, auth_headers, existing_point_id):
        """Vider tag_ids via PUT → 400 (règle métier)."""
        resp = api.put(
            f"{BASE_URL}/api/tag-points/{existing_point_id}",
            json={"tag_ids": []},
            headers=auth_headers,
        )
        print(f"Update tag_ids=[]: {resp.status_code} - {resp.text[:200]}")
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        assert "tag" in resp.json().get("detail", "").lower(), "Error message should mention 'tag'"

    def test_update_tags_to_valid_returns_200(self, api, auth_headers, existing_point_id):
        """Mettre à jour tag_ids avec des valeurs valides → 200."""
        resp = api.put(
            f"{BASE_URL}/api/tag-points/{existing_point_id}",
            json={"tag_ids": [VALID_TAG_IDS[0]]},
            headers=auth_headers,
        )
        print(f"Update tag_ids=[valid]: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_update_without_tag_ids_field_returns_200(self, api, auth_headers, existing_point_id):
        """PUT sans champ tag_ids (champ non fourni) → ne déclenche pas la validation → 200."""
        resp = api.put(
            f"{BASE_URL}/api/tag-points/{existing_point_id}",
            json={"title": "TEST_Titre mis à jour"},
            headers=auth_headers,
        )
        print(f"Update without tag_ids field: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


# ─── Tests : Règle « min ≤ max » — Création ───────────────────────────────────

class TestCapacityValidationOnCreate:
    """POST /api/tag-points doit rejeter min > max."""

    def test_create_min_greater_than_max_returns_400(self, api, auth_headers):
        """minimum_participants > maximum_participants → 400."""
        payload = {
            "title": "TEST_Capacité invalide",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
            "minimum_participants": 10,
            "maximum_participants": 5,
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create min > max: {resp.status_code} - {resp.text[:200]}")
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        assert "minimum" in resp.json().get("detail", "").lower() or "maximum" in resp.json().get("detail", "").lower()

    def test_create_min_equal_max_returns_200(self, api, auth_headers):
        """minimum == maximum → valide → 200."""
        payload = {
            "title": "TEST_Capacité min==max",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
            "minimum_participants": 5,
            "maximum_participants": 5,
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create min==max: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        api.delete(f"{BASE_URL}/api/tag-points/{resp.json()['point_id']}", headers=auth_headers)

    def test_create_min_less_than_max_returns_200(self, api, auth_headers):
        """minimum < maximum → valide → 200."""
        payload = {
            "title": "TEST_Capacité valide",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
            "minimum_participants": 3,
            "maximum_participants": 15,
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create min < max: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        api.delete(f"{BASE_URL}/api/tag-points/{resp.json()['point_id']}", headers=auth_headers)

    def test_create_only_min_no_max_returns_200(self, api, auth_headers):
        """Seul minimum fourni (sans maximum) → 200 (max sera auto-initialisé = min)."""
        payload = {
            "title": "TEST_Uniquement minimum",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
            "minimum_participants": 4,
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create only min: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("minimum_participants") == 4
        assert data.get("maximum_participants") == 4, "max should be auto-set to min"
        api.delete(f"{BASE_URL}/api/tag-points/{data['point_id']}", headers=auth_headers)

    def test_create_only_max_no_min_returns_200(self, api, auth_headers):
        """Seul maximum fourni (sans minimum) → 200 (min sera auto-initialisé = max)."""
        payload = {
            "title": "TEST_Uniquement maximum",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
            "maximum_participants": 12,
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create only max: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("maximum_participants") == 12
        assert data.get("minimum_participants") == 12, "min should be auto-set to max"
        api.delete(f"{BASE_URL}/api/tag-points/{data['point_id']}", headers=auth_headers)

    def test_create_no_capacity_fields_returns_200(self, api, auth_headers):
        """Sans champ capacité → 200 (capacité optionnelle)."""
        payload = {
            "title": "TEST_Sans capacité",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create no capacity: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        api.delete(f"{BASE_URL}/api/tag-points/{resp.json()['point_id']}", headers=auth_headers)


# ─── Tests : Règle « min ≤ max » — Mise à jour ────────────────────────────────

class TestCapacityValidationOnUpdate:
    """PUT /api/tag-points/{id} doit rejeter min > max."""

    def test_update_min_greater_than_max_returns_400(self, api, auth_headers, existing_point_id):
        """Mettre à jour avec minimum > maximum → 400."""
        resp = api.put(
            f"{BASE_URL}/api/tag-points/{existing_point_id}",
            json={
                "minimum_participants": 20,
                "maximum_participants": 5,
            },
            headers=auth_headers,
        )
        print(f"Update min > max: {resp.status_code} - {resp.text[:200]}")
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"

    def test_update_valid_capacity_returns_200(self, api, auth_headers, existing_point_id):
        """Mettre à jour avec min ≤ max → 200."""
        resp = api.put(
            f"{BASE_URL}/api/tag-points/{existing_point_id}",
            json={
                "minimum_participants": 3,
                "maximum_participants": 10,
            },
            headers=auth_headers,
        )
        print(f"Update valid capacity: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("minimum_participants") == 3
        assert data.get("maximum_participants") == 10


# ─── Tests : Combinaison des deux règles ──────────────────────────────────────

class TestCombinedValidation:
    """Vérifie que les deux règles sont appliquées indépendamment."""

    def test_create_no_tags_and_invalid_capacity_returns_400(self, api, auth_headers):
        """Pas de tags ET min > max → 400 (la première règle détectée est retournée)."""
        payload = {
            "title": "TEST_Double erreur",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": [],
            "domain_id": "dom_sport",
            "images": [],
            "minimum_participants": 10,
            "maximum_participants": 2,
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create no tags + invalid capacity: {resp.status_code} - {resp.text[:200]}")
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"

    def test_create_valid_tags_and_valid_capacity_returns_200(self, api, auth_headers):
        """Tags valides + capacité valide → 200."""
        payload = {
            "title": "TEST_Tout valide",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
            "minimum_participants": 2,
            "maximum_participants": 8,
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create valid all: {resp.status_code}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        api.delete(f"{BASE_URL}/api/tag-points/{resp.json()['point_id']}", headers=auth_headers)
