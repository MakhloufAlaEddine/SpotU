-- Tables nécessaires pour GET /api/config/booking et /api/config/commission (aligné backend/migrations/001_initial_schema.sql, sous-ensemble).

CREATE TABLE IF NOT EXISTS app_config (
    config_key   TEXT        NOT NULL,
    config_value TEXT        NOT NULL,
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT app_config_pkey PRIMARY KEY (config_key)
);

CREATE TABLE IF NOT EXISTS pricing_rules (
    rule_id               TEXT            NOT NULL,
    product_type          TEXT            NOT NULL,
    name                  TEXT            NOT NULL,
    payer_fixed_fee       NUMERIC(10,2) DEFAULT 0,
    payer_percent_fee     NUMERIC(5,2)  DEFAULT 0,
    receiver_fixed_fee    NUMERIC(10,2) DEFAULT 0,
    receiver_percent_fee  NUMERIC(5,2)  DEFAULT 0,
    active                BOOLEAN         DEFAULT TRUE,
    priority              INTEGER         DEFAULT 0,
    created_at            TIMESTAMPTZ     DEFAULT NOW(),
    updated_at            TIMESTAMPTZ     DEFAULT NOW(),
    description           TEXT,
    currency              TEXT            DEFAULT 'EUR',
    CONSTRAINT pricing_rules_pkey PRIMARY KEY (rule_id)
);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_product_type ON pricing_rules (product_type, active);
