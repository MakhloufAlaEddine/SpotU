package com.spotu.modules.users.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record InterestDto(
        String tagId,
        String labelFr,
        String labelEn,
        String icon
) {
}
