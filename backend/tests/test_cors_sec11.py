"""
Tests SEC-11 — Correctif CORS SpotU
=====================================
Vérifie que :
  1. Le preflight OPTIONS depuis une origine autorisée retourne 200 + headers CORS corrects
  2. Le preflight OPTIONS depuis une origine inconnue retourne 400 (Disallowed CORS origin)
  3. access-control-allow-origin JAMAIS mis à "*" (sécurité credentials)
  4. allow_credentials=True présent avec origines explicites
  5. Les méthodes autorisées sont celles définies (GET/POST/PUT/PATCH/DELETE/OPTIONS)
  6. Un GET simple depuis une origine autorisée reçoit access-control-allow-origin correct
  7. L'API reste fonctionnelle (non cassée par le changement)
  8. Analyse statique de server.py (pas de ["*"] wildcard)

Usage:
    cd /app/backend
    JWT_SECRET=<secret> python -m pytest tests/test_cors_sec11.py -v
"""
import os
import re
import httpx
import pytest

API_URL = "http://localhost:8001"

# Origines définies dans .env ALLOWED_ORIGINS
ALLOWED_ORIGIN  = "https://spotu-capacity-fix.preview.emergentagent.com"
DEV_ORIGIN      = "http://localhost:3000"
EVIL_ORIGIN     = "https://evil.com"

PREFLIGHT_HEADERS = {
    "Access-Control-Request-Method": "GET",
    "Access-Control-Request-Headers": "Authorization,Content-Type",
}


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def options(origin: str, endpoint: str = "/api/domains") -> httpx.Response:
    return httpx.options(
        f"{API_URL}{endpoint}",
        headers={"Origin": origin, **PREFLIGHT_HEADERS},
        timeout=10,
    )

def get_with_origin(origin: str, endpoint: str = "/api/domains") -> httpx.Response:
    return httpx.get(
        f"{API_URL}{endpoint}",
        headers={"Origin": origin},
        timeout=10,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-11-1] Preflight depuis une origine autorisée
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC11_PreflightAutorisé:

    def test_options_origine_principale_retourne_200(self):
        """Preflight depuis l'origine de production → 200."""
        resp = options(ALLOWED_ORIGIN)
        assert resp.status_code == 200, (
            f"Attendu 200, obtenu {resp.status_code}: {resp.text}"
        )

    def test_options_origine_principale_retourne_acao_correct(self):
        """Preflight autorisé → access-control-allow-origin = origine exacte."""
        resp = options(ALLOWED_ORIGIN)
        acao = resp.headers.get("access-control-allow-origin", "")
        assert acao == ALLOWED_ORIGIN, (
            f"access-control-allow-origin attendu: {ALLOWED_ORIGIN!r}, obtenu: {acao!r}"
        )

    def test_options_origine_principale_credentials_true(self):
        """Preflight autorisé → access-control-allow-credentials: true."""
        resp = options(ALLOWED_ORIGIN)
        acac = resp.headers.get("access-control-allow-credentials", "")
        assert acac.lower() == "true", (
            f"access-control-allow-credentials attendu: 'true', obtenu: {acac!r}"
        )

    def test_options_origine_principale_methodes_correctes(self):
        """Preflight autorisé → méthodes retournées incluent GET, POST, etc."""
        resp = options(ALLOWED_ORIGIN)
        methods_raw = resp.headers.get("access-control-allow-methods", "")
        methods = {m.strip().upper() for m in methods_raw.split(",")}
        for expected in {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}:
            assert expected in methods, (
                f"Méthode {expected} absente de access-control-allow-methods: {methods_raw!r}"
            )

    def test_options_localhost_dev_retourne_200(self):
        """Preflight depuis localhost:3000 (dev) → 200."""
        resp = options(DEV_ORIGIN)
        assert resp.status_code == 200, (
            f"localhost:3000 refusé: {resp.status_code} {resp.text}"
        )

    def test_options_localhost_dev_acao_correct(self):
        """Preflight localhost:3000 → access-control-allow-origin = http://localhost:3000."""
        resp = options(DEV_ORIGIN)
        acao = resp.headers.get("access-control-allow-origin", "")
        assert acao == DEV_ORIGIN, f"ACAO attendu: {DEV_ORIGIN!r}, obtenu: {acao!r}"


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-11-2] Preflight depuis une origine inconnue → bloqué
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC11_PreflightBloqué:

    def test_options_evil_retourne_400(self):
        """Preflight depuis evil.com → 400 Disallowed CORS origin."""
        resp = options(EVIL_ORIGIN)
        assert resp.status_code == 400, (
            f"Attendu 400 pour origin inconnue, obtenu {resp.status_code}: {resp.text}"
        )

    def test_options_evil_corps_disallowed(self):
        """Preflight evil.com → corps = 'Disallowed CORS origin'."""
        resp = options(EVIL_ORIGIN)
        assert "disallowed" in resp.text.lower(), (
            f"Corps attendu contenant 'Disallowed': {resp.text!r}"
        )

    def test_options_evil_pas_acao_header(self):
        """Preflight evil.com → access-control-allow-origin ABSENT ou vide."""
        resp = options(EVIL_ORIGIN)
        acao = resp.headers.get("access-control-allow-origin", "")
        assert acao == "", (
            f"access-control-allow-origin NE DOIT PAS être présent pour evil.com, obtenu: {acao!r}"
        )

    def test_acao_jamais_wildcard(self):
        """Aucune réponse (autorisé ou non) ne doit retourner access-control-allow-origin: *."""
        for origin in [ALLOWED_ORIGIN, DEV_ORIGIN, EVIL_ORIGIN]:
            resp = options(origin)
            acao = resp.headers.get("access-control-allow-origin", "")
            assert acao != "*", (
                f"CRITIQUE: access-control-allow-origin='*' retourné pour origin={origin!r} "
                f"(incompatible avec credentials)"
            )


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-11-3] Requêtes GET normales — non cassées par le changement
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC11_RequêtesGET:

    def test_get_sans_origin_retourne_200(self):
        """GET sans header Origin → toujours 200 (appels natifs mobiles, curl, etc.)."""
        resp = httpx.get(f"{API_URL}/api/domains", timeout=10)
        assert resp.status_code == 200, f"GET /api/domains échoué: {resp.status_code}"

    def test_get_avec_origine_autorisee_retourne_200_et_acao(self):
        """GET depuis une origine autorisée → 200 + access-control-allow-origin correct."""
        resp = get_with_origin(ALLOWED_ORIGIN)
        assert resp.status_code == 200, f"GET échoué: {resp.status_code}"
        acao = resp.headers.get("access-control-allow-origin", "")
        assert acao == ALLOWED_ORIGIN, f"ACAO attendu: {ALLOWED_ORIGIN!r}, obtenu: {acao!r}"

    def test_get_avec_localhost_retourne_200_et_acao(self):
        """GET depuis localhost:3000 → 200 + ACAO correct."""
        resp = get_with_origin(DEV_ORIGIN)
        assert resp.status_code == 200, f"GET depuis localhost:3000 échoué"
        assert resp.headers.get("access-control-allow-origin", "") == DEV_ORIGIN

    def test_login_api_fonctionne(self):
        """L'API d'authentification n'est pas cassée."""
        import uuid as _uuid
        # IP unique pour ne pas être bloqué par les tests de rate limit
        unique_ip = (
            f"10.{_uuid.uuid4().int % 254 + 1}"
            f".{_uuid.uuid4().int % 254 + 1}"
            f".{_uuid.uuid4().int % 254 + 1}"
        )
        resp = httpx.post(
            f"{API_URL}/api/auth/login",
            json={"email": "user@winek.app", "password": "WinekUser2024!"},
            headers={"X-Forwarded-For": unique_ip},
            timeout=10,
        )
        assert resp.status_code == 200, f"Login échoué: {resp.status_code} {resp.text}"
        assert "token" in resp.json(), "Champ 'token' absent de la réponse login"


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-11-4] Analyse statique de server.py
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC11_StaticAnalysis:

    @classmethod
    def _src(cls) -> str:
        with open("/app/backend/server.py", encoding="utf-8") as f:
            return f.read()

    def test_pas_de_wildcard_allow_origins(self):
        """server.py ne doit PAS contenir allow_origins=[\"*\"]."""
        src = self._src()
        assert 'allow_origins=["*"]' not in src, \
            'FAIL: allow_origins=["*"] encore présent dans server.py'
        assert "allow_origins=['*']" not in src, \
            "FAIL: allow_origins=['*'] encore présent dans server.py"

    def test_allowed_origins_depuis_env(self):
        """server.py doit lire ALLOWED_ORIGINS depuis os.environ."""
        src = self._src()
        assert "ALLOWED_ORIGINS" in src, \
            "FAIL: ALLOWED_ORIGINS non référencé dans server.py"
        assert 'os.environ.get("ALLOWED_ORIGINS"' in src or \
               "os.environ.get('ALLOWED_ORIGINS'" in src, \
            "FAIL: os.environ.get(\"ALLOWED_ORIGINS\") absent"

    def test_allow_credentials_true(self):
        """server.py doit avoir allow_credentials=True."""
        src = self._src()
        assert "allow_credentials=True" in src, \
            "FAIL: allow_credentials=True absent"

    def test_methodes_explicites_pas_wildcard(self):
        """allow_methods ne doit pas être [\"*\"]."""
        src = self._src()
        assert 'allow_methods=["*"]' not in src, \
            'FAIL: allow_methods=["*"] encore présent'
        assert "allow_methods=['*']" not in src, \
            "FAIL: allow_methods=['*'] encore présent"
        assert "allow_methods" in src, "FAIL: allow_methods absent"

    def test_headers_explicites_pas_wildcard(self):
        """allow_headers ne doit pas être [\"*\"]."""
        src = self._src()
        assert 'allow_headers=["*"]' not in src, \
            'FAIL: allow_headers=["*"] encore présent'
        assert "allow_headers=['*']" not in src, \
            "FAIL: allow_headers=['*'] encore présent"
        assert "Authorization" in src, \
            "FAIL: Authorization absent de allow_headers"

    def test_env_example_contient_allowed_origins(self):
        """.env.example documente ALLOWED_ORIGINS."""
        example_path = "/app/backend/.env.example"
        assert os.path.exists(example_path), "FAIL: .env.example absent"
        with open(example_path) as f:
            content = f.read()
        assert "ALLOWED_ORIGINS" in content, \
            "FAIL: ALLOWED_ORIGINS absent de .env.example"
