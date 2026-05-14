package com.spotu.modules.bookings.infra;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public class BookingWriteRepository {

    private final JdbcTemplate jdbcTemplate;

    public BookingWriteRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<BookingRefuseRow> findBookingForRefuse(String bookingId) {
        List<BookingRefuseRow> rows = jdbcTemplate.query("""
                SELECT booking_id, status, receiver_user_id, slot_id, user_id AS payer_user_id
                FROM bookings
                WHERE booking_id = ?
                """, (rs, rowNum) -> new BookingRefuseRow(
                rs.getString("booking_id"),
                rs.getString("status"),
                rs.getString("receiver_user_id"),
                rs.getString("slot_id"),
                rs.getString("payer_user_id")
        ), bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<PaymentStripeRow> findPaymentStripeByBookingId(String bookingId) {
        List<PaymentStripeRow> rows = jdbcTemplate.query("""
                SELECT stripe_payment_intent_id, status AS pay_status
                FROM payments
                WHERE booking_id = ?
                LIMIT 1
                """, (rs, rowNum) -> new PaymentStripeRow(
                rs.getString("stripe_payment_intent_id"),
                rs.getString("pay_status")
        ), bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void updateBookingStatusRefused(String bookingId) {
        jdbcTemplate.update(
                "UPDATE bookings SET status='refused', updated_at=CURRENT_TIMESTAMP WHERE booking_id=?",
                bookingId
        );
    }

    public void cancelPaymentsForRefuse(String bookingId) {
        jdbcTemplate.update("""
                UPDATE payments SET status='cancelled', updated_at=CURRENT_TIMESTAMP
                WHERE booking_id=? AND status IN ('requires_authorization','authorized')
                """, bookingId);
    }

    public void releasePendingSlot(String slotId) {
        jdbcTemplate.update("""
                UPDATE service_slots SET slot_status='available'
                WHERE slot_id=? AND slot_status='pending'
                """, slotId);
    }

    public Optional<BookingAcceptRow> findBookingForAccept(String bookingId) {
        List<BookingAcceptRow> rows = jdbcTemplate.query("""
                SELECT b.booking_id, b.status, b.receiver_user_id, b.slot_id, b.expires_at,
                       b.user_id AS payer_user_id, b.service_id, b.payment_mode,
                       s.pay_later_expiration_minutes, s.booking_approval_mode
                FROM bookings b
                JOIN services s ON s.service_id = b.service_id
                WHERE b.booking_id = ?
                """, (rs, rowNum) -> new BookingAcceptRow(
                rs.getString("booking_id"),
                rs.getString("status"),
                rs.getString("receiver_user_id"),
                rs.getString("slot_id"),
                rs.getTimestamp("expires_at"),
                rs.getString("payer_user_id"),
                rs.getString("service_id"),
                rs.getString("payment_mode"),
                rs.getObject("pay_later_expiration_minutes", Integer.class),
                rs.getString("booking_approval_mode")
        ), bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<PaymentAcceptRow> findPaymentForAccept(String bookingId) {
        List<PaymentAcceptRow> rows = jdbcTemplate.query("""
                SELECT payment_id, stripe_payment_intent_id, status AS pay_status
                FROM payments
                WHERE booking_id = ?
                LIMIT 1
                """, (rs, rowNum) -> new PaymentAcceptRow(
                rs.getString("payment_id"),
                rs.getString("stripe_payment_intent_id"),
                rs.getString("pay_status")
        ), bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Integer findPayNowCheckoutMinutesRaw() {
        List<String> values = jdbcTemplate.query(
                "SELECT config_value FROM app_config WHERE config_key='pay_now_checkout_minutes'",
                (rs, rowNum) -> rs.getString("config_value")
        );
        if (values.isEmpty()) {
            return null;
        }
        try {
            return Integer.parseInt(values.get(0));
        } catch (Exception ignored) {
            return null;
        }
    }

    public void updateBookingAcceptedCaseA(String bookingId) {
        jdbcTemplate.update("""
                UPDATE bookings
                SET status='confirmed',
                    payment_status='captured',
                    expires_at=NULL,
                    updated_at=CURRENT_TIMESTAMP
                WHERE booking_id=?
                """, bookingId);
    }

    public void capturePaymentById(String paymentId) {
        jdbcTemplate.update(
                "UPDATE payments SET status='captured', updated_at=CURRENT_TIMESTAMP WHERE payment_id=?",
                paymentId
        );
    }

    public void markSlotBookedForAccept(String slotId) {
        jdbcTemplate.update("""
                UPDATE service_slots SET slot_status='booked'
                WHERE slot_id=? AND slot_status IN ('pending','available','reserved')
                """, slotId);
    }

    public void updateBookingAcceptedCaseB(String bookingId, Instant expiresAt) {
        jdbcTemplate.update("""
                UPDATE bookings
                SET status='awaiting_payment',
                    expires_at=?,
                    updated_at=CURRENT_TIMESTAMP
                WHERE booking_id=?
                """, Timestamp.from(expiresAt), bookingId);
    }

    public void markSlotReservedForAccept(String slotId) {
        jdbcTemplate.update("""
                UPDATE service_slots SET slot_status='reserved'
                WHERE slot_id=? AND slot_status IN ('pending','available')
                """, slotId);
    }

    public Optional<String> findReceiverUserIdForComplete(String bookingId) {
        List<String> rows = jdbcTemplate.query("""
                SELECT receiver_user_id
                FROM bookings
                WHERE booking_id = ?
                """, (rs, rowNum) -> rs.getString("receiver_user_id"), bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public void updateBookingCompleted(String bookingId) {
        jdbcTemplate.update(
                "UPDATE bookings SET status='completed', updated_at=CURRENT_TIMESTAMP WHERE booking_id=?",
                bookingId
        );
    }

    public void markSlotCompletedForComplete(String bookingId) {
        jdbcTemplate.update("""
                UPDATE service_slots SET slot_status='completed'
                WHERE slot_id = (SELECT slot_id FROM bookings WHERE booking_id=?)
                  AND slot_status='booked'
                """, bookingId);
    }

    public void captureAuthorizedPaymentsForComplete(String bookingId) {
        jdbcTemplate.update("""
                UPDATE payments SET status='captured', updated_at=CURRENT_TIMESTAMP
                WHERE booking_id=? AND status='authorized'
                """, bookingId);
    }

    public Optional<BookingCancelRow> findBookingForCancel(String bookingId) {
        List<BookingCancelRow> rows = jdbcTemplate.query("""
                SELECT b.booking_id, b.status, b.user_id, b.slot_id,
                       b.payer_user_id, b.receiver_user_id, b.service_id,
                       p.status AS pay_status, p.payment_id,
                       p.stripe_payment_intent_id, p.stripe_charge_id
                FROM bookings b
                LEFT JOIN payments p ON p.booking_id = b.booking_id
                WHERE b.booking_id = ?
                LIMIT 1
                """, (rs, rowNum) -> new BookingCancelRow(
                rs.getString("booking_id"),
                rs.getString("status"),
                rs.getString("user_id"),
                rs.getString("slot_id"),
                rs.getString("payer_user_id"),
                rs.getString("receiver_user_id"),
                rs.getString("service_id"),
                rs.getString("pay_status"),
                rs.getString("payment_id"),
                rs.getString("stripe_payment_intent_id"),
                rs.getString("stripe_charge_id")
        ), bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void updateBookingCancelled(String bookingId, String cancelledByUserId, String cancellationReason) {
        jdbcTemplate.update("""
                UPDATE bookings
                SET status='cancelled',
                    cancelled_by_user_id=?,
                    cancellation_reason=?,
                    updated_at=CURRENT_TIMESTAMP
                WHERE booking_id=?
                """, cancelledByUserId, cancellationReason, bookingId);
    }

    public void updatePaymentStatusByPaymentId(String paymentId, String newStatus) {
        jdbcTemplate.update(
                "UPDATE payments SET status=?, updated_at=CURRENT_TIMESTAMP WHERE payment_id=?",
                newStatus, paymentId
        );
    }

    public void releaseSlotForCancel(String slotId) {
        jdbcTemplate.update("""
                UPDATE service_slots SET slot_status='available'
                WHERE slot_id=? AND slot_status IN ('pending','reserved','booked')
                """, slotId);
    }

    public record BookingRefuseRow(
            String bookingId,
            String status,
            String receiverUserId,
            String slotId,
            String payerUserId
    ) {
    }

    public record PaymentStripeRow(String stripePaymentIntentId, String payStatus) {
    }

    public record BookingAcceptRow(
            String bookingId,
            String status,
            String receiverUserId,
            String slotId,
            Timestamp expiresAt,
            String payerUserId,
            String serviceId,
            String paymentMode,
            Integer payLaterExpirationMinutes,
            String bookingApprovalMode
    ) {
    }

    public record PaymentAcceptRow(
            String paymentId,
            String stripePaymentIntentId,
            String payStatus
    ) {
    }

    public record BookingCancelRow(
            String bookingId,
            String status,
            String userId,
            String slotId,
            String payerUserId,
            String receiverUserId,
            String serviceId,
            String payStatus,
            String paymentId,
            String stripePaymentIntentId,
            String stripeChargeId
    ) {
    }
}
