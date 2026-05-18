package com.spotu.modules.payments.infra;

import com.spotu.common.JdbcSqlDialect;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Écritures webhook abonnements (slice 20), alignées sur {@code webhook_handlers.py}.
 */
@Repository
public class SubscriptionWebhookRepository {

    private final JdbcTemplate jdbcTemplate;
    private final JdbcSqlDialect jdbcSqlDialect;

    public SubscriptionWebhookRepository(JdbcTemplate jdbcTemplate, JdbcSqlDialect jdbcSqlDialect) {
        this.jdbcTemplate = jdbcTemplate;
        this.jdbcSqlDialect = jdbcSqlDialect;
    }

    public Optional<String> findSubscriptionIdByStripeSubscriptionId(String stripeSubscriptionId) {
        List<String> rows = jdbcTemplate.query(
                """
                        SELECT subscription_id FROM user_subscriptions
                        WHERE stripe_subscription_id=? LIMIT 1
                        """,
                (rs, rn) -> rs.getString("subscription_id"),
                stripeSubscriptionId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<String> findUserIdByStripeSubscriptionId(String stripeSubscriptionId) {
        List<String> rows = jdbcTemplate.query(
                """
                        SELECT user_id FROM user_subscriptions
                        WHERE stripe_subscription_id=? LIMIT 1
                        """,
                (rs, rn) -> rs.getString("user_id"),
                stripeSubscriptionId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<SubscriptionPlanRow> findPlanById(String planId) {
        List<SubscriptionPlanRow> rows = jdbcTemplate.query(
                """
                        SELECT plan_id, name, exempt_payer_fixed, exempt_payer_percent,
                               exempt_receiver_fixed, exempt_receiver_percent
                        FROM subscription_plans WHERE plan_id=? LIMIT 1
                        """,
                (rs, rn) -> new SubscriptionPlanRow(
                        rs.getString("plan_id"),
                        rs.getString("name"),
                        rs.getBoolean("exempt_payer_fixed"),
                        rs.getBoolean("exempt_payer_percent"),
                        rs.getBoolean("exempt_receiver_fixed"),
                        rs.getBoolean("exempt_receiver_percent")
                ),
                planId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<String> findPlanName(String planId) {
        return findPlanById(planId).map(SubscriptionPlanRow::name);
    }

    public void insertUserSubscription(
            String subscriptionId,
            String userId,
            String planId,
            OffsetDateTime expiresAt,
            String stripeSubscriptionId,
            String benefitsSnapshotJson
    ) {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions
                        (subscription_id, user_id, plan_id, status,
                         started_at, expires_at, stripe_subscription_id,
                         benefits_snapshot, updated_at)
                        VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, ?, ?, ?, CURRENT_TIMESTAMP)
                        """,
                subscriptionId,
                userId,
                planId,
                expiresAt == null ? null : Timestamp.from(expiresAt.toInstant()),
                stripeSubscriptionId,
                benefitsSnapshotJson
        );
    }

    public int updateSubscriptionStatusWithExpiry(
            String stripeSubscriptionId,
            String newStatus,
            OffsetDateTime expiresAt
    ) {
        return jdbcTemplate.update(
                """
                        UPDATE user_subscriptions
                        SET status=?, expires_at=?, updated_at=CURRENT_TIMESTAMP
                        WHERE stripe_subscription_id=?
                          AND status NOT IN ('cancelled')
                        """,
                newStatus,
                Timestamp.from(expiresAt.toInstant()),
                stripeSubscriptionId
        );
    }

    public int updateSubscriptionStatusOnly(String stripeSubscriptionId, String newStatus) {
        return jdbcTemplate.update(
                """
                        UPDATE user_subscriptions
                        SET status=?, updated_at=CURRENT_TIMESTAMP
                        WHERE stripe_subscription_id=?
                          AND status NOT IN ('cancelled')
                        """,
                newStatus,
                stripeSubscriptionId
        );
    }

    /**
     * {@code customer.subscription.deleted} — pas de garde {@code NOT IN ('cancelled')} (fidèle Python).
     */
    public int markCancelledByStripeSubscriptionId(String stripeSubscriptionId) {
        return jdbcTemplate.update(
                """
                        UPDATE user_subscriptions
                        SET status='cancelled', cancelled_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
                        WHERE stripe_subscription_id=?
                        """,
                stripeSubscriptionId
        );
    }

    public int renewFromInvoicePaid(String stripeSubscriptionId, OffsetDateTime expiresAt) {
        return jdbcTemplate.update(
                """
                        UPDATE user_subscriptions
                        SET expires_at=?, status='active', updated_at=CURRENT_TIMESTAMP
                        WHERE stripe_subscription_id=?
                          AND status NOT IN ('cancelled')
                        """,
                Timestamp.from(expiresAt.toInstant()),
                stripeSubscriptionId
        );
    }

    public int markPastDue(String stripeSubscriptionId) {
        return jdbcTemplate.update(
                """
                        UPDATE user_subscriptions
                        SET status='past_due', updated_at=CURRENT_TIMESTAMP
                        WHERE stripe_subscription_id=?
                          AND status NOT IN ('cancelled')
                        """,
                stripeSubscriptionId
        );
    }

    public void insertNotification(String userId, String type, String title, String body, String dataJson) {
        jdbcTemplate.update(
                jdbcSqlDialect.notificationInsertSql(),
                newNotifId(),
                userId,
                type,
                title,
                body,
                dataJson == null ? "{}" : dataJson
        );
    }

    private static String newNotifId() {
        return "ntf_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    public record SubscriptionPlanRow(
            String planId,
            String name,
            boolean exemptPayerFixed,
            boolean exemptPayerPercent,
            boolean exemptReceiverFixed,
            boolean exemptReceiverPercent
    ) {
    }
}
