package com.spotu.modules.marketplace.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.common.JsonbMedia;
import com.spotu.modules.marketplace.dto.MarketplaceProductsResponseDto;
import com.spotu.modules.marketplace.infra.MarketplaceProductsRepository;
import com.spotu.modules.marketplace.support.MarketplaceDistanceSupport;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.sql.Array;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;

@Service
public class MarketplaceProductsService {

    private static final String OWNER_LABEL = "Créateur du SpotYou";

    private final MarketplaceProductsRepository repository;
    private final ObjectMapper objectMapper;
    private final Executor marketplaceExecutor;

    public MarketplaceProductsService(
            MarketplaceProductsRepository repository,
            ObjectMapper objectMapper,
            @Qualifier("marketplaceExecutor") Executor marketplaceExecutor
    ) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.marketplaceExecutor = marketplaceExecutor;
    }

    public MarketplaceProductsResponseDto getProducts(
            String tagIds,
            String spotyouId,
            Double userLat,
            Double userLng
    ) {
        boolean filterRequested = hasText(tagIds) || hasText(spotyouId);
        List<String> tags = parseCsv(tagIds);
        String ownerId = null;
        Double spotyouLat = null;
        Double spotyouLng = null;

        if (hasText(spotyouId)) {
            var maybe = repository.findSpotYouContext(spotyouId);
            if (maybe.isPresent()) {
                MarketplaceProductsRepository.SpotYouContextRow ctx = maybe.get();
                ownerId = ctx.userId();
                spotyouLat = ctx.slat();
                spotyouLng = ctx.slng();
                if (tags.isEmpty()) {
                    tags = deserializeStringList(ctx.rawTagIds());
                }
            }
        }

        List<Map<String, Object>> products;
        List<Map<String, Object>> services;
        if (!tags.isEmpty()) {
            products = repository.findProductsByTags(tags, ownerId);
            services = repository.findServicesByTags(tags, ownerId);
        } else if (filterRequested) {
            products = List.of();
            services = List.of();
        } else {
            products = repository.findFeedProducts(20);
            services = List.of();
        }

        List<Map<String, Object>> enrichedProducts = new ArrayList<>();
        for (Map<String, Object> row : products) {
            Map<String, Object> p = new LinkedHashMap<>(row);
            normalizeSqlArrayField(p, "related_spotyou_ids");
            normalizeSqlArrayField(p, "pricing_modes");
            normalizeSqlArrayField(p, "delivery_modes");
            List<String> imgUrls = JsonbMedia.normalizeImageUrls(objectMapper, row.get("image_urls"), row.get("cover_image_url"));
            p.put("image_urls", imgUrls);
            if (!imgUrls.isEmpty()) {
                p.put("image_url", imgUrls.get(0));
            }
            p.put("tag_ids", deserializeStringList(JsonbMedia.unwrapToJsonString(objectMapper, row.get("tag_ids"))));
            p.put("item_type", "product");
            p.put("price", toDouble(row.get("price")));
            boolean isPhysical = row.get("lat") != null && row.get("lng") != null;
            p.put("is_physical", isPhysical);
            applyProductDistance(p, isPhysical, row, spotyouLat, spotyouLng, userLat, userLng);
            applyProductBadge(p, ownerId);
            enrichedProducts.add(p);
        }

        List<Map<String, Object>> enrichedServices = new ArrayList<>();
        for (Map<String, Object> row : services) {
            Map<String, Object> s = new LinkedHashMap<>(row);
            s.put("item_type", "service");
            s.put("price", toDouble(row.get("price")));
            s.put("is_physical", false);
            s.put("images", new ArrayList<>(JsonbMedia.normalizeImageUrls(objectMapper, s.get("images"), null)));
            s.put("tag_ids", deserializeStringList(JsonbMedia.unwrapToJsonString(objectMapper, s.get("tag_ids"))));
            applyServiceBadge(s, ownerId);
            enrichedServices.add(s);
        }

        List<Map<String, Object>> allItems = new ArrayList<>(enrichedProducts.size() + enrichedServices.size());
        allItems.addAll(enrichedProducts);
        allItems.addAll(enrichedServices);

        List<Map<String, Object>> ownerItems = new ArrayList<>();
        List<Map<String, Object>> otherItems = new ArrayList<>();
        for (Map<String, Object> item : allItems) {
            if ("owner".equals(item.get("badge_type"))) {
                ownerItems.add(item);
            } else {
                otherItems.add(item);
            }
        }
        List<Map<String, Object>> ordered = new ArrayList<>(ownerItems.size() + otherItems.size());
        ordered.addAll(ownerItems);
        ordered.addAll(otherItems);

        attachSellerStats(ordered);
        return new MarketplaceProductsResponseDto(ordered, ordered.size());
    }

    private void attachSellerStats(List<Map<String, Object>> items) {
        Set<String> sellerIds = new LinkedHashSet<>();
        for (Map<String, Object> item : items) {
            String sid = asString(item.get("seller_id"));
            if (!hasText(sid)) {
                sid = asString(item.get("coach_id"));
            }
            if (hasText(sid)) {
                sellerIds.add(sid);
            }
        }
        if (sellerIds.isEmpty()) {
            return;
        }
        List<String> ids = new ArrayList<>(sellerIds);
        CompletableFuture<Map<String, MarketplaceProductsRepository.RatingRow>> ratingsF =
                CompletableFuture.supplyAsync(() -> repository.findRatings(ids), marketplaceExecutor);
        CompletableFuture<Map<String, Integer>> prodF =
                CompletableFuture.supplyAsync(() -> repository.countProductsBySeller(ids), marketplaceExecutor);
        CompletableFuture<Map<String, Integer>> svcF =
                CompletableFuture.supplyAsync(() -> repository.countActiveServicesByCoach(ids), marketplaceExecutor);
        CompletableFuture<Map<String, Integer>> spotF =
                CompletableFuture.supplyAsync(() -> repository.countSpotYouByUser(ids), marketplaceExecutor);
        CompletableFuture.allOf(ratingsF, prodF, svcF, spotF).join();

        Map<String, MarketplaceProductsRepository.RatingRow> ratings = ratingsF.join();
        Map<String, Integer> products = prodF.join();
        Map<String, Integer> services = svcF.join();
        Map<String, Integer> spotyou = spotF.join();
        for (Map<String, Object> item : items) {
            String sid = asString(item.get("seller_id"));
            if (!hasText(sid)) {
                sid = asString(item.get("coach_id"));
            }
            MarketplaceProductsRepository.RatingRow rating = sid == null ? null : ratings.get(sid);
            Map<String, Object> stats = new LinkedHashMap<>();
            stats.put("rating_avg", rating == null ? null : rating.avg());
            stats.put("rating_count", rating == null ? 0 : rating.count());
            stats.put("products_count", sid == null ? 0 : products.getOrDefault(sid, 0));
            stats.put("services_count", sid == null ? 0 : services.getOrDefault(sid, 0));
            stats.put("spotyou_count", sid == null ? 0 : spotyou.getOrDefault(sid, 0));
            item.put("seller_stats", stats);
        }
    }

    private void applyProductDistance(
            Map<String, Object> target,
            boolean isPhysical,
            Map<String, Object> source,
            Double spotyouLat,
            Double spotyouLng,
            Double userLat,
            Double userLng
    ) {
        if (!isPhysical) {
            return;
        }
        Double lat = toDouble(source.get("lat"));
        Double lng = toDouble(source.get("lng"));
        if (lat == null || lng == null) {
            return;
        }
        if (spotyouLat != null && spotyouLng != null) {
            double km = MarketplaceDistanceSupport.haversineKm(lat, lng, spotyouLat, spotyouLng);
            target.put("dist_from_spotyou", km);
            target.put("dist_from_spotyou_fmt", MarketplaceDistanceSupport.fmtDist(km));
        }
        if (userLat != null && userLng != null) {
            double km = MarketplaceDistanceSupport.haversineKm(lat, lng, userLat, userLng);
            target.put("dist_from_user", km);
            target.put("dist_from_user_fmt", MarketplaceDistanceSupport.fmtDist(km));
        }
    }

    private void applyProductBadge(Map<String, Object> target, String ownerId) {
        String sellerId = asString(target.get("seller_id"));
        if (hasText(ownerId) && Objects.equals(ownerId, sellerId)) {
            target.put("badge_type", "owner");
            target.put("badge_label", OWNER_LABEL);
            return;
        }
        target.put("badge_type", "other");
        String sellerName = asString(target.get("seller_name"));
        target.put("badge_label", hasText(sellerName) ? sellerName : "SpotU");
    }

    private void applyServiceBadge(Map<String, Object> target, String ownerId) {
        String coachId = asString(target.get("coach_id"));
        if (hasText(ownerId) && Objects.equals(ownerId, coachId)) {
            target.put("badge_type", "owner");
            target.put("badge_label", OWNER_LABEL);
            return;
        }
        target.put("badge_type", "other");
        String coachName = asString(target.get("coach_name"));
        target.put("badge_label", hasText(coachName) ? coachName : "Coach");
    }

    private List<String> parseCsv(String raw) {
        if (!hasText(raw)) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (String part : raw.split(",")) {
            String t = part == null ? "" : part.trim();
            if (!t.isEmpty()) {
                out.add(t);
            }
        }
        return out;
    }

    private List<String> deserializeStringList(Object raw) {
        if (raw == null) {
            return List.of();
        }
        if (raw instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        if (raw instanceof String s) {
            if (s.isBlank()) {
                return List.of();
            }
            try {
                return objectMapper.readValue(s, new TypeReference<List<String>>() {
                });
            } catch (Exception ignored) {
                return List.of();
            }
        }
        // PostgreSQL JSON/JSONB peut arriver sous type objet JDBC (ex: PGobject).
        // On tente une désérialisation via toString() avant d'abandonner.
        try {
            String asText = String.valueOf(raw);
            if (asText.isBlank()) {
                return List.of();
            }
            return objectMapper.readValue(asText, new TypeReference<List<String>>() {
            });
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private List<Object> deserializeStringListOrObjectList(Object raw) {
        if (raw == null) {
            return List.of();
        }
        if (raw instanceof List<?> list) {
            return new ArrayList<>(list);
        }
        if (raw instanceof String s) {
            if (s.isBlank()) {
                return List.of();
            }
            try {
                return objectMapper.readValue(s, new TypeReference<List<Object>>() {
                });
            } catch (Exception ignored) {
                return List.of();
            }
        }
        return List.of();
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static Double toDouble(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof BigDecimal bd) {
            return bd.doubleValue();
        }
        if (value instanceof Number n) {
            return n.doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(value));
        } catch (Exception ignored) {
            return null;
        }
    }

    private void normalizeSqlArrayField(Map<String, Object> target, String key) {
        Object raw = target.get(key);
        if (!(raw instanceof Array sqlArray)) {
            return;
        }
        try {
            Object arr = sqlArray.getArray();
            if (arr instanceof Object[] values) {
                List<String> out = new ArrayList<>(values.length);
                for (Object v : values) {
                    if (v != null) {
                        out.add(String.valueOf(v));
                    }
                }
                target.put(key, out);
                return;
            }
        } catch (Exception ignored) {
            // fallback below
        }
        target.put(key, deserializeStringList(String.valueOf(raw)));
    }
}
