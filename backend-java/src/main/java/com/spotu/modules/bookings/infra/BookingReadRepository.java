package com.spotu.modules.bookings.infra;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.common.JsonbMedia;
import com.spotu.modules.auth.support.PythonIsoTimestamps;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

@Repository
public class BookingReadRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public BookingReadRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public List<BookingMeRow> findMyBookings(String userId) {
        return jdbcTemplate.query("""
                SELECT
                    b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
                    b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
                    b.payment_status, b.payer_user_id, b.receiver_user_id,
                    b.pricing_snapshot, b.idempotency_key, b.currency,
                    b.created_at, b.updated_at, b.expires_at,
                    b.cancelled_by_user_id, b.cancellation_reason,
                    b.payment_mode,
                    s.title AS service_title, s.address,
                    u_recv.name AS receiver_name, u_recv.picture AS receiver_picture,
                    sl.start_time AS slot_start_time, sl.end_time AS slot_end_time,
                    sl.slot_date, sl.slot_type
                FROM bookings b
                LEFT JOIN services s ON s.service_id = b.service_id
                LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
                LEFT JOIN service_slots sl ON sl.slot_id = b.slot_id
                WHERE b.user_id = ?
                ORDER BY b.created_at DESC
                """, this::mapMeRow, userId);
    }

    public List<BookingReceivedRow> findReceivedBookings(String userId) {
        return jdbcTemplate.query("""
                SELECT
                    b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
                    b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
                    b.payment_status, b.payer_user_id, b.receiver_user_id,
                    b.pricing_snapshot, b.idempotency_key, b.currency,
                    b.created_at, b.updated_at, b.expires_at,
                    b.cancelled_by_user_id, b.cancellation_reason,
                    b.payment_mode,
                    s.title AS service_title,
                    u_pay.name AS payer_name
                FROM bookings b
                LEFT JOIN services s ON s.service_id = b.service_id
                LEFT JOIN users u_pay ON u_pay.user_id = b.payer_user_id
                WHERE b.receiver_user_id = ?
                ORDER BY b.created_at DESC
                """, this::mapReceivedRow, userId);
    }

    public Optional<BookingDetailRow> findBookingDetail(String bookingId) {
        List<BookingDetailRow> rows = jdbcTemplate.query("""
                SELECT
                    b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
                    b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
                    b.payment_status, b.payer_user_id, b.receiver_user_id,
                    b.pricing_snapshot, b.idempotency_key, b.currency,
                    b.created_at, b.updated_at, b.expires_at,
                    b.cancelled_by_user_id, b.cancellation_reason,
                    b.payment_mode,
                    s.title AS service_title, s.address,
                    s.images AS service_images,
                    s.description AS service_description,
                    u_recv.name AS receiver_name, u_recv.picture AS receiver_picture,
                    u_pay.name AS payer_name, u_pay.picture AS payer_picture,
                    sl.start_time AS slot_start_time, sl.end_time AS slot_end_time,
                    sl.slot_date, sl.slot_type
                FROM bookings b
                LEFT JOIN services s ON s.service_id = b.service_id
                LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
                LEFT JOIN users u_pay ON u_pay.user_id = COALESCE(b.payer_user_id, b.user_id)
                LEFT JOIN service_slots sl ON sl.slot_id = b.slot_id
                WHERE b.booking_id = ?
                """, this::mapDetailRow, bookingId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    private BookingMeRow mapMeRow(ResultSet rs, int rowNum) throws SQLException {
        return new BookingMeRow(
                baseFields(rs),
                rs.getString("service_title"),
                rs.getString("address"),
                rs.getString("receiver_name"),
                rs.getString("receiver_picture"),
                rs.getString("slot_start_time"),
                rs.getString("slot_end_time"),
                rs.getString("slot_date"),
                rs.getString("slot_type")
        );
    }

    private BookingReceivedRow mapReceivedRow(ResultSet rs, int rowNum) throws SQLException {
        return new BookingReceivedRow(
                baseFields(rs),
                rs.getString("service_title"),
                rs.getString("payer_name")
        );
    }

    private BookingDetailRow mapDetailRow(ResultSet rs, int rowNum) throws SQLException {
        return new BookingDetailRow(
                baseFields(rs),
                rs.getString("service_title"),
                rs.getString("address"),
                JsonbMedia.unwrapToJsonString(objectMapper, rs.getObject("service_images")),
                rs.getString("service_description"),
                rs.getString("receiver_name"),
                rs.getString("receiver_picture"),
                rs.getString("payer_name"),
                rs.getString("payer_picture"),
                rs.getString("slot_start_time"),
                rs.getString("slot_end_time"),
                rs.getString("slot_date"),
                rs.getString("slot_type")
        );
    }

    private BookingBaseFields baseFields(ResultSet rs) throws SQLException {
        return new BookingBaseFields(
                rs.getString("booking_id"),
                rs.getString("service_id"),
                rs.getString("user_id"),
                rs.getString("coach_id"),
                rs.getString("status"),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("scheduled_at")),
                rs.getString("slot_id"),
                rs.getString("location_id"),
                rs.getString("notes"),
                rs.getBigDecimal("amount"),
                rs.getString("payment_status"),
                rs.getString("payer_user_id"),
                rs.getString("receiver_user_id"),
                rs.getObject("pricing_snapshot"),
                rs.getString("idempotency_key"),
                rs.getString("currency"),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("created_at")),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("updated_at")),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("expires_at")),
                rs.getString("cancelled_by_user_id"),
                rs.getString("cancellation_reason"),
                rs.getString("payment_mode")
        );
    }

    public record BookingBaseFields(
            String bookingId,
            String serviceId,
            String userId,
            String coachId,
            String status,
            String scheduledAt,
            String slotId,
            String locationId,
            String notes,
            BigDecimal amount,
            String paymentStatus,
            String payerUserId,
            String receiverUserId,
            Object pricingSnapshot,
            String idempotencyKey,
            String currency,
            String createdAt,
            String updatedAt,
            String expiresAt,
            String cancelledByUserId,
            String cancellationReason,
            String paymentMode
    ) {
    }

    public record BookingMeRow(
            BookingBaseFields base,
            String serviceTitle,
            String address,
            String receiverName,
            String receiverPicture,
            String slotStartTime,
            String slotEndTime,
            String slotDate,
            String slotType
    ) {
    }

    public record BookingReceivedRow(
            BookingBaseFields base,
            String serviceTitle,
            String payerName
    ) {
    }

    public record BookingDetailRow(
            BookingBaseFields base,
            String serviceTitle,
            String address,
            String serviceImages,
            String serviceDescription,
            String receiverName,
            String receiverPicture,
            String payerName,
            String payerPicture,
            String slotStartTime,
            String slotEndTime,
            String slotDate,
            String slotType
    ) {
    }
}
