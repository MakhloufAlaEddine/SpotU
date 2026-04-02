"""
Routes de suppression logique (soft delete) + réactivation — Phases 1, 2, 3 & 5

Endpoints:
  DELETE /users/{user_id}                   Anonymisation RGPD complète
  PATCH  /users/{user_id}/deactivate        Désactivation réversible (garde les médias 90j)
  POST   /users/{user_id}/reactivate        Réactivation profil uniquement (pas cascade)
  DELETE /tag-points/{point_id}             Soft delete SpotYou
  POST   /tag-points/{point_id}/reactivate  Réactivation SpotYou
  DELETE /messages/{message_id}             Soft delete message (contenu masqué)
  PATCH  /conversations/{conv_id}/leave     Quitter une conversation
  GET    /users/me/reactivatable            Entités désactivées de l'utilisateur courant
"""

from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone, timedelta
import asyncio
import logging
import json as _j

from auth_utils import require_auth
from database import get_pool, row_to_dict

router = APIRouter()
logger = logging.getLogger(__name__)

MEDIA_RETENTION_DAYS = 90


# ── Helpers ────────────────────────────────────────────────────────────────────

def _parse_images(raw) -> list:
    if not raw:
        return []
    if isinstance(raw, str):
        try:
            return _j.loads(raw)
        except Exception:
            return []
    if isinstance(raw, list):
        return raw
    return []


async def _schedule_file_deletions(
    conn, entity_type: str, entity_id: str, images_raw,
    scheduled_at=None
) -> int:
    """Enregistre les images dans pending_file_deletions pour purge différée.
    Par défaut scheduled_at = NOW() + 90j (rétention 90 jours).
    """
    if scheduled_at is None:
        scheduled_at = datetime.now(timezone.utc) + timedelta(days=MEDIA_RETENTION_DAYS)
    imgs = _parse_images(images_raw)
    count = 0
    for url in imgs:
        if url:
            await conn.execute(
                """INSERT INTO pending_file_deletions(file_url,entity_type,entity_id,scheduled_at)
                   VALUES($1,$2,$3,$4)
                   ON CONFLICT DO NOTHING""",
                url, entity_type, entity_id, scheduled_at
            )
            count += 1
    return count


async def _cancel_file_deletions(conn, entity_id: str) -> int:
    """Annule les suppressions de fichiers en attente pour une entité réactivée."""
    result = await conn.execute(
        "DELETE FROM pending_file_deletions WHERE entity_id=$1 AND status='pending'",
        entity_id
    )
    # asyncpg retourne "DELETE N"
    try:
        return int(result.split()[-1])
    except Exception:
        return 0


async def _mark_conversations_context_deleted(conn, context_ids: list[str]) -> int:
    """Marque toutes les conversations liées à ces context_ids comme context_deleted."""
    if not context_ids:
        return 0
    rows = await conn.fetch(
        """UPDATE conversations SET context_deleted = TRUE
           WHERE context_id = ANY($1::text[]) AND context_deleted = FALSE
           RETURNING conversation_id""",
        context_ids
    )
    return len(rows)


# ── DELETE /users/{user_id} — Anonymisation RGPD ──────────────────────────────

@router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    """
    Suppression logique + anonymisation RGPD d'un utilisateur.

    Guards:
    - Seul l'utilisateur lui-même ou un admin peut supprimer
    - Bloqué si bookings actifs (sauf admin)

    Actions:
    1. Snapshot noms dans reviews
    2. Soft-delete SpotYou → mark conversations context_deleted
    3. Soft-delete services → mark conversations context_deleted
    4. Soft-delete produits marketplace
    5. Anonymiser toutes les PII (name, email, phone, picture, iban…)
    6. SET deleted_at + anonymized_at
    7. Révoquer push_tokens + saved_addresses
    """
    pool = get_pool()
    caller = await require_auth(request, pool)
    is_admin = caller.get("role") == "admin"
    is_self = caller["user_id"] == user_id

    if not is_self and not is_admin:
        raise HTTPException(status_code=403, detail="Non autorisé à supprimer ce compte")

    now = datetime.now(timezone.utc)
    media_purge_at = now + timedelta(days=MEDIA_RETENTION_DAYS)

    async with pool.acquire() as conn:
        target = await conn.fetchrow(
            "SELECT user_id, name, deleted_at FROM users WHERE user_id = $1", user_id
        )
        if not target:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable")
        if target["deleted_at"]:
            raise HTTPException(status_code=409, detail="Ce compte est déjà supprimé")

        # Guard : bookings actifs
        if not is_admin:
            active_bookings = await conn.fetchval(
                """SELECT COUNT(*) FROM bookings
                   WHERE status IN ('pending','accepted','awaiting_payment','confirmed')
                     AND (
                         COALESCE(payer_user_id, user_id) = $1
                         OR COALESCE(receiver_user_id, coach_id) = $1
                     )""",
                user_id
            )
            if active_bookings and int(active_bookings) > 0:
                raise HTTPException(
                    status_code=409,
                    detail=f"Impossible : {int(active_bookings)} réservation(s) active(s). Annulez-les d'abord."
                )

        # 1. Snapshot noms dans reviews avant anonymisation
        await conn.execute(
            """UPDATE reviews r SET reviewer_name_snapshot = u.name
               FROM users u
               WHERE u.user_id = $1 AND r.reviewer_id = $1
                 AND r.reviewer_name_snapshot IS NULL""",
            user_id
        )
        await conn.execute(
            """UPDATE reviews r SET reviewee_name_snapshot = u.name
               FROM users u
               WHERE u.user_id = $1 AND r.reviewee_id = $1
                 AND r.reviewee_name_snapshot IS NULL""",
            user_id
        )

        # 2. Soft-delete SpotYou + marquer conversations context_deleted
        tag_points = await conn.fetch(
            "SELECT point_id, images FROM tag_points WHERE user_id=$1 AND active=TRUE AND deleted_at IS NULL",
            user_id
        )
        if tag_points:
            pt_ids = [r["point_id"] for r in tag_points]
            await conn.execute(
                """UPDATE tag_points SET active=FALSE, deleted_at=$1, deleted_by=$2,
                   media_purge_scheduled_at=$3 WHERE point_id=ANY($4::text[])""",
                now, caller["user_id"], media_purge_at, pt_ids
            )
            await _mark_conversations_context_deleted(conn, pt_ids)
            for tp in tag_points:
                await _schedule_file_deletions(
                    conn, "tag_point", tp["point_id"], tp["images"], scheduled_at=media_purge_at
                )

        # 3. Soft-delete services + marquer conversations context_deleted
        services = await conn.fetch(
            "SELECT service_id, images FROM services WHERE coach_id=$1 AND active=TRUE AND deleted_at IS NULL",
            user_id
        )
        if services:
            svc_ids = [r["service_id"] for r in services]
            await conn.execute(
                """UPDATE services SET active=FALSE, deleted_at=$1, deleted_by=$2,
                   media_purge_scheduled_at=$3 WHERE service_id=ANY($4::text[])""",
                now, caller["user_id"], media_purge_at, svc_ids
            )
            await _mark_conversations_context_deleted(conn, svc_ids)
            for svc in services:
                await _schedule_file_deletions(
                    conn, "service", svc["service_id"], svc["images"], scheduled_at=media_purge_at
                )

        # 4. Soft-delete produits marketplace
        prod_rows = await conn.fetch(
            "SELECT product_id, image_urls FROM marketplace_products WHERE seller_id=$1 AND status != 'deleted' AND deleted_at IS NULL",
            user_id
        )
        if prod_rows:
            prod_ids = [r["product_id"] for r in prod_rows]
            await conn.execute(
                """UPDATE marketplace_products
                   SET status='deleted', deleted_at=$1, deleted_by=$2, media_purge_scheduled_at=$3
                   WHERE product_id=ANY($4::text[])""",
                now, caller["user_id"], media_purge_at, prod_ids
            )
            for p in prod_rows:
                raw = p["image_urls"]
                imgs = raw if isinstance(raw, list) else (_j.loads(raw) if isinstance(raw, str) else [])
                await _schedule_file_deletions(
                    conn, "product", p["product_id"], imgs, scheduled_at=media_purge_at
                )

        # 5 + 6. Anonymisation PII + soft delete
        anon_email = f"deleted_{user_id}@anonymized.invalid"
        await conn.execute(
            """UPDATE users SET
                name          = 'Utilisateur supprimé',
                email         = $1,
                phone         = NULL,
                picture       = NULL,
                cover_picture = NULL,
                bio           = NULL,
                iban          = NULL,
                bic           = NULL,
                iban_name     = NULL,
                deleted_at    = $2,
                deleted_by    = $3,
                anonymized_at = $2,
                updated_at    = $2
               WHERE user_id = $4""",
            anon_email, now, caller["user_id"], user_id
        )

        # 7. Révoquer tokens de session
        await conn.execute("DELETE FROM push_tokens WHERE user_id=$1", user_id)
        await conn.execute("DELETE FROM user_saved_addresses WHERE user_id=$1", user_id)

    logger.info("[RGPD] Utilisateur %s supprimé/anonymisé par %s", user_id, caller["user_id"])
    return {
        "success":    True,
        "deleted":    True,
        "anonymized": True,
        "user_id":    user_id,
    }


# ── DELETE /tag-points/{point_id} — Soft delete SpotYou ──────────────────────

@router.delete("/tag-points/{point_id}")
async def delete_tag_point(point_id: str, request: Request):
    """
    Suppression logique d'un SpotYou.

    Guards:
    - Seul le créateur ou un admin peut supprimer

    Actions:
    1. active=FALSE + deleted_at
    2. Toutes les conversations liées → context_deleted=TRUE
    3. Images → pending_file_deletions (purge différée)
    """
    pool = get_pool()
    caller = await require_auth(request, pool)
    is_admin = caller.get("role") == "admin"
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        tp = await conn.fetchrow(
            "SELECT user_id, images, title, deleted_at FROM tag_points WHERE point_id=$1",
            point_id
        )
        if not tp:
            raise HTTPException(status_code=404, detail="SpotYou introuvable")
        if tp["deleted_at"]:
            raise HTTPException(status_code=409, detail="Ce SpotYou est déjà supprimé")
        if tp["user_id"] != caller["user_id"] and not is_admin:
            raise HTTPException(status_code=403, detail="Non autorisé")

        media_purge_at = now + timedelta(days=MEDIA_RETENTION_DAYS)

        # Soft-delete + planification purge 90j
        await conn.execute(
            """UPDATE tag_points
               SET active=FALSE, deleted_at=$1, deleted_by=$2, updated_at=$1,
                   media_purge_scheduled_at=$3
               WHERE point_id=$4""",
            now, caller["user_id"], media_purge_at, point_id
        )

        # Marquer conversations context_deleted
        n_convs = await _mark_conversations_context_deleted(conn, [point_id])

        # Programmer suppression images dans 90j
        n_imgs = await _schedule_file_deletions(
            conn, "tag_point", point_id, tp["images"], scheduled_at=media_purge_at
        )

    logger.info("[SOFTDEL] SpotYou %s supprimé par %s (médias dans %dj)", point_id, caller["user_id"], MEDIA_RETENTION_DAYS)
    return {
        "success":               True,
        "deleted":               True,
        "point_id":              point_id,
        "conversations_marked":  n_convs,
        "images_queued":         n_imgs,
        "media_purge_scheduled_at": media_purge_at.isoformat(),
    }


# ── POST /tag-points/{point_id}/reactivate — Réactivation SpotYou ────────────

@router.post("/tag-points/{point_id}/reactivate")
async def reactivate_tag_point(point_id: str, request: Request):
    """
    Réactive un SpotYou désactivé.

    - < 90j : restauration complète avec médias
    - ≥ 90j (media_purged=TRUE) : restauration sans médias
      (requires_media_reupload=True dans la réponse)

    La réactivation d'un profil utilisateur NE cascade PAS sur ses SpotYou —
    chaque SpotYou doit être réactivé manuellement.
    """
    pool = get_pool()
    caller = await require_auth(request, pool)
    is_admin = caller.get("role") == "admin"
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        tp = await conn.fetchrow(
            """SELECT user_id, deleted_at, active, media_purged, title
               FROM tag_points WHERE point_id=$1""",
            point_id
        )
        if not tp:
            raise HTTPException(status_code=404, detail="SpotYou introuvable")
        if tp["active"] and not tp["deleted_at"]:
            raise HTTPException(status_code=409, detail="Ce SpotYou est déjà actif")
        if tp["user_id"] != caller["user_id"] and not is_admin:
            raise HTTPException(status_code=403, detail="Non autorisé")

        # Annuler les suppressions de fichiers en attente
        cancelled = await _cancel_file_deletions(conn, point_id)

        # Réactiver
        await conn.execute(
            """UPDATE tag_points
               SET active=TRUE, deleted_at=NULL, deleted_by=NULL, updated_at=$1,
                   media_purge_scheduled_at=NULL, media_purge_notified_at=NULL,
                   reactivated_at=$1
               WHERE point_id=$2""",
            now, point_id
        )

        # Rouvrir les conversations archivées liées
        await conn.execute(
            """UPDATE conversations SET context_deleted=FALSE
               WHERE context_id=$1 AND context_deleted=TRUE""",
            point_id
        )

    media_purged = tp["media_purged"]
    logger.info("[REACTIVATE] SpotYou %s réactivé par %s (médias_purgés=%s)", point_id, caller["user_id"], media_purged)
    return {
        "success":               True,
        "reactivated":           True,
        "point_id":              point_id,
        "media_purged":          media_purged,
        "requires_media_reupload": media_purged,
        "pending_deletions_cancelled": cancelled,
    }


# ── DELETE /messages/{message_id} — Soft delete message ──────────────────────

@router.delete("/messages/{message_id}")
async def delete_message(message_id: str, request: Request):
    """
    Suppression logique d'un message.
    À l'affichage, le contenu est remplacé par '[Message supprimé]'.

    Guards:
    - Seul l'auteur ou un admin peut supprimer
    """
    pool = get_pool()
    caller = await require_auth(request, pool)
    is_admin = caller.get("role") == "admin"
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        msg = await conn.fetchrow(
            "SELECT message_id, sender_id, conversation_id, deleted_at FROM messages WHERE message_id=$1",
            message_id
        )
        if not msg:
            raise HTTPException(status_code=404, detail="Message introuvable")
        if msg["deleted_at"]:
            return {"success": True, "already_deleted": True}
        if msg["sender_id"] != caller["user_id"] and not is_admin:
            raise HTTPException(status_code=403, detail="Non autorisé à supprimer ce message")

        await conn.execute(
            "UPDATE messages SET deleted_at=$1 WHERE message_id=$2",
            now, message_id
        )

    # Broadcaster la suppression en temps réel aux participants connectés
    conv_id = msg["conversation_id"]
    from chat_manager import manager
    await manager.broadcast(conv_id, {
        "type":            "message_deleted",
        "message_id":      message_id,
        "conversation_id": conv_id,
    })

    return {"success": True, "deleted": True, "message_id": message_id}


# ── PATCH /conversations/{conv_id}/leave ─────────────────────────────────────

@router.patch("/conversations/{conv_id}/leave")
async def leave_conversation(conv_id: str, request: Request):
    """
    Quitter une conversation (status participant → 'left').
    Si plus aucun participant actif → conversation marquée deleted_at.
    """
    pool = get_pool()
    caller = await require_auth(request, pool)
    uid = caller["user_id"]

    async with pool.acquire() as conn:
        part = await conn.fetchrow(
            "SELECT status FROM conversation_participants WHERE conversation_id=$1 AND user_id=$2",
            conv_id, uid
        )
        if not part:
            raise HTTPException(status_code=404, detail="Vous n'êtes pas participant de cette conversation")
        if part["status"] == "left":
            return {"success": True, "already_left": True}

        await conn.execute(
            "UPDATE conversation_participants SET status='left' WHERE conversation_id=$1 AND user_id=$2",
            conv_id, uid
        )

        # Auto-archivage si plus personne d'actif
        remaining = await conn.fetchval(
            "SELECT COUNT(*) FROM conversation_participants WHERE conversation_id=$1 AND status='active'",
            conv_id
        )
        if remaining == 0:
            await conn.execute(
                "UPDATE conversations SET deleted_at=NOW() WHERE conversation_id=$1 AND deleted_at IS NULL",
                conv_id
            )

    return {"success": True, "left": True, "conversation_id": conv_id}


# ── PATCH /users/{user_id}/deactivate — Désactivation réversible ──────────────

@router.patch("/users/{user_id}/deactivate")
async def deactivate_user(user_id: str, request: Request):
    """
    Désactivation réversible d'un profil utilisateur.

    Différent du DELETE RGPD : la PII est conservée, le compte peut être réactivé.
    Les médias sont conservés 90 jours (media_purge_scheduled_at).

    RÈGLE CRITIQUE : les SpotYou / services / produits de l'utilisateur sont
    également désactivés, mais NE SERONT PAS réactivés automatiquement lors
    de la réactivation du profil — chaque entité doit être réactivée manuellement.
    """
    pool = get_pool()
    caller = await require_auth(request, pool)
    is_admin = caller.get("role") == "admin"
    is_self = caller["user_id"] == user_id

    if not is_self and not is_admin:
        raise HTTPException(status_code=403, detail="Non autorisé")

    now = datetime.now(timezone.utc)
    media_purge_at = now + timedelta(days=MEDIA_RETENTION_DAYS)

    async with pool.acquire() as conn:
        target = await conn.fetchrow(
            "SELECT user_id, deleted_at FROM users WHERE user_id=$1", user_id
        )
        if not target:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable")
        if target["deleted_at"]:
            raise HTTPException(status_code=409, detail="Ce compte est déjà désactivé")

        # Désactivation profil
        await conn.execute(
            """UPDATE users SET deleted_at=$1, deleted_by=$2, media_purge_scheduled_at=$3, updated_at=$1
               WHERE user_id=$4""",
            now, caller["user_id"], media_purge_at, user_id
        )

        # Désactiver SpotYou en cascade
        tp_rows = await conn.fetch(
            "SELECT point_id, images FROM tag_points WHERE user_id=$1 AND active=TRUE AND deleted_at IS NULL",
            user_id
        )
        if tp_rows:
            pt_ids = [r["point_id"] for r in tp_rows]
            await conn.execute(
                """UPDATE tag_points SET active=FALSE, deleted_at=$1, deleted_by=$2,
                   media_purge_scheduled_at=$3 WHERE point_id=ANY($4::text[])""",
                now, caller["user_id"], media_purge_at, pt_ids
            )
            await _mark_conversations_context_deleted(conn, pt_ids)
            for tp in tp_rows:
                await _schedule_file_deletions(
                    conn, "tag_point", tp["point_id"], tp["images"], scheduled_at=media_purge_at
                )

        # Désactiver services en cascade
        svc_rows = await conn.fetch(
            "SELECT service_id, images FROM services WHERE coach_id=$1 AND active=TRUE AND deleted_at IS NULL",
            user_id
        )
        if svc_rows:
            svc_ids = [r["service_id"] for r in svc_rows]
            await conn.execute(
                """UPDATE services SET active=FALSE, deleted_at=$1, deleted_by=$2,
                   media_purge_scheduled_at=$3 WHERE service_id=ANY($4::text[])""",
                now, caller["user_id"], media_purge_at, svc_ids
            )
            await _mark_conversations_context_deleted(conn, svc_ids)
            for svc in svc_rows:
                await _schedule_file_deletions(
                    conn, "service", svc["service_id"], svc["images"], scheduled_at=media_purge_at
                )

        # Désactiver produits en cascade
        prod_rows = await conn.fetch(
            "SELECT product_id, image_urls FROM marketplace_products WHERE seller_id=$1 AND status != 'deleted' AND deleted_at IS NULL",
            user_id
        )
        if prod_rows:
            prod_ids = [r["product_id"] for r in prod_rows]
            await conn.execute(
                """UPDATE marketplace_products SET status='deleted', deleted_at=$1, deleted_by=$2,
                   media_purge_scheduled_at=$3 WHERE product_id=ANY($4::text[])""",
                now, caller["user_id"], media_purge_at, prod_ids
            )

    logger.info("[DEACTIVATE] Utilisateur %s désactivé par %s (médias dans %dj)", user_id, caller["user_id"], MEDIA_RETENTION_DAYS)
    return {
        "success":                True,
        "deactivated":            True,
        "user_id":                user_id,
        "media_purge_scheduled_at": media_purge_at.isoformat(),
        "spotyou_count":          len(tp_rows) if tp_rows else 0,
        "services_count":         len(svc_rows) if svc_rows else 0,
        "products_count":         len(prod_rows) if prod_rows else 0,
    }


# ── POST /users/{user_id}/reactivate — Réactivation profil seulement ─────────

@router.post("/users/{user_id}/reactivate")
async def reactivate_user(user_id: str, request: Request):
    """
    Réactive un profil utilisateur.

    RÈGLE CRITIQUE : les SpotYou / services / produits NE SONT PAS réactivés
    automatiquement. L'utilisateur doit les réactiver manuellement un par un.

    - < 90j : profil restauré normalement
    - ≥ 90j (media_purged=TRUE) : profil restauré, photos de profil manquantes
    """
    pool = get_pool()
    caller = await require_auth(request, pool)
    is_admin = caller.get("role") == "admin"
    is_self = caller["user_id"] == user_id

    if not is_self and not is_admin:
        raise HTTPException(status_code=403, detail="Non autorisé")

    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        target = await conn.fetchrow(
            "SELECT user_id, deleted_at, media_purged FROM users WHERE user_id=$1", user_id
        )
        if not target:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable")
        if not target["deleted_at"]:
            raise HTTPException(status_code=409, detail="Ce compte est déjà actif")

        # Annuler la purge des fichiers du profil
        await _cancel_file_deletions(conn, user_id)

        # Réactiver profil seulement
        await conn.execute(
            """UPDATE users
               SET deleted_at=NULL, deleted_by=NULL, updated_at=$1,
                   media_purge_scheduled_at=NULL, media_purge_notified_at=NULL,
                   reactivated_at=$1
               WHERE user_id=$2""",
            now, user_id
        )

    media_purged = target["media_purged"]
    logger.info("[REACTIVATE] Utilisateur %s réactivé (médias_purgés=%s)", user_id, media_purged)
    return {
        "success":                 True,
        "reactivated":             True,
        "user_id":                 user_id,
        "media_purged":            media_purged,
        "requires_media_reupload": media_purged,
        "warning":                 "Vos SpotYou, services et produits restent désactivés. Réactivez-les manuellement.",
    }


# ── GET /users/me/reactivatable — Toutes les entités désactivées ──────────────

@router.get("/users/me/reactivatable")
async def get_reactivatable(request: Request):
    """
    Retourne toutes les entités désactivées de l'utilisateur courant :
    SpotYou, Services et Produits, avec le nombre de jours restants
    avant purge des médias.
    """
    pool = get_pool()
    caller = await require_auth(request, pool)
    uid = caller["user_id"]
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        tp_rows = await conn.fetch(
            """SELECT point_id AS id, title, images AS image_data,
                      deleted_at, media_purge_scheduled_at, media_purged, reactivated_at
               FROM tag_points
               WHERE user_id=$1 AND deleted_at IS NOT NULL
                 AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
               ORDER BY deleted_at DESC""",
            uid
        )
        svc_rows = await conn.fetch(
            """SELECT service_id AS id, title, images AS image_data,
                      deleted_at, media_purge_scheduled_at, media_purged, reactivated_at
               FROM services
               WHERE coach_id=$1 AND deleted_at IS NOT NULL
                 AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
               ORDER BY deleted_at DESC""",
            uid
        )
        prod_rows = await conn.fetch(
            """SELECT product_id AS id, title, image_urls AS image_data,
                      deleted_at, media_purge_scheduled_at, media_purged, reactivated_at
               FROM marketplace_products
               WHERE seller_id=$1 AND deleted_at IS NOT NULL
                 AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
               ORDER BY deleted_at DESC""",
            uid
        )

    def _fmt(rows, entity_type: str) -> list:
        result = []
        for r in rows:
            mpsa = r["media_purge_scheduled_at"]
            days_left = None
            if mpsa:
                delta = (mpsa.replace(tzinfo=timezone.utc) if mpsa.tzinfo is None else mpsa) - now
                days_left = max(0, delta.days)
            # Thumbnail
            img_data = r["image_data"]
            thumb = None
            if isinstance(img_data, list) and img_data:
                thumb = img_data[0]
            elif isinstance(img_data, str):
                try:
                    parsed = _j.loads(img_data)
                    thumb = parsed[0] if parsed else None
                except Exception:
                    pass
            result.append({
                "id":                       r["id"],
                "type":                     entity_type,
                "title":                    r["title"],
                "thumbnail":                thumb,
                "deleted_at":               r["deleted_at"].isoformat() if r["deleted_at"] else None,
                "media_purge_scheduled_at": mpsa.isoformat() if mpsa else None,
                "days_until_media_purge":   days_left,
                "media_purged":             r["media_purged"],
            })
        return result

    return {
        "spotyous": _fmt(tp_rows, "spotyou"),
        "services": _fmt(svc_rows, "service"),
        "products": _fmt(prod_rows, "product"),
        "total":    len(tp_rows) + len(svc_rows) + len(prod_rows),
    }


import asyncio