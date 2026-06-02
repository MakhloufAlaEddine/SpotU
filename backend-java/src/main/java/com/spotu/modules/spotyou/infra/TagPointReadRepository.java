package com.spotu.modules.spotyou.infra;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSetMetaData;
import java.sql.Date;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Repository
public class TagPointReadRepository {

    public static final String TP_FIELDS_POSTGIS = """
            tp.point_id, tp.user_id, tp.title, tp.description,
            tp.precision, tp.tag_ids, tp.domain_id, tp.active, tp.cancelled, tp.expires_at, tp.created_at, tp.updated_at,
            tp.image_url, tp.images, tp.schedule, tp.event_date, tp.event_end_date, tp.event_schedule, tp.new_date_coming,
            tp.minimum_participants, tp.maximum_participants, tp.address, tp.media_purge_scheduled_at,
            tp.visibility_type, tp.join_mode, tp.invite_permissions, tp.max_community_members,
            ST_Y(tp.location::geometry) AS latitude,
            ST_X(tp.location::geometry) AS longitude,
            u.name AS owner_name, u.picture AS owner_picture, u.role AS owner_role,
            COALESCE((SELECT ROUND(AVG(v.rating), 1) FROM tag_point_votes v WHERE v.point_id = tp.point_id), 0) AS rating,
            COALESCE((SELECT COUNT(*) FROM tag_point_votes v WHERE v.point_id = tp.point_id), 0) AS vote_count,
            COALESCE((SELECT COUNT(*) FROM spot_you_members sm WHERE sm.spot_you_id = tp.point_id AND sm.status = 'accepted'), 0) AS participants_count
            """;

    public static final String TP_FIELDS_FALLBACK = """
            tp.point_id, tp.user_id, tp.title, tp.description,
            tp.precision, tp.tag_ids, tp.domain_id, tp.active, tp.cancelled, tp.expires_at, tp.created_at, tp.updated_at,
            tp.image_url, tp.images, tp.schedule, tp.event_date, tp.event_end_date, tp.event_schedule, tp.new_date_coming,
            tp.minimum_participants, tp.maximum_participants, tp.address, tp.media_purge_scheduled_at,
            tp.visibility_type, tp.join_mode, tp.invite_permissions, tp.max_community_members,
            tp.latitude AS latitude,
            tp.longitude AS longitude,
            u.name AS owner_name, u.picture AS owner_picture, u.role AS owner_role,
            COALESCE((SELECT ROUND(AVG(v.rating), 1) FROM tag_point_votes v WHERE v.point_id = tp.point_id), 0) AS rating,
            COALESCE((SELECT COUNT(*) FROM tag_point_votes v WHERE v.point_id = tp.point_id), 0) AS vote_count,
            COALESCE((SELECT COUNT(*) FROM spot_you_members sm WHERE sm.spot_you_id = tp.point_id AND sm.status = 'accepted'), 0) AS participants_count
            """;

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public TagPointReadRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    private List<Map<String, Object>> selectWithTpFields(String fromWhereOrder, List<Object> params) {
        try {
            return queryForListOfMaps("SELECT " + TP_FIELDS_POSTGIS + fromWhereOrder, params);
        } catch (DataAccessException e) {
            return queryForListOfMaps("SELECT " + TP_FIELDS_FALLBACK + fromWhereOrder, params);
        }
    }

    public List<Map<String, Object>> search(
            Double lat,
            Double lng,
            int radiusMeters,
            String domainId,
            List<String> tagIds,
            String currentUserId
    ) {
        try {
            return searchPostgis(lat, lng, radiusMeters, domainId, tagIds, currentUserId);
        } catch (DataAccessException e) {
            return searchFallback(lat, lng, radiusMeters, domainId, tagIds, currentUserId);
        }
    }

    private List<Map<String, Object>> searchPostgis(
            Double lat, Double lng, int radiusMeters,
            String domainId, List<String> tagIds, String currentUserId
    ) {
        // Ordre des ? = ordre dans la chaîne SQL : SELECT (ST_Distance) puis WHERE puis ORDER BY.
        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder("tp.active = TRUE");
        List<Object> whereParams = new ArrayList<>();
        if (currentUserId != null && !currentUserId.isBlank()) {
            where.append(" AND tp.user_id <> ?");
            whereParams.add(currentUserId);
        }
        String distanceSelect = "";
        String orderBy = "";
        if (lat != null && lng != null) {
            distanceSelect = ", ST_Distance(tp.location::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) AS distance";
            params.add(lng);
            params.add(lat);
            where.append(" AND ST_DWithin(tp.location::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)");
            whereParams.add(lng);
            whereParams.add(lat);
            whereParams.add((double) radiusMeters);
            orderBy = " ORDER BY tp.location::geography <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography";
        }
        appendDomainTagFilters(where, whereParams, domainId, tagIds, true);
        params.addAll(whereParams);
        if (lat != null && lng != null) {
            params.add(lng);
            params.add(lat);
        }
        String sql = "SELECT " + TP_FIELDS_POSTGIS + distanceSelect
                + " FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id WHERE " + where + orderBy + " LIMIT 200";
        return queryForListOfMaps(sql, params);
    }

    private List<Map<String, Object>> searchFallback(
            Double lat, Double lng, int radiusMeters,
            String domainId, List<String> tagIds, String currentUserId
    ) {
        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder("tp.active = TRUE AND tp.latitude IS NOT NULL AND tp.longitude IS NOT NULL");
        List<Object> whereParams = new ArrayList<>();
        if (currentUserId != null && !currentUserId.isBlank()) {
            where.append(" AND tp.user_id <> ?");
            whereParams.add(currentUserId);
        }
        String distanceSelect = "";
        String orderBy = "";
        if (lat != null && lng != null) {
            distanceSelect = ", SQRT(POWER((tp.latitude - ?) * 111320, 2) + POWER((tp.longitude - ?) * 111320, 2)) AS distance";
            params.add(lat);
            params.add(lng);
            where.append(" AND (POWER((tp.latitude - ?) * 111320, 2) + POWER((tp.longitude - ?) * 111320, 2)) <= POWER(?, 2)");
            whereParams.add(lat);
            whereParams.add(lng);
            whereParams.add((double) radiusMeters);
            orderBy = " ORDER BY distance";
        }
        appendDomainTagFilters(where, whereParams, domainId, tagIds, false);
        params.addAll(whereParams);
        String sql = "SELECT " + TP_FIELDS_FALLBACK + distanceSelect
                + " FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id WHERE " + where + orderBy + " LIMIT 200";
        List<Map<String, Object>> rows = queryForListOfMaps(sql, params);
        return filterTagsInMemory(rows, tagIds);
    }

    private void appendDomainTagFilters(
            StringBuilder where, List<Object> params,
            String domainId, List<String> tagIds, boolean useJsonbExistsAny
    ) {
        if (domainId != null && !domainId.isBlank()) {
            where.append(" AND tp.domain_id = ?");
            params.add(domainId);
        }
        if (tagIds != null && !tagIds.isEmpty()) {
            if (useJsonbExistsAny) {
                where.append(" AND jsonb_exists_any(COALESCE(tp.tag_ids::jsonb, '[]'::jsonb), ARRAY[");
                where.append(tagIds.stream().map(t -> "?").collect(Collectors.joining(",")));
                where.append("]::text[])");
                params.addAll(tagIds);
            } else {
                where.append(" AND (");
                where.append(tagIds.stream().map(t -> "tp.tag_ids LIKE ?").collect(Collectors.joining(" OR ")));
                where.append(")");
                for (String t : tagIds) {
                    params.add("%\"" + t + "\"%");
                }
            }
        }
    }

    private List<Map<String, Object>> filterTagsInMemory(List<Map<String, Object>> rows, List<String> tagIds) {
        if (tagIds == null || tagIds.isEmpty()) {
            return rows;
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            String raw = row.get("tag_ids") == null ? "" : String.valueOf(row.get("tag_ids"));
            boolean match = false;
            for (String t : tagIds) {
                if (raw.contains("\"" + t + "\"")) {
                    match = true;
                    break;
                }
            }
            if (match) {
                out.add(row);
            }
        }
        return out;
    }

    public List<Map<String, Object>> findMine(String userId) {
        return selectWithTpFields("""
                 FROM tag_points tp
                 LEFT JOIN users u ON tp.user_id = u.user_id
                 WHERE tp.user_id = ? AND tp.active = TRUE
                 ORDER BY tp.created_at DESC
                """, List.of(userId));
    }

    public List<Map<String, Object>> findSaved(String userId) {
        return selectWithTpFields("""
                , s.saved_at
                 FROM tag_point_saves s
                 JOIN tag_points tp ON s.point_id = tp.point_id
                 LEFT JOIN users u ON tp.user_id = u.user_id
                 WHERE s.user_id = ?
                 ORDER BY s.saved_at DESC
                """, List.of(userId));
    }

    /** Aligné {@code GET /users/me/events} — membres acceptés uniquement. */
    public List<Map<String, Object>> findMemberEvents(String userId) {
        return selectWithTpFields("""
                , m.joined_at,
                 COALESCE(tp.event_date, tp.created_at) AS sort_date
                 FROM tag_points tp
                 JOIN spot_you_members m ON tp.point_id = m.spot_you_id
                 LEFT JOIN users u ON tp.user_id = u.user_id
                 WHERE m.user_id = ? AND m.status = 'accepted'
                 ORDER BY tp.active DESC, sort_date DESC
                """, List.of(userId));
    }

    public List<Map<String, Object>> findPendingRequests(String userId) {
        return selectWithTpFields("""
                , m.joined_at AS requested_at
                 FROM tag_points tp
                 JOIN spot_you_members m ON tp.point_id = m.spot_you_id
                 LEFT JOIN users u ON tp.user_id = u.user_id
                 WHERE m.user_id = ? AND m.status = 'pending' AND tp.active = TRUE
                 ORDER BY m.joined_at DESC
                """, List.of(userId));
    }

    /**
     * Aligné sur {@code get_my_invitations} dans {@code tagpoint_routes.py}.
     */
    public List<Map<String, Object>> findSpotYouInvitationsForUser(String userId) {
        return selectWithTpFields("""
                , m.invited_at AS invited_at,
                 m.invited_by AS invited_by,
                 inviter.name AS inviter_name,
                 inviter.picture AS inviter_picture
                 FROM tag_points tp
                 JOIN spot_you_members m ON tp.point_id = m.spot_you_id
                 LEFT JOIN users u ON tp.user_id = u.user_id
                 LEFT JOIN users inviter ON m.invited_by = inviter.user_id
                 WHERE m.user_id = ? AND m.status = 'invited' AND tp.active = TRUE
                 ORDER BY m.invited_at DESC
                """, List.of(userId));
    }

    public Optional<Map<String, Object>> findByPointId(String pointId) {
        List<Map<String, Object>> rows = selectWithTpFields("""
                 FROM tag_points tp
                 LEFT JOIN users u ON tp.user_id = u.user_id
                 WHERE tp.point_id = ?
                """, List.of(pointId));
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<Map<String, Object>> findActivePointForGoing(String pointId) {
        List<Map<String, Object>> rows = queryForListOfMaps("""
                SELECT point_id, user_id, event_date, event_schedule, maximum_participants
                FROM tag_points
                WHERE point_id = ? AND active = TRUE
                """, List.of(pointId));
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public boolean hasMembershipAnyStatus(String pointId, String userId) {
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id = ? AND user_id = ?",
                Integer.class,
                pointId, userId
        );
        return n != null && n > 0;
    }

    public int countMembersAnyStatus(String pointId) {
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id = ?",
                Integer.class,
                pointId
        );
        return n == null ? 0 : n;
    }

    public int updateAttendanceToGoing(String pointId, String userId, Date sessionDate) {
        return jdbcTemplate.update(
                """
                UPDATE spot_you_attendance
                SET status = 'going'
                WHERE spot_you_id = ? AND user_id = ? AND session_date = ?
                """,
                pointId, userId, sessionDate
        );
    }

    public void insertAttendanceGoing(String pointId, String userId, Date sessionDate) {
        jdbcTemplate.update(
                """
                INSERT INTO spot_you_attendance (id, spot_you_id, user_id, session_date, status)
                VALUES (?, ?, ?, ?, 'going')
                """,
                "att_" + UUID.randomUUID().toString().replace("-", ""),
                pointId, userId, sessionDate
        );
    }

    public void deleteAttendanceForSession(String pointId, String userId, Date sessionDate) {
        jdbcTemplate.update(
                """
                DELETE FROM spot_you_attendance
                WHERE spot_you_id = ? AND user_id = ? AND session_date = ?
                """,
                pointId, userId, sessionDate
        );
    }

    public List<Map<String, Object>> listGoingUsersForSession(String pointId, Date sessionDate) {
        return queryForListOfMaps(
                """
                SELECT u.user_id, u.name, u.picture, u.role,
                       a.created_at AS registered_at
                FROM spot_you_attendance a
                JOIN users u ON a.user_id = u.user_id
                WHERE a.spot_you_id = ?
                  AND a.session_date = ?
                  AND a.status = 'going'
                ORDER BY a.created_at ASC
                """,
                List.of(pointId, sessionDate)
        );
    }

    public List<Map<String, Object>> findSimilar(String pointId, String currentUserId) {
        Optional<Map<String, Object>> base = findByPointId(pointId);
        if (base.isEmpty()) {
            return List.of();
        }
        Map<String, Object> current = base.get();
        List<String> tagList = parseTagIdList(current.get("tag_ids"));
        List<Map<String, Object>> rows;
        try {
            if (!tagList.isEmpty()) {
                rows = similarWithTagsPostgis(pointId, current, tagList, currentUserId);
            } else {
                rows = similarDistanceOnlyPostgis(pointId, current, currentUserId);
            }
        } catch (DataAccessException e) {
            if (!tagList.isEmpty()) {
                rows = similarWithTagsFallback(pointId, current, tagList, currentUserId);
            } else {
                rows = similarDistanceOnlyFallback(pointId, current, currentUserId);
            }
        }
        if (!rows.isEmpty()) {
            return rows;
        }
        // Filet de sécurité: si aucun match tags/distance, proposer le même domaine puis les plus récents.
        return similarDomainOrRecent(pointId, current, currentUserId);
    }

    private List<Map<String, Object>> similarDomainOrRecent(String pointId, Map<String, Object> current, String currentUserId) {
        String ex = (currentUserId != null && !currentUserId.isBlank()) ? " AND tp.user_id <> ?" : "";
        String sql = "SELECT " + TP_FIELDS_POSTGIS
                + " FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id "
                + "WHERE tp.point_id <> ? AND tp.active = TRUE " + ex + " "
                + "ORDER BY CASE WHEN ? IS NOT NULL AND tp.domain_id = ? THEN 0 ELSE 1 END, tp.created_at DESC LIMIT 10";
        List<Object> params = new ArrayList<>();
        params.add(pointId);
        if (currentUserId != null && !currentUserId.isBlank()) {
            params.add(currentUserId);
        }
        Object domain = current.get("domain_id");
        String domainId = domain == null ? null : String.valueOf(domain);
        params.add(domainId);
        params.add(domainId);
        try {
            return queryForListOfMaps(sql, params);
        } catch (DataAccessException e) {
            String fallbackSql = "SELECT " + TP_FIELDS_FALLBACK
                    + " FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id "
                    + "WHERE tp.point_id <> ? AND tp.active = TRUE " + ex + " "
                    + "ORDER BY CASE WHEN ? IS NOT NULL AND tp.domain_id = ? THEN 0 ELSE 1 END, tp.created_at DESC LIMIT 10";
            return queryForListOfMaps(fallbackSql, params);
        }
    }

    private List<Map<String, Object>> similarWithTagsPostgis(
            String pointId, Map<String, Object> current, List<String> tagList, String currentUserId
    ) {
        String tagPh = tagList.stream().map(t -> "?").collect(Collectors.joining(","));
        String ex = (currentUserId != null && !currentUserId.isBlank()) ? " AND tp.user_id <> ?" : "";
        String unwrap = "(tp.tag_ids::jsonb #>> '{}')::jsonb";
        String sql = "SELECT " + TP_FIELDS_POSTGIS
                + ", ST_Distance(tp.location::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) AS dist_m "
                + "FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id "
                + "WHERE tp.point_id <> ? AND tp.active = TRUE " + ex + " AND ( "
                + "tp.tag_ids IS NOT NULL AND EXISTS ( "
                + "SELECT 1 FROM jsonb_array_elements_text( "
                + "CASE jsonb_typeof(tp.tag_ids::jsonb) WHEN 'array' THEN tp.tag_ids::jsonb ELSE " + unwrap + " END "
                + ") AS t(v) WHERE v IN (" + tagPh + ") "
                + ") OR ST_DWithin(tp.location::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, 10000) ) "
                + "ORDER BY CASE WHEN tp.tag_ids IS NOT NULL AND EXISTS ( "
                + "SELECT 1 FROM jsonb_array_elements_text( "
                + "CASE jsonb_typeof(tp.tag_ids::jsonb) WHEN 'array' THEN tp.tag_ids::jsonb ELSE " + unwrap + " END "
                + ") AS t2(v2) WHERE v2 IN (" + tagPh + ") ) THEN 0 ELSE 1 END, dist_m LIMIT 10";
        List<Object> ordered = new ArrayList<>();
        ordered.add(current.get("longitude"));
        ordered.add(current.get("latitude"));
        ordered.add(pointId);
        if (currentUserId != null && !currentUserId.isBlank()) {
            ordered.add(currentUserId);
        }
        ordered.addAll(tagList);
        ordered.add(current.get("longitude"));
        ordered.add(current.get("latitude"));
        ordered.addAll(tagList);
        return queryForListOfMaps(sql, ordered);
    }

    private List<Map<String, Object>> similarDistanceOnlyPostgis(String pointId, Map<String, Object> current, String currentUserId) {
        String ex = (currentUserId != null && !currentUserId.isBlank()) ? " AND tp.user_id <> ?" : "";
        String sql = "SELECT " + TP_FIELDS_POSTGIS
                + ", ST_Distance(tp.location::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) AS dist_m "
                + "FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id "
                + "WHERE tp.point_id <> ? AND tp.active = TRUE " + ex + " "
                + "AND ST_DWithin(tp.location::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, 10000) "
                + "ORDER BY dist_m LIMIT 10";
        List<Object> ordered = new ArrayList<>();
        ordered.add(current.get("longitude"));
        ordered.add(current.get("latitude"));
        ordered.add(pointId);
        if (currentUserId != null && !currentUserId.isBlank()) {
            ordered.add(currentUserId);
        }
        ordered.add(current.get("longitude"));
        ordered.add(current.get("latitude"));
        return queryForListOfMaps(sql, ordered);
    }

    private List<Map<String, Object>> similarWithTagsFallback(
            String pointId, Map<String, Object> current, List<String> tagList, String currentUserId
    ) {
        double lat = toDouble(current.get("latitude"));
        double lng = toDouble(current.get("longitude"));
        List<Object> args = new ArrayList<>();
        args.add(lat);
        args.add(lng);
        args.add(pointId);
        if (currentUserId != null && !currentUserId.isBlank()) {
            args.add(currentUserId);
        }
        String ex = (currentUserId != null && !currentUserId.isBlank()) ? " AND tp.user_id <> ?" : "";
        List<Map<String, Object>> all = queryForListOfMaps(
                "SELECT " + TP_FIELDS_FALLBACK + """
                        , SQRT(POWER((tp.latitude - ?) * 111320, 2) + POWER((tp.longitude - ?) * 111320, 2)) AS dist_m
                        FROM tag_points tp
                        LEFT JOIN users u ON tp.user_id = u.user_id
                        WHERE tp.point_id <> ? AND tp.active = TRUE
                        """ + ex + """
                         AND tp.latitude IS NOT NULL AND tp.longitude IS NOT NULL
                        """,
                args
        );
        List<Map<String, Object>> filtered = new ArrayList<>();
        for (Map<String, Object> row : all) {
            boolean tagMatch = sharesAnyTag(row, tagList);
            boolean distOk = toDouble(row.get("dist_m")) <= 10_000;
            if (tagMatch || distOk) {
                filtered.add(row);
            }
        }
        filtered.sort((a, b) -> {
            int c1 = Boolean.compare(!sharesAnyTag(a, tagList), !sharesAnyTag(b, tagList));
            if (c1 != 0) {
                return c1;
            }
            return Double.compare(toDouble(a.get("dist_m")), toDouble(b.get("dist_m")));
        });
        return filtered.stream().limit(10).toList();
    }

    private List<Map<String, Object>> similarDistanceOnlyFallback(String pointId, Map<String, Object> current, String currentUserId) {
        double lat = toDouble(current.get("latitude"));
        double lng = toDouble(current.get("longitude"));
        List<Object> args = new ArrayList<>();
        args.add(lat);
        args.add(lng);
        args.add(pointId);
        if (currentUserId != null && !currentUserId.isBlank()) {
            args.add(currentUserId);
        }
        args.add(lat);
        args.add(lng);
        String ex = (currentUserId != null && !currentUserId.isBlank()) ? " AND tp.user_id <> ?" : "";
        String sql = "SELECT " + TP_FIELDS_FALLBACK + """
                , SQRT(POWER((tp.latitude - ?) * 111320, 2) + POWER((tp.longitude - ?) * 111320, 2)) AS dist_m
                FROM tag_points tp
                LEFT JOIN users u ON tp.user_id = u.user_id
                WHERE tp.point_id <> ? AND tp.active = TRUE
                """ + ex + """
                 AND tp.latitude IS NOT NULL AND tp.longitude IS NOT NULL
                 AND (POWER((tp.latitude - ?) * 111320, 2) + POWER((tp.longitude - ?) * 111320, 2)) <= POWER(10000, 2)
                ORDER BY dist_m
                LIMIT 10
                """;
        return queryForListOfMaps(sql, args);
    }

    private static boolean sharesAnyTag(Map<String, Object> row, List<String> tagList) {
        String raw = row.get("tag_ids") == null ? "" : String.valueOf(row.get("tag_ids"));
        for (String t : tagList) {
            if (raw.contains("\"" + t + "\"")) {
                return true;
            }
        }
        return false;
    }

    private static double toDouble(Object v) {
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        if (v == null) {
            return Double.MAX_VALUE;
        }
        try {
            return Double.parseDouble(String.valueOf(v));
        } catch (Exception e) {
            return Double.MAX_VALUE;
        }
    }

    public List<Map<String, Object>> listParticipants(String pointId) {
        String sql = """
                SELECT u.user_id, u.name, u.picture, u.role,
                       (u.user_id = tp.user_id) AS is_creator
                FROM spot_you_members m
                JOIN users u ON m.user_id = u.user_id
                JOIN tag_points tp ON tp.point_id = m.spot_you_id
                WHERE m.spot_you_id = ? AND m.status = 'accepted'
                ORDER BY (u.user_id = tp.user_id) DESC, m.joined_at ASC
                """;
        return queryForListOfMaps(sql, List.of(pointId));
    }

    public Map<String, Integer> batchParticipantsCount(List<String> pointIds) {
        if (pointIds.isEmpty()) {
            return Map.of();
        }
        String ph = String.join(",", pointIds.stream().map(x -> "?").toList());
        String sql = "SELECT spot_you_id, COUNT(*) AS cnt FROM spot_you_members WHERE spot_you_id IN ("
                + ph + ") GROUP BY spot_you_id";
        List<Map<String, Object>> rows = queryForListOfMaps(sql, pointIds);
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            out.put(String.valueOf(r.get("spot_you_id")), ((Number) r.get("cnt")).intValue());
        }
        return out;
    }

    public Map<String, Map<String, Integer>> batchGoingCountsBySession(List<String> pointIds) {
        if (pointIds.isEmpty()) {
            return Map.of();
        }
        String ph = String.join(",", pointIds.stream().map(x -> "?").toList());
        String sql = """
                SELECT spot_you_id, session_date, COUNT(*) AS cnt
                FROM spot_you_attendance
                WHERE spot_you_id IN (""" + ph + ") AND status = 'going' GROUP BY spot_you_id, session_date";
        List<Map<String, Object>> rows = queryForListOfMaps(sql, pointIds);
        Map<String, Map<String, Integer>> out = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            String pid = String.valueOf(r.get("spot_you_id"));
            String sd = sessionDateKey(r.get("session_date"));
            out.computeIfAbsent(pid, k -> new LinkedHashMap<>()).put(sd, ((Number) r.get("cnt")).intValue());
        }
        return out;
    }

    public List<Map<String, Object>> batchUserGoingRows(List<String> pointIds, String userId) {
        if (pointIds.isEmpty()) {
            return List.of();
        }
        List<Object> args = new ArrayList<>(pointIds);
        args.add(userId);
        String ph = String.join(",", pointIds.stream().map(x -> "?").toList());
        String sql = """
                SELECT spot_you_id, session_date
                FROM spot_you_attendance
                WHERE spot_you_id IN (""" + ph + ") AND user_id = ? AND status = 'going'";
        return queryForListOfMaps(sql, args);
    }

    public List<String> spotIdsWhereUserHasMembershipAnyStatus(List<String> pointIds, String userId) {
        if (pointIds.isEmpty()) {
            return List.of();
        }
        List<Object> args = new ArrayList<>(pointIds);
        args.add(userId);
        String ph = String.join(",", pointIds.stream().map(x -> "?").toList());
        String sql = "SELECT spot_you_id FROM spot_you_members WHERE spot_you_id IN (" + ph + ") AND user_id = ?";
        return jdbcTemplate.query(sql, (rs, rn) -> rs.getString("spot_you_id"), args.toArray());
    }

    public Map<String, Double[]> batchVoteStatsForPoints(List<String> pointIds) {
        if (pointIds.isEmpty()) {
            return Map.of();
        }
        String ph = String.join(",", pointIds.stream().map(x -> "?").toList());
        String sql = "SELECT point_id, ROUND(AVG(rating), 1) AS avg_r, COUNT(*) AS vcnt FROM tag_point_votes WHERE point_id IN ("
                + ph + ") GROUP BY point_id";
        List<Map<String, Object>> rows = queryForListOfMaps(sql, pointIds);
        Map<String, Double[]> out = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            double avg = r.get("avg_r") == null ? 0 : ((Number) r.get("avg_r")).doubleValue();
            int cnt = r.get("vcnt") == null ? 0 : ((Number) r.get("vcnt")).intValue();
            out.put(String.valueOf(r.get("point_id")), new Double[]{avg, (double) cnt});
        }
        return out;
    }

    public Optional<String> findMemberStatus(String pointId, String userId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT status FROM spot_you_members WHERE spot_you_id = ? AND user_id = ?",
                (rs, rn) -> rs.getString("status"),
                pointId, userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public boolean existsSaved(String pointId, String userId) {
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM tag_point_saves WHERE point_id = ? AND user_id = ?",
                Integer.class,
                pointId, userId
        );
        return n != null && n > 0;
    }

    public int countGoingForSession(String pointId, java.sql.Date sessionDate) {
        Integer v = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM spot_you_attendance WHERE spot_you_id = ? AND session_date = ? AND status = 'going'",
                Integer.class,
                pointId, sessionDate
        );
        return v == null ? 0 : v;
    }

    public boolean existsGoingForUserSession(String pointId, String userId, java.sql.Date sessionDate) {
        Integer n = jdbcTemplate.queryForObject(
                """
                        SELECT COUNT(*) FROM spot_you_attendance
                        WHERE spot_you_id = ? AND user_id = ? AND session_date = ? AND status = 'going'
                        """,
                Integer.class,
                pointId, userId, sessionDate
        );
        return n != null && n > 0;
    }

    public List<Map<String, Object>> findTagDetails(List<String> tagIds) {
        if (tagIds.isEmpty()) {
            return List.of();
        }
        String ph = String.join(",", tagIds.stream().map(x -> "?").toList());
        String sql = "SELECT tag_id, name, label_fr, label_en, category_id FROM tags WHERE tag_id IN (" + ph + ")";
        return queryForListOfMaps(sql, tagIds);
    }

    public Map<String, Object> fetchVoteStats(String pointId) {
        List<Map<String, Object>> rows = queryForListOfMaps(
                """
                        SELECT ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS vote_count
                        FROM tag_point_votes WHERE point_id = ?
                        """,
                List.of(pointId)
        );
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    public List<Map<String, Object>> fetchVoteDistribution(String pointId) {
        return queryForListOfMaps(
                """
                        SELECT rating, COUNT(*) AS cnt FROM tag_point_votes
                        WHERE point_id = ? GROUP BY rating ORDER BY rating
                        """,
                List.of(pointId)
        );
    }

    public Optional<Map<String, Object>> findMyVote(String pointId, String userId) {
        try {
            List<Map<String, Object>> rows = queryForListOfMaps(
                    """
                            SELECT vote_id, rating, comment, created_at, updated_at
                            FROM tag_point_votes
                            WHERE point_id = ? AND user_id = ?
                            ORDER BY created_at DESC
                            LIMIT 1
                            """,
                    List.of(pointId, userId)
            );
            return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
        } catch (Exception ignored) {
            // Schéma H2 de tests : votes sans user/comment/timestamps.
            return Optional.empty();
        }
    }

    public List<Map<String, Object>> listVotes(String pointId) {
        try {
            return queryForListOfMaps(
                    """
                            SELECT v.vote_id, v.rating, v.comment, v.created_at,
                                   u.name AS user_name, u.picture AS user_picture
                            FROM tag_point_votes v
                            JOIN users u ON v.user_id = u.user_id
                            WHERE v.point_id = ?
                            ORDER BY v.created_at DESC
                            LIMIT 20
                            """,
                    List.of(pointId)
            );
        } catch (Exception ignored) {
            // Fallback tests/local : structure compatible frontend.
            List<Map<String, Object>> base = queryForListOfMaps(
                    """
                            SELECT id, rating
                            FROM tag_point_votes
                            WHERE point_id = ?
                            ORDER BY id DESC
                            LIMIT 20
                            """,
                    List.of(pointId)
            );
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> row : base) {
                Map<String, Object> v = new LinkedHashMap<>();
                v.put("vote_id", row.get("id"));
                v.put("rating", row.get("rating"));
                v.put("comment", null);
                v.put("created_at", null);
                v.put("user_name", "Utilisateur");
                v.put("user_picture", null);
                out.add(v);
            }
            return out;
        }
    }

    public int countAcceptedMembers(String pointId) {
        Integer v = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id = ? AND status = 'accepted'",
                Integer.class,
                pointId
        );
        return v == null ? 0 : v;
    }

    /**
     * Aligné {@code GET /spot-you/my-completion-stats} (Python) — membre d'au moins une
     * communauté SpotYou dont l'utilisateur n'est pas l'auteur (tous statuts membership).
     */
    public boolean isCommunityMember(String userId) {
        Boolean v = jdbcTemplate.queryForObject("""
                SELECT EXISTS(
                    SELECT 1 FROM spot_you_members syp
                    JOIN tag_points tp ON tp.point_id = syp.spot_you_id
                    WHERE syp.user_id = ? AND tp.user_id <> ?
                )
                """, Boolean.class, userId, userId);
        return Boolean.TRUE.equals(v);
    }

    /** Aligné Python — au moins une présence {@code going} sur spot_you_attendance. */
    public boolean hasGoingParticipation(String userId) {
        Boolean v = jdbcTemplate.queryForObject("""
                SELECT EXISTS(
                    SELECT 1 FROM spot_you_attendance
                    WHERE user_id = ? AND status = 'going'
                )
                """, Boolean.class, userId);
        return Boolean.TRUE.equals(v);
    }

    private List<Map<String, Object>> queryForListOfMaps(String sql, List<?> params) {
        return jdbcTemplate.query(sql, rs -> {
            List<Map<String, Object>> out = new ArrayList<>();
            ResultSetMetaData md = rs.getMetaData();
            int cols = md.getColumnCount();
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                for (int i = 1; i <= cols; i++) {
                    row.put(md.getColumnLabel(i), rs.getObject(i));
                }
                out.add(row);
            }
            return out;
        }, params.toArray());
    }

    public static String sessionDateKey(Object sessionDate) {
        if (sessionDate instanceof java.sql.Date d) {
            return d.toLocalDate().toString();
        }
        if (sessionDate instanceof java.time.LocalDate ld) {
            return ld.toString();
        }
        return sessionDate == null ? "" : String.valueOf(sessionDate);
    }

    public List<String> parseTagIdList(Object raw) {
        if (raw == null) {
            return List.of();
        }
        if (raw instanceof String s) {
            if (s.isBlank() || "[]".equals(s.trim())) {
                return List.of();
            }
            try {
                List<?> list = objectMapper.readValue(s, new TypeReference<List<Object>>() {
                });
                return list.stream().map(String::valueOf).toList();
            } catch (Exception e) {
                return List.of();
            }
        }
        return List.of();
    }
}
