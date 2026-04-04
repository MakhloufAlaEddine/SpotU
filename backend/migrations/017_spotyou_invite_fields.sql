-- =============================================================================
-- Migration 017 — Champs invited_by / invited_at sur spot_you_members
-- Date        : 2026-04-04
-- Description :
--   Phase 2 Invitations : sépare clairement le canal "demande de rejoindre"
--   (requested_by) du canal "invitation" (invited_by / invited_at).
-- =============================================================================

ALTER TABLE spot_you_members
  ADD COLUMN IF NOT EXISTS invited_by  text REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at  timestamp with time zone;

-- Index pour accélérer la requête "mes invitations reçues"
CREATE INDEX IF NOT EXISTS idx_syu_members_invited_user
  ON spot_you_members (user_id)
  WHERE status = 'invited';
