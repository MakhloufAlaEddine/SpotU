package com.spotu.error;

public final class ApiGoneException extends RuntimeException {

    private final String detail;

    public ApiGoneException(String detail) {
        super(detail);
        this.detail = detail;
    }

    public String getDetail() {
        return detail;
    }
}
