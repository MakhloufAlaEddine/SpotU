from fastapi import APIRouter, Request, UploadFile, File, HTTPException
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from pathlib import Path
import uuid
import os
import logging

from auth_utils import require_auth
from database import get_pool

router = APIRouter()
logger = logging.getLogger(__name__)

UPLOADS_DIR = Path("/app/backend/uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
# Résolution anticipée pour la protection path-traversal
_UPLOADS_DIR_RESOLVED = UPLOADS_DIR.resolve()

MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5 Mo

# Extension de sortie par type détecté
_EXT_MAP = {"jpeg": "jpg", "png": "png", "gif": "gif", "webp": "webp", "heic": "heic", "heif": "heic"}


@router.post("/upload-image/debug-422")
async def debug_upload(request: Request):
    """Endpoint temporaire pour diagnostiquer les 422 sur upload."""
    ct = request.headers.get("content-type", "")
    body = await request.body()
    logger.warning(f"[DEBUG-422] content-type={ct} body_len={len(body)} body_start={body[:200]!r}")
    return {"content_type": ct, "body_len": len(body), "body_start": body[:100].hex()}


def _detect_image_type(data: bytes) -> str | None:
    """
    Détecte le vrai type d'image via magic bytes.
    Retourne 'jpeg' | 'png' | 'gif' | 'webp' | 'heic', ou None si non reconnu.
    Ne fait JAMAIS confiance au Content-Type déclaré par le client.
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
    # HEIC/HEIF (iPhone camera) — ISO Base Media File Format
    # box: [size 4B][ftyp 4B][brand 4B] — brand starts at offset 8
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand[:3] in (b"hei", b"hev", b"mif", b"msf", b"avi"):
            return "heic"
    return None


# ─── Utilitaires de suppression ───────────────────────────────────────────────

def delete_upload_file(url: str):
    """
    Supprime un fichier uploadé localement.
    [SEC-10] Protection path traversal : le chemin résolu DOIT rester sous UPLOADS_DIR.
    Si le chemin est invalide ou hors-répertoire → log warning, pas de crash.
    """
    if not url or "/api/uploads/" not in url:
        return

    filename = url.split("/api/uploads/")[-1].split("?")[0]

    try:
        filepath = (UPLOADS_DIR / filename).resolve()
        # relative_to() lève ValueError si filepath n'est pas sous _UPLOADS_DIR_RESOLVED
        filepath.relative_to(_UPLOADS_DIR_RESOLVED)
    except (ValueError, Exception) as e:
        logger.warning(f"[SEC-10] Path traversal bloqué ou chemin invalide: {filename!r} — {e}")
        return

    try:
        filepath.unlink(missing_ok=True)
        logger.info(f"Deleted upload file: {filename}")
    except Exception as e:
        logger.warning(f"Could not delete upload file {filename}: {e}")


def delete_upload_files(urls: list):
    """Supprime une liste de fichiers uploadés."""
    for url in (urls or []):
        delete_upload_file(url)


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/upload-image")
async def upload_image(request: Request, file: UploadFile = File(...)):
    """
    Upload sécurisé d'une image.
    [SEC-07] Auth JWT requise.
    [SEC-08] Limite de taille : MAX 5 Mo — lecture avec borne pour éviter l'OOM.
    [SEC-09] Vérification magic bytes — le Content-Type déclaré est ignoré.
    """
    # [SEC-07] Authentification obligatoire
    pool = get_pool()
    await require_auth(request, pool)

    # [SEC-08] Lire au plus MAX_UPLOAD_SIZE+1 octets pour détecter le dépassement
    # sans charger tout un fichier géant en mémoire
    content = await file.read(MAX_UPLOAD_SIZE + 1)
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Fichier trop volumineux (max {MAX_UPLOAD_SIZE // (1024*1024)} Mo)",
        )

    # [SEC-09] Validation du type réel via magic bytes (ignorer Content-Type)
    img_type = _detect_image_type(content)
    if img_type is None:
        raise HTTPException(
            status_code=415,
            detail="Type de fichier non supporté. Formats acceptés : JPEG, PNG, WebP, GIF",
        )

    ext = _EXT_MAP[img_type]
    filename = f"img_{uuid.uuid4().hex[:16]}.{ext}"
    filepath = UPLOADS_DIR / filename
    filepath.write_bytes(content)

    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    forwarded_proto = request.headers.get("x-forwarded-proto", "https")
    if forwarded_host:
        base = f"{forwarded_proto}://{forwarded_host}"
    else:
        base = os.environ.get("APP_URL", str(request.base_url).rstrip("/"))

    url = f"{base}/api/uploads/{filename}"
    logger.info(f"Image uploaded: {filename} ({len(content)} bytes) → {url}")
    return {"url": url, "filename": filename}
