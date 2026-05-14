package com.spotu.modules.bookings.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.math.BigDecimal;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record BookingReceivedDto(
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
        String paymentMode,
        String serviceTitle,
        String payerName
) {
}
