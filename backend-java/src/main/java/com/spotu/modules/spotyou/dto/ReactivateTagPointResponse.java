package com.spotu.modules.spotyou.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;

@JsonPropertyOrder({
        "success",
        "reactivated",
        "point_id",
        "media_purged",
        "requires_media_reupload",
        "pending_deletions_cancelled"
})
public record ReactivateTagPointResponse(
        boolean success,
        boolean reactivated,
        @JsonProperty("point_id") String pointId,
        @JsonProperty("media_purged") boolean mediaPurged,
        @JsonProperty("requires_media_reupload") boolean requiresMediaReupload,
        @JsonProperty("pending_deletions_cancelled") int pendingDeletionsCancelled
) {
}

