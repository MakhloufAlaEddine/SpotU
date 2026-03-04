from fastapi import APIRouter, Request, UploadFile, File
from pathlib import Path
import uuid
import os
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

UPLOADS_DIR = Path("/app/backend/uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def delete_upload_file(url: str):
    """Supprime un fichier uploadé localement si l'URL pointe vers /api/uploads/."""
    if url and "/api/uploads/" in url:
        filename = url.split("/api/uploads/")[-1].split("?")[0]
        filepath = UPLOADS_DIR / filename
        try:
            filepath.unlink(missing_ok=True)
            logger.info(f"Deleted upload file: {filename}")
        except Exception as e:
            logger.warning(f"Could not delete upload file {filename}: {e}")


def delete_upload_files(urls: list):
    """Supprime une liste de fichiers uploadés."""
    for url in (urls or []):
        delete_upload_file(url)


@router.post("/upload-image")
async def upload_image(request: Request, file: UploadFile = File(...)):
    """Upload an image file and return its public URL."""
    content = await file.read()

    ext = "jpg"
    if file.content_type and "/" in file.content_type:
        raw_ext = file.content_type.split("/")[-1]
        ext = "jpg" if raw_ext in ("jpeg", "jpg") else raw_ext[:10]

    filename = f"img_{uuid.uuid4().hex[:16]}.{ext}"
    filepath = UPLOADS_DIR / filename
    filepath.write_bytes(content)

    # Use forwarded headers from proxy if present, otherwise fall back to env var
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    forwarded_proto = request.headers.get("x-forwarded-proto", "https")
    if forwarded_host:
        base = f"{forwarded_proto}://{forwarded_host}"
    else:
        base = os.environ.get("APP_URL", str(request.base_url).rstrip("/"))

    url = f"{base}/api/uploads/{filename}"
    logger.info(f"Image uploaded: {filename} ({len(content)} bytes) → {url}")
    return {"url": url, "filename": filename}
