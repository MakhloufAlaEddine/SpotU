package com.spotu.modules.users.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record FollowingItemDto(
        String userId,
        String name,
        String picture,
        String role,
        boolean followsBack,
        boolean isBlocked
) {
}
