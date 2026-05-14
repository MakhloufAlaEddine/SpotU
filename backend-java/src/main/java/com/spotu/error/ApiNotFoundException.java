package com.spotu.error;

public final class ApiNotFoundException extends RuntimeException {

    private final String detail;

    public ApiNotFoundException(String detail) {
        super(detail);
        this.detail = detail;
    }

    public String getDetail() {
        return detail;
    }
}
