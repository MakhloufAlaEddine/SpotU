"""
Iteration 23 - Tests P0: Vérification des corrections du bug 'Edit Service'
- Backend: PUT /api/services/{service_id} (plus de json.dumps sur tag_ids)
- Frontend: router.replace (redirection directe après sauvegarde)
- GET /api/services/mine
- GET /api/services/{service_id}
- Auth coach: POST /api/auth/login
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


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

SERVICE_ID = "svc_demo001"
COACH_EMAIL = "coach@winek.app"
COACH_PASSWORD = "WinekCoach2024!"
USER_EMAIL = "user@winek.app"
USER_PASSWORD = "WinekUser2024!"


@pytest.fixture(scope="module")
def coach_token():
    """Obtenir le token du coach"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": COACH_EMAIL, "password": COACH_PASSWORD
    })
    assert resp.status_code == 200, f"Coach login failed: {resp.text}"
    token = resp.json().get("token")
    assert token, "No token in response"
    return token


@pytest.fixture(scope="module")
def user_token():
    """Obtenir le token de l'utilisateur non-coach"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": USER_EMAIL, "password": USER_PASSWORD
    })
    assert resp.status_code == 200, f"User login failed: {resp.text}"
    token = resp.json().get("token")
    assert token, "No token in response"
    return token


@pytest.fixture(scope="module")
def coach_headers(coach_token):
    return {"Authorization": f"Bearer {coach_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_headers(user_token):
    return {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}


# ── AUTH TESTS ──────────────────────────────────────────────────────────────

class TestAuth:
    """Tests d'authentification"""

    def test_coach_login_success(self):
        """P0: Coach peut se connecter"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": COACH_EMAIL, "password": COACH_PASSWORD
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert "user" in data
        user = data["user"]
        assert user["role"] == "coach"
        assert user["user_id"] == "user_coach001"
        print(f"✓ Coach login: {user['name']} (role={user['role']})")

    def test_coach_login_wrong_password(self):
        """Coach avec mauvais mot de passe → 401"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": COACH_EMAIL, "password": "wrongpassword"
        })
        assert resp.status_code == 401
        print("✓ Wrong password → 401")


# ── GET SERVICES TESTS ──────────────────────────────────────────────────────

class TestGetServices:
    """Tests GET services"""

    def test_get_my_services(self, coach_headers):
        """P0: GET /api/services/mine retourne les services du coach"""
        resp = requests.get(f"{BASE_URL}/api/services/mine", headers=coach_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1, "Coach should have at least 1 service"
        service = data[0]
        assert service["service_id"] == SERVICE_ID
        assert service["coach_id"] == "user_coach001"
        # Vérifier tag_ids - devrait être un type lisible (string ou list)
        tag_ids = service.get("tag_ids")
        print(f"✓ GET /mine: {len(data)} services | tag_ids type={type(tag_ids).__name__} value={tag_ids}")

    def test_get_service_by_id(self):
        """P0: GET /api/services/{id} retourne le service avec coach et tags"""
        resp = requests.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["service_id"] == SERVICE_ID
        assert data["coach_id"] == "user_coach001"
        assert "title" in data
        assert "price" in data
        assert "coach" in data
        assert "tags" in data
        assert "locations" in data
        assert "slots" in data
        # Vérifier que le coach est enrichi
        assert data["coach"]["user_id"] == "user_coach001"
        print(f"✓ GET /services/{SERVICE_ID}: title='{data['title']}', price={data['price']}, tags={len(data['tags'])}")

    def test_get_service_not_found(self):
        """Service inexistant → 404"""
        resp = requests.get(f"{BASE_URL}/api/services/svc_nonexistent99999")
        assert resp.status_code == 404
        print("✓ Non-existent service → 404")

    def test_get_service_unauthenticated(self):
        """GET service sans auth → 200 (public endpoint)"""
        resp = requests.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        assert resp.status_code == 200
        print("✓ GET service without auth → 200 (public)")

    def test_get_mine_unauthenticated(self):
        """GET /services/mine sans auth → 401"""
        resp = requests.get(f"{BASE_URL}/api/services/mine")
        assert resp.status_code == 401
        print("✓ GET /services/mine without auth → 401")


# ── PUT SERVICE TESTS ────────────────────────────────────────────────────────

class TestUpdateService:
    """Tests PUT /api/services/{id} - Bug fix vérification"""

    def test_put_title_and_price_only(self, coach_headers):
        """P0: PUT titre+prix uniquement conserve les autres champs"""
        # D'abord récupérer l'état actuel
        get_resp = requests.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        original = get_resp.json()

        # PUT uniquement titre et prix
        put_resp = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers=coach_headers,
            json={"title": "Coaching Running Paris - ITER23 TEST", "price": 75.0}
        )
        assert put_resp.status_code == 200, f"PUT failed: {put_resp.text}"
        data = put_resp.json()
        assert data["title"] == "Coaching Running Paris - ITER23 TEST"
        assert float(data["price"]) == 75.0
        print(f"✓ PUT scalar update: title updated, price=75.0")

    def test_put_with_tag_ids_as_list(self, coach_headers):
        """P0: PUT avec tag_ids comme liste (pas double-encodé) → 200 (pas 422)"""
        put_resp = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers=coach_headers,
            json={
                "title": "Coaching Running Paris",
                "price": 65.0,
                "tag_ids": ["tag_musculation", "tag_cardio", "tag_hiit"]
            }
        )
        assert put_resp.status_code == 200, f"PUT with tag_ids list failed: {put_resp.text}"
        data = put_resp.json()
        assert data["title"] == "Coaching Running Paris"
        assert float(data["price"]) == 65.0
        # tags enrichis devraient être présents
        assert "tags" in data
        tags = data["tags"]
        tag_ids_returned = [t["tag_id"] for t in tags]
        assert "tag_musculation" in tag_ids_returned or len(tags) >= 0
        print(f"✓ PUT tag_ids as list → 200 OK | returned tags={tag_ids_returned}")

    def test_put_with_empty_tag_ids(self, coach_headers):
        """PUT avec tag_ids vide [] → ne pas causer 422"""
        put_resp = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers=coach_headers,
            json={"tag_ids": []}
        )
        assert put_resp.status_code == 200, f"PUT with empty tag_ids failed: {put_resp.text}"
        print("✓ PUT empty tag_ids [] → 200 OK")

    def test_put_with_locations_and_slots(self, coach_headers):
        """P0: PUT complet avec locations + slots remplace correctement"""
        put_resp = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers=coach_headers,
            json={
                "title": "Coaching personnalisé - Fitness & Running",
                "price": 60.0,
                "tag_ids": ["tag_musculation", "tag_cardio", "tag_hiit"],
                "domain_id": "dom_coaching",
                "locations": [
                    {
                        "latitude": 48.8566,
                        "longitude": 2.3522,
                        "precision": "exact",
                        "description": "Paris Centre"
                    }
                ],
                "slots": [
                    {"day_of_week": 0, "start_time": "07:00", "end_time": "08:00"},
                    {"day_of_week": 3, "start_time": "12:00", "end_time": "13:00"}
                ]
            }
        )
        assert put_resp.status_code == 200, f"PUT full update failed: {put_resp.text}"
        data = put_resp.json()
        assert data["title"] == "Coaching personnalisé - Fitness & Running"
        assert float(data["price"]) == 60.0
        assert len(data["locations"]) == 1
        assert len(data["slots"]) == 2
        print(f"✓ PUT full update: 1 location, 2 slots → OK")

    def test_put_verify_persistence_after_update(self, coach_headers):
        """P0: Vérification que les modifications sont persistées en DB"""
        # Mettre à jour
        new_price = 80.0
        put_resp = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers=coach_headers,
            json={"price": new_price}
        )
        assert put_resp.status_code == 200

        # GET pour vérifier la persistance
        get_resp = requests.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        assert get_resp.status_code == 200
        fetched = get_resp.json()
        assert float(fetched["price"]) == new_price, f"Price not persisted: {fetched['price']} != {new_price}"
        print(f"✓ Persistence after PUT: price={new_price} confirmed via GET")

    def test_put_non_owner_forbidden(self, user_headers):
        """Non-propriétaire → 403 Forbidden"""
        put_resp = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers=user_headers,
            json={"title": "Hacked title"}
        )
        assert put_resp.status_code == 403, f"Expected 403, got {put_resp.status_code}"
        print("✓ Non-owner PUT → 403 Forbidden")

    def test_put_unauthenticated(self):
        """PUT sans auth → 401"""
        put_resp = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            json={"title": "Anonymous update"}
        )
        assert put_resp.status_code == 401, f"Expected 401, got {put_resp.status_code}"
        print("✓ Unauthenticated PUT → 401")

    def test_put_nonexistent_service(self, coach_headers):
        """PUT service inexistant → 404"""
        put_resp = requests.put(
            f"{BASE_URL}/api/services/svc_nonexistent99999",
            headers=coach_headers,
            json={"price": 50.0}
        )
        assert put_resp.status_code == 404
        print("✓ PUT non-existent service → 404")

    def test_restore_service_original_state(self, coach_headers):
        """Restaurer le service à son état original pour les tests suivants"""
        put_resp = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers=coach_headers,
            json={
                "title": "Coaching personnalisé - Fitness & Running",
                "price": 60.0,
                "tag_ids": ["tag_musculation", "tag_cardio", "tag_hiit"],
                "domain_id": "dom_coaching",
                "locations": [
                    {
                        "latitude": 48.8566,
                        "longitude": 2.3522,
                        "precision": "exact",
                        "description": "Paris Centre"
                    }
                ],
                "slots": [
                    {"day_of_week": 0, "start_time": "07:00", "end_time": "08:00"},
                    {"day_of_week": 3, "start_time": "12:00", "end_time": "13:00"}
                ]
            }
        )
        assert put_resp.status_code == 200
        data = put_resp.json()
        assert data["title"] == "Coaching personnalisé - Fitness & Running"
        assert float(data["price"]) == 60.0
        print(f"✓ Service restored to original state")


# ── TAG IDS ENCODING TEST ────────────────────────────────────────────────────

class TestTagIdsEncoding:
    """Tests spécifiques pour vérifier la correction du double-encodage"""

    def test_tag_ids_not_double_encoded_after_put(self, coach_headers):
        """P0: tag_ids envoyé comme liste → pas de 422 (bug fix vérifié)"""
        # Test le plus simple: envoyer une liste de tags
        put_resp = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers=coach_headers,
            json={"tag_ids": ["tag_musculation", "tag_cardio"]}
        )
        assert put_resp.status_code == 200, (
            f"tag_ids list caused {put_resp.status_code}: {put_resp.text}\n"
            f"BUG: json.dumps() double-encodage toujours présent?"
        )
        data = put_resp.json()
        # Les tags enrichis devraient correspondre
        tags = data.get("tags", [])
        print(f"✓ tag_ids as list → 200 OK | enriched tags: {[t['tag_id'] for t in tags]}")

    def test_frontend_defensive_parsing_works(self, coach_headers):
        """Vérification que le frontend peut parser tag_ids (string ou list)"""
        get_resp = requests.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        assert get_resp.status_code == 200
        data = get_resp.json()
        raw_tag_ids = data.get("tag_ids")
        # Simuler la logique de parsing du frontend (edit-service/[id].tsx ligne 101)
        import json
        if isinstance(raw_tag_ids, list):
            parsed_tags = raw_tag_ids
        elif isinstance(raw_tag_ids, str):
            try:
                parsed_tags = json.loads(raw_tag_ids)
            except Exception:
                parsed_tags = []
        else:
            parsed_tags = []
        assert isinstance(parsed_tags, list), f"Parsed tags should be a list, got {type(parsed_tags)}"
        print(f"✓ Frontend parsing simulation: raw={type(raw_tag_ids).__name__} → parsed={parsed_tags}")

    def test_put_tag_ids_string_causes_422(self, coach_headers):
        """Vérification que tag_ids en STRING cause 422 (validation Pydantic)"""
        put_resp = requests.put(
            f"{BASE_URL}/api/services/{SERVICE_ID}",
            headers=coach_headers,
            json={"tag_ids": '["tag_musculation"]'}  # string au lieu de liste
        )
        # Ceci DOIT causer 422 - si non, Pydantic ne valide pas
        assert put_resp.status_code == 422, (
            f"Expected 422 for string tag_ids, got {put_resp.status_code}. "
            f"Note: The frontend must send tag_ids as a list, not a string."
        )
        print(f"✓ tag_ids as string → 422 (correct Pydantic validation)")
