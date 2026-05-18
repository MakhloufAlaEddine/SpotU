package com.spotu.modules.workers.infra;

import com.spotu.common.JdbcSqlDialect;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public class ExpiryWorkerRepository {

    private final JdbcTemplate jdbcTemplate;
    private final JdbcSqlDialect jdbcSqlDialect;

    public ExpiryWorkerRepository(JdbcTemplate jdbcTemplate, JdbcSqlDialect jdbcSqlDialect) {
        this.jdbcTemplate = jdbcTemplate;
        this.jdbcSqlDialect = jdbcSqlDialect;
    }

    public List<ExpiredBookingRow> findExpiredBatchLocked(int batchSize) {
        return jdbcTemplate.query("""
                SELECT
                    b.booking_id,
                    b.status AS booking_status,
                    b.slot_id,
                    b.payer_user_id,
                    b.receiver_user_id,
                    b.service_id,
                    p.payment_id,
                    p.status AS pay_status,
                    p.stripe_payment_intent_id,
                    p.stripe_checkout_session_id
                FROM bookings b
                LEFT JOIN payments p ON p.booking_id = b.booking_id
                WHERE b.status IN ('requested', 'awaiting_payment')
                  AND b.expires_at IS NOT NULL
                  AND b.expires_at < CURRENT_TIMESTAMP
                ORDER BY b.expires_at ASC
                LIMIT ?
                FOR UPDATE OF b SKIP LOCKED
                """, (rs, rowNum) -> new ExpiredBookingRow(
                rs.getString("booking_id"),
                rs.getString("booking_status"),
                rs.getString("slot_id"),
                rs.getString("payer_user_id"),
                rs.getString("receiver_user_id"),
                rs.getString("service_id"),
                rs.getString("payment_id"),
                rs.getString("pay_status"),
                rs.getString("stripe_payment_intent_id"),
                rs.getString("stripe_checkout_session_id")
        ), batchSize);
    }

    public boolean expireBookingGuarded(String bookingId) {
        int updated = jdbcTemplate.update("""
                UPDATE bookings
                SET status='expired', updated_at=CURRENT_TIMESTAMP
                WHERE booking_id=?
                  AND status IN ('requested','awaiting_payment')
                """, bookingId);
        return updated == 1;
    }

    public void releaseSlotForExpiry(String slotId) {
        jdbcTemplate.update("""
                UPDATE service_slots
                SET slot_status='available'
                WHERE slot_id=?
                  AND slot_status IN ('pending','reserved')
                  AND slot_type IN ('single','specific')
                """, slotId);
    }

    public void cancelPaymentForExpiry(String paymentId) {
        jdbcTemplate.update("""
                UPDATE payments
                SET status='cancelled', updated_at=CURRENT_TIMESTAMP
                WHERE payment_id=?
                """, paymentId);
    }

    public String findServiceTitle(String serviceId) {
        List<String> rows = jdbcTemplate.query("""
                SELECT title FROM services WHERE service_id=?
                """, (rs, rowNum) -> rs.getString("title"), serviceId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public void insertNotification(String userId, String type, String title, String body, String dataJson) {
        jdbcTemplate.update(
                jdbcSqlDialect.notificationInsertSql(),
                newNotifId(), userId, type, title, body, dataJson);
    }

    private String newNotifId() {
        String hex = UUID.randomUUID().toString().replace("-", "");
        return "ntf_" + hex.substring(0, 12);
    }

    public record ExpiredBookingRow(
            String bookingId,
            String bookingStatus,
            String slotId,
            String payerUserId,
            String receiverUserId,
            String serviceId,
            String paymentId,
            String payStatus,
            String stripePaymentIntentId,
            String stripeCheckoutSessionId
    ) {
    }
}
