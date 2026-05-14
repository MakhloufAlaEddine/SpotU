package com.spotu.modules.home.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.common.JsonbMedia;
import com.spotu.modules.home.infra.HomeRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class HomeService {

    private static final int[] RADIUS_STEPS = {50_000, 100_000, 200_000, 500_000};
    private static final int MIN_RESULTS = 3;

    private final HomeRepository homeRepository;
    private final ObjectMapper objectMapper;

    public HomeService(HomeRepository homeRepository, ObjectMapper objectMapper) {
        this.homeRepository = homeRepository;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> nearestSector(Double lat, Double lng, String currentUserId) {
        var nearest = homeRepository.findNearestActiveSpot(lat, lng, currentUserId);
        if (nearest.isEmpty()) {
            return null;
        }
        var n = nearest.get();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("lat", n.nearLat());
        out.put("lng", n.nearLng());
        out.put("distance_km", round1(n.distanceM() / 1000.0));
        out.put("spot_count", homeRepository.countSpotsAround(n.nearLat(), n.nearLng()));
        return out;
    }

    public Map<String, Object> feed(Double lat, Double lng, String currentUserId) {
        List<String> userTags = List.of();
        Set<String> memberIds = Set.of();
        if (currentUserId != null && !currentUserId.isBlank()) {
            userTags = parseTags(homeRepository.findUserCoachTags(currentUserId).stream().findFirst().orElse(null));
            memberIds = homeRepository.findMemberSpotIds(currentUserId);
        }

        int actualRadius = RADIUS_STEPS[0];
        List<Map<String, Object>> rawSpots = List.of();
        List<Map<String, Object>> rawServices = List.of();

        for (int radius : RADIUS_STEPS) {
            actualRadius = radius;
            rawSpots = normalizeSpots(homeRepository.findSpots(currentUserId, lat, lng, radius));
            if (currentUserId != null && !currentUserId.isBlank() && !rawSpots.isEmpty()) {
                List<String> ids = rawSpots.stream().map(s -> asString(s.get("point_id"))).toList();
                Set<String> goingIds = homeRepository.findGoingSpotIds(ids, currentUserId);
                for (Map<String, Object> s : rawSpots) {
                    s.put("is_going", goingIds.contains(asString(s.get("point_id"))));
                }
            }
            rawServices = normalizeServices(homeRepository.findServices(currentUserId, lat, lng, radius));
            if (rawSpots.size() + rawServices.size() >= MIN_RESULTS) {
                break;
            }
        }

        boolean hasPersonalization = !userTags.isEmpty() || !memberIds.isEmpty();
        boolean isExpanded = actualRadius > RADIUS_STEPS[0];

        double maxDistSpot = rawSpots.stream().mapToDouble(s -> asDouble(s.get("distance"), 0)).max().orElse(1);
        if (maxDistSpot == 0) {
            maxDistSpot = 1;
        }
        double maxPopSpot = rawSpots.stream()
                .mapToDouble(s -> asInt(s.get("going_count")) + asInt(s.get("participants_count")))
                .max()
                .orElse(1);
        if (maxPopSpot == 0) {
            maxPopSpot = 1;
        }
        double maxDistSvc = rawServices.stream().mapToDouble(s -> asDouble(s.get("distance"), 0)).max().orElse(1);
        if (maxDistSvc == 0) {
            maxDistSvc = 1;
        }
        double maxPopSvc = rawServices.stream().mapToDouble(s -> asInt(s.get("booking_count"))).max().orElse(1);
        if (maxPopSvc == 0) {
            maxPopSvc = 1;
        }

        for (Map<String, Object> s : rawSpots) {
            s.put("_score", scoreSpot(s, userTags, memberIds, maxDistSpot, maxPopSpot));
        }
        for (Map<String, Object> s : rawServices) {
            s.put("_score", scoreService(s, userTags, maxDistSvc, maxPopSvc));
        }

        List<Map<String, Object>> spotSorted = rawSpots.stream()
                .sorted(Comparator.comparingDouble(m -> -asDouble(m.get("_score"), 0)))
                .toList();
        List<Map<String, Object>> serviceSorted = rawServices.stream()
                .sorted(Comparator.comparingDouble(m -> -asDouble(m.get("_score"), 0)))
                .toList();

        for (Map<String, Object> s : spotSorted) {
            s.remove("_score");
        }
        for (Map<String, Object> s : serviceSorted) {
            s.remove("_score");
            Map<String, Object> coach = new LinkedHashMap<>();
            coach.put("user_id", s.get("coach_id"));
            coach.put("name", s.remove("coach_name"));
            coach.put("picture", s.remove("coach_picture"));
            s.put("coach", coach);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("spotyou", limit(spotSorted, 30));
        out.put("services", limit(serviceSorted, 20));
        out.put("actual_radius_km", actualRadius / 1000);
        out.put("is_expanded", isExpanded);
        out.put("has_personalization", hasPersonalization);
        out.put("total_count", spotSorted.size() + serviceSorted.size());
        return out;
    }

    public String extractOptionalUserId(HttpServletRequest request) {
        try {
            Object attr = request.getAttribute("jwt_payload");
            if (attr instanceof Map<?, ?> payload) {
                Object uid = payload.get("user_id");
                return uid == null ? null : String.valueOf(uid);
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private List<Map<String, Object>> normalizeSpots(List<Map<String, Object>> spots) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> s : spots) {
            Map<String, Object> d = new LinkedHashMap<>(s);
            d.put("tag_ids", parseTags(d.get("tag_ids")));
            d.put("is_going", false);
            List<String> imgs = JsonbMedia.normalizeImageUrls(objectMapper, d.get("images"), d.get("image_url"));
            d.put("images", imgs);
            d.remove("image_url");
            envelopSpotOwner(d);
            out.add(d);
        }
        return out;
    }

    private List<Map<String, Object>> normalizeServices(List<Map<String, Object>> services) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> s : services) {
            Map<String, Object> d = new LinkedHashMap<>(s);
            d.put("tag_ids", parseTags(d.get("tag_ids")));
            d.put("images", JsonbMedia.normalizeImageUrls(objectMapper, d.get("images"), null));
            out.add(d);
        }
        return out;
    }

    private void envelopSpotOwner(Map<String, Object> d) {
        Object ownerName = d.remove("owner_name");
        Object ownerPicture = d.remove("owner_picture");
        d.remove("owner_role");
        Map<String, Object> owner = new LinkedHashMap<>();
        owner.put("user_id", d.get("user_id"));
        owner.put("name", ownerName);
        owner.put("picture", ownerPicture);
        d.put("owner", owner);
    }

    private double scoreSpot(Map<String, Object> spot, List<String> userTags, Set<String> memberIds, double maxDist, double maxPop) {
        double score = 0.0;
        List<String> spotTags = parseTags(spot.get("tag_ids"));
        long common = spotTags.stream().filter(userTags::contains).distinct().count();
        score += Math.min(common * 20, 40);
        double pop = asInt(spot.get("going_count")) + asInt(spot.get("participants_count"));
        if (maxPop > 0) {
            score += (pop / maxPop) * 30.0;
        }
        double dist = asDouble(spot.get("distance"), maxDist);
        if (maxDist > 0) {
            score += ((maxDist - Math.min(dist, maxDist)) / maxDist) * 30.0;
        }
        if (memberIds.contains(asString(spot.get("point_id")))) {
            score += 20.0;
        }
        return score;
    }

    private double scoreService(Map<String, Object> svc, List<String> userTags, double maxDist, double maxPop) {
        double score = 0.0;
        List<String> tags = parseTags(svc.get("tag_ids"));
        long common = tags.stream().filter(userTags::contains).distinct().count();
        score += Math.min(common * 20, 40);
        double pop = asInt(svc.get("booking_count"));
        if (maxPop > 0) {
            score += (pop / maxPop) * 30.0;
        }
        double dist = asDouble(svc.get("distance"), maxDist);
        if (maxDist > 0) {
            score += ((maxDist - Math.min(dist, maxDist)) / maxDist) * 30.0;
        }
        return score;
    }

    private List<String> parseTags(Object raw) {
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
                List<Object> v = objectMapper.readValue(s, new TypeReference<>() {
                });
                return v.stream().map(String::valueOf).toList();
            } catch (Exception ignored) {
                return List.of();
            }
        }
        return List.of();
    }

    private static List<Map<String, Object>> limit(List<Map<String, Object>> in, int max) {
        if (in.size() <= max) {
            return in;
        }
        return in.subList(0, max);
    }

    private static int asInt(Object v) {
        if (v instanceof Number n) {
            return n.intValue();
        }
        if (v == null) {
            return 0;
        }
        try {
            return Integer.parseInt(String.valueOf(v));
        } catch (Exception e) {
            return 0;
        }
    }

    private static double asDouble(Object v, double fallback) {
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        if (v == null) {
            return fallback;
        }
        try {
            return Double.parseDouble(String.valueOf(v));
        } catch (Exception e) {
            return fallback;
        }
    }

    private static String asString(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}

