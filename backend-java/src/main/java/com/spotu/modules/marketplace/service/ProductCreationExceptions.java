package com.spotu.modules.marketplace.service;

import java.util.List;

public final class ProductCreationExceptions {

    private ProductCreationExceptions() {
    }

    public static final class ProductBadRequestError extends RuntimeException {
        public ProductBadRequestError(String message) {
            super(message);
        }
    }

    public static final class ProductNotFoundError extends RuntimeException {
        public ProductNotFoundError(String message) {
            super(message);
        }
    }

    public static final class ProductDeleteNotFoundError extends RuntimeException {
        public ProductDeleteNotFoundError(String message) {
            super(message);
        }
    }

    public static final class ProductValidation422Error extends RuntimeException {
        private final List<String> details;

        public ProductValidation422Error(List<String> details) {
            super(details == null || details.isEmpty() ? "Validation error" : details.get(0));
            this.details = details == null ? List.of() : details;
        }

        public List<String> details() {
            return details;
        }
    }
}
