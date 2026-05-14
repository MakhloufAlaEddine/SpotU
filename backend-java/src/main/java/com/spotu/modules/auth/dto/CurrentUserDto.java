package com.spotu.modules.auth.dto;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.List;

/**
 * Champs {@code USER_FIELDS} de {@code auth_utils.py} — sérialisation snake_case comme FastAPI.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonPropertyOrder({
        "user_id", "email", "name", "role", "language", "picture", "bio", "phone",
        "is_coach_verified", "coach_tags", "show_phone", "show_reviews",
        "created_at", "updated_at", "sports_level", "goals", "user_roles", "onboarding_done"
})
public record CurrentUserDto(
        String userId,
        String email,
        String name,
        String role,
        String language,
        String picture,
        String bio,
        String phone,
        Boolean isCoachVerified,
        List<String> coachTags,
        boolean showPhone,
        boolean showReviews,
        String createdAt,
        String updatedAt,
        String sportsLevel,
        List<Object> goals,
        List<Object> userRoles,
        Boolean onboardingDone
) {
}
