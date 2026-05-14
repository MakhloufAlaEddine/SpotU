package com.spotu.modules.services.service;

import java.util.List;
import java.util.Map;

public final class ServiceWriteExceptions {

    private ServiceWriteExceptions() {
    }

    public static final class ServiceValidation422Error extends RuntimeException {
        private final List<Map<String, Object>> detail;

        public ServiceValidation422Error(List<Map<String, Object>> detail) {
            super("Validation failed");
            this.detail = detail;
        }

        public List<Map<String, Object>> detail() {
            return detail;
        }
    }
}
