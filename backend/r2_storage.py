"""
Cloudflare R2 Storage — S3-compatible via boto3
Compression d'images (Pillow) avant envoi.
"""
import os
import io
import logging
import uuid

import boto3
from botocore.exceptions import ClientError
from PIL import Image

logger = logging.getLogger(__name__)

_MAX_DIM = 2000          # px max sur le côté le plus long
_JPEG_QUALITY = 85       # qualité JPEG/WebP de sortie

_CONTENT_TYPES = {
    "jpg":  "image/jpeg",
    "png":  "image/png",
    "webp": "image/webp",
    "gif":  "image/gif",
    "heic": "image/heic",
}

# ─── Config ────────────────────────────────────────────────────────────────────

def _cfg():
    return {
        "access_key_id":     os.environ.get("R2_ACCESS_KEY_ID"),
        "secret_access_key": os.environ.get("R2_SECRET_ACCESS_KEY"),
        "endpoint":          os.environ.get("R2_ENDPOINT"),
        "bucket":            os.environ.get("R2_BUCKET_NAME"),
        "public_url":        (os.environ.get("R2_PUBLIC_URL") or "").rstrip("/"),
    }


def is_r2_configured() -> bool:
    c = _cfg()
    return all([c["access_key_id"], c["secret_access_key"], c["endpoint"], c["bucket"], c["public_url"]])


def _client():
    c = _cfg()
    if not is_r2_configured():
        raise RuntimeError("R2 non configuré — vérifiez les variables d'env R2_*")
    return boto3.client(
        "s3",
        endpoint_url=c["endpoint"],
        aws_access_key_id=c["access_key_id"],
        aws_secret_access_key=c["secret_access_key"],
        region_name="auto",
    )


# ─── Compression ───────────────────────────────────────────────────────────────

def compress_image(data: bytes, img_type: str) -> tuple[bytes, str]:
    """
    Compresse une image et retourne (bytes_compressés, extension_sortie).

    Stratégie :
      - GIF         → inchangé (animations)
      - HEIC        → JPEG 85 % via pillow-heif
      - PNG + alpha → WebP 85 % (préserve la transparence)
      - tout autre  → JPEG 85 %
    Resize : max _MAX_DIM px sur le côté le plus long (LANCZOS).
    """
    if img_type == "gif":
        return data, "gif"

    try:
        if img_type == "heic":
            try:
                import pillow_heif
                pillow_heif.register_heif_opener()
                img = Image.open(io.BytesIO(data))
            except Exception:
                logger.warning("pillow_heif indisponible, upload HEIC sans compression")
                return data, "heic"
        else:
            img = Image.open(io.BytesIO(data))

        # Resize si nécessaire
        w, h = img.size
        if max(w, h) > _MAX_DIM:
            ratio = _MAX_DIM / max(w, h)
            new_size = (int(w * ratio), int(h * ratio))
            img = img.resize(new_size, Image.LANCZOS)

        # Choix du format de sortie
        if img_type == "png" and img.mode == "RGBA":
            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=_JPEG_QUALITY, method=6)
            return buf.getvalue(), "webp"

        if img_type == "webp":
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=_JPEG_QUALITY, method=6)
            return buf.getvalue(), "webp"

        # Tous les autres → JPEG
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=_JPEG_QUALITY, optimize=True, progressive=True)
        return buf.getvalue(), "jpg"

    except Exception as exc:
        logger.warning(f"Compression échouée ({img_type}): {exc} — upload original")
        fallback_ext = {"jpeg": "jpg", "png": "png", "webp": "webp", "gif": "gif", "heic": "heic"}.get(img_type, "jpg")
        return data, fallback_ext


# ─── Upload ────────────────────────────────────────────────────────────────────

def upload_to_r2(data: bytes, folder: str, ext: str) -> str:
    """
    Upload `data` dans R2 sous `{folder}/img_{uuid}.{ext}`.
    Retourne l'URL publique CDN.
    """
    c = _cfg()
    filename = f"img_{uuid.uuid4().hex[:16]}.{ext}"
    key = f"{folder}/{filename}"
    content_type = _CONTENT_TYPES.get(ext, "application/octet-stream")

    client = _client()
    client.put_object(
        Bucket=c["bucket"],
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl="public, max-age=31536000",
    )

    url = f"{c['public_url']}/{key}"
    logger.info(f"R2 upload OK: {key} ({len(data)} bytes) → {url}")
    return url


# ─── Suppression ───────────────────────────────────────────────────────────────

def delete_from_r2(url: str):
    """
    Supprime l'objet R2 correspondant à l'URL publique.
    Ne lève pas d'exception si l'objet n'existe pas.
    """
    c = _cfg()
    if not c["public_url"] or not url.startswith(c["public_url"]):
        return

    key = url[len(c["public_url"]):].lstrip("/")
    if not key:
        return

    try:
        client = _client()
        client.delete_object(Bucket=c["bucket"], Key=key)
        logger.info(f"R2 delete OK: {key}")
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code not in ("NoSuchKey", "404"):
            logger.warning(f"R2 delete failed {key}: {exc}")
    except Exception as exc:
        logger.warning(f"R2 delete error {key}: {exc}")
