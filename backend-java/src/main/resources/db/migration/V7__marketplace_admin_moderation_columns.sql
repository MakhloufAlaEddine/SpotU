ALTER TABLE marketplace_products
    ADD COLUMN IF NOT EXISTS admin_validated_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS admin_validated_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS admin_reminder_sent_at TIMESTAMP WITH TIME ZONE;
