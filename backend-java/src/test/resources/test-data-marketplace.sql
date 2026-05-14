DELETE FROM marketplace_products;

INSERT INTO marketplace_products (
    product_id, product_type, status, title, description, short_description,
    price, currency, pricing_type, pricing_modes,
    image_url, image_urls, cover_image_url, tag_ids,
    seller_id, seller_type, condition_label, category, subcategory, skill_level,
    lat, lng, city, location_privacy, related_spotyou_ids, delivery_modes, pickup_type, pickup_notes,
    deposit_required, deposit_amount, available_quantity, in_stock, included_items,
    availability_note, cancellation_rules, return_rules, admin_comment, created_at, updated_at
) VALUES
('prod_mkt_001', 'physical_for_sale', 'active', 'Velo endurance', 'Velo route carbone', 'Route 54cm',
 850.00, 'EUR', 'fixed', '["sale"]',
 'https://img/prod1.jpg', '["https://img/prod1.jpg","https://img/prod1b.jpg"]', 'https://img/prod1.jpg', '["tag_endurance","gear"]',
 'user_demo001', 'private', 'Excellent état', 'sport', 'bike', 'intermediate',
 48.8566, 2.3522, 'Paris', 'exact', '[]', '["pickup"]', 'in_person', 'Bastille',
 FALSE, NULL, 1, TRUE, '["pompe"]',
 NULL, NULL, NULL, NULL, TIMESTAMP WITH TIME ZONE '2026-04-20 11:37:13+00:00', TIMESTAMP WITH TIME ZONE '2026-04-25 08:00:00+00:00'),
('prod_mkt_002', 'physical_for_sale', 'active', 'Tapis yoga premium', 'Tapis haute densite', 'Tapis 6mm',
 49.00, 'EUR', 'fixed', '["sale"]',
 'https://img/prod2.jpg', '["https://img/prod2.jpg"]', 'https://img/prod2.jpg', '["tag_hatha","fitness"]',
 'user_private001', 'private', 'Neuf', 'sport', 'yoga', 'beginner',
 48.8600, 2.3600, 'Paris', 'exact', '[]', '["pickup","shipping"]', 'in_person', 'Republique',
 FALSE, NULL, 3, TRUE, '["sangle"]',
 NULL, NULL, NULL, NULL, TIMESTAMP WITH TIME ZONE '2026-04-19 11:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-24 08:00:00+00:00'),
('prod_mkt_003', 'physical_for_sale', 'draft', 'Produit draft', 'Ne doit pas sortir', 'draft',
 10.00, 'EUR', 'fixed', '["sale"]',
 NULL, '[]', NULL, '["tag_endurance"]',
 'user_demo001', 'private', NULL, 'sport', 'misc', 'beginner',
 NULL, NULL, NULL, NULL, '[]', '[]', NULL, NULL,
 FALSE, NULL, 1, TRUE, '[]',
 NULL, NULL, NULL, NULL, TIMESTAMP WITH TIME ZONE '2026-04-10 11:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-10 12:00:00+00:00');
