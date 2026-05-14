package com.spotu.error;

public final class ApiForbiddenException extends RuntimeException {

    private final String detail;

    public ApiForbiddenException(String detail) {
        super(detail);
        this.detail = detail;
    }

    public String getDetail() {
        return detail;
    }
}
