"""
Tests E2E - Écran SpotMe (Mes SpotYous), Planning et Profil étendu
- SpotMe: liste se charge, cards visibles, members-chip ouvre modal, going-btn → confirm modal
- Planning: accessible depuis profil, affiche des filtres/événements
- Profile: edit-profile-btn accessible, coach voit my-tp-nav-btn
"""
import pytest
from playwright.sync_api import Page
from conftest import APP_URL, DEFAULT_TIMEOUT, NAV_TIMEOUT, login_fast, navigate_to_tab


# ─── SpotMe Screen ────────────────────────────────────────────────────────────

class TestSpotMeScreen:
    """Tests pour l'écran /spot-me (Mes SpotYous créés)"""

    def test_spotme_loads_with_add_button(self, page: Page):
        """L'écran Mes SpotMe se charge avec le bouton d'ajout (add-spotyou-btn)."""
        login_fast(page, "coach")
        page.goto(f"{APP_URL}/spot-me", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="add-spotyou-btn"]', timeout=DEFAULT_TIMEOUT)
        assert page.locator('[data-testid="add-spotyou-btn"]').is_visible(), \
            "Le bouton add-spotyou-btn DOIT être visible sur la page Mes SpotMe"

    def test_spotme_shows_coach_cards(self, page: Page):
        """Les cards my-tp-* (SpotYous créés) sont visibles pour le coach."""
        login_fast(page, "coach")
        page.goto(f"{APP_URL}/spot-me", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(3000)
        cards_count = page.locator('[data-testid^="my-tp-"]').count()
        assert cards_count > 0, \
            f"Au moins une card my-tp-* DOIT être visible pour le coach (trouvé: {cards_count})"

    def test_spotme_back_button_works(self, page: Page):
        """Le bouton retour (back-btn) fonctionne."""
        login_fast(page, "coach")
        page.goto(f"{APP_URL}/spot-me", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="back-btn"]', timeout=DEFAULT_TIMEOUT)
        assert page.locator('[data-testid="back-btn"]').is_visible(), \
            "Le bouton retour (back-btn) DOIT être visible"

    def test_spotme_members_chip_opens_modal(self, page: Page):
        """Cliquer sur le chip membres (members-chip-*) ouvre le modal liste des membres."""
        login_fast(page, "coach")
        page.goto(f"{APP_URL}/spot-me", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(3000)
        first_chip = page.locator('[data-testid^="members-chip-"]').first
        if first_chip.count() == 0 or not first_chip.is_visible():
            pytest.skip("Aucun chip membres disponible sur la page SpotMe")
        first_chip.click()
        page.wait_for_timeout(1500)
        assert page.locator('[data-testid="close-members-modal"]').is_visible(), \
            "Le modal membres DOIT s'ouvrir avec un bouton de fermeture (close-members-modal)"
        # Fermer le modal
        page.locator('[data-testid="close-members-modal"]').click()
        page.wait_for_timeout(500)

    def test_spotme_going_btn_shows_confirm_modal(self, page: Page):
        """Cliquer sur le bouton Je participe (going-btn-*) affiche un modal de confirmation."""
        login_fast(page, "coach")
        page.goto(f"{APP_URL}/spot-me", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(3000)
        first_going = page.locator('[data-testid^="going-btn-"]').first
        if first_going.count() == 0 or not first_going.is_visible():
            pytest.skip("Aucun bouton Je participe (going-btn-*) visible sur la page SpotMe")
        first_going.click()
        page.wait_for_timeout(1500)
        assert (
            page.locator('[data-testid="confirm-modal-confirm"]').is_visible()
            or page.locator('[data-testid="confirm-modal-cancel"]').is_visible()
        ), "Un modal de confirmation DOIT s'afficher après clic sur Je participe"
        # Annuler pour ne pas changer l'état
        cancel = page.locator('[data-testid="confirm-modal-cancel"]')
        if cancel.is_visible():
            cancel.click()
        page.wait_for_timeout(500)

    def test_spotme_card_navigates_to_detail(self, page: Page):
        """Cliquer sur une card my-tp-* navigue vers le détail du SpotYou."""
        login_fast(page, "coach")
        page.goto(f"{APP_URL}/spot-me", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(3000)
        first_card = page.locator('[data-testid^="my-tp-"]').first
        if first_card.count() == 0 or not first_card.is_visible():
            pytest.skip("Aucune card SpotMe disponible")
        first_card.click()
        page.wait_for_timeout(3000)
        # Doit naviguer vers la page détail (owner voit owner-action-bar)
        assert (
            page.locator('[data-testid="owner-action-bar"]').is_visible()
            or page.locator('[data-testid="fab-vote"]').is_visible()
            or "spot-you" in page.url
        ), "Clic sur card SpotMe doit naviguer vers la page détail"


# ─── Planning Screen ──────────────────────────────────────────────────────────

class TestPlanningScreen:
    """Tests pour l'écran /planning (Planning des séances)"""

    def test_planning_accessible_from_profile_nav_btn(self, page: Page):
        """Le planning est accessible depuis le profil via planning-nav-btn."""
        login_fast(page, "user")
        navigate_to_tab(page, "profile")
        page.wait_for_selector('[data-testid="planning-nav-btn"]', timeout=DEFAULT_TIMEOUT)
        planning_btn = page.locator('[data-testid="planning-nav-btn"]')
        assert planning_btn.is_visible(), \
            "Le bouton planning-nav-btn DOIT être visible dans le profil"
        planning_btn.click()
        page.wait_for_timeout(3000)
        # Vérifier qu'on est sur la page planning
        assert (
            page.locator('[data-testid="filter-all"]').is_visible()
            or page.locator('[data-testid="back-btn"]').is_visible()
            or "/planning" in page.url
        ), "La page planning DOIT être accessible depuis le profil"

    def test_planning_shows_filter_buttons(self, page: Page):
        """La page planning affiche les boutons de filtrage (Tout/Événements/Réservations)."""
        login_fast(page, "user")
        page.goto(f"{APP_URL}/planning", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(3000)
        assert page.locator('[data-testid="filter-all"]').is_visible(), \
            "Bouton filtre 'Tout' (filter-all) DOIT être visible"
        assert page.locator('[data-testid="filter-events"]').is_visible(), \
            "Bouton filtre 'Événements' (filter-events) DOIT être visible"
        assert page.locator('[data-testid="filter-bookings"]').is_visible(), \
            "Bouton filtre 'Réservations' (filter-bookings) DOIT être visible"

    def test_planning_filter_buttons_clickable(self, page: Page):
        """Les boutons de filtrage du planning sont cliquables sans erreur."""
        login_fast(page, "user")
        page.goto(f"{APP_URL}/planning", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="filter-all"]', timeout=DEFAULT_TIMEOUT)
        # Cliquer sur chaque filtre
        page.locator('[data-testid="filter-events"]').click()
        page.wait_for_timeout(500)
        page.locator('[data-testid="filter-bookings"]').click()
        page.wait_for_timeout(500)
        page.locator('[data-testid="filter-all"]').click()
        page.wait_for_timeout(500)
        # Pas d'erreur → test réussi
        error_elements = page.query_selector_all('.error, [class*="error"], [id*="error"]')
        errors_visible = [e for e in error_elements if e.is_visible()]
        assert len(errors_visible) == 0, "Aucune erreur après clic sur les filtres du planning"


# ─── Profil étendu ────────────────────────────────────────────────────────────

class TestProfileExtended:
    """Tests étendus du profil utilisateur"""

    def test_edit_profile_btn_accessible_via_hero(self, page: Page):
        """Le bouton edit-profile-btn est accessible depuis la page /user/[id]."""
        login_fast(page, "user")
        navigate_to_tab(page, "profile")
        page.wait_for_selector('[data-testid="profile-hero"]', timeout=DEFAULT_TIMEOUT)
        # Cliquer sur le hero profile navigue vers /user/[id]
        page.locator('[data-testid="profile-hero"]').click()
        page.wait_for_timeout(2000)
        # Le bouton edit-profile-btn doit être visible sur la page user
        assert page.locator('[data-testid="edit-profile-btn"]').is_visible(), \
            "Le bouton edit-profile-btn DOIT être visible sur la page /user/[id] (propre profil)"

    def test_coach_profile_shows_my_tp_nav_btn(self, page: Page):
        """Le profil coach affiche le bouton 'Mes SpotMe' (my-tp-nav-btn)."""
        login_fast(page, "coach")
        navigate_to_tab(page, "profile")
        page.wait_for_selector('[data-testid="my-tp-nav-btn"]', timeout=DEFAULT_TIMEOUT)
        assert page.locator('[data-testid="my-tp-nav-btn"]').is_visible(), \
            "Le bouton my-tp-nav-btn DOIT être visible dans le profil coach"

    def test_user_profile_shows_my_tp_nav_btn(self, page: Page):
        """Le profil utilisateur affiche également le bouton 'Mes SpotMe'."""
        login_fast(page, "user")
        navigate_to_tab(page, "profile")
        page.wait_for_selector('[data-testid="my-tp-nav-btn"]', timeout=DEFAULT_TIMEOUT)
        assert page.locator('[data-testid="my-tp-nav-btn"]').is_visible(), \
            "Le bouton my-tp-nav-btn DOIT être visible dans le profil utilisateur"

    def test_profile_quick_actions_grid_visible(self, page: Page):
        """Les 3 boutons d'actions rapides (Enregistrés, SpotMe, Planning) sont visibles."""
        login_fast(page, "user")
        navigate_to_tab(page, "profile")
        page.wait_for_selector('[data-testid="saved-nav-btn"]', timeout=DEFAULT_TIMEOUT)
        assert page.locator('[data-testid="saved-nav-btn"]').is_visible(), \
            "Bouton Enregistrés (saved-nav-btn) DOIT être visible"
        assert page.locator('[data-testid="my-tp-nav-btn"]').is_visible(), \
            "Bouton Mes SpotMe (my-tp-nav-btn) DOIT être visible"
        assert page.locator('[data-testid="planning-nav-btn"]').is_visible(), \
            "Bouton Planning (planning-nav-btn) DOIT être visible"
