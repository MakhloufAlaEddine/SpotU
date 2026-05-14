package com.spotu.modules.users.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record UserReviewItemDto(
        String reviewId,
        int rating,
        String comment,
        String createdAt,
        String reviewerId,
        String reviewerName,
        String reviewerPicture
) {
}
