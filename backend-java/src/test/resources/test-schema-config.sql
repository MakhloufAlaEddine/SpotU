-- Schéma minimal pour tests H2 (slice 01 — config publique).
CREATE TABLE IF NOT EXISTS app_config (
    config_key   VARCHAR(255) NOT NULL PRIMARY KEY,
    config_value VARCHAR(10000) NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing_rules (
    rule_id               VARCHAR(255) NOT NULL PRIMARY KEY,
    product_type          VARCHAR(255) NOT NULL,
    name                  VARCHAR(500) NOT NULL,
    payer_fixed_fee       DECIMAL(10, 2) DEFAULT 0,
    payer_percent_fee     DECIMAL(5, 2) DEFAULT 0,
    receiver_fixed_fee    DECIMAL(10, 2) DEFAULT 0,
    receiver_percent_fee  DECIMAL(5, 2) DEFAULT 0,
    active                BOOLEAN DEFAULT TRUE,
    priority              INTEGER DEFAULT 0,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_product_type ON pricing_rules (product_type, active);
