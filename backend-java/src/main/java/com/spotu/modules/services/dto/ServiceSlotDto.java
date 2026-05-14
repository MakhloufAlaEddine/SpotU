package com.spotu.modules.services.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.List;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ServiceSlotDto(
        String slotId,
        String slotType,
        String slotStatus,
        String locationId,
        String packageId,
        Integer dayOfWeek,
        List<Integer> daysOfWeek,
        String startTime,
        String endTime,
        String slotDate
) {
}
