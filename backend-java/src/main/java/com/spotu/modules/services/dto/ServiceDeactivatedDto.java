package com.spotu.modules.services.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.math.BigDecimal;
import java.util.List;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ServiceDeactivatedDto(
        String serviceId,
        String coachId,
        String title,
        String description,
        String address,
        BigDecimal price,
        Integer durationMin,
        List<String> tagIds,
        String domainId,
        String locationDescription,
        Integer maxParticipants,
        Boolean active,
        List<Object> images,
        String createdAt,
        String updatedAt,
        String bookingApprovalMode,
        Boolean allowPayLater,
        Integer payLaterExpirationMinutes,
        String deletedAt,
        String mediaPurgeScheduledAt,
        Boolean mediaPurged,
        String reactivatedAt,
        Integer daysUntilMediaPurge
) {
}
