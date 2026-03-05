"""
Tests E2E - Authentification (Login, Register, Logout)
"""
import pytest
from playwright.sync_api import Page
from conftest import APP_URL, DEFAULT_TIMEOUT, NAV_TIMEOUT, login_via_ui, login_fast, navigate_to_tab


class TestAuthentication:

    def test_login_as_user_via_ui(self, page: Page):
        """Un utilisateur peut se connecter via l'interface et accéder à l'accueil."""
        login_via_ui(page, "user")
        assert page.locator('[data-testid="header-search-btn"]').is_visible()

    def test_coach_token_gives_access(self, page: Page):
        """Un token coach valide donne accès à l'application."""
        login_fast(page, "coach")
        assert page.locator('[data-testid="header-search-btn"]').is_visible()

    def test_login_wrong_password(self, page: Page):
        """Une mauvaise connexion reste sur la page de login."""
        page.goto(APP_URL, timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="email-input"]', timeout=NAV_TIMEOUT)
        page.locator('[data-testid="email-input"]').first.fill("user@winek.app")
        page.locator('[data-testid="password-input"]').first.fill("WrongPassword123!")
        page.locator('[data-testid="login-btn"]').first.click()
        page.wait_for_timeout(4000)
        assert page.locator('[data-testid="login-btn"]').first.is_visible(), \
            "Ne devrait pas être redirigé avec un mauvais mot de passe"

    def test_login_empty_fields(self, page: Page):
        """La connexion sans données ne plante pas l'app."""
        page.goto(APP_URL, timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="login-btn"]', timeout=NAV_TIMEOUT)
        page.locator('[data-testid="login-btn"]').first.click()
        page.wait_for_timeout(2000)
        assert page.locator('[data-testid="login-btn"]').first.is_visible()

    def test_navigate_to_register_and_check_fields(self, page: Page):
        """La page d'inscription contient tous les champs requis."""
        page.goto(APP_URL, timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="go-register"]', timeout=NAV_TIMEOUT)
        page.locator('[data-testid="go-register"]').first.click()
        page.wait_for_selector('[data-testid="register-btn"]', timeout=DEFAULT_TIMEOUT)
        # Vérifier les champs UNIQUES à la page d'inscription
        assert page.locator('[data-testid="name-input"]').first.is_visible(), \
            "Champ 'nom' non visible sur la page d'inscription"
        assert page.locator('[data-testid="register-btn"]').first.is_visible(), \
            "Bouton 'register' non visible"
        assert page.locator('[data-testid="go-login"]').first.is_visible(), \
            "Lien 'aller à login' non visible"

    def test_logout(self, page: Page):
        """Un utilisateur peut se déconnecter."""
        login_fast(page, "user")
        # Naviguer directement vers le profil
        navigate_to_tab(page, "profile")
        page.wait_for_selector('[data-testid="logout-btn"]', timeout=DEFAULT_TIMEOUT)
        page.locator('[data-testid="logout-btn"]').first.click()
        # Après déconnexion, retour sur la page de login
        page.wait_for_selector('[data-testid="login-btn"]', timeout=NAV_TIMEOUT)
        assert page.locator('[data-testid="login-btn"]').first.is_visible()
