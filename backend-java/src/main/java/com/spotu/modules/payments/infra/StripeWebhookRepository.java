package com.spotu.modules.payments.infra;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

@Repository
public class StripeWebhookRepository {

    private final JdbcTemplate jdbcTemplate;

    public StripeWebhookRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean claimEvent(String eventId, String eventType) {
        try {
            int rows = jdbcTemplate.update("""
                    INSERT INTO stripe_webhook_events
                    (event_id, event_type, status, processed_at, updated_at)
                    VALUES (?, ?, 'processing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """, eventId, eventType);
            return rows == 1;
        } catch (DuplicateKeyException ignored) {
            return false;
        }
    }

    public void markDone(String eventId, String status, String relatedId, String errorMessage) {
        jdbcTemplate.update("""
                UPDATE stripe_webhook_events
                SET status=?, related_id=?, error_message=?, updated_at=CURRENT_TIMESTAMP
                WHERE event_id=?
                """, status, relatedId, errorMessage, eventId);
    }

    public Optional<PaymentLookupRow> findPaymentByIntentId(String stripePaymentIntentId) {
        List<PaymentLookupRow> rows = jdbcTemplate.query("""
                SELECT payment_id, booking_id
                FROM payments
                WHERE stripe_payment_intent_id=?
                LIMIT 1
                """, (rs, rowNum) -> new PaymentLookupRow(
                rs.getString("payment_id"),
                rs.getString("booking_id")
        ), stripePaymentIntentId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<PaymentLookupRow> findPaymentByCheckoutSessionId(String checkoutSessionId) {
        List<PaymentLookupRow> rows = jdbcTemplate.query("""
                SELECT payment_id, booking_id
                FROM payments
                WHERE stripe_checkout_session_id=?
                LIMIT 1
                """, (rs, rowNum) -> new PaymentLookupRow(
                rs.getString("payment_id"),
                rs.getString("booking_id")
        ), checkoutSessionId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<PaymentLookupRow> findPaymentByChargeId(String stripeChargeId) {
        List<PaymentLookupRow> rows = jdbcTemplate.query("""
                SELECT payment_id, booking_id
                FROM payments
                WHERE stripe_charge_id=?
                LIMIT 1
                """, (rs, rowNum) -> new PaymentLookupRow(
                rs.getString("payment_id"),
                rs.getString("booking_id")
        ), stripeChargeId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<String> findBookingStatus(String bookingId) {
        List<String> rows = jdbcTemplate.query("""
                SELECT status
                FROM bookings
                WHERE booking_id=?
                LIMIT 1
                """, (rs, rowNum) -> rs.getString("status"), bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public int updatePaymentAuthorized(String paymentId) {
        return jdbcTemplate.update("""
                UPDATE payments SET status='authorized', updated_at=CURRENT_TIMESTAMP
                WHERE payment_id=? AND status NOT IN ('authorized','captured','refunded','cancelled')
                """, paymentId);
    }

    public int updatePaymentCapturedGuardA(String paymentId) {
        return jdbcTemplate.update("""
                UPDATE payments SET status='captured', updated_at=CURRENT_TIMESTAMP
                WHERE payment_id=? AND status NOT IN ('captured','refunded','cancelled')
                """, paymentId);
    }

    public int updatePaymentCapturedGuardC(String paymentId) {
        return jdbcTemplate.update("""
                UPDATE payments SET status='captured', updated_at=CURRENT_TIMESTAMP
                WHERE payment_id=? AND status NOT IN ('captured','refunded')
                """, paymentId);
    }

    public int updatePaymentCapturedWithCharge(String paymentId, String chargeId) {
        return jdbcTemplate.update("""
                UPDATE payments SET status='captured', stripe_charge_id=?, updated_at=CURRENT_TIMESTAMP
                WHERE payment_id=? AND status NOT IN ('captured','refunded')
                """, chargeId, paymentId);
    }

    public int updateBookingConfirmedPaid(String bookingId) {
        return jdbcTemplate.update("""
                UPDATE bookings
                SET status='confirmed', payment_status='paid', updated_at=CURRENT_TIMESTAMP
                WHERE booking_id=? AND status NOT IN ('confirmed','refused','cancelled','expired')
                """, bookingId);
    }

    public int updatePaymentFailed(String paymentId) {
        return jdbcTemplate.update("""
                UPDATE payments SET status='failed', updated_at=CURRENT_TIMESTAMP
                WHERE payment_id=? AND status NOT IN ('captured','refunded','failed')
                """, paymentId);
    }

    public int updatePaymentCancelled(String paymentId) {
        return jdbcTemplate.update("""
                UPDATE payments SET status='cancelled', updated_at=CURRENT_TIMESTAMP
                WHERE payment_id=? AND status NOT IN ('captured','refunded','cancelled')
                """, paymentId);
    }

    public Optional<PaymentUsersRow> findPaymentUsers(String paymentId) {
        List<PaymentUsersRow> rows = jdbcTemplate.query("""
                SELECT payer_user_id, receiver_user_id
                FROM payments
                WHERE payment_id=?
                LIMIT 1
                """, (rs, rowNum) -> new PaymentUsersRow(
                rs.getString("payer_user_id"),
                rs.getString("receiver_user_id")
        ), paymentId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<String> findServiceTitleByBookingId(String bookingId) {
        List<String> rows = jdbcTemplate.query("""
                SELECT s.title
                FROM bookings b
                JOIN services s ON b.service_id = s.service_id
                WHERE b.booking_id=?
                LIMIT 1
                """, (rs, rowNum) -> rs.getString("title"), bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<String> findPaymentIdByChargeId(String chargeId) {
        List<String> rows = jdbcTemplate.query("""
                SELECT payment_id
                FROM payments
                WHERE stripe_charge_id=?
                LIMIT 1
                """, (rs, rowNum) -> rs.getString("payment_id"), chargeId);
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<RefundLookupRow> findRefundLookupByChargeId(String chargeId) {
        List<RefundLookupRow> rows = jdbcTemplate.query("""
                SELECT payment_id, payer_total_amount
                FROM payments
                WHERE stripe_charge_id=?
                LIMIT 1
                """, (rs, rowNum) -> new RefundLookupRow(
                rs.getString("payment_id"),
                rs.getBigDecimal("payer_total_amount")
        ), chargeId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public int updateRefundFromChargeRefunded(
            String paymentId,
            String newStatus,
            BigDecimal refundAmount,
            String refundStatus,
            String chargeId
    ) {
        return jdbcTemplate.update("""
                UPDATE payments
                SET status=?, refund_amount=?, refund_status=?,
                    stripe_charge_id=COALESCE(stripe_charge_id, ?),
                    updated_at=CURRENT_TIMESTAMP
                WHERE payment_id=? AND status NOT IN ('refunded')
                """, newStatus, refundAmount, refundStatus, chargeId, paymentId);
    }

    public Optional<String> findPayerUserId(String paymentId) {
        List<String> rows = jdbcTemplate.query("""
                SELECT payer_user_id
                FROM payments
                WHERE payment_id=?
                LIMIT 1
                """, (rs, rowNum) -> rs.getString("payer_user_id"), paymentId);
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public int updateRefundAsFullyRefundedEdgeCase(String paymentId, String refundStatus, BigDecimal refundAmount) {
        return jdbcTemplate.update("""
                UPDATE payments
                SET refund_status=?, refund_amount=?, status='refunded', updated_at=CURRENT_TIMESTAMP
                WHERE payment_id=? AND status != 'refunded'
                """, refundStatus, refundAmount, paymentId);
    }

    public int updateRefundStatusOnly(String paymentId, String refundStatus) {
        return jdbcTemplate.update("""
                UPDATE payments
                SET refund_status=?, updated_at=CURRENT_TIMESTAMP
                WHERE payment_id=?
                """, refundStatus, paymentId);
    }

    public record PaymentLookupRow(String paymentId, String bookingId) {
    }

    public record PaymentUsersRow(String payerUserId, String receiverUserId) {
    }

    public record RefundLookupRow(String paymentId, BigDecimal payerTotalAmount) {
    }
}
