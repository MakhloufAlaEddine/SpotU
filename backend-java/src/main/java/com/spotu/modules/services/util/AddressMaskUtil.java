package com.spotu.modules.services.util;

import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class AddressMaskUtil {

    private static final Set<String> COUNTRY_NAMES = Set.of("france", "francia", "frankreich", "fr");
    private static final Pattern NUMBER_PREFIX = Pattern.compile("^\\d+\\s*(bis|ter|quater)?\\s*[,.]?\\s*", Pattern.CASE_INSENSITIVE);
    private static final Pattern POSTAL_CODE = Pattern.compile("^\\d{4,5}\\s+(.+)$");

    public String mask(String description, String precision) {
        if (description == null || description.isBlank() || "exact".equals(precision)) {
            return description;
        }
        if ("1000m".equals(precision)) {
            String[] parts = Arrays.stream(description.split(",")).map(String::trim).toArray(String[]::new);
            for (int i = parts.length - 1; i >= 0; i--) {
                String candidate = parts[i].trim();
                if (!candidate.isEmpty() && !COUNTRY_NAMES.contains(candidate.toLowerCase())) {
                    Matcher m = POSTAL_CODE.matcher(candidate);
                    return m.matches() ? m.group(1).trim() : candidate;
                }
            }
            return parts[parts.length - 1];
        }
        String streetPart = description.split(",")[0].trim();
        String masked = NUMBER_PREFIX.matcher(streetPart).replaceFirst("").trim();
        return masked.isEmpty() ? (streetPart.isEmpty() ? description : streetPart) : masked;
    }
}
