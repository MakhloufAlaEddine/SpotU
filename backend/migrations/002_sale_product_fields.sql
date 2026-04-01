-- =============================================================================
-- Migration 002 — Champs produits à la vente (sale)
-- Date        : 2026-03-31
-- Description : Ajout des colonnes spécifiques aux produits de type 'sale'
--               (marque, modèle, poids, identifiants Stripe).
--               Ne jamais modifier ce fichier après première exécution.
-- =============================================================================

ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS brand              text;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS model              text;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS weight             text;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS stripe_product_id  text;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS stripe_price_id    text;
