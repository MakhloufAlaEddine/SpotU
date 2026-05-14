DELETE FROM notifications;
DELETE FROM marketplace_products WHERE product_id LIKE 'prod_s41_%';

INSERT INTO marketplace_products (
    product_id, title, short_description, description, price, pricing_type, currency,
    category, subcategory, cover_image_url, image_url, image_urls,
    condition_label, available_quantity, deposit_required, deposit_amount,
    pickup_type, city, lat, lng, return_rules, cancellation_rules, pickup_notes, availability_note,
    related_spotyou_ids, seller_id, seller_type, seller_name, seller_picture_url,
    status, in_stock, created_at, updated_at, admin_reminder_sent_at,
    rejection_reason, admin_comment, deleted_at, deleted_by, media_purged
) VALUES
('prod_s41_pending_old', 'Titre pending ancien tres long', 'short', 'Description pending review très détaillée de plus de cent cinquante caractères pour scorer la qualité maximale dans les tests admin marketplace côté Java.',
 45.00, 'day', 'EUR',
 'sport', 'cycle', 'https://img/s41/c1.jpg', 'https://img/s41/c1.jpg', '["https://img/s41/c1.jpg","https://img/s41/c2.jpg","https://img/s41/c3.jpg"]',
 'good', 2, TRUE, 100.00,
 'local_pickup', 'Paris', 48.85, 2.35, 'retour', 'annulation', 'notes', 'note',
 '[]', 'user_private001', 'user', 'Marie Martin', NULL,
 'pending_review', TRUE, TIMESTAMP WITH TIME ZONE '2026-05-01 08:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-05-01 08:00:00+00:00', NULL,
 NULL, NULL, NULL, NULL, FALSE),
('prod_s41_pending_recent', 'Titre pending recent', 'short', 'Description pending review récente mais valide pour test reminder worker sur délai.',
 20.00, 'day', 'EUR',
 'sport', 'run', NULL, NULL, '["https://img/s41/r1.jpg"]',
 'good', 1, FALSE, NULL,
 NULL, 'Lyon', NULL, NULL, NULL, NULL, NULL, NULL,
 '[]', 'user_private001', 'user', 'Marie Martin', NULL,
 'pending_review', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL,
 NULL, NULL, NULL, NULL, FALSE),
('prod_s41_deleted', 'Titre deleted', 'short', 'Description deleted utilisable pour anomalie approve/reject sans guard statut courant.',
 12.00, 'day', 'EUR',
 'sport', 'old', NULL, NULL, '[]',
 'good', 1, FALSE, NULL,
 'local_pickup', 'Paris', NULL, NULL, NULL, NULL, NULL, NULL,
 '[]', 'user_private001', 'user', 'Marie Martin', NULL,
 'deleted', FALSE, TIMESTAMP WITH TIME ZONE '2026-01-01 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-01-01 10:00:00+00:00', NULL,
 NULL, NULL, TIMESTAMP WITH TIME ZONE '2026-01-01 10:00:00+00:00', 'user_private001', FALSE);
