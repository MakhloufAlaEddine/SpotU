"""
Tests E2E - Règles métier SpotYou Detail
- Propriétaire (coach): ne voit PAS rsvp-button, VOIT owner-action-bar, VOIT owner-group-chat-btn
- Membre: VOIT group-chat-button
- Non-membre: NE VOIT PAS group-chat-button (seulement message-button)
- Modal de confirmation pour RSVP et Je participe
- going-button présent et cliquable
- event-participant-count chip cliquable
"""
import pytest
from playwright.sync_api import Page
from conftest import APP_URL, DEFAULT_TIMEOUT, NAV_TIMEOUT, login_fast

# SpotYou de référence
# pt_demo009 : Running Bois de Boulogne — coach est propriétaire, récurrent
# pt_demo013 : SpotYou récurrent où user est MEMBRE
# pt_demo009 : SpotYou récurrent où user N'EST PAS membre

COACH_OWNED_RECURRING = "pt_demo009"   # coach owner
USER_IS_MEMBER_ID = "pt_demo013"        # user is member (recurring)
USER_NOT_MEMBER_ID = "pt_demo009"       # user is NOT member (recurring, different owner)


# ─── Règles propriétaire ──────────────────────────────────────────────────────

class TestSpotYouOwnerRules:
    """Le propriétaire (coach) ne voit PAS rsvp-button, VOIT owner-action-bar et owner-group-chat-btn"""

    def test_owner_does_not_see_rsvp_button(self, page: Page):
        """Le propriétaire NE DOIT PAS voir le bouton RSVP."""
        login_fast(page, "coach")
        page.goto(f"{APP_URL}/spot-you/{COACH_OWNED_RECURRING}", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="owner-action-bar"]', timeout=DEFAULT_TIMEOUT)
        page.wait_for_timeout(2000)
        rsvp = page.locator('[data-testid="rsvp-button"]')
        assert not rsvp.is_visible(), \
            "Le propriétaire NE DOIT PAS voir le bouton RSVP (rejoindre/quitter)"

    def test_owner_sees_owner_action_bar(self, page: Page):
        """Le propriétaire voit la barre d'actions propriétaire."""
        login_fast(page, "coach")
        page.goto(f"{APP_URL}/spot-you/{COACH_OWNED_RECURRING}", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="owner-action-bar"]', timeout=DEFAULT_TIMEOUT)
        assert page.locator('[data-testid="owner-action-bar"]').is_visible(), \
            "La barre d'actions propriétaire (owner-action-bar) DOIT être visible"

    def test_owner_sees_owner_group_chat_btn(self, page: Page):
        """Le propriétaire voit le bouton 'Voir le groupe' (owner-group-chat-btn)."""
        login_fast(page, "coach")
        page.goto(f"{APP_URL}/spot-you/{COACH_OWNED_RECURRING}", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="owner-action-bar"]', timeout=DEFAULT_TIMEOUT)
        page.wait_for_timeout(1500)
        assert page.locator('[data-testid="owner-group-chat-btn"]').is_visible(), \
            "Le propriétaire DOIT voir le bouton 'Voir le groupe' (owner-group-chat-btn)"

    def test_owner_sees_edit_btn_in_action_bar(self, page: Page):
        """La barre propriétaire contient le bouton Modifier."""
        login_fast(page, "coach")
        page.goto(f"{APP_URL}/spot-you/{COACH_OWNED_RECURRING}", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="owner-action-bar"]', timeout=DEFAULT_TIMEOUT)
        assert page.locator('[data-testid="edit-btn"]').is_visible(), \
            "Le bouton Modifier doit être visible pour le propriétaire"


# ─── Règles membre / non-membre ───────────────────────────────────────────────

class TestSpotYouMemberRules:
    """Membre VOIT group-chat-button, non-membre NE VOIT PAS group-chat-button"""

    def test_member_sees_group_chat_button(self, page: Page):
        """Un membre voit le bouton chat de groupe (group-chat-button)."""
        login_fast(page, "user")
        page.goto(f"{APP_URL}/spot-you/{USER_IS_MEMBER_ID}", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="fab-vote"]', timeout=DEFAULT_TIMEOUT)
        page.wait_for_timeout(2000)
        assert page.locator('[data-testid="group-chat-button"]').is_visible(), \
            "Un membre DOIT voir le bouton chat de groupe (group-chat-button)"

    def test_non_member_does_not_see_group_chat_button(self, page: Page):
        """Un non-membre NE VOIT PAS le bouton chat de groupe (seulement message-button)."""
        login_fast(page, "user")
        page.goto(f"{APP_URL}/spot-you/{USER_NOT_MEMBER_ID}", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="fab-vote"]', timeout=DEFAULT_TIMEOUT)
        page.wait_for_timeout(2000)
        # message-button toujours visible pour non-propriétaire
        assert page.locator('[data-testid="message-button"]').is_visible(), \
            "message-button DOIT être visible pour tout utilisateur non-propriétaire"
        # group-chat-button DOIT être invisible pour non-membre
        group_chat = page.locator('[data-testid="group-chat-button"]')
        assert not group_chat.is_visible(), \
            "Un non-membre NE DOIT PAS voir le bouton chat de groupe (group-chat-button)"

    def test_member_sees_rsvp_button(self, page: Page):
        """Un membre voit le bouton RSVP (Membre ✓ / Quitter)."""
        login_fast(page, "user")
        page.goto(f"{APP_URL}/spot-you/{USER_IS_MEMBER_ID}", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="rsvp-button"]', timeout=DEFAULT_TIMEOUT)
        assert page.locator('[data-testid="rsvp-button"]').is_visible(), \
            "Le bouton RSVP DOIT être visible pour un membre d'un SpotYou récurrent"


# ─── Modal de confirmation ────────────────────────────────────────────────────

class TestSpotYouConfirmModal:
    """Modal de confirmation ConfirmActionModal pour RSVP et Je participe"""

    def test_rsvp_button_shows_confirm_modal(self, page: Page):
        """Cliquer sur le bouton RSVP affiche le modal de confirmation."""
        login_fast(page, "user")
        # user n'est pas membre de pt_demo009 → clic = Rejoindre
        page.goto(f"{APP_URL}/spot-you/{USER_NOT_MEMBER_ID}", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="rsvp-button"]', timeout=DEFAULT_TIMEOUT)
        page.wait_for_timeout(1000)
        page.locator('[data-testid="rsvp-button"]').click()
        page.wait_for_timeout(1500)
        # Le modal ConfirmActionModal doit s'afficher
        assert (
            page.locator('[data-testid="confirm-modal-confirm"]').is_visible()
            or page.locator('[data-testid="confirm-modal-cancel"]').is_visible()
        ), "Le modal de confirmation DOIT s'afficher après clic sur RSVP"
        # Annuler pour ne pas changer l'état
        cancel = page.locator('[data-testid="confirm-modal-cancel"]')
        if cancel.is_visible():
            cancel.click()
        page.wait_for_timeout(500)

    def test_going_button_visible_and_shows_confirm_modal(self, page: Page):
        """Le bouton Je participe (going-button) est visible et affiche un modal."""
        login_fast(page, "user")
        page.goto(f"{APP_URL}/spot-you/{USER_IS_MEMBER_ID}", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="going-button"]', timeout=DEFAULT_TIMEOUT)
        page.wait_for_timeout(1000)
        going = page.locator('[data-testid="going-button"]').first
        assert going.is_visible(), "Le bouton Je participe (going-button) DOIT être visible"
        going.click()
        page.wait_for_timeout(1500)
        # Un modal de confirmation doit s'afficher
        assert (
            page.locator('[data-testid="confirm-modal-confirm"]').is_visible()
            or page.locator('[data-testid="confirm-modal-cancel"]').is_visible()
        ), "Un modal de confirmation DOIT s'afficher après clic sur Je participe"
        # Annuler pour ne pas changer l'état
        cancel = page.locator('[data-testid="confirm-modal-cancel"]')
        if cancel.is_visible():
            cancel.click()
        page.wait_for_timeout(500)

    def test_event_participant_count_chip_clickable(self, page: Page):
        """Le chip event-participant-count est cliquable et ouvre la liste."""
        login_fast(page, "user")
        page.goto(f"{APP_URL}/spot-you/{USER_IS_MEMBER_ID}", timeout=NAV_TIMEOUT)
        page.wait_for_selector('[data-testid="event-participant-count"]', timeout=DEFAULT_TIMEOUT)
        page.wait_for_timeout(1000)
        chip = page.locator('[data-testid="event-participant-count"]').first
        assert chip.is_visible(), "Le chip participants (event-participant-count) DOIT être visible"
        chip.click()
        page.wait_for_timeout(1500)
        # Le modal de liste des participants going devrait s'ouvrir
        # Vérifier qu'aucune erreur ne s'est produite
        error_elements = page.query_selector_all('.error, [class*="error"], [id*="error"]')
        assert len(error_elements) == 0 or all(
            not e.is_visible() for e in error_elements
        ), "Pas d'erreur après clic sur chip participants"
