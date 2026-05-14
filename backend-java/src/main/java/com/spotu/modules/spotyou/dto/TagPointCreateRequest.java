package com.spotu.modules.spotyou.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;

/**
 * Corps aligné sur {@code TagPointCreate} (models.py).
 */
public record TagPointCreateRequest(
        @NotBlank String title,
        String description,
        @NotNull Double latitude,
        @NotNull Double longitude,
        String precision,
        @NotNull List<String> tag_ids,
        @NotBlank String domain_id,
        Integer expires_hours,
        String event_date,
        String event_end_date,
        Map<String, Object> event_schedule,
        List<String> images,
        Integer minimum_participants,
        Integer maximum_participants,
        String address,
        String visibility_type,
        String join_mode,
        @JsonProperty("invite_permissions") String invitePermissions,
        Integer max_community_members
) {
}
