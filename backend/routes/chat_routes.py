from fastapi import APIRouter, Request, HTTPException, WebSocket, WebSocketDisconnect, Query
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from models import new_id
from auth_utils import require_auth, decode_jwt
from database import get_pool, row_to_dict, rows_to_list
from chat_manager import manager, notif_manager

router = APIRouter()


class ConversationCreate(BaseModel):
    type: str  # service | tagpoint_group | tagpoint_private
    context_id: str


class MessageCreate(BaseModel):
    content: str


# ── Helpers ────────────────────────────────────────────────────────────────────

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
    result = []
    for c in convs:
        # Last message
        msg_row = await conn.fetchrow(
            """SELECT m.message_id, m.content, m.created_at, m.sender_id, u.name as sender_name
               FROM messages m JOIN users u ON m.sender_id = u.user_id
               WHERE m.conversation_id = $1 ORDER BY m.created_at DESC LIMIT 1""",
            c["conversation_id"]
        )
        c["last_message"] = row_to_dict(msg_row) if msg_row else None

        # Unread count
        unread_row = await conn.fetchrow(
            """SELECT COUNT(*) as cnt FROM messages m
               JOIN conversation_participants cp
                 ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
               WHERE m.conversation_id = $2 AND m.created_at > cp.last_read_at AND m.sender_id != $1""",
            current_user_id, c["conversation_id"]
        )
        c["unread_count"] = unread_row["cnt"] if unread_row else 0

        # Other participant (for 1-to-1 conversations)
        if c["type"] != "tagpoint_group":
            other = await conn.fetchrow(
                """SELECT u.user_id, u.name, u.picture FROM users u
                   JOIN conversation_participants cp ON cp.user_id = u.user_id
                   WHERE cp.conversation_id = $1 AND u.user_id != $2 LIMIT 1""",
                c["conversation_id"], current_user_id
            )
            c["other_participant"] = row_to_dict(other) if other else None
        else:
            # For group: show participant count
            cnt = await conn.fetchrow(
                "SELECT COUNT(*) as cnt FROM conversation_participants WHERE conversation_id = $1",
                c["conversation_id"]
            )
            c["participant_count"] = cnt["cnt"] if cnt else 0
            c["other_participant"] = None

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
            # Only 1 group per tagpoint
            existing = await conn.fetchrow(
                "SELECT conversation_id FROM conversations WHERE type='tagpoint_group' AND context_id=$1",
                data.context_id
            )
            if existing:
                conv_id = existing["conversation_id"]
                # Add user as participant if not already
                await conn.execute(
                    """INSERT INTO conversation_participants (conversation_id, user_id)
                       VALUES ($1, $2) ON CONFLICT DO NOTHING""",
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
                # Add creator and current user as participants
                for pid in set([creator_id, uid]):
                    await conn.execute(
                        """INSERT INTO conversation_participants (conversation_id, user_id)
                           VALUES ($1, $2) ON CONFLICT DO NOTHING""",
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
            """SELECT c.conversation_id, c.type, c.context_id, c.context_title,
                      c.created_by, c.last_message_at, c.created_at
               FROM conversations c
               JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
               WHERE cp.user_id = $1
               ORDER BY c.last_message_at DESC NULLS LAST""",
            uid
        )
        convs = rows_to_list(rows)
        return await _enrich_conversations(conn, convs, uid)


@router.get("/conversations/{conv_id}/messages")
async def get_messages(conv_id: str, request: Request, limit: int = Query(50), before: Optional[str] = Query(None)):
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
                """SELECT m.message_id, m.conversation_id, m.sender_id, m.content, m.created_at,
                          u.name as sender_name, u.picture as sender_picture
                   FROM messages m JOIN users u ON m.sender_id = u.user_id
                   WHERE m.conversation_id = $1 AND m.created_at < $2::timestamptz
                   ORDER BY m.created_at DESC LIMIT $3""",
                conv_id, before, limit
            )
        else:
            rows = await conn.fetch(
                """SELECT m.message_id, m.conversation_id, m.sender_id, m.content, m.created_at,
                          u.name as sender_name, u.picture as sender_picture
                   FROM messages m JOIN users u ON m.sender_id = u.user_id
                   WHERE m.conversation_id = $1
                   ORDER BY m.created_at DESC LIMIT $2""",
                conv_id, limit
            )
        messages = rows_to_list(rows)
        messages.reverse()  # chronological order

        # Mark as read
        await conn.execute(
            "UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id=$1 AND user_id=$2",
            conv_id, user["user_id"]
        )
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
    return {"success": True}


# ── WebSocket ──────────────────────────────────────────────────────────────────

@router.websocket("/ws/chat/{conv_id}")
async def ws_chat(websocket: WebSocket, conv_id: str, token: str = Query(...)):
    pool = get_pool()

    # Auth
    try:
        payload = decode_jwt(token)
    except Exception:
        await websocket.close(code=4001)
        return

    user_id = payload["user_id"]

    # Check participant
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT 1 FROM conversation_participants WHERE conversation_id=$1 AND user_id=$2",
            conv_id, user_id
        )
        if not row:
            await websocket.close(code=4003)
            return
        user_row = await conn.fetchrow(
            "SELECT user_id, name, picture FROM users WHERE user_id = $1", user_id
        )
        user_info = row_to_dict(user_row)

    await manager.connect(conv_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            content = (data.get("content") or "").strip()
            if not content:
                continue

            msg_id = new_id("msg")
            now = datetime.now(timezone.utc)

            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO messages (message_id, conversation_id, sender_id, content, created_at) VALUES ($1,$2,$3,$4,$5)",
                    msg_id, conv_id, user_id, content, now
                )
                await conn.execute(
                    "UPDATE conversations SET last_message_at = $1 WHERE conversation_id = $2",
                    now, conv_id
                )

            await manager.broadcast(conv_id, {
                "message_id": msg_id,
                "conversation_id": conv_id,
                "sender_id": user_id,
                "sender_name": user_info["name"],
                "sender_picture": user_info.get("picture"),
                "content": content,
                "created_at": now.isoformat(),
            })

    except WebSocketDisconnect:
        manager.disconnect(conv_id, websocket)
    except Exception:
        manager.disconnect(conv_id, websocket)
