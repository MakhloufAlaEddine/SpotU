-- =============================================================================
-- Migration 001 — Schéma initial complet (baseline)
-- Date        : 2026-03-31
-- Description : Export propre du schéma PostgreSQL existant.
--               Cette migration ne doit jamais être modifiée.
-- =============================================================================

-- Extensions requises
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

--
-- PostgreSQL database dump
--
-- Dumped from database version 15.16 (Debian 15.16-0+deb12u1)
-- Dumped by pg_dump version 15.16 (Debian 15.16-0+deb12u1)

SELECT pg_catalog.set_config('search_path', '', false);

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

--
-- Name: app_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_config (
    config_key text NOT NULL,
    config_value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);
--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    booking_id text NOT NULL,
    service_id text,
    user_id text,
    coach_id text,
    status text DEFAULT 'pending'::text,
    scheduled_at timestamp with time zone,
    notes text,
    amount numeric(10,2),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    slot_id text,
    location_id text,
    payer_user_id text,
    receiver_user_id text,
    payment_status text DEFAULT 'pending'::text,
    payment_provider text,
    payment_intent_id text,
    pricing_snapshot jsonb,
    currency text DEFAULT 'EUR'::text,
    idempotency_key text,
    expires_at timestamp with time zone,
    cancelled_by_user_id text,
    cancellation_reason text,
    payment_mode text DEFAULT 'pay_now'::text
);
--
-- Name: conversation_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_participants (
    conversation_id text NOT NULL,
    user_id text NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    last_read_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'active'::text NOT NULL
);
--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    conversation_id text NOT NULL,
    type text NOT NULL,
    context_id text NOT NULL,
    context_title text NOT NULL,
    created_by text,
    last_message_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT conversations_type_check CHECK ((type = ANY (ARRAY['service'::text, 'tagpoint_group'::text, 'tagpoint_private'::text])))
);
--
-- Name: domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.domains (
    domain_id text NOT NULL,
    name text NOT NULL,
    label_fr text NOT NULL,
    label_en text NOT NULL,
    icon text NOT NULL,
    color text DEFAULT '#1DBF73'::text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);
--
-- Name: marketplace_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_products (
    product_id text NOT NULL,
    title text NOT NULL,
    description text,
    price numeric(10,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'EUR'::text,
    product_type text DEFAULT 'sale'::text NOT NULL,
    seller_type text DEFAULT 'spotu'::text NOT NULL,
    seller_id text,
    tag_ids text[] DEFAULT '{}'::text[],
    image_url text,
    in_stock boolean DEFAULT true,
    skill_level text DEFAULT 'tous'::text,
    created_at timestamp with time zone DEFAULT now(),
    lat double precision,
    lng double precision,
    status text DEFAULT 'active'::text,
    category text,
    admin_reminder_sent_at timestamp with time zone,
    short_description text,
    pricing_type text DEFAULT 'day'::text,
    seller_name text,
    seller_picture_url text,
    subcategory text,
    cover_image_url text,
    image_urls jsonb DEFAULT '[]'::jsonb,
    condition_label text DEFAULT 'good'::text,
    included_items text,
    brand_model text,
    size_dimensions text,
    available_quantity integer DEFAULT 1,
    deposit_required boolean DEFAULT false,
    deposit_amount numeric(10,2) DEFAULT 0,
    max_duration_days integer,
    pickup_type text,
    pickup_notes text,
    availability_note text,
    return_rules text,
    cancellation_rules text,
    city text,
    location_privacy text DEFAULT '100m'::text,
    radius_km double precision DEFAULT 0.1,
    related_spotyou_ids text[] DEFAULT '{}'::text[],
    updated_at timestamp with time zone DEFAULT now(),
    rejection_reason text,
    admin_comment text,
    admin_validated_by text,
    admin_validated_at timestamp with time zone,
    pricing_modes text[] DEFAULT '{day}'::text[],
    price_per_hour numeric(10,2),
    price_per_day numeric(10,2),
    price_per_week numeric(10,2),
    price_per_month numeric(10,2),
    price_per_session numeric(10,2),
    brand text,
    model text,
    weight text,
    stripe_product_id text,
    stripe_price_id text,
    delivery_modes text[] DEFAULT '{}'::text[],
    rental_duration_unit text,
    rental_duration_qty integer DEFAULT 1
);
--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    message_id text NOT NULL,
    conversation_id text,
    sender_id text,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    notif_id text NOT NULL,
    user_id text,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);
--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    payment_id text NOT NULL,
    payer_user_id text NOT NULL,
    receiver_user_id text,
    product_type text NOT NULL,
    product_id text,
    booking_id text,
    stripe_payment_intent_id text,
    stripe_charge_id text,
    stripe_transfer_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    currency text DEFAULT 'EUR'::text NOT NULL,
    base_amount numeric(12,2) NOT NULL,
    payer_fixed_fee numeric(12,2) DEFAULT 0 NOT NULL,
    payer_percent_fee_amount numeric(12,2) DEFAULT 0 NOT NULL,
    receiver_fixed_fee numeric(12,2) DEFAULT 0 NOT NULL,
    receiver_percent_fee_amount numeric(12,2) DEFAULT 0 NOT NULL,
    platform_total_fee numeric(12,2) DEFAULT 0 NOT NULL,
    receiver_net_amount numeric(12,2) NOT NULL,
    payer_total_amount numeric(12,2) NOT NULL,
    pricing_rule_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    stripe_checkout_session_id text,
    refund_amount numeric(10,2) DEFAULT 0,
    refund_status text
);
--
-- Name: pricing_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_rules (
    rule_id text NOT NULL,
    product_type text NOT NULL,
    name text NOT NULL,
    payer_fixed_fee numeric(10,2) DEFAULT 0,
    payer_percent_fee numeric(5,2) DEFAULT 0,
    receiver_fixed_fee numeric(10,2) DEFAULT 0,
    receiver_percent_fee numeric(5,2) DEFAULT 0,
    active boolean DEFAULT true,
    priority integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    description text,
    currency text DEFAULT 'EUR'::text
);
--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_tokens (
    token_id text NOT NULL,
    user_id text,
    token text NOT NULL,
    platform text DEFAULT 'expo'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    last_used_at timestamp with time zone
);
--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    review_id text NOT NULL,
    booking_id text,
    reviewer_id text,
    reviewee_id text,
    rating integer,
    comment text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);
--
-- Name: service_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_locations (
    location_id text NOT NULL,
    service_id text,
    location public.geometry(Point,4326),
    "precision" text DEFAULT 'exact'::text,
    description text,
    created_at timestamp with time zone DEFAULT now()
);
--
-- Name: service_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_packages (
    package_id text NOT NULL,
    service_id text,
    type_id text NOT NULL,
    type_label text NOT NULL,
    duration_min integer DEFAULT 60,
    max_participants integer DEFAULT 1,
    price numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);
--
-- Name: service_saves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_saves (
    save_id text NOT NULL,
    service_id text,
    user_id text,
    saved_at timestamp with time zone DEFAULT now()
);
--
-- Name: service_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_slots (
    slot_id text NOT NULL,
    service_id text,
    day_of_week integer,
    start_time text NOT NULL,
    end_time text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    slot_type text DEFAULT 'recurring'::text,
    slot_date text,
    days_of_week jsonb DEFAULT '[]'::jsonb,
    raw_schedule jsonb,
    location_id text,
    package_id text,
    slot_status text DEFAULT 'available'::text NOT NULL,
    CONSTRAINT service_slots_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);
--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    service_id text NOT NULL,
    coach_id text,
    title text NOT NULL,
    description text,
    address text,
    price numeric(10,2) NOT NULL,
    duration_min integer DEFAULT 60,
    tag_ids jsonb DEFAULT '[]'::jsonb,
    domain_id text,
    location public.geometry(Point,4326),
    location_description text,
    max_participants integer DEFAULT 1,
    active boolean DEFAULT true,
    images jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    booking_approval_mode text DEFAULT 'manual_approval'::text NOT NULL,
    allow_pay_later boolean DEFAULT true NOT NULL,
    pay_later_expiration_minutes integer DEFAULT 1440
);
--
-- Name: spot_you_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spot_you_attendance (
    id text NOT NULL,
    spot_you_id text NOT NULL,
    user_id text NOT NULL,
    session_date date NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT spot_you_attendance_status_check CHECK ((status = ANY (ARRAY['going'::text, 'not_going'::text])))
);
--
-- Name: spot_you_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spot_you_members (
    id text NOT NULL,
    spot_you_id text NOT NULL,
    user_id text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: stripe_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_webhook_events (
    event_id text NOT NULL,
    event_type text NOT NULL,
    status text DEFAULT 'processing'::text NOT NULL,
    related_id text,
    error_message text,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: subscription_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_plans (
    plan_id text NOT NULL,
    name text NOT NULL,
    description text,
    price numeric(10,2) DEFAULT 0 NOT NULL,
    duration_days integer,
    exempt_payer_fixed boolean DEFAULT false,
    exempt_payer_percent boolean DEFAULT false,
    exempt_receiver_fixed boolean DEFAULT false,
    exempt_receiver_percent boolean DEFAULT false,
    active boolean DEFAULT true,
    priority integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    stripe_product_id text,
    stripe_price_id text
);
--
-- Name: tag_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_categories (
    category_id text NOT NULL,
    domain_id text,
    entity_type text,
    name text NOT NULL,
    label_fr text NOT NULL,
    label_en text NOT NULL,
    icon text NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);
--
-- Name: tag_category_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_category_links (
    tag_id text NOT NULL,
    category_id text NOT NULL
);
--
-- Name: tag_entity_type_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_entity_type_links (
    tag_id text NOT NULL,
    entity_type text NOT NULL,
    CONSTRAINT tag_entity_type_links_entity_type_check CHECK ((entity_type = ANY (ARRAY['spotyou'::text, 'service'::text, 'product'::text])))
);
--
-- Name: tag_point_saves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_point_saves (
    save_id text NOT NULL,
    point_id text,
    user_id text,
    saved_at timestamp with time zone DEFAULT now()
);
--
-- Name: tag_point_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_point_votes (
    vote_id text NOT NULL,
    point_id text,
    user_id text,
    rating integer NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tag_point_votes_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);
--
-- Name: tag_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_points (
    point_id text NOT NULL,
    user_id text,
    title text NOT NULL,
    description text,
    location public.geometry(Point,4326),
    "precision" text DEFAULT 'exact'::text,
    tag_ids jsonb DEFAULT '[]'::jsonb,
    domain_id text,
    active boolean DEFAULT true,
    is_public boolean DEFAULT true,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    image_url text,
    images jsonb DEFAULT '[]'::jsonb,
    schedule text,
    event_date timestamp with time zone,
    event_end_date timestamp with time zone,
    event_schedule jsonb,
    new_date_coming boolean DEFAULT false,
    cancelled boolean DEFAULT false,
    minimum_participants integer,
    maximum_participants integer,
    address text
);
--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    tag_id text NOT NULL,
    category_id text,
    domain_id text,
    name text NOT NULL,
    label_fr text NOT NULL,
    label_en text NOT NULL,
    icon text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);
--
-- Name: user_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_blocks (
    blocker_id text NOT NULL,
    blocked_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
--
-- Name: user_follows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_follows (
    follower_id text NOT NULL,
    following_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
--
-- Name: user_saved_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_saved_addresses (
    address_id text NOT NULL,
    user_id text,
    label text NOT NULL,
    address text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    icon text DEFAULT 'location-outline'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
--
-- Name: user_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_subscriptions (
    subscription_id text NOT NULL,
    user_id text,
    plan_id text,
    status text DEFAULT 'active'::text,
    started_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    plan_code text,
    stripe_subscription_id text,
    benefits_snapshot jsonb,
    cancelled_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now()
);
--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id text NOT NULL,
    email text,
    password_hash text,
    name text NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    language text DEFAULT 'fr'::text NOT NULL,
    picture text,
    bio text,
    phone text,
    is_coach_verified boolean DEFAULT false,
    coach_tags jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    show_phone boolean DEFAULT false NOT NULL,
    show_reviews boolean DEFAULT true NOT NULL,
    iban text,
    bic text,
    iban_name text,
    stripe_customer_id text,
    stripe_account_id text,
    cover_picture text,
    cover_offset_y double precision DEFAULT 0.5,
    cover_scale double precision DEFAULT 1.0,
    sports_level text,
    goals jsonb DEFAULT '[]'::jsonb,
    user_roles jsonb DEFAULT '[]'::jsonb,
    onboarding_done boolean DEFAULT false
);
--
-- Name: app_config app_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_config
    ADD CONSTRAINT app_config_pkey PRIMARY KEY (config_key);
--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (booking_id);
--
-- Name: conversation_participants conversation_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_pkey PRIMARY KEY (conversation_id, user_id);
--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (conversation_id);
--
-- Name: domains domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domains
    ADD CONSTRAINT domains_pkey PRIMARY KEY (domain_id);
--
-- Name: marketplace_products marketplace_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_products
    ADD CONSTRAINT marketplace_products_pkey PRIMARY KEY (product_id);
--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (message_id);
--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (notif_id);
--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (payment_id);
--
-- Name: pricing_rules pricing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT pricing_rules_pkey PRIMARY KEY (rule_id);
--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (token_id);
--
-- Name: push_tokens push_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_token_key UNIQUE (token);
--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (review_id);
--
-- Name: service_locations service_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_locations
    ADD CONSTRAINT service_locations_pkey PRIMARY KEY (location_id);
--
-- Name: service_packages service_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_packages
    ADD CONSTRAINT service_packages_pkey PRIMARY KEY (package_id);
--
-- Name: service_saves service_saves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_saves
    ADD CONSTRAINT service_saves_pkey PRIMARY KEY (save_id);
--
-- Name: service_saves service_saves_service_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_saves
    ADD CONSTRAINT service_saves_service_id_user_id_key UNIQUE (service_id, user_id);
--
-- Name: service_slots service_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_slots
    ADD CONSTRAINT service_slots_pkey PRIMARY KEY (slot_id);
--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (service_id);
--
-- Name: spot_you_attendance spot_you_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spot_you_attendance
    ADD CONSTRAINT spot_you_attendance_pkey PRIMARY KEY (id);
--
-- Name: spot_you_attendance spot_you_attendance_spot_you_id_user_id_session_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spot_you_attendance
    ADD CONSTRAINT spot_you_attendance_spot_you_id_user_id_session_date_key UNIQUE (spot_you_id, user_id, session_date);
--
-- Name: spot_you_members spot_you_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spot_you_members
    ADD CONSTRAINT spot_you_members_pkey PRIMARY KEY (id);
--
-- Name: spot_you_members spot_you_members_spot_you_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spot_you_members
    ADD CONSTRAINT spot_you_members_spot_you_id_user_id_key UNIQUE (spot_you_id, user_id);
--
-- Name: stripe_webhook_events stripe_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_webhook_events
    ADD CONSTRAINT stripe_webhook_events_pkey PRIMARY KEY (event_id);
--
-- Name: subscription_plans subscription_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (plan_id);
--
-- Name: tag_categories tag_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_categories
    ADD CONSTRAINT tag_categories_pkey PRIMARY KEY (category_id);
--
-- Name: tag_category_links tag_category_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_category_links
    ADD CONSTRAINT tag_category_links_pkey PRIMARY KEY (tag_id, category_id);
--
-- Name: tag_entity_type_links tag_entity_type_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_entity_type_links
    ADD CONSTRAINT tag_entity_type_links_pkey PRIMARY KEY (tag_id, entity_type);
--
-- Name: tag_point_saves tag_point_saves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_point_saves
    ADD CONSTRAINT tag_point_saves_pkey PRIMARY KEY (save_id);
--
-- Name: tag_point_saves tag_point_saves_point_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_point_saves
    ADD CONSTRAINT tag_point_saves_point_id_user_id_key UNIQUE (point_id, user_id);
--
-- Name: tag_point_votes tag_point_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_point_votes
    ADD CONSTRAINT tag_point_votes_pkey PRIMARY KEY (vote_id);
--
-- Name: tag_point_votes tag_point_votes_point_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_point_votes
    ADD CONSTRAINT tag_point_votes_point_id_user_id_key UNIQUE (point_id, user_id);
--
-- Name: tag_points tag_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_points
    ADD CONSTRAINT tag_points_pkey PRIMARY KEY (point_id);
--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (tag_id);
--
-- Name: user_blocks user_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id);
--
-- Name: user_follows user_follows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_follows
    ADD CONSTRAINT user_follows_pkey PRIMARY KEY (follower_id, following_id);
--
-- Name: user_saved_addresses user_saved_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_addresses
    ADD CONSTRAINT user_saved_addresses_pkey PRIMARY KEY (address_id);
--
-- Name: user_subscriptions user_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_pkey PRIMARY KEY (subscription_id);
--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);
--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);
--
-- Name: idx_blocks_blocked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blocks_blocked ON public.user_blocks USING btree (blocked_id);
--
-- Name: idx_blocks_blocker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blocks_blocker ON public.user_blocks USING btree (blocker_id);
--
-- Name: idx_bookings_coach_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_coach_id ON public.bookings USING btree (coach_id);
--
-- Name: idx_bookings_expiry_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_expiry_worker ON public.bookings USING btree (expires_at) WHERE (status = 'requested'::text);
--
-- Name: idx_bookings_expiry_worker_v2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_expiry_worker_v2 ON public.bookings USING btree (expires_at) WHERE (status = ANY (ARRAY['requested'::text, 'awaiting_payment'::text]));
--
-- Name: idx_bookings_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bookings_idempotency_key ON public.bookings USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
--
-- Name: idx_bookings_service_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_service_id ON public.bookings USING btree (service_id);
--
-- Name: idx_bookings_slot_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bookings_slot_user_active ON public.bookings USING btree (slot_id, user_id) WHERE ((slot_id IS NOT NULL) AND (status <> ALL (ARRAY['refused'::text, 'cancelled'::text, 'expired'::text])));
--
-- Name: idx_bookings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_status ON public.bookings USING btree (status);
--
-- Name: idx_bookings_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_user_id ON public.bookings USING btree (user_id);
--
-- Name: idx_conv_participants; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_participants ON public.conversation_participants USING btree (user_id);
--
-- Name: idx_conv_participants_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_participants_status ON public.conversation_participants USING btree (conversation_id, status);
--
-- Name: idx_conversations_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_created_by ON public.conversations USING btree (created_by);
--
-- Name: idx_follows_follower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follows_follower ON public.user_follows USING btree (follower_id);
--
-- Name: idx_follows_following; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follows_following ON public.user_follows USING btree (following_id);
--
-- Name: idx_messages_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conv ON public.messages USING btree (conversation_id, created_at);
--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id, created_at DESC);
--
-- Name: idx_payments_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_booking ON public.payments USING btree (booking_id) WHERE (booking_id IS NOT NULL);
--
-- Name: idx_payments_payer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_payer ON public.payments USING btree (payer_user_id);
--
-- Name: idx_payments_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_product ON public.payments USING btree (product_type, product_id);
--
-- Name: idx_payments_receiver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_receiver ON public.payments USING btree (receiver_user_id);
--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status);
--
-- Name: idx_payments_stripe_intent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_stripe_intent ON public.payments USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);
--
-- Name: idx_pricing_rules_product_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_rules_product_type ON public.pricing_rules USING btree (product_type, active);
--
-- Name: idx_push_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_tokens_user ON public.push_tokens USING btree (user_id, is_active);
--
-- Name: idx_reviews_reviewee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_reviewee_id ON public.reviews USING btree (reviewee_id);
--
-- Name: idx_reviews_reviewer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_reviewer_id ON public.reviews USING btree (reviewer_id);
--
-- Name: idx_saved_addresses_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_addresses_user ON public.user_saved_addresses USING btree (user_id);
--
-- Name: idx_service_locations_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_locations_geo ON public.service_locations USING gist (location);
--
-- Name: idx_service_packages_service_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_packages_service_id ON public.service_packages USING btree (service_id);
--
-- Name: idx_service_slots_service_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_slots_service_id ON public.service_slots USING btree (service_id);
--
-- Name: idx_services_active_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_active_created ON public.services USING btree (active, created_at DESC);
--
-- Name: idx_services_coach_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_coach_id ON public.services USING btree (coach_id);
--
-- Name: idx_services_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_location ON public.services USING gist (location);
--
-- Name: idx_subscription_plans_stripe_price; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscription_plans_stripe_price ON public.subscription_plans USING btree (stripe_price_id) WHERE (stripe_price_id IS NOT NULL);
--
-- Name: idx_subscription_plans_stripe_product; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscription_plans_stripe_product ON public.subscription_plans USING btree (stripe_product_id) WHERE (stripe_product_id IS NOT NULL);
--
-- Name: idx_syu_attendance_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_syu_attendance_date ON public.spot_you_attendance USING btree (session_date);
--
-- Name: idx_syu_attendance_spot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_syu_attendance_spot ON public.spot_you_attendance USING btree (spot_you_id);
--
-- Name: idx_syu_members_spot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_syu_members_spot ON public.spot_you_members USING btree (spot_you_id);
--
-- Name: idx_syu_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_syu_members_user ON public.spot_you_members USING btree (user_id);
--
-- Name: idx_tag_categories_entity_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tag_categories_entity_type ON public.tag_categories USING btree (entity_type);
--
-- Name: idx_tag_category_links_cat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tag_category_links_cat ON public.tag_category_links USING btree (category_id);
--
-- Name: idx_tag_entity_type_links_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tag_entity_type_links_type ON public.tag_entity_type_links USING btree (entity_type);
--
-- Name: idx_tag_points_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tag_points_active ON public.tag_points USING btree (active);
--
-- Name: idx_tag_points_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tag_points_location ON public.tag_points USING gist (location);
--
-- Name: idx_user_subscriptions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subscriptions_user ON public.user_subscriptions USING btree (user_id, status);
--
-- Name: idx_users_stripe_account; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_stripe_account ON public.users USING btree (stripe_account_id) WHERE (stripe_account_id IS NOT NULL);
--
-- Name: idx_users_stripe_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_stripe_customer ON public.users USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);
--
-- Name: idx_webhook_events_related; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_related ON public.stripe_webhook_events USING btree (related_id) WHERE (related_id IS NOT NULL);
--
-- Name: idx_webhook_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_status ON public.stripe_webhook_events USING btree (status);
--
-- Name: idx_webhook_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_type ON public.stripe_webhook_events USING btree (event_type);
--
-- Name: bookings bookings_coach_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES public.users(user_id);
--
-- Name: bookings bookings_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(service_id);
--
-- Name: bookings bookings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);
--
-- Name: conversation_participants conversation_participants_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(conversation_id) ON DELETE CASCADE;
--
-- Name: conversation_participants conversation_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: conversations conversations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);
--
-- Name: marketplace_products marketplace_products_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_products
    ADD CONSTRAINT marketplace_products_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(user_id);
--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(conversation_id) ON DELETE CASCADE;
--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(user_id);
--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: payments payments_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(booking_id) ON DELETE SET NULL;
--
-- Name: payments payments_payer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_payer_user_id_fkey FOREIGN KEY (payer_user_id) REFERENCES public.users(user_id);
--
-- Name: payments payments_receiver_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_receiver_user_id_fkey FOREIGN KEY (receiver_user_id) REFERENCES public.users(user_id);
--
-- Name: push_tokens push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: reviews reviews_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(booking_id);
--
-- Name: reviews reviews_reviewee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_reviewee_id_fkey FOREIGN KEY (reviewee_id) REFERENCES public.users(user_id);
--
-- Name: reviews reviews_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(user_id);
--
-- Name: service_locations service_locations_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_locations
    ADD CONSTRAINT service_locations_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(service_id) ON DELETE CASCADE;
--
-- Name: service_packages service_packages_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_packages
    ADD CONSTRAINT service_packages_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(service_id) ON DELETE CASCADE;
--
-- Name: service_saves service_saves_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_saves
    ADD CONSTRAINT service_saves_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(service_id) ON DELETE CASCADE;
--
-- Name: service_saves service_saves_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_saves
    ADD CONSTRAINT service_saves_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: service_slots service_slots_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_slots
    ADD CONSTRAINT service_slots_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.service_locations(location_id) ON DELETE SET NULL;
--
-- Name: service_slots service_slots_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_slots
    ADD CONSTRAINT service_slots_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.service_packages(package_id) ON DELETE SET NULL;
--
-- Name: service_slots service_slots_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_slots
    ADD CONSTRAINT service_slots_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(service_id) ON DELETE CASCADE;
--
-- Name: services services_coach_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES public.users(user_id);
--
-- Name: spot_you_attendance spot_you_attendance_spot_you_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spot_you_attendance
    ADD CONSTRAINT spot_you_attendance_spot_you_id_fkey FOREIGN KEY (spot_you_id) REFERENCES public.tag_points(point_id) ON DELETE CASCADE;
--
-- Name: spot_you_attendance spot_you_attendance_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spot_you_attendance
    ADD CONSTRAINT spot_you_attendance_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: spot_you_members spot_you_members_spot_you_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spot_you_members
    ADD CONSTRAINT spot_you_members_spot_you_id_fkey FOREIGN KEY (spot_you_id) REFERENCES public.tag_points(point_id) ON DELETE CASCADE;
--
-- Name: spot_you_members spot_you_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spot_you_members
    ADD CONSTRAINT spot_you_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: tag_category_links tag_category_links_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_category_links
    ADD CONSTRAINT tag_category_links_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.tag_categories(category_id) ON DELETE CASCADE;
--
-- Name: tag_category_links tag_category_links_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_category_links
    ADD CONSTRAINT tag_category_links_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(tag_id) ON DELETE CASCADE;
--
-- Name: tag_entity_type_links tag_entity_type_links_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_entity_type_links
    ADD CONSTRAINT tag_entity_type_links_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(tag_id) ON DELETE CASCADE;
--
-- Name: tag_point_saves tag_point_saves_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_point_saves
    ADD CONSTRAINT tag_point_saves_point_id_fkey FOREIGN KEY (point_id) REFERENCES public.tag_points(point_id) ON DELETE CASCADE;
--
-- Name: tag_point_saves tag_point_saves_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_point_saves
    ADD CONSTRAINT tag_point_saves_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: tag_point_votes tag_point_votes_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_point_votes
    ADD CONSTRAINT tag_point_votes_point_id_fkey FOREIGN KEY (point_id) REFERENCES public.tag_points(point_id) ON DELETE CASCADE;
--
-- Name: tag_point_votes tag_point_votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_point_votes
    ADD CONSTRAINT tag_point_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: tag_points tag_points_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_points
    ADD CONSTRAINT tag_points_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);
--
-- Name: user_blocks user_blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: user_blocks user_blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: user_follows user_follows_follower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_follows
    ADD CONSTRAINT user_follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: user_follows user_follows_following_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_follows
    ADD CONSTRAINT user_follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: user_saved_addresses user_saved_addresses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_addresses
    ADD CONSTRAINT user_saved_addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- Name: user_subscriptions user_subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(plan_id);
--
-- Name: user_subscriptions user_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
--
-- PostgreSQL database dump complete
--



-- =============================================================================
-- Désactiver Row Level Security sur toutes les tables applicatives
-- (Auth JWT custom — pas de Supabase Auth)
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('_migrations', 'spatial_ref_sys', 'topology',
                            'layer', 'topology_id_seq')
  LOOP
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;