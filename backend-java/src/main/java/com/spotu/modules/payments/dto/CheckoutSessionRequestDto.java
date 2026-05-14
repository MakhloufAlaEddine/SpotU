package com.spotu.modules.payments.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record CheckoutSessionRequestDto(
        String bookingId,
        String originUrl
) {
}
