"""
Tests complets pour le masquage d'adresse (Services + SpotYou)
Couvre: masquage 100m/1000m, owner vs non-owner, is_owner flag,
        original_address/original_description, création, mise à jour
"""
import pytest
import httpx
import asyncpg
import asyncio

API_URL = "https://quality-analyzer.preview.emergentagent.com"
DB_URL = "postgresql://winek:winek2024@127.0.0.1/winek_db"

# Users
USER_CREDS = {"email": "user@winek.app", "password": "WinekUser2024!"}      # user_demo001
COACH_CREDS = {"email": "coach@winek.app", "password": "WinekCoach2024!"}    # user_coach001

# Test data
FULL_ADDRESS = "12 Rue de Rivoli, 75001 Paris, France"
EXPECTED_1000M = "Paris"
EXPECTED_100M = "Rue de Rivoli"

# ── Helpers ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(scope="module")
def client():
    with httpx.Client(base_url=API_URL, timeout=15) as c:
        yield c

def login(client, creds):
    r = client.post("/api/auth/login", json=creds)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]

@pytest.fixture(scope="module")
def user_token(client):
    return login(client, USER_CREDS)

@pytest.fixture(scope="module")
def coach_token(client):
    return login(client, COACH_CREDS)

def auth(token):
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture(scope="module")
def db_conn(event_loop):
    conn = event_loop.run_until_complete(asyncpg.connect(DB_URL))
    yield conn
    event_loop.run_until_complete(conn.close())

# ── _mask_address unit tests ────────────────────────────────────────────────

class TestMaskAddressFunction:
    """Test the _mask_address function directly via import."""

    def test_exact_returns_full(self):
        from routes.service_routes import _mask_address
        assert _mask_address(FULL_ADDRESS, "exact") == FULL_ADDRESS

    def test_1000m_returns_city(self):
        from routes.service_routes import _mask_address
        assert _mask_address(FULL_ADDRESS, "1000m") == EXPECTED_1000M

    def test_1000m_skips_france(self):
        from routes.service_routes import _mask_address
        result = _mask_address("45 Avenue des Champs-Élysées, Paris 8e, France", "1000m")
        assert result == "Paris 8e"

    def test_1000m_postal_code_extraction(self):
        from routes.service_routes import _mask_address
        assert _mask_address("7 Rue de la Paix, 75002 Paris", "1000m") == "Paris"

    def test_100m_strips_number(self):
        from routes.service_routes import _mask_address
        assert _mask_address(FULL_ADDRESS, "100m") == EXPECTED_100M

    def test_100m_strips_bis(self):
        from routes.service_routes import _mask_address
        assert _mask_address("7 bis Rue de la Paix, 75002 Paris", "100m") == "Rue de la Paix"

    def test_none_address(self):
        from routes.service_routes import _mask_address
        assert _mask_address(None, "1000m") is None

    def test_empty_address(self):
        from routes.service_routes import _mask_address
        assert _mask_address("", "1000m") == ""

    def test_single_part_address(self):
        from routes.service_routes import _mask_address
        assert _mask_address("Paris", "1000m") == "Paris"

    def test_1000m_various_formats(self):
        from routes.service_routes import _mask_address
        cases = [
            ("Place de la Bastille, Paris 11ème, France", "Paris 11ème"),
            ("14 Rue Oberkampf, 75011 Paris, France", "Paris"),
            ("Parc Monceau, Paris 8ème", "Paris 8ème"),
            ("75008 Paris", "Paris"),
        ]
        for addr, expected in cases:
            result = _mask_address(addr, "1000m")
            assert result == expected, f"Failed: '{addr}' → '{result}' (expected '{expected}')"


# ── SpotYou (TagPoint) API Tests ────────────────────────────────────────────

class TestSpotYouAddressAPI:
    """Test address masking on SpotYou (tag_points) endpoints."""

    def test_get_anonymous_1000m(self, client, db_conn, event_loop):
        """Anonymous user sees masked address, no original_address."""
        event_loop.run_until_complete(db_conn.execute(
            "UPDATE tag_points SET address=$1, precision='1000m' WHERE point_id='pt_demo001'",
            FULL_ADDRESS
        ))
        try:
            r = client.get("/api/tag-points/pt_demo001")
            assert r.status_code == 200
            d = r.json()
            assert d["address"] == EXPECTED_1000M
            assert d["is_owner"] == False
            assert "original_address" not in d
        finally:
            event_loop.run_until_complete(db_conn.execute(
                "UPDATE tag_points SET address=NULL, precision='exact' WHERE point_id='pt_demo001'"
            ))

    def test_get_anonymous_100m(self, client, db_conn, event_loop):
        """Anonymous user sees 100m masked address."""
        event_loop.run_until_complete(db_conn.execute(
            "UPDATE tag_points SET address=$1, precision='100m' WHERE point_id='pt_demo001'",
            FULL_ADDRESS
        ))
        try:
            r = client.get("/api/tag-points/pt_demo001")
            assert r.status_code == 200
            d = r.json()
            assert d["address"] == EXPECTED_100M
            assert d["is_owner"] == False
        finally:
            event_loop.run_until_complete(db_conn.execute(
                "UPDATE tag_points SET address=NULL, precision='exact' WHERE point_id='pt_demo001'"
            ))

    def test_get_owner_1000m(self, client, user_token, db_conn, event_loop):
        """Owner sees masked address + original_address + is_owner=true."""
        event_loop.run_until_complete(db_conn.execute(
            "UPDATE tag_points SET address=$1, precision='1000m' WHERE point_id='pt_demo001'",
            FULL_ADDRESS
        ))
        try:
            r = client.get("/api/tag-points/pt_demo001", headers=auth(user_token))
            assert r.status_code == 200
            d = r.json()
            assert d["address"] == EXPECTED_1000M
            assert d["is_owner"] == True
            assert d["original_address"] == FULL_ADDRESS
        finally:
            event_loop.run_until_complete(db_conn.execute(
                "UPDATE tag_points SET address=NULL, precision='exact' WHERE point_id='pt_demo001'"
            ))

    def test_get_nonowner_1000m(self, client, coach_token, db_conn, event_loop):
        """Non-owner sees masked address, no original_address."""
        event_loop.run_until_complete(db_conn.execute(
            "UPDATE tag_points SET address=$1, precision='1000m' WHERE point_id='pt_demo001'",
            FULL_ADDRESS
        ))
        try:
            r = client.get("/api/tag-points/pt_demo001", headers=auth(coach_token))
            assert r.status_code == 200
            d = r.json()
            assert d["address"] == EXPECTED_1000M
            assert d["is_owner"] == False
            assert "original_address" not in d
        finally:
            event_loop.run_until_complete(db_conn.execute(
                "UPDATE tag_points SET address=NULL, precision='exact' WHERE point_id='pt_demo001'"
            ))

    def test_get_owner_exact(self, client, user_token, db_conn, event_loop):
        """Owner with exact precision sees full address, no original_address needed."""
        event_loop.run_until_complete(db_conn.execute(
            "UPDATE tag_points SET address=$1, precision='exact' WHERE point_id='pt_demo001'",
            FULL_ADDRESS
        ))
        try:
            r = client.get("/api/tag-points/pt_demo001", headers=auth(user_token))
            assert r.status_code == 200
            d = r.json()
            assert d["address"] == FULL_ADDRESS
            assert d["is_owner"] == True
            assert "original_address" not in d
        finally:
            event_loop.run_until_complete(db_conn.execute(
                "UPDATE tag_points SET address=NULL, precision='exact' WHERE point_id='pt_demo001'"
            ))

    def test_null_address(self, client):
        """No error when address is NULL."""
        r = client.get("/api/tag-points/pt_demo001")
        assert r.status_code == 200
        d = r.json()
        assert d.get("address") is None
        assert "original_address" not in d

    def test_create_with_address(self, client, user_token):
        """POST stores and masks address correctly."""
        payload = {
            "title": "Test adresse",
            "latitude": 48.8566, "longitude": 2.3522,
            "precision": "100m",
            "domain_id": "domain_fitness",
            "tag_ids": ["tag_trail"],
            "address": FULL_ADDRESS,
        }
        r = client.post("/api/tag-points", json=payload, headers=auth(user_token))
        assert r.status_code == 200
        d = r.json()
        pid = d.get("point_id")
        try:
            assert d["address"] == EXPECTED_100M
            assert d["original_address"] == FULL_ADDRESS
            assert d["is_owner"] == True
        finally:
            if pid:
                client.delete(f"/api/tag-points/{pid}", headers=auth(user_token))

    def test_update_address(self, client, user_token):
        """PUT updates address and returns is_owner=true + original_address."""
        # Create first
        payload = {
            "title": "Test update adresse",
            "latitude": 48.8566, "longitude": 2.3522,
            "precision": "1000m",
            "domain_id": "domain_fitness",
            "tag_ids": ["tag_trail"],
            "address": FULL_ADDRESS,
        }
        r = client.post("/api/tag-points", json=payload, headers=auth(user_token))
        assert r.status_code == 200
        pid = r.json()["point_id"]
        try:
            new_addr = "5 Rue du Faubourg Saint-Honoré, 75008 Paris, France"
            r2 = client.put(f"/api/tag-points/{pid}", json={"address": new_addr}, headers=auth(user_token))
            assert r2.status_code == 200
            d2 = r2.json()
            assert d2["address"] == "Paris"  # 1000m masking
            assert d2["original_address"] == new_addr
            assert d2["is_owner"] == True
        finally:
            client.delete(f"/api/tag-points/{pid}", headers=auth(user_token))

    def test_mine_endpoint(self, client, user_token, db_conn, event_loop):
        """/api/tag-points/mine returns is_owner=true + original_address."""
        event_loop.run_until_complete(db_conn.execute(
            "UPDATE tag_points SET address=$1, precision='1000m' WHERE point_id='pt_demo001'",
            FULL_ADDRESS
        ))
        try:
            r = client.get("/api/tag-points/mine", headers=auth(user_token))
            assert r.status_code == 200
            points = r.json()
            pt = next((p for p in points if p["point_id"] == "pt_demo001"), None)
            assert pt is not None, "pt_demo001 not found in /mine"
            assert pt["is_owner"] == True
            assert pt["address"] == EXPECTED_1000M
            assert pt["original_address"] == FULL_ADDRESS
        finally:
            event_loop.run_until_complete(db_conn.execute(
                "UPDATE tag_points SET address=NULL, precision='exact' WHERE point_id='pt_demo001'"
            ))


# ── Service API Tests (regression) ──────────────────────────────────────────

class TestServiceAddressAPI:
    """Regression tests for service address masking."""

    def test_service_anonymous_1000m(self, client, db_conn, event_loop):
        """Service location masked to city for anonymous."""
        event_loop.run_until_complete(db_conn.execute(
            "UPDATE service_locations SET description=$1, precision='1000m' WHERE location_id='loc_demo001'",
            FULL_ADDRESS
        ))
        try:
            r = client.get("/api/services/svc_demo001")
            assert r.status_code == 200
            d = r.json()
            loc = d["locations"][0]
            assert loc["description"] == EXPECTED_1000M
            assert d["is_owner"] == False
            assert "original_description" not in loc
        finally:
            event_loop.run_until_complete(db_conn.execute(
                "UPDATE service_locations SET description='Parc Monceau, Paris 8ème', precision='exact' WHERE location_id='loc_demo001'"
            ))

    def test_service_owner_1000m(self, client, coach_token, db_conn, event_loop):
        """Service owner sees masked + original_description."""
        event_loop.run_until_complete(db_conn.execute(
            "UPDATE service_locations SET description=$1, precision='1000m' WHERE location_id='loc_demo001'",
            FULL_ADDRESS
        ))
        try:
            r = client.get("/api/services/svc_demo001", headers=auth(coach_token))
            assert r.status_code == 200
            d = r.json()
            loc = d["locations"][0]
            assert loc["description"] == EXPECTED_1000M
            assert d["is_owner"] == True
            assert loc["original_description"] == FULL_ADDRESS
        finally:
            event_loop.run_until_complete(db_conn.execute(
                "UPDATE service_locations SET description='Parc Monceau, Paris 8ème', precision='exact' WHERE location_id='loc_demo001'"
            ))

    def test_service_nonowner_1000m(self, client, user_token, db_conn, event_loop):
        """Non-owner sees masked service address, no original_description."""
        event_loop.run_until_complete(db_conn.execute(
            "UPDATE service_locations SET description=$1, precision='1000m' WHERE location_id='loc_demo001'",
            FULL_ADDRESS
        ))
        try:
            r = client.get("/api/services/svc_demo001", headers=auth(user_token))
            assert r.status_code == 200
            d = r.json()
            loc = d["locations"][0]
            assert loc["description"] == EXPECTED_1000M
            assert d["is_owner"] == False
            assert "original_description" not in loc
        finally:
            event_loop.run_until_complete(db_conn.execute(
                "UPDATE service_locations SET description='Parc Monceau, Paris 8ème', precision='exact' WHERE location_id='loc_demo001'"
            ))

    def test_service_mine_returns_owner(self, client, coach_token, db_conn, event_loop):
        """/api/services/mine returns is_owner=true + original_description."""
        event_loop.run_until_complete(db_conn.execute(
            "UPDATE service_locations SET description=$1, precision='1000m' WHERE location_id='loc_demo001'",
            FULL_ADDRESS
        ))
        try:
            r = client.get("/api/services/mine", headers=auth(coach_token))
            assert r.status_code == 200
            svcs = r.json()
            svc = next((s for s in svcs if s["service_id"] == "svc_demo001"), None)
            assert svc is not None, "svc_demo001 not found in /mine"
            assert svc["is_owner"] == True
            loc = svc["locations"][0]
            assert loc["original_description"] == FULL_ADDRESS
        finally:
            event_loop.run_until_complete(db_conn.execute(
                "UPDATE service_locations SET description='Parc Monceau, Paris 8ème', precision='exact' WHERE location_id='loc_demo001'"
            ))

    def test_service_100m(self, client, db_conn, event_loop):
        """100m precision returns street without number."""
        event_loop.run_until_complete(db_conn.execute(
            "UPDATE service_locations SET description=$1, precision='100m' WHERE location_id='loc_demo001'",
            FULL_ADDRESS
        ))
        try:
            r = client.get("/api/services/svc_demo001")
            assert r.status_code == 200
            loc = r.json()["locations"][0]
            assert loc["description"] == EXPECTED_100M
        finally:
            event_loop.run_until_complete(db_conn.execute(
                "UPDATE service_locations SET description='Parc Monceau, Paris 8ème', precision='exact' WHERE location_id='loc_demo001'"
            ))
