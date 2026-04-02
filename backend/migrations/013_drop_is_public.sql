-- Migration 013 : suppression de is_public sur tag_points
-- La visibilité est désormais uniquement gérée par active=TRUE (soft delete 90j)

ALTER TABLE tag_points DROP COLUMN IF EXISTS is_public;
