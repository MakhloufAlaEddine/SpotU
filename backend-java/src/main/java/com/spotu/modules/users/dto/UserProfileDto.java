package com.spotu.modules.users.dto;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import com.spotu.modules.auth.dto.CurrentUserDto;

import java.util.List;

/**
 * Réponse de GET /api/users/me : champs de /api/auth/me + rating + données bancaires.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonPropertyOrder({
        "user_id", "email", "name", "role", "language", "picture", "bio", "phone",
        "is_coach_verified", "coach_tags", "show_phone", "show_reviews",
        "created_at", "updated_at", "sports_level", "goals", "user_roles", "onboarding_done",
        "avg_rating", "review_count", "iban", "bic", "iban_name"
})
public record UserProfileDto(
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
        Boolean onboardingDone,
        Double avgRating,
        int reviewCount,
        String iban,
        String bic,
        String ibanName
) {
    public static UserProfileDto fromCurrentUser(
            CurrentUserDto currentUser,
            Double avgRating,
            int reviewCount,
            String iban,
            String bic,
            String ibanName
    ) {
        return new UserProfileDto(
                currentUser.userId(),
                currentUser.email(),
                currentUser.name(),
                currentUser.role(),
                currentUser.language(),
                currentUser.picture(),
                currentUser.bio(),
                currentUser.phone(),
                currentUser.isCoachVerified(),
                currentUser.coachTags(),
                currentUser.showPhone(),
                currentUser.showReviews(),
                currentUser.createdAt(),
                currentUser.updatedAt(),
                currentUser.sportsLevel(),
                currentUser.goals(),
                currentUser.userRoles(),
                currentUser.onboardingDone(),
                avgRating,
                reviewCount,
                iban,
                bic,
                ibanName
        );
    }
}
