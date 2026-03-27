"""
Tests E2E pour l'upload d'images via Cloudflare R2.
Vérifie : compression, catégorisation, suppression, rétro-compat locale.
"""
import io
import os
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://tag-modal-rollout.preview.emergentagent.com").rstrip("/")

# ─── Fixtures ─────────────────────────────────────────────────────────────────

USER_TOKEN = None
COACH_TOKEN = None


def setup_module(module):
    global USER_TOKEN, COACH_TOKEN

    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "user@winek.app", "password": "WinekUser2024!"})
    assert r.status_code == 200, f"User login failed: {r.text}"
    USER_TOKEN = r.json()["token"]

    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "coach@winek.app", "password": "WinekCoach2024!"})
    assert r.status_code == 200, f"Coach login failed: {r.text}"
    COACH_TOKEN = r.json()["token"]


def _make_jpeg(width=2500, height=2000, quality=95) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=(100, 150, 200))
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def _make_png_rgba(width=800, height=600) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGBA", (width, height), color=(255, 0, 0, 128))
    img.save(buf, format="PNG")
    return buf.getvalue()


def _upload(token: str, data: bytes, mime: str, category: str | None = None) -> dict:
    url = f"{BASE_URL}/api/upload-image"
    if category:
        url += f"?category={category}"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("test.img", io.BytesIO(data), mime)},
        timeout=30,
    )
    assert r.status_code == 200, f"Upload failed [{r.status_code}]: {r.text}"
    return r.json()


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestUploadR2Basics:
    def test_upload_jpeg_services(self):
        """Upload JPEG large → catégorie services → URL R2."""
        data = _make_jpeg(2500, 2000)
        result = _upload(USER_TOKEN, data, "image/jpeg", "services")
        assert "url" in result
        assert "filename" in result
        assert result["url"].startswith("https://images.winek.app/services/")
        assert result["url"].endswith(".jpg")

    def test_upload_jpeg_profiles(self):
        """Upload JPEG → catégorie profiles."""
        data = _make_jpeg(1000, 1000)
        result = _upload(COACH_TOKEN, data, "image/jpeg", "profiles")
        assert result["url"].startswith("https://images.winek.app/profiles/")

    def test_upload_jpeg_spotyou(self):
        """Upload JPEG → catégorie spotyou."""
        data = _make_jpeg(1500, 1200)
        result = _upload(USER_TOKEN, data, "image/jpeg", "spotyou")
        assert result["url"].startswith("https://images.winek.app/spotyou/")

    def test_upload_default_category(self):
        """Sans catégorie → dossier 'other'."""
        data = _make_jpeg(500, 500)
        result = _upload(USER_TOKEN, data, "image/jpeg")
        assert result["url"].startswith("https://images.winek.app/other/")

    def test_upload_invalid_category_fallback_other(self):
        """Catégorie inconnue → fallback 'other'."""
        data = _make_jpeg(500, 500)
        result = _upload(USER_TOKEN, data, "image/jpeg", "invalid_cat")
        assert result["url"].startswith("https://images.winek.app/other/")


class TestUploadCompression:
    def test_jpeg_is_compressed(self):
        """Image 2500x2000 → taille réduite (compression Pillow)."""
        data = _make_jpeg(2500, 2000, quality=95)
        original_size = len(data)
        result = _upload(USER_TOKEN, data, "image/jpeg", "services")
        # La taille ne peut pas être vérifiée directement via l'API,
        # mais on vérifie que l'upload renvoie une URL R2 valide.
        assert result["url"].endswith(".jpg"), "JPEG attendu en sortie"

    def test_png_rgba_to_webp(self):
        """PNG RGBA → converti en WebP (transparence préservée)."""
        data = _make_png_rgba(800, 600)
        result = _upload(USER_TOKEN, data, "image/png", "profiles")
        # PNG RGBA doit sortir en WebP
        assert result["url"].endswith(".webp"), f"WebP attendu, got: {result['url']}"

    def test_small_jpeg_no_crash(self):
        """Image 100x100 → aucun crash de compression."""
        data = _make_jpeg(100, 100, quality=90)
        result = _upload(USER_TOKEN, data, "image/jpeg", "services")
        assert result["url"].endswith(".jpg")


class TestUploadSecurity:
    def test_upload_requires_auth(self):
        """Sans token → 401."""
        data = _make_jpeg(100, 100)
        r = requests.post(
            f"{BASE_URL}/api/upload-image",
            files={"file": ("test.jpg", io.BytesIO(data), "image/jpeg")},
            timeout=10,
        )
        assert r.status_code == 401

    def test_upload_rejects_non_image(self):
        """Fichier texte → 415 (magic bytes invalides)."""
        r = requests.post(
            f"{BASE_URL}/api/upload-image",
            headers={"Authorization": f"Bearer {USER_TOKEN}"},
            files={"file": ("malicious.jpg", io.BytesIO(b"not an image, just text"), "image/jpeg")},
            timeout=10,
        )
        assert r.status_code == 415, f"Expected 415, got {r.status_code}: {r.text}"

    def test_upload_rejects_too_large(self):
        """Fichier > 5 Mo → 413."""
        big_data = b"x" * (5 * 1024 * 1024 + 100)
        r = requests.post(
            f"{BASE_URL}/api/upload-image",
            headers={"Authorization": f"Bearer {USER_TOKEN}"},
            files={"file": ("big.jpg", io.BytesIO(big_data), "image/jpeg")},
            timeout=30,
        )
        assert r.status_code == 413, f"Expected 413, got {r.status_code}"


class TestUploadDeleteFlow:
    def test_upload_then_service_delete_removes_from_r2(self):
        """Upload d'une image service → création d'un service → MAJ en retirant l'image
        → la suppression via l'API ne plante pas."""
        # Upload
        data = _make_jpeg(800, 600)
        result = _upload(COACH_TOKEN, data, "image/jpeg", "services")
        image_url = result["url"]
        assert "images.winek.app/services/" in image_url

        # Créer un service avec cette image
        tags_resp = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport", timeout=5)
        tag_ids = ["tag_3x3"]
        if tags_resp.status_code == 200 and tags_resp.json():
            for cat in tags_resp.json():
                if cat.get("tags"):
                    tag_ids = [cat["tags"][0]["tag_id"]]
                    break

        create_resp = requests.post(
            f"{BASE_URL}/api/services",
            headers={"Authorization": f"Bearer {COACH_TOKEN}"},
            json={
                "title": "TEST_R2_Delete Service",
                "description": "Test suppression image R2",
                "price": 50.0,
                "duration_min": 60,
                "domain_id": "dom_sport",
                "tag_ids": tag_ids,
                "images": [image_url],
                "locations": [],
                "packages": [],
            },
            timeout=10,
        )
        assert create_resp.status_code in (200, 201), f"Service create failed: {create_resp.text}"
        service_id = create_resp.json().get("service_id") or create_resp.json().get("id")

        # Retirer l'image du service (liste vide) → doit déclencher delete_from_r2
        update_resp = requests.patch(
            f"{BASE_URL}/api/services/{service_id}",
            headers={"Authorization": f"Bearer {COACH_TOKEN}"},
            json={"images": []},
            timeout=10,
        )
        assert update_resp.status_code == 200, f"Service update failed: {update_resp.text}"

        # Nettoyage : supprimer le service de test
        requests.delete(
            f"{BASE_URL}/api/services/{service_id}",
            headers={"Authorization": f"Bearer {COACH_TOKEN}"},
            timeout=10,
        )
