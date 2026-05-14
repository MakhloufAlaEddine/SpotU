package com.spotu.modules.users.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.math.BigDecimal;
import java.util.List;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ServiceSummaryDto(
        String serviceId,
        String title,
        String description,
        BigDecimal price,
        Integer durationMin,
        String locationDescription,
        Integer maxParticipants,
        List<Object> tagIds,
        String domainId,
        List<Object> images
) {
}
