package com.spotu.modules.spotyou.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.common.JsonbMedia;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * Équivalents de {@code _first_image}, {@code build_point_response}, {@code apply_precision_offset}
 * dans {@code tagpoint_routes.py} (Python).
 */
public final class TagPointResponseBuilder {

    private TagPointResponseBuilder() {
    }

    public static String firstImage(ObjectMapper objectMapper, Object imagesRaw) {
        return firstImage(objectMapper, imagesRaw, null);
    }

    public static String firstImage(ObjectMapper objectMapper, Object imagesRaw, Object imageUrlFallback) {
        return JsonbMedia.firstImageUrl(objectMapper, imagesRaw, imageUrlFallback);
    }

    /**
     * @param seed si non null, décalage déterministe (Python : random.seed(hash(seed))).
     *             La recherche Python n’envoie pas de seed → aléatoire à chaque appel.
     */
    public static double[] applyPrecisionOffset(double lat, double lng, String precision, String seed) {
        if ("exact".equals(precision) || precision == null) {
            return new double[]{lat, lng};
        }
        int radiusM;
        if ("100m".equals(precision)) {
            radiusM = 100;
        } else if ("1000m".equals(precision)) {
            radiusM = 1000;
        } else {
            return new double[]{lat, lng};
        }
        Random rng = seed != null ? new Random(seed.hashCode()) : new Random();
        double angle = rng.nextDouble() * 2 * Math.PI;
        double distance = radiusM * Math.sqrt(rng.nextDouble());
        double latOffset = (distance * Math.cos(angle)) / 111320.0;
        double lngOffset = (distance * Math.sin(angle)) / (111320.0 * Math.cos(Math.toRadians(lat)));
        return new double[]{lat + latOffset, lng + lngOffset};
    }

    public static Map<String, Object> buildPointResponse(Map<String, Object> row, boolean isOwner, ObjectMapper objectMapper) {
        Map<String, Object> d = new LinkedHashMap<>(row);
        List<String> imgs = JsonbMedia.normalizeImageUrls(objectMapper, d.get("images"), d.get("image_url"));
        d.put("images", new ArrayList<>(imgs));
        if (!imgs.isEmpty()) {
            d.put("image_url", imgs.get(0));
        }
        Object latObj = d.remove("latitude");
        Object lngObj = d.remove("longitude");
        Double lat = asDouble(latObj);
        Double lng = asDouble(lngObj);
        if (lat != null && lng != null) {
            d.put("location", Map.of("type", "Point", "coordinates", List.of(lng, lat)));
            d.put("latitude", lat);
            d.put("longitude", lng);
        }
        Object ownerName = d.remove("owner_name");
        Object ownerPicture = d.remove("owner_picture");
        Object ownerRole = d.remove("owner_role");
        if (ownerName != null) {
            Map<String, Object> owner = new LinkedHashMap<>();
            owner.put("user_id", d.get("user_id"));
            owner.put("name", ownerName);
            owner.put("picture", ownerPicture);
            owner.put("role", ownerRole);
            d.put("owner", owner);
        }
        String precision = d.get("precision") == null ? "exact" : String.valueOf(d.get("precision"));
        Object originalAddress = d.get("address");
        if (originalAddress != null && !String.valueOf(originalAddress).isBlank() && !"exact".equals(precision)) {
            d.put("address", AddressMasker.maskAddress(String.valueOf(originalAddress), precision));
            if (isOwner) {
                d.put("original_address", originalAddress);
            }
        }
        d.put("is_owner", isOwner);
        return d;
    }

    private static Double asDouble(Object v) {
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        if (v == null) {
            return null;
        }
        try {
            return Double.parseDouble(String.valueOf(v));
        } catch (Exception e) {
            return null;
        }
    }
}
