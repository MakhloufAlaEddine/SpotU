package com.spotu.error;

public final class ApiBadRequestException extends RuntimeException {

    private final String detail;

    public ApiBadRequestException(String detail) {
        super(detail);
        this.detail = detail;
    }

    public String getDetail() {
        return detail;
    }
}
