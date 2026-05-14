package com.spotu.modules.marketplace.infra;

import com.spotu.modules.auth.support.PythonIsoTimestamps;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSetMetaData;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.StringJoiner;

@Repository
public class MarketplaceProductsRepository {

    private final JdbcTemplate jdbcTemplate;
    private final String jdbcUrl;

    public MarketplaceProductsRepository(
            JdbcTemplate jdbcTemplate,
            @Value("${spring.datasource.url:}") String jdbcUrl
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.jdbcUrl = jdbcUrl == null ? "" : jdbcUrl;
    }

    public Optional<SpotYouContextRow> findSpotYouContext(String pointId) {
        if (isPostgres()) {
            try {
                List<Map<String, Object>> rows = queryForList("""
                        SELECT user_id, tag_ids,
                               ST_Y(location::geometry) AS slat,
                               ST_X(location::geometry) AS slng
                        FROM tag_points
                        WHERE point_id = ?
                        """, List.of(pointId));
                if (!rows.isEmpty()) {
                    return Optional.of(toSpotYouContextRow(rows.get(0)));
                }
            } catch (Exception ignored) {
            }
        }
        List<Map<String, Object>> rows = queryForList("""
                SELECT user_id, tag_ids,
                       latitude AS slat,
                       longitude AS slng
                FROM tag_points
                WHERE point_id = ?
                """, List.of(pointId));
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(toSpotYouContextRow(rows.get(0)));
    }

    public List<Map<String, Object>> findFeedProducts(int limit) {
        return queryForList("""
                SELECT p.*,
                       u.name AS seller_name,
                       u.picture AS seller_picture,
                       u.picture AS seller_picture_url
                FROM marketplace_products p
                LEFT JOIN users u ON p.seller_id = u.user_id
                WHERE p.status = 'active'
                ORDER BY p.created_at DESC
                LIMIT ?
                """, List.of(limit));
    }

    public List<Map<String, Object>> findProductsByTags(List<String> tags, String ownerId) {
        if (tags.isEmpty()) {
            return List.of();
        }
        List<Object> params = new ArrayList<>();
        StringBuilder sql = new StringBuilder("""
                SELECT p.*,
                       u.name AS seller_name,
                       u.picture AS seller_picture,
                       u.picture AS seller_picture_url
                FROM marketplace_products p
                LEFT JOIN users u ON p.seller_id = u.user_id
                WHERE p.status = 'active'
                """);
        if (isPostgres()) {
            String ph = String.join(",", tags.stream().map(t -> "?").toList());
            sql.append(" AND p.tag_ids && ARRAY[").append(ph).append("]::text[] ");
            params.addAll(tags);
        } else {
            sql.append(" AND (");
            StringJoiner sj = new StringJoiner(" OR ");
            for (int i = 0; i < tags.size(); i++) {
                sj.add("p.tag_ids LIKE ?");
            }
            sql.append(sj).append(") ");
            for (String tag : tags) {
                params.add("%\"" + tag + "\"%");
            }
        }
        params.add(ownerId);
        sql.append(" ORDER BY CASE WHEN p.seller_id = ? THEN 0 ELSE 1 END, p.created_at DESC ");
        return queryForList(sql.toString(), params);
    }

    public List<Map<String, Object>> findServicesByTags(List<String> tags, String ownerId) {
        if (tags.isEmpty()) {
            return List.of();
        }
        List<Object> params = new ArrayList<>();
        StringBuilder sql = new StringBuilder("""
                SELECT s.service_id, s.coach_id, s.title, s.description, s.price, s.duration_min,
                       s.images, s.tag_ids, s.location_description, s.address, s.created_at, s.updated_at,
                       u.name AS coach_name, u.picture AS coach_picture
                FROM services s
                LEFT JOIN users u ON s.coach_id = u.user_id
                WHERE s.active = TRUE
                """);
        if (isPostgres()) {
            String ph = String.join(",", tags.stream().map(t -> "?").toList());
            sql.append(" AND jsonb_exists_any(COALESCE(s.tag_ids::jsonb, '[]'::jsonb), ARRAY[").append(ph).append("]::text[]) ");
            params.addAll(tags);
        } else {
            sql.append(" AND (");
            StringJoiner sj = new StringJoiner(" OR ");
            for (int i = 0; i < tags.size(); i++) {
                sj.add("s.tag_ids LIKE ?");
            }
            sql.append(sj).append(") ");
            for (String tag : tags) {
                params.add("%\"" + tag + "\"%");
            }
        }
        params.add(ownerId);
        sql.append(" ORDER BY CASE WHEN s.coach_id = ? THEN 0 ELSE 1 END, s.created_at DESC LIMIT 20 ");
        return queryForList(sql.toString(), params);
    }

    public Map<String, RatingRow> findRatings(List<String> sellerIds) {
        if (sellerIds.isEmpty()) {
            return Map.of();
        }
        String ph = String.join(",", sellerIds.stream().map(x -> "?").toList());
        List<Map<String, Object>> rows = queryForList("""
                SELECT reviewee_id, ROUND(AVG(rating), 1) AS avg_r, COUNT(*) AS cnt_r
                FROM reviews
                WHERE reviewee_id IN (""" + ph + ") GROUP BY reviewee_id", new ArrayList<>(sellerIds));
        Map<String, RatingRow> out = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            String sellerId = asString(row.get("reviewee_id"));
            Double avg = toDoubleNullable(row.get("avg_r"));
            int count = toInt(row.get("cnt_r"));
            out.put(sellerId, new RatingRow(avg, count));
        }
        return out;
    }

    public Map<String, Integer> countProductsBySeller(List<String> sellerIds) {
        if (sellerIds.isEmpty()) {
            return Map.of();
        }
        String ph = String.join(",", sellerIds.stream().map(x -> "?").toList());
        List<Map<String, Object>> rows = queryForList("""
                SELECT seller_id, COUNT(*) AS cnt
                FROM marketplace_products
                WHERE seller_id IN (""" + ph + ") GROUP BY seller_id", new ArrayList<>(sellerIds));
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            out.put(asString(row.get("seller_id")), toInt(row.get("cnt")));
        }
        return out;
    }

    public Map<String, Integer> countActiveServicesByCoach(List<String> sellerIds) {
        if (sellerIds.isEmpty()) {
            return Map.of();
        }
        String ph = String.join(",", sellerIds.stream().map(x -> "?").toList());
        List<Map<String, Object>> rows = queryForList("""
                SELECT coach_id, COUNT(*) AS cnt
                FROM services
                WHERE active = TRUE AND coach_id IN (""" + ph + ") GROUP BY coach_id", new ArrayList<>(sellerIds));
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            out.put(asString(row.get("coach_id")), toInt(row.get("cnt")));
        }
        return out;
    }

    public Map<String, Integer> countSpotYouByUser(List<String> sellerIds) {
        if (sellerIds.isEmpty()) {
            return Map.of();
        }
        String ph = String.join(",", sellerIds.stream().map(x -> "?").toList());
        List<Map<String, Object>> rows = queryForList("""
                SELECT user_id, COUNT(*) AS cnt
                FROM tag_points
                WHERE user_id IN (""" + ph + ") GROUP BY user_id", new ArrayList<>(sellerIds));
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            out.put(asString(row.get("user_id")), toInt(row.get("cnt")));
        }
        return out;
    }

    private boolean isPostgres() {
        return jdbcUrl.startsWith("jdbc:postgresql:");
    }

    private SpotYouContextRow toSpotYouContextRow(Map<String, Object> row) {
        return new SpotYouContextRow(
                asString(row.get("user_id")),
                row.get("tag_ids"),
                toDoubleNullable(row.get("slat")),
                toDoubleNullable(row.get("slng"))
        );
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

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static Double toDoubleNullable(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number n) {
            return n.doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(value));
        } catch (Exception ignored) {
            return null;
        }
    }

    private static int toInt(Object value) {
        if (value instanceof Number n) {
            return n.intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (Exception ignored) {
            return 0;
        }
    }

    public record SpotYouContextRow(
            String userId,
            Object rawTagIds,
            Double slat,
            Double slng
    ) {
    }

    public record RatingRow(
            Double avg,
            int count
    ) {
    }
}
