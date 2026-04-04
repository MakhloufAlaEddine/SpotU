-- =============================================================================
-- Migration 015 — Ajout du statut 'invited' dans spot_you_members
-- Date        : 2026-04-04
-- Description :
--   Phase 1 révisée : les SpotYous privés fonctionnent désormais en
--   invitation uniquement (pas de demande possible). Un nouveau statut
--   'invited' est nécessaire pour gérer les invitations envoyées.
--
--   Modifications :
--   1. Suppression de la contrainte chk_member_status existante
--   2. Recréation avec les 4 valeurs : pending | accepted | rejected | invited
--
-- Rollback manuel :
--   ALTER TABLE spot_you_members DROP CONSTRAINT IF EXISTS chk_member_status;
--   ALTER TABLE spot_you_members ADD CONSTRAINT chk_member_status
--     CHECK (status IN ('pending', 'accepted', 'rejected'));
-- =============================================================================

-- 1. Supprimer l'ancienne contrainte (ne gérait pas 'invited')
ALTER TABLE spot_you_members
  DROP CONSTRAINT IF EXISTS chk_member_status;

-- 2. Recréer avec le statut 'invited' inclus
ALTER TABLE spot_you_members
  ADD CONSTRAINT chk_member_status
    CHECK (status IN ('pending', 'accepted', 'rejected', 'invited'));

-- Index partiel pour les invitations en attente (perf Phase 2)
CREATE INDEX IF NOT EXISTS idx_syu_members_invited
  ON spot_you_members (spot_you_id, user_id)
  WHERE status = 'invited';
