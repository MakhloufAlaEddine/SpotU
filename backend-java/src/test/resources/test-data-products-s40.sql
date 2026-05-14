DELETE FROM pending_file_deletions WHERE entity_id LIKE 'prod_s40_%';
DELETE FROM marketplace_products WHERE product_id LIKE 'prod_s40_%';

INSERT INTO marketplace_products (
    product_id, title, short_description, description,
    price, currency, product_type, pricing_type, pricing_modes,
    seller_id, seller_type, seller_name, image_urls, cover_image_url, image_url,
    status, created_at, updated_at, deleted_at, deleted_by,
    media_purge_scheduled_at, media_purge_notified_at, media_purged, media_purged_at, reactivated_at
) VALUES
('prod_s40_active_owner', 'Produit actif owner', 'desc', 'Description suffisamment longue pour les tests de cycle de vie produit owner.',
 10.00, 'EUR', 'rental', 'day', '["day"]',
 'user_private001', 'user', 'Marie Martin', '["https://img/s40/a1.jpg","https://img/s40/a2.jpg"]', 'https://img/s40/a1.jpg', 'https://img/s40/a1.jpg',
 'active', TIMESTAMP WITH TIME ZONE '2026-05-01 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-05-01 10:00:00+00:00', NULL, NULL,
 NULL, NULL, FALSE, NULL, NULL),
('prod_s40_active_other', 'Produit actif other', 'desc', 'Description suffisamment longue pour les tests de produit d un autre vendeur.',
 20.00, 'EUR', 'rental', 'day', '["day"]',
 'user_demo001', 'user', 'Thomas Dupont', '["https://img/s40/o1.jpg"]', 'https://img/s40/o1.jpg', 'https://img/s40/o1.jpg',
 'active', TIMESTAMP WITH TIME ZONE '2026-05-01 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-05-01 10:00:00+00:00', NULL, NULL,
 NULL, NULL, FALSE, NULL, NULL),
('prod_s40_deleted_owner', 'Produit deleted owner', 'desc', 'Description suffisamment longue pour réactivation owner avec médias intacts.',
 30.00, 'EUR', 'rental', 'day', '["day"]',
 'user_private001', 'user', 'Marie Martin', '["https://img/s40/d1.jpg"]', 'https://img/s40/d1.jpg', 'https://img/s40/d1.jpg',
 'deleted', TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00',
 TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00', 'user_private001',
 TIMESTAMP WITH TIME ZONE '2026-07-01 10:00:00+00:00', NULL, FALSE, NULL, NULL),
('prod_s40_deleted_purged', 'Produit deleted purged', 'desc', 'Description suffisamment longue pour réactivation après purge media.',
 35.00, 'EUR', 'rental', 'day', '["day"]',
 'user_private001', 'user', 'Marie Martin', '["https://img/s40/p1.jpg"]', 'https://img/s40/p1.jpg', 'https://img/s40/p1.jpg',
 'deleted', TIMESTAMP WITH TIME ZONE '2026-01-01 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-01-01 10:00:00+00:00',
 TIMESTAMP WITH TIME ZONE '2026-01-01 10:00:00+00:00', 'user_private001',
 TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00', NULL, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-02 10:00:00+00:00', NULL),
('prod_s40_deleted_due_worker', 'Produit due worker', 'desc', 'Description suffisamment longue pour déclenchement nominal du worker S40.',
 42.00, 'EUR', 'rental', 'day', '["day"]',
 'user_private001', 'user', 'Marie Martin', '["https://img/s40/w1.jpg"]', 'https://img/s40/w1.jpg', 'https://img/s40/w1.jpg',
 'deleted', TIMESTAMP WITH TIME ZONE '2025-12-01 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2025-12-01 10:00:00+00:00',
 TIMESTAMP WITH TIME ZONE '2025-12-01 10:00:00+00:00', 'user_private001',
 TIMESTAMP WITH TIME ZONE '2026-01-01 10:00:00+00:00', NULL, FALSE, NULL, NULL),
('prod_s40_deleted_reactivated', 'Produit deleted reactivated', 'desc', 'Description suffisamment longue pour test garde idempotence reactivated_at.',
 50.00, 'EUR', 'rental', 'day', '["day"]',
 'user_private001', 'user', 'Marie Martin', '["https://img/s40/r1.jpg"]', 'https://img/s40/r1.jpg', 'https://img/s40/r1.jpg',
 'deleted', TIMESTAMP WITH TIME ZONE '2026-01-01 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-01-01 10:00:00+00:00',
 TIMESTAMP WITH TIME ZONE '2026-01-01 10:00:00+00:00', 'user_private001',
 TIMESTAMP WITH TIME ZONE '2026-02-01 10:00:00+00:00', NULL, FALSE, NULL, TIMESTAMP WITH TIME ZONE '2026-03-01 10:00:00+00:00');

INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at, status, created_at) VALUES
('https://img/s40/d1.jpg', 'product', 'prod_s40_deleted_owner', TIMESTAMP WITH TIME ZONE '2026-07-01 10:00:00+00:00', 'pending', TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00'),
('https://img/s40/d2.jpg', 'product', 'prod_s40_deleted_owner', TIMESTAMP WITH TIME ZONE '2026-07-01 10:00:00+00:00', 'processing', TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00');
