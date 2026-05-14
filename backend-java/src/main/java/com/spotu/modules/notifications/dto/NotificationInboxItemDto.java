package com.spotu.modules.notifications.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record NotificationInboxItemDto(
        String id,
        String type,
        String title,
        String body,
        Map<String, Object> data,
        boolean read,
        @JsonProperty("created_at")
        String createdAt
) {
}
