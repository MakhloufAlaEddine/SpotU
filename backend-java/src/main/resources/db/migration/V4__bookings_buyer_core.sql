ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'pay_now',
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS payer_user_id TEXT,
    ADD COLUMN IF NOT EXISTS receiver_user_id TEXT,
    ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_idempotency_key
    ON bookings(idempotency_key)
    WHERE idempotency_key IS NOT NULL;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS payer_user_id TEXT,
    ADD COLUMN IF NOT EXISTS receiver_user_id TEXT,
    ADD COLUMN IF NOT EXISTS product_type TEXT,
    ADD COLUMN IF NOT EXISTS product_id TEXT,
    ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR',
    ADD COLUMN IF NOT EXISTS base_amount NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS payer_fixed_fee NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS payer_percent_fee_amount NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS receiver_fixed_fee NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS receiver_percent_fee_amount NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS platform_total_fee NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS receiver_net_amount NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT,
    ADD COLUMN IF NOT EXISTS pricing_rule_snapshot JSONB;
