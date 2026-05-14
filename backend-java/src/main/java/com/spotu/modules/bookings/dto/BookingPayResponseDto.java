package com.spotu.modules.bookings.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;

@JsonPropertyOrder({"url", "checkout_url", "session_id", "reused"})
public record BookingPayResponseDto(
        String url,
        @JsonProperty("checkout_url") String checkoutUrl,
        @JsonProperty("session_id") String sessionId,
        @JsonInclude(JsonInclude.Include.NON_NULL) Boolean reused
) {
}
