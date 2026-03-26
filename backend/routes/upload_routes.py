"""
Endpoint d'upload d'images.
- Auth JWT obligatoire
- Limite 5 Mo
- Validation magic bytes (pas de confiance au Content-Type client)
- Compression Pillow avant envoi
- Stockage Cloudflare R2 (si configuré) sinon filesystem local (rétro-compat)
- Catégorisation par dossier R2 : profiles / services / spotyou / other
"""
import uuid
import os
import logging
from pathlib import Path

from fastapi import APIRouter, Request, UploadFile, File, HTTPException, Query

from auth_utils import require_auth
from database import get_pool

router = APIRouter()
logger = logging.getLogger(__name__)

UPLOADS_DIR = Path("/app/backend/uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
_UPLOADS_DIR_RESOLVED = UPLOADS_DIR.resolve()

MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5 Mo

_ALLOWED_CATEGORIES = {"profiles", "services", "spotyou", "chats", "products", "other"}

# Mapping img_type → extension locale (fallback filesystem)
_EXT_MAP = {
    "jpeg": "jpg",
    "png":  "png",
    "gif":  "gif",
    "webp": "webp",
    "heic": "heic",
    "heif": "heic",
}


# ─── Détection magic bytes ─────────────────────────────────────────────────────

def _detect_image_type(data: bytes) -> str | None:
    """
    Détecte le vrai type d'image via magic bytes.
    Retourne 'jpeg' | 'png' | 'gif' | 'webp' | 'heic', ou None si non reconnu.
    """
    if len(data) < 12:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand[:3] in (b"hei", b"hev", b"mif", b"msf", b"avi"):
            return "heic"
    return None


# ─── Suppression (local + R2) ─────────────────────────────────────────────────

def delete_upload_file(url: str):
    """
    Supprime un fichier uploadé.
    - URL R2 (images.winek.app) → suppression dans R2
    - URL locale (/api/uploads/) → suppression du filesystem
    [SEC-10] Protection path traversal sur les URLs locales.
    """
    if not url:
        return

    r2_public_url = (os.environ.get("R2_PUBLIC_URL") or "").rstrip("/")
    if r2_public_url and url.startswith(r2_public_url):
        try:
            from r2_storage import delete_from_r2
            delete_from_r2(url)
        except Exception as exc:
            logger.warning(f"R2 delete failed: {exc}")
        return

    # Fallback : fichier local
    if "/api/uploads/" not in url:
        return

    filename = url.split("/api/uploads/")[-1].split("?")[0]
    try:
        filepath = (UPLOADS_DIR / filename).resolve()
        filepath.relative_to(_UPLOADS_DIR_RESOLVED)
    except (ValueError, Exception) as exc:
        logger.warning(f"[SEC-10] Path traversal bloqué: {filename!r} — {exc}")
        return

    try:
        filepath.unlink(missing_ok=True)
        logger.info(f"Local delete: {filename}")
    except Exception as exc:
        logger.warning(f"Local delete failed {filename}: {exc}")


def delete_upload_files(urls: list):
    """Supprime une liste de fichiers uploadés."""
    for url in (urls or []):
        delete_upload_file(url)


# ─── Debug endpoint (conservé) ───────────────────────────────────────────────

@router.post("/upload-image/debug-422")
async def debug_upload(request: Request):
    """Endpoint temporaire pour diagnostiquer les 422 sur upload."""
    ct = request.headers.get("content-type", "")
    body = await request.body()
    logger.warning(f"[DEBUG-422] content-type={ct} body_len={len(body)} body_start={body[:200]!r}")
    return {"content_type": ct, "body_len": len(body), "body_start": body[:100].hex()}


# ─── Upload principal ─────────────────────────────────────────────────────────

@router.post("/upload-image")
async def upload_image(
    request: Request,
    file: UploadFile = File(...),
    category: str = Query(default="other"),
):
    """
    Upload sécurisé d'une image avec compression et stockage R2.

    Paramètres :
      - file     : fichier multipart
      - category : dossier R2 cible — profiles | services | spotyou | chats | other

    [SEC-07] Auth JWT requise.
    [SEC-08] Limite 5 Mo.
    [SEC-09] Validation magic bytes.
    """
    # [SEC-07] Auth
    pool = get_pool()
    await require_auth(request, pool)

    # Catégorie valide
    folder = category if category in _ALLOWED_CATEGORIES else "other"

    # [SEC-08] Lecture bornée
    content = await file.read(MAX_UPLOAD_SIZE + 1)
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Fichier trop volumineux (max {MAX_UPLOAD_SIZE // (1024 * 1024)} Mo)",
        )

    # [SEC-09] Magic bytes
    img_type = _detect_image_type(content)
    if img_type is None:
        raise HTTPException(
            status_code=415,
            detail="Type de fichier non supporté. Formats acceptés : JPEG, PNG, WebP, GIF, HEIC",
        )

    # ── Compression ──────────────────────────────────────────────────────────
    original_size = len(content)
    try:
        from r2_storage import compress_image, upload_to_r2, is_r2_configured
        compressed_data, out_ext = compress_image(content, img_type)
        compressed_size = len(compressed_data)
        ratio = round((1 - compressed_size / original_size) * 100, 1) if original_size > 0 else 0
        logger.info(f"Compression: {original_size}B → {compressed_size}B ({ratio}% réduit, ext={out_ext})")
    except Exception as exc:
        logger.warning(f"Module r2_storage indisponible: {exc}, fallback local")
        compressed_data = content
        out_ext = _EXT_MAP.get(img_type, "jpg")
        is_r2_configured = lambda: False  # type: ignore[assignment]

    # ── Stockage R2 ──────────────────────────────────────────────────────────
    try:
        if is_r2_configured():
            url = upload_to_r2(compressed_data, folder, out_ext)
            logger.info(f"Upload R2 OK: {url}")
            return {"url": url, "filename": url.split("/")[-1]}
    except Exception as exc:
        logger.error(f"R2 upload failed: {exc} — fallback filesystem")

    # ── Fallback : filesystem local ──────────────────────────────────────────
    filename = f"img_{uuid.uuid4().hex[:16]}.{out_ext}"
    filepath = UPLOADS_DIR / filename
    filepath.write_bytes(compressed_data)

    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    forwarded_proto = request.headers.get("x-forwarded-proto", "https")
    base = (
        f"{forwarded_proto}://{forwarded_host}"
        if forwarded_host
        else os.environ.get("APP_URL", str(request.base_url).rstrip("/"))
    )
    url = f"{base}/api/uploads/{filename}"
    logger.info(f"Local fallback upload: {filename} ({len(compressed_data)} bytes) → {url}")
    return {"url": url, "filename": filename}
