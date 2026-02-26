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
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    image_url TEXT
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

CREATE TABLE IF NOT EXISTS tag_point_votes (
    vote_id TEXT PRIMARY KEY,
    point_id TEXT REFERENCES tag_points(point_id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5) NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(point_id, user_id)
);

CREATE TABLE IF NOT EXISTS tag_point_participants (
    participant_id TEXT PRIMARY KEY,
    point_id TEXT REFERENCES tag_points(point_id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(point_id, user_id)
);

CREATE TABLE IF NOT EXISTS tag_point_saves (
    save_id TEXT PRIMARY KEY,
    point_id TEXT REFERENCES tag_points(point_id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    saved_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(point_id, user_id)
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
    pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10, init=_init_connection, ssl=False)
    async with pool.acquire() as conn:
        await conn.execute(CREATE_TABLES_SQL)
        # Migrations
        await conn.execute("""
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS image_url TEXT;
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS schedule TEXT;
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS event_date TIMESTAMPTZ;
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS event_schedule JSONB DEFAULT NULL;
        """)

        # Seed event dates & schedules (réinitialisés à chaque démarrage)
        await conn.execute("""
            UPDATE tag_points SET event_date = NOW() + INTERVAL '1 day 9 hours 30 minutes'  WHERE point_id = 'pt_demo001';
            UPDATE tag_points SET event_date = NOW() + INTERVAL '2 days 7 hours'             WHERE point_id = 'pt_demo014';
            UPDATE tag_points SET event_date = NOW() + INTERVAL '3 days 18 hours 30 minutes' WHERE point_id = 'pt_demo002';
            UPDATE tag_points SET event_date = NOW() + INTERVAL '5 days 14 hours'            WHERE point_id = 'pt_demo008';
            UPDATE tag_points SET event_date = NOW() + INTERVAL '7 days 10 hours'            WHERE point_id = 'pt_demo004';
            UPDATE tag_points SET event_date = NOW() - INTERVAL '2 days 17 hours'            WHERE point_id = 'pt_demo013';
            UPDATE tag_points SET event_date = NOW() - INTERVAL '5 days 9 hours'             WHERE point_id = 'pt_demo006';
            UPDATE tag_points SET event_schedule = '{"type":"weekly","day":0,"time":"07:00"}' WHERE point_id = 'pt_demo005';
            UPDATE tag_points SET event_schedule = '{"type":"weekly","day":2,"time":"18:30"}' WHERE point_id = 'pt_demo007';
            UPDATE tag_points SET event_schedule = '{"type":"weekly","day":5,"time":"09:00"}' WHERE point_id = 'pt_demo010';
            UPDATE tag_points SET event_schedule = '{"type":"weekly","day":6,"time":"08:00"}' WHERE point_id = 'pt_demo009';
            UPDATE tag_points SET event_schedule = '{"type":"weekly","day":1,"time":"12:30"}' WHERE point_id = 'pt_demo003';
            UPDATE tag_points SET event_schedule = '{"type":"weekly","day":4,"time":"19:00"}' WHERE point_id = 'pt_demo012';
        """)

        # Seed participants
        await conn.execute("""
            INSERT INTO tag_point_participants (participant_id, point_id, user_id, joined_at) VALUES
              ('part_001','pt_demo001','user_demo001', NOW()-INTERVAL '1 hour'),
              ('part_002','pt_demo005','user_demo001', NOW()-INTERVAL '30 minutes'),
              ('part_003','pt_demo007','user_demo001', NOW()-INTERVAL '2 hours'),
              ('part_004','pt_demo014','user_demo001', NOW()-INTERVAL '3 hours'),
              ('part_005','pt_demo013','user_demo001', NOW()-INTERVAL '6 days'),
              ('part_006','pt_demo001','user_demo002', NOW()-INTERVAL '45 minutes'),
              ('part_007','pt_demo002','user_demo002', NOW()-INTERVAL '1 day'),
              ('part_008','pt_demo007','user_demo002', NOW()-INTERVAL '3 hours'),
              ('part_009','pt_demo010','user_demo002', NOW()-INTERVAL '2 days'),
              ('part_010','pt_demo003','user_demo003', NOW()-INTERVAL '1 day'),
              ('part_011','pt_demo009','user_demo003', NOW()-INTERVAL '2 hours'),
              ('part_012','pt_demo010','user_demo003', NOW()-INTERVAL '1 day'),
              ('part_013','pt_demo014','user_demo003', NOW()-INTERVAL '4 hours'),
              ('part_014','pt_demo004','user_coach001', NOW()-INTERVAL '2 days'),
              ('part_015','pt_demo012','user_coach001', NOW()-INTERVAL '1 day')
            ON CONFLICT (point_id, user_id) DO NOTHING;
        """)

        # Seed votes & commentaires
        await conn.execute("""
            INSERT INTO tag_point_votes (vote_id, point_id, user_id, rating, comment, created_at) VALUES
              ('vote_001','pt_demo001','user_demo002',5,'Super groupe, ambiance top ! On était une quinzaine ce matin 💪', NOW()-INTERVAL '2 days'),
              ('vote_002','pt_demo001','user_demo003',4,'Bon rythme, accessible à tous. Le tracé longe le canal, vraiment sympa.', NOW()-INTERVAL '1 day'),
              ('vote_003','pt_demo001','user_coach001',5,'Organisateur très motivant. J''ai découvert ce spot grâce à WINEK !', NOW()-INTERVAL '3 hours'),
              ('vote_004','pt_demo002','user_demo001',5,'Terrain en bon état, bon niveau global. On a joué 3x3 en attendant.', NOW()-INTERVAL '3 days'),
              ('vote_005','pt_demo002','user_demo003',4,'Bonne organisation, les équipes étaient bien équilibrées. À refaire !', NOW()-INTERVAL '1 day'),
              ('vote_006','pt_demo002','user_coach001',3,'Match sympa mais il manquait un peu d''arbitrage. L''endroit est parfait.', NOW()-INTERVAL '5 hours'),
              ('vote_007','pt_demo003','user_demo001',5,'Vue imprenable sur la Tour Eiffel, séance vraiment ressourçante. Merci !', NOW()-INTERVAL '4 days'),
              ('vote_008','pt_demo003','user_demo002',5,'Instructeur patient et bienveillant, parfait pour les débutants 🧘', NOW()-INTERVAL '2 days'),
              ('vote_009','pt_demo003','user_coach001',4,'Belle séance, bon niveau. J''aurais aimé 15 min de plus pour la relaxation.', NOW()-INTERVAL '6 hours'),
              ('vote_010','pt_demo004','user_demo002',4,'Workout intense ! Les WOD étaient bien construits. Le bois de Vincennes est parfait.', NOW()-INTERVAL '1 day'),
              ('vote_011','pt_demo004','user_demo003',5,'Niveau costaud mais le coach adapte bien. J''ai progressé en 2 séances !', NOW()-INTERVAL '8 hours'),
              ('vote_012','pt_demo005','user_demo001',4,'Bonne ambiance, terrain synthé nickel. On a eu 3 équipes, super soirée.', NOW()-INTERVAL '2 days'),
              ('vote_013','pt_demo005','user_demo002',5,'Organisé à la perfection, tout le monde à l''heure. Niveau accessible.', NOW()-INTERVAL '1 day'),
              ('vote_014','pt_demo005','user_demo003',4,'Fun et convivial. Le terrain est petit mais ça donne du rythme !', NOW()-INTERVAL '3 hours'),
              ('vote_015','pt_demo006','user_demo001',5,'Parcours magnifique le long du canal, on a terminé par un café 😄', NOW()-INTERVAL '6 days'),
              ('vote_016','pt_demo006','user_demo003',4,'Rythme modéré, parfait pour une sortie détente. Guide au top.', NOW()-INTERVAL '4 days'),
              ('vote_017','pt_demo007','user_demo001',5,'Coach au top, très pédagogue. On apprend vite les bases tout en se défoulant.', NOW()-INTERVAL '5 days'),
              ('vote_018','pt_demo007','user_demo002',4,'Bonne initiation à la boxe thaï. Les gants et protèges-dents sont fournis.', NOW()-INTERVAL '3 days'),
              ('vote_019','pt_demo007','user_demo003',5,'Meilleure séance de sport de l''année ! On repart vidé mais heureux.', NOW()-INTERVAL '1 day'),
              ('vote_020','pt_demo008','user_demo001',4,'Courts bien entretenus, bon partenaire d''entraînement. Niveau intermédiaire.', NOW()-INTERVAL '3 days'),
              ('vote_021','pt_demo008','user_coach001',5,'Excellente session, l''organisateur donne de bons conseils techniques.', NOW()-INTERVAL '1 day'),
              ('vote_022','pt_demo009','user_demo002',5,'Circuit impeccable dans le bois de Boulogne. 8km, parfait pour un 10km.', NOW()-INTERVAL '1 week'),
              ('vote_023','pt_demo009','user_demo003',4,'Groupe de 8 personnes, très bonne ambiance. Le briefing est très utile.', NOW()-INTERVAL '4 days'),
              ('vote_024','pt_demo009','user_coach001',5,'Pace régulier et bien expliqué. J''ai adoré le sprint final !', NOW()-INTERVAL '2 days'),
              ('vote_025','pt_demo010','user_demo001',5,'Séance de yoga en plein air au parc Monceau, c''est magique !', NOW()-INTERVAL '3 days'),
              ('vote_026','pt_demo010','user_demo002',4,'Super encadrante, très attentive à la posture de chacun.', NOW()-INTERVAL '1 day'),
              ('vote_027','pt_demo014','user_demo002',5,'Le meilleur HIIT outdoor. 45 min non-stop, ça met en forme pour la journée.', NOW()-INTERVAL '2 days'),
              ('vote_028','pt_demo014','user_demo003',5,'Super coach, exercices variés et bien expliqués. Circuit au top 🔥', NOW()-INTERVAL '1 day'),
              ('vote_029','pt_demo014','user_coach001',4,'Intensité au rendez-vous, bonne progression sur 4 semaines.', NOW()-INTERVAL '5 hours'),
              ('vote_030','pt_demo015','user_demo001',5,'Approche très professionnelle. Elle m''a aidé à surmonter mon blocage.', NOW()-INTERVAL '4 days'),
              ('vote_031','pt_demo015','user_demo002',5,'Session très enrichissante. Les techniques de visualisation sont bluffantes.', NOW()-INTERVAL '2 days'),
              ('vote_032','pt_demo015','user_demo003',4,'Très bien pour la gestion du stress en compétition. Je reviendrai.', NOW()-INTERVAL '6 hours')
            ON CONFLICT (point_id, user_id) DO UPDATE SET rating=EXCLUDED.rating, comment=EXCLUDED.comment;
        """)

        # Seed saves
        await conn.execute("""
            INSERT INTO tag_point_saves (save_id, point_id, user_id, saved_at) VALUES
              ('save_001','pt_demo003','user_demo001', NOW()-INTERVAL '2 days'),
              ('save_002','pt_demo007','user_demo001', NOW()-INTERVAL '1 day'),
              ('save_003','pt_demo014','user_demo001', NOW()-INTERVAL '3 hours'),
              ('save_004','pt_demo001','user_demo002', NOW()-INTERVAL '1 day'),
              ('save_005','pt_demo010','user_demo002', NOW()-INTERVAL '5 hours'),
              ('save_006','pt_demo005','user_demo003', NOW()-INTERVAL '2 days')
            ON CONFLICT (point_id, user_id) DO NOTHING;
        """)
    logger.info("Connected to PostgreSQL with PostGIS")


async def close_db():
    global pool
    if pool:
        await pool.close()


def get_pool():
    return pool
