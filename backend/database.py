import asyncpg
import os
import logging
from decimal import Decimal
from typing import Optional

logger = logging.getLogger(__name__)
pool: Optional[asyncpg.Pool] = None

CREATE_TABLES_SQL = """
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    language TEXT NOT NULL DEFAULT 'fr',
    picture TEXT,
    bio TEXT,
    phone TEXT,
    is_coach_verified BOOLEAN DEFAULT FALSE,
    coach_tags JSONB DEFAULT '[]',
    hourly_rate NUMERIC(10,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS domains (
    domain_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    label_fr TEXT NOT NULL,
    label_en TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT DEFAULT '#1DBF73',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tag_categories (
    category_id TEXT PRIMARY KEY,
    domain_id TEXT,
    name TEXT NOT NULL,
    label_fr TEXT NOT NULL,
    label_en TEXT NOT NULL,
    icon TEXT NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tags (
    tag_id TEXT PRIMARY KEY,
    category_id TEXT,
    domain_id TEXT,
    name TEXT NOT NULL,
    label_fr TEXT NOT NULL,
    label_en TEXT NOT NULL,
    icon TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tag_points (
    point_id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(user_id),
    title TEXT NOT NULL,
    description TEXT,
    location GEOMETRY(Point, 4326),
    precision TEXT DEFAULT 'exact',
    tag_ids JSONB DEFAULT '[]',
    domain_id TEXT,
    active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tag_points_location ON tag_points USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_tag_points_active ON tag_points(active);

CREATE TABLE IF NOT EXISTS services (
    service_id TEXT PRIMARY KEY,
    coach_id TEXT REFERENCES users(user_id),
    title TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL,
    duration_min INTEGER DEFAULT 60,
    tag_ids JSONB DEFAULT '[]',
    domain_id TEXT,
    location GEOMETRY(Point, 4326),
    location_description TEXT,
    max_participants INTEGER DEFAULT 1,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_location ON services USING GIST(location);

CREATE TABLE IF NOT EXISTS bookings (
    booking_id TEXT PRIMARY KEY,
    service_id TEXT REFERENCES services(service_id),
    user_id TEXT REFERENCES users(user_id),
    coach_id TEXT REFERENCES users(user_id),
    status TEXT DEFAULT 'pending',
    scheduled_at TIMESTAMPTZ,
    notes TEXT,
    amount NUMERIC(10,2),
    commission NUMERIC(10,2),
    payment_status TEXT DEFAULT 'pending',
    payment_session_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
    review_id TEXT PRIMARY KEY,
    booking_id TEXT REFERENCES bookings(booking_id),
    reviewer_id TEXT REFERENCES users(user_id),
    reviewee_id TEXT REFERENCES users(user_id),
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_transactions (
    transaction_id TEXT PRIMARY KEY,
    booking_id TEXT,
    user_id TEXT,
    session_id TEXT,
    amount NUMERIC(10,2),
    currency TEXT DEFAULT 'eur',
    status TEXT DEFAULT 'initiated',
    payment_status TEXT DEFAULT 'pending',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
"""


def row_to_dict(row) -> dict:
    """Convert asyncpg Record to a JSON-serializable dict."""
    if row is None:
        return None
    result = {}
    for key, val in dict(row).items():
        if isinstance(val, Decimal):
            result[key] = float(val)
        elif hasattr(val, 'isoformat'):  # datetime objects
            result[key] = val.isoformat()
        else:
            result[key] = val
    return result


def rows_to_list(rows) -> list:
    return [row_to_dict(row) for row in rows]


import json as _json

async def _init_connection(conn):
    """Set JSONB codec for every connection in the pool."""
    await conn.set_type_codec('jsonb', encoder=_json.dumps, decoder=_json.loads, schema='pg_catalog')
    await conn.set_type_codec('json', encoder=_json.dumps, decoder=_json.loads, schema='pg_catalog')


async def connect_to_db():
    global pool
    database_url = os.environ.get("DATABASE_URL")
    pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10, init=_init_connection)
    async with pool.acquire() as conn:
        await conn.execute(CREATE_TABLES_SQL)
    logger.info("Connected to PostgreSQL with PostGIS")


async def close_db():
    global pool
    if pool:
        await pool.close()


def get_pool():
    return pool
