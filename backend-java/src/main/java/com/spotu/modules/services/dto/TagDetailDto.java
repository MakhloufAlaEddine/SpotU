package com.spotu.modules.services.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record TagDetailDto(
        String tagId,
        String labelFr,
        String labelEn,
        String categoryId
) {
}
