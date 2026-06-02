package com.spotu.modules.notifications.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.auth.support.PythonIsoTimestamps;
import com.spotu.modules.notifications.dto.NotificationInboxItemDto;
import com.spotu.modules.notifications.infra.NotificationsRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class NotificationsService {

    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final NotificationsRepository repository;
    private final ObjectMapper objectMapper;
    private final NotifBroadcaster notifBroadcaster;

    public NotificationsService(
            NotificationsRepository repository,
            ObjectMapper objectMapper,
            NotifBroadcaster notifBroadcaster
    ) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.notifBroadcaster = notifBroadcaster;
    }

    public List<NotificationInboxItemDto> listInbox(String userId, int limit) {
        List<Map<String, Object>> rows = repository.listByUserId(userId, limit);
        List<NotificationInboxItemDto> out = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            Map<String, Object> data = parseData(row.get("data"));
            String senderId = asString(data.get("sender_id"));
            if (senderId != null && !senderId.isBlank()) {
                repository.findCurrentPictureByUserId(senderId).ifPresent(picture ->
                        data.put("sender_picture", picture)
                );
            }
            String imageUrl = asString(data.get("image_url"));
            String productId = asString(data.get("product_id"));
            if ((imageUrl == null || imageUrl.isBlank()) && productId != null && !productId.isBlank()) {
                repository.findMarketplaceImageByProductId(productId).ifPresent(img ->
                        data.put("image_url", img)
                );
            }
            out.add(new NotificationInboxItemDto(
                    asString(row.get("notif_id")),
                    asString(row.get("type")),
                    asString(row.get("title")),
                    asString(row.get("body")),
                    data,
                    asBoolean(row.get("read")),
                    toPythonIsoString(row.get("created_at"))
            ));
        }
        return out;
    }

    @Transactional
    public Map<String, Object> markRead(String userId, String notifId) {
        repository.markRead(notifId, userId);
        int unread = repository.countUnread(userId);
        safeNotify(userId, Map.of("type", "unread_notif", "count", unread));
        return Map.of("success", true, "unread_notif", unread);
    }

    public Map<String, Object> markAllRead(String userId) {
        repository.markAllRead(userId);
        safeNotify(userId, Map.of("type", "unread_notif", "count", 0));
        return Map.of("success", true);
    }

    private void safeNotify(String userId, Map<String, Object> payload) {
        try {
            notifBroadcaster.notify(userId, payload);
        } catch (Exception ignored) {
            // Fire-and-forget parity: la réponse HTTP n'est pas impactée.
        }
    }

    private Map<String, Object> parseData(Object raw) {
        if (raw == null) {
            return new LinkedHashMap<>();
        }
        if (raw instanceof String s) {
            if (s.isBlank()) {
                return new LinkedHashMap<>();
            }
            try {
                Object parsed = objectMapper.readValue(s, Object.class);
                if (parsed instanceof Map<?, ?> m) {
                    return new LinkedHashMap<>(objectMapper.convertValue(m, MAP_TYPE));
                }
                return new LinkedHashMap<>();
            } catch (Exception ignored) {
                return new LinkedHashMap<>();
            }
        }
        if (raw instanceof Map<?, ?> m) {
            // PostgreSQL JSONB via JDBC peut arriver comme {"type":"jsonb","value":"{...}"}.
            Object t = m.get("type");
            Object v = m.get("value");
            if (v instanceof String s && ("jsonb".equals(String.valueOf(t)) || "json".equals(String.valueOf(t)))) {
                return parseData(s);
            }
            return new LinkedHashMap<>(objectMapper.convertValue(m, MAP_TYPE));
        }
        try {
            Map<String, Object> converted = objectMapper.convertValue(raw, MAP_TYPE);
            return converted == null ? new LinkedHashMap<>() : new LinkedHashMap<>(converted);
        } catch (Exception ignored) {
            return new LinkedHashMap<>();
        }
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static boolean asBoolean(Object value) {
        if (value instanceof Boolean b) {
            return b;
        }
        if (value instanceof Number n) {
            return n.intValue() != 0;
        }
        return value != null && Boolean.parseBoolean(String.valueOf(value));
    }

    private static String toPythonIsoString(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Timestamp ts) {
            return PythonIsoTimestamps.fromTimestamp(ts);
        }
        if (value instanceof OffsetDateTime odt) {
            return odt.toInstant().toString().replace("Z", "+00:00");
        }
        if (value instanceof Instant instant) {
            return PythonIsoTimestamps.fromTimestamp(Timestamp.from(instant));
        }
        return String.valueOf(value);
    }
}
