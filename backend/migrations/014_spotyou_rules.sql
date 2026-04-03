-- =============================================================================
-- Migration 014 — SpotYou Rules System
-- Date        : 2026-04-03
-- Description :
--   Phase 1 : Système de règles configurable par le créateur d'un SpotYou.
--   - visibility_type   : public | private
--   - join_mode         : open | admin_approval | members_approval
--   - invite_permissions: admin_only | members_only | admin_and_members
--   - max_community_members : capacité max de la communauté (≠ maximum_participants qui est par session)
--   - spot_you_members : ajout de status / requested_by / approved_by
-- =============================================================================

-- ── tag_points : nouveaux champs règles ────────────────────────────────────────
ALTER TABLE tag_points
  ADD COLUMN IF NOT EXISTS visibility_type     TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS join_mode           TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS invite_permissions  TEXT NOT NULL DEFAULT 'admin_only',
  ADD COLUMN IF NOT EXISTS max_community_members INTEGER DEFAULT NULL;

-- Contraintes de valeurs valides
ALTER TABLE tag_points
  ADD CONSTRAINT chk_visibility_type
    CHECK (visibility_type IN ('public', 'private')),
  ADD CONSTRAINT chk_join_mode
    CHECK (join_mode IN ('open', 'admin_approval', 'members_approval')),
  ADD CONSTRAINT chk_invite_permissions
    CHECK (invite_permissions IN ('admin_only', 'members_only', 'admin_and_members'));

-- Rétrocompatibilité : tous les SpotYous existants → public / open / admin_only
UPDATE tag_points
SET
  visibility_type    = 'public',
  join_mode          = 'open',
  invite_permissions = 'admin_only'
WHERE visibility_type = 'public'; -- idempotent si déjà appliqué

-- ── spot_you_members : champs de workflow ────────────────────────────────────
ALTER TABLE spot_you_members
  ADD COLUMN IF NOT EXISTS status       TEXT NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS requested_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_by  TEXT;

ALTER TABLE spot_you_members
  ADD CONSTRAINT chk_member_status
    CHECK (status IN ('pending', 'accepted', 'rejected'));

-- Tous les membres existants sont déjà acceptés
UPDATE spot_you_members
SET status = 'accepted'
WHERE status IS NULL OR status = '';

-- Index pour optimiser les recherches par status
CREATE INDEX IF NOT EXISTS idx_syu_members_status
  ON spot_you_members (spot_you_id, status);
