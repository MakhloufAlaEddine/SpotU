package com.spotu.modules.bookings.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record BookingCreateRequestDto(
        String serviceId,
        String scheduledAt,
        String slotId,
        String locationId,
        String notes,
        String idempotencyKey,
        String paymentMode
) {
}
