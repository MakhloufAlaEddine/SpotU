package com.spotu.modules.services.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ServiceLocationDto(
        String locationId,
        String precision,
        String description,
        Double latitude,
        Double longitude,
        String originalDescription
) {
}
