-- =============================================================================
-- Migration 005 — Index de performance post-migration Supabase
-- Date        : 2026-04-01
-- Auteur      : SpotU Team
-- Ticket      : infra/indexing-audit
--
-- Stratégie :
--   Ajouter uniquement les index justifiés par des requêtes réelles
--   identifiées dans le code backend (routes/*.py).
--   Aucun index "au cas où". Priorité : lectures fréquentes, filtres sélectifs.
--
-- Tables ciblées : marketplace_products, services, tag_points, notifications
-- Tables intentionnellement ignorées : users (trop petite), bookings (déjà indexée),
--   conversations (pas de bottleneck confirmé), service_saves / tag_point_saves
--   (pas de requête WHERE user_id seule confirmée).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- [1] marketplace_products — seller_id + tri par date
--
-- Requête : product_creation_routes.py l.64
--   WHERE seller_id = $1 ORDER BY created_at DESC
--
-- Justification : chaque coach charge "mes produits" à chaque ouverture de
--   l'écran. Sans index, PostgreSQL fait un seq scan sur toute la table.
--   Index composite (seller_id, created_at DESC) permet un index-only scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mp_seller_created
    ON marketplace_products (seller_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- [2] marketplace_products — status + tri par date
--
-- Requêtes :
--   marketplace_routes.py l.86  → WHERE status = 'active' ORDER BY created_at DESC
--   admin_product_routes.py l.76 → WHERE status = 'pending_review' ORDER BY created_at ASC
--   product_creation_routes.py  → WHERE status != 'deleted'
--
-- Justification : le listing principal de la marketplace (écran d'accueil) et
--   la file d'attente admin filtrent en permanence sur status.
--   Index composite (status, created_at DESC) sert les deux patterns.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mp_status_created
    ON marketplace_products (status, created_at DESC);


-- ---------------------------------------------------------------------------
-- [3] marketplace_products — GIN sur tag_ids (text[])
--
-- Requête : marketplace_routes.py l.74
--   WHERE p.tag_ids && $1::text[]    (opérateur overlap sur text[])
--
-- Justification : filtre principal du listing marketplace par tags du SpotYou.
--   Sans GIN, PostgreSQL évalue chaque ligne. Avec GIN, lookup O(log n).
--   Coût d'écriture faible (tag_ids rarement mis à jour après création).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mp_tag_ids_gin
    ON marketplace_products USING gin (tag_ids);


-- ---------------------------------------------------------------------------
-- [4] services — GIN sur tag_ids (JSONB)
--
-- Requête : marketplace_routes.py l.132
--   WHERE s.tag_ids ?| $1::text[]   (opérateur has-any sur JSONB)
--
-- Justification : même pattern que [3] mais sur JSONB. GIN natif pour JSONB.
--   Requis pour les écrans de découverte de services par activité.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_services_tag_ids_gin
    ON services USING gin (tag_ids);


-- ---------------------------------------------------------------------------
-- [5] tag_points — user_id
--
-- Requêtes :
--   admin_routes.py l.113   → WHERE user_id (ORDER BY created_at DESC)
--   tag_point_saves         → JOIN sur tag_points.user_id
--   divers routes utilisateur → "mes SpotYous"
--
-- Justification : toute requête "SpotYous d'un utilisateur" fait un seq scan.
--   Index simple, coût d'écriture minimal.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tag_points_user_id
    ON tag_points (user_id);


-- ---------------------------------------------------------------------------
-- [6] notifications — index partiel sur unread (user_id) WHERE read = FALSE
--
-- Requête : chat_routes.py l.32
--   WHERE user_id = $1 AND read = FALSE   (comptage badge non-lus)
--
-- Justification : requête appelée à chaque ouverture de l'app et sur
--   chaque réception de message. L'index existant idx_notifications_user
--   couvre (user_id, created_at DESC) pour le listing, mais pas le comptage
--   unread-only. Index partiel très sélectif : seule une fraction des
--   notifications restent non-lues (marquées lues rapidement).
--
-- Note : idx_notifications_user (user_id, created_at DESC) est CONSERVÉ
--   car il sert le listing paginé. Les deux index sont complémentaires.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON notifications (user_id)
    WHERE read = FALSE;
