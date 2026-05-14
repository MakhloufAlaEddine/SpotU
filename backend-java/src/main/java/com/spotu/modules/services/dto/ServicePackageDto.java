package com.spotu.modules.services.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.math.BigDecimal;
import java.util.List;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ServicePackageDto(
        String packageId,
        String typeId,
        String typeLabel,
        Integer durationMin,
        Integer maxParticipants,
        BigDecimal price,
        List<ServicePackageSlotDto> slots
) {
}
