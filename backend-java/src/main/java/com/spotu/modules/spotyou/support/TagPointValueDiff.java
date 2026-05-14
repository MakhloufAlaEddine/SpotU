package com.spotu.modules.spotyou.support;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

/**
 * Équivalent de {@code _vals_equal} dans {@code update_tag_point} (tagpoint_routes.py l.1874–1894).
 */
public final class TagPointValueDiff {

    private TagPointValueDiff() {
    }

    public static boolean valsEqual(Object newVal, Object oldVal, ObjectMapper objectMapper) {
        if (newVal == null && oldVal == null) {
            return true;
        }
        if (newVal == null || oldVal == null) {
            return false;
        }
        if (oldVal instanceof java.sql.Timestamp || oldVal instanceof java.time.temporal.Temporal) {
            try {
                Instant oi = toInstant(oldVal);
                Instant ni = toInstant(newVal);
                if (ni == null && newVal instanceof String s && !s.isBlank()) {
                    ni = OffsetDateTime.parse(s).toInstant();
                }
                if (oi != null && ni != null) {
                    return oi.equals(ni);
                }
            } catch (Exception ignored) {
                // fallback string
            }
            return String.valueOf(newVal).equals(String.valueOf(oldVal));
        }
        if (newVal instanceof Number n1 && (oldVal instanceof Number || oldVal instanceof BigDecimal)) {
            double a = n1.doubleValue();
            double b = oldVal instanceof BigDecimal bd ? bd.doubleValue() : ((Number) oldVal).doubleValue();
            return Math.abs(a - b) < 1e-7;
        }
        if (newVal instanceof List<?> || newVal instanceof Map<?, ?>
                || oldVal instanceof List<?> || oldVal instanceof Map<?, ?>) {
            try {
                ObjectMapper sorted = objectMapper.copy()
                        .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);
                JsonNode jn = sorted.readTree(sorted.writeValueAsString(newVal));
                JsonNode jo = sorted.readTree(sorted.writeValueAsString(normalizeJsonOld(oldVal, objectMapper)));
                return jn.equals(jo);
            } catch (Exception e) {
                return String.valueOf(newVal).equals(String.valueOf(oldVal));
            }
        }
        return String.valueOf(newVal).equals(String.valueOf(oldVal));
    }

    private static Object normalizeJsonOld(Object oldVal, ObjectMapper om) throws Exception {
        if (oldVal instanceof String s && (s.startsWith("[") || s.startsWith("{"))) {
            return om.readValue(s, new TypeReference<Object>() {
            });
        }
        return oldVal;
    }

    private static Instant toInstant(Object v) {
        if (v instanceof java.sql.Timestamp ts) {
            return ts.toInstant();
        }
        if (v instanceof OffsetDateTime odt) {
            return odt.toInstant();
        }
        if (v instanceof java.time.LocalDateTime ldt) {
            return ldt.atOffset(ZoneOffset.UTC).toInstant();
        }
        if (v instanceof java.sql.Date d) {
            return d.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant();
        }
        if (v instanceof java.time.LocalDate ld) {
            return ld.atStartOfDay(ZoneOffset.UTC).toInstant();
        }
        if (v instanceof String s) {
            return OffsetDateTime.parse(s).toInstant();
        }
        return null;
    }
}
