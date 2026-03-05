"""
Tests SEC-03 — Rate Limiting sur les endpoints d'authentification
==================================================================
Stratégie d'isolation :
  Chaque test utilise une IP fictive unique via X-Forwarded-For pour éviter
  toute interférence entre les classes de test (le store est en mémoire,
  partagé par le processus du serveur).

  Limite configurée : 5/minute pour /login et /register, 10/minute pour /google.

Tests couverts :
  1. Les 5 premières requêtes login (mauvais mdp) → 401 (pas 429)
  2. La 6e requête → 429
  3. Réponse 429 contient le champ "error"
  4. Réponse 429 contient le header Retry-After
  5. Une IP différente n'est pas bloquée (isolation correcte)
  6. Register : 5/min par IP → 429 à la 6e
  7. Login valide : 5/min → le login légitime est aussi protégé (429 à la 6e)
  8. GET /api/domains (route non limitée) → jamais 429 quelle que soit la cadence
  9. Analyse statique : décorateurs présents dans auth_routes.py

Usage :
    cd /app/backend
    JWT_SECRET=<secret> python -m pytest tests/test_ratelimit_sec03.py -v
"""
import uuid
import httpx
import pytest

API_URL = "http://localhost:8001"

BAD_CREDS  = {"email": "attacker@evil.com", "password": "wrongpassword123"}
GOOD_CREDS = {"email": "user@winek.app",     "password": "WinekUser2024!"}


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _unique_ip() -> str:
    """Génère une IP de test unique pour isoler chaque suite."""
    r = uuid.uuid4().int
    a, b, c, d = (r >> 24) & 0xFF, (r >> 16) & 0xFF, (r >> 8) & 0xFF, r & 0xFF
    # Range 10.x.x.x — privé, jamais réel
    return f"10.{b}.{c}.{d or 1}"


def _login(ip: str, creds: dict = BAD_CREDS) -> httpx.Response:
    return httpx.post(
        f"{API_URL}/api/auth/login",
        json=creds,
        headers={"X-Forwarded-For": ip},
        timeout=10,
    )


def _register(ip: str, email_suffix: str = "") -> httpx.Response:
    return httpx.post(
        f"{API_URL}/api/auth/register",
        json={
            "email":    f"test_{email_suffix or uuid.uuid4().hex[:8]}@example.com",
            "password": "TestPassword123!",
            "name":     "Test User",
            "language": "fr",
        },
        headers={"X-Forwarded-For": ip},
        timeout=10,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Tests principaux : /api/auth/login
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC03_LoginRateLimit:

    def test_5_requetes_sous_la_limite_pas_429(self):
        """
        SEC-03: Les 5 premières requêtes login depuis une même IP
        ne doivent PAS retourner 429 (elles retournent 401 = mauvais mdp).
        """
        ip = _unique_ip()
        statuses = [_login(ip).status_code for _ in range(5)]
        assert 429 not in statuses, (
            f"429 prématuré avant la limite : statuts = {statuses}"
        )
        assert all(s == 401 for s in statuses), (
            f"Attendu 5×401, obtenu : {statuses}"
        )

    def test_6e_requete_retourne_429(self):
        """
        SEC-03: La 6e requête login depuis la même IP → 429 Too Many Requests.
        """
        ip = _unique_ip()
        # Consommer les 5 crédits
        for _ in range(5):
            _login(ip)
        # La 6e doit être bloquée
        resp = _login(ip)
        assert resp.status_code == 429, (
            f"Attendu 429 (rate limit), obtenu {resp.status_code}: {resp.text}"
        )

    def test_reponse_429_contient_champ_error(self):
        """SEC-03: La réponse 429 doit contenir le champ JSON 'error'."""
        ip = _unique_ip()
        for _ in range(5):
            _login(ip)
        resp = _login(ip)
        assert resp.status_code == 429
        body = resp.json()
        assert "error" in body, f"Champ 'error' absent de la réponse 429: {body}"

    def test_reponse_429_contient_retry_after(self):
        """SEC-03: La réponse 429 doit contenir le header Retry-After."""
        ip = _unique_ip()
        for _ in range(5):
            _login(ip)
        resp = _login(ip)
        assert resp.status_code == 429
        assert "retry-after" in resp.headers, (
            f"Header Retry-After absent. Headers reçus : {dict(resp.headers)}"
        )

    def test_ip_differente_non_bloquee(self):
        """
        SEC-03: Bloquer une IP ne doit pas affecter une autre IP.
        (Isolation correcte par IP.)
        """
        ip_bloquee  = _unique_ip()
        ip_nouvelle = _unique_ip()

        # Bloquer la première IP
        for _ in range(6):
            _login(ip_bloquee)

        # La nouvelle IP doit toujours pouvoir tenter
        resp = _login(ip_nouvelle)
        assert resp.status_code != 429, (
            f"Effet de bord : l'IP {ip_nouvelle} est bloquée alors qu'elle n'a jamais dépassé sa limite"
        )

    def test_login_valide_aussi_rate_limite(self):
        """
        SEC-03: Même un login valide (bon mot de passe) est soumis à la limite.
        Les 5 premiers retournent 200, le 6e doit retourner 429.
        """
        ip = _unique_ip()
        statuses = [_login(ip, GOOD_CREDS).status_code for _ in range(5)]
        assert all(s == 200 for s in statuses), (
            f"Les 5 logins valides auraient dû retourner 200 : {statuses}"
        )
        resp = _login(ip, GOOD_CREDS)
        assert resp.status_code == 429, (
            f"Attendu 429 après 5 logins valides, obtenu {resp.status_code}: {resp.text}"
        )

    def test_requetes_supplementaires_toujours_429(self):
        """SEC-03: Les requêtes au-delà de la 6e restent bloquées (429)."""
        ip = _unique_ip()
        for _ in range(6):
            _login(ip)
        # Les suivantes doivent rester à 429
        statuses = [_login(ip).status_code for _ in range(3)]
        assert all(s == 429 for s in statuses), (
            f"Attendu 429 à la 7e-9e requête, obtenu : {statuses}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# Tests : /api/auth/register
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC03_RegisterRateLimit:

    def test_5_inscriptions_sous_la_limite(self):
        """SEC-03: Les 5 premières tentatives register (sous la limite) ne sont pas 429."""
        ip = _unique_ip()
        # Chaque email est unique pour ne pas déclencher de 400 "already registered"
        statuses = [_register(ip).status_code for _ in range(5)]
        assert 429 not in statuses, (
            f"429 prématuré sur register : {statuses}"
        )

    def test_6e_inscription_retourne_429(self):
        """SEC-03: La 6e tentative register depuis la même IP → 429."""
        ip = _unique_ip()
        for _ in range(5):
            _register(ip)
        resp = _register(ip)
        assert resp.status_code == 429, (
            f"Attendu 429, obtenu {resp.status_code}: {resp.text}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# Test de non-régression : routes non limitées
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC03_NonLimitedRoutes:

    def test_get_domains_jamais_429(self):
        """GET /api/domains n'est pas soumis à un rate limit — ne doit jamais retourner 429."""
        ip = _unique_ip()
        for _ in range(15):
            resp = httpx.get(
                f"{API_URL}/api/domains",
                headers={"X-Forwarded-For": ip},
                timeout=10,
            )
            assert resp.status_code != 429, (
                f"GET /api/domains retourné 429 à tort à la requête #{_ + 1}"
            )


# ═══════════════════════════════════════════════════════════════════════════════
# Analyse statique de auth_routes.py
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC03_StaticAnalysis:

    @classmethod
    def _src(cls) -> str:
        with open("/app/backend/routes/auth_routes.py", encoding="utf-8") as f:
            return f.read()

    def test_import_limiter_present(self):
        """auth_routes.py doit importer limiter."""
        assert "from limiter import limiter" in self._src(), (
            "FAIL: import limiter absent de auth_routes.py"
        )

    def test_decorateur_login_present(self):
        """Décorateur @limiter.limit sur login doit être présent."""
        src = self._src()
        assert '@limiter.limit("5/minute")' in src or "@limiter.limit('5/minute')" in src, (
            'FAIL: @limiter.limit("5/minute") absent sur login'
        )

    def test_decorateur_register_present(self):
        """Décorateur @limiter.limit sur register doit être présent."""
        src = self._src()
        assert '@limiter.limit("5/minute")' in src or "@limiter.limit('5/minute')" in src, (
            'FAIL: @limiter.limit("5/minute") absent sur register'
        )

    def test_decorateur_google_present(self):
        """Décorateur @limiter.limit sur google doit être présent (10/minute)."""
        src = self._src()
        assert '@limiter.limit("10/minute")' in src or "@limiter.limit('10/minute')" in src, (
            'FAIL: @limiter.limit("10/minute") absent sur google'
        )

    def test_request_param_dans_login(self):
        """La fonction login doit avoir request: Request comme premier paramètre."""
        src = self._src()
        import re
        # Chercher la définition de la fonction login
        match = re.search(r"async def login\(([^)]+)\)", src)
        assert match, "FAIL: définition de login non trouvée"
        params = match.group(1)
        assert "Request" in params, (
            f"FAIL: request: Request absent de la signature de login. Paramètres: {params!r}"
        )

    def test_request_param_dans_register(self):
        """La fonction register doit avoir request: Request comme premier paramètre."""
        src = self._src()
        import re
        match = re.search(r"async def register\(([^)]+)\)", src)
        assert match, "FAIL: définition de register non trouvée"
        params = match.group(1)
        assert "Request" in params, (
            f"FAIL: request: Request absent de la signature de register. Paramètres: {params!r}"
        )

    def test_limiter_state_dans_server(self):
        """server.py doit configurer app.state.limiter et le gestionnaire 429."""
        with open("/app/backend/server.py", encoding="utf-8") as f:
            srv = f.read()
        assert "app.state.limiter = limiter" in srv, \
            "FAIL: app.state.limiter absent de server.py"
        assert "RateLimitExceeded" in srv, \
            "FAIL: gestionnaire RateLimitExceeded absent de server.py"
        # Handler custom (remplace _rate_limit_exceeded_handler de slowapi)
        assert "_rate_limit_handler" in srv, \
            "FAIL: _rate_limit_handler (handler 429 custom) absent de server.py"
        assert "Retry-After" in srv, \
            "FAIL: header Retry-After absent du handler 429"
