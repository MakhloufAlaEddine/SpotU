package com.spotu.modules.users.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record FollowerItemDto(
        String userId,
        String name,
        String picture,
        String role,
        boolean isFollowingBack,
        boolean isBlocked
) {
}
