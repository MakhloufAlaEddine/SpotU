"""
Tests E2E - Page d'accueil / Découverte
"""
import pytest
from playwright.sync_api import Page
from conftest import APP_URL, DEFAULT_TIMEOUT, NAV_TIMEOUT, login_fast, navigate_to_tab


class TestHomeDiscovery:

    def test_home_screen_loads_after_login(self, page: Page):
        """L'écran d'accueil se charge après connexion."""
        login_fast(page, "user")
        assert page.locator('[data-testid="header-search-btn"]').is_visible()

    def test_spotyous_displayed_on_home(self, page: Page):
        """Les SpotYous ou services sont visibles sur l'écran d'accueil."""
        login_fast(page, "user")
        page.wait_for_timeout(4000)
        hero_count  = page.locator('[data-testid^="hero-card-"]').count()
        recent_count = page.locator('[data-testid^="recent-row-"]').count()
        assert hero_count > 0 or recent_count > 0, \
            "Aucun SpotYou trouvé sur la page d'accueil"

    def test_search_button_navigates_to_search(self, page: Page):
        """Le bouton de recherche navigue vers la page de recherche."""
        login_fast(page, "user")
        page.wait_for_selector('[data-testid="header-search-btn"]', timeout=NAV_TIMEOUT)
        page.locator('[data-testid="header-search-btn"]').click()
        page.wait_for_timeout(2000)
        assert (
            page.locator('[data-testid="tag-search-button"]').is_visible()
            or page.locator('[data-testid="location-text"]').is_visible()
            or page.locator('input[placeholder]').is_visible()
        )

    def test_click_hero_card_navigates_to_detail(self, page: Page):
        """Cliquer sur un SpotYou hero mène à la page de détail."""
        login_fast(page, "user")
        page.wait_for_timeout(4000)
        first_hero = page.locator('[data-testid^="hero-card-"]').first
        if first_hero.count() == 0:
            pytest.skip("Aucun SpotYou hero disponible sur la page d'accueil")
        first_hero.click()
        page.wait_for_timeout(3000)
        assert (
            page.locator('[data-testid="rsvp-button"]').is_visible()
            or page.locator('[data-testid="fab-vote"]').is_visible()
            or page.locator('[data-testid="owner-action-bar"]').is_visible()
        )

    def test_click_recent_row_navigates_to_detail(self, page: Page):
        """Cliquer sur une ligne récente mène à la page de détail."""
        login_fast(page, "user")
        page.wait_for_timeout(4000)
        first_recent = page.locator('[data-testid^="recent-row-"]').first
        if first_recent.count() == 0:
            pytest.skip("Aucun SpotYou récent disponible")
        first_recent.click()
        page.wait_for_timeout(3000)
        assert (
            page.locator('[data-testid="rsvp-button"]').is_visible()
            or page.locator('[data-testid="fab-vote"]').is_visible()
            or page.locator('[data-testid="owner-action-bar"]').is_visible()
        )
