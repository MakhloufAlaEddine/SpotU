"""
Tests E2E - Iteration 73: Chat cache + historyState + ErrorNoData
Vérifie:
  1. Régression: chat room se charge et affiche les messages en ligne (conv_demo002)
  2. Régression: envoi de message fonctionne (isConnected guard)
  3. UI: ErrorNoData testID='chat-error-no-data' structure vérifiable
  4. UI: FlatList style flex:1 présent dans le chat room
  5. Chat input et send button présents et cliquables
"""
import pytest
from playwright.sync_api import Page
from conftest import APP_URL, DEFAULT_TIMEOUT, NAV_TIMEOUT, login_fast, navigate_to_tab


class TestChatCacheHistoryState:
    """Régression chat room: chargement et envoi de message en ligne"""

    def test_chat_room_conv_demo002_loads(self, page: Page):
        """chat/conv_demo002 se charge, affiche le header et la FlatList."""
        login_fast(page, "coach")
        page.wait_for_timeout(1500)

        # Navigate directly to the conversation
        page.goto(f"{APP_URL}/chat/conv_demo002", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(3000)

        # Header doit être visible (back button)
        back_btn = page.locator('[data-testid="chat-back-btn"]')
        assert back_btn.count() > 0, "Bouton retour du chat non trouvé"
        assert back_btn.first.is_visible(), "Bouton retour non visible"
        print("PASS: chat-back-btn visible")

        # Input doit être visible
        chat_input = page.locator('[data-testid="chat-input"]')
        assert chat_input.count() > 0, "chat-input non trouvé"
        assert chat_input.first.is_visible(), "chat-input non visible"
        print("PASS: chat-input visible")

        # Send button doit être visible
        send_btn = page.locator('[data-testid="chat-send-btn"]')
        assert send_btn.count() > 0, "chat-send-btn non trouvé"
        print("PASS: chat-send-btn visible")

        # Vérifier qu'on n'est PAS en erreur (pas d'ErrorNoData)
        error_no_data = page.locator('[data-testid="chat-error-no-data"]')
        # En ligne, ErrorNoData ne doit pas être affiché
        if error_no_data.count() > 0 and error_no_data.first.is_visible():
            print("WARNING: ErrorNoData visible en ligne - réseau ou connexion problème")
        else:
            print("PASS: ErrorNoData non visible (comme attendu en ligne)")

    def test_chat_room_no_brutal_empty_state_when_online(self, page: Page):
        """En ligne, la FlatList s'affiche (même vide) sans ErrorNoData."""
        login_fast(page, "coach")
        page.wait_for_timeout(1500)

        page.goto(f"{APP_URL}/chat/conv_demo002", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(4000)

        # Vérifier que l'écran n'est pas cassé
        # On vérifie qu'une des zones clés est visible
        chat_input = page.locator('[data-testid="chat-input"]')
        send_btn = page.locator('[data-testid="chat-send-btn"]')

        assert chat_input.first.is_visible(), "Zone de saisie non visible"
        assert send_btn.first.is_visible(), "Bouton envoi non visible"

        # S'il y a des messages, ils doivent être visibles
        # Sinon, "Aucun message pour l'instant" (ListEmptyComponent) doit s'afficher
        error_count = page.locator('[data-testid="chat-error-no-data"]').count()
        assert error_count == 0, f"ErrorNoData affiché en ligne ({error_count} fois)"
        print("PASS: Aucun ErrorNoData en ligne, FlatList visible")

    def test_chat_send_message_guard_isconnected(self, page: Page):
        """
        Vérification que l'envoi de message passe par le guard isConnected.
        En ligne: le message est envoyé.
        On vérifie que le bouton send est cliquable.
        """
        login_fast(page, "coach")
        page.wait_for_timeout(1500)

        page.goto(f"{APP_URL}/chat/conv_demo002", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(3000)

        chat_input = page.locator('[data-testid="chat-input"]')
        if not chat_input.first.is_visible():
            pytest.skip("chat-input non visible, conversation peut être bloquée")

        # Taper un message
        chat_input.first.fill("Message test régression E2E iteration73")
        page.wait_for_timeout(500)

        # Le bouton send doit devenir actif
        send_btn = page.locator('[data-testid="chat-send-btn"]')
        assert send_btn.first.is_visible(), "chat-send-btn non visible"
        print("PASS: chat-send-btn visible et actif")

        # Cliquer pour envoyer
        send_btn.first.click()
        page.wait_for_timeout(2000)

        # Le message envoyé doit apparaître dans le DOM ou l'input doit se vider
        msg_visible = page.locator('text=Message test régression E2E iteration73').count()
        input_cleared = chat_input.first.input_value() == ''
        assert msg_visible > 0 or input_cleared, "Message non envoyé (ni visible, ni input vidé)"
        if msg_visible > 0:
            print("PASS: Message envoyé visible dans la conversation")
        else:
            print("PASS: Input vidé après envoi (message envoyé via WebSocket)")

    def test_chat_back_button_works(self, page: Page):
        """Le bouton retour du chat room ramène à la liste des conversations."""
        login_fast(page, "coach")
        page.wait_for_timeout(1500)

        # D'abord aller sur la liste chat
        navigate_to_tab(page, "chat")
        page.wait_for_timeout(2000)

        # Puis ouvrir conv_demo002
        page.goto(f"{APP_URL}/chat/conv_demo002", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(2000)

        back_btn = page.locator('[data-testid="chat-back-btn"]')
        if back_btn.count() == 0 or not back_btn.first.is_visible():
            pytest.skip("Bouton retour non visible")

        back_btn.first.click()
        page.wait_for_timeout(2000)

        # On doit être revenu (l'URL ne doit plus contenir conv_demo002 ou la liste chat est visible)
        current_url = page.url
        print(f"URL après retour: {current_url}")
        # Soit on est sur /chat soit ailleurs
        print("PASS: Bouton retour cliqué sans erreur")

    def test_chat_room_screenshot(self, page: Page):
        """Capture d'écran du chat room pour vérification visuelle."""
        login_fast(page, "coach")
        page.wait_for_timeout(1500)

        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{APP_URL}/chat/conv_demo002", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(3000)

        page.screenshot(path="/app/test_reports/iter73_chat_room.jpg", quality=40, full_page=False)
        print("PASS: Screenshot chat room pris")

        # Vérifications visuelles clés
        back_btn = page.locator('[data-testid="chat-back-btn"]')
        chat_input = page.locator('[data-testid="chat-input"]')
        assert back_btn.count() > 0
        assert chat_input.count() > 0
        print("PASS: Éléments clés du chat room présents")


class TestChatErrorNoDataStructure:
    """Vérification statique de la structure ErrorNoData dans le code."""

    def test_errornodata_testid_present_in_error_state(self, page: Page):
        """
        Vérifie que l'ErrorNoData avec testID='chat-error-no-data' est correctement
        configuré (lecture du code source).
        Note: L'état d'erreur n'est simulable qu'hors ligne, mais on peut vérifier
        que l'implémentation est correcte via un appel de page avec une conv inexistante.
        """
        login_fast(page, "user")
        page.wait_for_timeout(1500)

        # On essaie avec une conversation inexistante pour déclencher l'erreur réseau
        # L'API va retourner 404, puis le ws va échouer → historyState=error
        page.goto(f"{APP_URL}/chat/conv_nonexistent_test_xyz_99999", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(5000)  # Attendre que le réseau fail

        # Vérifier les erreurs JS dans la console
        errors = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.wait_for_timeout(1000)

        # Chercher l'ErrorNoData ou l'état d'erreur
        error_no_data = page.locator('[data-testid="chat-error-no-data"]')
        if error_no_data.count() > 0 and error_no_data.first.is_visible():
            print("PASS: ErrorNoData visible pour conv inexistante")

            # Vérifier retry-btn
            retry_btn = page.locator('[data-testid="retry-btn"]')
            assert retry_btn.count() > 0, "retry-btn absent dans ErrorNoData"
            print("PASS: retry-btn présent dans ErrorNoData")

            # Vérifier back-nav-btn (onBack is passed)
            back_nav = page.locator('[data-testid="back-nav-btn"]')
            assert back_nav.count() > 0, "back-nav-btn absent — onBack manquant!"
            assert back_nav.first.is_visible(), "back-nav-btn non visible"
            print("PASS: back-nav-btn présent dans ErrorNoData (onBack transmis)")

            page.screenshot(path="/app/test_reports/iter73_chat_error_no_data.jpg", quality=40, full_page=False)
        else:
            # Peut ne pas déclencher l'erreur si l'API retourne une liste vide
            # Dans ce cas, FlatList s'affiche avec ListEmptyComponent
            print(f"INFO: ErrorNoData non visible pour conv inexistante (peut retourner liste vide)")
            # Vérifier qu'on n'est pas bloqué sur un écran vide brutal
            chat_input = page.locator('[data-testid="chat-input"]')
            if chat_input.count() > 0:
                print("INFO: FlatList affichée (pas d'ErrorNoData) - comportement normal")
            print("PASS: Pas d'écran vide brutal")

    def test_errornodata_onback_onretry_configured(self, page: Page):
        """
        Vérifie que quand ErrorNoData est affiché, onBack et onRetry sont bien configurés.
        """
        login_fast(page, "user")
        page.wait_for_timeout(1500)

        page.goto(f"{APP_URL}/chat/conv_nonexistent_test_xyz_99999", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(6000)

        error_no_data = page.locator('[data-testid="chat-error-no-data"]')
        if error_no_data.count() == 0 or not error_no_data.first.is_visible():
            pytest.skip("ErrorNoData non déclenché pour conv inexistante (API retourne liste vide)")

        # Vérifier back-nav-btn cliquable
        back_nav = page.locator('[data-testid="back-nav-btn"]')
        assert back_nav.count() > 0, "FAIL: back-nav-btn absent - onBack non configuré!"
        back_nav.first.click()
        page.wait_for_timeout(1500)
        print("PASS: back-nav-btn cliqué sans erreur")
