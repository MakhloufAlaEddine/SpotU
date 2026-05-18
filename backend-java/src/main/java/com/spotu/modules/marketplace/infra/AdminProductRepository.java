package com.spotu.modules.marketplace.infra;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.common.JdbcSqlDialect;
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
import java.util.UUID;

@Repository
public class AdminProductRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final JdbcSqlDialect jdbcSqlDialect;
    private final String jdbcUrl;

    public AdminProductRepository(
            JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper,
            JdbcSqlDialect jdbcSqlDialect,
            @Value("${spring.datasource.url:}") String jdbcUrl
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.jdbcSqlDialect = jdbcSqlDialect;
        this.jdbcUrl = jdbcUrl == null ? "" : jdbcUrl;
    }

    public List<Map<String, Object>> findPendingProducts() {
        if (isPostgres()) {
            return queryForList("""
                    SELECT
                        p.product_id, p.title, p.short_description, p.price, p.pricing_type,
                        p.category, p.subcategory, p.cover_image_url, p.image_url, p.image_urls,
                        p.condition_label, p.available_quantity,
                        p.deposit_required, p.deposit_amount,
                        p.pickup_type, p.city, p.lat, p.lng,
                        p.return_rules, p.cancellation_rules, p.pickup_notes,
                        p.availability_note, p.related_spotyou_ids,
                        p.seller_id, p.status, p.created_at, p.updated_at,
                        p.admin_reminder_sent_at,
                        u.name AS seller_name, u.picture AS seller_picture,
                        (
                            CASE WHEN p.cover_image_url IS NOT NULL THEN 20 ELSE 0 END +
                            CASE WHEN jsonb_array_length(COALESCE(p.image_urls, '[]'::jsonb)) >= 3 THEN 10 ELSE 0 END +
                            CASE WHEN length(p.title) >= 10 THEN 15 ELSE 0 END +
                            CASE WHEN length(p.title) >= 25 THEN 5 ELSE 0 END +
                            CASE WHEN length(COALESCE(p.description,'')) >= 50 THEN 10 ELSE 0 END +
                            CASE WHEN length(COALESCE(p.description,'')) >= 150 THEN 10 ELSE 0 END +
                            CASE WHEN p.price > 0 THEN 10 ELSE 0 END +
                            CASE WHEN p.pickup_type IS NOT NULL THEN 10 ELSE 0 END +
                            CASE WHEN p.lat IS NOT NULL THEN 10 ELSE 0 END
                        ) AS quality_score
                    FROM marketplace_products p
                    JOIN users u ON u.user_id = p.seller_id
                    WHERE p.status = 'pending_review'
                    ORDER BY p.created_at ASC
                    """, List.of());
        }
        return queryForList("""
                SELECT
                    p.product_id, p.title, p.short_description, p.price, p.pricing_type,
                    p.category, p.subcategory, p.cover_image_url, p.image_url, p.image_urls,
                    p.condition_label, p.available_quantity,
                    p.deposit_required, p.deposit_amount,
                    p.pickup_type, p.city, p.lat, p.lng,
                    p.return_rules, p.cancellation_rules, p.pickup_notes,
                    p.availability_note, p.related_spotyou_ids,
                    p.seller_id, p.status, p.created_at, p.updated_at,
                    p.admin_reminder_sent_at,
                    u.name AS seller_name, u.picture AS seller_picture,
                    (
                        CASE WHEN p.cover_image_url IS NOT NULL THEN 20 ELSE 0 END +
                        CASE WHEN COALESCE(p.image_urls, '[]') LIKE '[%,%,%]%' THEN 10 ELSE 0 END +
                        CASE WHEN length(p.title) >= 10 THEN 15 ELSE 0 END +
                        CASE WHEN length(p.title) >= 25 THEN 5 ELSE 0 END +
                        CASE WHEN length(COALESCE(p.description,'')) >= 50 THEN 10 ELSE 0 END +
                        CASE WHEN length(COALESCE(p.description,'')) >= 150 THEN 10 ELSE 0 END +
                        CASE WHEN p.price > 0 THEN 10 ELSE 0 END +
                        CASE WHEN p.pickup_type IS NOT NULL THEN 10 ELSE 0 END +
                        CASE WHEN p.lat IS NOT NULL THEN 10 ELSE 0 END
                    ) AS quality_score
                FROM marketplace_products p
                JOIN users u ON u.user_id = p.seller_id
                WHERE p.status = 'pending_review'
                ORDER BY p.created_at ASC
                """, List.of());
    }

    public Optional<Map<String, Object>> findAdminDetail(String productId) {
        String sql = isPostgres()
                ? """
                SELECT p.*,
                       u.name AS seller_name,
                       u.picture AS seller_picture,
                       u.email AS seller_email,
                       (
                           CASE WHEN p.cover_image_url IS NOT NULL THEN 20 ELSE 0 END +
                           CASE WHEN jsonb_array_length(COALESCE(p.image_urls, '[]'::jsonb)) >= 3 THEN 10 ELSE 0 END +
                           CASE WHEN length(p.title) >= 10 THEN 15 ELSE 0 END +
                           CASE WHEN length(p.title) >= 25 THEN 5 ELSE 0 END +
                           CASE WHEN length(COALESCE(p.description,'')) >= 50 THEN 10 ELSE 0 END +
                           CASE WHEN length(COALESCE(p.description,'')) >= 150 THEN 10 ELSE 0 END +
                           CASE WHEN p.price > 0 THEN 10 ELSE 0 END +
                           CASE WHEN p.pickup_type IS NOT NULL THEN 10 ELSE 0 END +
                           CASE WHEN p.lat IS NOT NULL THEN 10 ELSE 0 END
                       ) AS quality_score
                FROM marketplace_products p
                JOIN users u ON u.user_id = p.seller_id
                WHERE p.product_id = ?
                """
                : """
                SELECT p.*,
                       u.name AS seller_name,
                       u.picture AS seller_picture,
                       u.email AS seller_email,
                       (
                           CASE WHEN p.cover_image_url IS NOT NULL THEN 20 ELSE 0 END +
                           CASE WHEN COALESCE(p.image_urls, '[]') LIKE '[%,%,%]%' THEN 10 ELSE 0 END +
                           CASE WHEN length(p.title) >= 10 THEN 15 ELSE 0 END +
                           CASE WHEN length(p.title) >= 25 THEN 5 ELSE 0 END +
                           CASE WHEN length(COALESCE(p.description,'')) >= 50 THEN 10 ELSE 0 END +
                           CASE WHEN length(COALESCE(p.description,'')) >= 150 THEN 10 ELSE 0 END +
                           CASE WHEN p.price > 0 THEN 10 ELSE 0 END +
                           CASE WHEN p.pickup_type IS NOT NULL THEN 10 ELSE 0 END +
                           CASE WHEN p.lat IS NOT NULL THEN 10 ELSE 0 END
                       ) AS quality_score
                FROM marketplace_products p
                JOIN users u ON u.user_id = p.seller_id
                WHERE p.product_id = ?
                """;
        List<Map<String, Object>> rows = queryForList(sql, List.of(productId));
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(rows.get(0));
    }

    public Optional<Map<String, String>> findSellerAndTitle(String productId) {
        List<Map<String, String>> rows = jdbcTemplate.query(
                "SELECT seller_id, title FROM marketplace_products WHERE product_id = ?",
                (rs, rn) -> {
                    Map<String, String> m = new LinkedHashMap<>();
                    m.put("seller_id", rs.getString("seller_id"));
                    m.put("title", rs.getString("title"));
                    return m;
                },
                productId
        );
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(rows.get(0));
    }

    public void approveProduct(String productId, String adminUserId, Timestamp now, String comment) {
        jdbcTemplate.update("""
                        UPDATE marketplace_products
                        SET status = 'active',
                            in_stock = TRUE,
                            admin_validated_by = ?,
                            admin_validated_at = ?,
                            admin_comment = ?,
                            updated_at = ?
                        WHERE product_id = ?
                        """,
                adminUserId, now, comment, now, productId
        );
    }

    public void rejectProduct(String productId, String adminUserId, Timestamp now, String comment) {
        jdbcTemplate.update("""
                        UPDATE marketplace_products
                        SET status = 'rejected',
                            in_stock = FALSE,
                            admin_validated_by = ?,
                            admin_validated_at = ?,
                            rejection_reason = ?,
                            admin_comment = ?,
                            updated_at = ?
                        WHERE product_id = ?
                        """,
                adminUserId, now, comment, comment, now, productId
        );
    }

    public void insertNotification(String userId, String type, String title, String body, Map<String, Object> data) {
        jdbcTemplate.update(
                jdbcSqlDialect.notificationInsertSql(),
                "notif_" + UUID.randomUUID().toString().replace("-", ""),
                userId,
                type,
                title,
                body,
                toJson(data)
        );
    }

    public List<Map<String, String>> findPendingReminderProducts(int delayHours) {
        String sql = isPostgres()
                ? """
                SELECT product_id, title
                FROM marketplace_products
                WHERE status = 'pending_review'
                  AND created_at < NOW() - make_interval(hours => ?)
                  AND (
                        admin_reminder_sent_at IS NULL
                     OR admin_reminder_sent_at < NOW() - make_interval(hours => ?)
                  )
                ORDER BY created_at ASC
                LIMIT 50
                """
                : """
                SELECT product_id, title
                FROM marketplace_products
                WHERE status = 'pending_review'
                  AND created_at < DATEADD('HOUR', ?, CURRENT_TIMESTAMP)
                  AND (
                        admin_reminder_sent_at IS NULL
                     OR admin_reminder_sent_at < DATEADD('HOUR', ?, CURRENT_TIMESTAMP)
                  )
                ORDER BY created_at ASC
                LIMIT 50
                """;
        int neg = -Math.abs(delayHours);
        return jdbcTemplate.query(
                sql,
                (rs, rn) -> {
                    Map<String, String> m = new LinkedHashMap<>();
                    m.put("product_id", rs.getString("product_id"));
                    m.put("title", rs.getString("title"));
                    return m;
                },
                neg,
                neg
        );
    }

    public int markReminderSent(List<String> productIds, Timestamp now) {
        if (productIds == null || productIds.isEmpty()) {
            return 0;
        }
        String placeholders = String.join(",", productIds.stream().map(v -> "?").toList());
        List<Object> params = new ArrayList<>();
        params.add(now);
        params.addAll(productIds);
        return jdbcTemplate.update(
                "UPDATE marketplace_products SET admin_reminder_sent_at = ? WHERE product_id IN (" + placeholders + ")",
                params.toArray()
        );
    }

    public List<String> findAdminUserIds() {
        return jdbcTemplate.query(
                "SELECT user_id FROM users WHERE role = 'admin'",
                (rs, rn) -> rs.getString("user_id")
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

    private String toJson(Map<String, Object> data) {
        try {
            return objectMapper.writeValueAsString(data == null ? Map.of() : data);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }

    private boolean isPostgres() {
        return jdbcUrl.startsWith("jdbc:postgresql:");
    }
}
