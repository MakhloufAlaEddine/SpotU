-- Migration 004 — Add Table Comments
-- Date    : 2026-04-01
-- Auteur  : SpotU Team
-- Ticket  : infra/migrations-hardening
--
-- Description :
--   Ajoute des commentaires métier sur les tables principales.
--   Ces commentaires s'affichent dans Supabase Dashboard et pg_catalog.
--   Migration safe : un COMMENT ne modifie pas le schéma ni les données.
--
-- Rollback manuel (si nécessaire) :
--   COMMENT ON TABLE marketplace_products IS NULL;
--   COMMENT ON TABLE users IS NULL;
--   COMMENT ON TABLE bookings IS NULL;

-- === DÉBUT DE LA MIGRATION ===

COMMENT ON TABLE marketplace_products IS 'Produits location et vente de la marketplace SpotU';
COMMENT ON TABLE users                IS 'Comptes utilisateurs (coachs, acheteurs, admins)';
COMMENT ON TABLE bookings             IS 'Réservations et achats liés aux produits marketplace';

-- === FIN DE LA MIGRATION ===
