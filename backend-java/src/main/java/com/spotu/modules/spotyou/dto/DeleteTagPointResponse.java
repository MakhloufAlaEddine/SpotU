package com.spotu.modules.spotyou.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;

@JsonPropertyOrder({
        "success",
        "deleted",
        "point_id",
        "conversations_marked",
        "images_queued",
        "members_notified",
        "media_purge_scheduled_at"
})
public record DeleteTagPointResponse(
        boolean success,
        boolean deleted,
        @JsonProperty("point_id") String pointId,
        @JsonProperty("conversations_marked") int conversationsMarked,
        @JsonProperty("images_queued") int imagesQueued,
        @JsonProperty("members_notified") int membersNotified,
        @JsonProperty("media_purge_scheduled_at") String mediaPurgeScheduledAt
) {
}

