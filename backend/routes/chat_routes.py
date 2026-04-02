from fastapi import APIRouter, Request, HTTPException, WebSocket, WebSocketDisconnect, Query
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from models import new_id
from auth_utils import require_auth, decode_jwt
from database import get_pool, row_to_dict, rows_to_list
from chat_manager import manager, notif_manager, spotyou_manager
from push_service import send_push_to_user
import asyncio
import time
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


class ConversationCreate(BaseModel):
    type: str  # service | tagpoint_group | tagpoint_private
    context_id: str


class MessageCreate(BaseModel):
    content: str


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _get_unread_notif(conn, user_id: str) -> int:
    """Nombre de notifications non-lues en DB."""
    row = await conn.fetchrow(
        "SELECT COUNT(*) as cnt FROM notifications WHERE user_id = $1 AND read = FALSE",
        user_id
    )
    return int(row["cnt"]) if row else 0


async def _get_unread_total(conn, user_id: str) -> int:
    """Nombre total de messages non-lus pour un utilisateur."""
    row = await conn.fetchrow(
        """SELECT COUNT(*) as cnt FROM messages m
           JOIN conversation_participants cp
             ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
           WHERE m.created_at > cp.last_read_at AND m.sender_id != $1""",
        user_id
    )
    return int(row["cnt"]) if row else 0


async def _push_unread(conn, user_id: str):
    """Pousse le total non-lu en temps réel via le canal de notifications."""
    total = await _get_unread_total(conn, user_id)
    await notif_manager.notify(user_id, {"type": "unread_total", "count": total})


async def _resolve_title(conn, conv_type: str, context_id: str) -> str:
    if conv_type == "service":
        row = await conn.fetchrow("SELECT title FROM services WHERE service_id = $1", context_id)
        return row["title"] if row else context_id
    else:
        row = await conn.fetchrow("SELECT title FROM tag_points WHERE point_id = $1", context_id)
        return row["title"] if row else context_id


async def _enrich_conversations(conn, convs: list, current_user_id: str) -> list:
    """[DEPRECATED] Conservé pour compatibilité mais plus appelé — voir _batch_enrich_conversations."""
    return await _batch_enrich_conversations(None, conn, convs, current_user_id)


async def _batch_enrich_conversations(pool, conn, convs: list, current_user_id: str) -> list:
    """Enrichissement batch des conversations.

    Remplace le N+1 séquentiel (4 requêtes × N conversations = 849ms/conv).
    → 5 requêtes batch indépendantes en asyncio.gather quel que soit N.

    Peut utiliser soit un pool (pour les connexions parallèles) soit une connexion existante.
    """
    if not convs:
        return convs

    conv_ids = [c["conversation_id"] for c in convs]
    group_ids    = [c["conversation_id"] for c in convs if c["type"] == "tagpoint_group"]
    private_ids  = [c["conversation_id"] for c in convs if c["type"] != "tagpoint_group"]
    group_ctx_ids = [c["context_id"] for c in convs if c["type"] == "tagpoint_group"]

    # Choisir la source de connexion
    use_pool = pool is not None

    async def _fetch(coro_fn):
        if use_pool:
            async with pool.acquire() as c:
                return await coro_fn(c)
        else:
            return await coro_fn(conn)

    async def get_last_messages(c):
        return await c.fetch(
            """SELECT DISTINCT ON (m.conversation_id)
                      m.conversation_id, m.message_id,
                      CASE WHEN m.deleted_at IS NOT NULL THEN '[Message supprimé]' ELSE m.content END AS content,
                      m.created_at, m.sender_id,
                      COALESCE(u.name, 'Utilisateur supprimé') AS sender_name
               FROM messages m
               LEFT JOIN users u ON u.user_id = m.sender_id
               WHERE m.conversation_id = ANY($1::text[])
               ORDER BY m.conversation_id, m.created_at DESC""",
            conv_ids,
        )

    async def get_unread_counts(c):
        return await c.fetch(
            """SELECT m.conversation_id,
                      COUNT(*) FILTER (
                          WHERE m.created_at > cp.last_read_at
                            AND m.sender_id != $1
                      ) AS unread_count
               FROM messages m
               JOIN conversation_participants cp
                 ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
               WHERE m.conversation_id = ANY($2::text[])
               GROUP BY m.conversation_id""",
            current_user_id, conv_ids,
        )

    async def get_statuses(c):
        return await c.fetch(
            """SELECT conversation_id, status
               FROM conversation_participants
               WHERE conversation_id = ANY($1::text[]) AND user_id = $2""",
            conv_ids, current_user_id,
        )

    async def get_other_participants(c):
        if not private_ids:
            return []
        return await c.fetch(
            """SELECT cp.conversation_id, u.user_id, u.name, u.picture
               FROM conversation_participants cp
               JOIN users u ON u.user_id = cp.user_id
               WHERE cp.conversation_id = ANY($1::text[]) AND cp.user_id != $2""",
            private_ids, current_user_id,
        )

    async def get_group_data(c):
        counts, images = [], []
        if group_ids:
            counts = await c.fetch(
                """SELECT conversation_id, COUNT(*) AS cnt
                   FROM conversation_participants
                   WHERE conversation_id = ANY($1::text[])
                   GROUP BY conversation_id""",
                group_ids,
            )
        if group_ctx_ids:
            images = await c.fetch(
                "SELECT point_id, images FROM tag_points WHERE point_id = ANY($1::text[])",
                group_ctx_ids,
            )
        return counts, images

    if use_pool:
        (last_msgs, unread_rows, status_rows,
         other_rows, group_result) = await asyncio.gather(
            _fetch(get_last_messages),
            _fetch(get_unread_counts),
            _fetch(get_statuses),
            _fetch(get_other_participants),
            _fetch(get_group_data),
        )
    else:
        # Connexion unique — séquentiel mais avec une seule connexion (fallback)
        last_msgs    = await get_last_messages(conn)
        unread_rows  = await get_unread_counts(conn)
        status_rows  = await get_statuses(conn)
        other_rows   = await get_other_participants(conn)
        group_result = await get_group_data(conn)

    group_counts_rows, group_images_rows = group_result

    # ── Maps de lookup O(1) ────────────────────────────────────────────────
    last_msg_map  = {r["conversation_id"]: row_to_dict(r) for r in last_msgs}
    unread_map    = {r["conversation_id"]: int(r["unread_count"]) for r in unread_rows}
    status_map    = {r["conversation_id"]: r["status"] for r in status_rows}
    group_cnt_map = {r["conversation_id"]: int(r["cnt"]) for r in group_counts_rows}
    ctx_image_map : dict = {}
    for r in group_images_rows:
        imgs = r["images"]
        if isinstance(imgs, str):
            try:
                import json as _j
                imgs = _j.loads(imgs)
            except Exception:
                imgs = []
        ctx_image_map[r["point_id"]] = imgs[0] if imgs else None

    # Regrouper les autres participants par conversation
    other_by_conv: dict = {}
    for r in other_rows:
        cid = r["conversation_id"]
        other_by_conv.setdefault(cid, []).append(row_to_dict(r))

    # ── Assembler ──────────────────────────────────────────────────────────
    result = []
    for c in convs:
        cid = c["conversation_id"]
        msg = last_msg_map.get(cid)
        if msg:
            msg.pop("conversation_id", None)
        c["last_message"]   = msg
        c["unread_count"]   = unread_map.get(cid, 0)
        c["is_blocked"]     = (status_map.get(cid) == "blocked")

        if c["type"] != "tagpoint_group":
            others = other_by_conv.get(cid, [])
            c["other_participant"] = others[0] if others else None
        else:
            c["participant_count"] = group_cnt_map.get(cid, 0)
            c["other_participant"] = None
            c["context_image"]     = ctx_image_map.get(c.get("context_id", ""))

        result.append(c)
    return result


# ── HTTP Routes ────────────────────────────────────────────────────────────────

@router.post("/conversations")
async def create_or_get_conversation(data: ConversationCreate, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    uid = user["user_id"]

    if data.type not in ("service", "tagpoint_group", "tagpoint_private"):
        raise HTTPException(status_code=400, detail="Invalid conversation type")

    async with pool.acquire() as conn:
        title = await _resolve_title(conn, data.type, data.context_id)

        if data.type == "tagpoint_group":
            # Vérifier que l'utilisateur est membre ou créateur du SpotYou
            is_member_row = await conn.fetchrow(
                """SELECT 1 FROM spot_you_members WHERE spot_you_id = $1 AND user_id = $2
                   UNION
                   SELECT 1 FROM tag_points WHERE point_id = $1 AND user_id = $2""",
                data.context_id, uid
            )
            if not is_member_row:
                raise HTTPException(status_code=403, detail="Vous devez être membre de ce SpotYou pour accéder au groupe")

            # Only 1 group per tagpoint
            existing = await conn.fetchrow(
                "SELECT conversation_id FROM conversations WHERE type='tagpoint_group' AND context_id=$1",
                data.context_id
            )
            if existing:
                conv_id = existing["conversation_id"]
                # Ajouter l'utilisateur ou ré-activer s'il était bloqué
                await conn.execute(
                    """INSERT INTO conversation_participants (conversation_id, user_id, status)
                       VALUES ($1, $2, 'active')
                       ON CONFLICT (conversation_id, user_id)
                       DO UPDATE SET status = 'active'""",
                    conv_id, uid
                )
            else:
                conv_id = new_id("conv")
                creator_row = await conn.fetchrow(
                    "SELECT user_id FROM tag_points WHERE point_id = $1", data.context_id
                )
                creator_id = creator_row["user_id"] if creator_row else uid
                await conn.execute(
                    """INSERT INTO conversations (conversation_id, type, context_id, context_title, created_by)
                       VALUES ($1, 'tagpoint_group', $2, $3, $4)""",
                    conv_id, data.context_id, title, creator_id
                )
                # Add creator and current user as participants (both active)
                for pid in set([creator_id, uid]):
                    await conn.execute(
                        """INSERT INTO conversation_participants (conversation_id, user_id, status)
                           VALUES ($1, $2, 'active') ON CONFLICT DO NOTHING""",
                        conv_id, pid
                    )

        elif data.type == "tagpoint_private":
            # 1 private conv per (context_id, current_user) — current_user is the one who initiates
            existing = await conn.fetchrow(
                """SELECT c.conversation_id FROM conversations c
                   JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
                   WHERE c.type='tagpoint_private' AND c.context_id=$1 AND cp.user_id=$2
                   LIMIT 1""",
                data.context_id, uid
            )
            if existing:
                conv_id = existing["conversation_id"]
            else:
                conv_id = new_id("conv")
                creator_row = await conn.fetchrow(
                    "SELECT user_id FROM tag_points WHERE point_id = $1", data.context_id
                )
                creator_id = creator_row["user_id"] if creator_row else uid
                await conn.execute(
                    """INSERT INTO conversations (conversation_id, type, context_id, context_title, created_by)
                       VALUES ($1, 'tagpoint_private', $2, $3, $4)""",
                    conv_id, data.context_id, title, uid
                )
                for pid in set([creator_id, uid]):
                    await conn.execute(
                        """INSERT INTO conversation_participants (conversation_id, user_id)
                           VALUES ($1, $2) ON CONFLICT DO NOTHING""",
                        conv_id, pid
                    )

        else:  # service
            # 1 service conv per (context_id, user) — user is the non-coach
            existing = await conn.fetchrow(
                """SELECT c.conversation_id FROM conversations c
                   JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
                   WHERE c.type='service' AND c.context_id=$1 AND cp.user_id=$2
                   LIMIT 1""",
                data.context_id, uid
            )
            if existing:
                conv_id = existing["conversation_id"]
            else:
                conv_id = new_id("conv")
                coach_row = await conn.fetchrow(
                    "SELECT coach_id FROM services WHERE service_id = $1", data.context_id
                )
                coach_id = coach_row["coach_id"] if coach_row else uid
                await conn.execute(
                    """INSERT INTO conversations (conversation_id, type, context_id, context_title, created_by)
                       VALUES ($1, 'service', $2, $3, $4)""",
                    conv_id, data.context_id, title, uid
                )
                for pid in set([coach_id, uid]):
                    await conn.execute(
                        """INSERT INTO conversation_participants (conversation_id, user_id)
                           VALUES ($1, $2) ON CONFLICT DO NOTHING""",
                        conv_id, pid
                    )

        row = await conn.fetchrow(
            "SELECT conversation_id, type, context_id, context_title, created_by, last_message_at, created_at FROM conversations WHERE conversation_id = $1",
            conv_id
        )
    return row_to_dict(row)


@router.get("/conversations")
async def list_conversations(request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    uid = user["user_id"]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT c.conversation_id, c.type, c.context_id,
                      COALESCE(
                          CASE WHEN c.type IN ('tagpoint_private', 'tagpoint_group') THEN tp.title ELSE NULL END,
                          CASE WHEN c.type = 'service' THEN svc.title ELSE NULL END,
                          c.context_title
                      ) AS context_title,
                      c.created_by, c.last_message_at, c.created_at,
                      -- context_deleted : colonne DB (authoritative) + détection dynamique fallback
                      CASE
                          WHEN c.context_deleted = TRUE THEN TRUE
                          WHEN c.type IN ('tagpoint_private','tagpoint_group')
                               AND (tp.point_id IS NULL OR tp.active = FALSE OR tp.deleted_at IS NOT NULL)
                               THEN TRUE
                          WHEN c.type = 'service'
                               AND (svc.service_id IS NULL OR svc.active = FALSE OR svc.deleted_at IS NOT NULL)
                               THEN TRUE
                          ELSE FALSE
                      END AS context_deleted
               FROM conversations c
               LEFT JOIN tag_points tp
                   ON c.type IN ('tagpoint_private', 'tagpoint_group') AND tp.point_id = c.context_id
               LEFT JOIN services svc
                   ON c.type = 'service' AND svc.service_id = c.context_id
               JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
               WHERE cp.user_id = $1 AND c.deleted_at IS NULL
               ORDER BY c.last_message_at DESC NULLS LAST""",
            uid
        )
        convs = rows_to_list(rows)
    # Batch enrich avec pool pour asyncio.gather parallèle
    return await _batch_enrich_conversations(pool, None, convs, uid)


@router.get("/conversations/{conv_id}/messages")
async def get_messages(conv_id: str, request: Request, limit: int = Query(50, ge=1, le=100), before: Optional[str] = Query(None)):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        # Check access
        row = await conn.fetchrow(
            "SELECT 1 FROM conversation_participants WHERE conversation_id=$1 AND user_id=$2",
            conv_id, user["user_id"]
        )
        if not row:
            raise HTTPException(status_code=403, detail="Not a participant")

        if before:
            rows = await conn.fetch(
                """SELECT m.message_id, m.conversation_id, m.sender_id,
                          CASE WHEN m.deleted_at IS NOT NULL THEN '[Message supprimé]' ELSE m.content END AS content,
                          m.created_at, m.deleted_at,
                          COALESCE(u.name, 'Utilisateur supprimé') AS sender_name,
                          u.picture as sender_picture
                   FROM messages m LEFT JOIN users u ON m.sender_id = u.user_id
                   WHERE m.conversation_id = $1 AND m.created_at < $2::timestamptz
                   ORDER BY m.created_at DESC LIMIT $3""",
                conv_id, before, limit
            )
        else:
            rows = await conn.fetch(
                """SELECT m.message_id, m.conversation_id, m.sender_id,
                          CASE WHEN m.deleted_at IS NOT NULL THEN '[Message supprimé]' ELSE m.content END AS content,
                          m.created_at, m.deleted_at,
                          COALESCE(u.name, 'Utilisateur supprimé') AS sender_name,
                          u.picture as sender_picture
                   FROM messages m LEFT JOIN users u ON m.sender_id = u.user_id
                   WHERE m.conversation_id = $1
                   ORDER BY m.created_at DESC LIMIT $2""",
                conv_id, limit
            )
        messages = rows_to_list(rows)
        messages.reverse()  # chronological order

        # Mark as read + push notification
        await conn.execute(
            "UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id=$1 AND user_id=$2",
            conv_id, user["user_id"]
        )
        await _push_unread(conn, user["user_id"])
    return messages


@router.put("/conversations/{conv_id}/read")
async def mark_read(conv_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id=$1 AND user_id=$2",
            conv_id, user["user_id"]
        )
        await _push_unread(conn, user["user_id"])
    return {"success": True}


# ── WebSocket ──────────────────────────────────────────────────────────────────

MSG_MIN_INTERVAL = 0.5   # 500 ms entre messages (anti-spam)
MSG_MAX_BYTES    = 8192  # 8 Ko par message


# ── WebSocket Chat ──────────────────────────────────────────────────────────────

@router.websocket("/ws/chat/{conv_id}")
async def ws_chat(websocket: WebSocket, conv_id: str):
    """
    [SEC-14] Handshake sécurisé : accept() → attendre JSON {token} dans 5 s → valider → vérifier membre.
             Le token ne transite JAMAIS dans l'URL.
    [SEC-14] Permissions : si l'utilisateur n'est pas membre → close 4003.
    [SEC-15] Anti-spam : max 1 message / 500 ms ; max 8 Ko/message → close 4009.
    [SEC-16] Cleanup : except loggués + disconnect garanti dans finally.
    """
    pool = get_pool()

    # [SEC-14] Accepter AVANT l'auth (requis par le protocole WebSocket)
    await websocket.accept()

    # Attendre le message d'auth { "token": "..." } avec timeout 5 s
    try:
        auth_msg = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
        token = auth_msg.get("token", "")
    except asyncio.TimeoutError:
        logger.warning("[WS chat] Timeout handshake (conv=%s)", conv_id)
        await websocket.close(code=4001)
        return
    except Exception as exc:
        logger.warning("[WS chat] Erreur handshake (conv=%s): %s", conv_id, exc)
        await websocket.close(code=4001)
        return

    # Valider le JWT
    try:
        payload = decode_jwt(token)
    except Exception:
        await websocket.close(code=4001)
        return

    user_id = payload.get("user_id")
    if not user_id:
        await websocket.close(code=4001)
        return

    # [SEC-14] Vérifier que l'utilisateur est membre ACTIF de la conversation
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT 1 FROM conversation_participants WHERE conversation_id=$1 AND user_id=$2 AND status='active'",
            conv_id, user_id
        )
        if not row:
            logger.warning("[WS chat] Accès refusé (user=%s, conv=%s)", user_id, conv_id)
            await websocket.close(code=4003)
            return
        user_row = await conn.fetchrow(
            "SELECT user_id, name, picture FROM users WHERE user_id = $1", user_id
        )
        user_info = row_to_dict(user_row)
        # Charger l'état context_deleted (cache local pour la durée de la session WS)
        conv_meta = await conn.fetchrow(
            "SELECT context_deleted FROM conversations WHERE conversation_id = $1", conv_id
        )
        _context_deleted: bool = bool(conv_meta and conv_meta["context_deleted"]) if conv_meta else False

    manager.add(conv_id, websocket)

    # État anti-spam local à cette connexion
    _last_msg_time: float = 0.0

    try:
        while True:
            data = await websocket.receive_json()
            content = (data.get("content") or "").strip()
            if not content:
                continue

            # [SOFTDEL] Bloquer l'envoi si le contexte est supprimé
            if _context_deleted:
                await websocket.send_json({
                    "type":    "error",
                    "code":    "CONTEXT_DELETED",
                    "message": "Ce contexte a été supprimé. La conversation est en lecture seule.",
                })
                continue

            # [SEC-15] Limite de taille (8 Ko)
            if len(content.encode("utf-8")) > MSG_MAX_BYTES:
                logger.warning(
                    "[WS chat] Message trop grand (user=%s, conv=%s, size=%d)",
                    user_id, conv_id, len(content.encode("utf-8"))
                )
                await websocket.close(code=4009)
                break

            # [SEC-15] Limite de fréquence (1 msg / 500 ms) — rejet silencieux
            now = time.monotonic()
            if now - _last_msg_time < MSG_MIN_INTERVAL:
                continue
            _last_msg_time = now

            msg_id = new_id("msg")
            ts = datetime.now(timezone.utc)

            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO messages (message_id, conversation_id, sender_id, content, created_at) VALUES ($1,$2,$3,$4,$5)",
                    msg_id, conv_id, user_id, content, ts
                )
                await conn.execute(
                    "UPDATE conversations SET last_message_at = $1 WHERE conversation_id = $2",
                    ts, conv_id
                )

            await manager.broadcast(conv_id, {
                "message_id": msg_id,
                "conversation_id": conv_id,
                "sender_id": user_id,
                "sender_name": user_info["name"],
                "sender_picture": user_info.get("picture"),
                "content": content,
                "created_at": ts.isoformat(),
            })

            async with pool.acquire() as conn2:
                participants = await conn2.fetch(
                    "SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id != $2 AND status = 'active'",
                    conv_id, user_id
                )
                participant_ids = [p["user_id"] for p in participants]
                for p in participants:
                    await _push_unread(conn2, p["user_id"])

            for pid in participant_ids:
                asyncio.create_task(send_push_to_user(
                    pool, pid,
                    title=user_info["name"],
                    body=content[:100],
                    data={"type": "chat_message", "conversationId": conv_id},
                    store=False,  # Les messages chat n'apparaissent PAS dans les notifications
                ))

    except WebSocketDisconnect:
        logger.info("[WS chat] Déconnexion propre (user=%s, conv=%s)", user_id, conv_id)
    except Exception as exc:
        logger.warning("[WS chat] Erreur inattendue (user=%s, conv=%s): %s", user_id, conv_id, exc)
    finally:
        # [SEC-16] Garantir le nettoyage même en cas d'exception
        manager.disconnect(conv_id, websocket)


# ── WebSocket Notifications ────────────────────────────────────────────────────

@router.websocket("/ws/notifications")
async def ws_notifications(websocket: WebSocket):
    """
    Canal personnel de notifications temps réel.
    [SEC-14] Handshake sécurisé : accept() → attendre JSON {token} dans 5 s → valider.
             Le token ne transite JAMAIS dans l'URL.
    [SEC-16] Cleanup : except loggués + disconnect garanti dans finally.
    """
    pool = get_pool()

    # [SEC-14] Accepter AVANT l'auth
    await websocket.accept()

    try:
        auth_msg = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
        token = auth_msg.get("token", "")
    except asyncio.TimeoutError:
        logger.warning("[WS notif] Timeout handshake")
        await websocket.close(code=4001)
        return
    except Exception as exc:
        logger.warning("[WS notif] Erreur handshake: %s", exc)
        await websocket.close(code=4001)
        return

    try:
        payload = decode_jwt(token)
    except Exception:
        await websocket.close(code=4001)
        return

    user_id = payload.get("user_id")
    if not user_id:
        await websocket.close(code=4001)
        return

    notif_manager.add(user_id, websocket)

    try:
        async with pool.acquire() as conn:
            total = await _get_unread_total(conn, user_id)
            notif_unread = await _get_unread_notif(conn, user_id)
        await websocket.send_json({"type": "unread_total", "count": total})
        await websocket.send_json({"type": "unread_notif", "count": notif_unread})

        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        logger.info("[WS notif] Déconnexion propre (user=%s)", user_id)
    except Exception as exc:
        logger.warning("[WS notif] Erreur inattendue (user=%s): %s", user_id, exc)
    finally:
        # [SEC-16] Garantir le nettoyage
        notif_manager.disconnect(user_id, websocket)



# ── WebSocket SpotYou (mises à jour temps réel) ────────────────────────────────

@router.websocket("/ws/spot-you/{point_id}")
async def ws_spot_you(websocket: WebSocket, point_id: str):
    """
    Canal temps réel pour un SpotYou.
    [SEC-14] Authentification via premier message JSON {token}.
    Reçoit les événements spotyou_update : participants_count, going_count, is_full.
    Pas d'envoi de messages depuis le client (lecture seule).
    """
    pool = get_pool()
    await websocket.accept()

    try:
        auth_msg = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
        token = auth_msg.get("token", "")
    except asyncio.TimeoutError:
        logger.warning("[WS spotyou] Timeout handshake (point=%s)", point_id)
        await websocket.close(code=4001)
        return
    except Exception as exc:
        logger.warning("[WS spotyou] Erreur handshake (point=%s): %s", point_id, exc)
        await websocket.close(code=4001)
        return

    try:
        payload = decode_jwt(token)
    except Exception:
        await websocket.close(code=4001)
        return

    user_id = payload.get("user_id")
    if not user_id:
        await websocket.close(code=4001)
        return

    spotyou_manager.add(point_id, websocket)
    logger.info("[WS spotyou] Connecté (user=%s, point=%s)", user_id, point_id)

    try:
        # Keep-alive : le client ne doit pas envoyer de messages —
        # on attend juste la déconnexion ou un ping optionnel.
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        logger.info("[WS spotyou] Déconnexion propre (user=%s, point=%s)", user_id, point_id)
    except Exception as exc:
        logger.warning("[WS spotyou] Erreur inattendue (user=%s, point=%s): %s", user_id, point_id, exc)
    finally:
        spotyou_manager.disconnect(point_id, websocket)
