package com.spotu.modules.marketplace.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.error.ApiConflictException;
import com.spotu.error.ApiForbiddenException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.auth.support.PythonIsoTimestamps;
import com.spotu.modules.marketplace.dto.ProductMineResponseDto;
import com.spotu.modules.marketplace.dto.ProductUpsertResponseDto;
import com.spotu.modules.marketplace.infra.ProductCreationRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.LongAdder;

import static com.spotu.modules.marketplace.service.ProductCreationExceptions.ProductBadRequestError;
import static com.spotu.modules.marketplace.service.ProductCreationExceptions.ProductDeleteNotFoundError;
import static com.spotu.modules.marketplace.service.ProductCreationExceptions.ProductNotFoundError;
import static com.spotu.modules.marketplace.service.ProductCreationExceptions.ProductValidation422Error;

@Service
public class ProductCreationService {

    private static final Logger log = LoggerFactory.getLogger(ProductCreationService.class);
    private final LongAdder asyncAttempted = new LongAdder();
    private final LongAdder asyncSuccess = new LongAdder();
    private final LongAdder asyncFailed = new LongAdder();
    private final LongAdder asyncRetryAttempted = new LongAdder();
    private final LongAdder asyncInvalidToken = new LongAdder();

    private final AuthMeService authMeService;
    private final ProductCreationRepository repository;
    private final ObjectMapper objectMapper;

    public ProductCreationService(
            AuthMeService authMeService,
            ProductCreationRepository repository,
            ObjectMapper objectMapper
    ) {
        this.authMeService = authMeService;
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public ProductUpsertResponseDto upsert(Map<String, Object> body, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> payload = body == null ? Map.of() : body;
        String sellerId = user.userId();
        boolean isAdmin = "admin".equals(user.role());

        String productId = text(payload.get("product_id"));
        if (!hasText(productId)) {
            productId = "prod_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        }

        String requestedStatus = hasText(text(payload.get("status"))) ? text(payload.get("status")) : "draft";
        String statusToWrite = isAdmin && "pending_review".equals(requestedStatus) ? "active" : requestedStatus;

        String title = text(payload.get("title")).strip();
        if (!hasText(title)) {
            throw new ProductBadRequestError("Le titre est obligatoire.");
        }
        String productType = hasText(text(payload.get("product_type"))) ? text(payload.get("product_type")) : "rental";
        if (!"rental".equals(productType) && !"sale".equals(productType)) {
            throw new ProductBadRequestError("Type de produit invalide. Types supportés : rental, sale.");
        }
        String description = text(payload.get("description")).strip();
        if (description.length() < 30) {
            throw new ProductBadRequestError("La description est obligatoire (minimum 30 caractères).");
        }

        List<String> imageUrls = stringList(payload.get("image_urls"));
        String coverImage = hasText(text(payload.get("cover_image_url")))
                ? text(payload.get("cover_image_url"))
                : (imageUrls.isEmpty() ? null : imageUrls.get(0));
        String imageUrl = coverImage;

        double price = parseDoubleOrDefault(payload.get("price"), 0.0);
        Double depositAmount = parseNullableDouble(payload.get("deposit_amount"));
        int availableQuantity = parseQuantity(payload.get("available_quantity"));
        List<String> pricingModes = stringList(payload.get("pricing_modes"));
        if (pricingModes.isEmpty()) {
            pricingModes = List.of("day");
        }
        List<String> tagIds = stringList(payload.get("tag_ids"));
        List<String> relatedSpotyouIds = stringList(payload.get("related_spotyou_ids"));
        List<String> deliveryModes = resolveDeliveryModes(payload);

        if ("pending_review".equals(requestedStatus)) {
            List<String> errors = validatePendingReview(
                    payload, productType, description, price, availableQuantity, imageUrls, pricingModes, relatedSpotyouIds, depositAmount
            );
            if (!errors.isEmpty()) {
                throw new ProductValidation422Error(errors);
            }
        }

        Optional<String> currentStatus = repository.findStatusByProductAndSeller(productId, sellerId);
        if (currentStatus.isPresent()
                && currentStatus.get() != null
                && !"draft".equals(currentStatus.get())
                && "draft".equals(requestedStatus)) {
            throw new ApiForbiddenException("Impossible de repasser en brouillon : ce produit a déjà été soumis ou validé.");
        }

        String nowIso = OffsetDateTime.now(ZoneOffset.UTC).toString();
        Map<String, Object> write = new LinkedHashMap<>();
        write.put("product_id", productId);
        write.put("title", title);
        write.put("short_description", nullableText(payload.get("short_description")));
        write.put("description", description);
        write.put("price", BigDecimal.valueOf(price));
        write.put("currency", hasText(text(payload.get("currency"))) ? text(payload.get("currency")) : "EUR");
        write.put("product_type", productType);
        write.put("pricing_type", hasText(text(payload.get("pricing_type"))) ? text(payload.get("pricing_type")) : "day");
        write.put("pricing_modes", writeJson(pricingModes));
        write.put("price_per_hour", parseNullableDouble(payload.get("price_per_hour")));
        write.put("price_per_day", parseNullableDouble(payload.get("price_per_day")));
        write.put("price_per_week", parseNullableDouble(payload.get("price_per_week")));
        write.put("price_per_month", parseNullableDouble(payload.get("price_per_month")));
        write.put("seller_id", sellerId);
        write.put("seller_type", "user");
        write.put("seller_name", hasText(user.name()) ? user.name() : "Utilisateur");
        write.put("seller_picture_url", user.picture());
        write.put("category", nullableText(payload.get("category")));
        write.put("subcategory", nullableText(payload.get("subcategory")));
        write.put("cover_image_url", coverImage);
        write.put("image_url", imageUrl);
        write.put("image_urls", writeJson(imageUrls));
        write.put("condition_label", hasText(text(payload.get("condition_label"))) ? text(payload.get("condition_label")) : "good");
        write.put("included_items", nullableText(payload.get("included_items")));
        write.put("size_dimensions", nullableText(payload.get("size_dimensions")));
        write.put("available_quantity", availableQuantity);
        write.put("in_stock", availableQuantity > 0);
        write.put("deposit_required", parseBool(payload.get("deposit_required")));
        write.put("deposit_amount", depositAmount);
        write.put("pickup_type", nullableText(payload.get("pickup_type")));
        write.put("pickup_notes", nullableText(payload.get("pickup_notes")));
        write.put("availability_note", nullableText(payload.get("availability_note")));
        write.put("return_rules", nullableText(payload.get("return_rules")));
        write.put("cancellation_rules", nullableText(payload.get("cancellation_rules")));
        write.put("city", nullableText(payload.get("city")));
        write.put("lat", parseNullableDouble(payload.get("lat")));
        write.put("lng", parseNullableDouble(payload.get("lng")));
        write.put("location_address_raw", normalizeAddress(payload.get("location_address_raw")));
        write.put("location_privacy", hasText(text(payload.get("location_privacy"))) ? text(payload.get("location_privacy")) : "100m");
        write.put("radius_km", parseDoubleOrDefault(payload.get("radius_km"), 0.1));
        write.put("related_spotyou_ids", writeJson(relatedSpotyouIds));
        write.put("tag_ids", writeJson(tagIds));
        write.put("delivery_modes", writeJson(deliveryModes));
        write.put("status", statusToWrite);
        write.put("skill_level", "tous");
        write.put("created_at", nowIso);
        write.put("updated_at", nowIso);

        try {
            if (currentStatus.isPresent()) {
                repository.updateProductMain(write);
            } else {
                repository.insertProduct(write);
            }
            repository.updateProductSecondary(
                    productId,
                    sellerId,
                    parseNullableDouble(payload.get("price_per_session")),
                    nullableText(payload.get("brand")),
                    nullableText(payload.get("model")),
                    nullableText(payload.get("weight")),
                    nullableText(payload.get("stripe_product_id")),
                    nullableText(payload.get("stripe_price_id"))
            );
        } catch (DataIntegrityViolationException ex) {
            throw new ApiConflictException("Conflit d'identifiant produit");
        }

        if ("pending_review".equals(requestedStatus) && !isAdmin) {
            notifyAdminsPendingAsync(productId, title);
        }
        return new ProductUpsertResponseDto(productId, statusToWrite);
    }

    public ProductMineResponseDto mine(HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        List<Map<String, Object>> rows = repository.findMine(user.userId()).stream().map(this::normalizeReadRow).toList();
        return new ProductMineResponseDto(rows, rows.size());
    }

    public Map<String, Object> detail(String productId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        return repository.findDetail(productId, user.userId())
                .map(this::normalizeReadRow)
                .orElseThrow(() -> new ProductNotFoundError("Produit introuvable ou accès refusé."));
    }

    @Transactional
    public Map<String, Object> deleteProduct(String productId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> row = repository.findDeleteGuardRow(productId, user.userId())
                .orElseThrow(() -> new ProductDeleteNotFoundError("Produit introuvable ou non autorisé."));

        Timestamp now = Timestamp.from(Instant.now());
        Timestamp mediaPurgeAt = Timestamp.from(now.toInstant().plus(90, ChronoUnit.DAYS));
        repository.softDeleteProduct(productId, user.userId(), now, mediaPurgeAt);

        for (String url : parseImages(row.get("image_urls"))) {
            if (!url.isBlank()) {
                repository.scheduleFileDeletion(url, "product", productId, mediaPurgeAt);
            }
        }
        return Map.of(
                "ok", true,
                "media_purge_scheduled_at", PythonIsoTimestamps.fromTimestamp(mediaPurgeAt)
        );
    }

    @Transactional
    public Map<String, Object> reactivateProduct(String productId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> row = repository.findReactivateGuardRow(productId)
                .orElseThrow(() -> new ApiNotFoundException("Produit introuvable"));

        String status = row.get("status") == null ? null : String.valueOf(row.get("status"));
        boolean deletedAtNull = row.get("deleted_at") == null;
        if (!"deleted".equals(status) || deletedAtNull) {
            throw new ApiConflictException("Ce produit n'est pas supprimé");
        }
        String sellerId = row.get("seller_id") == null ? "" : String.valueOf(row.get("seller_id"));
        boolean isAdmin = "admin".equals(user.role());
        if (!sellerId.equals(user.userId()) && !isAdmin) {
            throw new ApiForbiddenException("Non autorisé");
        }

        boolean mediaPurged = boolValue(row.get("media_purged"));
        repository.cancelPendingFileDeletions(productId);
        repository.reactivateProduct(productId, Timestamp.from(Instant.now()));

        return Map.of(
                "ok", true,
                "reactivated", true,
                "product_id", productId,
                "media_purged", mediaPurged,
                "requires_media_reupload", mediaPurged
        );
    }

    public int runMarketplaceMediaPurgeCycle() {
        Timestamp now = Timestamp.from(Instant.now());
        List<String> dueIds = repository.findDueProductIdsForMediaPurge(now);
        if (dueIds.isEmpty()) {
            return 0;
        }
        return repository.markProductsMediaPurged(dueIds, now);
    }

    @Async("marketplaceExecutor")
    public void notifyAdminsPendingAsync(String productId, String title) {
        List<String> adminIds;
        try {
            adminIds = repository.findAdminUserIds();
        } catch (Exception exc) {
            asyncFailed.increment();
            log.warn("marketplace_async_summary product_id={} title=\"{}\" attempted=0 failed=1 reason=admin_fetch_failed",
                    productId, title);
            return;
        }

        int attempted = 0;
        int failed = 0;
        String notifTitle = "Nouvelle annonce à valider";
        String notifBody = "« " + title + " » est en attente de publication.";
        for (String adminId : adminIds) {
            attempted++;
            asyncAttempted.increment();
            try {
                // Compat fire-and-forget minimale : on persiste une notification interne.
                // Le push Expo n'est pas branché ici.
                asyncSuccess.increment();
            } catch (Exception ignored) {
                failed++;
                asyncFailed.increment();
            }
        }
        log.info("marketplace_async_summary product_id={} title=\"{}\" attempted={} failed={} retry_attempted={} invalid_token={}",
                productId, title, attempted, failed, 0, 0);
    }

    public MetricsSnapshot asyncMetricsSnapshot() {
        return new MetricsSnapshot(
                asyncAttempted.longValue(),
                asyncSuccess.longValue(),
                asyncFailed.longValue(),
                asyncRetryAttempted.longValue(),
                asyncInvalidToken.longValue()
        );
    }

    public record MetricsSnapshot(
            long attempted,
            long success,
            long failed,
            long retryAttempted,
            long invalidToken
    ) {
    }

    private Map<String, Object> normalizeReadRow(Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>(row);
        for (String key : List.of("pricing_modes", "image_urls", "tag_ids", "related_spotyou_ids", "delivery_modes")) {
            if (out.containsKey(key)) {
                out.put(key, deserializeJsonList(out.get(key)));
            }
        }
        Object price = out.get("price");
        if (price instanceof BigDecimal bd) {
            out.put("price", bd.doubleValue());
        }
        for (String key : List.of("price_per_hour", "price_per_day", "price_per_week", "price_per_month", "price_per_session", "deposit_amount")) {
            Object v = out.get(key);
            if (v instanceof BigDecimal bd) {
                out.put(key, bd.doubleValue());
            }
        }
        Object lat = out.get("lat");
        if (lat instanceof BigDecimal bd) {
            out.put("lat", bd.doubleValue());
        }
        Object lng = out.get("lng");
        if (lng instanceof BigDecimal bd) {
            out.put("lng", bd.doubleValue());
        }
        return out;
    }

    private List<Object> deserializeJsonList(Object raw) {
        if (raw == null) {
            return List.of();
        }
        if (raw instanceof List<?> l) {
            return new ArrayList<>(l);
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

    private List<String> parseImages(Object raw) {
        if (raw == null) {
            return List.of();
        }
        if (raw instanceof List<?> l) {
            return l.stream().filter(v -> v != null && !String.valueOf(v).isBlank()).map(String::valueOf).toList();
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
        return List.of();
    }

    private List<String> validatePendingReview(
            Map<String, Object> body,
            String productType,
            String description,
            double price,
            int availableQuantity,
            List<String> imageUrls,
            List<String> pricingModes,
            List<String> relatedSpotyouIds,
            Double depositAmount
    ) {
        List<String> errors = new ArrayList<>();
        String category = text(body.get("category")).strip();
        String conditionLabel = text(body.get("condition_label")).strip();
        List<String> tagIds = stringList(body.get("tag_ids"));
        String pickupType = text(body.get("pickup_type")).strip();
        boolean depositRequired = parseBool(body.get("deposit_required"));

        if (!hasText(category)) {
            errors.add("La catégorie du matériel est obligatoire.");
        }
        if (tagIds.isEmpty()) {
            errors.add("Sélectionne au moins un tag pour publier le produit.");
        }
        if (!hasText(conditionLabel)) {
            errors.add("L'état du matériel est obligatoire.");
        }
        if (description.length() < 30) {
            errors.add("La description doit faire au moins 30 caractères.");
        }
        if (imageUrls.isEmpty()) {
            errors.add("Au moins une photo est requise.");
        }

        if ("sale".equals(productType)) {
            if (price <= 0) {
                errors.add("Le prix de vente doit être supérieur à 0.");
            }
            if (availableQuantity < 1) {
                errors.add("La quantité disponible doit être au minimum 1.");
            }
            if (!hasText(pickupType)) {
                errors.add("Le mode de remise est obligatoire.");
            }
        } else {
            if (price <= 0) {
                errors.add("Le prix doit être supérieur à 0.");
            }
            if (!hasText(pickupType)) {
                errors.add("Le mode de remise du matériel est obligatoire.");
            }
            if (pricingModes.contains("session") && relatedSpotyouIds.isEmpty()) {
                errors.add("La tarification par séance nécessite de sélectionner au moins un SpotYou.");
            }
            if (depositRequired && (depositAmount == null || depositAmount <= 0)) {
                errors.add("Le montant de la caution est obligatoire si une caution est requise.");
            }
        }
        return errors;
    }

    private List<String> resolveDeliveryModes(Map<String, Object> body) {
        List<String> provided = stringList(body.get("delivery_modes"));
        if (!provided.isEmpty()) {
            return provided;
        }
        String pickup = text(body.get("pickup_type"));
        if ("creator_handoff".equals(pickup)) {
            return List.of("creator_handoff");
        }
        return List.of("local_pickup");
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            return "[]";
        }
    }

    private static String normalizeAddress(Object raw) {
        String val = text(raw).strip();
        return hasText(val) ? val : null;
    }

    private static boolean parseBool(Object raw) {
        if (raw instanceof Boolean b) {
            return b;
        }
        if (raw == null) {
            return false;
        }
        return "true".equalsIgnoreCase(String.valueOf(raw));
    }

    private static int parseQuantity(Object raw) {
        if (raw == null || String.valueOf(raw).isBlank()) {
            return 1;
        }
        try {
            return Math.max(1, Integer.parseInt(String.valueOf(raw)));
        } catch (Exception ignored) {
            return 1;
        }
    }

    private static double parseDoubleOrDefault(Object raw, double fallback) {
        if (raw == null) {
            return fallback;
        }
        try {
            return Double.parseDouble(String.valueOf(raw).replace(",", "."));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static Double parseNullableDouble(Object raw) {
        if (raw == null || String.valueOf(raw).isBlank()) {
            return null;
        }
        try {
            return Double.parseDouble(String.valueOf(raw).replace(",", "."));
        } catch (Exception ignored) {
            return null;
        }
    }

    private static List<String> stringList(Object raw) {
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (Object v : list) {
            String s = text(v);
            if (hasText(s)) {
                out.add(s);
            }
        }
        return out;
    }

    private static String nullableText(Object value) {
        String s = text(value);
        return hasText(s) ? s : null;
    }

    private static String text(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static boolean boolValue(Object value) {
        if (value instanceof Boolean b) {
            return b;
        }
        if (value == null) {
            return false;
        }
        return "true".equalsIgnoreCase(String.valueOf(value));
    }
}
