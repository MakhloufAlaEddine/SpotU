ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

UPDATE payments
SET created_at = updated_at
WHERE created_at IS NULL
  AND updated_at IS NOT NULL;
