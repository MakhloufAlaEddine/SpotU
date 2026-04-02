-- Migration 008: Colonnes soft delete sur les entités principales
-- Stratégie de suppression logique (audit AUDIT_SUPPRESSION.md)
-- Phase 2 — Sans breaking change, entièrement backward compatible

-- ── users ──────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by      TEXT        NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS anonymized_at   TIMESTAMPTZ NULL;

-- ── tag_points (SpotYou) — active déjà présent ────────────────────────────────
ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ NULL;
ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS deleted_by  TEXT        NULL;

-- ── services — active déjà présent ────────────────────────────────────────────
ALTER TABLE services ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS deleted_by    TEXT        NULL;

-- ── marketplace_products — status='deleted' déjà implémenté ───────────────────
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ NULL;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS deleted_by  TEXT        NULL;

-- ── conversations ─────────────────────────────────────────────────────────────
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at       TIMESTAMPTZ NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS context_deleted  BOOLEAN     NOT NULL DEFAULT FALSE;

-- ── messages ─────────────────────────────────────────────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- ── Indexes de performance (partial indexes — coûts nuls sur les lignes non supprimées) ──
CREATE INDEX IF NOT EXISTS idx_users_deleted          ON users(deleted_at)                 WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tag_points_deleted     ON tag_points(deleted_at)            WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_services_deleted       ON services(deleted_at)              WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_ctx_del  ON conversations(context_deleted)    WHERE context_deleted = TRUE;
CREATE INDEX IF NOT EXISTS idx_messages_deleted       ON messages(deleted_at)              WHERE deleted_at IS NOT NULL;
