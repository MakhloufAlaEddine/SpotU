"""Service d'envoi de push notifications via Expo Push API."""
import logging
from typing import Optional
from exponent_server_sdk import (
    DeviceNotRegisteredError,
    PushClient,
    PushMessage,
    PushServerError,
    PushTicketError,
)

logger = logging.getLogger(__name__)


async def send_push_notification(
    token: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
    sound: str = "default",
    badge: Optional[int] = None,
) -> dict:
    """Envoyer une push notification à un token Expo."""
    if not token or not token.startswith("ExponentPushToken["):
        return {"status": "invalid_token"}

    try:
        msg = PushMessage(
            to=token,
            title=title,
            body=body,
            data=data or {},
            sound=sound,
            badge=badge,
            priority="high",
        )
        response = PushClient().publish(msg)
        response.validate_response()
        return {"status": "ok"}

    except DeviceNotRegisteredError:
        return {"status": "device_not_registered", "should_deactivate": True}
    except (PushServerError, PushTicketError) as e:
        logger.warning("Push send error: %s", e)
        return {"status": "error", "message": str(e)}
    except Exception as e:
        logger.warning("Push unexpected error: %s", e)
        return {"status": "error", "message": str(e)}


async def store_notification(pool, user_id: str, notif_type: str, title: str, body: str, data: Optional[dict] = None):
    """Stocke une notification en DB et diffuse via WebSocket."""
    import uuid
    from datetime import datetime, timezone
    from chat_manager import notif_manager
    notif_id = "notif_" + str(uuid.uuid4()).replace("-", "")[:16]
    created_at = datetime.now(timezone.utc).isoformat()
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO notifications (notif_id, user_id, type, title, body, data)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            notif_id, user_id, notif_type, title, body, data or {}
        )
        unread = await conn.fetchval(
            "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = FALSE", user_id
        )
    # Diffusion temps réel
    notif_payload = {
        "id": notif_id, "type": notif_type, "title": title, "body": body,
        "data": data or {}, "read": False, "created_at": created_at,
    }
    await notif_manager.notify(user_id, {"type": "new_notification", "notification": notif_payload})
    await notif_manager.notify(user_id, {"type": "unread_notif", "count": int(unread)})


async def send_push_to_user(pool, user_id: str, title: str, body: str, data: Optional[dict] = None,
                             store: bool = True, notif_type: str = "info"):
    """Récupère les tokens actifs de l'utilisateur et envoie la notification.
    Si store=True, stocke aussi la notif en DB."""
    if store:
        await store_notification(pool, user_id, notif_type, title, body, data)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT token_id, token FROM push_tokens WHERE user_id = $1 AND is_active = TRUE",
            user_id
        )
    if not rows:
        return

    for row in rows:
        result = await send_push_notification(row["token"], title, body, data)
        if result.get("should_deactivate"):
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE push_tokens SET is_active = FALSE WHERE token_id = $1",
                    row["token_id"]
                )
        logger.debug("Push to user %s: %s", user_id, result["status"])
