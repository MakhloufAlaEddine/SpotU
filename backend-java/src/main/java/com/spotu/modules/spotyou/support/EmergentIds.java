package com.spotu.modules.spotyou.support;

import java.util.UUID;

/**
 * Équivalent de {@code new_id(prefix)} dans {@code models.py} (suffix 12 hex).
 */
public final class EmergentIds {

    private EmergentIds() {
    }

    public static String newId(String prefix) {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        return prefix == null || prefix.isBlank() ? suffix : prefix + "_" + suffix;
    }
}
