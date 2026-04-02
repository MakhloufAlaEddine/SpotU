-- Migration 012: Politique de rétention médias 90 jours + réactivation guidée
-- Nouvelles colonnes de suivi purge différée et historique réactivation
-- Compatible avec migrations 008/009/010/011

-- ── users ──────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS media_purge_scheduled_at TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS media_purged              BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS media_purged_at           TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS media_purge_notified_at   TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reactivated_at            TIMESTAMPTZ NULL;

-- ── tag_points (SpotYou) ───────────────────────────────────────────────────────
ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS media_purge_scheduled_at TIMESTAMPTZ NULL;
ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS media_purged              BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS media_purged_at           TIMESTAMPTZ NULL;
ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS media_purge_notified_at   TIMESTAMPTZ NULL;
ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS reactivated_at            TIMESTAMPTZ NULL;

-- ── services ──────────────────────────────────────────────────────────────────
ALTER TABLE services ADD COLUMN IF NOT EXISTS media_purge_scheduled_at TIMESTAMPTZ NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS media_purged              BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS media_purged_at           TIMESTAMPTZ NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS media_purge_notified_at   TIMESTAMPTZ NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS reactivated_at            TIMESTAMPTZ NULL;

-- ── marketplace_products ──────────────────────────────────────────────────────
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS media_purge_scheduled_at TIMESTAMPTZ NULL;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS media_purged              BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS media_purged_at           TIMESTAMPTZ NULL;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS media_purge_notified_at   TIMESTAMPTZ NULL;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS reactivated_at            TIMESTAMPTZ NULL;

-- ── Backfill rétroactif: entités déjà soft-deleted ───────────────────────────
-- Calculer media_purge_scheduled_at = deleted_at + 90 jours pour l'existant
UPDATE users
  SET media_purge_scheduled_at = deleted_at + INTERVAL '90 days'
  WHERE deleted_at IS NOT NULL
    AND media_purge_scheduled_at IS NULL;

UPDATE tag_points
  SET media_purge_scheduled_at = deleted_at + INTERVAL '90 days'
  WHERE deleted_at IS NOT NULL
    AND media_purge_scheduled_at IS NULL;

UPDATE services
  SET media_purge_scheduled_at = deleted_at + INTERVAL '90 days'
  WHERE deleted_at IS NOT NULL
    AND media_purge_scheduled_at IS NULL;

UPDATE marketplace_products
  SET media_purge_scheduled_at = deleted_at + INTERVAL '90 days'
  WHERE deleted_at IS NOT NULL
    AND media_purge_scheduled_at IS NULL;

-- ── Index partiels (coût nul sur lignes non concernées) ──────────────────────
-- Accélérer le scan du worker purge et du worker notification
CREATE INDEX IF NOT EXISTS idx_users_media_purge
  ON users(media_purge_scheduled_at)
  WHERE media_purge_scheduled_at IS NOT NULL
    AND media_purged = FALSE
    AND deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tag_points_media_purge
  ON tag_points(media_purge_scheduled_at)
  WHERE media_purge_scheduled_at IS NOT NULL
    AND media_purged = FALSE
    AND deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_services_media_purge
  ON services(media_purge_scheduled_at)
  WHERE media_purge_scheduled_at IS NOT NULL
    AND media_purged = FALSE
    AND deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mp_media_purge
  ON marketplace_products(media_purge_scheduled_at)
  WHERE media_purge_scheduled_at IS NOT NULL
    AND media_purged = FALSE
    AND deleted_at IS NOT NULL;
