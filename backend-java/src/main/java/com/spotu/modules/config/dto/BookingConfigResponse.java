package com.spotu.modules.config.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;

/**
 * Réponse alignée sur {@code public_booking_config} (server.py).
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonPropertyOrder({
        "enable_manual_approval_for_services",
        "enable_pay_later_for_services",
        "pay_now_checkout_minutes"
})
public record BookingConfigResponse(
        boolean enableManualApprovalForServices,
        boolean enablePayLaterForServices,
        int payNowCheckoutMinutes
) {
}
