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
    entity_type TEXT,
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

CREATE TABLE IF NOT EXISTS tag_category_links (
    tag_id TEXT REFERENCES tags(tag_id) ON DELETE CASCADE,
    category_id TEXT REFERENCES tag_categories(category_id) ON DELETE CASCADE,
    PRIMARY KEY (tag_id, category_id)
);

CREATE TABLE IF NOT EXISTS tag_entity_type_links (
    tag_id TEXT REFERENCES tags(tag_id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('spotyou', 'service', 'product')),
    PRIMARY KEY (tag_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_tag_category_links_cat ON tag_category_links(category_id);
CREATE INDEX IF NOT EXISTS idx_tag_entity_type_links_type ON tag_entity_type_links(entity_type);
CREATE INDEX IF NOT EXISTS idx_tag_categories_entity_type ON tag_categories(entity_type);

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

        # [SPOTYOU-ADDRESS] Ajout champ adresse aux tag_points
        await conn.execute("""
            ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS address TEXT;
        """)

        # [MARKETPLACE] Table produits marketplace
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS marketplace_products (
                product_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                price NUMERIC(10,2) NOT NULL DEFAULT 0,
                currency TEXT DEFAULT 'EUR',
                product_type TEXT NOT NULL DEFAULT 'sale',
                seller_type TEXT NOT NULL DEFAULT 'spotu',
                seller_id TEXT REFERENCES users(user_id),
                tag_ids TEXT[] DEFAULT '{}',
                image_url TEXT,
                in_stock BOOLEAN DEFAULT TRUE,
                skill_level TEXT DEFAULT 'tous',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        """)

    # 2. Seed données de base (users, tagpoints, tags, domaines...)
    # NOTE: le seed est lancé APRÈS toutes les migrations (voir fin du bloc connect_to_db)
    # pour garantir que toutes les colonnes existent

        # [MARKETPLACE-GEO] Colonnes lat/lng pour produits physiques + coordonnées seed
        await conn.execute("""
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS lat FLOAT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS lng FLOAT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS category TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS admin_reminder_sent_at TIMESTAMPTZ;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS short_description TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS pricing_type TEXT DEFAULT 'day';
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS seller_name TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS seller_picture_url TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS subcategory TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS condition_label TEXT DEFAULT 'good';
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS included_items TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS brand_model TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS size_dimensions TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS available_quantity INTEGER DEFAULT 1;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS deposit_required BOOLEAN DEFAULT FALSE;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2) DEFAULT 0;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS max_duration_days INTEGER;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS pickup_type TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS pickup_notes TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS availability_note TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS return_rules TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS cancellation_rules TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS city TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS location_privacy TEXT DEFAULT '100m';
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS radius_km FLOAT DEFAULT 0.1;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS related_spotyou_ids TEXT[] DEFAULT '{}';
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS admin_comment TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS admin_validated_by TEXT;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS admin_validated_at TIMESTAMPTZ;
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS pricing_modes TEXT[] DEFAULT '{day}';
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS price_per_hour NUMERIC(10,2);
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS price_per_day NUMERIC(10,2);
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS price_per_week NUMERIC(10,2);
            ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS price_per_month NUMERIC(10,2);
        """)
        # [MARKETPLACE-CLEANUP] Supprimer les produits qui sont en réalité des services coach
        # (séances, cours, bilans) — déjà gérés via la table services
        await conn.execute("""
            DELETE FROM marketplace_products WHERE product_id IN (
                'mp_028',  -- Session CrossFit privée (1h)       = service coach
                'mp_035',  -- Séance yoga privée (1h)            = service coach
                'mp_048',  -- Cours padel débutant (2h)          = service coach
                'mp_041',  -- Cours boxe thaï débutant (x5)      = service coach
                'mp_053',  -- Analyse posturale + bilan           = prestation pro
                'mp_057'   -- Séance coaching bilan gratuit (30min) = service coach
            );
        """)
        await conn.execute("""
            UPDATE marketplace_products SET lat = 48.8500, lng = 2.3700
                WHERE product_id = 'mp_009';
            UPDATE marketplace_products SET lat = 48.8630, lng = 2.3590
                WHERE product_id = 'mp_013';
            UPDATE marketplace_products SET lat = 48.8800, lng = 2.3200
                WHERE product_id = 'mp_021';
            UPDATE marketplace_products SET lat = 48.8770, lng = 2.3580
                WHERE product_id = 'mp_040';
            UPDATE marketplace_products SET lat = 48.8900, lng = 2.3650
                WHERE product_id = 'mp_045';
        """)

        # [MARKETPLACE-DELIVERY] Modes de remise produits
        await conn.execute("""
            ALTER TABLE marketplace_products
                ADD COLUMN IF NOT EXISTS delivery_modes TEXT[] DEFAULT '{}';
        """)
        await conn.execute("""
            -- Produits numériques (PDF, app, vidéos)
            UPDATE marketplace_products SET delivery_modes = ARRAY['digital']
                WHERE product_id IN ('mp_011','mp_019','mp_023','mp_030','mp_034');

            -- Location avec lieu physique GPS : récupérer sur place + remis par créateur
            UPDATE marketplace_products SET delivery_modes = ARRAY['local_pickup','creator_handoff']
                WHERE product_id IN ('mp_009','mp_013','mp_021','mp_040');

            -- Location terrain : récupérer sur place uniquement
            UPDATE marketplace_products SET delivery_modes = ARRAY['local_pickup']
                WHERE product_id = 'mp_045';

            -- Remise directe par créateur (sans GPS précis)
            UPDATE marketplace_products SET delivery_modes = ARRAY['creator_handoff']
                WHERE product_id IN ('mp_010','mp_012');

            -- Produits plateforme / affiliés / sponsorisés → site partenaire
            UPDATE marketplace_products
                SET delivery_modes = ARRAY['external']
                WHERE (delivery_modes IS NULL OR delivery_modes = '{}')
                  AND seller_type IN ('spotu','affiliated','sponsored','recommended');
        """)

        # [MARKETPLACE-RENTAL-DURATION] Durée de location + nettoyage des titres
        await conn.execute("""
            ALTER TABLE marketplace_products
                ADD COLUMN IF NOT EXISTS rental_duration_unit TEXT;
            ALTER TABLE marketplace_products
                ADD COLUMN IF NOT EXISTS rental_duration_qty  INT DEFAULT 1;
        """)
        await conn.execute("""
            -- Vélo journée : 1 jour
            UPDATE marketplace_products
                SET rental_duration_unit = 'jour', rental_duration_qty = 1,
                    title = 'Location vélo de route'
                WHERE product_id = 'mp_009';

            -- Vélo weekend : 2 jours
            UPDATE marketplace_products
                SET rental_duration_unit = 'jour', rental_duration_qty = 2,
                    title = 'Location vélo route'
                WHERE product_id = 'mp_021';

            -- Tapis + briques yoga : 1 jour
            UPDATE marketplace_products
                SET rental_duration_unit = 'jour', rental_duration_qty = 1
                WHERE product_id = 'mp_010';

            -- Raquettes padel : 2 heures
            UPDATE marketplace_products
                SET rental_duration_unit = 'heure', rental_duration_qty = 2,
                    title = 'Location raquettes padel'
                WHERE product_id = 'mp_013';

            -- Gants de boxe : 1 heure
            UPDATE marketplace_products
                SET rental_duration_unit = 'heure', rental_duration_qty = 1,
                    title = 'Location gants boxe'
                WHERE product_id = 'mp_040';

            -- Terrain foot : 1 heure
            UPDATE marketplace_products
                SET rental_duration_unit = 'heure', rental_duration_qty = 1,
                    title = 'Location terrain foot 5v5'
                WHERE product_id = 'mp_045';
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

            CREATE TABLE IF NOT EXISTS user_saved_addresses (
                address_id  TEXT PRIMARY KEY,
                user_id     TEXT REFERENCES users(user_id) ON DELETE CASCADE,
                label       TEXT NOT NULL,
                address     TEXT NOT NULL,
                lat         FLOAT8 NOT NULL,
                lng         FLOAT8 NOT NULL,
                icon        TEXT NOT NULL DEFAULT 'location-outline',
                position    INT NOT NULL DEFAULT 0,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_saved_addresses_user ON user_saved_addresses(user_id);
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

        # [ONBOARDING] New profile fields for onboarding flow
        await conn.execute("""
            ALTER TABLE users ADD COLUMN IF NOT EXISTS sports_level TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS goals JSONB DEFAULT '[]';
            ALTER TABLE users ADD COLUMN IF NOT EXISTS user_roles JSONB DEFAULT '[]';
            ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_done BOOLEAN DEFAULT FALSE;
        """)
        # Mark pre-existing users as onboarded (new registrations stay FALSE for onboarding flow)
        await conn.execute("""
            UPDATE users SET onboarding_done = TRUE
            WHERE created_at < NOW() - INTERVAL '1 minute'
              AND (onboarding_done IS NULL OR onboarding_done = FALSE)
        """)
        await conn.execute("""
            UPDATE users
            SET onboarding_done = TRUE, updated_at = NOW()
            WHERE email = ANY($1::text[])
              AND (onboarding_done IS NULL OR onboarding_done = FALSE)
        """, [
            'admin@winek.app',
            'coach@winek.app',
            'user@winek.app',
            'mbenali@winek.app',
            'cdurand@winek.app',
        ])

        # Seed données de base (users, tagpoints, tags, domaines...) — APRÈS toutes les migrations
    from seed import seed_initial_data
    await seed_initial_data()

    # Seed données de test (follows, cover photos, membres SpotYou, votes, saves) — APRÈS seed_initial_data
    async with pool.acquire() as conn:
        # User follows — dépend des utilisateurs créés par seed_initial_data
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

        # Cover photos — dépend des utilisateurs créés par seed_initial_data
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

        # Members SpotYou — seulement les IDs existants
        await conn.execute("""
            INSERT INTO spot_you_members (id, spot_you_id, user_id) VALUES
              ('mbr_p1_u1','pt_demo001','user_demo001'),
              ('mbr_p1_u2','pt_demo001','user_demo002'),
              ('mbr_p2_u1','pt_demo002','user_demo001'),
              ('mbr_p2_u3','pt_demo002','user_demo003'),
              ('mbr_p3_u2','pt_demo003','user_demo002'),
              ('mbr_p3_u3','pt_demo003','user_demo003'),
              ('mbr_p4_u1','pt_demo004','user_demo001'),
              ('mbr_p5_u2','pt_demo005','user_demo002'),
              ('mbr_p5_u3','pt_demo005','user_demo003')
            ON CONFLICT (spot_you_id, user_id) DO NOTHING;
        """)
        await conn.execute("""
            INSERT INTO tag_point_votes (vote_id, point_id, user_id, rating, comment, created_at) VALUES
              ('vote_001','pt_demo001','user_demo002',5,'Super groupe HIIT, ambiance top !', NOW()-INTERVAL '2 days'),
              ('vote_002','pt_demo001','user_demo003',4,'Bon rythme, accessible à tous.', NOW()-INTERVAL '1 day'),
              ('vote_003','pt_demo002','user_demo001',5,'Parcours running magnifique, parfait.', NOW()-INTERVAL '3 days'),
              ('vote_004','pt_demo002','user_demo003',4,'Bonne organisation, rythme adapté.', NOW()-INTERVAL '1 day'),
              ('vote_005','pt_demo003','user_demo001',5,'Vue imprenable, séance ressourçante.', NOW()-INTERVAL '4 days'),
              ('vote_006','pt_demo003','user_demo002',5,'Instructeur patient et bienveillant.', NOW()-INTERVAL '2 days'),
              ('vote_007','pt_demo004','user_demo002',4,'Randonnée magnifique en forêt.', NOW()-INTERVAL '1 day'),
              ('vote_008','pt_demo005','user_demo001',5,'Initiation bushcraft top !', NOW()-INTERVAL '2 days'),
              ('vote_009','pt_demo005','user_demo003',5,'Week-end incroyable, je recommande.', NOW()-INTERVAL '1 day')
            ON CONFLICT (point_id, user_id) DO UPDATE SET rating=EXCLUDED.rating, comment=EXCLUDED.comment;
        """)
        await conn.execute("""
            INSERT INTO tag_point_saves (save_id, point_id, user_id, saved_at) VALUES
              ('save_001','pt_demo001','user_demo002', NOW()-INTERVAL '2 days'),
              ('save_002','pt_demo003','user_demo001', NOW()-INTERVAL '1 day'),
              ('save_003','pt_demo004','user_demo003', NOW()-INTERVAL '3 hours'),
              ('save_004','pt_demo005','user_demo002', NOW()-INTERVAL '1 day')
            ON CONFLICT (point_id, user_id) DO NOTHING;
        """)

    # ── REPAIR IDEMPOTENT: tag_category_links + tag_entity_type_links ─────────
    # Ce bloc tourne à chaque démarrage (ON CONFLICT DO NOTHING = safe)
    # Il répare les liens manquants si le seed initial a crashé partiellement
    from seed import _build_tag_category_links, _build_tag_entity_type_links
    async with pool.acquire() as conn:
        for lnk in _build_tag_category_links():
            await conn.execute(
                "INSERT INTO tag_category_links (tag_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                lnk["tag_id"], lnk["category_id"]
            )
        for lnk in _build_tag_entity_type_links():
            await conn.execute(
                "INSERT INTO tag_entity_type_links (tag_id, entity_type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                lnk["tag_id"], lnk["entity_type"]
            )


async def close_db():
    global pool
    if pool:
        await pool.close()


def get_pool():
    return pool
