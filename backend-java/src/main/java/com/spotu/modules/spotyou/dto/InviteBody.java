package com.spotu.modules.spotyou.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record InviteBody(@JsonProperty("invited_user_id") String invitedUserId) {
}
