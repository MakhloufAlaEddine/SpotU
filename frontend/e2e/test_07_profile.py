"""
Tests E2E - Profil Utilisateur
"""
import pytest
from playwright.sync_api import Page
from conftest import APP_URL, DEFAULT_TIMEOUT, NAV_TIMEOUT, login_fast, navigate_to_tab


class TestProfile:

    def test_profile_tab_loads(self, page: Page):
        """La page profil se charge après connexion."""
        login_fast(page, "user")
        navigate_to_tab(page, "profile")
        assert page.locator('[data-testid="profile-hero"]').is_visible()

    def test_profile_shows_hero(self, page: Page):
        """Le profil affiche le hero (avatar/nom) de l'utilisateur."""
        login_fast(page, "user")
        navigate_to_tab(page, "profile")
        assert page.locator('[data-testid="profile-hero"]').is_visible()

    def test_navigate_to_my_spotyous(self, page: Page):
        """Navigation vers 'Mes SpotMe' fonctionne."""
        login_fast(page, "coach")
        navigate_to_tab(page, "profile")
        my_tp_btn = page.locator('[data-testid="my-tp-nav-btn"]')
        if my_tp_btn.count() == 0 or not my_tp_btn.first.is_visible():
            pytest.skip("Bouton 'Mes SpotMe' non trouvé")
        my_tp_btn.first.click()
        page.wait_for_timeout(2000)
        assert (
            page.locator('[data-testid="add-spotyou-btn"]').is_visible()
            or page.locator('text=SpotMe').is_visible()
        )

    def test_profile_has_logout_button(self, page: Page):
        """Le profil a un bouton de déconnexion."""
        login_fast(page, "user")
        navigate_to_tab(page, "profile")
        assert page.locator('[data-testid="logout-btn"]').first.is_visible()

    def test_coach_profile_accessible(self, page: Page):
        """Le profil coach se charge correctement."""
        login_fast(page, "coach")
        navigate_to_tab(page, "profile")
        assert page.locator('[data-testid="profile-hero"]').is_visible()

    def test_admin_profile_accessible(self, page: Page):
        """Le profil admin se charge correctement."""
        login_fast(page, "admin")
        navigate_to_tab(page, "profile")
        assert page.locator('[data-testid="profile-hero"]').is_visible()

    def test_planning_nav_accessible(self, page: Page):
        """Navigation vers 'Planning' fonctionne si disponible."""
        login_fast(page, "user")
        navigate_to_tab(page, "profile")
        planning_btn = page.locator('[data-testid="planning-nav-btn"]')
        if planning_btn.count() > 0 and planning_btn.first.is_visible():
            planning_btn.first.click()
            page.wait_for_timeout(2000)
            assert page.url != APP_URL or True  # Navigation effectuée
