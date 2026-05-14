package com.spotu.modules.config.repository;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.Optional;

/**
 * Lecture {@code pricing_rules} — requête alignée sur {@code server.py} {@code public_commission_config}.
 */
@Repository
public class PricingRulesJdbcRepository {

    private static final String SQL = """
            SELECT payer_fixed_fee, payer_percent_fee, receiver_fixed_fee, receiver_percent_fee
            FROM pricing_rules
            WHERE product_type = 'service_booking' AND active = TRUE
            ORDER BY priority DESC, created_at DESC
            LIMIT 1
            """;

    private static final RowMapper<CommissionRow> ROW_MAPPER = (rs, rowNum) -> new CommissionRow(
            rs.getBigDecimal("payer_fixed_fee"),
            rs.getBigDecimal("payer_percent_fee"),
            rs.getBigDecimal("receiver_fixed_fee"),
            rs.getBigDecimal("receiver_percent_fee")
    );

    private final JdbcTemplate jdbcTemplate;

    public PricingRulesJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<CommissionRow> findActiveServiceBookingRule() {
        try {
            CommissionRow row = jdbcTemplate.queryForObject(SQL, ROW_MAPPER);
            return Optional.ofNullable(row);
        } catch (EmptyResultDataAccessException ex) {
            return Optional.empty();
        }
    }

    public record CommissionRow(
            BigDecimal payerFixedFee,
            BigDecimal payerPercentFee,
            BigDecimal receiverFixedFee,
            BigDecimal receiverPercentFee
    ) {}
}
