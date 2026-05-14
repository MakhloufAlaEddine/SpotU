package com.spotu.error;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorResponse(
        String code,
        Instant timestamp,
        int status,
        String error,
        String message,
        String path,
        Map<String, String> fieldErrors
) {
    public static ErrorResponse of(int status, String error, String message, String path) {
        return new ErrorResponse("INTERNAL_ERROR", Instant.now(), status, error, message, path, null);
    }

    public static ErrorResponse of(
            String code,
            int status,
            String error,
            String message,
            String path
    ) {
        return new ErrorResponse(code, Instant.now(), status, error, message, path, null);
    }
}
