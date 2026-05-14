package com.spotu.modules.services.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.math.BigDecimal;
import java.util.List;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ServiceSavedDto(
        String serviceId,
        String title,
        BigDecimal price,
        List<Object> images,
        String address,
        String locationDescription,
        Integer durationMin,
        String savedAt,
        CoachSummaryDto coach,
        Double latitude,
        Double longitude,
        Integer availableSlots
) {
}
