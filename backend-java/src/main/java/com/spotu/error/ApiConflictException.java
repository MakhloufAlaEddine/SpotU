package com.spotu.error;

public final class ApiConflictException extends RuntimeException {

    private final String detail;

    public ApiConflictException(String detail) {
        super(detail);
        this.detail = detail;
    }

    public String getDetail() {
        return detail;
    }
}
