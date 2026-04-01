-- ============================================================================
-- 006_product_location_address_raw.sql
-- Ajoute location_address_raw pour stocker l'adresse complète saisie par le
-- vendeur (avant masquage). Permet d'afficher la bonne adresse en mode édition.
--
-- Contexte : le champ `city` ne stocke que la partie "ville" (ex: "Lyon")
-- après l'appel extractCity(). L'adresse complète (ex: "15 Rue de la
-- République, Lyon, France") était jusqu'ici perdue à la sauvegarde.
-- ============================================================================

ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS location_address_raw TEXT;

COMMENT ON COLUMN marketplace_products.location_address_raw IS
  'Adresse complète brute saisie par le vendeur (avant masquage / extraction de ville). '
  'Affichée uniquement au propriétaire dans le formulaire d''édition.';
