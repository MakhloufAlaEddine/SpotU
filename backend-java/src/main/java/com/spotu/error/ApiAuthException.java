package com.spotu.error;

/**
 * Erreur d’authentification alignée sur FastAPI {@code HTTPException(401, detail=...)}.
 */
public final class ApiAuthException extends RuntimeException {

    private final String detail;

    public ApiAuthException(String detail) {
        super(detail);
        this.detail = detail;
    }

    public String getDetail() {
        return detail;
    }
}
