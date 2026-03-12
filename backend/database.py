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
    is_public BOOLEAN DEFAULT TRUE,
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
    address TEXT,
    price NUMERIC(10,2) NOT NULL,
    duration_min INTEGER DEFAULT 60,
    tag_ids JSONB DEFAULT '[]',
    domain_id TEXT,
    location GEOMETRY(Point, 4326),
    location_description TEXT,
    max_participants INTEGER DEFAULT 1,
    active BOOLEAN DEFAULT TRUE,
    images JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_location ON services USING GIST(location);

CREATE TABLE IF NOT EXISTS service_locations (
    location_id TEXT PRIMARY KEY,
    service_id TEXT REFERENCES services(service_id) ON DELETE CASCADE,
    location GEOMETRY(Point, 4326),
    precision TEXT DEFAULT 'exact',
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_locations_geo ON service_locations USING GIST(location);

CREATE TABLE IF NOT EXISTS service_slots (
    slot_id TEXT PRIMARY KEY,
    service_id TEXT REFERENCES services(service_id) ON DELETE CASCADE,
    day_of_week INTEGER CHECK (day_of_week >= 0 AND day_of_week <= 6),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bookings (
    booking_id TEXT PRIMARY KEY,
    service_id TEXT REFERENCES services(service_id),
    user_id TEXT REFERENCES users(user_id),
    coach_id TEXT REFERENCES users(user_id),
    status TEXT DEFAULT 'pending',
    scheduled_at TIMESTAMPTZ,
    notes TEXT,
    amount NUMERIC(10,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    slot_id TEXT,
    location_id TEXT
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

CREATE TABLE IF NOT EXISTS service_saves (
    save_id TEXT PRIMARY KEY,
    service_id TEXT REFERENCES services(service_id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    saved_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(service_id, user_id)
);

CREATE TABLE IF NOT EXISTS conversations (
    conversation_id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('service', 'tagpoint_group', 'tagpoint_private')),
    context_id TEXT NOT NULL,
    context_title TEXT NOT NULL,
    created_by TEXT REFERENCES users(user_id),
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id TEXT REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    sender_id TEXT REFERENCES users(user_id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conv_participants ON conversation_participants(user_id);

CREATE TABLE IF NOT EXISTS push_tokens (
    token_id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    platform TEXT DEFAULT 'expo',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id, is_active);
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
    import asyncio
    for attempt in range(15):
        try:
            pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10, init=_init_connection, ssl=False, timeout=10)
            break
        except Exception as e:
            if attempt == 14:
                raise
            wait = min(2 ** attempt, 20)
            logger.warning(f"DB not ready (attempt {attempt+1}/15), retrying in {wait}s… ({e})")
            await asyncio.sleep(wait)

    # 1. Tables + migrations
    async with pool.acquire() as conn:
        # Base tables MUST be created first before any migrations/FKs
        await conn.execute(CREATE_TABLES_SQL)

        # [PRICING] Tables de monétisation générique
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS pricing_rules (
                rule_id TEXT PRIMARY KEY,
                product_type TEXT NOT NULL,
                name TEXT NOT NULL,
                payer_fixed_fee NUMERIC(10,2) DEFAULT 0,
                payer_percent_fee NUMERIC(5,2) DEFAULT 0,
                receiver_fixed_fee NUMERIC(10,2) DEFAULT 0,
                receiver_percent_fee NUMERIC(5,2) DEFAULT 0,
                active BOOLEAN DEFAULT TRUE,
                priority INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS subscription_plans (
                plan_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                price NUMERIC(10,2) NOT NULL DEFAULT 0,
                duration_days INTEGER,
                exempt_payer_fixed BOOLEAN DEFAULT FALSE,
                exempt_payer_percent BOOLEAN DEFAULT FALSE,
                exempt_receiver_fixed BOOLEAN DEFAULT FALSE,
                exempt_receiver_percent BOOLEAN DEFAULT FALSE,
                active BOOLEAN DEFAULT TRUE,
                priority INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS user_subscriptions (
                subscription_id TEXT PRIMARY KEY,
                user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
                plan_id TEXT REFERENCES subscription_plans(plan_id),
                status TEXT DEFAULT 'active',
                started_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_pricing_rules_product_type
                ON pricing_rules(product_type, active);
            CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user
                ON user_subscriptions(user_id, status);

            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payer_user_id TEXT;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS receiver_user_id TEXT;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending';
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_provider TEXT;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB DEFAULT NULL;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR';
        """)

        # [MONETIZATION-V2] Table payments plate + enrichissement subscriptions
        await conn.execute("""
            -- Table payments : colonnes plates queryables + snapshot JSONB immuable
            CREATE TABLE IF NOT EXISTS payments (
                payment_id                  TEXT PRIMARY KEY,
                -- Parties génériques (indépendant des rôles)
                payer_user_id               TEXT NOT NULL REFERENCES users(user_id),
                receiver_user_id            TEXT REFERENCES users(user_id),
                -- Contexte produit
                product_type                TEXT NOT NULL,
                product_id                  TEXT,
                booking_id                  TEXT REFERENCES bookings(booking_id) ON DELETE SET NULL,
                -- Stripe
                stripe_payment_intent_id    TEXT,
                stripe_charge_id            TEXT,
                stripe_transfer_id          TEXT,
                -- Statut & devise
                status                      TEXT NOT NULL DEFAULT 'pending',
                currency                    TEXT NOT NULL DEFAULT 'EUR',
                -- Montants (colonnes plates — agrégables en SQL)
                base_amount                 NUMERIC(12,2) NOT NULL,
                payer_fixed_fee             NUMERIC(12,2) NOT NULL DEFAULT 0,
                payer_percent_fee_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
                receiver_fixed_fee          NUMERIC(12,2) NOT NULL DEFAULT 0,
                receiver_percent_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                platform_total_fee          NUMERIC(12,2) NOT NULL DEFAULT 0,
                receiver_net_amount         NUMERIC(12,2) NOT NULL,
                payer_total_amount          NUMERIC(12,2) NOT NULL,
                -- Snapshot immuable de la règle appliquée au moment de la transaction
                pricing_rule_snapshot       JSONB NOT NULL DEFAULT '{}',
                -- Timestamps
                created_at                  TIMESTAMPTZ DEFAULT NOW(),
                updated_at                  TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_payments_payer
                ON payments(payer_user_id);
            CREATE INDEX IF NOT EXISTS idx_payments_receiver
                ON payments(receiver_user_id);
            CREATE INDEX IF NOT EXISTS idx_payments_booking
                ON payments(booking_id) WHERE booking_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_payments_status
                ON payments(status);
            CREATE INDEX IF NOT EXISTS idx_payments_stripe_intent
                ON payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_payments_product
                ON payments(product_type, product_id);

            -- Enrichissement user_subscriptions : champs Stripe + snapshot des avantages
            ALTER TABLE user_subscriptions
                ADD COLUMN IF NOT EXISTS plan_code TEXT;
            ALTER TABLE user_subscriptions
                ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
            ALTER TABLE user_subscriptions
                ADD COLUMN IF NOT EXISTS benefits_snapshot JSONB DEFAULT NULL;
            ALTER TABLE user_subscriptions
                ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
            ALTER TABLE user_subscriptions
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

            -- Enrichissement pricing_rules : description + devise
            ALTER TABLE pricing_rules
                ADD COLUMN IF NOT EXISTS description TEXT;
            ALTER TABLE pricing_rules
                ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR';
        """)

        await conn.execute("""
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS image_url TEXT;
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS schedule TEXT;
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS event_date TIMESTAMPTZ;
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS event_end_date TIMESTAMPTZ;
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS event_schedule JSONB DEFAULT NULL;
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS new_date_coming BOOLEAN DEFAULT FALSE;
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS cancelled BOOLEAN DEFAULT FALSE;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS show_phone BOOLEAN NOT NULL DEFAULT false;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS show_reviews BOOLEAN NOT NULL DEFAULT true;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS iban TEXT NULL;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS bic TEXT NULL;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS iban_name TEXT NULL;
            ALTER TABLE users DROP COLUMN IF EXISTS hourly_rate;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS slot_id TEXT;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS location_id TEXT;
            ALTER TABLE service_slots ADD COLUMN IF NOT EXISTS slot_type TEXT DEFAULT 'recurring';
            ALTER TABLE service_slots ADD COLUMN IF NOT EXISTS slot_date TEXT;
            ALTER TABLE service_slots ADD COLUMN IF NOT EXISTS days_of_week JSONB DEFAULT '[]';
            ALTER TABLE service_slots ADD COLUMN IF NOT EXISTS raw_schedule JSONB;
            ALTER TABLE service_slots ADD COLUMN IF NOT EXISTS location_id TEXT REFERENCES service_locations(location_id) ON DELETE SET NULL;
            ALTER TABLE services ADD COLUMN IF NOT EXISTS address TEXT;
            ALTER TABLE services ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
            CREATE TABLE IF NOT EXISTS service_packages (
                package_id TEXT PRIMARY KEY,
                service_id TEXT REFERENCES services(service_id) ON DELETE CASCADE,
                type_id TEXT NOT NULL,
                type_label TEXT NOT NULL,
                duration_min INTEGER DEFAULT 60,
                max_participants INTEGER DEFAULT 1,
                price DECIMAL(10,2) DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            ALTER TABLE service_slots ADD COLUMN IF NOT EXISTS package_id TEXT REFERENCES service_packages(package_id) ON DELETE SET NULL;
            CREATE TABLE IF NOT EXISTS notifications (
                notif_id TEXT PRIMARY KEY,
                user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                data JSONB DEFAULT '{}'::jsonb,
                read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
        """)

        # [BOOKING-V2] Workflow robuste — idempotence, statuts étendus, slot_status
        await conn.execute("""
            ALTER TABLE service_slots
                ADD COLUMN IF NOT EXISTS slot_status TEXT NOT NULL DEFAULT 'available';

            ALTER TABLE bookings
                ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

            ALTER TABLE bookings
                ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_idempotency_key
                ON bookings(idempotency_key)
                WHERE idempotency_key IS NOT NULL;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_slot_user_active
                ON bookings(slot_id, user_id)
                WHERE slot_id IS NOT NULL
                  AND status NOT IN ('refused', 'cancelled', 'expired');

            CREATE INDEX IF NOT EXISTS idx_bookings_expiry_worker
                ON bookings(expires_at)
                WHERE status = 'requested';
        """)

        # [STRIPE-V2] PaymentIntent + Stripe Connect + customer management
        await conn.execute("""
            ALTER TABLE users
                ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
            ALTER TABLE users
                ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;

            ALTER TABLE payments
                ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_customer
                ON users(stripe_customer_id)
                WHERE stripe_customer_id IS NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_account
                ON users(stripe_account_id)
                WHERE stripe_account_id IS NOT NULL;
        """)

        # [SUBSCRIPTIONS-V1] Liaison plans ↔ Stripe Products/Prices
        await conn.execute("""
            ALTER TABLE subscription_plans
                ADD COLUMN IF NOT EXISTS stripe_product_id TEXT;
            ALTER TABLE subscription_plans
                ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_stripe_price
                ON subscription_plans(stripe_price_id)
                WHERE stripe_price_id IS NOT NULL;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_stripe_product
                ON subscription_plans(stripe_product_id)
                WHERE stripe_product_id IS NOT NULL;
        """)

        # [WEBHOOKS-V1] Idempotence + traçabilité webhooks Stripe
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS stripe_webhook_events (
                event_id        TEXT PRIMARY KEY,
                event_type      TEXT NOT NULL,
                status          TEXT NOT NULL DEFAULT 'processing',
                related_id      TEXT,
                error_message   TEXT,
                processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_webhook_events_type
                ON stripe_webhook_events(event_type);
            CREATE INDEX IF NOT EXISTS idx_webhook_events_related
                ON stripe_webhook_events(related_id)
                WHERE related_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_webhook_events_status
                ON stripe_webhook_events(status);

            ALTER TABLE payments
                ADD COLUMN IF NOT EXISTS stripe_charge_id      TEXT,
                ADD COLUMN IF NOT EXISTS refund_amount         DECIMAL(10,2) DEFAULT 0,
                ADD COLUMN IF NOT EXISTS refund_status         TEXT;
        """)

        # [CANCEL-POLICY] Colonnes annulation — migration idempotente
        await conn.execute("""
            ALTER TABLE bookings
                ADD COLUMN IF NOT EXISTS cancelled_by_user_id TEXT,
                ADD COLUMN IF NOT EXISTS cancellation_reason   TEXT;
        """)

        # [BOOKING-WORKFLOW-V2] Configuration service + statuts étendus
        await conn.execute("""
            -- Configuration workflow par service
            ALTER TABLE services
                ADD COLUMN IF NOT EXISTS booking_approval_mode TEXT NOT NULL DEFAULT 'manual_approval',
                ADD COLUMN IF NOT EXISTS allow_pay_later BOOLEAN NOT NULL DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS pay_later_expiration_minutes INTEGER DEFAULT 1440;

            -- Mode de paiement choisi par le payeur
            ALTER TABLE bookings
                ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'pay_now';

            -- Index pour l'expiry worker étendu (awaiting_payment + requested)
            CREATE INDEX IF NOT EXISTS idx_bookings_expiry_worker_v2
                ON bookings(expires_at)
                WHERE status IN ('requested', 'awaiting_payment');
        """)

        # [PERF-01] Index de performance — migration idempotente
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_bookings_user_id
                ON bookings(user_id);
            CREATE INDEX IF NOT EXISTS idx_bookings_coach_id
                ON bookings(coach_id);
            CREATE INDEX IF NOT EXISTS idx_bookings_service_id
                ON bookings(service_id);
            CREATE INDEX IF NOT EXISTS idx_bookings_status
                ON bookings(status);
            CREATE INDEX IF NOT EXISTS idx_reviews_reviewee_id
                ON reviews(reviewee_id);
            CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_id
                ON reviews(reviewer_id);
            CREATE INDEX IF NOT EXISTS idx_service_slots_service_id
                ON service_slots(service_id);
            CREATE INDEX IF NOT EXISTS idx_service_packages_service_id
                ON service_packages(service_id);
            CREATE INDEX IF NOT EXISTS idx_services_coach_id
                ON services(coach_id);
            CREATE INDEX IF NOT EXISTS idx_services_active_created
                ON services(active, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_tag_point_participants_user_id
                ON tag_point_participants(user_id);
            CREATE INDEX IF NOT EXISTS idx_conversations_created_by
                ON conversations(created_by);
        """)

        # [CHAT-V2] Statut participant conversation (active / blocked)
        await conn.execute("""
            ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
            CREATE INDEX IF NOT EXISTS idx_conv_participants_status ON conversation_participants(conversation_id, status);
        """)

        # [SPOTYOU-V1] Capacité + participation communauté + présence séances
        await conn.execute("""
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS minimum_participants INTEGER NULL;
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS maximum_participants INTEGER NULL;

            CREATE TABLE IF NOT EXISTS spot_you_members (
                id TEXT PRIMARY KEY,
                spot_you_id TEXT NOT NULL REFERENCES tag_points(point_id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (spot_you_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS spot_you_attendance (
                id TEXT PRIMARY KEY,
                spot_you_id TEXT NOT NULL REFERENCES tag_points(point_id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                session_date DATE NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('going', 'not_going')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (spot_you_id, user_id, session_date)
            );

            CREATE INDEX IF NOT EXISTS idx_syu_members_spot ON spot_you_members(spot_you_id);
            CREATE INDEX IF NOT EXISTS idx_syu_members_user ON spot_you_members(user_id);
            CREATE INDEX IF NOT EXISTS idx_syu_attendance_spot ON spot_you_attendance(spot_you_id);
            CREATE INDEX IF NOT EXISTS idx_syu_attendance_date ON spot_you_attendance(session_date);
        """)

        # [APP-CONFIG-V1] Configuration globale de l'application — flags de fonctionnalités
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS app_config (
                config_key   TEXT PRIMARY KEY,
                config_value TEXT NOT NULL,
                updated_at   TIMESTAMPTZ DEFAULT NOW()
            );

            -- Par défaut MVP : réservation directe + paiement immédiat
            INSERT INTO app_config (config_key, config_value) VALUES
                ('enable_manual_approval_for_services', 'false'),
                ('enable_pay_later_for_services',       'false')
            ON CONFLICT (config_key) DO NOTHING;
        """)

    # 2. Seed données de base (users, tagpoints, tags, domaines...)
    from seed import seed_initial_data
    await seed_initial_data()

    # 3. Seed données de test (events, participants, votes, saves)
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE tag_points SET event_date = NOW() + INTERVAL '1 day 9 hours 30 minutes'   WHERE point_id = 'pt_demo001';
            UPDATE tag_points SET event_date = NOW() + INTERVAL '2 days 7 hours'              WHERE point_id = 'pt_demo014';
            UPDATE tag_points SET event_date = NOW() + INTERVAL '3 days 18 hours 30 minutes'  WHERE point_id = 'pt_demo002';
            UPDATE tag_points SET event_date = NOW() + INTERVAL '5 days 14 hours'             WHERE point_id = 'pt_demo008';
            UPDATE tag_points SET event_date = NOW() + INTERVAL '7 days 10 hours'             WHERE point_id = 'pt_demo004';
            UPDATE tag_points SET event_date = NOW() - INTERVAL '2 days 17 hours'             WHERE point_id = 'pt_demo013';
            UPDATE tag_points SET event_date = NOW() - INTERVAL '5 days 9 hours'              WHERE point_id = 'pt_demo006';
            UPDATE tag_points SET event_schedule = '{"type":"weekly","day":0,"time":"07:00"}' WHERE point_id = 'pt_demo005';
            UPDATE tag_points SET event_schedule = '{"type":"weekly","day":2,"time":"18:30"}' WHERE point_id = 'pt_demo007';
            UPDATE tag_points SET event_schedule = '{"type":"weekly","day":5,"time":"09:00"}' WHERE point_id = 'pt_demo010';
            UPDATE tag_points SET event_schedule = '{"type":"weekly","day":6,"time":"08:00"}' WHERE point_id = 'pt_demo009';
            UPDATE tag_points SET event_schedule = '{"type":"weekly","day":1,"time":"12:30"}' WHERE point_id = 'pt_demo003';
            UPDATE tag_points SET event_schedule = '{"type":"weekly","day":4,"time":"19:00"}' WHERE point_id = 'pt_demo012';
        """)
        await conn.execute("""
            INSERT INTO spot_you_members (id, spot_you_id, user_id) VALUES
              ('mbr_001','pt_demo005','user_demo001'),
              ('mbr_002','pt_demo007','user_demo001'),
              ('mbr_003','pt_demo014','user_demo001'),
              ('mbr_004','pt_demo013','user_demo001'),
              ('mbr_005','pt_demo001','user_demo002'),
              ('mbr_006','pt_demo002','user_demo002'),
              ('mbr_007','pt_demo007','user_demo002'),
              ('mbr_008','pt_demo010','user_demo002'),
              ('mbr_009','pt_demo003','user_demo003'),
              ('mbr_010','pt_demo009','user_demo003'),
              ('mbr_011','pt_demo014','user_demo003'),
              ('mbr_012','pt_demo012','user_coach001')
            ON CONFLICT (spot_you_id, user_id) DO NOTHING;
        """)
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

        # [PROFILE-V2] Cover photo + système de suivi (follow/abonnements)
        await conn.execute("""
            ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_picture TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_offset_y FLOAT DEFAULT 0.5;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_scale FLOAT DEFAULT 1.0;

            CREATE TABLE IF NOT EXISTS user_follows (
                follower_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
                following_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (follower_id, following_id)
            );
            CREATE INDEX IF NOT EXISTS idx_follows_following ON user_follows(following_id);
            CREATE INDEX IF NOT EXISTS idx_follows_follower ON user_follows(follower_id);

            -- Blocages (style Instagram)
            CREATE TABLE IF NOT EXISTS user_blocks (
                blocker_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
                blocked_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (blocker_id, blocked_id)
            );
            CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON user_blocks(blocker_id);
            CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON user_blocks(blocked_id);
        """)

        # Seed quelques relations follow pour les démos (ON CONFLICT DO NOTHING = idempotent)
        await conn.execute("""
            INSERT INTO user_follows(follower_id, following_id) VALUES
                ('user_demo001', 'user_coach001'),
                ('user_demo002', 'user_coach001'),
                ('user_demo003', 'user_coach001'),
                ('user_coach001', 'user_demo001'),
                ('user_demo001', 'user_demo002'),
                ('user_demo002', 'user_demo003')
            ON CONFLICT DO NOTHING;
        """)

        # Seed cover photos for test profiles (only if not already set)
        await conn.execute("""
            UPDATE users SET
                cover_picture = 'https://images.pexels.com/photos/1552242/pexels-photo-1552242.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
                cover_offset_y = 0.4
            WHERE user_id = 'user_coach001' AND cover_picture IS NULL;

            UPDATE users SET
                cover_picture = 'https://images.pexels.com/photos/5038834/pexels-photo-5038834.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
                cover_offset_y = 0.5
            WHERE user_id = 'user_demo001' AND cover_picture IS NULL;

            UPDATE users SET
                cover_picture = 'https://images.pexels.com/photos/5274806/pexels-photo-5274806.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
                cover_offset_y = 0.3
            WHERE user_id = 'user_demo002' AND cover_picture IS NULL;

            UPDATE users SET
                cover_picture = 'https://images.unsplash.com/photo-1758274536083-b821befda77c?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85',
                cover_offset_y = 0.5
            WHERE user_id = 'user_demo003' AND cover_picture IS NULL;
        """)

        # [REFACTOR-V1] spot_you_participants → spot_you_members + supprimer tag_point_participants
        await conn.execute("""
            DO $$ BEGIN
                IF EXISTS (SELECT FROM pg_tables WHERE tablename='spot_you_participants') THEN
                    IF EXISTS (SELECT FROM pg_tables WHERE tablename='spot_you_members') THEN
                        INSERT INTO spot_you_members (id, spot_you_id, user_id, joined_at)
                        SELECT id, spot_you_id, user_id, joined_at FROM spot_you_participants
                        ON CONFLICT DO NOTHING;
                        DROP TABLE spot_you_participants;
                    ELSE
                        ALTER TABLE spot_you_participants RENAME TO spot_you_members;
                    END IF;
                END IF;
                -- Supprimer l'ancien index s'il existe encore (remplacé par idx_syu_members_spot)
                IF EXISTS (SELECT FROM pg_indexes WHERE indexname='idx_syu_participants_spot') THEN
                    DROP INDEX idx_syu_participants_spot;
                END IF;
            END $$;

            DROP TABLE IF EXISTS tag_point_participants CASCADE;
        """)

        # Migration: Corriger les tag_ids et coach_tags stockés comme JSONB strings au lieu d'arrays
        await conn.execute("""
            UPDATE tag_points
            SET tag_ids = (tag_ids #>> '{}')::jsonb
            WHERE tag_ids IS NOT NULL
              AND jsonb_typeof(tag_ids) = 'string'
              AND left(trim(tag_ids #>> '{}'), 1) = '[';

            UPDATE users
            SET coach_tags = (coach_tags #>> '{}')::jsonb
            WHERE coach_tags IS NOT NULL
              AND jsonb_typeof(coach_tags) = 'string'
              AND left(trim(coach_tags #>> '{}'), 1) = '[';
        """)


async def close_db():
    global pool
    if pool:
        await pool.close()


def get_pool():
    return pool
