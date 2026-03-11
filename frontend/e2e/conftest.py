"""
Fixtures et helpers partagés pour les tests E2E Playwright de SpotU.
"""
import pytest
import requests
import os
from playwright.sync_api import Page

# ─── Configuration ─────────────────────────────────────────────────────────────
APP_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://connection-shield-1.preview.emergentagent.com")
API_URL = APP_URL

CREDENTIALS = {
    "admin":  {"email": "admin@winek.app",  "password": "WinekAdmin2024!"},
    "coach":  {"email": "coach@winek.app",  "password": "WinekCoach2024!"},
    "user":   {"email": "user@winek.app",   "password": "WinekUser2024!"},
}

DEFAULT_TIMEOUT = 30_000   # ms
NAV_TIMEOUT    = 45_000   # ms pour les navigations importantes

# Cache des tokens pour éviter le rate-limiting
_token_cache: dict = {}


# ─── Helpers ───────────────────────────────────────────────────────────────────

def get_token(role: str = "user") -> str:
    """Obtient (et met en cache) un JWT via l'API backend."""
    if role in _token_cache:
        return _token_cache[role]
    creds = CREDENTIALS[role]
    resp = requests.post(f"{API_URL}/api/auth/login", json=creds, timeout=15)
    resp.raise_for_status()
    token = resp.json()["token"]
    _token_cache[role] = token
    return token


def login_fast(page: Page, role: str = "user") -> None:
    """
    Connexion rapide via injection du token JWT dans localStorage.
    Évite l'interface de connexion (et le rate-limiter).
    """
    token = get_token(role)
    # Naviguer vers l'app pour établir le contexte
    page.goto(APP_URL, timeout=NAV_TIMEOUT)
    # Attendre que l'app charge (splash screen ~1.8s)
    page.wait_for_timeout(2000)
    # Injecter le token JWT dans localStorage
    page.evaluate(f'localStorage.setItem("spotu_token", "{token}")')
    # Recharger pour déclencher checkAuth()
    page.reload(timeout=NAV_TIMEOUT)
    # Attendre la redirection vers la carte
    page.wait_for_selector('[data-testid="header-search-btn"]', timeout=NAV_TIMEOUT)


def login_via_ui(page: Page, role: str = "user") -> None:
    """Connexion via l'interface utilisateur (pour tester le flux de login)."""
    creds = CREDENTIALS[role]
    page.goto(APP_URL, timeout=NAV_TIMEOUT)
    page.wait_for_selector('[data-testid="email-input"]', timeout=NAV_TIMEOUT)
    page.locator('[data-testid="email-input"]').first.fill(creds["email"])
    page.locator('[data-testid="password-input"]').first.fill(creds["password"])
    page.locator('[data-testid="login-btn"]').first.click()
    # Attendre la navigation vers la carte
    page.wait_for_selector('[data-testid="header-search-btn"]', timeout=NAV_TIMEOUT)


def navigate_to_tab(page: Page, tab: str) -> None:
    """Navigue directement vers un onglet par URL (plus fiable que cliquer le tab bar)."""
    tab_urls = {
        "home":     APP_URL,
        "chat":     f"{APP_URL}/chat",
        "create":   f"{APP_URL}/create",
        "bookings": f"{APP_URL}/bookings",
        "profile":  f"{APP_URL}/profile",
        "search":   f"{APP_URL}/search",
    }
    url = tab_urls.get(tab, f"{APP_URL}/{tab}")
    page.goto(url, timeout=NAV_TIMEOUT)
    page.wait_for_timeout(2000)


# Alias pour compatibilité
login = login_fast


# ─── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="function")
def logged_in_page(page: Page) -> Page:
    """Page déjà connectée avec le compte user."""
    login_fast(page, "user")
    return page


@pytest.fixture(scope="function")
def logged_in_coach_page(page: Page) -> Page:
    """Page déjà connectée avec le compte coach."""
    login_fast(page, "coach")
    return page


@pytest.fixture(scope="function")
def logged_in_admin_page(page: Page) -> Page:
    """Page déjà connectée avec le compte admin."""
    login_fast(page, "admin")
    return page
