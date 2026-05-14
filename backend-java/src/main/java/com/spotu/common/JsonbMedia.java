package com.spotu.common;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Normalise les colonnes PostgreSQL {@code jsonb} renvoyées par JDBC ({@code PGobject}, map Jackson, etc.)
 * en tableaux d’URL exploitables par le frontend.
 */
public final class JsonbMedia {

    private JsonbMedia() {
    }

    public static Object unwrapPostgresJson(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof Map<?, ?> map) {
            Object v = map.get("value");
            Object t = map.get("type");
            if (v instanceof String
                    && ("jsonb".equals(String.valueOf(t)) || "json".equals(String.valueOf(t)))) {
                return v;
            }
        }
        if ("org.postgresql.util.PGobject".equals(raw.getClass().getName())) {
            try {
                Method getValue = raw.getClass().getMethod("getValue");
                return getValue.invoke(raw);
            } catch (ReflectiveOperationException ignored) {
                return raw;
            }
        }
        return raw;
    }

    /**
     * Chaîne JSON (ex. {@code ["https://..."]}) pour parsers existants basés sur {@link String},
     * ou {@code null}.
     */
    public static String unwrapToJsonString(ObjectMapper objectMapper, Object raw) {
        if (raw == null) {
            return null;
        }
        Object u = unwrapPostgresJson(raw);
        if (u == null) {
            return null;
        }
        if (u instanceof String s) {
            return s.isBlank() ? null : s;
        }
        if (u instanceof List<?> || u instanceof Map<?, ?>) {
            try {
                return objectMapper.writeValueAsString(u);
            } catch (JsonProcessingException e) {
                return null;
            }
        }
        return String.valueOf(u);
    }

    public static List<String> normalizeImageUrls(ObjectMapper objectMapper, Object imagesRaw, Object imageUrlFallback) {
        List<String> urls = new ArrayList<>(extractImageUrlStrings(objectMapper, imagesRaw));
        if (urls.isEmpty() && imageUrlFallback != null) {
            String s = String.valueOf(imageUrlFallback).trim();
            if (!s.isEmpty()) {
                urls.add(s);
            }
        }
        return urls;
    }

    /**
     * Pour les DTO JSON ({@code List<Object> images}) : uniquement des chaînes URL exploitables par le front.
     * Gère {@code ["https://..."]}, {@code [{"url":"..."}]}, jsonb JDBC, chaînes JSON éventuellement quotées deux fois.
     */
    public static List<Object> parseImagesListForApi(ObjectMapper objectMapper, Object imagesRaw) {
        return new ArrayList<>(extractImageUrlStrings(objectMapper, imagesRaw));
    }

    public static String firstImageUrl(ObjectMapper objectMapper, Object imagesRaw, Object imageUrlFallback) {
        List<String> u = normalizeImageUrls(objectMapper, imagesRaw, imageUrlFallback);
        return u.isEmpty() ? "" : u.get(0);
    }

    private static List<String> extractImageUrlStrings(ObjectMapper objectMapper, Object raw) {
        Object u = unwrapPostgresJson(raw);
        if (u == null) {
            return List.of();
        }
        if (u instanceof String s) {
            return extractFromJsonString(objectMapper, s.trim());
        }
        if (u instanceof List<?> list) {
            List<String> out = new ArrayList<>();
            for (Object o : list) {
                String url = urlFromElement(objectMapper, o);
                if (url != null && !url.isEmpty()) {
                    out.add(url);
                }
            }
            return out;
        }
        if (u instanceof Map<?, ?> map) {
            String one = urlFromMap(map);
            return one == null || one.isEmpty() ? List.of() : List.of(one);
        }
        return List.of();
    }

    private static List<String> extractFromJsonString(ObjectMapper objectMapper, String s) {
        if (s.isEmpty()) {
            return List.of();
        }
        if (looksLikeHttpUrl(s)) {
            return List.of(s);
        }
        try {
            List<Object> v = objectMapper.readValue(s, new TypeReference<>() {
            });
            List<String> out = new ArrayList<>();
            for (Object o : v) {
                String url = urlFromElement(objectMapper, o);
                if (url != null && !url.isEmpty()) {
                    out.add(url);
                }
            }
            if (!out.isEmpty()) {
                return out;
            }
        } catch (Exception ignored) {
            // fall through: double-encoded JSON string
        }
        try {
            String inner = objectMapper.readValue(s, String.class);
            if (inner != null && !inner.equals(s)) {
                return extractFromJsonString(objectMapper, inner.trim());
            }
        } catch (Exception ignored) {
        }
        return List.of();
    }

    private static String urlFromElement(ObjectMapper objectMapper, Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof String str) {
            str = str.trim();
            return str.isEmpty() ? null : str;
        }
        if (o instanceof Map<?, ?> m) {
            return urlFromMap(m);
        }
        if (o instanceof List<?> list && list.size() == 1) {
            return urlFromElement(objectMapper, list.get(0));
        }
        return null;
    }

    private static String urlFromMap(Map<?, ?> m) {
        Object v = m.get("url");
        if (v == null) {
            v = m.get("uri");
        }
        if (v == null) {
            v = m.get("image_url");
        }
        if (v == null) {
            v = m.get("src");
        }
        if (v instanceof String s && !s.isBlank()) {
            return s.trim();
        }
        return null;
    }

    private static boolean looksLikeHttpUrl(String s) {
        String t = s.toLowerCase();
        return t.startsWith("http://") || t.startsWith("https://");
    }
}
