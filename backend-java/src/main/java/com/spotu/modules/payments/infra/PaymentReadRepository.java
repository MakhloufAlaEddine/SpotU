package com.spotu.modules.payments.infra;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class PaymentReadRepository {

    private final JdbcTemplate jdbcTemplate;

    public PaymentReadRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Map<String, Object>> findByUserWithNames(String userId) {
        return jdbcTemplate.queryForList("""
                SELECT p.*,
                       u_pay.name AS payer_name,
                       u_recv.name AS receiver_name
                FROM payments p
                LEFT JOIN users u_pay ON u_pay.user_id = p.payer_user_id
                LEFT JOIN users u_recv ON u_recv.user_id = p.receiver_user_id
                WHERE p.payer_user_id = ? OR p.receiver_user_id = ?
                ORDER BY p.created_at DESC
                """, userId, userId);
    }

    public Optional<Map<String, Object>> findByPaymentId(String paymentId) {
        try {
            Map<String, Object> row = jdbcTemplate.queryForMap(
                    "SELECT * FROM payments WHERE payment_id = ?",
                    paymentId
            );
            return Optional.of(row);
        } catch (EmptyResultDataAccessException ignored) {
            return Optional.empty();
        }
    }
}
