import os
import bcrypt
import jwt
import httpx
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Request
from typing import Optional
from database import row_to_dict

JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError(
        "CRITICAL: JWT_SECRET environment variable is not set. "
        "Generate one with: openssl rand -hex 32"
    )
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7
COMMISSION_RATE = 0.15  # 15%


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except Exception:
        return False


def create_jwt(user_id: str, role: str) -> str:
    payload = {
        "user_id": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "user_id"]},
        )
        return payload
    except jwt.ExpiredSignatureError:
        print(f"DEBUG decode_jwt: token expired")
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidAlgorithmError:
        print(f"DEBUG decode_jwt: invalid algorithm")
        raise HTTPException(status_code=401, detail="Invalid token algorithm")
    except jwt.InvalidTokenError as e:
        print(f"DEBUG decode_jwt: invalid token: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")


def get_token_from_request(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return request.cookies.get("winek_token")


USER_FIELDS = "user_id, email, name, role, language, picture, bio, phone, is_coach_verified, coach_tags, show_phone, show_reviews, created_at, updated_at, sports_level, goals, user_roles, onboarding_done"


async def require_auth(request: Request, pool) -> dict:
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_jwt(token)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT {USER_FIELDS} FROM users WHERE user_id = $1",
            payload["user_id"]
        )
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    return row_to_dict(row)


async def get_optional_auth(request: Request, pool):
    """Retourne l'utilisateur connecté ou None si pas de token / token invalide."""
    try:
        token = get_token_from_request(request)
        print(f"DEBUG get_optional_auth: token={token[:30] if token else None}...")
        if not token:
            return None
        payload = decode_jwt(token)
        print(f"DEBUG get_optional_auth: payload={payload}")
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                f"SELECT {USER_FIELDS} FROM users WHERE user_id = $1",
                payload["user_id"]
            )
        print(f"DEBUG get_optional_auth: row={row is not None}")
        return row_to_dict(row) if row else None
    except Exception as e:
        print(f"DEBUG get_optional_auth: exception={e}")
        return None


async def require_role(request: Request, pool, role: str) -> dict:
    user = await require_auth(request, pool)
    if user["role"] != role:
        raise HTTPException(status_code=403, detail=f"Requires {role} role")
    return user


async def fetch_emergent_session(session_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
            timeout=10.0,
        )
        try:
            body = resp.json()
        except Exception:
            body = {}

        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail=body or "Invalid Google session")

        # Emergent peut retourner 200 avec un corps d'erreur
        if "error" in body:
            raise HTTPException(status_code=401, detail=body)

        if not body.get("email"):
            raise HTTPException(status_code=401, detail="Could not retrieve user email from Google")

        return body
