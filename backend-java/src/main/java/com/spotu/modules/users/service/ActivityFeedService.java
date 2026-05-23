package com.spotu.modules.users.service;

import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.users.infra.ActivityFeedRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class ActivityFeedService {

    private static final String[] DAY_NAMES = {
            "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"
    };

    private final AuthMeService authMeService;
    private final ActivityFeedRepository repository;

    public ActivityFeedService(AuthMeService authMeService, ActivityFeedRepository repository) {
        this.authMeService = authMeService;
        this.repository = repository;
    }

    public Map<String, List<Map<String, Object>>> getActivityFeed(HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        Instant cutoffInstant = Instant.now().minus(30, ChronoUnit.DAYS);

        List<Map<String, String>> memberSpots = repository.findMemberSpotTitles(user.userId());
        if (memberSpots.isEmpty()) {
            return Map.of("activities", List.of());
        }

        Map<String, String> spotTitles = new LinkedHashMap<>();
        List<String> spotIds = new ArrayList<>();
        for (Map<String, String> row : memberSpots) {
            String spotId = row.get("spot_you_id");
            spotIds.add(spotId);
            spotTitles.put(spotId, row.get("title"));
        }

        List<Map<String, Object>> activities = new ArrayList<>();

        for (Map<String, Object> row : repository.findGoingActivities(spotIds, today)) {
            String spotId = String.valueOf(row.get("spot_you_id"));
            LocalDate sessionDate = parseSessionDate(row.get("session_date"));
            String dayLabel = dayLabel(sessionDate, today);
            Object createdAt = row.get("created_at");
            activities.add(activityItem(
                    "going",
                    String.valueOf(row.get("user_id")),
                    row.get("name"),
                    row.get("picture"),
                    "vient " + dayLabel,
                    sessionDate == null ? null : sessionDate.toString(),
                    spotId,
                    spotTitles.get(spotId),
                    createdAt != null ? String.valueOf(createdAt) : timestampFromSessionDate(sessionDate)
            ));
        }

        for (Map<String, Object> row : repository.findRecentJoins(
                spotIds,
                user.userId(),
                Timestamp.from(cutoffInstant)
        )) {
            String spotId = String.valueOf(row.get("spot_you_id"));
            activities.add(activityItem(
                    "joined",
                    String.valueOf(row.get("user_id")),
                    row.get("name"),
                    row.get("picture"),
                    "a rejoint",
                    null,
                    spotId,
                    spotTitles.get(spotId),
                    String.valueOf(row.get("joined_at"))
            ));
        }

        List<Map<String, Object>> unique = dedupe(activities);
        unique.sort((a, b) -> String.valueOf(b.get("timestamp")).compareTo(String.valueOf(a.get("timestamp"))));
        if (unique.size() > 30) {
            unique = unique.subList(0, 30);
        }
        return Map.of("activities", unique);
    }

    private static Map<String, Object> activityItem(
            String type,
            String userId,
            Object name,
            Object picture,
            String actionText,
            String sessionDate,
            String spotYouId,
            String spotYouTitle,
            String timestamp
    ) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("type", type);
        item.put("user_id", userId);
        item.put("name", name);
        item.put("picture", picture);
        item.put("action_text", actionText);
        item.put("session_date", sessionDate);
        item.put("spot_you_id", spotYouId);
        item.put("spot_you_title", spotYouTitle == null ? "" : spotYouTitle);
        item.put("timestamp", timestamp);
        return item;
    }

    private static List<Map<String, Object>> dedupe(List<Map<String, Object>> activities) {
        Set<String> seen = new HashSet<>();
        List<Map<String, Object>> unique = new ArrayList<>();
        for (Map<String, Object> activity : activities) {
            String key = activity.get("user_id")
                    + "|" + activity.get("type")
                    + "|" + activity.get("session_date")
                    + "|" + activity.get("spot_you_id");
            if (seen.add(key)) {
                unique.add(activity);
            }
        }
        return unique;
    }

    private static LocalDate parseSessionDate(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof LocalDate ld) {
            return ld;
        }
        return LocalDate.parse(String.valueOf(raw));
    }

    private static String dayLabel(LocalDate sessionDate, LocalDate today) {
        if (sessionDate == null) {
            return "";
        }
        int daysDiff = (int) (sessionDate.toEpochDay() - today.toEpochDay());
        if (daysDiff == 0) {
            return "aujourd'hui";
        }
        if (daysDiff == 1) {
            return "demain";
        }
        return DAY_NAMES[sessionDate.getDayOfWeek().getValue() - 1];
    }

    /** Aligné Python quand {@code created_at} absent côté JDBC (tests H2). */
    private static String timestampFromSessionDate(LocalDate sessionDate) {
        if (sessionDate == null) {
            return Instant.now().toString();
        }
        return sessionDate.atStartOfDay(ZoneOffset.UTC).toInstant().toString();
    }
}
