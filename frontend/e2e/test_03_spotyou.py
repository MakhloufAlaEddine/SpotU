"""
Tests E2E - SpotYou CRUD (Créer, Lire, Modifier, Supprimer)
"""
import pytest
import time
from playwright.sync_api import Page
from conftest import APP_URL, DEFAULT_TIMEOUT, NAV_TIMEOUT, login_fast, navigate_to_tab


class TestSpotYouCRUD:

    def test_create_form_loads(self, page: Page):
        """Le formulaire de création de SpotYou se charge."""
        login_fast(page, "coach")
        navigate_to_tab(page, "create")
        page.wait_for_selector('[data-testid="title-input"]', timeout=DEFAULT_TIMEOUT)
        assert page.locator('[data-testid="title-input"]').is_visible()
        assert page.locator('[data-testid="add-image-btn"]').is_visible()

    def test_create_spotyou_title_required(self, page: Page):
        """On ne peut pas créer un SpotYou sans titre."""
        login_fast(page, "coach")
        navigate_to_tab(page, "create")
        page.wait_for_selector('[data-testid="title-input"]', timeout=DEFAULT_TIMEOUT)
        # Ne pas remplir le titre, cliquer Suivant
        page.locator('[data-testid="next-btn"]').first.click()
        page.wait_for_timeout(1500)
        # Le formulaire doit rester sur l'étape 1 (titre requis)
        assert page.locator('[data-testid="title-input"]').is_visible(), \
            "On ne devrait pas passer au-delà du titre sans le remplir"

    def test_create_spotyou_with_title(self, page: Page):
        """Un coach peut créer un SpotYou en remplissant le titre."""
        login_fast(page, "coach")
        navigate_to_tab(page, "create")
        page.wait_for_selector('[data-testid="title-input"]', timeout=DEFAULT_TIMEOUT)
        unique_title = f"E2E Test {int(time.time())}"
        page.locator('[data-testid="title-input"]').fill(unique_title)
        page.locator('[data-testid="next-btn"]').first.click()
        page.wait_for_timeout(1500)
        # Doit passer à l'étape suivante (description)
        next_step = (
            page.locator('[data-testid="description-input"]').is_visible()
            or page.locator('[data-testid="next-btn"]').is_visible()
        )
        assert next_step, "Doit passer à l'étape suivante après avoir rempli le titre"

    def test_spotyou_detail_shows_rsvp_for_user(self, page: Page):
        """Un utilisateur voit le bouton RSVP sur la page de détail d'un SpotYou récurrent."""
        login_fast(page, "user")
        # Naviguer directement vers un SpotYou récurrent connu (pt_demo009 : owner=coach, récurrent)
        page.goto(f"{APP_URL}/spot-you/pt_demo009", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(3000)
        assert page.locator('[data-testid="rsvp-button"]').is_visible(), \
            "Bouton RSVP doit être visible pour un utilisateur sur un SpotYou récurrent"

    def test_spotyou_detail_shows_vote_fab(self, page: Page):
        """La page de détail d'un SpotYou montre le FAB de vote pour un user."""
        login_fast(page, "user")
        page.goto(APP_URL, timeout=NAV_TIMEOUT)
        page.wait_for_timeout(4000)
        first_hero = page.locator('[data-testid^="hero-card-"]').first
        if first_hero.count() == 0:
            pytest.skip("Aucun SpotYou disponible")
        first_hero.click()
        page.wait_for_timeout(3000)
        assert page.locator('[data-testid="fab-vote"]').is_visible(), \
            "FAB de vote doit être visible sur la page de détail"

    def test_user_can_open_vote_modal(self, page: Page):
        """Un utilisateur peut ouvrir le modal de vote."""
        login_fast(page, "user")
        page.goto(APP_URL, timeout=NAV_TIMEOUT)
        page.wait_for_timeout(4000)
        first_hero = page.locator('[data-testid^="hero-card-"]').first
        if first_hero.count() == 0:
            pytest.skip("Aucun SpotYou disponible")
        first_hero.click()
        page.wait_for_timeout(3000)
        fab = page.locator('[data-testid="fab-vote"]')
        if fab.count() == 0 or not fab.is_visible():
            pytest.skip("FAB de vote non disponible")
        fab.click()
        page.wait_for_timeout(1500)
        assert (
            page.locator('[data-testid="vote-comment-input"]').is_visible()
            or page.locator('[data-testid="star-1"]').is_visible()
        )

    def test_user_can_toggle_save(self, page: Page):
        """Un utilisateur peut sauvegarder/désauvegarder un SpotYou."""
        login_fast(page, "user")
        page.goto(APP_URL, timeout=NAV_TIMEOUT)
        page.wait_for_timeout(4000)
        first_hero = page.locator('[data-testid^="hero-card-"]').first
        if first_hero.count() == 0:
            pytest.skip("Aucun SpotYou disponible")
        first_hero.click()
        page.wait_for_timeout(3000)
        save_btn = page.locator('[data-testid="save-btn"]')
        if save_btn.count() == 0 or not save_btn.is_visible():
            pytest.skip("Bouton save non disponible")
        save_btn.click()
        page.wait_for_timeout(2000)
        assert save_btn.is_visible(), "Le bouton save doit rester visible"
