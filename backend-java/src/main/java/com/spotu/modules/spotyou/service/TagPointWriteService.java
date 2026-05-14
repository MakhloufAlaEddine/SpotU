package com.spotu.modules.spotyou.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.error.ApiBadRequestException;
import com.spotu.error.ApiForbiddenException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.spotyou.dto.TagPointCreateRequest;
import com.spotu.modules.spotyou.infra.TagPointReadRepository;
import com.spotu.modules.spotyou.infra.TagPointWriteRepository;
import com.spotu.modules.spotyou.support.EmergentIds;
import com.spotu.modules.spotyou.support.GeoRandomizer;
import com.spotu.modules.spotyou.support.TagPointResponseBuilder;
import com.spotu.modules.spotyou.support.TagPointValueDiff;
import com.spotu.modules.uploads.service.FileStorageService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class TagPointWriteService {

    private static final Set<String> UPDATEABLE = Set.of(
            "title", "description", "precision", "tag_ids", "images", "domain_id", "active",
            "event_date", "event_end_date", "event_schedule", "minimum_participants", "maximum_participants",
            "address", "visibility_type", "join_mode", "invite_permissions", "max_community_members"
    );
    private static final Set<String> JSONB_KEYS = Set.of("tag_ids", "images", "event_schedule");

    private final TagPointWriteRepository writeRepository;
    private final TagPointReadRepository readRepository;
    private final AuthMeService authMeService;
    private final ObjectMapper objectMapper;
    private final FileStorageService fileStorageService;
    private final SpotYouPushSideEffectService pushSideEffectService;

    public TagPointWriteService(
            TagPointWriteRepository writeRepository,
            TagPointReadRepository readRepository,
            AuthMeService authMeService,
            ObjectMapper objectMapper,
            FileStorageService fileStorageService,
            SpotYouPushSideEffectService pushSideEffectService
    ) {
        this.writeRepository = writeRepository;
        this.readRepository = readRepository;
        this.authMeService = authMeService;
        this.objectMapper = objectMapper;
        this.fileStorageService = fileStorageService;
        this.pushSideEffectService = pushSideEffectService;
    }

    @Transactional
    public Map<String, Object> create(HttpServletRequest request, TagPointCreateRequest body) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        validateTitle(body.title());
        List<String> tags = body.tag_ids() == null ? List.of() : body.tag_ids();
        if (tags.isEmpty()) {
            throw new ApiBadRequestException("Au moins un tag est requis.");
        }
        List<String> images = body.images() == null ? List.of() : body.images();
        if (images.size() > 10) {
            throw new ApiBadRequestException("Maximum 10 images autorisées");
        }
        Integer minP = body.minimum_participants();
        Integer maxP = body.maximum_participants();
        if (minP != null && maxP != null && minP > maxP) {
            throw new ApiBadRequestException("Le nombre minimum de participants ne peut pas dépasser le maximum.");
        }
        if (minP != null && maxP == null) {
            maxP = minP;
        } else if (maxP != null && minP == null) {
            minP = maxP;
        }
        if (minP != null && minP < 1) {
            minP = 1;
        }
        validateEventSchedule(body.event_schedule());

        String prec = body.precision() == null || body.precision().isBlank() ? "exact" : body.precision();
        double[] stored = GeoRandomizer.randomizeForStorage(body.latitude(), body.longitude(), prec);

        String pid = EmergentIds.newId("pt");
        String partId = EmergentIds.newId("part");
        Timestamp expiresAt = null;
        if (body.expires_hours() != null && body.expires_hours() > 0) {
            expiresAt = Timestamp.from(Instant.now().plusSeconds(body.expires_hours() * 3600L));
        }
        Timestamp ev1 = parseTimestamp(body.event_date());
        Timestamp ev2 = parseTimestamp(body.event_end_date());
        String eventSchedJson = body.event_schedule() == null ? null : toJson(body.event_schedule());
        String imagesJson = toJson(images);
        String tagIdsJson = toJson(tags);
        String vis = body.visibility_type() == null || body.visibility_type().isBlank() ? "public" : body.visibility_type();
        String jm = body.join_mode() == null || body.join_mode().isBlank() ? "open" : body.join_mode();
        String inv = body.invitePermissions() == null || body.invitePermissions().isBlank()
                ? "admin_only" : body.invitePermissions();

        if (writeRepository.usePostgisLocationColumn()) {
            writeRepository.insertTagPointPostgis(
                    pid, user.userId(), body.title().trim(), body.description(),
                    stored[1], stored[0], prec, tagIdsJson, body.domain_id(),
                    expiresAt, ev1, ev2, eventSchedJson, imagesJson,
                    minP, maxP, body.address(), vis, jm, inv, body.max_community_members()
            );
        } else {
            writeRepository.insertTagPointFallback(
                    pid, user.userId(), body.title().trim(), body.description(),
                    stored[0], stored[1], prec, tagIdsJson, body.domain_id(),
                    expiresAt, ev1, ev2, eventSchedJson, imagesJson,
                    minP, maxP, body.address(), vis, jm, inv, body.max_community_members()
            );
        }
        writeRepository.insertOwnerMemberAccepted(partId, pid, user.userId());

        Map<String, Object> row = readRepository.findByPointId(pid)
                .orElseThrow(() -> new ApiNotFoundException("TagPoint not found"));
        return TagPointResponseBuilder.buildPointResponse(new LinkedHashMap<>(row), true, objectMapper);
    }

    @Transactional
    public Map<String, Object> update(HttpServletRequest request, String pointId, JsonNode bodyNode) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> raw = jsonNodeToMap(bodyNode);
        Map<String, Object> existing = writeRepository.findExistingForUpdate(pointId)
                .orElseThrow(() -> new ApiNotFoundException("TagPoint not found"));
        if (!String.valueOf(existing.get("user_id")).equals(user.userId()) && !"admin".equals(user.role())) {
            throw new ApiForbiddenException("Not authorized");
        }
        if (raw.isEmpty()) {
            Map<String, Object> row = readRepository.findByPointId(pointId)
                    .orElseThrow(() -> new ApiNotFoundException("TagPoint not found"));
            return TagPointResponseBuilder.buildPointResponse(new LinkedHashMap<>(row), true, objectMapper);
        }
        if (raw.containsKey("images") && raw.get("images") != null) {
            @SuppressWarnings("unchecked")
            List<Object> imgList = (List<Object>) raw.get("images");
            if (imgList.size() > 10) {
                throw new ApiBadRequestException("Maximum 10 images autorisées");
            }
        }
        if (raw.containsKey("tag_ids") && raw.get("tag_ids") instanceof List<?> tl && tl.isEmpty()) {
            throw new ApiBadRequestException("Au moins un tag est requis.");
        }

        if (raw.containsKey("minimum_participants") || raw.containsKey("maximum_participants")) {
            Integer exMin = writeRepository.fetchMinParticipants(pointId);
            Integer exMax = writeRepository.fetchMaxParticipants(pointId);
            Integer minP = raw.containsKey("minimum_participants") ? asInt(raw.get("minimum_participants")) : exMin;
            Integer maxP = raw.containsKey("maximum_participants") ? asInt(raw.get("maximum_participants")) : exMax;
            if (minP != null && maxP != null && minP > maxP) {
                throw new ApiBadRequestException("Le nombre minimum de participants ne peut pas dépasser le maximum.");
            }
            if (minP != null && maxP == null) {
                maxP = minP;
                raw.put("maximum_participants", maxP);
            } else if (maxP != null && minP == null) {
                minP = maxP;
                raw.put("minimum_participants", minP);
            }
            if (minP != null && minP < 1) {
                raw.put("minimum_participants", 1);
            }
        }

        if (raw.containsKey("event_schedule")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> sched = (Map<String, Object>) raw.get("event_schedule");
            validateEventSchedule(sched);
        }

        Double lat = popDouble(raw, "latitude");
        Double lng = popDouble(raw, "longitude");

        boolean hasRealChanges = false;
        for (var e : raw.entrySet()) {
            if (!UPDATEABLE.contains(e.getKey())) {
                continue;
            }
            if (!TagPointValueDiff.valsEqual(e.getValue(), existing.get(e.getKey()), objectMapper)) {
                hasRealChanges = true;
                break;
            }
        }
        if (!hasRealChanges && lat != null && lng != null) {
            if (!TagPointValueDiff.valsEqual(lat, existing.get("latitude"), objectMapper)
                    || !TagPointValueDiff.valsEqual(lng, existing.get("longitude"), objectMapper)) {
                hasRealChanges = true;
            }
        }

        boolean pg = writeRepository.usePostgisLocationColumn();
        List<String> fragments = new ArrayList<>();
        List<Object> params = new ArrayList<>();

        if (lat != null && lng != null) {
            if (pg) {
                fragments.add("location = ST_SetSRID(ST_MakePoint(?, ?), 4326)");
            } else {
                fragments.add("latitude = ?");
                fragments.add("longitude = ?");
            }
            params.add(pg ? lng : lat);
            params.add(pg ? lat : lng);
        }

        for (var e : raw.entrySet()) {
            String key = e.getKey();
            if (!UPDATEABLE.contains(key)) {
                continue;
            }
            Object val = e.getValue();
            if (JSONB_KEYS.contains(key)) {
                if (val == null) {
                    fragments.add(key + " = NULL");
                } else if (pg) {
                    fragments.add(key + " = CAST(? AS jsonb)");
                    params.add(toJson(normalizeJsonValue(val)));
                } else {
                    fragments.add(key + " = ?");
                    params.add(toJson(normalizeJsonValue(val)));
                }
            } else {
                if (val == null) {
                    fragments.add(key + " = NULL");
                } else {
                    fragments.add(key + " = ?");
                    params.add(coerceUpdateScalar(key, val));
                }
            }
        }

        if (fragments.isEmpty()) {
            Map<String, Object> row = readRepository.findByPointId(pointId)
                    .orElseThrow(() -> new ApiNotFoundException("TagPoint not found"));
            return TagPointResponseBuilder.buildPointResponse(new LinkedHashMap<>(row), true, objectMapper);
        }
        fragments.add("updated_at = CURRENT_TIMESTAMP");
        writeRepository.updateDynamic(pointId, fragments, params);

        if (raw.containsKey("images")) {
            List<String> oldImages;
            try {
                oldImages = parseStringList(existing.get("images"), objectMapper);
            } catch (Exception e) {
                oldImages = List.of();
            }
            @SuppressWarnings("unchecked")
            List<String> newImages = raw.get("images") == null
                    ? List.of()
                    : ((List<?>) raw.get("images")).stream().map(String::valueOf).toList();
            for (String url : oldImages) {
                if (!newImages.contains(url)) {
                    fileStorageService.deleteUploadFile(url);
                }
            }
        }

        Map<String, Object> row = readRepository.findByPointId(pointId)
                .orElseThrow(() -> new ApiNotFoundException("TagPoint not found"));

        boolean cancelled = Boolean.TRUE.equals(existing.get("cancelled"));
        if (hasRealChanges && !cancelled) {
            List<String> recipients = writeRepository.findMemberUserIdsExceptOwner(pointId, String.valueOf(existing.get("user_id")));
            String titleStr = existing.get("title") == null ? "SpotYou" : String.valueOf(existing.get("title"));
            String img = TagPointResponseBuilder.firstImage(objectMapper, existing.get("images"), existing.get("image_url"));
            for (String rid : recipients) {
                pushSideEffectService.fireAndForget(
                        rid,
                        "spotyu_updated",
                        "SpotYou mis à jour",
                        "\"" + titleStr + "\" a été mis à jour par son créateur.",
                        Map.of(
                                "type", "spotyu_updated",
                                "point_id", pointId,
                                "sender_id", user.userId(),
                                "sender_name", user.name() == null ? "" : user.name(),
                                "sender_picture", user.picture() == null ? "" : user.picture(),
                                "action_text", "a mis à jour le SpotYou",
                                "content_title", titleStr,
                                "image_url", img
                        )
                );
            }
        }

        return TagPointResponseBuilder.buildPointResponse(new LinkedHashMap<>(row), true, objectMapper);
    }

    @Transactional
    public Map<String, Object> toggleNewDateComing(HttpServletRequest request, String pointId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> existing = writeRepository.findExistingForUpdate(pointId)
                .orElseThrow(() -> new ApiNotFoundException("TagPoint not found"));
        if (!String.valueOf(existing.get("user_id")).equals(user.userId()) && !"admin".equals(user.role())) {
            throw new ApiForbiddenException("Not authorized");
        }
        boolean current = Boolean.TRUE.equals(writeRepository.findNewDateComing(pointId).orElse(false));
        boolean newVal = !current;
        writeRepository.updateNewDateComing(pointId, newVal);
        return Map.of("new_date_coming", newVal);
    }

    private String toJson(Object v) {
        try {
            return objectMapper.writeValueAsString(v);
        } catch (JsonProcessingException e) {
            throw new ApiBadRequestException("Données invalides");
        }
    }

    private static Object normalizeJsonValue(Object val) {
        return val;
    }

    private static Object coerceUpdateScalar(String key, Object val) {
        if (("event_date".equals(key) || "event_end_date".equals(key)) && val instanceof String s) {
            return Timestamp.from(OffsetDateTime.parse(s).toInstant());
        }
        return val;
    }

    private static Integer asInt(Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof Number n) {
            return n.intValue();
        }
        return Integer.parseInt(String.valueOf(o));
    }

    private static Double popDouble(Map<String, Object> raw, String k) {
        Object v = raw.remove(k);
        if (v == null) {
            return null;
        }
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        return Double.parseDouble(String.valueOf(v));
    }

    private Map<String, Object> jsonNodeToMap(JsonNode n) {
        Map<String, Object> raw = new LinkedHashMap<>();
        n.fields().forEachRemaining(e -> {
            String k = e.getKey();
            if ("is_public".equals(k)) {
                return;
            }
            raw.put(k, treeToValue(e.getValue()));
        });
        return raw;
    }

    private Object treeToValue(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isBoolean()) {
            return node.booleanValue();
        }
        if (node.isInt()) {
            return node.intValue();
        }
        if (node.isLong()) {
            return node.longValue();
        }
        if (node.isDouble() || node.isFloat()) {
            return node.doubleValue();
        }
        if (node.isTextual()) {
            return node.asText();
        }
        if (node.isArray() || node.isObject()) {
            try {
                return objectMapper.readValue(node.traverse(), Object.class);
            } catch (Exception e) {
                return node.toString();
            }
        }
        return node.toString();
    }

    private void validateTitle(String title) {
        if (title == null || title.isBlank()) {
            throw new ApiBadRequestException("Le titre est obligatoire");
        }
    }

    private void validateEventSchedule(Map<String, Object> v) {
        if (v == null || !v.containsKey("schedule")) {
            return;
        }
        Object sched = v.get("schedule");
        if (!(sched instanceof Map<?, ?> m)) {
            return;
        }
        for (Object slotsObj : m.values()) {
            if (!(slotsObj instanceof List<?> slots)) {
                continue;
            }
            for (Object slot : slots) {
                if (slot instanceof String) {
                    continue;
                }
                if (slot instanceof Map<?, ?> sm) {
                    Object start = sm.get("start");
                    Object end = sm.get("end");
                    if (start != null && end != null) {
                        String s = String.valueOf(start);
                        String en = String.valueOf(end);
                        if (!s.isBlank() && !en.isBlank() && en.compareTo(s) <= 0) {
                            throw new ApiBadRequestException(
                                    "L'heure de fin (" + en + ") doit être après l'heure de début (" + s + ")"
                            );
                        }
                    }
                }
            }
        }
    }

    private static Timestamp parseTimestamp(String s) {
        if (s == null || s.isBlank()) {
            return null;
        }
        return Timestamp.from(OffsetDateTime.parse(s).toInstant());
    }

    private static List<String> parseStringList(Object raw, ObjectMapper om) throws java.io.IOException {
        if (raw == null) {
            return List.of();
        }
        if (raw instanceof List<?> l) {
            return l.stream().map(String::valueOf).toList();
        }
        if (raw instanceof String str) {
            if (str.isBlank() || "[]".equals(str.trim())) {
                return List.of();
            }
            return om.readValue(str, new TypeReference<List<String>>() {
            });
        }
        return List.of();
    }
}
