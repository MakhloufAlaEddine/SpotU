-- Migration 009: Table de purge différée des fichiers R2/uploads
-- Les entités soft-deleted enregistrent leurs URLs ici pour
-- suppression physique différée (quotidienne / hebdomadaire).

CREATE TABLE IF NOT EXISTS pending_file_deletions (
    id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    file_url    TEXT        NOT NULL,
    entity_type TEXT        NOT NULL,   -- 'tag_point' | 'service' | 'product' | 'user'
    entity_id   TEXT        NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ NULL
);

-- Index : uniquement sur les lignes non-traitées (ne charge pas la lecture normale)
CREATE INDEX IF NOT EXISTS idx_pending_deletions_unprocessed
    ON pending_file_deletions(scheduled_at)
    WHERE processed_at IS NULL;
