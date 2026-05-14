package com.spotu.modules.bookings.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record BookingAcceptResponseDto(
        boolean success,
        String status,
        String bookingId,
        String paymentMode,
        Boolean paymentCaptured,
        String payExpiryInterval,
        Boolean idempotent
) {
}
