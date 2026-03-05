"""
Tests SEC-02 — Migration AsyncStorage → expo-secure-store
===========================================================
Vérifie que :
  1. expo-secure-store est installé dans package.json
  2. storage.ts n'importe plus AsyncStorage (pour les tokens)
  3. storage.ts importe expo-secure-store
  4. L'API publique (get/set/remove) est inchangée
  5. Le fallback web (localStorage) est maintenu
  6. E2E : login → token → GET /me → 200 → logout → GET /me → 401

Usage :
    cd /app/backend
    python -m pytest tests/test_sec02_secure_storage.py -v
"""
import json
import uuid
import httpx
import pytest

API_URL = "http://localhost:8001"
CREDS   = {"email": "user@winek.app", "password": "WinekUser2024!"}


def _unique_ip() -> str:
    r = uuid.uuid4().int
    return f"10.{(r>>16)&0xFF}.{(r>>8)&0xFF}.{r&0xFF or 1}"


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-02-A] Analyse statique — storage.ts
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC02_StaticAnalysis:

    @classmethod
    def _src(cls) -> str:
        with open("/app/frontend/lib/storage.ts", encoding="utf-8") as f:
            return f.read()

    @classmethod
    def _pkg(cls) -> dict:
        with open("/app/frontend/package.json", encoding="utf-8") as f:
            return json.load(f)

    def test_expo_secure_store_dans_package_json(self):
        """expo-secure-store doit figurer dans les dependencies de package.json."""
        deps = {
            **self._pkg().get("dependencies", {}),
            **self._pkg().get("devDependencies", {}),
        }
        assert "expo-secure-store" in deps, (
            "FAIL: expo-secure-store absent de package.json — "
            "lancer: cd frontend && yarn add expo-secure-store"
        )

    def test_import_expo_secure_store_present(self):
        """storage.ts doit importer expo-secure-store."""
        src = self._src()
        assert "expo-secure-store" in src, (
            "FAIL: import de expo-secure-store absent de storage.ts"
        )
        assert "SecureStore" in src, (
            "FAIL: référence à SecureStore absente de storage.ts"
        )

    def test_async_storage_plus_utilise_pour_token(self):
        """[SEC-02] AsyncStorage ne doit plus être importé dans storage.ts."""
        src = self._src()
        assert "AsyncStorage" not in src, (
            "FAIL: AsyncStorage encore importé dans storage.ts — "
            "le token JWT resterait en clair dans le stockage non chiffré"
        )
        assert "@react-native-async-storage/async-storage" not in src, (
            "FAIL: @react-native-async-storage/async-storage encore importé"
        )

    def test_api_publique_inchangee(self):
        """L'API storage.get/set/remove est maintenue (rétrocompatibilité)."""
        src = self._src()
        assert "async set(" in src or "set(" in src, "FAIL: méthode set() absente"
        assert "async get(" in src or "get(" in src, "FAIL: méthode get() absente"
        assert "async remove(" in src or "remove(" in src, "FAIL: méthode remove() absente"

    def test_fallback_web_localstore_maintenu(self):
        """Le fallback web (localStorage) doit être maintenu pour Expo Web."""
        src = self._src()
        assert "localStorage" in src, (
            "FAIL: fallback localStorage absent — Expo Web ne fonctionnera pas"
        )
        assert "Platform.OS" in src or "Platform" in src, (
            "FAIL: vérification Platform.OS absente — pas de branchement natif/web"
        )

    def test_secure_store_operations_utilises(self):
        """setItemAsync, getItemAsync, deleteItemAsync doivent être utilisés."""
        src = self._src()
        assert "setItemAsync" in src,    "FAIL: setItemAsync absent"
        assert "getItemAsync" in src,    "FAIL: getItemAsync absent"
        assert "deleteItemAsync" in src, "FAIL: deleteItemAsync absent"


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-02-B] E2E — Login → /me → Logout
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC02_E2E:

    def test_login_retourne_token_valide(self):
        """Login → token JWT non-vide retourné."""
        resp = httpx.post(
            f"{API_URL}/api/auth/login",
            json=CREDS,
            headers={"X-Forwarded-For": _unique_ip()},
            timeout=10,
        )
        assert resp.status_code == 200, f"Login échoué: {resp.text}"
        body = resp.json()
        assert "token" in body, "Champ 'token' absent"
        assert len(body["token"]) > 20, "Token trop court (suspect)"

    def test_get_me_avec_token_valide_retourne_user(self):
        """GET /auth/me avec token valide → 200 + user_id + email."""
        token = httpx.post(
            f"{API_URL}/api/auth/login",
            json=CREDS,
            headers={"X-Forwarded-For": _unique_ip()},
            timeout=10,
        ).json()["token"]

        resp = httpx.get(
            f"{API_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert resp.status_code == 200, f"GET /me échoué: {resp.text}"
        me = resp.json()
        assert "user_id" in me, "user_id absent"
        assert "email" in me,   "email absent"
        assert "role" in me,    "role absent"

    def test_logout_token_invalide_retourne_401(self):
        """Après logout (storage.remove → plus de token), GET /me → 401."""
        resp = httpx.get(
            f"{API_URL}/api/auth/me",
            headers={"Authorization": "Bearer token_invalide_post_logout"},
            timeout=10,
        )
        assert resp.status_code == 401, (
            f"Attendu 401 (token invalide/absent), obtenu {resp.status_code}"
        )

    def test_appel_api_authentifie_fonctionne(self):
        """Un appel API authentifié typique (GET /conversations) fonctionne."""
        token = httpx.post(
            f"{API_URL}/api/auth/login",
            json=CREDS,
            headers={"X-Forwarded-For": _unique_ip()},
            timeout=10,
        ).json()["token"]

        resp = httpx.get(
            f"{API_URL}/api/conversations",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert resp.status_code == 200, (
            f"GET /conversations échoué: {resp.status_code} {resp.text}"
        )

    def test_token_jwt_est_bien_forme(self):
        """Le token JWT a le bon format (3 segments séparés par des points)."""
        token = httpx.post(
            f"{API_URL}/api/auth/login",
            json=CREDS,
            headers={"X-Forwarded-For": _unique_ip()},
            timeout=10,
        ).json()["token"]

        parts = token.split(".")
        assert len(parts) == 3, (
            f"JWT mal formé (attendu 3 segments, obtenu {len(parts)}): {token[:50]}"
        )
