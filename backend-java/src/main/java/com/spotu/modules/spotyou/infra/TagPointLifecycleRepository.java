package com.spotu.modules.spotyou.infra;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class TagPointLifecycleRepository {

    private final JdbcTemplate jdbcTemplate;
    private final String jdbcUrl;

    public TagPointLifecycleRepository(
            JdbcTemplate jdbcTemplate,
            @Value("${spring.datasource.url:}") String jdbcUrl
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.jdbcUrl = jdbcUrl == null ? "" : jdbcUrl;
    }

    public Optional<Map<String, Object>> findDeleteGuardRow(String pointId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                """
                        SELECT user_id, images, title, deleted_at
                        FROM tag_points WHERE point_id = ?
                        """,
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("user_id", rs.getString("user_id"));
                    m.put("images", rs.getString("images"));
                    m.put("title", rs.getString("title"));
                    m.put("deleted_at", rs.getTimestamp("deleted_at"));
                    return m;
                },
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<Map<String, Object>> findReactivateGuardRow(String pointId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                """
                        SELECT user_id, deleted_at, active, media_purged, title
                        FROM tag_points WHERE point_id = ?
                        """,
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("user_id", rs.getString("user_id"));
                    m.put("deleted_at", rs.getTimestamp("deleted_at"));
                    m.put("active", rs.getBoolean("active"));
                    m.put("media_purged", rs.getBoolean("media_purged"));
                    m.put("title", rs.getString("title"));
                    return m;
                },
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void softDeleteTagPoint(String pointId, String deletedBy, Timestamp now, Timestamp mediaPurgeAt) {
        jdbcTemplate.update(
                """
                        UPDATE tag_points
                        SET active = FALSE,
                            deleted_at = ?,
                            deleted_by = ?,
                            updated_at = ?,
                            media_purge_scheduled_at = ?
                        WHERE point_id = ?
                        """,
                now, deletedBy, now, mediaPurgeAt, pointId
        );
    }

    public int markConversationsContextDeleted(List<String> contextIds) {
        if (contextIds == null || contextIds.isEmpty()) {
            return 0;
        }
        String placeholders = String.join(",", contextIds.stream().map(x -> "?").toList());
        return jdbcTemplate.update(
                "UPDATE conversations SET context_deleted = TRUE WHERE context_id IN (" + placeholders + ") AND context_deleted = FALSE",
                contextIds.toArray()
        );
    }

    public int scheduleFileDeletions(String entityType, String entityId, List<String> imageUrls, Timestamp scheduledAt) {
        if (imageUrls == null || imageUrls.isEmpty()) {
            return 0;
        }
        int count = 0;
        boolean postgres = jdbcUrl.startsWith("jdbc:postgresql:");
        for (String url : imageUrls) {
            if (url == null || url.isBlank()) {
                continue;
            }
            count++;
            if (postgres) {
                jdbcTemplate.update(
                        """
                                INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at)
                                VALUES (?, ?, ?, ?)
                                ON CONFLICT DO NOTHING
                                """,
                        url, entityType, entityId, scheduledAt
                );
            } else {
                jdbcTemplate.update(
                        """
                                INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at, status)
                                SELECT ?, ?, ?, ?, 'pending'
                                WHERE NOT EXISTS (
                                  SELECT 1 FROM pending_file_deletions
                                  WHERE file_url = ? AND entity_id = ?
                                )
                                """,
                        url, entityType, entityId, scheduledAt, url, entityId
                );
            }
        }
        return count;
    }

    public List<String> findMemberUserIdsExcluding(String pointId, String excludedUserId) {
        return jdbcTemplate.query(
                "SELECT user_id FROM spot_you_members WHERE spot_you_id = ? AND user_id != ?",
                (rs, rn) -> rs.getString("user_id"),
                pointId, excludedUserId
        );
    }

    public int cancelPendingFileDeletions(String pointId) {
        return jdbcTemplate.update(
                "DELETE FROM pending_file_deletions WHERE entity_id = ? AND status = 'pending'",
                pointId
        );
    }

    public void reactivateTagPoint(String pointId, Timestamp now) {
        jdbcTemplate.update(
                """
                        UPDATE tag_points
                        SET active = TRUE,
                            deleted_at = NULL,
                            deleted_by = NULL,
                            updated_at = ?,
                            media_purge_scheduled_at = NULL,
                            media_purge_notified_at = NULL,
                            reactivated_at = ?
                        WHERE point_id = ?
                        """,
                now, now, pointId
        );
    }

    public void unmarkConversationContextDeleted(String pointId) {
        jdbcTemplate.update(
                "UPDATE conversations SET context_deleted = FALSE WHERE context_id = ? AND context_deleted = TRUE",
                pointId
        );
    }
}

