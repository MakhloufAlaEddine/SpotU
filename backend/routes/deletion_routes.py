"""
Routes de suppression logique (soft delete) — Phases 1, 2 & 3
Stratégie d'audit AUDIT_SUPPRESSION.md

Endpoints:
  DELETE /users/{user_id}           Anonymisation RGPD complète
  DELETE /tag-points/{point_id}     Soft delete SpotYou + nettoyage convs
  DELETE /messages/{message_id}     Soft delete message (contenu masqué)
  PATCH  /conversations/{conv_id}/leave  Quitter une conversation
"""

from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
import logging
import json as _j

from auth_utils import require_auth
from database import get_pool, row_to_dict

router = APIRouter()
logger = logging.getLogger(__name__)


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


async def _schedule_file_deletions(conn, entity_type: str, entity_id: str, images_raw) -> int:
    """Enregistre les images dans pending_file_deletions pour purge différée."""
    imgs = _parse_images(images_raw)
    count = 0
    for url in imgs:
        if url:
            await conn.execute(
                "INSERT INTO pending_file_deletions(file_url,entity_type,entity_id) VALUES($1,$2,$3)",
                url, entity_type, entity_id
            )
            count += 1
    return count


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
                "UPDATE tag_points SET active=FALSE, deleted_at=$1, deleted_by=$2 WHERE point_id=ANY($3::text[])",
                now, caller["user_id"], pt_ids
            )
            await _mark_conversations_context_deleted(conn, pt_ids)
            for tp in tag_points:
                await _schedule_file_deletions(conn, "tag_point", tp["point_id"], tp["images"])

        # 3. Soft-delete services + marquer conversations context_deleted
        services = await conn.fetch(
            "SELECT service_id, images FROM services WHERE coach_id=$1 AND active=TRUE AND deleted_at IS NULL",
            user_id
        )
        if services:
            svc_ids = [r["service_id"] for r in services]
            await conn.execute(
                "UPDATE services SET active=FALSE, deleted_at=$1, deleted_by=$2 WHERE service_id=ANY($3::text[])",
                now, caller["user_id"], svc_ids
            )
            await _mark_conversations_context_deleted(conn, svc_ids)
            for svc in services:
                await _schedule_file_deletions(conn, "service", svc["service_id"], svc["images"])

        # 4. Soft-delete produits marketplace
        await conn.execute(
            """UPDATE marketplace_products
               SET status='deleted', deleted_at=$1, deleted_by=$2
               WHERE seller_id=$3 AND status != 'deleted' AND deleted_at IS NULL""",
            now, caller["user_id"], user_id
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

        # Soft-delete
        await conn.execute(
            """UPDATE tag_points
               SET active=FALSE, deleted_at=$1, deleted_by=$2, updated_at=$1
               WHERE point_id=$3""",
            now, caller["user_id"], point_id
        )

        # Marquer conversations context_deleted
        n_convs = await _mark_conversations_context_deleted(conn, [point_id])

        # Programmer suppression images
        n_imgs = await _schedule_file_deletions(conn, "tag_point", point_id, tp["images"])

    logger.info("[SOFTDEL] SpotYou %s supprimé par %s", point_id, caller["user_id"])
    return {
        "success":               True,
        "deleted":               True,
        "point_id":              point_id,
        "conversations_marked":  n_convs,
        "images_queued":         n_imgs,
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
