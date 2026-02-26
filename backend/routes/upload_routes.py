from fastapi import APIRouter, Request, UploadFile, File
from pathlib import Path
import uuid
import os
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

UPLOADS_DIR = Path("/app/backend/uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


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

    # Build URL from the incoming request to work in any environment
    base = str(request.base_url).rstrip("/")
    url = f"{base}/api/uploads/{filename}"
    logger.info(f"Image uploaded: {filename} ({len(content)} bytes)")
    return {"url": url, "filename": filename}
