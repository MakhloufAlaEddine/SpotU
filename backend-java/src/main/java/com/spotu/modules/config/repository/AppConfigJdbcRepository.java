package com.spotu.modules.config.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.HashMap;
import java.util.Map;

/**
 * Lecture {@code app_config} — requête identique à {@code server.py} {@code public_booking_config}.
 */
@Repository
public class AppConfigJdbcRepository {

    private static final String SQL = """
            SELECT config_key, config_value
            FROM app_config
            WHERE config_key IN ('enable_manual_approval_for_services', 'enable_pay_later_for_services', 'pay_now_checkout_minutes')
            """;

    private final JdbcTemplate jdbcTemplate;

    public AppConfigJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * @return map config_key → config_value (clés absentes si aucune ligne en base)
     */
    public Map<String, String> loadBookingKeys() {
        return jdbcTemplate.query(SQL, rs -> {
            Map<String, String> out = new HashMap<>();
            while (rs.next()) {
                out.put(rs.getString("config_key"), rs.getString("config_value"));
            }
            return out;
        });
    }
}
