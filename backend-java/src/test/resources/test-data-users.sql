DELETE FROM user_subscriptions;
DELETE FROM subscription_plans;
DELETE FROM users;
DELETE FROM reviews;
DELETE FROM user_follows;
DELETE FROM user_blocks;
DELETE FROM tag_entity_type_links;
DELETE FROM tag_category_links;
DELETE FROM tags;
DELETE FROM tag_categories;
DELETE FROM domains;
DELETE FROM services;
DELETE FROM service_locations;
DELETE FROM service_slots;
DELETE FROM service_packages;
DELETE FROM bookings;
DELETE FROM payments;
DELETE FROM stripe_webhook_events;
DELETE FROM push_tokens;
DELETE FROM tag_point_saves;
DELETE FROM pending_file_deletions;
DELETE FROM tag_points;
DELETE FROM spot_you_members;
DELETE FROM spot_you_attendance;
DELETE FROM tag_point_votes;
DELETE FROM conversations;

INSERT INTO users (
    user_id, email, name, role, language, picture, cover_picture, cover_offset_y, cover_scale, bio, phone,
    is_coach_verified, coach_tags, show_phone, show_reviews, iban, bic, iban_name,
    created_at, updated_at, sports_level, goals, user_roles, onboarding_done
) VALUES (
    'user_demo001',
    'user@winek.app',
    'Thomas Dupont',
    'coach',
    'fr',
    'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=150&w=150',
    'https://example.com/cover.jpg',
    0.3,
    1.2,
    'Passionné de sport et de running.',
    '+33 6 12 34 56 78',
    TRUE,
    '["tag_hatha","tag_prise_masse","tag_endurance","tag_bivouac"]',
    TRUE,
    TRUE,
    'FR76 3000 6000 0112 3456 7890 189',
    'BNPAFRPPXXX',
    'Thomas Dupont',
    TIMESTAMP WITH TIME ZONE '2026-04-01 12:51:14.682000+00:00',
    TIMESTAMP WITH TIME ZONE '2026-04-02 13:36:04.382240+00:00',
    NULL,
    '[]',
    '[]',
    FALSE
);

INSERT INTO users (
    user_id, email, name, role, language, picture, cover_picture, cover_offset_y, cover_scale, bio, phone,
    is_coach_verified, coach_tags, show_phone, show_reviews, iban, bic, iban_name,
    created_at, updated_at, sports_level, goals, user_roles, onboarding_done
) VALUES (
    'user_zoe001',
    'zoe@winek.app',
    'Zoé Robert',
    'user',
    'fr',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    FALSE,
    '[]',
    FALSE,
    TRUE,
    NULL,
    NULL,
    NULL,
    TIMESTAMP WITH TIME ZONE '2026-04-03 10:00:00+00:00',
    TIMESTAMP WITH TIME ZONE '2026-04-03 10:00:00+00:00',
    NULL,
    '[]',
    '[]',
    FALSE
);

INSERT INTO users (
    user_id, email, name, role, language, picture, cover_picture, cover_offset_y, cover_scale, bio, phone,
    is_coach_verified, coach_tags, show_phone, show_reviews, iban, bic, iban_name,
    created_at, updated_at, sports_level, goals, user_roles, onboarding_done
) VALUES (
    'user_private001',
    'private@winek.app',
    'Marie Martin',
    'user',
    'fr',
    NULL,
    NULL,
    NULL,
    NULL,
    'Passionnée de randonnée.',
    '+33 6 00 00 00 00',
    FALSE,
    '[]',
    FALSE,
    FALSE,
    NULL,
    NULL,
    NULL,
    TIMESTAMP WITH TIME ZONE '2026-04-03 10:00:00+00:00',
    TIMESTAMP WITH TIME ZONE '2026-04-03 10:00:00+00:00',
    NULL,
    '[]',
    '[]',
    FALSE
);

INSERT INTO users (
    user_id, email, name, role, language, picture, cover_picture, cover_offset_y, cover_scale, bio, phone,
    is_coach_verified, coach_tags, show_phone, show_reviews, iban, bic, iban_name,
    created_at, updated_at, sports_level, goals, user_roles, onboarding_done
) VALUES (
    'user_admin001',
    'admin@winek.app',
    'Admin Test',
    'admin',
    'fr',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    FALSE,
    '[]',
    FALSE,
    TRUE,
    NULL,
    NULL,
    NULL,
    TIMESTAMP WITH TIME ZONE '2026-04-03 10:00:00+00:00',
    TIMESTAMP WITH TIME ZONE '2026-04-03 10:00:00+00:00',
    NULL,
    '[]',
    '[]',
    FALSE
);

INSERT INTO reviews (review_id, reviewer_id, reviewee_id, rating, comment, created_at) VALUES
('rev_001', 'user_admin001', 'user_demo001', 5, 'Excellent coach', TIMESTAMP WITH TIME ZONE '2026-04-10 14:30:00+00:00'),
('rev_002', 'user_private001', 'user_demo001', 5, NULL, TIMESTAMP WITH TIME ZONE '2026-03-20 09:15:00+00:00'),
('rev_003', 'user_zoe001', 'user_demo001', 4, 'Très bien', TIMESTAMP WITH TIME ZONE '2026-02-18 10:00:00+00:00'),
('rev_004', 'user_admin001', 'user_demo001', 3, NULL, TIMESTAMP WITH TIME ZONE '2026-01-05 08:00:00+00:00');

INSERT INTO user_follows (follower_id, following_id) VALUES
('user_admin001', 'user_demo001'),
('user_private001', 'user_demo001'),
('user_demo001', 'user_admin001'),
('user_zoe001', 'user_demo001'),
('user_demo001', 'user_private001');

INSERT INTO user_blocks (blocker_id, blocked_id) VALUES
('user_admin001', 'user_private001');

INSERT INTO subscription_plans (
    plan_id, name, description, price, duration_days,
    exempt_payer_fixed, exempt_payer_percent, exempt_receiver_fixed, exempt_receiver_percent,
    active, priority, created_at, updated_at
) VALUES (
    'plan_webhook_sub',
    'Plan Webhook Sub',
    'Données tests webhook abonnements (slice 20)',
    9.99,
    30,
    TRUE,
    FALSE,
    FALSE,
    TRUE,
    TRUE,
    0,
    TIMESTAMP WITH TIME ZONE '2026-04-01 00:00:00+00:00',
    TIMESTAMP WITH TIME ZONE '2026-04-01 00:00:00+00:00'
);

INSERT INTO subscription_plans (
    plan_id, name, description, price, duration_days,
    exempt_payer_fixed, exempt_payer_percent, exempt_receiver_fixed, exempt_receiver_percent,
    active, priority, created_at, updated_at
) VALUES
(
    'plan_s21_active',
    'Premium S21',
    'Plan actif tests slice 21',
    19.99,
    30,
    TRUE,
    FALSE,
    FALSE,
    TRUE,
    TRUE,
    10,
    TIMESTAMP WITH TIME ZONE '2026-01-01 00:00:00+00:00',
    TIMESTAMP WITH TIME ZONE '2026-04-01 00:00:00+00:00'
),
(
    'plan_s21_inactive',
    'Inactive S21',
    'Plan désactivé',
    5.00,
    30,
    TRUE,
    FALSE,
    FALSE,
    TRUE,
    FALSE,
    1,
    TIMESTAMP WITH TIME ZONE '2026-01-01 00:00:00+00:00',
    TIMESTAMP WITH TIME ZONE '2026-04-01 00:00:00+00:00'
),
(
    'plan_s21_90d',
    'Durée 90j',
    'Plan durée non supportée',
    9.99,
    90,
    TRUE,
    FALSE,
    FALSE,
    TRUE,
    TRUE,
    5,
    TIMESTAMP WITH TIME ZONE '2026-01-01 00:00:00+00:00',
    TIMESTAMP WITH TIME ZONE '2026-04-01 00:00:00+00:00'
),
(
    'plan_s21_free',
    'Gratuit',
    'Prix zéro',
    0,
    30,
    TRUE,
    FALSE,
    FALSE,
    TRUE,
    TRUE,
    5,
    TIMESTAMP WITH TIME ZONE '2026-01-01 00:00:00+00:00',
    TIMESTAMP WITH TIME ZONE '2026-04-01 00:00:00+00:00'
);

INSERT INTO domains (domain_id, name, label_fr, label_en, icon, color, active, created_at) VALUES
('dom_sport', 'sport', 'Sport & Fitness', 'Sport & Fitness', 'dumbbell', '#1DBF73', TRUE, TIMESTAMP WITH TIME ZONE '2026-01-01 00:00:00+00:00'),
('dom_music', 'music', 'Musique', 'Music', 'music-note', '#3355AA', FALSE, TIMESTAMP WITH TIME ZONE '2026-01-02 00:00:00+00:00');

INSERT INTO tag_categories (category_id, domain_id, entity_type, name, label_fr, label_en, icon, active, created_at) VALUES
('cat_yoga', 'dom_sport', 'service', 'yoga', 'Yoga', 'Yoga', 'lotus', TRUE, TIMESTAMP WITH TIME ZONE '2026-01-01 00:00:00+00:00'),
('cat_run', 'dom_sport', 'service', 'running', 'Running', 'Running', 'run', TRUE, TIMESTAMP WITH TIME ZONE '2026-01-03 00:00:00+00:00'),
('cat_product', 'dom_sport', 'product', 'nutrition', 'Nutrition', 'Nutrition', 'apple', TRUE, TIMESTAMP WITH TIME ZONE '2026-01-04 00:00:00+00:00'),
('cat_inactive', 'dom_sport', 'service', 'legacy', 'Legacy', 'Legacy', 'archive', FALSE, TIMESTAMP WITH TIME ZONE '2026-01-05 00:00:00+00:00');

INSERT INTO tags (tag_id, category_id, domain_id, name, label_fr, label_en, icon, active, created_at) VALUES
('tag_hatha', 'cat_yoga', 'dom_sport', 'hatha', 'Hatha Yoga', 'Hatha Yoga', 'leaf', TRUE, TIMESTAMP WITH TIME ZONE '2026-01-02 00:00:00+00:00'),
('tag_endurance', 'cat_run', 'dom_sport', 'endurance', 'Endurance', 'Endurance', 'runner', TRUE, TIMESTAMP WITH TIME ZONE '2026-01-06 00:00:00+00:00'),
('tag_hidden', 'cat_run', 'dom_sport', 'hidden', 'Caché', 'Hidden', 'hide', FALSE, TIMESTAMP WITH TIME ZONE '2026-01-07 00:00:00+00:00');

INSERT INTO tag_category_links (tag_id, category_id) VALUES
('tag_hatha', 'cat_yoga'),
('tag_endurance', 'cat_run');

INSERT INTO tag_entity_type_links (tag_id, entity_type) VALUES
('tag_hatha', 'service'),
('tag_endurance', 'service'),
('tag_endurance', 'product');

INSERT INTO services (
    service_id, coach_id, title, description, address, price, duration_min, location_description,
    max_participants, tag_ids, domain_id, images, active, created_at, updated_at,
    booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
) VALUES
('svc_001', 'user_demo001', 'Cours Hatha Yoga', 'Séance 1h', '10 Rue de la Paix, 75008 Paris, France', 40.00, 60, 'Paris 11e', 10, '["tag_hatha"]', 'dom_sport', '["https://img/1.jpg"]', TRUE, TIMESTAMP WITH TIME ZONE '2026-03-01 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-01 12:00:00+00:00', 'instant_booking', FALSE, NULL),
('svc_002', 'user_demo001', 'Running coach', 'Cardio', '22 Avenue de France, 75013 Paris, France', 30.00, 45, 'Paris 12e', 8, '["tag_endurance"]', 'dom_sport', '["https://img/2.jpg"]', TRUE, TIMESTAMP WITH TIME ZONE '2026-03-02 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-02 12:00:00+00:00', 'manual_approval', TRUE, 1440),
('svc_003', 'user_admin001', 'Service Admin', 'Service admin actif', '5 Rue de Lyon, 75012 Paris, France', 55.00, 90, 'Paris 12e', 6, '["tag_endurance"]', 'dom_sport', NULL, TRUE, TIMESTAMP WITH TIME ZONE '2026-03-03 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-03 12:00:00+00:00', 'manual_approval', TRUE, 720),
('svc_004', 'user_demo001', 'Service désactivé', 'Ancienne offre', '8 Rue Oberkampf, 75011 Paris, France', 25.00, 30, 'Paris 11e', 4, '["tag_hatha"]', 'dom_sport', '["https://img/4.jpg"]', FALSE, TIMESTAMP WITH TIME ZONE '2026-02-01 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-03-01 10:00:00+00:00', 'manual_approval', TRUE, 60);

UPDATE services
SET deleted_at = TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00',
    media_purge_scheduled_at = TIMESTAMP WITH TIME ZONE '2099-12-31 10:00:00+00:00',
    media_purged = FALSE,
    reactivated_at = NULL
WHERE service_id = 'svc_004';

INSERT INTO service_locations (location_id, service_id, precision, description, latitude, longitude) VALUES
('loc_001', 'svc_001', '100m', '10 Rue de la Paix, 75008 Paris, France', 48.8698, 2.3309),
('loc_002', 'svc_002', 'exact', '22 Avenue de France, 75013 Paris, France', 48.8290, 2.3700),
('loc_003', 'svc_003', '1000m', '5 Rue de Lyon, 75012 Paris, France', 48.8460, 2.3740);

INSERT INTO service_packages (package_id, service_id, type_id, type_label, duration_min, max_participants, price, created_at) VALUES
('pkg_001', 'svc_001', 'pkg_type_1', 'Pack 5 séances', 60, 10, 180.00, TIMESTAMP WITH TIME ZONE '2026-03-05 10:00:00+00:00');

INSERT INTO service_slots (slot_id, service_id, slot_type, slot_status, location_id, package_id, day_of_week, days_of_week, start_time, end_time, slot_date) VALUES
('slot_rec_001', 'svc_001', 'group', 'available', 'loc_001', NULL, 1, '[1,3]', TIME '09:00:00', TIME '10:00:00', NULL),
('slot_future_001', 'svc_001', 'individual', 'available', 'loc_001', 'pkg_001', NULL, NULL, TIME '23:59:00', TIME '23:59:59', DATE '2099-01-01'),
('slot_past_001', 'svc_001', 'group', 'available', 'loc_001', NULL, NULL, NULL, TIME '08:00:00', TIME '09:00:00', DATE '2020-01-01'),
('slot_booked_001', 'svc_001', 'group', 'available', 'loc_001', NULL, NULL, NULL, TIME '22:00:00', TIME '23:00:00', DATE '2099-01-02'),
('slot_pending_refuse', 'svc_003', 'specific', 'pending', 'loc_003', NULL, NULL, NULL, TIME '12:00:00', TIME '13:00:00', DATE '2099-01-04'),
('slot_reserved_refuse', 'svc_003', 'specific', 'reserved', 'loc_003', NULL, NULL, NULL, TIME '14:00:00', TIME '15:00:00', DATE '2099-01-05'),
('slot_accept_authorized', 'svc_003', 'specific', 'reserved', 'loc_003', NULL, NULL, NULL, TIME '16:00:00', TIME '17:00:00', DATE '2099-01-08'),
('slot_accept_pending', 'svc_003', 'specific', 'pending', 'loc_003', NULL, NULL, NULL, TIME '18:00:00', TIME '19:00:00', DATE '2099-01-09'),
('slot_accept_available', 'svc_003', 'specific', 'available', 'loc_003', NULL, NULL, NULL, TIME '20:00:00', TIME '21:00:00', DATE '2099-01-10'),
('slot_complete_booked', 'svc_003', 'specific', 'booked', 'loc_003', NULL, NULL, NULL, TIME '21:00:00', TIME '22:00:00', DATE '2099-01-11'),
('slot_complete_reserved', 'svc_003', 'specific', 'reserved', 'loc_003', NULL, NULL, NULL, TIME '22:00:00', TIME '23:00:00', DATE '2099-01-12'),
('slot_cancel_pending', 'svc_003', 'specific', 'pending', 'loc_003', NULL, NULL, NULL, TIME '10:00:00', TIME '11:00:00', DATE '2099-01-20'),
('slot_cancel_booked', 'svc_003', 'specific', 'booked', 'loc_003', NULL, NULL, NULL, TIME '12:00:00', TIME '13:00:00', DATE '2099-01-21');

MERGE INTO service_saves (save_id, user_id, service_id, saved_at) KEY(save_id) VALUES
('save_001', 'user_demo001', 'svc_003', TIMESTAMP WITH TIME ZONE '2026-04-15 10:00:00+00:00'),
('save_002', 'user_demo001', 'svc_001', TIMESTAMP WITH TIME ZONE '2026-04-16 10:00:00+00:00');

INSERT INTO bookings (
    booking_id, service_id, user_id, coach_id, status, scheduled_at, slot_id, location_id, notes, amount,
    payment_status, payer_user_id, receiver_user_id, pricing_snapshot, idempotency_key, currency,
    created_at, updated_at, expires_at, cancelled_by_user_id, cancellation_reason, payment_mode
) VALUES
('booking_001', 'svc_001', 'user_zoe001', 'user_demo001', 'confirmed', TIMESTAMP WITH TIME ZONE '2099-01-01 10:00:00+00:00',
 'slot_booked_001', 'loc_001', 'Premier cours', 66.00, 'paid', 'user_zoe001', 'user_demo001',
 '{"base_price":60.0,"commission_rate":0.1,"total":66.0}', 'idem_001', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-10 10:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_002', 'svc_002', 'user_demo001', 'user_admin001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-02 15:00:00+00:00',
 NULL, NULL, 'Sans slot', 30.00, 'pending', NULL, 'user_admin001',
 '{"base_price":30.0,"total":30.0}', 'idem_002', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-11 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-11 10:05:00+00:00',
 NULL, NULL, NULL, 'pay_later'),
('booking_003', 'svc_001', 'user_private001', 'user_demo001', 'cancelled', TIMESTAMP WITH TIME ZONE '2099-01-03 09:00:00+00:00',
 'slot_future_001', 'loc_001', NULL, 40.00, 'pending', 'user_private001', NULL,
 '{"base_price":40.0,"total":44.0}', 'idem_003', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-12 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-12 10:05:00+00:00',
 NULL, 'user_private001', 'Changement de plan', 'pay_now'),
('booking_004', 'svc_003', 'user_zoe001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-04 12:00:00+00:00',
 'slot_pending_refuse', 'loc_003', 'Refuse nominal', 40.00, 'pending', 'user_zoe001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_004', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 10:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_005', 'svc_003', 'user_private001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-05 14:00:00+00:00',
 'slot_reserved_refuse', 'loc_003', 'Refuse reserved slot', 40.00, 'paid', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_005', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 11:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 11:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_006', 'svc_003', 'user_zoe001', 'user_demo001', 'refused', TIMESTAMP WITH TIME ZONE '2099-01-06 10:00:00+00:00',
 NULL, NULL, 'Déjà refusé', 40.00, 'pending', 'user_zoe001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_006', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 12:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 12:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_007', 'svc_003', 'user_zoe001', 'user_demo001', 'confirmed', TIMESTAMP WITH TIME ZONE '2099-01-07 10:00:00+00:00',
 NULL, NULL, 'Conflit statut', 40.00, 'paid', 'user_zoe001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_007', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 13:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 13:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_008', 'svc_003', 'user_zoe001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-08 16:00:00+00:00',
 'slot_accept_authorized', 'loc_003', 'Accept cas A', 40.00, 'authorized', 'user_zoe001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_008', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 14:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 14:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_009', 'svc_003', 'user_private001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-09 18:00:00+00:00',
 'slot_accept_pending', 'loc_003', 'Accept cas B pay now', 40.00, 'pending', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_009', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 15:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 15:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_010', 'svc_001', 'user_zoe001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-10 20:00:00+00:00',
 'slot_accept_available', 'loc_003', 'Accept pay later fallback', 40.00, 'pending', 'user_zoe001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_010', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 16:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 16:05:00+00:00',
 NULL, NULL, NULL, 'pay_later'),
('booking_011', 'svc_003', 'user_private001', 'user_demo001', 'awaiting_payment', TIMESTAMP WITH TIME ZONE '2099-01-11 10:00:00+00:00',
 NULL, NULL, 'Idempotent awaiting', 40.00, 'pending', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_011', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 17:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 17:05:00+00:00',
 TIMESTAMP WITH TIME ZONE '2099-01-11 11:00:00+00:00', NULL, NULL, 'pay_now'),
('booking_012', 'svc_003', 'user_zoe001', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2099-01-12 10:00:00+00:00',
 NULL, NULL, 'Idempotent accepted', 40.00, 'pending', 'user_zoe001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_012', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 18:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 18:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_013', 'svc_003', 'user_zoe001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-13 10:00:00+00:00',
 NULL, NULL, 'Expired request', 40.00, 'pending', 'user_zoe001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_013', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 19:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 19:05:00+00:00',
 TIMESTAMP WITH TIME ZONE '2020-01-01 00:00:00+00:00', NULL, NULL, 'pay_now'),
('booking_014', 'svc_003', 'user_private001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-14 10:00:00+00:00',
 NULL, NULL, 'Fallback pay now 30', 40.00, 'pending', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_014', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 20:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 20:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_015', 'svc_missing', 'user_private001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-15 10:00:00+00:00',
 NULL, NULL, 'Service missing join', 40.00, 'pending', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_015', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 21:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 21:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_016', 'svc_003', 'user_private001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-16 10:00:00+00:00',
 NULL, NULL, 'Admin allowed non receiver', 40.00, 'pending', 'user_private001', 'user_zoe001',
 '{"base_price":40.0,"total":44.0}', 'idem_016', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 22:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 22:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_017', 'svc_003', 'user_private001', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2099-01-17 10:00:00+00:00',
 'slot_complete_booked', 'loc_003', 'Complete nominal', 40.00, 'authorized', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_017', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 23:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 23:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_018', 'svc_003', 'user_private001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-18 10:00:00+00:00',
 NULL, NULL, 'Complete slot null', 40.00, 'pending', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_018', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 23:10:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 23:15:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_019', 'svc_003', 'user_private001', 'user_demo001', 'refused', TIMESTAMP WITH TIME ZONE '2099-01-19 10:00:00+00:00',
 'slot_complete_reserved', 'loc_003', 'Complete refused no409', 40.00, 'pending', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_019', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-13 23:20:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-13 23:25:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_020', 'svc_003', 'user_private001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-20 10:00:00+00:00',
 'slot_cancel_pending', 'loc_003', 'Cancel payer requested', 40.00, 'requires_authorization', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_020', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 00:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 00:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_021', 'svc_003', 'user_zoe001', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2099-01-20 12:00:00+00:00',
 NULL, NULL, 'Cancel receiver accepted', 40.00, 'requires_authorization', 'user_zoe001', 'user_private001',
 '{"base_price":40.0,"total":44.0}', 'idem_021', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 00:10:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 00:15:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_022', 'svc_003', 'user_zoe001', 'user_demo001', 'confirmed', TIMESTAMP WITH TIME ZONE '2099-01-21 12:00:00+00:00',
 'slot_cancel_booked', 'loc_003', 'Cancel admin confirmed', 40.00, 'captured', 'user_zoe001', 'user_private001',
 '{"base_price":40.0,"total":44.0}', 'idem_022', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 00:20:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 00:25:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_023', 'svc_003', 'user_zoe001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-22 12:00:00+00:00',
 NULL, NULL, 'Cancel receiver forbidden state', 40.00, 'pending', 'user_zoe001', 'user_private001',
 '{"base_price":40.0,"total":44.0}', 'idem_023', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 00:30:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 00:35:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_024', 'svc_003', 'user_private001', 'user_demo001', 'completed', TIMESTAMP WITH TIME ZONE '2099-01-23 12:00:00+00:00',
 NULL, NULL, 'Cancel non annulable', 40.00, 'captured', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_024', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 00:40:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 00:45:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_025', 'svc_003', 'user_zoe001', 'user_demo001', 'awaiting_payment', TIMESTAMP WITH TIME ZONE '2099-01-24 12:00:00+00:00',
 NULL, NULL, 'Cancel legacy payer field', 40.00, 'pending', NULL, 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_025', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 00:50:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 00:55:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_026', 'svc_003', 'user_private001', 'user_demo001', 'confirmed', TIMESTAMP WITH TIME ZONE '2099-01-25 12:00:00+00:00',
 NULL, NULL, 'Cancel captured no charge', 40.00, 'captured', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_026', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 01:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 01:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_027', 'svc_003', 'user_private001', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2099-01-26 12:00:00+00:00',
 NULL, NULL, 'Cancel no payment row', 40.00, 'pending', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_027', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 01:10:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 01:15:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_030', 'svc_003', 'user_private001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-27 12:00:00+00:00',
 NULL, NULL, 'Webhook requested branch', 40.00, 'pending', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_030', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 01:20:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 01:25:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_031', 'svc_003', 'user_private001', 'user_demo001', 'awaiting_payment', TIMESTAMP WITH TIME ZONE '2099-01-28 12:00:00+00:00',
 NULL, NULL, 'Webhook awaiting branch', 40.00, 'pending', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_031', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 01:30:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 01:35:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_040', 'svc_003', 'user_private001', 'user_demo001', 'awaiting_payment', TIMESTAMP WITH TIME ZONE '2099-01-29 12:00:00+00:00',
 NULL, NULL, 'Checkout post nominal', 40.00, 'pending', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_040', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 02:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 02:05:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_041', 'svc_003', 'user_private001', 'user_demo001', 'requested', TIMESTAMP WITH TIME ZONE '2099-01-30 12:00:00+00:00',
 NULL, NULL, 'Checkout status requested', 40.00, 'pending', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_041', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 02:10:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 02:15:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_042', 'svc_003', 'user_private001', 'user_demo001', 'confirmed', TIMESTAMP WITH TIME ZONE '2099-01-31 12:00:00+00:00',
 NULL, NULL, 'Checkout already captured', 40.00, 'paid', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_042', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 02:20:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 02:25:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_043', 'svc_003', 'user_private001', 'user_demo001', 'awaiting_payment', TIMESTAMP WITH TIME ZONE '2099-02-01 12:00:00+00:00',
 NULL, NULL, 'Checkout existing open', 40.00, 'pending', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_043', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 02:30:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 02:35:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_044', 'svc_003', 'user_private001', 'user_demo001', 'awaiting_payment', TIMESTAMP WITH TIME ZONE '2099-02-02 12:00:00+00:00',
 NULL, NULL, 'Checkout existing expired', 40.00, 'authorized', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_044', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 02:40:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 02:45:00+00:00',
 NULL, NULL, NULL, 'pay_now'),
('booking_045', 'svc_003', 'user_private001', 'user_demo001', 'awaiting_payment', TIMESTAMP WITH TIME ZONE '2099-02-03 12:00:00+00:00',
 NULL, NULL, 'Checkout status unknown', 40.00, 'requires_authorization', 'user_private001', 'user_admin001',
 '{"base_price":40.0,"total":44.0}', 'idem_045', 'EUR',
 TIMESTAMP WITH TIME ZONE '2026-04-14 02:50:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-14 02:55:00+00:00',
 NULL, NULL, NULL, 'pay_now');

INSERT INTO payments (
    payment_id, booking_id, status, stripe_payment_intent_id, stripe_checkout_session_id,
    stripe_charge_id, refund_amount, refund_status, payer_total_amount, updated_at
) VALUES
('pay_001', 'booking_004', 'requires_authorization', 'pi_refuse_001', NULL, NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-13 10:06:00+00:00'),
('pay_002', 'booking_005', 'captured', 'pi_refuse_002', NULL, 'ch_refuse_002', NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-13 11:06:00+00:00'),
('pay_003', 'booking_008', 'authorized', 'pi_accept_001', NULL, NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-13 14:06:00+00:00'),
('pay_004', 'booking_009', 'pending', 'pi_accept_002', NULL, NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-13 15:06:00+00:00'),
('pay_005', 'booking_017', 'authorized', 'pi_complete_001', NULL, NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-13 23:06:00+00:00'),
('pay_006', 'booking_018', 'requires_authorization', 'pi_complete_002', NULL, NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-13 23:16:00+00:00'),
('pay_007', 'booking_020', 'requires_authorization', 'pi_cancel_020', NULL, NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 00:06:00+00:00'),
('pay_008', 'booking_021', 'requires_authorization', 'pi_cancel_021', NULL, NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 00:16:00+00:00'),
('pay_009', 'booking_022', 'captured', 'pi_cancel_022', NULL, 'ch_cancel_022', NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 00:26:00+00:00'),
('pay_010', 'booking_025', 'pending', NULL, NULL, NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 00:56:00+00:00'),
('pay_011', 'booking_026', 'captured', 'pi_cancel_026', NULL, NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 01:06:00+00:00'),
('pay_012', 'booking_030', 'requires_authorization', 'pi_webhook_030', 'cs_webhook_030', NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 01:26:00+00:00'),
('pay_013', 'booking_031', 'requires_authorization', 'pi_webhook_031', 'cs_webhook_031', NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 01:36:00+00:00'),
('pay_040', 'booking_040', 'pending', 'pi_checkout_040', NULL, NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 02:06:00+00:00'),
('pay_041', 'booking_041', 'pending', 'pi_checkout_041', 'cs_status_complete_unpaid_041', NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 02:16:00+00:00'),
('pay_042', 'booking_042', 'captured', 'pi_checkout_042', NULL, 'ch_checkout_042', NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 02:26:00+00:00'),
('pay_043', 'booking_043', 'pending', 'pi_checkout_043', 'cs_status_open_043', NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 02:36:00+00:00'),
('pay_044', 'booking_044', 'authorized', 'pi_checkout_044', 'cs_status_expired_044', NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 02:46:00+00:00'),
('pay_045', 'booking_045', 'requires_authorization', 'pi_checkout_045', 'cs_status_fail_045', NULL, NULL, NULL, 40.00, TIMESTAMP WITH TIME ZONE '2026-04-14 02:56:00+00:00');

INSERT INTO bookings (
    booking_id, service_id, user_id, coach_id, status, scheduled_at, slot_id, location_id, notes, amount,
    payment_status, payer_user_id, receiver_user_id, pricing_snapshot, idempotency_key, currency,
    created_at, updated_at, expires_at, cancelled_by_user_id, cancellation_reason, payment_mode
) VALUES
('booking_s30_awaiting', 'svc_003', 'user_private001', 'user_admin001', 'awaiting_payment', TIMESTAMP WITH TIME ZONE '2099-02-22 10:00:00+00:00',
 NULL, NULL, 'S30 pay nominal', 51.75, 'pending', 'user_private001', 'user_admin001',
 '{"base_amount":50.00,"payer_fixed_fee":1.00,"payer_percent_fee_amount":1.25,"receiver_fixed_fee":3.00,"receiver_percent_fee_amount":2.25,"platform_total_fee":7.50,"receiver_net_amount":44.75,"payer_total_amount":52.25,"currency":"EUR","product_type":"service_booking"}',
 'idem_s30_pay', 'EUR', TIMESTAMP WITH TIME ZONE '2026-04-16 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-16 10:00:00+00:00',
 TIMESTAMP WITH TIME ZONE '2099-02-22 12:00:00+00:00', NULL, NULL, 'pay_now'),
('booking_s30_expired', 'svc_003', 'user_private001', 'user_admin001', 'awaiting_payment', TIMESTAMP WITH TIME ZONE '2099-02-22 11:00:00+00:00',
 NULL, NULL, 'S30 expired pay', 51.75, 'pending', 'user_private001', 'user_admin001',
 '{"base_amount":50.00,"payer_fixed_fee":1.00,"payer_percent_fee_amount":1.25,"receiver_fixed_fee":3.00,"receiver_percent_fee_amount":2.25,"platform_total_fee":7.50,"receiver_net_amount":44.75,"payer_total_amount":52.25,"currency":"EUR","product_type":"service_booking"}',
 'idem_s30_expired', 'EUR', TIMESTAMP WITH TIME ZONE '2026-04-16 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-16 10:00:00+00:00',
 TIMESTAMP WITH TIME ZONE '2099-02-22 13:00:00+00:00', NULL, NULL, 'pay_now');

INSERT INTO payments (
    payment_id, booking_id, payer_user_id, receiver_user_id, product_type, product_id, status, currency,
    base_amount, payer_fixed_fee, payer_percent_fee_amount, receiver_fixed_fee, receiver_percent_fee_amount,
    platform_total_fee, receiver_net_amount, payer_total_amount, pricing_rule_snapshot,
    stripe_payment_intent_id, stripe_checkout_session_id, stripe_charge_id, stripe_transfer_id, updated_at
) VALUES
('pay_s30_awaiting', 'booking_s30_awaiting', 'user_private001', 'user_admin001', 'service_booking', 'svc_003',
 'requires_authorization', 'EUR', 50.00, 1.00, 1.25, 3.00, 2.25, 7.50, 44.75, 52.25,
 '{"base_amount":50.00}', NULL, NULL, NULL, NULL, TIMESTAMP WITH TIME ZONE '2026-04-16 10:00:00+00:00'),
('pay_s30_expired', 'booking_s30_expired', 'user_private001', 'user_admin001', 'service_booking', 'svc_003',
 'requires_authorization', 'EUR', 50.00, 1.00, 1.25, 3.00, 2.25, 7.50, 44.75, 52.25,
 '{"base_amount":50.00}', NULL, NULL, NULL, NULL, TIMESTAMP WITH TIME ZONE '2026-04-16 10:00:00+00:00');

INSERT INTO tag_points (
    point_id, user_id, title, description, precision, images, image_url, event_date, event_end_date,
    event_schedule, schedule, domain_id, tag_ids, minimum_participants, maximum_participants,
    latitude, longitude, visibility_type, cancelled, active, created_at, address, join_mode
) VALUES
('tp_001', 'user_demo001', 'Running matinal', 'Session running', 'exact', '["https://tp/1.jpg"]', 'https://tp/1.jpg', NULL, NULL,
 '{"type":"weekly","schedule":{"1":[{"start":"07:00"}]}}', '{"type":"weekly","schedule":{"1":[{"start":"07:00"}]}}', 'dom_sport', '["tag_endurance"]',
 2, 10, 48.8566, 2.3522, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-05 10:00:00+00:00', '10 Rue de Rivoli, 75004 Paris, France', 'open'),
('tp_002', 'user_demo001', 'Sortie dimanche', 'Sortie libre', '100m', '[]', NULL, DATE '2099-01-01', NULL,
 NULL, NULL, 'dom_sport', '["tag_hatha"]',
 1, 5, 48.8666, 2.3722, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-04 10:00:00+00:00', NULL, 'open'),
('tp_admin001', 'user_admin001', 'Spot admin', 'Pour tests recherche', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '["tag_endurance"]',
 1, 8, 48.8600, 2.3500, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-06 10:00:00+00:00', NULL, 'open'),
('tp_inactive', 'user_demo001', 'Spot désactivé', 'Inactive', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]',
 1, 5, 48.8500, 2.3400, 'public', FALSE, FALSE, TIMESTAMP WITH TIME ZONE '2026-04-07 10:00:00+00:00', NULL, 'open');

INSERT INTO spot_you_members (id, spot_you_id, user_id, status, joined_at) VALUES
('syp_001', 'tp_001', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-05 10:00:00+00:00'),
('syp_002', 'tp_001', 'user_admin001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-05 11:00:00+00:00'),
('syp_pending_zoe', 'tp_002', 'user_zoe001', 'pending', TIMESTAMP WITH TIME ZONE '2026-04-06 12:00:00+00:00');

INSERT INTO tag_points (
    point_id, user_id, title, description, precision, images, image_url, event_date, event_end_date,
    event_schedule, schedule, domain_id, tag_ids, minimum_participants, maximum_participants,
    latitude, longitude, visibility_type, cancelled, active, created_at, address, join_mode,
    invite_permissions, max_community_members
) VALUES
('tp_s27_admin', 'user_demo001', 'S27 admin approval', 'x', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 10, 48.851, 2.351, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, 'admin_approval',
 'admin_only', NULL),
('tp_s27_members', 'user_demo001', 'S27 members approval', 'x', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 10, 48.852, 2.352, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, 'members_approval',
 'admin_and_members', NULL),
('tp_s27_private', 'user_demo001', 'S27 private', 'x', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 10, 48.853, 2.353, 'private', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, 'open',
 'admin_only', NULL),
('tp_s27_full', 'user_demo001', 'S27 full capacity', 'x', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 10, 48.854, 2.354, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, 'open',
 'admin_only', 1),
('tp_s27_inv_admin', 'user_demo001', 'S27 invite admin only', 'x', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 10, 48.855, 2.355, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, 'open',
 'admin_only', NULL),
('tp_s27_inv_mem', 'user_demo001', 'S27 invite members', 'x', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 10, 48.856, 2.356, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, 'open',
 'admin_and_members', NULL),
('tp_s27_rejoin', 'user_demo001', 'S27 rejoin rejected', 'x', 'exact', '["https://rej/1.jpg"]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 10, 48.857, 2.357, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, 'open',
 'admin_only', NULL),
('tp_s27_invited', 'user_demo001', 'S27 invited flow', 'x', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 10, 48.858, 2.358, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, 'open',
 'admin_only', NULL),
('tp_s27_invited2', 'user_demo001', 'S27 invited refuse', 'x', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 10, 48.859, 2.359, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, 'open',
 'admin_only', NULL),
('tp_s27_jr', 'user_demo001', 'S27 join-requests list', 'x', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 10, 48.860, 2.360, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, 'members_approval',
 'admin_and_members', NULL),
('tp_s27_appr', 'user_demo001', 'S27 approve by member', 'x', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 10, 48.861, 2.361, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, 'members_approval',
 'admin_and_members', NULL),
('tp_s27_reject', 'user_demo001', 'S27 reject permissions', 'x', 'exact', '[]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 10, 48.862, 2.362, 'public', FALSE, TRUE, TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, 'admin_approval',
 'admin_only', NULL);

INSERT INTO spot_you_members (id, spot_you_id, user_id, status, joined_at, requested_by, invited_by, invited_at) VALUES
('s27a_o', 'tp_s27_admin', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, NULL, NULL),
('s27a_p', 'tp_s27_admin', 'user_private001', 'pending', TIMESTAMP WITH TIME ZONE '2026-04-10 11:00:00+00:00', 'user_private001', NULL, NULL),
('s27m_o', 'tp_s27_members', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, NULL, NULL),
('s27m_a', 'tp_s27_members', 'user_admin001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:01:00+00:00', NULL, NULL, NULL),
('s27m_z', 'tp_s27_members', 'user_zoe001', 'pending', TIMESTAMP WITH TIME ZONE '2026-04-10 12:00:00+00:00', 'user_zoe001', NULL, NULL),
('s27f_o', 'tp_s27_full', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, NULL, NULL),
('s27i_o', 'tp_s27_inv_admin', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, NULL, NULL),
('s27m2_o', 'tp_s27_inv_mem', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, NULL, NULL),
('s27m2_a', 'tp_s27_inv_mem', 'user_admin001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:01:00+00:00', NULL, NULL, NULL),
('s27r_o', 'tp_s27_rejoin', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, NULL, NULL),
('s27r_z', 'tp_s27_rejoin', 'user_zoe001', 'rejected', TIMESTAMP WITH TIME ZONE '2026-04-10 11:00:00+00:00', 'user_zoe001', NULL, NULL),
('s27v_o', 'tp_s27_invited', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, NULL, NULL),
('s27v_z', 'tp_s27_invited', 'user_zoe001', 'invited', TIMESTAMP WITH TIME ZONE '2026-04-10 10:30:00+00:00', NULL, 'user_demo001', TIMESTAMP WITH TIME ZONE '2026-04-10 10:30:00+00:00'),
('s27w_o', 'tp_s27_invited2', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, NULL, NULL),
('s27w_z', 'tp_s27_invited2', 'user_zoe001', 'invited', TIMESTAMP WITH TIME ZONE '2026-04-10 10:30:00+00:00', NULL, 'user_demo001', TIMESTAMP WITH TIME ZONE '2026-04-10 10:30:00+00:00'),
('s27jr_o', 'tp_s27_jr', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, NULL, NULL),
('s27jr_a', 'tp_s27_jr', 'user_admin001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:01:00+00:00', NULL, NULL, NULL),
('s27jr_z', 'tp_s27_jr', 'user_zoe001', 'pending', TIMESTAMP WITH TIME ZONE '2026-04-10 12:00:00+00:00', 'user_zoe001', NULL, NULL),
('s27ap_o', 'tp_s27_appr', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, NULL, NULL),
('s27ap_a', 'tp_s27_appr', 'user_admin001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:01:00+00:00', NULL, NULL, NULL),
('s27ap_z', 'tp_s27_appr', 'user_zoe001', 'pending', TIMESTAMP WITH TIME ZONE '2026-04-10 12:00:00+00:00', 'user_zoe001', NULL, NULL),
('s27rj_o', 'tp_s27_reject', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-10 10:00:00+00:00', NULL, NULL, NULL),
('s27rj_p', 'tp_s27_reject', 'user_private001', 'pending', TIMESTAMP WITH TIME ZONE '2026-04-10 12:00:00+00:00', 'user_private001', NULL, NULL);

INSERT INTO tag_points (
    point_id, user_id, title, description, precision, images, image_url, event_date, event_end_date,
    event_schedule, schedule, domain_id, tag_ids, minimum_participants, maximum_participants,
    latitude, longitude, visibility_type, cancelled, active, deleted_at, deleted_by,
    created_at, updated_at, address, join_mode, invite_permissions, max_community_members,
    media_purge_scheduled_at, media_purge_notified_at, media_purged, media_purged_at, reactivated_at
) VALUES
('tp_s29_active', 'user_demo001', 'S29 active deletable', 'x', 'exact', '["https://s29/a.jpg","https://s29/b.jpg"]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 20, 48.870, 2.370, 'public', FALSE, TRUE, NULL, NULL,
 TIMESTAMP WITH TIME ZONE '2026-04-11 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-11 10:00:00+00:00', NULL, 'open', 'admin_only', NULL,
 NULL, NULL, FALSE, NULL, NULL),
('tp_s29_deleted_pending', 'user_demo001', 'S29 deleted pending', 'x', 'exact', '["https://s29/p1.jpg","https://s29/p2.jpg"]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 20, 48.871, 2.371, 'public', FALSE, FALSE, TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00', 'user_demo001',
 TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00', NULL, 'open', 'admin_only', NULL,
 TIMESTAMP WITH TIME ZONE '2026-06-30 10:00:00+00:00', NULL, FALSE, NULL, NULL),
('tp_s29_deleted_purged', 'user_demo001', 'S29 deleted purged', 'x', 'exact', '["https://s29/c1.jpg"]', NULL, NULL, NULL,
 NULL, NULL, 'dom_sport', '[]', 1, 20, 48.872, 2.372, 'public', FALSE, FALSE, TIMESTAMP WITH TIME ZONE '2025-12-01 10:00:00+00:00', 'user_demo001',
 TIMESTAMP WITH TIME ZONE '2025-12-01 10:00:00+00:00', TIMESTAMP WITH TIME ZONE '2025-12-01 10:00:00+00:00', NULL, 'open', 'admin_only', NULL,
 NULL, TIMESTAMP WITH TIME ZONE '2026-03-01 10:00:00+00:00', TRUE, TIMESTAMP WITH TIME ZONE '2026-03-02 10:00:00+00:00', NULL);

INSERT INTO spot_you_members (id, spot_you_id, user_id, status, joined_at) VALUES
('s29a_owner', 'tp_s29_active', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-11 10:00:00+00:00'),
('s29a_admin', 'tp_s29_active', 'user_admin001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-11 10:01:00+00:00'),
('s29a_zoe', 'tp_s29_active', 'user_zoe001', 'pending', TIMESTAMP WITH TIME ZONE '2026-04-11 10:02:00+00:00'),
('s29p_owner', 'tp_s29_deleted_pending', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00'),
('s29p_admin', 'tp_s29_deleted_pending', 'user_admin001', 'accepted', TIMESTAMP WITH TIME ZONE '2026-04-01 10:01:00+00:00'),
('s29p_zoe', 'tp_s29_deleted_pending', 'user_zoe001', 'invited', TIMESTAMP WITH TIME ZONE '2026-04-01 10:02:00+00:00'),
('s29c_owner', 'tp_s29_deleted_purged', 'user_demo001', 'accepted', TIMESTAMP WITH TIME ZONE '2025-12-01 10:00:00+00:00'),
('s29c_admin', 'tp_s29_deleted_purged', 'user_admin001', 'accepted', TIMESTAMP WITH TIME ZONE '2025-12-01 10:01:00+00:00');

INSERT INTO conversations (conversation_id, context_id, context_deleted) VALUES
('conv_s29_1', 'tp_s29_active', FALSE),
('conv_s29_2', 'tp_s29_active', FALSE),
('conv_s29_3', 'tp_s29_deleted_pending', TRUE),
('conv_s29_4', 'tp_s29_deleted_purged', TRUE);

INSERT INTO pending_file_deletions (file_url, entity_type, entity_id, scheduled_at, status, created_at) VALUES
('https://s29/p1.jpg', 'tag_point', 'tp_s29_deleted_pending', TIMESTAMP WITH TIME ZONE '2026-06-30 10:00:00+00:00', 'pending', TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00'),
('https://s29/p2.jpg', 'tag_point', 'tp_s29_deleted_pending', TIMESTAMP WITH TIME ZONE '2026-06-30 10:00:00+00:00', 'pending', TIMESTAMP WITH TIME ZONE '2026-04-01 10:00:00+00:00'),
('https://s29/c1.jpg', 'tag_point', 'tp_s29_deleted_purged', TIMESTAMP WITH TIME ZONE '2026-02-28 10:00:00+00:00', 'completed', TIMESTAMP WITH TIME ZONE '2025-12-01 10:00:00+00:00');

INSERT INTO tag_point_saves (save_id, point_id, user_id, saved_at) VALUES
('save_zoe_tp001', 'tp_001', 'user_zoe001', TIMESTAMP WITH TIME ZONE '2026-04-08 09:00:00+00:00');

INSERT INTO spot_you_attendance (id, spot_you_id, user_id, session_date, status) VALUES
('att_001', 'tp_001', 'user_demo001', DATE '2099-01-01', 'going'),
('att_002', 'tp_001', 'user_admin001', DATE '2099-01-01', 'going');

INSERT INTO tag_point_votes (id, point_id, rating) VALUES
('tpv_001', 'tp_001', 5),
('tpv_002', 'tp_001', 4);
