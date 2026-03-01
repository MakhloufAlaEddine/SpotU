from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from auth_utils import require_auth
from database import get_pool
from models import new_id

router = APIRouter()


class PushTokenRegister(BaseModel):
    token: str
    platform: str = "expo"


@router.post("/push-token")
async def register_push_token(data: PushTokenRegister, request: Request):
    """Enregistre ou met à jour le token push d'un appareil."""
    pool = get_pool()
    user = await require_auth(request, pool)
    uid = user["user_id"]

    if not data.token.startswith("ExponentPushToken["):
        raise HTTPException(status_code=400, detail="Token Expo invalide")

    async with pool.acquire() as conn:
        # Si le token existe déjà pour cet utilisateur → réactiver
        existing = await conn.fetchrow(
            "SELECT token_id, user_id FROM push_tokens WHERE token = $1",
            data.token
        )
        if existing:
            if existing["user_id"] != uid:
                # Appartient à un autre user → désactiver l'ancienne association
                await conn.execute(
                    "UPDATE push_tokens SET is_active = FALSE WHERE token = $1",
                    data.token
                )
            else:
                # Même user → juste réactiver + mettre à jour last_used
                await conn.execute(
                    "UPDATE push_tokens SET is_active = TRUE, last_used_at = NOW() WHERE token = $1",
                    data.token
                )
                return {"status": "updated"}

        # Nouveau token
        tid = new_id("ptk")
        await conn.execute(
            """INSERT INTO push_tokens (token_id, user_id, token, platform, is_active)
               VALUES ($1, $2, $3, $4, TRUE)
               ON CONFLICT (token) DO UPDATE SET user_id=$2, is_active=TRUE, last_used_at=NOW()""",
            tid, uid, data.token, data.platform
        )
    return {"status": "registered"}


@router.delete("/push-token")
async def unregister_push_token(data: PushTokenRegister, request: Request):
    """Désactive le token push (déconnexion)."""
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE push_tokens SET is_active = FALSE WHERE token = $1 AND user_id = $2",
            data.token, user["user_id"]
        )
    return {"status": "unregistered"}
