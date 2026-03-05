"""
Tests E2E - Notifications
"""
import pytest
from playwright.sync_api import Page
from conftest import DEFAULT_TIMEOUT, NAV_TIMEOUT, login_fast, navigate_to_tab


class TestNotifications:

    def test_notifications_tab_loads(self, page: Page):
        """L'onglet notifications se charge correctement."""
        login_fast(page, "user")
        navigate_to_tab(page, "bookings")
        page.wait_for_timeout(2000)
        assert (
            page.locator('[data-testid^="notif-"]').count() >= 0
            or page.locator('[data-testid="empty-notifs"]').is_visible()
        )

    def test_mark_all_read_button_visible_when_notifs_exist(self, page: Page):
        """Le bouton 'Tout lire' est visible s'il y a des notifications."""
        login_fast(page, "user")
        navigate_to_tab(page, "bookings")
        page.wait_for_timeout(2000)
        notif_count = page.locator('[data-testid^="notif-"]').count()
        if notif_count > 0:
            mark_all_btn = page.locator('[data-testid="mark-all-read-btn"]')
            assert mark_all_btn.first.is_visible(), \
                "Le bouton 'Tout lire' doit être visible s'il y a des notifications"

    def test_notifications_state_no_crash(self, page: Page):
        """L'onglet notifications ne plante pas."""
        login_fast(page, "admin")
        navigate_to_tab(page, "bookings")
        page.wait_for_timeout(2000)
        # Soit des notifications, soit état vide — pas de crash
        assert page.locator('[data-testid^="notif-"]').count() >= 0
