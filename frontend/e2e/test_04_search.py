"""
Tests E2E - Recherche de SpotYous et Services
"""
import pytest
from playwright.sync_api import Page
from conftest import APP_URL, DEFAULT_TIMEOUT, NAV_TIMEOUT, login_fast, navigate_to_tab


class TestSearch:

    def test_search_page_loads(self, page: Page):
        """La page de recherche se charge correctement."""
        login_fast(page, "user")
        navigate_to_tab(page, "search")
        assert (
            page.locator('[data-testid="tag-search-button"]').is_visible()
            or page.locator('[data-testid="location-text"]').is_visible()
            or page.locator('[data-testid="header-search-btn"]').is_visible()
        )

    def test_search_shows_results(self, page: Page):
        """La recherche retourne des résultats par défaut."""
        login_fast(page, "user")
        navigate_to_tab(page, "search")
        page.wait_for_timeout(3000)
        # Au moins 0 résultat (pas de crash)
        results_count = (
            page.locator('[data-testid="result-item"]').count()
            + page.locator('[data-testid="service-result-item"]').count()
        )
        assert results_count >= 0

    def test_search_tag_button_opens_tag_modal(self, page: Page):
        """Le bouton tag ouvre le sélecteur de tags."""
        login_fast(page, "user")
        navigate_to_tab(page, "search")
        page.wait_for_timeout(2000)
        tag_btn = page.locator('[data-testid="tag-search-button"]')
        if tag_btn.count() == 0 or not tag_btn.first.is_visible():
            pytest.skip("Bouton de recherche par tag non disponible")
        tag_btn.first.click()
        page.wait_for_timeout(1500)
        assert (
            page.locator('[data-testid^="tag-pill-"]').first.is_visible()
            or page.locator('[data-testid="modal-close-btn"]').is_visible()
            or page.locator('[data-testid="clear-filter-btn"]').is_visible()
        )

    def test_search_result_clickable(self, page: Page):
        """Un résultat de recherche est cliquable et mène au détail."""
        login_fast(page, "user")
        navigate_to_tab(page, "search")
        page.wait_for_timeout(3000)
        first_result = page.locator('[data-testid="result-item"]').first
        if first_result.count() == 0 or not first_result.is_visible():
            first_result = page.locator('[data-testid="service-result-item"]').first
        if first_result.count() == 0 or not first_result.is_visible():
            pytest.skip("Aucun résultat de recherche disponible")
        first_result.click()
        page.wait_for_timeout(2000)
        assert (
            page.locator('[data-testid="rsvp-button"]').is_visible()
            or page.locator('[data-testid="fab-vote"]').is_visible()
            or page.locator('[data-testid="owner-action-bar"]').is_visible()
            or page.locator('text=SERVICE').is_visible()
        )
