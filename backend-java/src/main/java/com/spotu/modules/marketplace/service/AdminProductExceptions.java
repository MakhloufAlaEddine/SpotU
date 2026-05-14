package com.spotu.modules.marketplace.service;

public final class AdminProductExceptions {

    private AdminProductExceptions() {
    }

    public static final class AdminProductNotFoundError extends RuntimeException {
        public AdminProductNotFoundError(String message) {
            super(message);
        }
    }
}
