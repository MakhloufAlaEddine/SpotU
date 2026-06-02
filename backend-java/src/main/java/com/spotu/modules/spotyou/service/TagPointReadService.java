package com.spotu.modules.spotyou.service;

import com.spotu.error.ApiNotFoundException;
import com.spotu.error.ApiBadRequestException;
import com.spotu.error.ApiForbiddenException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.auth.service.JwtService;
import com.spotu.modules.auth.service.TokenExtractor;
import com.spotu.modules.auth.support.PythonIsoTimestamps;
import com.spotu.modules.auth.infra.UserMeRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.spotyou.infra.TagPointReadRepository;
import com.spotu.modules.spotyou.support.TagPointResponseBuilder;
import com.spotu.modules.users.util.NextSessionDateCalculator;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;

@Service
public class TagPointReadService {

    private static final int DEFAULT_RADIUS_M = 5000;

    private final TagPointReadRepository repository;
    private final JwtService jwtService;
    private final UserMeRepository userMeRepository;
    private final AuthMeService authMeService;
    private final NextSessionDateCalculator nextSessionDateCalculator;
    private final ObjectMapper objectMapper;

    public TagPointReadService(
            TagPointReadRepository repository,
            JwtService jwtService,
            UserMeRepository userMeRepository,
            AuthMeService authMeService,
            NextSessionDateCalculator nextSessionDateCalculator,
            ObjectMapper objectMapper
    ) {
        this.repository = repository;
        this.jwtService = jwtService;
        this.userMeRepository = userMeRepository;
        this.authMeService = authMeService;
        this.nextSessionDateCalculator = nextSessionDateCalculator;
        this.objectMapper = objectMapper;
    }

    /**
     * Comportement équivalent à la détection d’utilisateur dans {@code search_tag_points} Python :
     * token absent / invalide / user inconnu → anonyme (pas d’exception).
     */
    public Optional<String> optionalUserId(HttpServletRequest request) {
        try {
            String raw = TokenExtractor.fromRequest(request);
            if (raw == null || raw.isEmpty()) {
                return Optional.empty();
            }
            String userId = jwtService.extractUserId(raw);
            return userMeRepository.findByUserId(userId).map(u -> u.userId());
        } catch (Exception ignored) {
            return Optional.empty();
        }
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> search(
            HttpServletRequest request,
            Double lat,
            Double lng,
            Integer radius,
            String domainId,
            String tagIdsCsv
    ) {
        Optional<String> uidOpt = optionalUserId(request);
        String currentUserId = uidOpt.orElse(null);
        int r = radius == null ? DEFAULT_RADIUS_M : radius;
        List<String> tagIds = parseCommaSeparated(tagIdsCsv);
        List<Map<String, Object>> rows = repository.search(lat, lng, r, domainId, tagIds, currentUserId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> copy = new LinkedHashMap<>(row);
            boolean owner = currentUserId != null && currentUserId.equals(String.valueOf(copy.get("user_id")));
            Map<String, Object> pt = TagPointResponseBuilder.buildPointResponse(copy, owner, objectMapper);
            if (!owner) {
                String prec = pt.get("precision") == null ? "exact" : String.valueOf(pt.get("precision"));
                if ("100m".equals(prec) || "1000m".equals(prec)) {
                    applyNonOwnerPrecisionToLatLng(pt, prec, null);
                }
            }
            out.add(pt);
        }
        return out;
    }

    /** Python : {@code apply_precision_offset} sans seed sur la recherche. */
    private void applyNonOwnerPrecisionToLatLng(Map<String, Object> pt, String precision, String seed) {
        Object la = pt.get("latitude");
        Object lo = pt.get("longitude");
        if (la == null || lo == null) {
            return;
        }
        double lat = toDouble(la);
        double lng = toDouble(lo);
        double[] o = TagPointResponseBuilder.applyPrecisionOffset(lat, lng, precision, seed);
        pt.put("latitude", o[0]);
        pt.put("longitude", o[1]);
        pt.put("location", Map.of("type", "Point", "coordinates", List.of(o[1], o[0])));
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> mine(HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String userId = user.userId();
        List<Map<String, Object>> rows = repository.findMine(userId);
        List<Map<String, Object>> points = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            points.add(TagPointResponseBuilder.buildPointResponse(new LinkedHashMap<>(row), true, objectMapper));
        }
        if (points.isEmpty()) {
            return points;
        }
        List<String> pointIds = points.stream().map(p -> String.valueOf(p.get("point_id"))).toList();
        Map<String, Integer> partMap = repository.batchParticipantsCount(pointIds);
        Map<String, LocalDate> nextDates = new LinkedHashMap<>();
        for (Map<String, Object> pt : points) {
            nextDates.put(String.valueOf(pt.get("point_id")), nextSessionDateCalculator.computeFromPointMap(pt));
        }
        List<String> pidsWithNext = nextDates.entrySet().stream()
                .filter(e -> e.getValue() != null)
                .map(Map.Entry::getKey)
                .toList();
        Map<String, Integer> goingByPoint = new LinkedHashMap<>();
        Map<String, Boolean> isGoingByPoint = new LinkedHashMap<>();
        if (!pidsWithNext.isEmpty()) {
            Map<String, Map<String, Integer>> goingCounts = repository.batchGoingCountsBySession(pidsWithNext);
            List<Map<String, Object>> userGoingRows = repository.batchUserGoingRows(pidsWithNext, userId);
            for (String pid : pidsWithNext) {
                LocalDate nd = nextDates.get(pid);
                if (nd == null) {
                    continue;
                }
                String ndKey = nd.toString();
                int gc = goingCounts.getOrDefault(pid, Map.of()).getOrDefault(ndKey, 0);
                goingByPoint.put(pid, gc);
                boolean ig = false;
                for (Map<String, Object> gr : userGoingRows) {
                    if (pid.equals(String.valueOf(gr.get("spot_you_id")))
                            && ndKey.equals(TagPointReadRepository.sessionDateKey(gr.get("session_date")))) {
                        ig = true;
                        break;
                    }
                }
                isGoingByPoint.put(pid, ig);
            }
        }
        for (Map<String, Object> pt : points) {
            String pid = String.valueOf(pt.get("point_id"));
            pt.put("participants_count", partMap.getOrDefault(pid, 0));
            pt.put("can_participate", true);
            LocalDate nd = nextDates.get(pid);
            pt.put("next_session_date", nd == null ? null : nd.toString());
            pt.put("going_count", goingByPoint.getOrDefault(pid, 0));
            pt.put("is_going", isGoingByPoint.getOrDefault(pid, false));
            Object maxP = pt.get("maximum_participants");
            int gc = (int) pt.get("going_count");
            pt.put("is_full", maxP != null && ((Number) maxP).intValue() <= gc);
        }
        return points;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> myEvents(HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String userId = user.userId();
        List<Map<String, Object>> rows = repository.findMemberEvents(userId);
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> copy = new LinkedHashMap<>(row);
            Object joinedAt = copy.remove("joined_at");
            copy.remove("sort_date");
            boolean isOwner = userId.equals(String.valueOf(copy.get("user_id")));
            Map<String, Object> pt = TagPointResponseBuilder.buildPointResponse(copy, isOwner, objectMapper);
            pt.put("joined_at", formatJoinedAt(joinedAt));
            boolean canParticipate = copy.get("event_schedule") != null || copy.get("event_date") != null;
            pt.put("can_participate", canParticipate);
            if (copy.get("event_schedule") != null) {
                LocalDate nd = nextSessionDateCalculator.computeFromPointMap(pt);
                pt.put("next_session_date", nd == null ? null : nd.toString());
            }
            result.add(pt);
        }
        return result;
    }

    private static String formatJoinedAt(Object joinedAt) {
        if (joinedAt == null) {
            return null;
        }
        return String.valueOf(joinedAt);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> saved(HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String userId = user.userId();
        List<Map<String, Object>> rows = repository.findSaved(userId);
        List<Map<String, Object>> points = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            points.add(TagPointResponseBuilder.buildPointResponse(new LinkedHashMap<>(row), false, objectMapper));
        }
        if (points.isEmpty()) {
            return points;
        }
        List<String> pointIds = points.stream().map(p -> String.valueOf(p.get("point_id"))).toList();
        Map<String, Integer> partMap = repository.batchParticipantsCount(pointIds);
        Map<String, Double[]> voteAgg = repository.batchVoteStatsForPoints(pointIds);
        List<String> memberAny = repository.spotIdsWhereUserHasMembershipAnyStatus(pointIds, userId);
        java.util.Set<String> memberSet = new java.util.HashSet<>(memberAny);
        Map<String, LocalDate> nextDates = new LinkedHashMap<>();
        for (Map<String, Object> pt : points) {
            nextDates.put(String.valueOf(pt.get("point_id")), nextSessionDateCalculator.computeFromPointMap(pt));
        }
        List<String> needGoing = pointIds.stream().filter(memberSet::contains)
                .filter(pid -> nextDates.get(pid) != null).toList();
        Map<String, Integer> goingForNext = new LinkedHashMap<>();
        Map<String, Boolean> isGoingForNext = new LinkedHashMap<>();
        if (!needGoing.isEmpty()) {
            Map<String, Map<String, Integer>> goingCounts = repository.batchGoingCountsBySession(needGoing);
            List<Map<String, Object>> userGoingRows = repository.batchUserGoingRows(needGoing, userId);
            for (String pid : needGoing) {
                LocalDate nd = nextDates.get(pid);
                String ndKey = nd.toString();
                goingForNext.put(pid, goingCounts.getOrDefault(pid, Map.of()).getOrDefault(ndKey, 0));
                boolean ig = false;
                for (Map<String, Object> gr : userGoingRows) {
                    if (pid.equals(String.valueOf(gr.get("spot_you_id")))
                            && ndKey.equals(TagPointReadRepository.sessionDateKey(gr.get("session_date")))) {
                        ig = true;
                        break;
                    }
                }
                isGoingForNext.put(pid, ig);
            }
        }
        for (Map<String, Object> pt : points) {
            String pid = String.valueOf(pt.get("point_id"));
            pt.put("participants_count", partMap.getOrDefault(pid, 0));
            Double[] rv = voteAgg.get(pid);
            if (rv != null) {
                pt.put("rating", rv[0]);
                pt.put("vote_count", rv[1].intValue());
            } else {
                pt.put("rating", 0.0);
                pt.put("vote_count", 0);
            }
            pt.put("is_saved", true);
            boolean isMember = memberSet.contains(pid);
            pt.put("can_participate", isMember);
            LocalDate nd = nextDates.get(pid);
            pt.put("next_session_date", nd == null ? null : nd.toString());
            if (isMember && nd != null) {
                int going = goingForNext.getOrDefault(pid, 0);
                pt.put("going_count", going);
                pt.put("is_going", isGoingForNext.getOrDefault(pid, false));
                Object maxP = pt.get("maximum_participants");
                pt.put("is_full", maxP != null && ((Number) maxP).intValue() <= going);
            } else {
                pt.put("going_count", null);
                pt.put("is_going", false);
                pt.put("is_full", false);
            }
        }
        return points;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> detail(HttpServletRequest request, String pointId) {
        Optional<String> uidOpt = optionalUserId(request);
        String currentUserId = uidOpt.orElse(null);
        Map<String, Object> row = repository.findByPointId(pointId)
                .orElseThrow(() -> new ApiNotFoundException("TagPoint not found"));
        boolean isOwner = currentUserId != null && currentUserId.equals(String.valueOf(row.get("user_id")));
        if (!truthy(row.get("active")) && !isOwner) {
            throw new ApiNotFoundException("SpotYou non disponible");
        }
        Map<String, Object> pt = TagPointResponseBuilder.buildPointResponse(new LinkedHashMap<>(row), isOwner, objectMapper);
        List<String> tagIdsList = repository.parseTagIdList(pt.get("tag_ids"));
        pt.put("tag_ids", tagIdsList);
        LocalDate nextDate = nextSessionDateCalculator.computeFromPointMap(pt);
        pt.put("next_session_date", nextDate == null ? null : nextDate.toString());
        pt.put("going_count", null);
        pt.put("is_full", false);
        pt.put("can_participate", false);
        pt.put("is_participant", false);
        pt.put("is_member", false);
        pt.put("is_going", false);
        pt.put("is_saved", false);

        List<Map<String, Object>> tags = repository.findTagDetails(tagIdsList);
        Map<String, Object> voteStats = repository.fetchVoteStats(pointId);
        List<Map<String, Object>> distRows = repository.fetchVoteDistribution(pointId);
        int memberCount = repository.countAcceptedMembers(pointId);
        pt.put("tags", tags);
        putVoteFields(pt, voteStats, distRows);
        pt.put("participants_count", memberCount);

        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            try {
                CurrentUserDto u = authMeService.requireCurrentUser(request);
                String uid = u.userId();
                Optional<String> memberStatus = repository.findMemberStatus(pointId, uid);
                String status = memberStatus.orElse(null);
                boolean isParticipant = "accepted".equals(status);
                pt.put("is_participant", isParticipant);
                pt.put("is_member", isParticipant);
                pt.put("can_participate", isParticipant);
                pt.put("join_status", status);
                boolean isGoing = false;
                if (nextDate != null) {
                    isGoing = repository.existsGoingForUserSession(
                            pointId, uid, java.sql.Date.valueOf(nextDate));
                }
                pt.put("is_going", isGoing);
                pt.put("is_saved", repository.existsSaved(pointId, uid));
                if (isParticipant && nextDate != null) {
                    int goingCount = repository.countGoingForSession(pointId, java.sql.Date.valueOf(nextDate));
                    pt.put("going_count", goingCount);
                    Object maxP = pt.get("maximum_participants");
                    pt.put("is_full", maxP != null && ((Number) maxP).intValue() <= goingCount);
                }
            } catch (Exception ignored) {
                // Équivalent Python: except pass sur la branche auth du détail.
            }
        }
        return pt;
    }

    private void putVoteFields(Map<String, Object> pt, Map<String, Object> voteStats, List<Map<String, Object>> distRows) {
        double rating = 0;
        int votes = 0;
        if (voteStats != null && !voteStats.isEmpty()) {
            Object ar = voteStats.get("avg_rating");
            if (ar instanceof Number n) {
                rating = n.doubleValue();
            }
            Object vc = voteStats.get("vote_count");
            if (vc instanceof Number n) {
                votes = n.intValue();
            }
        }
        pt.put("rating", rating);
        pt.put("votes", votes);
        Map<String, Object> dist = new LinkedHashMap<>();
        for (Map<String, Object> r : distRows) {
            int rkInt = r.get("rating") instanceof Number n ? n.intValue() : 0;
            int cnt = r.get("cnt") instanceof Number n ? n.intValue() : 0;
            dist.put(String.valueOf(rkInt), cnt);
        }
        pt.put("rating_distribution", dist);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> similar(HttpServletRequest request, String pointId) {
        Optional<String> uidOpt = optionalUserId(request);
        List<Map<String, Object>> rows = repository.findSimilar(pointId, uidOpt.orElse(null));
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> copy = new LinkedHashMap<>(row);
            Object distM = copy.remove("dist_m");
            boolean owner = uidOpt.map(id -> id.equals(String.valueOf(copy.get("user_id")))).orElse(false);
            Map<String, Object> pt = TagPointResponseBuilder.buildPointResponse(copy, owner, objectMapper);
            if (distM != null) {
                pt.put("dist_m", distM instanceof Number n ? n.doubleValue() : toDouble(distM));
            }
            out.add(pt);
        }
        return out;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> participants(String pointId) {
        List<Map<String, Object>> rows = repository.listParticipants(pointId);
        for (Map<String, Object> row : rows) {
            Object ic = row.get("is_creator");
            boolean b = Boolean.TRUE.equals(ic) || (ic instanceof Number n && n.intValue() != 0);
            row.put("is_creator", b);
        }
        return rows;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> myVote(HttpServletRequest request, String pointId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Optional<Map<String, Object>> row = repository.findMyVote(pointId, user.userId());
        if (row.isEmpty()) {
            return Map.of("exists", false, "rating", 0, "comment", null);
        }
        Map<String, Object> out = new LinkedHashMap<>(row.get());
        out.put("exists", true);
        return out;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> votes(String pointId) {
        return repository.listVotes(pointId);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> pendingRequests(HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        List<Map<String, Object>> rows = repository.findPendingRequests(user.userId());
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> copy = new LinkedHashMap<>(row);
            Object reqAt = copy.get("requested_at");
            copy.put("requested_at", toIsoOrNull(reqAt));
            Map<String, Object> pt = TagPointResponseBuilder.buildPointResponse(copy, false, objectMapper);
            pt.put("join_status", "pending");
            out.add(pt);
        }
        return out;
    }

    private static String toIsoOrNull(Object requestedAt) {
        if (requestedAt instanceof Timestamp ts) {
            return PythonIsoTimestamps.fromTimestamp(ts);
        }
        return requestedAt == null ? null : String.valueOf(requestedAt);
    }

    private static boolean truthy(Object active) {
        return active instanceof Boolean b && b;
    }

    private static double toDouble(Object v) {
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        return Double.parseDouble(String.valueOf(v));
    }

    private static List<String> parseCommaSeparated(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Stream.of(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    @Transactional(readOnly = true)
    public Map<String, Object> myCompletionStats(HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String userId = user.userId();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("is_community_member", repository.isCommunityMember(userId));
        body.put("has_participation", repository.hasGoingParticipation(userId));
        return body;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getGoingForNextSession(String pointId) {
        Map<String, Object> point = repository.findActivePointForGoing(pointId)
                .orElseThrow(() -> new ApiNotFoundException("SpotYou introuvable"));
        LocalDate nextDate = nextSessionDateCalculator.computeFromPointMap(point);
        if (nextDate == null) {
            return Map.of("session_date", null, "going", List.of());
        }
        List<Map<String, Object>> rows = repository.listGoingUsersForSession(pointId, Date.valueOf(nextDate));
        List<Map<String, Object>> going = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("user_id", r.get("user_id"));
            m.put("name", r.get("name"));
            m.put("picture", r.get("picture"));
            m.put("role", r.get("role"));
            m.put("registered_at", toIsoOrNull(r.get("registered_at")));
            going.add(m);
        }
        return Map.of("session_date", nextDate.toString(), "going", going);
    }

    @Transactional
    public Map<String, Object> markGoing(String pointId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String userId = user.userId();
        Map<String, Object> point = repository.findActivePointForGoing(pointId)
                .orElseThrow(() -> new ApiNotFoundException("SpotYou introuvable"));

        if (!repository.hasMembershipAnyStatus(pointId, userId)) {
            throw new ApiForbiddenException("Vous devez rejoindre ce SpotYou avant de pouvoir participer à une séance");
        }

        LocalDate nextDate = nextSessionDateCalculator.computeFromPointMap(point);
        if (nextDate == null) {
            throw new ApiBadRequestException("Pas de prochaine séance trouvée");
        }
        Date nextSqlDate = Date.valueOf(nextDate);
        Object maxObj = point.get("maximum_participants");
        Integer max = maxObj instanceof Number n ? n.intValue() : null;

        boolean alreadyGoing = repository.existsGoingForUserSession(pointId, userId, nextSqlDate);
        if (!alreadyGoing && max != null) {
            int goingCount = repository.countGoingForSession(pointId, nextSqlDate);
            if (goingCount >= max) {
                throw new ApiBadRequestException("Capacité maximale atteinte pour cette séance");
            }
        }

        int updated = repository.updateAttendanceToGoing(pointId, userId, nextSqlDate);
        if (updated == 0) {
            repository.insertAttendanceGoing(pointId, userId, nextSqlDate);
        }

        int goingCountFinal = repository.countGoingForSession(pointId, nextSqlDate);
        int membersCountFinal = repository.countMembersAnyStatus(pointId);
        boolean isFull = max != null && goingCountFinal >= max;

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("success", true);
        out.put("is_going", true);
        out.put("is_member", true);
        out.put("going_count", goingCountFinal);
        out.put("participants_count", membersCountFinal);
        out.put("session_date", nextDate.toString());
        out.put("is_full", isFull);
        return out;
    }

    @Transactional
    public Map<String, Object> unmarkGoing(String pointId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String userId = user.userId();
        Map<String, Object> point = repository.findActivePointForGoing(pointId)
                .orElseThrow(() -> new ApiNotFoundException("SpotYou introuvable"));

        LocalDate nextDate = nextSessionDateCalculator.computeFromPointMap(point);
        int goingCountFinal = 0;
        boolean isFull = false;
        if (nextDate != null) {
            Date nextSqlDate = Date.valueOf(nextDate);
            repository.deleteAttendanceForSession(pointId, userId, nextSqlDate);
            goingCountFinal = repository.countGoingForSession(pointId, nextSqlDate);
            Object maxObj = point.get("maximum_participants");
            Integer max = maxObj instanceof Number n ? n.intValue() : null;
            isFull = max != null && goingCountFinal >= max;
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("success", true);
        out.put("is_going", false);
        out.put("going_count", goingCountFinal);
        out.put("is_full", isFull);
        out.put("session_date", nextDate == null ? null : nextDate.toString());
        return out;
    }
}
