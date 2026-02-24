from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone, timedelta
from models import UserCreate, UserLogin, GoogleAuthRequest, new_id
from auth_utils import hash_password, verify_password, create_jwt, require_auth, fetch_emergent_session
from database import get_db

router = APIRouter()


@router.post("/register")
async def register(data: UserCreate):
    db = get_db()
    existing = await db.users.find_one({"email": data.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_doc = {
        "user_id": new_id("user"),
        "email": data.email.lower(),
        "password_hash": hash_password(data.password),
        "name": data.name,
        "role": "user",
        "language": data.language,
        "picture": None,
        "bio": None,
        "phone": None,
        "is_coach_verified": False,
        "coach_tags": [],
        "hourly_rate": None,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.users.insert_one(user_doc)
    token = create_jwt(user_doc["user_id"], user_doc["role"])
    user_doc.pop("password_hash")
    user_doc.pop("_id", None)
    return {"user": user_doc, "token": token}


@router.post("/login")
async def login(data: UserLogin):
    db = get_db()
    user = await db.users.find_one({"email": data.email.lower()})
    if not user or not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_jwt(user["user_id"], user["role"])
    user.pop("password_hash", None)
    user.pop("_id", None)
    return {"user": user, "token": token}


@router.post("/google")
async def google_auth(data: GoogleAuthRequest):
    db = get_db()
    session_data = await fetch_emergent_session(data.session_id)
    email = session_data.get("email", "").lower()
    name = session_data.get("name", "")
    picture = session_data.get("picture")

    existing = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    if existing:
        await db.users.update_one({"email": email}, {"$set": {"name": name, "picture": picture, "updated_at": datetime.now(timezone.utc)}})
        existing["name"] = name
        existing["picture"] = picture
        token = create_jwt(existing["user_id"], existing["role"])
        return {"user": existing, "token": token}

    user_doc = {
        "user_id": new_id("user"),
        "email": email,
        "name": name,
        "picture": picture,
        "role": "user",
        "language": "fr",
        "bio": None,
        "phone": None,
        "is_coach_verified": False,
        "coach_tags": [],
        "hourly_rate": None,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.users.insert_one(user_doc)
    user_doc.pop("_id", None)
    token = create_jwt(user_doc["user_id"], user_doc["role"])
    return {"user": user_doc, "token": token}


@router.get("/me")
async def get_me(request: Request):
    db = get_db()
    user = await require_auth(request, db)
    return user


@router.post("/logout")
async def logout(request: Request):
    db = get_db()
    await require_auth(request, db)
    return {"success": True}
