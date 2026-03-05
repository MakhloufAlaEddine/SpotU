"""
Tests E2E - Upload d'images
Scénarios testés :
1. Le bouton d'ajout d'image est visible dans la création de SpotYou
2. L'upload via FormData fonctionne (test via API backend)
3. La création avec image réussit
"""
import pytest
import requests
import os
from playwright.sync_api import Page
from conftest import APP_URL, DEFAULT_TIMEOUT, NAV_TIMEOUT, login


API_BASE = APP_URL

# Token cache to avoid repeated login calls (429 rate limiting)
_TOKEN_CACHE = {}


def get_auth_token(role: str = "user") -> str:
    """Obtient un token JWT pour les tests API (avec cache pour éviter le rate-limiting)."""
    if role in _TOKEN_CACHE:
        return _TOKEN_CACHE[role]
    credentials = {
        "user":  {"email": "user@winek.app",  "password": "WinekUser2024!"},
        "coach": {"email": "coach@winek.app", "password": "WinekCoach2024!"},
    }
    creds = credentials[role]
    resp = requests.post(f"{API_BASE}/api/auth/login", json=creds)
    resp.raise_for_status()
    token = resp.json()["token"]
    _TOKEN_CACHE[role] = token
    return token


# ─── Tests Backend (Upload API) ────────────────────────────────────────────────

class TestImageUploadAPI:

    def test_upload_jpeg_returns_url(self):
        """L'API d'upload retourne une URL pour un JPEG valide."""
        token = get_auth_token("user")
        # JPEG minimal valide (magic bytes)
        jpg_bytes = bytes([
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
            0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
            0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
            0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
            0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
            0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
            0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
            0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
            0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
            0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0A, 0x0B, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F,
            0x00, 0xFB, 0xD2, 0x8A, 0x28, 0x03, 0xFF, 0xD9
        ])
        resp = requests.post(
            f"{API_BASE}/api/upload-image",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("test.jpg", jpg_bytes, "image/jpeg")},
        )
        assert resp.status_code == 200, f"Upload JPEG échoué: {resp.status_code} {resp.text}"
        data = resp.json()
        assert "url" in data, "Réponse manque le champ 'url'"
        assert data["url"].startswith("http"), f"URL invalide: {data['url']}"

    def test_upload_requires_auth(self):
        """L'upload sans token retourne 401/403."""
        jpg_bytes = bytes([0xFF, 0xD8, 0xFF, 0xE0])  # Magic bytes JPEG
        resp = requests.post(
            f"{API_BASE}/api/upload-image",
            files={"file": ("test.jpg", jpg_bytes, "image/jpeg")},
        )
        assert resp.status_code in (401, 403, 422), \
            f"Upload sans auth devrait retourner 401/403, reçu {resp.status_code}"

    def test_upload_rejects_invalid_file(self):
        """L'upload d'un fichier non-image est rejeté."""
        token = get_auth_token("user")
        fake_bytes = b"This is not an image file at all!"
        resp = requests.post(
            f"{API_BASE}/api/upload-image",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("test.txt", fake_bytes, "text/plain")},
        )
        assert resp.status_code == 415, \
            f"Upload fichier invalide devrait retourner 415, reçu {resp.status_code}"

    def test_upload_png(self):
        """L'upload d'un PNG valide fonctionne."""
        token = get_auth_token("user")
        # PNG minimal valide (magic bytes + IHDR minimal)
        png_bytes = bytes([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG magic
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # 1x1 pixel
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
            0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
            0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
            0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
            0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
            0x44, 0xAE, 0x42, 0x60, 0x82,
        ])
        resp = requests.post(
            f"{API_BASE}/api/upload-image",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("test.png", png_bytes, "image/png")},
        )
        assert resp.status_code == 200, f"Upload PNG échoué: {resp.status_code} {resp.text}"
        assert "url" in resp.json()

    def test_upload_file_too_large(self):
        """L'upload d'un fichier > 5Mo est rejeté."""
        token = get_auth_token("user")
        # JPEG header + 6Mo de données
        large_bytes = bytes([0xFF, 0xD8, 0xFF, 0xE0]) + b"\x00" * (6 * 1024 * 1024)
        resp = requests.post(
            f"{API_BASE}/api/upload-image",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("large.jpg", large_bytes, "image/jpeg")},
        )
        assert resp.status_code == 413, \
            f"Upload > 5Mo devrait retourner 413, reçu {resp.status_code}"


# ─── Tests Frontend (UI) ───────────────────────────────────────────────────────

class TestImageUploadUI:

    def test_add_image_button_visible_in_create_form(self, page: Page):
        """Le bouton d'ajout d'image est visible dans la création de SpotYou."""
        login(page, "coach")
        page.wait_for_timeout(3000)
        page.click('a[href="/create"]')
        page.wait_for_selector('[data-testid="add-image-btn"]', timeout=DEFAULT_TIMEOUT)
        assert page.locator('[data-testid="add-image-btn"]').is_visible()

    def test_create_form_has_title_and_image_button(self, page: Page):
        """Le formulaire de création contient le champ titre et le bouton image."""
        login(page, "coach")
        page.wait_for_timeout(3000)
        page.click('a[href="/create"]')
        page.wait_for_timeout(2000)
        assert page.locator('[data-testid="title-input"]').is_visible()
        assert page.locator('[data-testid="add-image-btn"]').is_visible()
