-- Migration 010: FKs messages.sender_id + reviews.reviewer/reviewee → ON DELETE SET NULL
-- Requis pour l'anonymisation RGPD des utilisateurs supprimés.
-- Après cette migration, si un user est supprimé physiquement :
--   - ses messages restent visibles (contenu préservé) avec sender_id = NULL
--   - ses avis restent avec reviewer_id / reviewee_id = NULL
--
-- NOTE: les colonnes sont déjà NULLABLE dans le schéma initial (pas de NOT NULL),
-- la modification porte uniquement sur le comportement ON DELETE.

-- ── messages.sender_id ────────────────────────────────────────────────────────
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE SET NULL;

-- ── reviews.reviewer_id ───────────────────────────────────────────────────────
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_reviewer_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES users(user_id) ON DELETE SET NULL;

-- ── reviews.reviewee_id ───────────────────────────────────────────────────────
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_reviewee_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_reviewee_id_fkey
    FOREIGN KEY (reviewee_id) REFERENCES users(user_id) ON DELETE SET NULL;

-- ── Snapshots des noms (préservation post-anonymisation) ──────────────────────
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_name_snapshot TEXT NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewee_name_snapshot TEXT NULL;
