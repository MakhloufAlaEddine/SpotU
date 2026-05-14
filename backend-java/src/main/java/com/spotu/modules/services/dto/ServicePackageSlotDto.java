package com.spotu.modules.services.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ServicePackageSlotDto(
        String slotId,
        String slotDate,
        String startTime,
        String endTime
) {
}
