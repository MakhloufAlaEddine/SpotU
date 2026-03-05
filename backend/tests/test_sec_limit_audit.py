"""
[SEC-12] Tests de bornage des paramètres `limit` sur les endpoints de liste.

Vérifie que :
  - limit=999999 → 422 Unprocessable Entity (FastAPI Query ge/le validation)
  - limit=0 / limit=-1 → 422 (min=1)
  - limit=1, limit=max → 200 OK
  - pas de paramètre → 200 OK (défaut=50)

Endpoints couverts :
  1. GET /api/users/me/notifications    (ge=1, le=200)
  2. GET /api/conversations/{id}/messages (ge=1, le=100)
  3. GET /api/admin/users               (ge=1, le=500) [admin only]

Usage :
    cd /app/backend
    python -m pytest tests/test_sec_limit_audit.py -v
"""

import httpx
import pytest

API_URL = "http://localhost:8001"


# ── Tokens ────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def user_token():
    r = httpx.post(f"{API_URL}/api/auth/login", json={
        "email": "user@winek.app", "password": "WinekUser2024!"
    })
    assert r.status_code == 200, f"Login user failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    r = httpx.post(f"{API_URL}/api/auth/login", json={
        "email": "admin@winek.app", "password": "WinekAdmin2024!"
    })
    assert r.status_code == 200, f"Login admin failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def conv_id(user_token):
    """Récupère la première conversation de l'utilisateur de test."""
    r = httpx.get(
        f"{API_URL}/api/conversations",
        headers={"Authorization": f"Bearer {user_token}"}
    )
    assert r.status_code == 200
    convs = r.json()
    if convs:
        return convs[0]["conversation_id"]
    # Créer une conversation si aucune n'existe
    r2 = httpx.post(
        f"{API_URL}/api/conversations",
        json={"type": "service", "context_id": "svc_demo001"},
        headers={"Authorization": f"Bearer {user_token}"}
    )
    assert r2.status_code == 200
    return r2.json()["conversation_id"]


# ── Helper ────────────────────────────────────────────────────────────────────

def get(url, token, params=""):
    full = f"{API_URL}{url}{params}"
    return httpx.get(full, headers={"Authorization": f"Bearer {token}"})


# ── 1. GET /api/users/me/notifications  (ge=1, le=200) ───────────────────────

class TestNotificationsLimit:

    def test_default_ok(self, user_token):
        """Sans paramètre → 200 (default=50)."""
        r = get("/api/users/me/notifications", user_token)
        assert r.status_code == 200, f"Attendu 200, obtenu {r.status_code}: {r.text}"
        assert isinstance(r.json(), list)

    def test_limit_1_ok(self, user_token):
        """limit=1 (minimum) → 200."""
        r = get("/api/users/me/notifications", user_token, "?limit=1")
        assert r.status_code == 200, f"Attendu 200, obtenu {r.status_code}: {r.text}"
        assert len(r.json()) <= 1

    def test_limit_50_ok(self, user_token):
        """limit=50 (défaut) → 200."""
        r = get("/api/users/me/notifications", user_token, "?limit=50")
        assert r.status_code == 200, f"Attendu 200, obtenu {r.status_code}: {r.text}"

    def test_limit_200_ok(self, user_token):
        """limit=200 (maximum valide) → 200."""
        r = get("/api/users/me/notifications", user_token, "?limit=200")
        assert r.status_code == 200, f"Attendu 200, obtenu {r.status_code}: {r.text}"

    def test_limit_201_rejected(self, user_token):
        """limit=201 (au-dessus du max=200) → 422."""
        r = get("/api/users/me/notifications", user_token, "?limit=201")
        assert r.status_code == 422, f"Attendu 422, obtenu {r.status_code}: {r.text}"

    def test_limit_999999_rejected(self, user_token):
        """limit=999999 → 422 (jamais une requête énorme)."""
        r = get("/api/users/me/notifications", user_token, "?limit=999999")
        assert r.status_code == 422, f"Attendu 422, obtenu {r.status_code}: {r.text}"

    def test_limit_0_rejected(self, user_token):
        """limit=0 (en dessous du min=1) → 422."""
        r = get("/api/users/me/notifications", user_token, "?limit=0")
        assert r.status_code == 422, f"Attendu 422, obtenu {r.status_code}: {r.text}"

    def test_limit_negative_rejected(self, user_token):
        """limit=-1 → 422."""
        r = get("/api/users/me/notifications", user_token, "?limit=-1")
        assert r.status_code == 422, f"Attendu 422, obtenu {r.status_code}: {r.text}"


# ── 2. GET /api/conversations/{id}/messages  (ge=1, le=100) ──────────────────

class TestMessagesLimit:

    def test_default_ok(self, user_token, conv_id):
        """Sans paramètre → 200 (default=50)."""
        r = get(f"/api/conversations/{conv_id}/messages", user_token)
        assert r.status_code == 200, f"Attendu 200, obtenu {r.status_code}: {r.text}"

    def test_limit_1_ok(self, user_token, conv_id):
        """limit=1 (minimum) → 200."""
        r = get(f"/api/conversations/{conv_id}/messages", user_token, "?limit=1")
        assert r.status_code == 200, f"Attendu 200, obtenu {r.status_code}: {r.text}"
        assert len(r.json()) <= 1

    def test_limit_100_ok(self, user_token, conv_id):
        """limit=100 (maximum valide) → 200."""
        r = get(f"/api/conversations/{conv_id}/messages", user_token, "?limit=100")
        assert r.status_code == 200, f"Attendu 200, obtenu {r.status_code}: {r.text}"

    def test_limit_101_rejected(self, user_token, conv_id):
        """limit=101 (au-dessus du max=100) → 422."""
        r = get(f"/api/conversations/{conv_id}/messages", user_token, "?limit=101")
        assert r.status_code == 422, f"Attendu 422, obtenu {r.status_code}: {r.text}"

    def test_limit_999999_rejected(self, user_token, conv_id):
        """limit=999999 → 422."""
        r = get(f"/api/conversations/{conv_id}/messages", user_token, "?limit=999999")
        assert r.status_code == 422, f"Attendu 422, obtenu {r.status_code}: {r.text}"

    def test_limit_0_rejected(self, user_token, conv_id):
        """limit=0 → 422."""
        r = get(f"/api/conversations/{conv_id}/messages", user_token, "?limit=0")
        assert r.status_code == 422, f"Attendu 422, obtenu {r.status_code}: {r.text}"


# ── 3. GET /api/admin/users  (ge=1, le=500) ──────────────────────────────────

class TestAdminUsersLimit:

    def test_default_ok(self, admin_token):
        """Sans paramètre → 200."""
        r = get("/api/admin/users", admin_token)
        assert r.status_code == 200, f"Attendu 200, obtenu {r.status_code}: {r.text}"

    def test_limit_1_ok(self, admin_token):
        """limit=1 → 200."""
        r = get("/api/admin/users", admin_token, "?limit=1")
        assert r.status_code == 200, f"Attendu 200, obtenu {r.status_code}: {r.text}"

    def test_limit_500_ok(self, admin_token):
        """limit=500 (maximum valide) → 200."""
        r = get("/api/admin/users", admin_token, "?limit=500")
        assert r.status_code == 200, f"Attendu 200, obtenu {r.status_code}: {r.text}"

    def test_limit_501_rejected(self, admin_token):
        """limit=501 (au-dessus du max=500) → 422."""
        r = get("/api/admin/users", admin_token, "?limit=501")
        assert r.status_code == 422, f"Attendu 422, obtenu {r.status_code}: {r.text}"

    def test_limit_999999_rejected(self, admin_token):
        """limit=999999 → 422."""
        r = get("/api/admin/users", admin_token, "?limit=999999")
        assert r.status_code == 422, f"Attendu 422, obtenu {r.status_code}: {r.text}"

    def test_limit_0_rejected(self, admin_token):
        """limit=0 → 422."""
        r = get("/api/admin/users", admin_token, "?limit=0")
        assert r.status_code == 422, f"Attendu 422, obtenu {r.status_code}: {r.text}"

    def test_limit_negative_rejected(self, admin_token):
        """limit=-5 → 422."""
        r = get("/api/admin/users", admin_token, "?limit=-5")
        assert r.status_code == 422, f"Attendu 422, obtenu {r.status_code}: {r.text}"
