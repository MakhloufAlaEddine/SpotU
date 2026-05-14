package com.spotu.modules.home.infra;

import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Repository
public class HomeRepository {

    private final JdbcTemplate jdbcTemplate;

    public HomeRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<NearestSpotRow> findNearestActiveSpot(Double lat, Double lng, String currentUserId) {
        try {
            return findNearestActiveSpotPostgis(lat, lng, currentUserId);
        } catch (DataAccessException ignored) {
            return findNearestActiveSpotFallback(lat, lng, currentUserId);
        }
    }

    public int countSpotsAround(double nearLat, double nearLng) {
        try {
            Integer v = jdbcTemplate.queryForObject(
                    """
                            SELECT COUNT(*) FROM tag_points
                            WHERE active = TRUE
                              AND ST_DWithin(
                                location::geography,
                                ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
                                50000
                              )
                            """,
                    Integer.class,
                    nearLng, nearLat
            );
            return v == null ? 0 : v;
        } catch (DataAccessException ignored) {
            Integer v = jdbcTemplate.queryForObject(
                    """
                            SELECT COUNT(*) FROM tag_points
                            WHERE active = TRUE
                              AND (
                                POWER((latitude - ?) * 111320, 2) + POWER((longitude - ?) * 111320, 2)
                              ) <= POWER(50000, 2)
                            """,
                    Integer.class,
                    nearLat, nearLng
            );
            return v == null ? 0 : v;
        }
    }

    public List<String> findUserCoachTags(String userId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT coach_tags FROM users WHERE user_id = ?",
                (rs, rn) -> rs.getString("coach_tags"),
                userId
        );
        return rows.isEmpty() ? List.of() : List.of(rows.get(0));
    }

    public Set<String> findMemberSpotIds(String userId) {
        return jdbcTemplate.query(
                "SELECT spot_you_id FROM spot_you_members WHERE user_id = ?",
                (rs, rn) -> rs.getString("spot_you_id"),
                userId
        ).stream().collect(Collectors.toSet());
    }

    public List<Map<String, Object>> findSpots(String currentUserId, Double lat, Double lng, int radiusMeters) {
        try {
            return findSpotsPostgis(currentUserId, lat, lng, radiusMeters);
        } catch (DataAccessException ignored) {
            return findSpotsFallback(currentUserId, lat, lng, radiusMeters);
        }
    }

    public Set<String> findGoingSpotIds(List<String> spotIds, String userId) {
        if (spotIds.isEmpty() || userId == null || userId.isBlank()) {
            return Set.of();
        }
        String placeholders = String.join(",", java.util.Collections.nCopies(spotIds.size(), "?"));
        List<Object> args = new ArrayList<>(spotIds);
        args.add(userId);
        return jdbcTemplate.query(
                """
                        SELECT DISTINCT spot_you_id
                        FROM spot_you_attendance
                        WHERE spot_you_id IN (%s)
                          AND user_id = ?
                          AND status = 'going'
                          AND session_date >= CURRENT_DATE
                        """.formatted(placeholders),
                (rs, rn) -> rs.getString("spot_you_id"),
                args.toArray()
        ).stream().collect(Collectors.toSet());
    }

    public List<Map<String, Object>> findServices(String currentUserId, Double lat, Double lng, int radiusMeters) {
        try {
            return findServicesPostgis(currentUserId, lat, lng, radiusMeters);
        } catch (DataAccessException ignored) {
            return findServicesFallback(currentUserId, lat, lng, radiusMeters);
        }
    }

    private Optional<NearestSpotRow> findNearestActiveSpotPostgis(Double lat, Double lng, String currentUserId) {
        StringBuilder sql = new StringBuilder("""
                SELECT
                    ST_Y(tp.location::geometry) AS near_lat,
                    ST_X(tp.location::geometry) AS near_lng,
                    ST_Distance(
                        tp.location::geography,
                        ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
                    ) AS distance_m
                FROM tag_points tp
                WHERE tp.active = TRUE
                """);
        List<Object> args = new ArrayList<>();
        args.add(lng);
        args.add(lat);
        if (currentUserId != null && !currentUserId.isBlank()) {
            sql.append(" AND tp.user_id != ?");
            args.add(currentUserId);
        }
        sql.append(" ORDER BY distance_m ASC LIMIT 1");
        List<NearestSpotRow> rows = jdbcTemplate.query(
                sql.toString(),
                (rs, rn) -> new NearestSpotRow(
                        rs.getDouble("near_lat"),
                        rs.getDouble("near_lng"),
                        rs.getDouble("distance_m")
                ),
                args.toArray()
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    private Optional<NearestSpotRow> findNearestActiveSpotFallback(Double lat, Double lng, String currentUserId) {
        StringBuilder sql = new StringBuilder("""
                SELECT
                    tp.latitude AS near_lat,
                    tp.longitude AS near_lng,
                    SQRT(POWER((tp.latitude - ?) * 111320, 2) + POWER((tp.longitude - ?) * 111320, 2)) AS distance_m
                FROM tag_points tp
                WHERE tp.active = TRUE
                  AND tp.latitude IS NOT NULL
                  AND tp.longitude IS NOT NULL
                """);
        List<Object> args = new ArrayList<>();
        args.add(lat);
        args.add(lng);
        if (currentUserId != null && !currentUserId.isBlank()) {
            sql.append(" AND tp.user_id != ?");
            args.add(currentUserId);
        }
        sql.append(" ORDER BY distance_m ASC LIMIT 1");
        List<NearestSpotRow> rows = jdbcTemplate.query(
                sql.toString(),
                (rs, rn) -> new NearestSpotRow(
                        rs.getDouble("near_lat"),
                        rs.getDouble("near_lng"),
                        rs.getDouble("distance_m")
                ),
                args.toArray()
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    private List<Map<String, Object>> findSpotsPostgis(String currentUserId, Double lat, Double lng, int radiusMeters) {
        List<Object> selectParams = new ArrayList<>();
        List<Object> whereParams = new ArrayList<>();
        StringBuilder where = new StringBuilder("tp.active = TRUE");
        if (currentUserId != null && !currentUserId.isBlank()) {
            where.append(" AND tp.user_id != ?");
            whereParams.add(currentUserId);
        }
        String distExpr = "NULL::float8";
        String orderClause = "";
        if (lat != null && lng != null) {
            where.append(" AND ST_DWithin(tp.location::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)");
            whereParams.add(lng);
            whereParams.add(lat);
            whereParams.add((double) radiusMeters);
            distExpr = "ST_Distance(tp.location::geography, ST_SetSRID(ST_MakePoint(" + "?, ?" + "), 4326)::geography)";
            orderClause = "ORDER BY distance";
            selectParams.add(lng);
            selectParams.add(lat);
        }
        String sql = """
                SELECT
                    tp.point_id, tp.user_id, tp.title, tp.description,
                    tp.precision, tp.tag_ids, tp.domain_id, tp.active,
                    tp.cancelled, tp.image_url, tp.images,
                    tp.visibility_type,
                    tp.schedule, tp.event_date, tp.event_end_date,
                    tp.minimum_participants, tp.maximum_participants,
                    ST_Y(tp.location::geometry) AS latitude,
                    ST_X(tp.location::geometry) AS longitude,
                    u.name AS owner_name,
                    u.picture AS owner_picture,
                    u.role AS owner_role,
                    COALESCE((SELECT COUNT(*) FROM spot_you_members sm WHERE sm.spot_you_id = tp.point_id), 0) AS participants_count,
                    COALESCE((
                        SELECT COUNT(*) FROM spot_you_attendance sa
                        WHERE sa.spot_you_id = tp.point_id AND sa.status = 'going' AND sa.session_date >= CURRENT_DATE
                    ), 0) AS going_count,
                    CASE
                        WHEN tp.maximum_participants IS NOT NULL THEN (
                            SELECT COUNT(*) FROM spot_you_attendance sa2
                            WHERE sa2.spot_you_id = tp.point_id AND sa2.status = 'going' AND sa2.session_date >= CURRENT_DATE
                        ) >= tp.maximum_participants
                        ELSE FALSE
                    END AS is_full,
                    %s AS distance
                FROM tag_points tp
                LEFT JOIN users u ON u.user_id = tp.user_id
                WHERE %s
                %s
                LIMIT 60
                """.formatted(distExpr, where, orderClause);
        List<Object> params = new ArrayList<>(selectParams);
        params.addAll(whereParams);
        return queryForListMap(sql, params);
    }

    private List<Map<String, Object>> findSpotsFallback(String currentUserId, Double lat, Double lng, int radiusMeters) {
        List<Object> selectParams = new ArrayList<>();
        List<Object> whereParams = new ArrayList<>();
        StringBuilder where = new StringBuilder("tp.active = TRUE");
        String distExpr = "NULL";
        String orderClause = "";
        if (currentUserId != null && !currentUserId.isBlank()) {
            where.append(" AND tp.user_id != ?");
            whereParams.add(currentUserId);
        }
        if (lat != null && lng != null) {
            where.append(" AND tp.latitude IS NOT NULL AND tp.longitude IS NOT NULL");
            where.append(" AND (POWER((tp.latitude - ?) * 111320, 2) + POWER((tp.longitude - ?) * 111320, 2)) <= POWER(?, 2)");
            whereParams.add(lat);
            whereParams.add(lng);
            whereParams.add((double) radiusMeters);
            distExpr = "SQRT(POWER((tp.latitude - ?) * 111320, 2) + POWER((tp.longitude - ?) * 111320, 2))";
            orderClause = "ORDER BY distance";
            selectParams.add(lat);
            selectParams.add(lng);
        }
        String sql = """
                SELECT
                    tp.point_id, tp.user_id, tp.title, tp.description,
                    tp.precision, tp.tag_ids, tp.domain_id, tp.active,
                    tp.cancelled, tp.image_url, tp.images,
                    tp.visibility_type,
                    tp.schedule, tp.event_date, tp.event_end_date,
                    tp.minimum_participants, tp.maximum_participants,
                    tp.latitude AS latitude,
                    tp.longitude AS longitude,
                    u.name AS owner_name,
                    u.picture AS owner_picture,
                    u.role AS owner_role,
                    COALESCE((SELECT COUNT(*) FROM spot_you_members sm WHERE sm.spot_you_id = tp.point_id), 0) AS participants_count,
                    COALESCE((
                        SELECT COUNT(*) FROM spot_you_attendance sa
                        WHERE sa.spot_you_id = tp.point_id AND sa.status = 'going' AND sa.session_date >= CURRENT_DATE
                    ), 0) AS going_count,
                    CASE
                        WHEN tp.maximum_participants IS NOT NULL THEN (
                            SELECT COUNT(*) FROM spot_you_attendance sa2
                            WHERE sa2.spot_you_id = tp.point_id AND sa2.status = 'going' AND sa2.session_date >= CURRENT_DATE
                        ) >= tp.maximum_participants
                        ELSE FALSE
                    END AS is_full,
                    %s AS distance
                FROM tag_points tp
                LEFT JOIN users u ON u.user_id = tp.user_id
                WHERE %s
                %s
                LIMIT 60
                """.formatted(distExpr, where, orderClause);
        List<Object> params = new ArrayList<>(selectParams);
        params.addAll(whereParams);
        return queryForListMap(sql, params);
    }

    private List<Map<String, Object>> findServicesPostgis(String currentUserId, Double lat, Double lng, int radiusMeters) {
        List<Object> selectParams = new ArrayList<>();
        List<Object> whereParams = new ArrayList<>();
        StringBuilder where = new StringBuilder("s.active = TRUE");
        if (currentUserId != null && !currentUserId.isBlank()) {
            where.append(" AND s.coach_id != ?");
            whereParams.add(currentUserId);
        }
        String distExpr = "NULL::float8";
        String orderClause = "";
        if (lat != null && lng != null) {
            where.append("""
                     AND EXISTS (
                        SELECT 1 FROM service_locations sl
                        WHERE sl.service_id = s.service_id
                          AND ST_DWithin(sl.location::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)
                    )
                    """);
            whereParams.add(lng);
            whereParams.add(lat);
            whereParams.add((double) radiusMeters);
            distExpr = """
                    (SELECT MIN(ST_Distance(sl.location::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography))
                     FROM service_locations sl WHERE sl.service_id = s.service_id)
                    """;
            orderClause = "ORDER BY distance NULLS LAST";
            selectParams.add(lng);
            selectParams.add(lat);
        }
        String sql = """
                SELECT s.service_id, s.coach_id, s.title, s.description, s.address,
                       s.price, s.duration_min, s.tag_ids, s.domain_id, s.images,
                       s.location_description, s.max_participants,
                       u.name AS coach_name, u.picture AS coach_picture,
                       %s AS distance,
                       COALESCE((
                           SELECT COUNT(*) FROM bookings b
                           WHERE b.service_id = s.service_id
                             AND b.status NOT IN ('cancelled', 'expired')
                       ), 0) AS booking_count
                FROM services s
                LEFT JOIN users u ON u.user_id = s.coach_id
                WHERE %s
                %s
                LIMIT 40
                """.formatted(distExpr, where, orderClause);
        List<Object> params = new ArrayList<>(selectParams);
        params.addAll(whereParams);
        return queryForListMap(sql, params);
    }

    private List<Map<String, Object>> findServicesFallback(String currentUserId, Double lat, Double lng, int radiusMeters) {
        List<Object> selectParams = new ArrayList<>();
        List<Object> whereParams = new ArrayList<>();
        StringBuilder where = new StringBuilder("s.active = TRUE");
        if (currentUserId != null && !currentUserId.isBlank()) {
            where.append(" AND s.coach_id != ?");
            whereParams.add(currentUserId);
        }
        String distExpr = "NULL";
        String orderClause = "";
        if (lat != null && lng != null) {
            where.append("""
                     AND EXISTS (
                        SELECT 1 FROM service_locations sl
                        WHERE sl.service_id = s.service_id
                          AND sl.latitude IS NOT NULL
                          AND sl.longitude IS NOT NULL
                          AND (POWER((sl.latitude - ?) * 111320, 2) + POWER((sl.longitude - ?) * 111320, 2)) <= POWER(?, 2)
                    )
                    """);
            whereParams.add(lat);
            whereParams.add(lng);
            whereParams.add((double) radiusMeters);
            distExpr = """
                    (SELECT MIN(SQRT(POWER((sl.latitude - ?) * 111320, 2) + POWER((sl.longitude - ?) * 111320, 2)))
                     FROM service_locations sl WHERE sl.service_id = s.service_id)
                    """;
            orderClause = "ORDER BY distance NULLS LAST";
            selectParams.add(lat);
            selectParams.add(lng);
        }
        String sql = """
                SELECT s.service_id, s.coach_id, s.title, s.description, s.address,
                       s.price, s.duration_min, s.tag_ids, s.domain_id, s.images,
                       s.location_description, s.max_participants,
                       u.name AS coach_name, u.picture AS coach_picture,
                       %s AS distance,
                       COALESCE((
                           SELECT COUNT(*) FROM bookings b
                           WHERE b.service_id = s.service_id
                             AND b.status NOT IN ('cancelled', 'expired')
                       ), 0) AS booking_count
                FROM services s
                LEFT JOIN users u ON u.user_id = s.coach_id
                WHERE %s
                %s
                LIMIT 40
                """.formatted(distExpr, where, orderClause);
        List<Object> params = new ArrayList<>(selectParams);
        params.addAll(whereParams);
        return queryForListMap(sql, params);
    }

    private List<Map<String, Object>> queryForListMap(String sql, List<Object> params) {
        return jdbcTemplate.query(sql, rs -> {
            List<Map<String, Object>> out = new ArrayList<>();
            var md = rs.getMetaData();
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

    public record NearestSpotRow(double nearLat, double nearLng, double distanceM) {
    }
}

