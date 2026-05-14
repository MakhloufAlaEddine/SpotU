package com.spotu.modules.services.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.error.ApiConflictException;
import com.spotu.error.ApiForbiddenException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.auth.support.PythonIsoTimestamps;
import com.spotu.modules.services.infra.ServicesRepository;
import com.spotu.modules.uploads.service.FileStorageService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.spotu.modules.services.service.ServiceWriteExceptions.ServiceValidation422Error;

@Service
public class ServicesWriteService {

    private final ServicesRepository repository;
    private final AuthMeService authMeService;
    private final ServicesQueryService servicesQueryService;
    private final FileStorageService fileStorageService;
    private final ObjectMapper objectMapper;

    public ServicesWriteService(
            ServicesRepository repository,
            AuthMeService authMeService,
            ServicesQueryService servicesQueryService,
            FileStorageService fileStorageService,
            ObjectMapper objectMapper
    ) {
        this.repository = repository;
        this.authMeService = authMeService;
        this.servicesQueryService = servicesQueryService;
        this.fileStorageService = fileStorageService;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public Map<String, Object> create(Map<String, Object> body, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        if (!"coach".equals(user.role()) && !"admin".equals(user.role())) {
            throw new ApiForbiddenException("Coach role required");
        }
        Map<String, Object> payload = body == null ? Map.of() : body;
        validateCreate(payload);

        String serviceId = "svc_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        List<Map<String, Object>> packages = mapList(payload.get("packages"));
        BigDecimal price = parseNullableDecimal(payload.get("price"));
        if (price == null) {
            price = minPackagePrice(packages);
        }

        Map<String, Boolean> flags = repository.readBookingFlags();
        BookingConfig config = normalizeBookingConfig(
                text(payload.get("booking_approval_mode"), "manual_approval"),
                boolOrDefault(payload.get("allow_pay_later"), true),
                intOrDefault(payload.get("pay_later_expiration_minutes"), 1440),
                flags
        );

        Map<String, Object> write = new LinkedHashMap<>();
        write.put("service_id", serviceId);
        write.put("coach_id", user.userId());
        write.put("title", text(payload.get("title"), "").trim());
        write.put("description", nullableText(payload.get("description")));
        write.put("address", nullableText(payload.get("address")));
        write.put("price", price);
        write.put("duration_min", intOrDefault(payload.get("duration_min"), 60));
        write.put("tag_ids", toJson(parseStringList(payload.get("tag_ids"))));
        write.put("domain_id", nullableText(payload.get("domain_id")));
        write.put("max_participants", intOrDefault(payload.get("max_participants"), 1));
        write.put("images", toJson(parseStringList(payload.get("images"))));
        write.put("booking_approval_mode", config.mode());
        write.put("allow_pay_later", config.allowPayLater());
        write.put("pay_later_expiration_minutes", config.expiryMinutes());
        repository.insertService(write);
        persistPackages(serviceId, packages);

        List<String> newLocationIds = List.of();
        if (payload.containsKey("locations")) {
            List<Map<String, Object>> normalizedLocations = normalizeLocations(mapList(payload.get("locations")));
            repository.replaceLocations(serviceId, normalizedLocations);
            newLocationIds = normalizedLocations.stream().map(v -> String.valueOf(v.get("location_id"))).toList();
        }

        if (payload.containsKey("slots") && payload.get("slots") != null) {
            persistSlotsCreate(serviceId, mapList(payload.get("slots")), newLocationIds);
        }

        Map<String, Object> out = asMap(servicesQueryService.getServiceById(serviceId, request));
        out.put("is_saved", false);
        return out;
    }

    @Transactional
    public Map<String, Object> update(String serviceId, Map<String, Object> body, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> guard = repository.findWriteGuardRow(serviceId)
                .orElseThrow(() -> new ApiNotFoundException("Service not found"));
        boolean isAdmin = "admin".equals(user.role());
        if (!isAdmin && !user.userId().equals(String.valueOf(guard.get("coach_id")))) {
            throw new ApiForbiddenException("Not authorized");
        }

        Map<String, Object> payload = body == null ? Map.of() : body;
        LinkedHashMap<String, Object> setValues = new LinkedHashMap<>();
        for (String key : List.of(
                "title", "description", "price", "duration_min", "active",
                "location_description", "max_participants", "domain_id",
                "booking_approval_mode", "allow_pay_later", "pay_later_expiration_minutes"
        )) {
            if (payload.containsKey(key) && payload.get(key) != null) {
                setValues.put(key, payload.get(key));
            }
        }

        if (payload.containsKey("tag_ids") && payload.get("tag_ids") != null) {
            setValues.put("tag_ids", toJson(parseStringList(payload.get("tag_ids"))));
        }

        if (payload.containsKey("images")) {
            Object raw = payload.get("images");
            if (raw != null) {
                List<String> oldImages = parseStringList(guard.get("images"));
                List<String> newImages = parseStringList(raw);
                List<String> removed = oldImages.stream().filter(url -> !newImages.contains(url)).toList();
                for (String url : removed) {
                    try {
                        fileStorageService.deleteUploadFile(url);
                    } catch (Exception ignored) {
                    }
                }
                setValues.put("images", toJson(newImages));
            }
        }

        if (payload.containsKey("booking_approval_mode") || payload.containsKey("allow_pay_later")) {
            Map<String, Boolean> flags = repository.readBookingFlags();
            BookingConfig cfg = normalizeBookingConfig(
                    payload.containsKey("booking_approval_mode")
                            ? text(payload.get("booking_approval_mode"), "instant_booking")
                            : "instant_booking",
                    payload.containsKey("allow_pay_later") ? boolOrDefault(payload.get("allow_pay_later"), false) : false,
                    payload.containsKey("pay_later_expiration_minutes")
                            ? intOrDefault(payload.get("pay_later_expiration_minutes"), 1440)
                            : 1440,
                    flags
            );
            if (payload.containsKey("booking_approval_mode")) {
                setValues.put("booking_approval_mode", cfg.mode());
            }
            if (payload.containsKey("allow_pay_later")) {
                setValues.put("allow_pay_later", cfg.allowPayLater());
            }
            if (payload.containsKey("pay_later_expiration_minutes")) {
                setValues.put("pay_later_expiration_minutes", cfg.expiryMinutes());
            }
        }

        if (!setValues.isEmpty()) {
            repository.updateServiceDynamic(serviceId, setValues);
        }
        boolean locationsProvided = false;
        List<String> newLocationIds = List.of();
        if (payload.containsKey("locations")) {
            Object locations = payload.get("locations");
            if (locations != null) {
                locationsProvided = true;
                List<Map<String, Object>> normalizedLocations = normalizeLocations(mapList(locations));
                repository.replaceLocations(serviceId, normalizedLocations);
                newLocationIds = normalizedLocations.stream().map(v -> String.valueOf(v.get("location_id"))).toList();
            }
        }
        if (payload.containsKey("slots") && payload.get("slots") != null) {
            repository.deleteSlotsByServiceId(serviceId);
            List<String> locationIdList = locationsProvided ? newLocationIds : repository.findLocationIdsByServiceIdOrdered(serviceId);
            persistSlotsReplace(serviceId, mapList(payload.get("slots")), locationIdList);
        }
        Map<String, Object> out = asMap(servicesQueryService.getServiceById(serviceId, request));
        out.put("is_saved", false);
        return out;
    }

    @Transactional
    public Map<String, Object> delete(String serviceId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> guard = repository.findWriteGuardRow(serviceId)
                .orElseThrow(() -> new ApiNotFoundException("Service not found"));
        boolean isAdmin = "admin".equals(user.role());
        if (!isAdmin && !user.userId().equals(String.valueOf(guard.get("coach_id")))) {
            throw new ApiForbiddenException("Not authorized");
        }
        if (!isAdmin) {
            int activeBookings = repository.countActiveBookingsByServiceId(serviceId);
            if (activeBookings > 0) {
                throw new ApiConflictException(
                        "Impossible de supprimer : " + activeBookings + " réservation(s) active(s) sur ce service. Annulez-les d'abord."
                );
            }
        }

        Timestamp now = Timestamp.from(Instant.now());
        Timestamp purgeAt = Timestamp.from(now.toInstant().plus(90, ChronoUnit.DAYS));
        repository.softDeleteService(serviceId, user.userId(), now, purgeAt);
        repository.markConversationsDeleted(serviceId);
        for (String url : parseStringList(guard.get("images"))) {
            if (!url.isBlank()) {
                repository.scheduleFileDeletion(url, "service", serviceId, purgeAt);
            }
        }
        return Map.of(
                "success", true,
                "media_purge_scheduled_at", PythonIsoTimestamps.fromTimestamp(purgeAt)
        );
    }

    @Transactional
    public Map<String, Object> reactivate(String serviceId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> guard = repository.findWriteGuardRow(serviceId)
                .orElseThrow(() -> new ApiNotFoundException("Service introuvable"));
        boolean isAdmin = "admin".equals(user.role());
        if (!isAdmin && !user.userId().equals(String.valueOf(guard.get("coach_id")))) {
            throw new ApiForbiddenException("Non autorisé");
        }
        boolean active = Boolean.TRUE.equals(guard.get("active"));
        if (active && guard.get("deleted_at") == null) {
            throw new ApiConflictException("Ce service est déjà actif");
        }

        boolean mediaPurged = Boolean.TRUE.equals(guard.get("media_purged"));
        repository.cancelPendingFileDeletions(serviceId);
        Timestamp now = Timestamp.from(Instant.now());
        repository.reactivateService(serviceId, now);
        repository.markConversationsActive(serviceId);
        return Map.of(
                "success", true,
                "reactivated", true,
                "service_id", serviceId,
                "media_purged", mediaPurged,
                "requires_media_reupload", mediaPurged
        );
    }

    public Map<String, Object> saveService(String serviceId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        if (!repository.existsActiveServiceById(serviceId)) {
            throw new ApiNotFoundException("Service not found");
        }
        repository.saveServiceForUser(serviceId, user.userId());
        return Map.of("success", true, "is_saved", true);
    }

    public Map<String, Object> unsaveService(String serviceId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        repository.unsaveServiceForUser(serviceId, user.userId());
        return Map.of("success", true, "is_saved", false);
    }

    private void validateCreate(Map<String, Object> payload) {
        List<Map<String, Object>> detail = new ArrayList<>();
        String title = text(payload.get("title"), "").trim();
        if (title.length() < 5) {
            detail.add(validationError("title", "Le titre doit avoir au moins 5 caractères", payload.get("title")));
        }
        if (payload.containsKey("images")) {
            List<String> images = parseStringList(payload.get("images"));
            if (images.size() > 5) {
                detail.add(validationError("images", "Maximum 5 images autorisées pour un service", payload.get("images")));
            }
        }
        if (payload.containsKey("price") && payload.get("price") != null) {
            BigDecimal p = parseNullableDecimal(payload.get("price"));
            if (p == null || p.compareTo(BigDecimal.ZERO) < 0) {
                detail.add(validationError("price", "Le prix ne peut pas être négatif", payload.get("price")));
            }
        }
        List<Map<String, Object>> packages = mapList(payload.get("packages"));
        for (int i = 0; i < packages.size(); i++) {
            Map<String, Object> pkg = packages.get(i);
            if (pkg.get("type_id") == null) {
                detail.add(validationError("packages[" + i + "].type_id", "Field required", null));
            }
            if (pkg.get("type_label") == null) {
                detail.add(validationError("packages[" + i + "].type_label", "Field required", null));
            }
            List<Map<String, Object>> pkgSlots = mapList(pkg.get("slots"));
            for (int j = 0; j < pkgSlots.size(); j++) {
                Map<String, Object> slot = pkgSlots.get(j);
                if (slot.get("slot_date") == null) {
                    detail.add(validationError("packages[" + i + "].slots[" + j + "].slot_date", "Field required", null));
                }
                if (slot.get("start_time") == null) {
                    detail.add(validationError("packages[" + i + "].slots[" + j + "].start_time", "Field required", null));
                }
                if (slot.get("end_time") == null) {
                    detail.add(validationError("packages[" + i + "].slots[" + j + "].end_time", "Field required", null));
                }
            }
        }
        if (!detail.isEmpty()) {
            throw new ServiceValidation422Error(detail);
        }
    }

    private void persistPackages(String serviceId, List<Map<String, Object>> packages) {
        for (Map<String, Object> pkg : packages) {
            String packageId = "pkg_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
            BigDecimal pkgPrice = parseNullableDecimal(pkg.get("price"));
            repository.insertPackage(
                    packageId,
                    serviceId,
                    text(pkg.get("type_id"), ""),
                    text(pkg.get("type_label"), ""),
                    intOrDefault(pkg.get("duration_min"), 60),
                    intOrDefault(pkg.get("max_participants"), 1),
                    pkgPrice == null ? BigDecimal.ZERO : pkgPrice
            );
            for (Map<String, Object> slot : mapList(pkg.get("slots"))) {
                repository.insertPackageSlot(
                        "slot_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12),
                        serviceId,
                        packageId,
                        text(slot.get("slot_date"), ""),
                        text(slot.get("start_time"), ""),
                        text(slot.get("end_time"), "")
                );
            }
        }
    }

    private List<Map<String, Object>> normalizeLocations(List<Map<String, Object>> raw) {
        List<Map<String, Object>> out = new ArrayList<>();
        int i = 0;
        for (Map<String, Object> item : raw) {
            Map<String, Object> loc = new LinkedHashMap<>();
            loc.put("location_id", "sloc_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12) + "_" + i++);
            loc.put("latitude", parseNullableDouble(item.get("latitude")));
            loc.put("longitude", parseNullableDouble(item.get("longitude")));
            loc.put("precision", text(item.get("precision"), "exact"));
            loc.put("description", nullableText(item.get("description")));
            if (loc.get("latitude") != null && loc.get("longitude") != null) {
                out.add(loc);
            }
        }
        return out;
    }

    private void persistSlotsCreate(String serviceId, List<Map<String, Object>> slots, List<String> locIds) {
        for (Map<String, Object> slot : slots) {
            insertOneSlot(serviceId, slot, locIds);
        }
    }

    private void persistSlotsReplace(String serviceId, List<Map<String, Object>> slots, List<String> locIds) {
        for (Map<String, Object> slot : slots) {
            insertOneSlot(serviceId, slot, locIds);
        }
    }

    private void insertOneSlot(String serviceId, Map<String, Object> slot, List<String> locIds) {
        List<Integer> days = resolveDays(slot);
        Integer locationIndex = parseNullableInt(slot.get("location_index"));
        String resolvedLocationId;
        if (locationIndex != null && locationIndex >= 0 && locationIndex < locIds.size()) {
            resolvedLocationId = locIds.get(locationIndex);
        } else {
            resolvedLocationId = locIds.isEmpty() ? null : locIds.get(0);
        }

        String slotId = "slot_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String slotType = text(slot.get("slot_type"), "recurring");
        repository.insertSlot(
                slotId,
                serviceId,
                resolvedLocationId,
                slotType,
                toJson(days),
                days.isEmpty() ? null : days.get(0),
                text(slot.get("start_time"), "00:00"),
                text(slot.get("end_time"), "00:00"),
                nullableText(slot.get("slot_date"))
        );
    }

    private List<Integer> resolveDays(Map<String, Object> slot) {
        if (slot.containsKey("days_of_week") && slot.get("days_of_week") != null) {
            return parseIntegerList(slot.get("days_of_week"));
        }
        Integer legacy = parseNullableInt(slot.get("day_of_week"));
        return legacy == null ? List.of() : List.of(legacy);
    }

    private BookingConfig normalizeBookingConfig(String mode, boolean payLater, Integer expiry, Map<String, Boolean> flags) {
        String normalizedMode = mode == null ? "instant_booking" : mode;
        boolean normalizedPayLater = payLater;
        Integer normalizedExpiry = expiry;
        if (!flags.getOrDefault("enable_manual_approval_for_services", false)) {
            normalizedMode = "instant_booking";
        }
        if (!flags.getOrDefault("enable_pay_later_for_services", false)) {
            normalizedPayLater = false;
            normalizedExpiry = null;
        }
        return new BookingConfig(
                normalizedMode,
                normalizedPayLater,
                normalizedExpiry == null ? 1440 : normalizedExpiry
        );
    }

    private BigDecimal minPackagePrice(List<Map<String, Object>> packages) {
        BigDecimal min = null;
        for (Map<String, Object> pkg : packages) {
            BigDecimal candidate = parseNullableDecimal(pkg.get("price"));
            if (candidate == null) {
                candidate = BigDecimal.ZERO;
            }
            if (candidate != null && (min == null || candidate.compareTo(min) < 0)) {
                min = candidate;
            }
        }
        return min == null ? BigDecimal.ZERO : min;
    }

    private Map<String, Object> asMap(Object dto) {
        return objectMapper.convertValue(dto, new TypeReference<Map<String, Object>>() {
        });
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> mapList(Object raw) {
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object v : list) {
            if (v instanceof Map<?, ?> m) {
                out.add((Map<String, Object>) m);
            }
        }
        return out;
    }

    private List<String> parseStringList(Object raw) {
        if (raw == null) {
            return List.of();
        }
        if (raw instanceof List<?> list) {
            List<String> out = new ArrayList<>();
            for (Object v : list) {
                if (v != null) {
                    out.add(String.valueOf(v));
                }
            }
            return out;
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

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ignored) {
            return "[]";
        }
    }

    private BigDecimal parseNullableDecimal(Object raw) {
        if (raw == null) {
            return null;
        }
        try {
            return new BigDecimal(String.valueOf(raw).replace(",", "."));
        } catch (Exception ignored) {
            return null;
        }
    }

    private Double parseNullableDouble(Object raw) {
        if (raw == null) {
            return null;
        }
        try {
            return Double.parseDouble(String.valueOf(raw).replace(",", "."));
        } catch (Exception ignored) {
            return null;
        }
    }

    private int intOrDefault(Object raw, int fallback) {
        if (raw == null) {
            return fallback;
        }
        try {
            return Integer.parseInt(String.valueOf(raw));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private Integer parseNullableInt(Object raw) {
        if (raw == null) {
            return null;
        }
        try {
            return Integer.parseInt(String.valueOf(raw));
        } catch (Exception ignored) {
            return null;
        }
    }

    private List<Integer> parseIntegerList(Object raw) {
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        List<Integer> out = new ArrayList<>();
        for (Object v : list) {
            Integer parsed = parseNullableInt(v);
            if (parsed != null) {
                out.add(parsed);
            }
        }
        return out;
    }

    private boolean boolOrDefault(Object raw, boolean fallback) {
        if (raw == null) {
            return fallback;
        }
        if (raw instanceof Boolean b) {
            return b;
        }
        return "true".equalsIgnoreCase(String.valueOf(raw));
    }

    private String text(Object raw, String fallback) {
        if (raw == null) {
            return fallback;
        }
        return String.valueOf(raw);
    }

    private String nullableText(Object raw) {
        if (raw == null) {
            return null;
        }
        String s = String.valueOf(raw);
        return s.isBlank() ? null : s;
    }

    private Map<String, Object> validationError(String field, String msg, Object input) {
        Map<String, Object> err = new LinkedHashMap<>();
        err.put("type", "value_error");
        err.put("loc", List.of("body", field));
        err.put("msg", msg);
        err.put("input", input);
        return err;
    }

    private record BookingConfig(String mode, boolean allowPayLater, Integer expiryMinutes) {
    }
}
