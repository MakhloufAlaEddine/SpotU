package com.spotu.modules.spotyou.support;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Équivalent de {@code _mask_address} dans {@code service_routes.py} (Python).
 */
public final class AddressMasker {

    private static final Set<String> COUNTRY_NAMES = Set.of(
            "france", "francia", "frankreich", "fr"
    );

    private static final Pattern LEADING_NUMBER = Pattern.compile(
            "^\\d+\\s*(bis|ter|quater)?\\s*[,.]?\\s*",
            Pattern.CASE_INSENSITIVE
    );

    private static final Pattern POSTAL_CITY = Pattern.compile("^\\d{4,5}\\s+(.+)$");
    private static final Pattern POSTAL_TAIL = Pattern.compile("\\b\\d{5}\\s+(.+)$");

    private AddressMasker() {
    }

    public static String maskAddress(String description, String precision) {
        if (description == null || description.isBlank() || "exact".equals(precision) || precision == null) {
            return description;
        }
        if ("1000m".equals(precision)) {
            List<String> parts = List.of(description.split(","));
            if (parts.size() >= 2) {
                for (int i = parts.size() - 1; i >= 0; i--) {
                    String candidate = parts.get(i).trim();
                    if (candidate.isEmpty()) {
                        continue;
                    }
                    if (COUNTRY_NAMES.contains(candidate.toLowerCase(Locale.ROOT))) {
                        continue;
                    }
                    Matcher m = POSTAL_CITY.matcher(candidate);
                    if (m.matches()) {
                        return m.group(1).trim();
                    }
                    return candidate;
                }
                return parts.get(parts.size() - 1).trim();
            }
            Matcher m = POSTAL_TAIL.matcher(description);
            if (m.find()) {
                return m.group(1).trim();
            }
            return description;
        }
        // 100m
        String streetPart = description.split(",")[0].trim();
        String masked = LEADING_NUMBER.matcher(streetPart).replaceFirst("").trim();
        if (masked.isBlank()) {
            masked = streetPart;
        }
        return masked.isBlank() ? description : masked;
    }
}
