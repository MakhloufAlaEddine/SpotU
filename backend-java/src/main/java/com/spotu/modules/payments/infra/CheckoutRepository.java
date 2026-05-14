package com.spotu.modules.payments.infra;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

@Repository
public class CheckoutRepository {

    private final JdbcTemplate jdbcTemplate;

    public CheckoutRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<CheckoutPaymentRow> findForCheckout(String bookingId, String payerUserId) {
        List<CheckoutPaymentRow> rows = jdbcTemplate.query("""
                SELECT p.payment_id, p.status, p.payer_total_amount, b.currency AS currency, p.booking_id,
                       p.stripe_checkout_session_id, p.stripe_payment_intent_id, NULL AS payer_user_id, NULL AS receiver_user_id,
                       b.service_id
                FROM payments p
                LEFT JOIN bookings b ON b.booking_id = p.booking_id
                WHERE p.booking_id = ? AND COALESCE(b.payer_user_id, b.user_id) = ?
                """, (rs, rowNum) -> new CheckoutPaymentRow(
                rs.getString("payment_id"),
                rs.getString("status"),
                rs.getBigDecimal("payer_total_amount"),
                rs.getString("currency"),
                rs.getString("booking_id"),
                rs.getString("stripe_checkout_session_id"),
                rs.getString("stripe_payment_intent_id"),
                rs.getString("payer_user_id"),
                rs.getString("receiver_user_id"),
                rs.getString("service_id")
        ), bookingId, payerUserId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void updateAfterSessionCreation(String paymentId, String checkoutSessionId, String paymentIntentId, String bookingId) {
        jdbcTemplate.update("""
                UPDATE payments
                SET stripe_checkout_session_id = ?,
                    stripe_payment_intent_id   = ?,
                    status = CASE
                        WHEN status NOT IN ('requires_authorization','authorized','captured')
                        THEN 'requires_authorization'
                        ELSE status
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE payment_id = ?
                """, checkoutSessionId, paymentIntentId, paymentId);
        jdbcTemplate.update("""
                UPDATE bookings
                SET payment_status = CASE
                    WHEN payment_status NOT IN ('requires_authorization','authorized','captured','paid')
                    THEN 'requires_authorization'
                    ELSE payment_status
                END,
                updated_at = CURRENT_TIMESTAMP
                WHERE booking_id = ?
                """, bookingId);
    }

    public Optional<CheckoutPaymentRow> findBySessionOrIntentId(String sessionOrIntentId) {
        List<CheckoutPaymentRow> rows = jdbcTemplate.query("""
                SELECT p.payment_id, p.status, p.payer_total_amount, p.currency, p.booking_id,
                       p.stripe_checkout_session_id, p.stripe_payment_intent_id,
                       p.payer_user_id, p.receiver_user_id, b.service_id
                FROM payments p
                LEFT JOIN bookings b ON b.booking_id = p.booking_id
                WHERE p.stripe_checkout_session_id = ?
                   OR p.stripe_payment_intent_id = ?
                LIMIT 1
                """, (rs, rowNum) -> new CheckoutPaymentRow(
                rs.getString("payment_id"),
                rs.getString("status"),
                rs.getBigDecimal("payer_total_amount"),
                rs.getString("currency"),
                rs.getString("booking_id"),
                rs.getString("stripe_checkout_session_id"),
                rs.getString("stripe_payment_intent_id"),
                rs.getString("payer_user_id"),
                rs.getString("receiver_user_id"),
                rs.getString("service_id")
        ), sessionOrIntentId, sessionOrIntentId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<String> findBookingStatus(String bookingId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT status FROM bookings WHERE booking_id = ?",
                (rs, rowNum) -> rs.getString("status"),
                bookingId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<PaymentUsersRow> findPaymentUsers(String paymentId) {
        List<PaymentUsersRow> rows = jdbcTemplate.query("""
                SELECT payer_user_id, receiver_user_id
                FROM payments
                WHERE payment_id = ?
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
                WHERE b.booking_id = ?
                """, (rs, rowNum) -> rs.getString("title"), bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public void insertNotification(
            String notifId,
            String userId,
            String type,
            String title,
            String body,
            String dataJson
    ) {
        jdbcTemplate.update("""
                INSERT INTO notifications (notif_id, user_id, type, title, body, data)
                VALUES (?, ?, ?, ?, ?, ?)
                """, notifId, userId, type, title, body, dataJson);
    }

    public void updatePaymentCaptured(String paymentId) {
        jdbcTemplate.update("UPDATE payments SET status='captured', updated_at=CURRENT_TIMESTAMP WHERE payment_id=?", paymentId);
    }

    public void updatePaymentAuthorized(String paymentId) {
        jdbcTemplate.update("UPDATE payments SET status='authorized', updated_at=CURRENT_TIMESTAMP WHERE payment_id=?", paymentId);
    }

    public void updatePaymentCancelled(String paymentId) {
        jdbcTemplate.update("UPDATE payments SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE payment_id=?", paymentId);
    }

    public void updateBookingConfirmedPaidGuarded(String bookingId) {
        jdbcTemplate.update("""
                UPDATE bookings
                SET status='confirmed', payment_status='paid', updated_at=CURRENT_TIMESTAMP
                WHERE booking_id=?
                  AND status NOT IN ('confirmed','refused','cancelled','expired')
                """, bookingId);
    }

    public void updateBookingPaymentAuthorized(String bookingId) {
        jdbcTemplate.update(
                "UPDATE bookings SET payment_status='authorized', updated_at=CURRENT_TIMESTAMP WHERE booking_id=?",
                bookingId
        );
    }

    public record CheckoutPaymentRow(
            String paymentId,
            String status,
            BigDecimal payerTotalAmount,
            String currency,
            String bookingId,
            String stripeCheckoutSessionId,
            String stripePaymentIntentId,
            String payerUserId,
            String receiverUserId,
            String serviceId
    ) {
    }

    public record PaymentUsersRow(
            String payerUserId,
            String receiverUserId
    ) {
    }
}
