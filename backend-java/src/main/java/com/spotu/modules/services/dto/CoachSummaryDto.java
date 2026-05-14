package com.spotu.modules.services.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record CoachSummaryDto(
        String userId,
        String name,
        String picture,
        Boolean isCoachVerified
) {
}
