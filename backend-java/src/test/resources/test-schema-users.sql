-- Table minimale users (slice 02) — alignée sur le schéma Postgres pour les champs USER_FIELDS.
CREATE TABLE IF NOT EXISTS users (
    user_id             VARCHAR(255) NOT NULL PRIMARY KEY,
    email               VARCHAR(500),
    password_hash       VARCHAR(1000),
    name                VARCHAR(500) NOT NULL,
    role                VARCHAR(50) DEFAULT 'user' NOT NULL,
    language            VARCHAR(10) DEFAULT 'fr' NOT NULL,
    picture             VARCHAR(2000),
    cover_picture       VARCHAR(2000),
    cover_offset_y      DOUBLE PRECISION,
    cover_scale         DOUBLE PRECISION,
    bio                 VARCHAR(4000),
    phone               VARCHAR(100),
    is_coach_verified   BOOLEAN DEFAULT FALSE,
    coach_tags          VARCHAR(10000) DEFAULT '[]',
    show_phone          BOOLEAN DEFAULT FALSE NOT NULL,
    show_reviews        BOOLEAN DEFAULT TRUE NOT NULL,
    iban                VARCHAR(255),
    bic                 VARCHAR(255),
    iban_name           VARCHAR(500),
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sports_level        VARCHAR(255),
    goals               VARCHAR(10000) DEFAULT '[]',
    user_roles          VARCHAR(10000) DEFAULT '[]',
    onboarding_done     BOOLEAN DEFAULT FALSE,
    stripe_customer_id    VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS reviews (
    review_id           VARCHAR(255) NOT NULL PRIMARY KEY,
    reviewer_id         VARCHAR(255),
    reviewee_id         VARCHAR(255) NOT NULL,
    rating              DECIMAL(10, 2) NOT NULL,
    comment             VARCHAR(4000),
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_follows (
    follower_id         VARCHAR(255) NOT NULL,
    following_id        VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id          VARCHAR(255) NOT NULL,
    blocked_id          VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS domains (
    domain_id            VARCHAR(255) NOT NULL PRIMARY KEY,
    name                 VARCHAR(255) NOT NULL,
    label_fr             VARCHAR(255) NOT NULL,
    label_en             VARCHAR(255) NOT NULL,
    icon                 VARCHAR(255) NOT NULL,
    color                VARCHAR(50) DEFAULT '#1DBF73',
    active               BOOLEAN DEFAULT TRUE,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tag_categories (
    category_id          VARCHAR(255) NOT NULL PRIMARY KEY,
    domain_id            VARCHAR(255),
    entity_type          VARCHAR(50),
    name                 VARCHAR(255) NOT NULL,
    label_fr             VARCHAR(255) NOT NULL,
    label_en             VARCHAR(255) NOT NULL,
    icon                 VARCHAR(255) NOT NULL,
    active               BOOLEAN DEFAULT TRUE,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
    tag_id              VARCHAR(255) NOT NULL PRIMARY KEY,
    category_id         VARCHAR(255),
    domain_id           VARCHAR(255),
    name                VARCHAR(255) NOT NULL,
    label_fr            VARCHAR(255) NOT NULL,
    label_en            VARCHAR(255) NOT NULL,
    icon                VARCHAR(50),
    active              BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tag_category_links (
    tag_id               VARCHAR(255) NOT NULL,
    category_id          VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS tag_entity_type_links (
    tag_id               VARCHAR(255) NOT NULL,
    entity_type          VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
    service_id              VARCHAR(255) NOT NULL PRIMARY KEY,
    coach_id                VARCHAR(255) NOT NULL,
    title                   VARCHAR(255) NOT NULL,
    description             VARCHAR(2000),
    address                 VARCHAR(1000),
    price                   DECIMAL(10, 2) NOT NULL,
    duration_min            INTEGER,
    location_description    VARCHAR(500),
    max_participants        INTEGER,
    tag_ids                 VARCHAR(10000) DEFAULT '[]',
    domain_id               VARCHAR(255),
    images                  VARCHAR(10000) DEFAULT '[]',
    active                  BOOLEAN DEFAULT TRUE NOT NULL,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    booking_approval_mode   VARCHAR(50) DEFAULT 'manual_approval' NOT NULL,
    allow_pay_later         BOOLEAN DEFAULT TRUE NOT NULL,
    pay_later_expiration_minutes INTEGER
);
ALTER TABLE services ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255);
ALTER TABLE services ADD COLUMN IF NOT EXISTS media_purge_scheduled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS media_purge_notified_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS media_purged BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS media_purged_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS marketplace_products (
    product_id          VARCHAR(255) NOT NULL PRIMARY KEY,
    product_type        VARCHAR(100),
    status              VARCHAR(50),
    title               VARCHAR(500),
    description         VARCHAR(4000),
    short_description   VARCHAR(1000),
    price               DECIMAL(10, 2),
    currency            VARCHAR(20),
    pricing_type        VARCHAR(100),
    pricing_modes       VARCHAR(10000),
    price_per_hour      DECIMAL(10, 2),
    price_per_day       DECIMAL(10, 2),
    price_per_week      DECIMAL(10, 2),
    price_per_month     DECIMAL(10, 2),
    price_per_session   DECIMAL(10, 2),
    image_url           VARCHAR(2000),
    image_urls          VARCHAR(10000),
    cover_image_url     VARCHAR(2000),
    tag_ids             VARCHAR(10000),
    seller_name         VARCHAR(500),
    seller_picture_url  VARCHAR(2000),
    seller_id           VARCHAR(255),
    seller_type         VARCHAR(100),
    condition_label     VARCHAR(255),
    category            VARCHAR(255),
    subcategory         VARCHAR(255),
    skill_level         VARCHAR(255),
    lat                 DOUBLE PRECISION,
    lng                 DOUBLE PRECISION,
    city                VARCHAR(255),
    location_address_raw VARCHAR(1000),
    radius_km           DOUBLE PRECISION,
    location_privacy    VARCHAR(100),
    related_spotyou_ids VARCHAR(10000),
    delivery_modes      VARCHAR(10000),
    pickup_type         VARCHAR(100),
    pickup_notes        VARCHAR(1000),
    deposit_required    BOOLEAN,
    deposit_amount      DECIMAL(10, 2),
    available_quantity  INTEGER,
    in_stock            BOOLEAN,
    included_items      VARCHAR(10000),
    availability_note   VARCHAR(1000),
    cancellation_rules  VARCHAR(2000),
    return_rules        VARCHAR(2000),
    rejection_reason    VARCHAR(2000),
    admin_comment       VARCHAR(2000),
    brand               VARCHAR(255),
    model               VARCHAR(255),
    weight              VARCHAR(255),
    stripe_product_id   VARCHAR(255),
    stripe_price_id     VARCHAR(255),
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS size_dimensions VARCHAR(1000);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS seller_name VARCHAR(500);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS seller_picture_url VARCHAR(2000);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS location_address_raw VARCHAR(1000);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS radius_km DOUBLE PRECISION;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(2000);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS brand VARCHAR(255);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS model VARCHAR(255);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS weight VARCHAR(255);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS stripe_product_id VARCHAR(255);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS media_purge_scheduled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS media_purge_notified_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS media_purged BOOLEAN DEFAULT FALSE;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS media_purged_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS admin_validated_by VARCHAR(255);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS admin_validated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS admin_reminder_sent_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS service_locations (
    location_id          VARCHAR(255) NOT NULL PRIMARY KEY,
    service_id           VARCHAR(255) NOT NULL,
    precision            VARCHAR(50) DEFAULT 'exact',
    description          VARCHAR(1000),
    latitude             DOUBLE PRECISION,
    longitude            DOUBLE PRECISION,
    location             VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS service_slots (
    slot_id              VARCHAR(255) NOT NULL PRIMARY KEY,
    service_id           VARCHAR(255) NOT NULL,
    slot_type            VARCHAR(50),
    slot_status          VARCHAR(50) DEFAULT 'available',
    location_id          VARCHAR(255),
    package_id           VARCHAR(255),
    day_of_week          INTEGER,
    days_of_week         VARCHAR(1000),
    start_time           TIME,
    end_time             TIME,
    slot_date            DATE
);

CREATE TABLE IF NOT EXISTS service_packages (
    package_id           VARCHAR(255) NOT NULL PRIMARY KEY,
    service_id           VARCHAR(255) NOT NULL,
    type_id              VARCHAR(255),
    type_label           VARCHAR(255),
    duration_min         INTEGER,
    max_participants     INTEGER,
    price                DECIMAL(10, 2) NOT NULL,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_saves (
    save_id               VARCHAR(255) NOT NULL PRIMARY KEY,
    user_id               VARCHAR(255) NOT NULL,
    service_id            VARCHAR(255) NOT NULL,
    saved_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_saves_service_user ON service_saves (service_id, user_id);

CREATE TABLE IF NOT EXISTS bookings (
    booking_id           VARCHAR(255) NOT NULL PRIMARY KEY,
    service_id           VARCHAR(255),
    user_id              VARCHAR(255),
    coach_id             VARCHAR(255),
    status               VARCHAR(50),
    scheduled_at         TIMESTAMP WITH TIME ZONE,
    slot_id              VARCHAR(255),
    location_id          VARCHAR(255),
    notes                VARCHAR(4000),
    amount               DECIMAL(10, 2),
    payment_status       VARCHAR(50),
    payer_user_id        VARCHAR(255),
    receiver_user_id     VARCHAR(255),
    pricing_snapshot     VARCHAR(10000),
    idempotency_key      VARCHAR(255),
    currency             VARCHAR(20) DEFAULT 'EUR',
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at           TIMESTAMP WITH TIME ZONE,
    cancelled_by_user_id VARCHAR(255),
    cancellation_reason  VARCHAR(1000),
    payment_mode         VARCHAR(50) DEFAULT 'pay_now'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_idempotency_key
    ON bookings(idempotency_key);

CREATE TABLE IF NOT EXISTS payments (
    payment_id                VARCHAR(255) NOT NULL PRIMARY KEY,
    booking_id                VARCHAR(255),
    payer_user_id             VARCHAR(255),
    receiver_user_id          VARCHAR(255),
    product_type              VARCHAR(255),
    product_id                VARCHAR(255),
    status                    VARCHAR(50),
    currency                  VARCHAR(20) DEFAULT 'EUR',
    base_amount               DECIMAL(10, 2),
    payer_fixed_fee           DECIMAL(10, 2),
    payer_percent_fee_amount  DECIMAL(10, 2),
    receiver_fixed_fee        DECIMAL(10, 2),
    receiver_percent_fee_amount DECIMAL(10, 2),
    platform_total_fee        DECIMAL(10, 2),
    receiver_net_amount       DECIMAL(10, 2),
    stripe_payment_intent_id  VARCHAR(255),
    stripe_checkout_session_id VARCHAR(255),
    stripe_charge_id          VARCHAR(255),
    stripe_transfer_id        VARCHAR(255),
    pricing_rule_snapshot     VARCHAR(10000),
    refund_amount             DECIMAL(10, 2),
    refund_status             VARCHAR(50),
    payer_total_amount        DECIMAL(10, 2),
    created_at                TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    event_id       VARCHAR(255) NOT NULL PRIMARY KEY,
    event_type     VARCHAR(255),
    status         VARCHAR(50),
    related_id     VARCHAR(255),
    error_message  VARCHAR(500),
    processed_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    notif_id      VARCHAR(255) NOT NULL PRIMARY KEY,
    user_id       VARCHAR(255),
    type          VARCHAR(100) NOT NULL,
    title         VARCHAR(255) NOT NULL,
    body          VARCHAR(2000) NOT NULL,
    data          VARCHAR(10000) DEFAULT '{}',
    read          BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_tokens (
    token_id      VARCHAR(255) NOT NULL PRIMARY KEY,
    user_id       VARCHAR(255),
    token         VARCHAR(2000) NOT NULL UNIQUE,
    platform      VARCHAR(100) DEFAULT 'expo',
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tag_points (
    point_id                 VARCHAR(255) NOT NULL PRIMARY KEY,
    user_id                  VARCHAR(255) NOT NULL,
    title                    VARCHAR(255) NOT NULL,
    description              VARCHAR(2000),
    precision                VARCHAR(50),
    images                   VARCHAR(10000) DEFAULT '[]',
    image_url                VARCHAR(2000),
    event_date               DATE,
    event_end_date           DATE,
    event_schedule           VARCHAR(10000),
    schedule                 VARCHAR(10000),
    domain_id                VARCHAR(255),
    tag_ids                  VARCHAR(10000) DEFAULT '[]',
    minimum_participants     INTEGER,
    maximum_participants     INTEGER,
    latitude                 DOUBLE PRECISION,
    longitude                DOUBLE PRECISION,
    location                 VARCHAR(255),
    visibility_type          VARCHAR(50) DEFAULT 'public',
    cancelled                BOOLEAN DEFAULT FALSE,
    active                   BOOLEAN DEFAULT TRUE NOT NULL,
    deleted_at               TIMESTAMP WITH TIME ZONE,
    deleted_by               VARCHAR(255),
    expires_at               TIMESTAMP WITH TIME ZONE,
    created_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    new_date_coming          BOOLEAN DEFAULT FALSE,
    address                  VARCHAR(1000),
    media_purge_scheduled_at TIMESTAMP WITH TIME ZONE,
    media_purge_notified_at  TIMESTAMP WITH TIME ZONE,
    media_purged             BOOLEAN DEFAULT FALSE,
    media_purged_at          TIMESTAMP WITH TIME ZONE,
    reactivated_at           TIMESTAMP WITH TIME ZONE,
    join_mode                VARCHAR(50) DEFAULT 'open',
    invite_permissions       VARCHAR(50) DEFAULT 'members',
    max_community_members    INTEGER
);

CREATE TABLE IF NOT EXISTS spot_you_members (
    id               VARCHAR(255) NOT NULL PRIMARY KEY,
    spot_you_id      VARCHAR(255) NOT NULL,
    user_id          VARCHAR(255) NOT NULL,
    status           VARCHAR(50) DEFAULT 'accepted' NOT NULL,
    joined_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    requested_by     VARCHAR(255),
    invited_by       VARCHAR(255),
    invited_at       TIMESTAMP WITH TIME ZONE,
    approved_by      VARCHAR(255)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_spot_you_members_spot_user ON spot_you_members (spot_you_id, user_id);

CREATE TABLE IF NOT EXISTS tag_point_saves (
    save_id          VARCHAR(255) NOT NULL PRIMARY KEY,
    point_id         VARCHAR(255) NOT NULL,
    user_id          VARCHAR(255) NOT NULL,
    saved_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tag_point_saves_point_user ON tag_point_saves (point_id, user_id);

CREATE TABLE IF NOT EXISTS spot_you_attendance (
    id               VARCHAR(255) NOT NULL PRIMARY KEY,
    spot_you_id      VARCHAR(255) NOT NULL,
    user_id          VARCHAR(255) NOT NULL,
    session_date     DATE,
    status           VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS tag_point_votes (
    id               VARCHAR(255) NOT NULL PRIMARY KEY,
    point_id         VARCHAR(255) NOT NULL,
    rating           DECIMAL(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
    conversation_id  VARCHAR(255) NOT NULL PRIMARY KEY,
    type             VARCHAR(64) DEFAULT 'service',
    context_id       VARCHAR(255),
    context_title    VARCHAR(500),
    created_by       VARCHAR(255),
    last_message_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at       TIMESTAMP WITH TIME ZONE,
    context_deleted  BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id  VARCHAR(255) NOT NULL,
    user_id          VARCHAR(255) NOT NULL,
    joined_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_read_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status           VARCHAR(32) DEFAULT 'active',
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    message_id       VARCHAR(255) NOT NULL PRIMARY KEY,
    conversation_id  VARCHAR(255),
    sender_id        VARCHAR(255),
    content          VARCHAR(4000) NOT NULL,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at       TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_participants_status ON conversation_participants(conversation_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS pending_file_deletions (
    id               BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    file_url         VARCHAR(2000) NOT NULL,
    entity_type      VARCHAR(100) NOT NULL,
    entity_id        VARCHAR(255) NOT NULL,
    scheduled_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    status           VARCHAR(50) DEFAULT 'pending',
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_file_deletions_file_entity
ON pending_file_deletions(file_url, entity_id);

CREATE TABLE IF NOT EXISTS subscription_plans (
    plan_id                  VARCHAR(255) NOT NULL PRIMARY KEY,
    name                     VARCHAR(500) NOT NULL,
    description              VARCHAR(2000),
    price                    DECIMAL(10, 2) DEFAULT 0 NOT NULL,
    duration_days            INTEGER,
    exempt_payer_fixed       BOOLEAN DEFAULT FALSE,
    exempt_payer_percent     BOOLEAN DEFAULT FALSE,
    exempt_receiver_fixed    BOOLEAN DEFAULT FALSE,
    exempt_receiver_percent  BOOLEAN DEFAULT FALSE,
    active                   BOOLEAN DEFAULT TRUE,
    priority                 INTEGER DEFAULT 0,
    created_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    stripe_product_id        VARCHAR(255),
    stripe_price_id          VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
    subscription_id          VARCHAR(255) NOT NULL PRIMARY KEY,
    user_id                  VARCHAR(255),
    plan_id                  VARCHAR(255),
    status                   VARCHAR(50) DEFAULT 'active',
    started_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at               TIMESTAMP WITH TIME ZONE,
    created_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    plan_code                VARCHAR(255),
    stripe_subscription_id   VARCHAR(255),
    benefits_snapshot        VARCHAR(10000),
    cancelled_at             TIMESTAMP WITH TIME ZONE,
    updated_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_subscriptions_plan_id FOREIGN KEY (plan_id) REFERENCES subscription_plans(plan_id)
);
