package com.spotu.modules.marketplace.infra;

import com.spotu.modules.auth.support.PythonIsoTimestamps;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSetMetaData;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class ProductCreationRepository {

    private final JdbcTemplate jdbcTemplate;

    public ProductCreationRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<String> findStatusByProductAndSeller(String productId, String sellerId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT status FROM marketplace_products WHERE product_id = ? AND seller_id = ?",
                (rs, rn) -> rs.getString("status"),
                productId,
                sellerId
        );
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        return Optional.ofNullable(rows.get(0));
    }

    public void insertProduct(Map<String, Object> p) {
        try {
            jdbcTemplate.update("""
                            INSERT INTO marketplace_products (
                                product_id, title, short_description, description,
                                price, currency, product_type, pricing_type,
                                pricing_modes, price_per_hour, price_per_day, price_per_week, price_per_month,
                                seller_id, seller_type, seller_name, seller_picture_url,
                                category, subcategory,
                                cover_image_url, image_url, image_urls,
                                condition_label, included_items,
                                size_dimensions,
                                available_quantity, in_stock,
                                deposit_required, deposit_amount,
                                pickup_type, pickup_notes, availability_note,
                                return_rules, cancellation_rules,
                                city, lat, lng, location_address_raw, location_privacy, radius_km,
                                related_spotyou_ids, tag_ids, delivery_modes,
                                status, skill_level, created_at, updated_at
                            ) VALUES (
                                ?,?,?,?,
                                ?,?,?,?,
                                ?,?,?,?,?,
                                ?,?,?,?,
                                ?,?,
                                ?,?,?,
                                ?,?,
                                ?,
                                ?,?,
                                ?,?,
                                ?,?,?,
                                ?,?,
                                ?,?,?,?,?,?,
                                ?,?,?,
                                ?,?,?,?
                            )
                            """,
                    p.get("product_id"), p.get("title"), p.get("short_description"), p.get("description"),
                    p.get("price"), p.get("currency"), p.get("product_type"), p.get("pricing_type"),
                    p.get("pricing_modes"), p.get("price_per_hour"), p.get("price_per_day"), p.get("price_per_week"), p.get("price_per_month"),
                    p.get("seller_id"), p.get("seller_type"), p.get("seller_name"), p.get("seller_picture_url"),
                    p.get("category"), p.get("subcategory"),
                    p.get("cover_image_url"), p.get("image_url"), p.get("image_urls"),
                    p.get("condition_label"), p.get("included_items"),
                    p.get("size_dimensions"),
                    p.get("available_quantity"), p.get("in_stock"),
                    p.get("deposit_required"), p.get("deposit_amount"),
                    p.get("pickup_type"), p.get("pickup_notes"), p.get("availability_note"),
                    p.get("return_rules"), p.get("cancellation_rules"),
                    p.get("city"), p.get("lat"), p.get("lng"), p.get("location_address_raw"), p.get("location_privacy"), p.get("radius_km"),
                    p.get("related_spotyou_ids"), p.get("tag_ids"), p.get("delivery_modes"),
                    p.get("status"), p.get("skill_level"), p.get("created_at"), p.get("updated_at")
            );
        } catch (DataIntegrityViolationException ex) {
            throw ex;
        }
    }

    public void updateProductMain(Map<String, Object> p) {
        jdbcTemplate.update("""
                        UPDATE marketplace_products SET
                            title = ?, short_description = ?, description = ?,
                            price = ?, currency = ?, product_type = ?, pricing_type = ?,
                            pricing_modes = ?, price_per_hour = ?, price_per_day = ?,
                            price_per_week = ?, price_per_month = ?,
                            category = ?, subcategory = ?,
                            cover_image_url = ?, image_url = ?, image_urls = ?,
                            condition_label = ?, included_items = ?,
                            size_dimensions = ?, available_quantity = ?, in_stock = ?,
                            deposit_required = ?, deposit_amount = ?,
                            pickup_type = ?, pickup_notes = ?, availability_note = ?,
                            return_rules = ?, cancellation_rules = ?,
                            city = ?, lat = ?, lng = ?,
                            location_address_raw = ?, location_privacy = ?, radius_km = ?,
                            related_spotyou_ids = ?, tag_ids = ?, delivery_modes = ?,
                            status = ?, updated_at = ?
                        WHERE product_id = ? AND seller_id = ?
                        """,
                p.get("title"), p.get("short_description"), p.get("description"),
                p.get("price"), p.get("currency"), p.get("product_type"), p.get("pricing_type"),
                p.get("pricing_modes"), p.get("price_per_hour"), p.get("price_per_day"),
                p.get("price_per_week"), p.get("price_per_month"),
                p.get("category"), p.get("subcategory"),
                p.get("cover_image_url"), p.get("image_url"), p.get("image_urls"),
                p.get("condition_label"), p.get("included_items"),
                p.get("size_dimensions"), p.get("available_quantity"), p.get("in_stock"),
                p.get("deposit_required"), p.get("deposit_amount"),
                p.get("pickup_type"), p.get("pickup_notes"), p.get("availability_note"),
                p.get("return_rules"), p.get("cancellation_rules"),
                p.get("city"), p.get("lat"), p.get("lng"),
                p.get("location_address_raw"), p.get("location_privacy"), p.get("radius_km"),
                p.get("related_spotyou_ids"), p.get("tag_ids"), p.get("delivery_modes"),
                p.get("status"), p.get("updated_at"),
                p.get("product_id"), p.get("seller_id")
        );
    }

    public void updateProductSecondary(String productId, String sellerId, Double pricePerSession,
                                       String brand, String model, String weight,
                                       String stripeProductId, String stripePriceId) {
        jdbcTemplate.update("""
                        UPDATE marketplace_products
                        SET price_per_session = ?,
                            brand = ?, model = ?, weight = ?,
                            stripe_product_id = ?, stripe_price_id = ?
                        WHERE product_id = ? AND seller_id = ?
                        """,
                pricePerSession, brand, model, weight, stripeProductId, stripePriceId, productId, sellerId
        );
    }

    public List<String> findAdminUserIds() {
        return jdbcTemplate.query("SELECT user_id FROM users WHERE role = 'admin'", (rs, rn) -> rs.getString("user_id"));
    }

    public List<Map<String, Object>> findMine(String sellerId) {
        return queryForList("""
                SELECT
                    product_id, title, short_description, description,
                    price, currency, product_type, pricing_type,
                    pricing_modes, price_per_hour, price_per_day, price_per_week, price_per_month, price_per_session,
                    status, category, subcategory,
                    cover_image_url, image_url, image_urls,
                    condition_label, available_quantity,
                    deposit_required, deposit_amount,
                    pickup_type, city, location_privacy,
                    related_spotyou_ids, created_at, updated_at,
                    rejection_reason, admin_comment,
                    brand, model, weight
                FROM marketplace_products
                WHERE seller_id = ?
                  AND status != 'deleted'
                  AND product_type IN ('rental', 'sale')
                ORDER BY created_at DESC
                """, List.of(sellerId));
    }

    public Optional<Map<String, Object>> findDetail(String productId, String sellerId) {
        List<Map<String, Object>> rows = queryForList("""
                SELECT product_id, title, short_description, description,
                       price, currency, product_type, pricing_type,
                       status, category, subcategory,
                       cover_image_url, image_url, image_urls,
                       condition_label, available_quantity,
                       deposit_required, deposit_amount,
                       pickup_type, pickup_notes, city, location_address_raw, location_privacy, lat, lng,
                       return_rules, cancellation_rules, availability_note,
                       included_items, size_dimensions,
                       tag_ids,
                       pricing_modes, price_per_hour, price_per_day, price_per_week, price_per_month, price_per_session,
                       related_spotyou_ids,
                       rejection_reason, admin_comment,
                       brand, model, weight,
                       created_at, updated_at
                FROM marketplace_products
                WHERE product_id = ? AND seller_id = ? AND status != 'deleted'
                """, List.of(productId, sellerId));
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(rows.get(0));
    }

    public Optional<Map<String, Object>> findDeleteGuardRow(String productId, String sellerId) {
        List<Map<String, Object>> rows = queryForList("""
                SELECT product_id, image_urls
                FROM marketplace_products
                WHERE product_id = ? AND seller_id = ? AND status != 'deleted'
                """, List.of(productId, sellerId));
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(rows.get(0));
    }

    public void softDeleteProduct(String productId, String sellerId, Timestamp now, Timestamp mediaPurgeAt) {
        jdbcTemplate.update(
                """
                        UPDATE marketplace_products
                        SET status = 'deleted',
                            deleted_at = ?,
                            deleted_by = ?,
                            media_purge_scheduled_at = ?,
                            updated_at = ?
                        WHERE product_id = ? AND seller_id = ?
                        """,
                now, sellerId, mediaPurgeAt, now, productId, sellerId
        );
    }

    public void scheduleFileDeletion(String fileUrl, String entityType, String entityId, Timestamp scheduledAt) {
        jdbcTemplate.update(
                """
                        INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at, status)
                        SELECT ?, ?, ?, ?, 'pending'
                        WHERE NOT EXISTS (
                            SELECT 1 FROM pending_file_deletions WHERE file_url = ? AND entity_id = ?
                        )
                        """,
                fileUrl, entityType, entityId, scheduledAt, fileUrl, entityId
        );
    }

    public Optional<Map<String, Object>> findReactivateGuardRow(String productId) {
        List<Map<String, Object>> rows = queryForList("""
                SELECT seller_id, status, deleted_at, media_purged
                FROM marketplace_products
                WHERE product_id = ?
                """, List.of(productId));
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(rows.get(0));
    }

    public int cancelPendingFileDeletions(String productId) {
        return jdbcTemplate.update(
                "DELETE FROM pending_file_deletions WHERE entity_id = ? AND status = 'pending'",
                productId
        );
    }

    public void reactivateProduct(String productId, Timestamp now) {
        jdbcTemplate.update(
                """
                        UPDATE marketplace_products
                        SET status = 'active',
                            deleted_at = NULL,
                            deleted_by = NULL,
                            updated_at = ?,
                            media_purge_scheduled_at = NULL,
                            media_purge_notified_at = NULL,
                            reactivated_at = ?
                        WHERE product_id = ?
                        """,
                now, now, productId
        );
    }

    public List<String> findDueProductIdsForMediaPurge(Timestamp now) {
        return jdbcTemplate.query(
                """
                        SELECT product_id
                        FROM marketplace_products
                        WHERE media_purge_scheduled_at <= ?
                          AND media_purged = FALSE
                          AND deleted_at IS NOT NULL
                          AND status = 'deleted'
                          AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
                        """,
                (rs, rn) -> rs.getString("product_id"),
                now
        );
    }

    public int markProductsMediaPurged(List<String> productIds, Timestamp now) {
        if (productIds == null || productIds.isEmpty()) {
            return 0;
        }
        String placeholders = String.join(",", productIds.stream().map(v -> "?").toList());
        List<Object> params = new ArrayList<>();
        params.add(now);
        params.addAll(productIds);
        return jdbcTemplate.update(
                "UPDATE marketplace_products SET media_purged = TRUE, media_purged_at = ? WHERE product_id IN (" + placeholders + ")",
                params.toArray()
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
}
