package com.spotu.modules.referential.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record DomainDto(
        String domainId,
        String name,
        String labelFr,
        String labelEn,
        String icon,
        String color,
        Boolean active,
        String createdAt
) {
}
