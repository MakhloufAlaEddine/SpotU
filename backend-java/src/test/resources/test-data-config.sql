DELETE FROM pricing_rules;
DELETE FROM app_config;

INSERT INTO app_config (config_key, config_value) VALUES
('enable_manual_approval_for_services', 'true'),
('enable_pay_later_for_services', 'false'),
('pay_now_checkout_minutes', '45');

INSERT INTO pricing_rules (
    rule_id, product_type, name,
    payer_fixed_fee, payer_percent_fee, receiver_fixed_fee, receiver_percent_fee,
    active, priority
) VALUES (
    'rule_slice01_test', 'service_booking', 'Slice01 test',
    1.00, 2.50, 3.00, 4.50,
    TRUE, 10
);
