package com.spotu.modules.users.infra;

import com.spotu.modules.auth.support.PythonIsoTimestamps;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSetMetaData;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class ReactivatableRepository {

    private final JdbcTemplate jdbcTemplate;

    public ReactivatableRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Map<String, Object>> findDeactivatedTagPoints(String userId) {
        return queryForList("""
                SELECT point_id AS id, title, images AS image_data,
                       deleted_at, media_purge_scheduled_at, media_purged, reactivated_at
                FROM tag_points
                WHERE user_id = ? AND deleted_at IS NOT NULL
                  AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
                ORDER BY deleted_at DESC
                """, List.of(userId));
    }

    public List<Map<String, Object>> findDeactivatedServices(String userId) {
        return queryForList("""
                SELECT service_id AS id, title, images AS image_data,
                       deleted_at, media_purge_scheduled_at, media_purged, reactivated_at
                FROM services
                WHERE coach_id = ? AND deleted_at IS NOT NULL
                  AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
                ORDER BY deleted_at DESC
                """, List.of(userId));
    }

    public List<Map<String, Object>> findDeactivatedProducts(String userId) {
        return queryForList("""
                SELECT product_id AS id, title, image_urls AS image_data,
                       deleted_at, media_purge_scheduled_at, media_purged, reactivated_at
                FROM marketplace_products
                WHERE seller_id = ? AND deleted_at IS NOT NULL
                  AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
                ORDER BY deleted_at DESC
                """, List.of(userId));
    }

    private List<Map<String, Object>> queryForList(String sql, List<?> params) {
        return jdbcTemplate.query(sql, rs -> {
            List<Map<String, Object>> rows = new ArrayList<>();
            ResultSetMetaData md = rs.getMetaData();
            int cols = md.getColumnCount();
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                for (int i = 1; i <= cols; i++) {
                    Object value = rs.getObject(i);
                    if (value instanceof Timestamp ts) {
                        value = PythonIsoTimestamps.fromTimestamp(ts);
                    }
                    row.put(md.getColumnLabel(i), value);
                }
                rows.add(row);
            }
            return rows;
        }, params.toArray());
    }
}
