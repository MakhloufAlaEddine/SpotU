-- =============================================================================
-- Migration 016 — Backfill : créateurs de SpotYou ajoutés comme membres
-- Date        : 2026-04-04
-- Description :
--   Pour les SpotYous créés avant l'ajout de l'auto-insertion du créateur
--   dans spot_you_members, cette migration insère le propriétaire de chaque
--   SpotYou avec status='accepted' s'il n'est pas déjà membre.
--
-- Impact      : Les créateurs existants apparaîtront désormais dans la liste
--               des membres et seront comptés dans participants_count.
-- =============================================================================

INSERT INTO spot_you_members (id, spot_you_id, user_id, status, joined_at)
SELECT
    'part_backfill_' || LEFT(MD5(tp.point_id || tp.user_id), 16) AS id,
    tp.point_id  AS spot_you_id,
    tp.user_id   AS user_id,
    'accepted'   AS status,
    tp.created_at AS joined_at
FROM tag_points tp
WHERE NOT EXISTS (
    SELECT 1 FROM spot_you_members syu
    WHERE syu.spot_you_id = tp.point_id
      AND syu.user_id     = tp.user_id
)
ON CONFLICT (spot_you_id, user_id) DO NOTHING;
