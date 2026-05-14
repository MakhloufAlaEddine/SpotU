package com.spotu.modules.spotyou.infra;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Écritures {@code tag_points} / auto-membre (slice 28), avec bascule PostGIS / H2 comme la lecture S26.
 */
@Repository
public class TagPointWriteRepository {

    private final JdbcTemplate jdbcTemplate;
    private final String jdbcUrl;

    public TagPointWriteRepository(JdbcTemplate jdbcTemplate, @Value("${spring.datasource.url:}") String jdbcUrl) {
        this.jdbcTemplate = jdbcTemplate;
        this.jdbcUrl = jdbcUrl == null ? "" : jdbcUrl;
    }

    /**
     * PostGIS {@code geography(Point)} sur Postgres ; H2 de test : colonnes {@code latitude}/{@code longitude}.
     */
    public boolean usePostgisLocationColumn() {
        return jdbcUrl.startsWith("jdbc:postgresql:");
    }

    public void insertTagPointPostgis(
            String pointId,
            String userId,
            String title,
            String description,
            double storedLng,
            double storedLat,
            String precision,
            String tagIdsJson,
            String domainId,
            Timestamp expiresAt,
            Timestamp eventDate,
            Timestamp eventEndDate,
            String eventScheduleJson,
            String imagesJson,
            Integer minP,
            Integer maxP,
            String address,
            String visibilityType,
            String joinMode,
            String invitePerms,
            Integer maxCommunity
    ) {
        jdbcTemplate.update(
                """
                        INSERT INTO tag_points
                          (point_id, user_id, title, description, location, precision, tag_ids, domain_id, active, expires_at,
                           event_date, event_end_date, event_schedule, images, minimum_participants, maximum_participants, address,
                           visibility_type, join_mode, invite_permissions, max_community_members)
                        VALUES (?,?,?,?,ST_SetSRID(ST_MakePoint(?, ?), 4326),?,?::jsonb,?,TRUE,?,?,?,?::jsonb,?::jsonb,?,?,?,?,?,?,?)
                        """,
                pointId, userId, title, description,
                storedLng, storedLat,
                precision, tagIdsJson, domainId,
                expiresAt, eventDate, eventEndDate, eventScheduleJson, imagesJson,
                minP, maxP, address,
                visibilityType, joinMode, invitePerms, maxCommunity
        );
    }

    public void insertTagPointFallback(
            String pointId,
            String userId,
            String title,
            String description,
            double storedLat,
            double storedLng,
            String precision,
            String tagIdsJson,
            String domainId,
            Timestamp expiresAt,
            Timestamp eventDate,
            Timestamp eventEndDate,
            String eventScheduleJson,
            String imagesJson,
            Integer minP,
            Integer maxP,
            String address,
            String visibilityType,
            String joinMode,
            String invitePerms,
            Integer maxCommunity
    ) {
        jdbcTemplate.update(
                """
                        INSERT INTO tag_points
                          (point_id, user_id, title, description, latitude, longitude, precision, tag_ids, domain_id, active, expires_at,
                           event_date, event_end_date, event_schedule, images, minimum_participants, maximum_participants, address,
                           visibility_type, join_mode, invite_permissions, max_community_members)
                        VALUES (?,?,?,?,?,?,?,?,?,TRUE,?,?,?,?,?,?,?,?,?,?,?,?)
                        """,
                pointId, userId, title, description, storedLat, storedLng,
                precision, tagIdsJson, domainId,
                expiresAt, eventDate, eventEndDate, eventScheduleJson, imagesJson,
                minP, maxP, address,
                visibilityType, joinMode, invitePerms, maxCommunity
        );
    }

    public void insertOwnerMemberAccepted(String memberId, String pointId, String userId) {
        if (usePostgisLocationColumn()) {
            jdbcTemplate.update(
                    """
                            INSERT INTO spot_you_members (id, spot_you_id, user_id, status)
                            VALUES (?,?,?,'accepted')
                            ON CONFLICT (spot_you_id, user_id) DO NOTHING
                            """,
                    memberId, pointId, userId
            );
        } else {
            jdbcTemplate.update(
                    """
                            INSERT INTO spot_you_members (id, spot_you_id, user_id, status)
                            SELECT ?,?,?,?
                            WHERE NOT EXISTS (
                              SELECT 1 FROM spot_you_members WHERE spot_you_id = ? AND user_id = ?
                            )
                            """,
                    memberId, pointId, userId, "accepted", pointId, userId
            );
        }
    }

    public Optional<Map<String, Object>> findExistingForUpdate(String pointId) {
        if (usePostgisLocationColumn()) {
            try {
                return queryExistingPostgis(pointId);
            } catch (DataAccessException e) {
                return queryExistingFallback(pointId);
            }
        }
        return queryExistingFallback(pointId);
    }

    private Optional<Map<String, Object>> queryExistingPostgis(String pointId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                """
                        SELECT user_id, title, cancelled, description, precision, tag_ids, images, domain_id, active,
                               event_date, event_end_date, event_schedule, visibility_type, join_mode, invite_permissions,
                               max_community_members, minimum_participants, maximum_participants, address,
                               ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
                        FROM tag_points WHERE point_id = ?
                        """,
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("user_id", rs.getString("user_id"));
                    m.put("title", rs.getString("title"));
                    m.put("cancelled", rs.getObject("cancelled") == null ? Boolean.FALSE : rs.getBoolean("cancelled"));
                    m.put("description", rs.getString("description"));
                    m.put("precision", rs.getString("precision"));
                    m.put("tag_ids", rs.getString("tag_ids"));
                    m.put("images", rs.getString("images"));
                    m.put("domain_id", rs.getString("domain_id"));
                    m.put("active", rs.getObject("active"));
                    m.put("event_date", rs.getObject("event_date"));
                    m.put("event_end_date", rs.getObject("event_end_date"));
                    m.put("event_schedule", rs.getString("event_schedule"));
                    m.put("visibility_type", rs.getString("visibility_type"));
                    m.put("join_mode", rs.getString("join_mode"));
                    m.put("invite_permissions", rs.getString("invite_permissions"));
                    m.put("max_community_members", rs.getObject("max_community_members"));
                    m.put("minimum_participants", rs.getObject("minimum_participants"));
                    m.put("maximum_participants", rs.getObject("maximum_participants"));
                    m.put("address", rs.getString("address"));
                    m.put("latitude", rs.getObject("latitude"));
                    m.put("longitude", rs.getObject("longitude"));
                    return m;
                },
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    private Optional<Map<String, Object>> queryExistingFallback(String pointId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                """
                        SELECT user_id, title, cancelled, description, precision, tag_ids, images, domain_id, active,
                               event_date, event_end_date, event_schedule, visibility_type, join_mode, invite_permissions,
                               max_community_members, minimum_participants, maximum_participants, address,
                               latitude, longitude
                        FROM tag_points WHERE point_id = ?
                        """,
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("user_id", rs.getString("user_id"));
                    m.put("title", rs.getString("title"));
                    m.put("cancelled", rs.getObject("cancelled") == null ? Boolean.FALSE : rs.getBoolean("cancelled"));
                    m.put("description", rs.getString("description"));
                    m.put("precision", rs.getString("precision"));
                    m.put("tag_ids", rs.getString("tag_ids"));
                    m.put("images", rs.getString("images"));
                    m.put("domain_id", rs.getString("domain_id"));
                    m.put("active", rs.getObject("active"));
                    m.put("event_date", rs.getObject("event_date"));
                    m.put("event_end_date", rs.getObject("event_end_date"));
                    m.put("event_schedule", rs.getString("event_schedule"));
                    m.put("visibility_type", rs.getString("visibility_type"));
                    m.put("join_mode", rs.getString("join_mode"));
                    m.put("invite_permissions", rs.getString("invite_permissions"));
                    m.put("max_community_members", rs.getObject("max_community_members"));
                    m.put("minimum_participants", rs.getObject("minimum_participants"));
                    m.put("maximum_participants", rs.getObject("maximum_participants"));
                    m.put("address", rs.getString("address"));
                    m.put("latitude", rs.getObject("latitude"));
                    m.put("longitude", rs.getObject("longitude"));
                    return m;
                },
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public int updateDynamic(String pointId, List<String> setFragments, List<Object> values) {
        String sql = "UPDATE tag_points SET " + String.join(", ", setFragments) + " WHERE point_id = ?";
        List<Object> args = new ArrayList<>(values);
        args.add(pointId);
        return jdbcTemplate.update(sql, args.toArray());
    }

    public List<String> findMemberUserIdsExceptOwner(String pointId, String ownerUserId) {
        return jdbcTemplate.query(
                "SELECT user_id FROM spot_you_members WHERE spot_you_id = ? AND user_id <> ?",
                (rs, rn) -> rs.getString("user_id"),
                pointId, ownerUserId
        );
    }

    public Optional<Boolean> findNewDateComing(String pointId) {
        List<Boolean> rows = jdbcTemplate.query(
                "SELECT new_date_coming FROM tag_points WHERE point_id = ?",
                (rs, rn) -> rs.getBoolean("new_date_coming"),
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<String> findOwnerId(String pointId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT user_id FROM tag_points WHERE point_id = ?",
                (rs, rn) -> rs.getString("user_id"),
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public int updateNewDateComing(String pointId, boolean value) {
        return jdbcTemplate.update(
                "UPDATE tag_points SET new_date_coming = ?, updated_at = CURRENT_TIMESTAMP WHERE point_id = ?",
                value, pointId
        );
    }

    public Integer fetchMinParticipants(String pointId) {
        Integer v = jdbcTemplate.queryForObject(
                "SELECT minimum_participants FROM tag_points WHERE point_id = ?",
                Integer.class,
                pointId
        );
        return v;
    }

    public Integer fetchMaxParticipants(String pointId) {
        Integer v = jdbcTemplate.queryForObject(
                "SELECT maximum_participants FROM tag_points WHERE point_id = ?",
                Integer.class,
                pointId
        );
        return v;
    }
}
