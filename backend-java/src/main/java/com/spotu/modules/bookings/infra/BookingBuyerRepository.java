package com.spotu.modules.bookings.infra;

import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class BookingBuyerRepository {

    private final JdbcTemplate jdbcTemplate;

    public BookingBuyerRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<ServicePreviewRow> findServiceForPreview(String serviceId) {
        List<ServicePreviewRow> rows = jdbcTemplate.query("""
                SELECT service_id, coach_id, price
                FROM services
                WHERE service_id = ? AND active = TRUE
                """, this::mapServicePreview, serviceId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<ServiceRequestRow> findServiceForRequest(String serviceId) {
        List<ServiceRequestRow> rows = jdbcTemplate.query("""
                SELECT service_id, coach_id, price, booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
                FROM services
                WHERE service_id = ? AND active = TRUE
                """, this::mapServiceRequest, serviceId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Map<String, Boolean> findGlobalBookingFlags() {
        return jdbcTemplate.query("""
                SELECT config_key, config_value
                FROM app_config
                WHERE config_key IN ('enable_manual_approval_for_services','enable_pay_later_for_services')
                """, rs -> {
            java.util.Map<String, Boolean> out = new java.util.HashMap<>();
            while (rs.next()) {
                out.put(rs.getString("config_key"), "true".equals(rs.getString("config_value")));
            }
            return out;
        });
    }

    public Integer findPayNowCheckoutMinutesRaw() {
        List<String> rows = jdbcTemplate.query("""
                SELECT config_value FROM app_config WHERE config_key='pay_now_checkout_minutes'
                """, (rs, rowNum) -> rs.getString("config_value"));
        if (rows.isEmpty()) {
            return null;
        }
        try {
            return Integer.parseInt(rows.get(0));
        } catch (Exception ignored) {
            return null;
        }
    }

    public Optional<String> findBookingIdByIdempotencyKey(String idempotencyKey) {
        List<String> rows = jdbcTemplate.query("""
                SELECT booking_id FROM bookings WHERE idempotency_key = ?
                """, (rs, rowNum) -> rs.getString("booking_id"), idempotencyKey);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<String> findActiveBookingIdBySlotAndUser(String slotId, String userId) {
        List<String> rows = jdbcTemplate.query("""
                SELECT booking_id
                FROM bookings
                WHERE slot_id = ?
                  AND user_id = ?
                  AND status NOT IN ('refused','cancelled','expired')
                LIMIT 1
                """, (rs, rowNum) -> rs.getString("booking_id"), slotId, userId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<SlotRow> lockSlotNowait(String slotId) throws DataAccessException {
        List<SlotRow> rows = jdbcTemplate.query("""
                SELECT slot_id, slot_type, slot_status
                FROM service_slots
                WHERE slot_id = ?
                FOR UPDATE NOWAIT
                """, this::mapSlotRow, slotId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void insertBooking(
            String bookingId,
            String serviceId,
            String userId,
            String coachId,
            String status,
            Timestamp scheduledAt,
            String slotId,
            String locationId,
            String notes,
            BigDecimal amount,
            String payerUserId,
            String receiverUserId,
            String pricingSnapshotJson,
            String idempotencyKey,
            String paymentMode,
            Timestamp expiresAt
    ) {
        jdbcTemplate.update("""
                INSERT INTO bookings
                  (booking_id, service_id, user_id, coach_id, status,
                   scheduled_at, slot_id, location_id, notes, amount,
                   payer_user_id, receiver_user_id, pricing_snapshot,
                   payment_status, currency, idempotency_key,
                   payment_mode, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        'pending','EUR',?, ?, ?)
                """, bookingId, serviceId, userId, coachId, status, scheduledAt, slotId, locationId, notes, amount,
                payerUserId, receiverUserId, pricingSnapshotJson, idempotencyKey, paymentMode, expiresAt);
    }

    public void insertPayment(PaymentInsertRow row) {
        jdbcTemplate.update("""
                INSERT INTO payments (
                    payment_id, payer_user_id, receiver_user_id,
                    product_type, product_id, booking_id,
                    stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id,
                    status, currency,
                    base_amount, payer_fixed_fee, payer_percent_fee_amount,
                    receiver_fixed_fee, receiver_percent_fee_amount,
                    platform_total_fee, receiver_net_amount, payer_total_amount,
                    pricing_rule_snapshot
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                row.paymentId(), row.payerUserId(), row.receiverUserId(),
                row.productType(), row.productId(), row.bookingId(),
                row.stripePaymentIntentId(), row.stripeChargeId(), row.stripeTransferId(),
                row.status(), row.currency(),
                row.baseAmount(), row.payerFixedFee(), row.payerPercentFeeAmount(),
                row.receiverFixedFee(), row.receiverPercentFeeAmount(),
                row.platformTotalFee(), row.receiverNetAmount(), row.payerTotalAmount(),
                row.pricingRuleSnapshotJson()
        );
    }

    public void updateSlotStatus(String slotId, String status) {
        jdbcTemplate.update("UPDATE service_slots SET slot_status = ? WHERE slot_id = ?", status, slotId);
    }

    public Optional<Map<String, Object>> fetchBookingForApi(String bookingId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
                SELECT b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
                       b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
                       b.payment_status, b.payer_user_id, b.receiver_user_id,
                       b.pricing_snapshot, b.idempotency_key, b.currency,
                       b.created_at, b.updated_at, b.expires_at,
                       b.cancelled_by_user_id, b.cancellation_reason,
                       b.payment_mode,
                       s.title AS service_title, s.address
                FROM bookings b
                LEFT JOIN services s ON s.service_id = b.service_id
                WHERE b.booking_id = ?
                """, bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<String> findUserName(String userId) {
        List<String> rows = jdbcTemplate.query("""
                SELECT name FROM users WHERE user_id = ?
                """, (rs, rowNum) -> rs.getString("name"), userId);
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<String> findServiceTitle(String serviceId) {
        List<String> rows = jdbcTemplate.query("""
                SELECT title FROM services WHERE service_id = ?
                """, (rs, rowNum) -> rs.getString("title"), serviceId);
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<PayBookingGuardRow> findPayGuard(String bookingId) {
        List<PayBookingGuardRow> rows = jdbcTemplate.query("""
                SELECT booking_id, status, payer_user_id, user_id, expires_at, payment_mode
                FROM bookings
                WHERE booking_id = ?
                """, this::mapPayBookingGuard, bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<PayPaymentRow> findPaymentForPay(String bookingId) {
        List<PayPaymentRow> rows = jdbcTemplate.query("""
                SELECT payment_id, payer_total_amount, currency, stripe_checkout_session_id
                FROM payments
                WHERE booking_id = ?
                LIMIT 1
                """, this::mapPayPaymentRow, bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void updatePaymentAfterStripeSession(String sessionId, String paymentIntentId, String paymentId) {
        jdbcTemplate.update("""
                UPDATE payments
                SET stripe_checkout_session_id = ?,
                    stripe_payment_intent_id   = COALESCE(?, stripe_payment_intent_id),
                    status = CASE
                        WHEN status NOT IN ('requires_authorization','authorized','captured')
                        THEN 'requires_authorization'
                        ELSE status
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE payment_id = ?
                """, sessionId, paymentIntentId, paymentId);
    }

    public void updateBookingPaymentStatusForPay(String bookingId) {
        jdbcTemplate.update("""
                UPDATE bookings
                SET payment_status='requires_authorization',
                    updated_at=CURRENT_TIMESTAMP
                WHERE booking_id=?
                  AND payment_status NOT IN ('authorized','captured','paid')
                """, bookingId);
    }

    private ServicePreviewRow mapServicePreview(ResultSet rs, int rowNum) throws SQLException {
        return new ServicePreviewRow(
                rs.getString("service_id"),
                rs.getString("coach_id"),
                rs.getBigDecimal("price")
        );
    }

    private ServiceRequestRow mapServiceRequest(ResultSet rs, int rowNum) throws SQLException {
        return new ServiceRequestRow(
                rs.getString("service_id"),
                rs.getString("coach_id"),
                rs.getBigDecimal("price"),
                rs.getString("booking_approval_mode"),
                rs.getObject("allow_pay_later", Boolean.class),
                rs.getObject("pay_later_expiration_minutes", Integer.class)
        );
    }

    private SlotRow mapSlotRow(ResultSet rs, int rowNum) throws SQLException {
        return new SlotRow(
                rs.getString("slot_id"),
                rs.getString("slot_type"),
                rs.getString("slot_status")
        );
    }

    private PayBookingGuardRow mapPayBookingGuard(ResultSet rs, int rowNum) throws SQLException {
        return new PayBookingGuardRow(
                rs.getString("booking_id"),
                rs.getString("status"),
                rs.getString("payer_user_id"),
                rs.getString("user_id"),
                rs.getTimestamp("expires_at") == null ? null : rs.getTimestamp("expires_at").toInstant(),
                rs.getString("payment_mode")
        );
    }

    private PayPaymentRow mapPayPaymentRow(ResultSet rs, int rowNum) throws SQLException {
        return new PayPaymentRow(
                rs.getString("payment_id"),
                rs.getBigDecimal("payer_total_amount"),
                rs.getString("currency"),
                rs.getString("stripe_checkout_session_id")
        );
    }

    public record ServicePreviewRow(String serviceId, String coachId, BigDecimal price) {
    }

    public record ServiceRequestRow(
            String serviceId,
            String coachId,
            BigDecimal price,
            String bookingApprovalMode,
            Boolean allowPayLater,
            Integer payLaterExpirationMinutes
    ) {
    }

    public record SlotRow(String slotId, String slotType, String slotStatus) {
    }

    public record PaymentInsertRow(
            String paymentId,
            String payerUserId,
            String receiverUserId,
            String productType,
            String productId,
            String bookingId,
            String stripePaymentIntentId,
            String stripeChargeId,
            String stripeTransferId,
            String status,
            String currency,
            BigDecimal baseAmount,
            BigDecimal payerFixedFee,
            BigDecimal payerPercentFeeAmount,
            BigDecimal receiverFixedFee,
            BigDecimal receiverPercentFeeAmount,
            BigDecimal platformTotalFee,
            BigDecimal receiverNetAmount,
            BigDecimal payerTotalAmount,
            String pricingRuleSnapshotJson
    ) {
    }

    public record PayBookingGuardRow(
            String bookingId,
            String status,
            String payerUserId,
            String userId,
            Instant expiresAt,
            String paymentMode
    ) {
    }

    public record PayPaymentRow(
            String paymentId,
            BigDecimal payerTotalAmount,
            String currency,
            String stripeCheckoutSessionId
    ) {
    }
}
