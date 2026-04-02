-- Migration 011: Ajout colonnes de traçabilité à pending_file_deletions
-- Permet un suivi état-machine pour chaque entrée de purge différée.
--
-- Statuts possibles :
--   pending     → en attente (défaut, non encore traité)
--   processing  → en cours de traitement (lock optimiste anti-doublon)
--   deleted     → fichier supprimé avec succès (côté R2 ou filesystem)
--   failed      → erreur irrécupérable après tentative(s)
--   skipped     → non éligible (délai de rétention non atteint, ou URL vide)

ALTER TABLE pending_file_deletions
    ADD COLUMN IF NOT EXISTS status        TEXT        NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS error_message TEXT        NULL,
    ADD COLUMN IF NOT EXISTS attempt_count INT         NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ NULL;

-- Contrainte CHECK sur les statuts valides
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'pending_file_deletions'
          AND constraint_name = 'pending_file_deletions_status_check'
    ) THEN
        ALTER TABLE pending_file_deletions
            ADD CONSTRAINT pending_file_deletions_status_check
            CHECK (status IN ('pending','processing','deleted','failed','skipped'));
    END IF;
END$$;

-- Mettre à jour les entrées existantes (sans status) en 'pending'
UPDATE pending_file_deletions SET status = 'pending' WHERE status IS NULL;

-- Index sur (status, scheduled_at) pour la requête de sélection du worker
CREATE INDEX IF NOT EXISTS idx_pfd_status_scheduled
    ON pending_file_deletions(status, scheduled_at)
    WHERE status = 'pending';

-- Index sur les failed pour re-tentatives éventuelles
CREATE INDEX IF NOT EXISTS idx_pfd_failed
    ON pending_file_deletions(status, last_attempt_at)
    WHERE status = 'failed';
