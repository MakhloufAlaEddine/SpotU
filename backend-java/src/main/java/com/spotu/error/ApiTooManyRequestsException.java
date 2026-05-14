package com.spotu.error;

public final class ApiTooManyRequestsException extends RuntimeException {

    private final String detail;

    public ApiTooManyRequestsException(String detail) {
        super(detail);
        this.detail = detail;
    }

    public String getDetail() {
        return detail;
    }
}
