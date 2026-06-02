package com.spotu.modules.users.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.common.JsonbMedia;
import com.spotu.modules.users.dto.TagPointPublicDto;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;

@Component
public class NextSessionDateCalculator {

    private static final ZoneId PARIS_ZONE = ZoneId.of("Europe/Paris");
    private final ObjectMapper objectMapper;

    public NextSessionDateCalculator(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * Aligné sur {@code get_next_session_date(point)} dans {@code spot_you_routes.py} :
     * préfère {@code event_schedule} (weekly) puis {@code event_date} ponctuel.
     */
    public LocalDate computeFromPointMap(Map<String, Object> point) {
        TagPointPublicDto dto = new TagPointPublicDto();
        // Aligné sur spot_you_routes.get_next_session_date : uniquement event_schedule, pas schedule.
        Object es = point.get("event_schedule");
        es = JsonbMedia.unwrapPostgresJson(es);
        if (es instanceof String s && !s.isBlank()) {
            try {
                dto.setEventSchedule(objectMapper.readValue(s, Map.class));
            } catch (Exception ignored) {
                dto.setEventSchedule(null);
            }
        } else if (es instanceof Map<?, ?> m) {
            dto.setEventSchedule(m);
        }
        Object ed = point.get("event_date");
        if (ed != null) {
            dto.setEventDate(toIsoDateString(ed));
        }
        return compute(dto);
    }

    private static String toIsoDateString(Object ed) {
        if (ed instanceof java.sql.Date d) {
            return d.toLocalDate().toString();
        }
        if (ed instanceof java.time.LocalDate ld) {
            return ld.toString();
        }
        String s = String.valueOf(ed);
        if (s.length() >= 10) {
            return s.substring(0, 10);
        }
        return s;
    }

    public LocalDate compute(TagPointPublicDto point) {
        ZonedDateTime nowParis = ZonedDateTime.now(PARIS_ZONE);
        LocalDate today = nowParis.toLocalDate();

        Object scheduleObj = point.getEventSchedule();
        if (scheduleObj != null) {
            return computeFromWeeklySchedule(scheduleObj, nowParis, today);
        }

        String eventDate = point.getEventDate();
        if (eventDate != null && !eventDate.isBlank()) {
            try {
                LocalDate date = LocalDate.parse(eventDate.substring(0, 10));
                return date.isBefore(today) ? null : date;
            } catch (RuntimeException ignored) {
                return null;
            }
        }

        return null;
    }

    @SuppressWarnings("unchecked")
    private LocalDate computeFromWeeklySchedule(Object scheduleObj, ZonedDateTime nowParis, LocalDate today) {
        if (!(scheduleObj instanceof Map<?, ?> scheduleMap)) {
            return null;
        }
        Object type = scheduleMap.get("type");
        if (!"weekly".equals(type)) {
            return null;
        }
        Object weeklyRaw = scheduleMap.get("schedule");
        if (!(weeklyRaw instanceof Map<?, ?> weekly) || weekly.isEmpty()) {
            return null;
        }

        int todayWeekday = today.getDayOfWeek().getValue() - 1; // 0=lundi...6=dimanche
        LocalDate earliest = null;

        for (Map.Entry<?, ?> entry : weekly.entrySet()) {
            int dayIdx;
            try {
                dayIdx = Integer.parseInt(String.valueOf(entry.getKey()));
            } catch (NumberFormatException ignored) {
                continue;
            }
            if (!(entry.getValue() instanceof List<?> slots) || slots.isEmpty()) {
                continue;
            }
            String start = extractStart(slots.get(0));
            if (start == null) {
                continue;
            }
            LocalTime startTime;
            try {
                startTime = LocalTime.parse(start);
            } catch (DateTimeParseException ignored) {
                continue;
            }

            int daysUntil = Math.floorMod(dayIdx - todayWeekday, 7);
            if (daysUntil == 0) {
                ZonedDateTime sessionTime = nowParis.withHour(startTime.getHour())
                        .withMinute(startTime.getMinute())
                        .withSecond(0)
                        .withNano(0);
                if (!nowParis.isBefore(sessionTime)) {
                    daysUntil = 7;
                }
            }
            LocalDate candidate = today.plusDays(daysUntil);
            if (earliest == null || candidate.isBefore(earliest)) {
                earliest = candidate;
            }
        }

        return earliest;
    }

    @SuppressWarnings("unchecked")
    private String extractStart(Object firstSlot) {
        if (firstSlot instanceof String s) {
            return s;
        }
        if (firstSlot instanceof Map<?, ?> m) {
            Object start = m.get("start");
            if (start instanceof String s) {
                return s;
            }
        }
        return null;
    }
}
