"""
Routes CRUD pour les adresses enregistrées des utilisateurs.
Table: user_saved_addresses
"""
from typing import Optional
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from auth_utils import get_token_from_request, decode_jwt
from database import get_pool
import uuid

router = APIRouter()


def _require_user(request: Request) -> str:
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Non authentifié")
    payload = decode_jwt(token)
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token invalide")
    return user_id


class AddressPayload(BaseModel):
    label: str
    address: str
    lat: float
    lng: float
    icon: Optional[str] = "location-outline"


# ── GET /addresses  (liste des adresses de l'utilisateur) ──────────────────
@router.get("/addresses")
async def list_addresses(request: Request):
    user_id = _require_user(request)
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT address_id, label, address, lat, lng, icon, position, created_at
            FROM user_saved_addresses
            WHERE user_id = $1
            ORDER BY position ASC, created_at ASC
            """,
            user_id,
        )
    return [dict(r) for r in rows]


# ── POST /addresses  (créer une adresse) ───────────────────────────────────
@router.post("/addresses", status_code=201)
async def create_address(payload: AddressPayload, request: Request):
    user_id = _require_user(request)
    pool = get_pool()
    address_id = f"addr_{uuid.uuid4().hex[:12]}"
    async with pool.acquire() as conn:
        # Position = max existant + 1
        max_pos = await conn.fetchval(
            "SELECT COALESCE(MAX(position), -1) FROM user_saved_addresses WHERE user_id = $1",
            user_id,
        )
        row = await conn.fetchrow(
            """
            INSERT INTO user_saved_addresses (address_id, user_id, label, address, lat, lng, icon, position)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING address_id, label, address, lat, lng, icon, position, created_at
            """,
            address_id, user_id, payload.label.strip(), payload.address.strip(),
            payload.lat, payload.lng, payload.icon or "location-outline", (max_pos or 0) + 1,
        )
    return dict(row)


# ── PUT /addresses/{address_id}  (modifier) ────────────────────────────────
@router.put("/addresses/{address_id}")
async def update_address(address_id: str, payload: AddressPayload, request: Request):
    user_id = _require_user(request)
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE user_saved_addresses
            SET label = $1, address = $2, lat = $3, lng = $4, icon = $5
            WHERE address_id = $6 AND user_id = $7
            RETURNING address_id, label, address, lat, lng, icon, position, created_at
            """,
            payload.label.strip(), payload.address.strip(),
            payload.lat, payload.lng, payload.icon or "location-outline",
            address_id, user_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Adresse introuvable")
    return dict(row)


# ── DELETE /addresses/{address_id}  (supprimer) ────────────────────────────
@router.delete("/addresses/{address_id}", status_code=204)
async def delete_address(address_id: str, request: Request):
    user_id = _require_user(request)
    pool = get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM user_saved_addresses WHERE address_id = $1 AND user_id = $2",
            address_id, user_id,
        )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Adresse introuvable")
    return None
