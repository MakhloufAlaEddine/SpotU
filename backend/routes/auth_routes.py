from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
from models import UserCreate, UserLogin, GoogleAuthRequest, PasswordChange, new_id
from auth_utils import hash_password, verify_password, create_jwt, require_auth, fetch_emergent_session, USER_FIELDS
from database import get_pool, row_to_dict
from limiter import limiter
import json

router = APIRouter()


@router.post("/register")
@limiter.limit("5/minute")
async def register(request: Request, data: UserCreate):
    pool = get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT user_id FROM users WHERE email = $1", data.email.lower())
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")
        uid = new_id("user")
        await conn.execute(
            "INSERT INTO users (user_id, email, password_hash, name, role, language, coach_tags) VALUES ($1, $2, $3, $4, 'user', $5, '[]'::jsonb)",
            uid, data.email.lower(), hash_password(data.password), data.name, data.language
        )
        row = await conn.fetchrow(f"SELECT {USER_FIELDS} FROM users WHERE user_id = $1", uid)
    user = row_to_dict(row)
    token = create_jwt(uid, "user")
    return {"user": user, "token": token}


@router.post("/login")
@limiter.limit("30/minute")
async def login(request: Request, data: UserLogin):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT user_id, password_hash, role FROM users WHERE email = $1", data.email.lower())
    if not row or not verify_password(data.password, row["password_hash"] or ""):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    async with pool.acquire() as conn:
        user_row = await conn.fetchrow(f"SELECT {USER_FIELDS} FROM users WHERE user_id = $1", row["user_id"])
    user = row_to_dict(user_row)
    token = create_jwt(user["user_id"], user["role"])
    return {"user": user, "token": token}


@router.post("/google")
@limiter.limit("10/minute")
async def google_auth(request: Request, data: GoogleAuthRequest):
    pool = get_pool()
    session_data = await fetch_emergent_session(data.session_id)
    email = session_data.get("email", "").lower()
    name = session_data.get("name", "")
    picture = session_data.get("picture")

    async with pool.acquire() as conn:
        existing = await conn.fetchrow(f"SELECT {USER_FIELDS} FROM users WHERE email = $1", email)
        if existing:
            await conn.execute(
                "UPDATE users SET name = $1, picture = $2, updated_at = NOW() WHERE email = $3",
                name, picture, email
            )
            user_row = await conn.fetchrow(f"SELECT {USER_FIELDS} FROM users WHERE email = $1", email)
            user = row_to_dict(user_row)
            token = create_jwt(user["user_id"], user["role"])
            return {"user": user, "token": token}

        uid = new_id("user")
        await conn.execute(
            "INSERT INTO users (user_id, email, name, picture, role, language, coach_tags) VALUES ($1, $2, $3, $4, 'user', 'fr', '[]'::jsonb)",
            uid, email, name, picture
        )
        user_row = await conn.fetchrow(f"SELECT {USER_FIELDS} FROM users WHERE user_id = $1", uid)
    user = row_to_dict(user_row)
    token = create_jwt(uid, "user")
    return {"user": user, "token": token}


@router.get("/me")
async def get_me(request: Request):
    pool = get_pool()
    return await require_auth(request, pool)


@router.post("/logout")
async def logout(request: Request):
    pool = get_pool()
    await require_auth(request, pool)
    return {"success": True}


@router.put("/change-password")
async def change_password(data: PasswordChange, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT password_hash FROM users WHERE user_id = $1", user["user_id"])
        if not row or not verify_password(data.current_password, row["password_hash"] or ""):
            raise HTTPException(status_code=401, detail="Mot de passe actuel incorrect")
        new_hash = hash_password(data.new_password)
        await conn.execute(
            "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2",
            new_hash, user["user_id"]
        )
    return {"success": True}
