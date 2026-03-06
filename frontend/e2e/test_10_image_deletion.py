"""
Tests E2E - Suppression d'images dans SpotYou et Service
Vérifie que les images supprimées ne restent PAS en base de données.
"""
import pytest
import requests
import time
from conftest import APP_URL, get_token

API_BASE = APP_URL

# JPEG minimal valide (1x1 pixel)
MINIMAL_JPEG = bytes([
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
    0x00, 0xFB, 0xD2, 0x8A, 0x28, 0x03, 0xFF, 0xD9,
])


def upload_image(token: str, filename: str = "test.jpg") -> str:
    """Upload une image et retourne son URL."""
    resp = requests.post(
        f"{API_BASE}/api/upload-image",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": (filename, MINIMAL_JPEG, "image/jpeg")},
        timeout=15,
    )
    assert resp.status_code == 200, f"Upload échoué ({resp.status_code}): {resp.text}"
    return resp.json()["url"]


class TestSpotYouImageDeletion:
    """Vérifie que les images supprimées d'un SpotYou ne restent pas en BDD."""

    def test_deleted_image_removed_from_spotyou_db(self):
        """
        Scénario complet :
        1. Upload 2 images
        2. Créer un SpotYou avec 2 images
        3. Mettre à jour en ne gardant que 1 image
        4. Vérifier en GET que la BDD ne contient plus que 1 image
        """
        token = get_token("coach")
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # 1. Upload 2 images
        url1 = upload_image(token, "img1.jpg")
        url2 = upload_image(token, "img2.jpg")
        assert url1 != url2, "Les deux URLs doivent être différentes"

        # 2. Créer un SpotYou avec 2 images
        ts = int(time.time())
        create_payload = {
            "title": f"E2E ImgDel SpotYou {ts}",
            "description": "Test suppression image",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "precision": "exact",
            "tag_ids": [],
            "domain_id": "dom_coaching",
            "images": [url1, url2],
        }
        resp_create = requests.post(
            f"{API_BASE}/api/tag-points",
            json=create_payload,
            headers=headers,
            timeout=15,
        )
        assert resp_create.status_code == 200, f"Création SpotYou échouée: {resp_create.status_code} {resp_create.text}"
        point_id = resp_create.json()["point_id"]
        created_images = resp_create.json().get("images", [])
        assert len(created_images) == 2, f"Doit avoir 2 images après création, reçu: {created_images}"

        # 3. Mettre à jour en ne gardant que la première image (strings simples)
        update_payload = {
            "images": [url1],
        }
        resp_update = requests.put(
            f"{API_BASE}/api/tag-points/{point_id}",
            json=update_payload,
            headers=headers,
            timeout=15,
        )
        assert resp_update.status_code == 200, f"Mise à jour SpotYou échouée: {resp_update.status_code} {resp_update.text}"

        # 4. Vérifier en GET que la BDD ne contient plus que 1 image
        resp_get = requests.get(
            f"{API_BASE}/api/tag-points/{point_id}",
            headers=headers,
            timeout=15,
        )
        assert resp_get.status_code == 200, f"GET SpotYou échoué: {resp_get.status_code}"
        images_in_db = resp_get.json().get("images", [])
        assert len(images_in_db) == 1, (
            f"BDD doit contenir 1 image après suppression, mais contient {len(images_in_db)}: {images_in_db}"
        )
        # Vérifier que c'est bien la bonne image qui reste
        remaining_url = images_in_db[0].get("url") if isinstance(images_in_db[0], dict) else images_in_db[0]
        assert url1 in remaining_url or remaining_url == url1, (
            f"L'image restante doit être url1, mais reçu: {remaining_url}"
        )
        # Vérifier que url2 n'est plus là
        all_urls = [
            (img.get("url") if isinstance(img, dict) else img)
            for img in images_in_db
        ]
        assert url2 not in all_urls, f"url2 ne doit plus être en BDD, mais trouvé dans: {all_urls}"

    def test_removing_all_images_from_spotyou(self):
        """Supprimer toutes les images d'un SpotYou → la BDD doit avoir un tableau vide."""
        token = get_token("coach")
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        url1 = upload_image(token, "single.jpg")
        ts = int(time.time())

        # Créer avec 1 image
        resp_create = requests.post(
            f"{API_BASE}/api/tag-points",
            json={
                "title": f"E2E NoImg {ts}",
                "description": "Test suppression totale",
                "latitude": 48.8566,
                "longitude": 2.3522,
                "precision": "exact",
                "tag_ids": [],
                "domain_id": "dom_coaching",
                "images": [url1],
            },
            headers=headers,
            timeout=15,
        )
        assert resp_create.status_code == 200
        point_id = resp_create.json()["point_id"]

        # Mettre à jour avec 0 images
        resp_update = requests.put(
            f"{API_BASE}/api/tag-points/{point_id}",
            json={"images": []},
            headers=headers,
            timeout=15,
        )
        assert resp_update.status_code == 200, f"Mise à jour échouée: {resp_update.status_code} {resp_update.text}"

        # Vérifier que la BDD est vide
        resp_get = requests.get(
            f"{API_BASE}/api/tag-points/{point_id}",
            headers=headers,
            timeout=15,
        )
        assert resp_get.status_code == 200
        images_in_db = resp_get.json().get("images", [])
        assert len(images_in_db) == 0, (
            f"BDD doit être vide après suppression totale, mais contient: {images_in_db}"
        )


class TestServiceImageDeletion:
    """Vérifie que les images supprimées d'un Service ne restent pas en BDD."""

    def _create_service(self, token: str, images: list) -> str:
        """Helper : crée un Service et retourne son service_id."""
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        ts = int(time.time())
        payload = {
            "title": f"E2E ImgDel Service {ts}",
            "description": "Test suppression image service",
            "address": "Paris, France",
            "price": 50.0,
            "duration_min": 60,
            "tag_ids": [],
            "domain_id": None,
            "max_participants": 5,
            "images": images,
            "locations": [{"latitude": 48.8566, "longitude": 2.3522, "precision": "exact", "description": "Paris"}],
            "slots": [],
            "packages": [],
        }
        resp = requests.post(
            f"{API_BASE}/api/services",
            json=payload,
            headers=headers,
            timeout=15,
        )
        assert resp.status_code == 200, f"Création service échouée: {resp.status_code} {resp.text}"
        return resp.json()["service_id"]

    def test_deleted_image_removed_from_service_db(self):
        """
        Scénario complet :
        1. Upload 2 images
        2. Créer un Service avec 2 images
        3. Mettre à jour en ne gardant que 1 image
        4. Vérifier en GET que la BDD ne contient plus que 1 image
        """
        token = get_token("coach")
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # 1. Upload 2 images
        url1 = upload_image(token, "svc1.jpg")
        url2 = upload_image(token, "svc2.jpg")
        assert url1 != url2

        # 2. Créer un Service avec 2 images
        service_id = self._create_service(token, [url1, url2])

        # Vérifier la création
        resp_get = requests.get(f"{API_BASE}/api/services/{service_id}", headers=headers, timeout=15)
        assert resp_get.status_code == 200
        images_after_create = resp_get.json().get("images", [])
        assert len(images_after_create) == 2, (
            f"Doit avoir 2 images après création, reçu: {images_after_create}"
        )

        # 3. Mettre à jour en ne gardant que url1
        resp_update = requests.put(
            f"{API_BASE}/api/services/{service_id}",
            json={"images": [url1]},
            headers=headers,
            timeout=15,
        )
        assert resp_update.status_code == 200, (
            f"Mise à jour service échouée: {resp_update.status_code} {resp_update.text}"
        )

        # 4. Vérifier en GET que la BDD ne contient plus que 1 image
        resp_get2 = requests.get(f"{API_BASE}/api/services/{service_id}", headers=headers, timeout=15)
        assert resp_get2.status_code == 200
        images_in_db = resp_get2.json().get("images", [])
        assert len(images_in_db) == 1, (
            f"BDD doit contenir 1 image après suppression, mais contient {len(images_in_db)}: {images_in_db}"
        )
        # Vérifier que c'est url1 qui reste
        remaining = images_in_db[0]
        remaining_url = remaining.get("url") if isinstance(remaining, dict) else remaining
        assert url1 in str(remaining_url), (
            f"L'image restante doit être url1={url1}, reçu: {remaining_url}"
        )
        # url2 ne doit plus être là
        all_urls = [
            (img.get("url") if isinstance(img, dict) else img)
            for img in images_in_db
        ]
        assert url2 not in all_urls, f"url2 ne doit plus être en BDD: {all_urls}"

    def test_removing_all_images_from_service(self):
        """Supprimer toutes les images d'un Service → la BDD doit avoir un tableau vide."""
        token = get_token("coach")
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        url1 = upload_image(token, "svc_single.jpg")
        service_id = self._create_service(token, [url1])

        # Mettre à jour avec 0 images
        resp_update = requests.put(
            f"{API_BASE}/api/services/{service_id}",
            json={"images": []},
            headers=headers,
            timeout=15,
        )
        assert resp_update.status_code == 200, (
            f"Mise à jour échouée: {resp_update.status_code} {resp_update.text}"
        )

        # Vérifier
        resp_get = requests.get(f"{API_BASE}/api/services/{service_id}", headers=headers, timeout=15)
        assert resp_get.status_code == 200
        images_in_db = resp_get.json().get("images", [])
        assert len(images_in_db) == 0, (
            f"BDD doit être vide après suppression totale, mais contient: {images_in_db}"
        )
