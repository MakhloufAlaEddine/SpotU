package com.spotu.modules.users.infra;

import com.spotu.modules.auth.support.PythonIsoTimestamps;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Date;
import java.sql.ResultSetMetaData;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class ActivityFeedRepository {

    private final JdbcTemplate jdbcTemplate;

    public ActivityFeedRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Map<String, String>> findMemberSpotTitles(String userId) {
        return jdbcTemplate.query(
                """
                SELECT p.spot_you_id, tp.title
                FROM spot_you_members p
                JOIN tag_points tp ON tp.point_id = p.spot_you_id
                WHERE p.user_id = ? AND tp.active = TRUE
                """,
                (rs, rn) -> {
                    Map<String, String> row = new LinkedHashMap<>();
                    row.put("spot_you_id", rs.getString("spot_you_id"));
                    row.put("title", rs.getString("title"));
                    return row;
                },
                userId
        );
    }

    public List<Map<String, Object>> findGoingActivities(List<String> spotIds, LocalDate today) {
        if (spotIds.isEmpty()) {
            return List.of();
        }
        List<Object> args = new ArrayList<>();
        args.add(Date.valueOf(today));
        args.addAll(spotIds);
        String placeholders = String.join(",", spotIds.stream().map(x -> "?").toList());
        String sql = """
                SELECT a.user_id, a.spot_you_id, a.session_date, a.created_at,
                       u.name, u.picture
                FROM spot_you_attendance a
                JOIN users u ON a.user_id = u.user_id
                WHERE a.status = 'going'
                  AND a.session_date >= ?
                  AND a.spot_you_id IN (%s)
                ORDER BY a.created_at DESC
                LIMIT 80
                """.formatted(placeholders);
        return queryForList(sql, args);
    }

    public List<Map<String, Object>> findRecentJoins(List<String> spotIds, String excludeUserId, Timestamp cutoff) {
        if (spotIds.isEmpty()) {
            return List.of();
        }
        List<Object> args = new ArrayList<>(spotIds);
        args.add(excludeUserId);
        args.add(cutoff);
        String placeholders = String.join(",", spotIds.stream().map(x -> "?").toList());
        String sql = """
                SELECT p.user_id, p.spot_you_id, p.joined_at,
                       u.name, u.picture
                FROM spot_you_members p
                JOIN users u ON p.user_id = u.user_id
                WHERE p.spot_you_id IN (%s)
                  AND p.user_id <> ?
                  AND p.joined_at >= ?
                ORDER BY p.joined_at DESC
                LIMIT 80
                """.formatted(placeholders);
        return queryForList(sql, args);
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
                    } else if (value instanceof Date d) {
                        value = d.toLocalDate().toString();
                    }
                    row.put(md.getColumnLabel(i), value);
                }
                rows.add(row);
            }
            return rows;
        }, params.toArray());
    }
}
