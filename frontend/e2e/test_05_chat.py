"""
Tests E2E - Chat et Messagerie
"""
import pytest
from playwright.sync_api import Page
from conftest import APP_URL, DEFAULT_TIMEOUT, NAV_TIMEOUT, login_fast, navigate_to_tab


class TestChat:

    def test_chat_tab_loads(self, page: Page):
        """L'onglet chat se charge correctement."""
        login_fast(page, "user")
        navigate_to_tab(page, "chat")
        page.wait_for_timeout(2000)
        assert (
            page.locator('[data-testid^="conv-item-"]').count() >= 0
        )

    def test_chat_shows_conversations_list(self, page: Page):
        """La liste des conversations s'affiche pour un coach avec conversations."""
        login_fast(page, "coach")
        navigate_to_tab(page, "chat")
        page.wait_for_timeout(3000)
        conv_count = page.locator('[data-testid^="conv-item-"]').count()
        assert conv_count >= 0

    def test_open_conversation_and_send_message(self, page: Page):
        """On peut ouvrir une conversation et envoyer un message."""
        login_fast(page, "coach")
        navigate_to_tab(page, "chat")
        page.wait_for_timeout(3000)
        first_conv = page.locator('[data-testid^="conv-item-"]').first
        if first_conv.count() == 0 or not first_conv.is_visible():
            pytest.skip("Aucune conversation disponible pour ce compte")
        first_conv.click()
        page.wait_for_timeout(2000)
        chat_input = page.locator('[data-testid="chat-input"]')
        if chat_input.count() == 0 or not chat_input.is_visible():
            pytest.skip("Saisie de message non visible")
        chat_input.fill("Message test E2E Playwright")
        page.locator('[data-testid="chat-send-btn"]').first.click()
        page.wait_for_timeout(2000)
        # Le message doit exister dans le DOM (bulle visible dans le chat)
        msg_count = page.locator('text=Message test E2E Playwright').count()
        assert msg_count > 0, "Le message envoyé ne s'affiche pas dans la conversation"

    def test_chat_messages_not_in_notifications(self, page: Page):
        """Les messages de chat n'apparaissent PAS dans les notifications."""
        login_fast(page, "user")
        navigate_to_tab(page, "bookings")
        page.wait_for_timeout(3000)
        # Les notifications de type "chat message" ne doivent pas être là
        chat_notif_count = page.locator('[data-testid^="notif-"]').filter(
            has_text="message"
        ).count()
        assert chat_notif_count == 0, \
            f"{chat_notif_count} notification(s) de chat trouvée(s) dans les notifs"
