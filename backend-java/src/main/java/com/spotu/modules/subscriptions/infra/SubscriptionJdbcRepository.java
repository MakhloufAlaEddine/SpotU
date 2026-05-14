package com.spotu.modules.subscriptions.infra;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Accès DB pour les endpoints abonnements utilisateur (slice 21).
 */
@Repository
public class SubscriptionJdbcRepository {

    private final JdbcTemplate jdbcTemplate;

    public SubscriptionJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Map<String, Object>> findActivePlansForPublicApi() {
        return jdbcTemplate.query(
                """
                        SELECT plan_id, name, description, price, duration_days,
                               exempt_payer_fixed, exempt_payer_percent,
                               exempt_receiver_fixed, exempt_receiver_percent,
                               active, priority, created_at, updated_at
                        FROM subscription_plans
                        WHERE active = TRUE
                        ORDER BY priority DESC, price ASC
                        """,
                (rs, rn) -> mapPlanRow(rs)
        );
    }

    private static Map<String, Object> mapPlanRow(ResultSet rs) throws SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("plan_id", rs.getString("plan_id"));
        m.put("name", rs.getString("name"));
        m.put("description", rs.getString("description"));
        BigDecimal price = rs.getBigDecimal("price");
        m.put("price", price == null ? null : price.doubleValue());
        m.put("duration_days", rs.getObject("duration_days") == null ? null : rs.getInt("duration_days"));
        m.put("exempt_payer_fixed", rs.getBoolean("exempt_payer_fixed"));
        m.put("exempt_payer_percent", rs.getBoolean("exempt_payer_percent"));
        m.put("exempt_receiver_fixed", rs.getBoolean("exempt_receiver_fixed"));
        m.put("exempt_receiver_percent", rs.getBoolean("exempt_receiver_percent"));
        m.put("active", rs.getBoolean("active"));
        m.put("priority", rs.getInt("priority"));
        m.put("created_at", timestampToIso(rs, "created_at"));
        m.put("updated_at", timestampToIso(rs, "updated_at"));
        return m;
    }

    public Optional<Map<String, Object>> findPlanById(String planId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                """
                        SELECT plan_id, name, description, price, duration_days,
                               exempt_payer_fixed, exempt_payer_percent,
                               exempt_receiver_fixed, exempt_receiver_percent,
                               active, priority, created_at, updated_at,
                               stripe_product_id, stripe_price_id
                        FROM subscription_plans WHERE plan_id = ? LIMIT 1
                        """,
                (rs, rn) -> mapPlanFullRow(rs),
                planId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    private static Map<String, Object> mapPlanFullRow(ResultSet rs) throws SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("plan_id", rs.getString("plan_id"));
        m.put("name", rs.getString("name"));
        m.put("description", rs.getString("description"));
        BigDecimal price = rs.getBigDecimal("price");
        m.put("price", price);
        m.put("duration_days", rs.getObject("duration_days") == null ? null : rs.getInt("duration_days"));
        m.put("exempt_payer_fixed", rs.getBoolean("exempt_payer_fixed"));
        m.put("exempt_payer_percent", rs.getBoolean("exempt_payer_percent"));
        m.put("exempt_receiver_fixed", rs.getBoolean("exempt_receiver_fixed"));
        m.put("exempt_receiver_percent", rs.getBoolean("exempt_receiver_percent"));
        m.put("active", rs.getBoolean("active"));
        m.put("priority", rs.getInt("priority"));
        m.put("created_at", timestampToIso(rs, "created_at"));
        m.put("updated_at", timestampToIso(rs, "updated_at"));
        m.put("stripe_product_id", rs.getString("stripe_product_id"));
        m.put("stripe_price_id", rs.getString("stripe_price_id"));
        return m;
    }

    public void updatePlanStripeIds(String planId, String productId, String priceId) {
        jdbcTemplate.update(
                """
                        UPDATE subscription_plans
                        SET stripe_product_id = ?, stripe_price_id = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE plan_id = ?
                        """,
                productId,
                priceId,
                planId
        );
    }

    public Optional<Map<String, String>> findBlockingSubscriptionForSubscribe(String userId) {
        List<Map<String, String>> rows = jdbcTemplate.query(
                """
                        SELECT subscription_id, status FROM user_subscriptions
                        WHERE user_id = ?
                          AND status IN ('active', 'cancelling', 'trialing')
                        LIMIT 1
                        """,
                (rs, rn) -> Map.of(
                        "subscription_id", rs.getString("subscription_id"),
                        "status", rs.getString("status")
                ),
                userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void updateUserStripeCustomerIdIfNull(String userId, String customerId) {
        jdbcTemplate.update(
                """
                        UPDATE users SET stripe_customer_id = ?
                        WHERE user_id = ? AND (stripe_customer_id IS NULL OR stripe_customer_id = '')
                        """,
                customerId,
                userId
        );
    }

    public Optional<String> findStripeCustomerId(String userId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT stripe_customer_id FROM users WHERE user_id = ? LIMIT 1",
                (rs, rn) -> rs.getString("stripe_customer_id"),
                userId
        );
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        String v = rows.get(0);
        return v == null || v.isBlank() ? Optional.empty() : Optional.of(v);
    }

    public Optional<Map<String, Object>> findCurrentSubscriptionForMe(String userId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                """
                        SELECT us.subscription_id, us.user_id, us.plan_id, us.status,
                               us.started_at, us.expires_at, us.created_at, us.plan_code,
                               us.stripe_subscription_id, us.benefits_snapshot, us.cancelled_at, us.updated_at,
                               sp.name AS plan_name, sp.description AS plan_description,
                               sp.price AS plan_price, sp.duration_days,
                               sp.exempt_payer_fixed, sp.exempt_payer_percent,
                               sp.exempt_receiver_fixed, sp.exempt_receiver_percent
                        FROM user_subscriptions us
                        JOIN subscription_plans sp ON sp.plan_id = us.plan_id
                        WHERE us.user_id = ?
                          AND us.status IN ('active', 'cancelling', 'past_due', 'trialing')
                        ORDER BY us.started_at DESC
                        LIMIT 1
                        """,
                (rs, rn) -> mapJoinedSubscriptionRow(rs, true),
                userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public List<Map<String, Object>> findSubscriptionHistory(String userId) {
        return jdbcTemplate.query(
                """
                        SELECT us.subscription_id, us.user_id, us.plan_id, us.status,
                               us.started_at, us.expires_at, us.created_at, us.plan_code, us.cancelled_at,
                               us.stripe_subscription_id, us.benefits_snapshot, us.updated_at,
                               sp.name AS plan_name, sp.price AS plan_price
                        FROM user_subscriptions us
                        JOIN subscription_plans sp ON sp.plan_id = us.plan_id
                        WHERE us.user_id = ?
                        ORDER BY us.created_at DESC
                        """,
                (rs, rn) -> mapJoinedSubscriptionRow(rs, false),
                userId
        );
    }

    public Optional<Map<String, String>> findSubscriptionForCancel(String userId) {
        List<Map<String, String>> rows = jdbcTemplate.query(
                """
                        SELECT subscription_id, stripe_subscription_id, status
                        FROM user_subscriptions
                        WHERE user_id = ?
                          AND status IN ('active', 'cancelling', 'trialing')
                        ORDER BY started_at DESC
                        LIMIT 1
                        """,
                (rs, rn) -> {
                    Map<String, String> m = new LinkedHashMap<>();
                    m.put("subscription_id", rs.getString("subscription_id"));
                    m.put("stripe_subscription_id", rs.getString("stripe_subscription_id"));
                    m.put("status", rs.getString("status"));
                    return m;
                },
                userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void updateSubscriptionStatusAndCancelledAt(String subscriptionId, String newStatus) {
        jdbcTemplate.update(
                """
                        UPDATE user_subscriptions
                        SET status = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                        WHERE subscription_id = ?
                        """,
                newStatus,
                subscriptionId
        );
    }

    public Optional<Map<String, String>> findLocalSubscriptionByStripeId(String stripeSubscriptionId) {
        List<Map<String, String>> rows = jdbcTemplate.query(
                """
                        SELECT subscription_id, status FROM user_subscriptions
                        WHERE stripe_subscription_id = ? LIMIT 1
                        """,
                (rs, rn) -> Map.of(
                        "subscription_id", rs.getString("subscription_id"),
                        "status", rs.getString("status")
                ),
                stripeSubscriptionId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    private static Map<String, Object> mapJoinedSubscriptionRow(ResultSet rs, boolean includePlanExemptions)
            throws SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("subscription_id", rs.getString("subscription_id"));
        m.put("user_id", rs.getString("user_id"));
        m.put("plan_id", rs.getString("plan_id"));
        m.put("status", rs.getString("status"));
        m.put("started_at", timestampToIso(rs, "started_at"));
        m.put("expires_at", timestampToIso(rs, "expires_at"));
        m.put("created_at", timestampToIso(rs, "created_at"));
        m.put("stripe_subscription_id", rs.getString("stripe_subscription_id"));
        m.put("benefits_snapshot", rs.getString("benefits_snapshot"));
        m.put("cancelled_at", timestampToIso(rs, "cancelled_at"));
        m.put("updated_at", timestampToIso(rs, "updated_at"));
        m.put("plan_name", rs.getString("plan_name"));
        m.put("plan_code", rs.getString("plan_code"));
        if (includePlanExemptions) {
            m.put("plan_description", rs.getString("plan_description"));
            BigDecimal pp = rs.getBigDecimal("plan_price");
            m.put("plan_price", pp == null ? null : pp.doubleValue());
            m.put("duration_days", rs.getObject("duration_days") == null ? null : rs.getInt("duration_days"));
            m.put("exempt_payer_fixed", rs.getBoolean("exempt_payer_fixed"));
            m.put("exempt_payer_percent", rs.getBoolean("exempt_payer_percent"));
            m.put("exempt_receiver_fixed", rs.getBoolean("exempt_receiver_fixed"));
            m.put("exempt_receiver_percent", rs.getBoolean("exempt_receiver_percent"));
        } else {
            BigDecimal pp = rs.getBigDecimal("plan_price");
            m.put("plan_price", pp == null ? null : pp.doubleValue());
        }
        return m;
    }

    private static String timestampToIso(ResultSet rs, String col) throws SQLException {
        Timestamp t = rs.getTimestamp(col);
        if (t == null) {
            return null;
        }
        return t.toInstant().toString();
    }

    // ── Admin plans (slice 22) — aligné admin_routes.py ─────────────────────

    public List<Map<String, Object>> findAllPlansForAdmin() {
        return jdbcTemplate.query(
                """
                        SELECT plan_id, name, description, price, duration_days,
                               exempt_payer_fixed, exempt_payer_percent,
                               exempt_receiver_fixed, exempt_receiver_percent,
                               active, priority, created_at, updated_at,
                               stripe_product_id, stripe_price_id
                        FROM subscription_plans
                        ORDER BY priority DESC, created_at
                        """,
                (rs, rn) -> mapPlanAdminApiRow(rs)
        );
    }

    private static Map<String, Object> mapPlanAdminApiRow(ResultSet rs) throws SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("plan_id", rs.getString("plan_id"));
        m.put("name", rs.getString("name"));
        m.put("description", rs.getString("description"));
        BigDecimal price = rs.getBigDecimal("price");
        m.put("price", price == null ? null : price.doubleValue());
        m.put("duration_days", rs.getObject("duration_days") == null ? null : rs.getInt("duration_days"));
        m.put("exempt_payer_fixed", rs.getBoolean("exempt_payer_fixed"));
        m.put("exempt_payer_percent", rs.getBoolean("exempt_payer_percent"));
        m.put("exempt_receiver_fixed", rs.getBoolean("exempt_receiver_fixed"));
        m.put("exempt_receiver_percent", rs.getBoolean("exempt_receiver_percent"));
        m.put("active", rs.getBoolean("active"));
        m.put("priority", rs.getInt("priority"));
        m.put("created_at", timestampToIso(rs, "created_at"));
        m.put("updated_at", timestampToIso(rs, "updated_at"));
        m.put("stripe_product_id", rs.getString("stripe_product_id"));
        m.put("stripe_price_id", rs.getString("stripe_price_id"));
        return m;
    }

    public void insertPlan(
            String planId,
            String name,
            String description,
            BigDecimal price,
            Integer durationDays,
            boolean exemptPayerFixed,
            boolean exemptPayerPercent,
            boolean exemptReceiverFixed,
            boolean exemptReceiverPercent,
            boolean active,
            int priority
    ) {
        jdbcTemplate.update(
                """
                        INSERT INTO subscription_plans (
                            plan_id, name, description, price, duration_days,
                            exempt_payer_fixed, exempt_payer_percent,
                            exempt_receiver_fixed, exempt_receiver_percent,
                            active, priority
                        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
                        """,
                planId,
                name,
                description,
                price,
                durationDays,
                exemptPayerFixed,
                exemptPayerPercent,
                exemptReceiverFixed,
                exemptReceiverPercent,
                active,
                priority
        );
    }

    public Optional<Map<String, Object>> findPlanAdminById(String planId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                """
                        SELECT plan_id, name, description, price, duration_days,
                               exempt_payer_fixed, exempt_payer_percent,
                               exempt_receiver_fixed, exempt_receiver_percent,
                               active, priority, created_at, updated_at,
                               stripe_product_id, stripe_price_id
                        FROM subscription_plans WHERE plan_id = ? LIMIT 1
                        """,
                (rs, rn) -> mapPlanAdminApiRow(rs),
                planId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    private static final Set<String> ADMIN_PLAN_UPDATE_COLUMNS = Set.of(
            "name", "description", "price", "duration_days",
            "exempt_payer_fixed", "exempt_payer_percent",
            "exempt_receiver_fixed", "exempt_receiver_percent",
            "active", "priority"
    );

    /**
     * @return nombre de lignes mises à jour (0 si plan absent)
     */
    public int updatePlanDynamic(String planId, Map<String, Object> fields) {
        if (fields.isEmpty()) {
            return 0;
        }
        StringBuilder sql = new StringBuilder("UPDATE subscription_plans SET ");
        List<Object> params = new ArrayList<>();
        boolean first = true;
        int setCount = 0;
        for (Map.Entry<String, Object> e : fields.entrySet()) {
            if (!ADMIN_PLAN_UPDATE_COLUMNS.contains(e.getKey())) {
                continue;
            }
            if (!first) {
                sql.append(", ");
            }
            first = false;
            setCount++;
            sql.append(e.getKey()).append(" = ?");
            params.add(coercePlanUpdateValue(e.getKey(), e.getValue()));
        }
        if (setCount == 0) {
            return 0;
        }
        sql.append(", updated_at = CURRENT_TIMESTAMP WHERE plan_id = ?");
        params.add(planId);
        return jdbcTemplate.update(sql.toString(), params.toArray());
    }

    private static Object coercePlanUpdateValue(String key, Object raw) {
        if (raw == null) {
            return null;
        }
        return switch (key) {
            case "name", "description" -> raw.toString();
            case "price" -> {
                if (raw instanceof BigDecimal bd) {
                    yield bd;
                }
                if (raw instanceof Number n) {
                    yield BigDecimal.valueOf(n.doubleValue());
                }
                yield new BigDecimal(raw.toString());
            }
            case "duration_days" -> raw instanceof Number n ? n.intValue() : Integer.parseInt(raw.toString());
            case "priority" -> raw instanceof Number n ? n.intValue() : Integer.parseInt(raw.toString());
            case "exempt_payer_fixed", "exempt_payer_percent", "exempt_receiver_fixed", "exempt_receiver_percent", "active" ->
                    raw instanceof Boolean b ? b : Boolean.parseBoolean(raw.toString());
            default -> raw;
        };
    }

    public int deletePlanById(String planId) {
        return jdbcTemplate.update("DELETE FROM subscription_plans WHERE plan_id = ?", planId);
    }

    // ── Admin subscriptions list (slice 22) ─────────────────────────────────

    public List<Map<String, Object>> findAllSubscriptionsForAdmin() {
        return jdbcTemplate.query(
                """
                        SELECT us.subscription_id, us.user_id, us.plan_id, us.status,
                               us.started_at, us.expires_at, us.created_at, us.plan_code,
                               us.stripe_subscription_id, us.benefits_snapshot, us.cancelled_at, us.updated_at,
                               u.name AS user_name, u.email AS email,
                               sp.name AS plan_name, sp.price AS plan_price
                        FROM user_subscriptions us
                        LEFT JOIN users u ON u.user_id = us.user_id
                        LEFT JOIN subscription_plans sp ON sp.plan_id = us.plan_id
                        ORDER BY us.created_at DESC
                        LIMIT 500
                        """,
                (rs, rn) -> mapAdminSubscriptionListRow(rs)
        );
    }

    private static Map<String, Object> mapAdminSubscriptionListRow(ResultSet rs) throws SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("subscription_id", rs.getString("subscription_id"));
        m.put("user_id", rs.getString("user_id"));
        m.put("plan_id", rs.getString("plan_id"));
        m.put("status", rs.getString("status"));
        m.put("started_at", timestampToIso(rs, "started_at"));
        m.put("expires_at", timestampToIso(rs, "expires_at"));
        m.put("created_at", timestampToIso(rs, "created_at"));
        m.put("plan_code", rs.getString("plan_code"));
        m.put("stripe_subscription_id", rs.getString("stripe_subscription_id"));
        m.put("benefits_snapshot", rs.getString("benefits_snapshot"));
        m.put("cancelled_at", timestampToIso(rs, "cancelled_at"));
        m.put("updated_at", timestampToIso(rs, "updated_at"));
        m.put("user_name", rs.getString("user_name"));
        m.put("email", rs.getString("email"));
        m.put("plan_name", rs.getString("plan_name"));
        BigDecimal pp = rs.getBigDecimal("plan_price");
        m.put("plan_price", pp == null ? null : pp.doubleValue());
        return m;
    }

    public Optional<Map<String, String>> findSubscriptionStripeIdBySubscriptionId(String subscriptionId) {
        List<Map<String, String>> rows = jdbcTemplate.query(
                """
                        SELECT subscription_id, stripe_subscription_id, status
                        FROM user_subscriptions WHERE subscription_id = ? LIMIT 1
                        """,
                (rs, rn) -> {
                    Map<String, String> m = new LinkedHashMap<>();
                    m.put("subscription_id", rs.getString("subscription_id"));
                    m.put("stripe_subscription_id", rs.getString("stripe_subscription_id"));
                    m.put("status", rs.getString("status"));
                    return m;
                },
                subscriptionId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }
}
