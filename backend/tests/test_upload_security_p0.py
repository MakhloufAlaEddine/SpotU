"""
Tests P0 Upload Security — SpotU
=================================
[SEC-07] Authentification requise → 401 sans JWT
[SEC-08] Limite de taille 5 Mo → 413 si dépassé
[SEC-09] Vérification magic bytes → 415 si contenu invalide
[SEC-10] Protection path traversal dans delete_upload_file → no-op hors UPLOADS_DIR

Usage:
    cd /app/backend
    JWT_SECRET=<secret> python -m pytest tests/test_upload_security_p0.py -v
"""
import io
import sys
import os
import time
from pathlib import Path

import pytest
import httpx

# ─── Config ───────────────────────────────────────────────────────────────────

API_URL = "http://localhost:8001"
MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5 Mo

TEST_USER = {"email": "user@winek.app", "password": "WinekUser2024!"}

# Magic bytes minimaux pour chaque format supporté
JPEG_MAGIC = b"\xff\xd8\xff\xe0" + b"\x00" * 20
PNG_MAGIC  = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
GIF_MAGIC  = b"GIF89a" + b"\x00" * 20
WEBP_MAGIC = b"RIFF\x08\x00\x00\x00WEBP" + b"\x00" * 20

# Contenu clairement non-image
FAKE_TEXT  = b"This is not an image. <script>alert(1)</script>"
PDF_BYTES  = b"%PDF-1.4 fake pdf content that is not an image"


# ─── Helpers ──────────────────────────────────────────────────────────────────

# Token cache — évite de dépasser le rate limit /login (5/min par IP) quand
# toute la suite de tests est exécutée d'un coup.
_TOKEN: dict = {"value": None}

def _get_token() -> str:
    """Obtient un JWT valide une seule fois et le met en cache."""
    if _TOKEN["value"] is None:
        import uuid as _uuid
        # IP unique → n'interfère pas avec les autres suites de test
        unique_ip = (
            f"10.{_uuid.uuid4().int % 254 + 1}"
            f".{_uuid.uuid4().int % 254 + 1}"
            f".{_uuid.uuid4().int % 254 + 1}"
        )
        resp = httpx.post(
            f"{API_URL}/api/auth/login",
            json=TEST_USER,
            headers={"X-Forwarded-For": unique_ip},
            timeout=10,
        )
        assert resp.status_code == 200, f"Login a échoué: {resp.text}"
        _TOKEN["value"] = resp.json()["token"]
    return _TOKEN["value"]


def _auth_headers() -> dict:
    return {"Authorization": f"Bearer {_get_token()}"}


def _upload(data: bytes, filename: str, content_type: str, headers: dict | None = None) -> httpx.Response:
    """Envoie une requête d'upload multipart."""
    return httpx.post(
        f"{API_URL}/api/upload-image",
        files={"file": (filename, io.BytesIO(data), content_type)},
        headers=headers or {},
        timeout=60,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-07] Authentification requise
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC07_AuthRequired:

    def test_upload_sans_jwt_retourne_401(self):
        """SEC-07: Requête sans token doit retourner 401."""
        resp = _upload(JPEG_MAGIC, "test.jpg", "image/jpeg")
        assert resp.status_code == 401, (
            f"Attendu 401 (pas d'auth), obtenu {resp.status_code}: {resp.text}"
        )

    def test_upload_avec_jwt_invalide_retourne_401(self):
        """SEC-07: JWT forgé/invalide doit retourner 401."""
        resp = _upload(
            JPEG_MAGIC, "test.jpg", "image/jpeg",
            headers={"Authorization": "Bearer token.invalide.forge"},
        )
        assert resp.status_code == 401, (
            f"Attendu 401 (token invalide), obtenu {resp.status_code}: {resp.text}"
        )

    def test_upload_avec_jwt_valide_et_image_valide_retourne_200(self):
        """SEC-07: Requête authentifiée + image JPEG valide → 200 + url."""
        resp = _upload(JPEG_MAGIC, "ok.jpg", "image/jpeg", _auth_headers())
        assert resp.status_code == 200, (
            f"Attendu 200, obtenu {resp.status_code}: {resp.text}"
        )
        body = resp.json()
        assert "url" in body, "Réponse sans champ 'url'"
        assert "filename" in body, "Réponse sans champ 'filename'"


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-08] Limite de taille
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC08_FileSizeLimit:

    def test_upload_fichier_depasse_5mo_retourne_413(self):
        """SEC-08: Fichier > 5 Mo doit retourner 413."""
        # JPEG magic bytes + rembourrage jusqu'à 6 Mo
        oversized = b"\xff\xd8\xff\xe0" + b"\x00" * (6 * 1024 * 1024)
        resp = _upload(oversized, "big.jpg", "image/jpeg", _auth_headers())
        assert resp.status_code == 413, (
            f"Attendu 413 (fichier trop grand), obtenu {resp.status_code}: {resp.text}"
        )

    def test_upload_fichier_petit_valide_retourne_200(self):
        """SEC-08: Fichier bien en-dessous de la limite → accepté."""
        resp = _upload(JPEG_MAGIC, "small.jpg", "image/jpeg", _auth_headers())
        assert resp.status_code == 200, (
            f"Attendu 200 (fichier petit), obtenu {resp.status_code}: {resp.text}"
        )

    def test_upload_exactement_5mo_retourne_200(self):
        """SEC-08: Fichier exactement à 5 Mo → doit être accepté (borne incluse)."""
        exact = b"\xff\xd8\xff\xe0" + b"\x00" * (MAX_UPLOAD_SIZE - 4)
        assert len(exact) == MAX_UPLOAD_SIZE
        resp = _upload(exact, "exact.jpg", "image/jpeg", _auth_headers())
        assert resp.status_code == 200, (
            f"Attendu 200 (exactement 5 Mo), obtenu {resp.status_code}: {resp.text}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-09] Vérification MIME via magic bytes
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC09_MagicBytesValidation:

    def test_upload_texte_renomme_jpeg_retourne_415(self):
        """SEC-09: Contenu texte avec extension .jpg → 415."""
        resp = _upload(FAKE_TEXT, "fake.jpg", "image/jpeg", _auth_headers())
        assert resp.status_code == 415, (
            f"Attendu 415 (faux JPEG), obtenu {resp.status_code}: {resp.text}"
        )

    def test_upload_pdf_renomme_jpeg_retourne_415(self):
        """SEC-09: PDF renommé .jpg → 415 (Content-Type ignoré)."""
        resp = _upload(PDF_BYTES, "evil.jpg", "image/jpeg", _auth_headers())
        assert resp.status_code == 415, (
            f"Attendu 415 (PDF déguisé), obtenu {resp.status_code}: {resp.text}"
        )

    def test_upload_contenu_vide_retourne_415(self):
        """SEC-09: Fichier vide → 415 (pas assez de bytes pour détecter le type)."""
        resp = _upload(b"", "empty.jpg", "image/jpeg", _auth_headers())
        assert resp.status_code == 415, (
            f"Attendu 415 (fichier vide), obtenu {resp.status_code}: {resp.text}"
        )

    def test_upload_jpeg_valide_retourne_200_et_ext_jpg(self):
        """SEC-09: JPEG (magic bytes corrects) → 200, extension .jpg."""
        resp = _upload(JPEG_MAGIC, "photo.jpg", "image/jpeg", _auth_headers())
        assert resp.status_code == 200, f"Attendu 200: {resp.text}"
        assert resp.json()["filename"].endswith(".jpg")

    def test_upload_png_valide_retourne_200_et_ext_png(self):
        """SEC-09: PNG (magic bytes corrects) → 200, extension .png."""
        resp = _upload(PNG_MAGIC, "image.png", "image/png", _auth_headers())
        assert resp.status_code == 200, f"Attendu 200: {resp.text}"
        assert resp.json()["filename"].endswith(".png")

    def test_upload_gif_valide_retourne_200_et_ext_gif(self):
        """SEC-09: GIF (magic bytes corrects) → 200, extension .gif."""
        resp = _upload(GIF_MAGIC, "anim.gif", "image/gif", _auth_headers())
        assert resp.status_code == 200, f"Attendu 200: {resp.text}"
        assert resp.json()["filename"].endswith(".gif")

    def test_upload_webp_valide_retourne_200_et_ext_webp(self):
        """SEC-09: WebP (magic bytes RIFF...WEBP corrects) → 200, extension .webp."""
        resp = _upload(WEBP_MAGIC, "photo.webp", "image/webp", _auth_headers())
        assert resp.status_code == 200, f"Attendu 200: {resp.text}"
        assert resp.json()["filename"].endswith(".webp")

    def test_extension_basee_sur_magic_bytes_pas_content_type(self):
        """
        SEC-09: Si l'utilisateur envoie un PNG avec Content-Type 'image/jpeg',
        le fichier doit quand même être sauvegardé avec l'extension .png.
        """
        resp = _upload(
            PNG_MAGIC, "tricky.jpg",
            "image/jpeg",  # Content-Type menteur
            _auth_headers(),
        )
        assert resp.status_code == 200, f"Attendu 200: {resp.text}"
        # L'extension doit correspondre aux magic bytes (PNG), pas au Content-Type (jpeg)
        assert resp.json()["filename"].endswith(".png"), (
            "L'extension doit être .png (déduite des magic bytes), "
            f"obtenu: {resp.json()['filename']}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-10] Protection path traversal dans delete_upload_file
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC10_PathTraversal:
    """Tests unitaires de delete_upload_file — pas de serveur requis."""

    @pytest.fixture(autouse=True)
    def _inject_path(self):
        sys.path.insert(0, "/app/backend")
        # Forcer le rechargement pour avoir la version mise à jour
        import importlib
        if "routes.upload_routes" in sys.modules:
            importlib.reload(sys.modules["routes.upload_routes"])

    def test_path_traversal_simple_bloque(self, tmp_path):
        """SEC-10: '../server.py' ne doit pas supprimer server.py."""
        from routes.upload_routes import delete_upload_file

        target = Path("/app/backend/server.py")
        assert target.exists(), "server.py doit exister pour ce test"
        size_before = target.stat().st_size

        delete_upload_file("https://example.com/api/uploads/../server.py")

        assert target.exists(), "server.py a été supprimé !"
        assert target.stat().st_size == size_before, "server.py a été modifié !"

    def test_path_traversal_double_bloque(self):
        """SEC-10: '../../backend/server.py' → no-op."""
        from routes.upload_routes import delete_upload_file

        target = Path("/app/backend/server.py")
        size_before = target.stat().st_size

        delete_upload_file("https://example.com/api/uploads/../../backend/server.py")

        assert target.stat().st_size == size_before, "Traversal double n'a pas été bloqué !"

    def test_path_traversal_encoded_bloque(self):
        """SEC-10: chemin absolu dans l'URL → no-op."""
        from routes.upload_routes import delete_upload_file

        target = Path("/app/backend/auth_utils.py")
        size_before = target.stat().st_size

        # URL avec chemin qui "sort" des uploads via ..
        delete_upload_file("https://example.com/api/uploads/foo/../../auth_utils.py")

        assert target.stat().st_size == size_before, "auth_utils.py a été touché !"

    def test_url_sans_uploads_ignoree(self):
        """SEC-10: URL sans '/api/uploads/' → ignorée silencieusement."""
        from routes.upload_routes import delete_upload_file
        # Ne doit pas lever d'exception
        delete_upload_file("https://example.com/other/path/file.jpg")
        delete_upload_file(None)
        delete_upload_file("")

    def test_suppression_fichier_legitime_fonctionne(self):
        """SEC-10: Un fichier DANS UPLOADS_DIR est bien supprimé."""
        from routes.upload_routes import delete_upload_file, UPLOADS_DIR

        test_file = UPLOADS_DIR / "sec10_test_delete.jpg"
        test_file.write_bytes(b"\xff\xd8\xff\xe0test")
        assert test_file.exists()

        delete_upload_file(f"https://example.com/api/uploads/sec10_test_delete.jpg")
        assert not test_file.exists(), "Le fichier légitime n'a pas été supprimé"


# ═══════════════════════════════════════════════════════════════════════════════
# Vérification statique du code source
# ═══════════════════════════════════════════════════════════════════════════════

class TestStaticCodeAnalysis:
    """Vérifie que les garde-fous sont bien présents dans upload_routes.py."""

    @classmethod
    def _src(cls) -> str:
        with open("/app/backend/routes/upload_routes.py", encoding="utf-8") as f:
            return f.read()

    def test_require_auth_present(self):
        """SEC-07: require_auth doit être appelé dans upload_image."""
        src = self._src()
        assert "require_auth" in src, "FAIL: require_auth absent de upload_routes.py"
        assert "await require_auth" in src, "FAIL: await require_auth absent"

    def test_max_size_constant_present(self):
        """SEC-08: MAX_UPLOAD_SIZE doit être défini."""
        src = self._src()
        assert "MAX_UPLOAD_SIZE" in src, "FAIL: constante MAX_UPLOAD_SIZE absente"
        assert "5 * 1024 * 1024" in src or "5242880" in src, (
            "FAIL: valeur 5 Mo non trouvée"
        )

    def test_read_with_size_limit(self):
        """SEC-08: file.read() doit être appelé avec une borne (pas sans argument)."""
        src = self._src()
        assert "await file.read(" in src, "FAIL: file.read() sans borne de taille"
        # Vérifier qu'on n'a pas `await file.read()` sans argument
        import re
        bare_read = re.search(r"await file\.read\(\s*\)", src)
        assert bare_read is None, (
            "FAIL: await file.read() sans limite trouvé — risque OOM"
        )

    def test_magic_bytes_detection_present(self):
        """SEC-09: La fonction de détection magic bytes doit exister."""
        src = self._src()
        assert "_detect_image_type" in src, "FAIL: _detect_image_type absent"
        assert "\\xff\\xd8\\xff" in src or "xff\\xd8\\xff" in src or "xff" in src, (
            "FAIL: magic bytes JPEG absents"
        )
        assert "\\x89PNG" in src or "x89PNG" in src or "89PNG" in src, (
            "FAIL: magic bytes PNG absents"
        )

    def test_path_traversal_protection_present(self):
        """SEC-10: relative_to() doit être utilisé pour bloquer le path traversal."""
        src = self._src()
        assert "relative_to" in src, (
            "FAIL: protection path traversal (relative_to) absente"
        )
        assert "_UPLOADS_DIR_RESOLVED" in src, (
            "FAIL: répertoire résolu _UPLOADS_DIR_RESOLVED absent"
        )

    def test_no_blind_file_read(self):
        """SEC-08: Pas d'appel à await file.read() sans borne."""
        import re
        src = self._src()
        # await file.read() sans argument = dangereux
        match = re.search(r"await\s+file\.read\(\s*\)", src)
        assert match is None, (
            f"FAIL: await file.read() sans limite à la ligne contenant: "
            f"{src[max(0,match.start()-40):match.end()+40]!r}"
        )
