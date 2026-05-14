package com.spotu.modules.subscriptions.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Body {@code POST /api/subscriptions/subscribe} (équivalent FastAPI).
 */
public record SubscribeRequest(
        @JsonProperty("plan_id") String planId,
        @JsonProperty("origin_url") String originUrl
) {
}
