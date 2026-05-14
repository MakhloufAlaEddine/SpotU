package com.spotu.modules.referential.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.List;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record TagCategoryDto(
        String categoryId,
        String domainId,
        String entityType,
        String name,
        String labelFr,
        String labelEn,
        String icon,
        Boolean active,
        String createdAt,
        List<TagDto> tags
) {
}
