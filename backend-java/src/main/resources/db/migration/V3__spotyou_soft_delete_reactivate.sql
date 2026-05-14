ALTER TABLE tag_points
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by TEXT,
    ADD COLUMN IF NOT EXISTS media_purge_notified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS media_purged BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS media_purged_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS conversations (
    conversation_id TEXT PRIMARY KEY,
    context_id TEXT,
    context_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS pending_file_deletions (
    id BIGSERIAL PRIMARY KEY,
    file_url TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_file_deletions_file_entity
    ON pending_file_deletions(file_url, entity_id);
