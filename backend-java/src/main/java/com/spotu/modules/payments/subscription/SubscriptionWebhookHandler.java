package com.spotu.modules.payments.subscription;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.payments.infra.SubscriptionWebhookRepository;
import com.spotu.modules.payments.infra.SubscriptionWebhookRepository.SubscriptionPlanRow;
import com.spotu.modules.payments.stripe.StripePaymentService;
import com.stripe.model.Subscription;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Webhook Stripe abonnements — aligné sur {@code webhook_handlers.py:_handle_subscription_event} (actif).
 * Ne pas confondre avec le handler legacy {@code subscription_routes.py}.
 */
@Service
public class SubscriptionWebhookHandler {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionWebhookHandler.class);

    public static final Set<String> SUBSCRIPTION_EVENT_TYPES = Set.of(
            "checkout.session.completed",
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
            "invoice.paid",
            "invoice.payment_failed"
    );

    private final SubscriptionWebhookRepository repository;
    private final StripePaymentService stripePaymentService;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public SubscriptionWebhookHandler(
            SubscriptionWebhookRepository repository,
            StripePaymentService stripePaymentService,
            ObjectMapper objectMapper,
            TransactionTemplate transactionTemplate
    ) {
        this.repository = repository;
        this.stripePaymentService = stripePaymentService;
        this.objectMapper = objectMapper;
        this.transactionTemplate = transactionTemplate;
    }

    public static boolean isSubscriptionEventType(String eventType) {
        return SUBSCRIPTION_EVENT_TYPES.contains(eventType);
    }

    /**
     * Persiste les notifications après succès webhook (hors même « transaction » que {@code markDone} JDBC).
     */
    public void persistCollectedNotifications(List<PendingWebhookNotification> pendingNotifs) {
        for (PendingWebhookNotification n : pendingNotifs) {
            try {
                String dataJson = n.data() == null || n.data().isEmpty()
                        ? "{}"
                        : objectMapper.writeValueAsString(n.data());
                repository.insertNotification(n.userId(), n.type(), n.title(), n.body(), dataJson);
                log.info("Notification envoyée : type={} | user={}", n.type(), n.userId());
            } catch (Exception exc) {
                log.warn("Erreur envoi notification type={} user={} : {}", n.type(), n.userId(), exc.getMessage());
            }
        }
    }

    /**
     * Effets DB + collecte notifications (sans les envoyer).
     */
    public void handleEvent(String eventType, JsonNode obj, List<PendingWebhookNotification> pendingNotifs) {
        switch (eventType) {
            case "checkout.session.completed" -> handleCheckoutSessionCompleted(obj, pendingNotifs);
            case "customer.subscription.created" -> handleSubscriptionCreated(obj, pendingNotifs);
            case "customer.subscription.updated" -> handleSubscriptionUpdated(obj, pendingNotifs);
            case "customer.subscription.deleted" -> handleSubscriptionDeleted(obj, pendingNotifs);
            case "invoice.paid" -> handleInvoicePaid(obj, pendingNotifs);
            case "invoice.payment_failed" -> handleInvoicePaymentFailed(obj, pendingNotifs);
            default -> {
            }
        }
    }

    /**
     * {@code related_id} pour {@code stripe_webhook_events} (équivalent {@code _dispatch_subscription}).
     */
    public String resolveRelatedSubscriptionId(String eventType, JsonNode obj) {
        if ("checkout.session.completed".equals(eventType)) {
            if (!"subscription".equals(text(obj, "mode"))) {
                return null;
            }
        }
        String stripeSubId = extractStripeSubscriptionId(eventType, obj);
        if (stripeSubId == null || stripeSubId.isBlank()) {
            return null;
        }
        return repository.findSubscriptionIdByStripeSubscriptionId(stripeSubId).orElse(null);
    }

    private void handleCheckoutSessionCompleted(JsonNode obj, List<PendingWebhookNotification> pendingNotifs) {
        if (!"subscription".equals(text(obj, "mode"))) {
            return;
        }
        JsonNode meta = obj.path("metadata");
        String planId = text(meta, "plan_id");
        String userId = text(meta, "user_id");
        String stripeSubId = text(obj, "subscription");
        if (planId.isBlank() || userId.isBlank() || stripeSubId.isBlank()) {
            log.warn("checkout.session subscription : données incomplètes meta={} sub={}", meta, stripeSubId);
            return;
        }
        if (repository.findSubscriptionIdByStripeSubscriptionId(stripeSubId).isPresent()) {
            log.debug("checkout.session subscription déjà enregistré : sub={}", stripeSubId);
            return;
        }
        Optional<SubscriptionPlanRow> planOpt = repository.findPlanById(planId);
        if (planOpt.isEmpty()) {
            log.warn("Plan {} introuvable pour webhook checkout subscription", planId);
            return;
        }
        SubscriptionPlanRow plan = planOpt.get();
        String benefitsJson = writeJson(buildBenefitsSnapshot(plan));

        OffsetDateTime expiresAt = null;
        try {
            Subscription stripeSub = stripePaymentService.retrieveSubscription(stripeSubId);
            Long end = stripeSub.getCurrentPeriodEnd();
            if (end != null) {
                expiresAt = OffsetDateTime.ofInstant(Instant.ofEpochSecond(end), ZoneOffset.UTC);
            }
        } catch (Exception exc) {
            log.warn("Impossible de récupérer la subscription Stripe {} : {}", stripeSubId, exc.getMessage());
        }

        final String subId = newSubscriptionId();
        final OffsetDateTime expiresAtFinal = expiresAt;
        transactionTemplate.executeWithoutResult(status -> repository.insertUserSubscription(
                subId, userId, planId, expiresAtFinal, stripeSubId, benefitsJson
        ));

        String planName = plan.name() != null && !plan.name().isBlank() ? plan.name() : "votre abonnement";
        log.info("Abonnement activé (checkout) : sub={} | user={} | plan={}", subId, userId, planId);
        pendingNotifs.add(new PendingWebhookNotification(
                userId,
                "subscription_activated",
                "Abonnement activé !",
                "Votre abonnement " + planName + " est maintenant actif.",
                Map.of(
                        "type", "subscription_activated",
                        "subscription_id", subId,
                        "plan_id", planId,
                        "plan_name", planName
                )
        ));
    }

    private void handleSubscriptionCreated(JsonNode obj, List<PendingWebhookNotification> pendingNotifs) {
        String stripeSubId = text(obj, "id");
        JsonNode meta = obj.path("metadata");
        String planId = text(meta, "plan_id");
        String userId = text(meta, "user_id");
        if (planId.isBlank() || userId.isBlank()) {
            return;
        }
        if (repository.findSubscriptionIdByStripeSubscriptionId(stripeSubId).isPresent()) {
            return;
        }
        Optional<SubscriptionPlanRow> planOpt = repository.findPlanById(planId);
        if (planOpt.isEmpty()) {
            return;
        }
        SubscriptionPlanRow plan = planOpt.get();
        String benefitsJson = writeJson(buildBenefitsSnapshot(plan));
        Long periodEnd = longOrNull(obj, "current_period_end");
        OffsetDateTime expiresAt = periodEnd == null
                ? null
                : OffsetDateTime.ofInstant(Instant.ofEpochSecond(periodEnd), ZoneOffset.UTC);

        String subId = newSubscriptionId();
        transactionTemplate.executeWithoutResult(status -> repository.insertUserSubscription(
                subId, userId, planId, expiresAt, stripeSubId, benefitsJson
        ));

        String planName = plan.name() != null && !plan.name().isBlank() ? plan.name() : "votre abonnement";
        log.info("Abonnement créé (sub.created) : sub={} | user={} | plan={}", subId, userId, planId);
        pendingNotifs.add(new PendingWebhookNotification(
                userId,
                "subscription_activated",
                "Abonnement activé !",
                "Votre abonnement " + planName + " est maintenant actif.",
                Map.of(
                        "type", "subscription_activated",
                        "subscription_id", subId,
                        "plan_id", planId,
                        "plan_name", planName
                )
        ));
    }

    private void handleSubscriptionUpdated(JsonNode obj, List<PendingWebhookNotification> pendingNotifs) {
        String stripeSubId = text(obj, "id");
        String stripeStatus = text(obj, "status");
        boolean cancelAtPeriodEnd = obj.path("cancel_at_period_end").asBoolean(false);
        Long periodEnd = longOrNull(obj, "current_period_end");
        OffsetDateTime expiresAt = periodEnd == null
                ? null
                : OffsetDateTime.ofInstant(Instant.ofEpochSecond(periodEnd), ZoneOffset.UTC);

        String newStatus = mapStripeSubscriptionStatus(stripeStatus, cancelAtPeriodEnd);

        int rows = Optional.ofNullable(transactionTemplate.execute(status -> {
                    if (expiresAt != null) {
                        return repository.updateSubscriptionStatusWithExpiry(stripeSubId, newStatus, expiresAt);
                    }
                    return repository.updateSubscriptionStatusOnly(stripeSubId, newStatus);
                }))
                .orElse(0);

        log.info(
                "Abonnement mis à jour : stripe={} | status={} | cancel_at_period_end={}",
                stripeSubId,
                newStatus,
                cancelAtPeriodEnd
        );

        if (rows > 0) {
            Optional<String> userIdOpt = repository.findUserIdByStripeSubscriptionId(stripeSubId);
            if (userIdOpt.isPresent()) {
                String userId = userIdOpt.get();
                if ("cancelling".equals(newStatus)) {
                    pendingNotifs.add(new PendingWebhookNotification(
                            userId,
                            "subscription_cancelling",
                            "Annulation d'abonnement programmée",
                            "Votre abonnement sera annulé à la fin de la période en cours.",
                            Map.of(
                                    "type", "subscription_cancelling",
                                    "stripe_subscription_id", stripeSubId
                            )
                    ));
                } else if ("cancelled".equals(newStatus)) {
                    pendingNotifs.add(new PendingWebhookNotification(
                            userId,
                            "subscription_cancelled",
                            "Abonnement annulé",
                            "Votre abonnement a été annulé.",
                            Map.of(
                                    "type", "subscription_cancelled",
                                    "stripe_subscription_id", stripeSubId
                            )
                    ));
                }
            }
        }
    }

    private void handleSubscriptionDeleted(JsonNode obj, List<PendingWebhookNotification> pendingNotifs) {
        String stripeSubId = text(obj, "id");
        Optional<String> userIdOpt = repository.findUserIdByStripeSubscriptionId(stripeSubId);
        int rows = Optional.ofNullable(transactionTemplate.execute(s ->
                        repository.markCancelledByStripeSubscriptionId(stripeSubId)))
                .orElse(0);
        log.info("Abonnement désactivé (sub.deleted) : stripe={}", stripeSubId);
        if (rows > 0 && userIdOpt.isPresent()) {
            pendingNotifs.add(new PendingWebhookNotification(
                    userIdOpt.get(),
                    "subscription_cancelled",
                    "Abonnement résilié",
                    "Votre abonnement a été résilié.",
                    Map.of(
                            "type", "subscription_cancelled",
                            "stripe_subscription_id", stripeSubId
                    )
            ));
        }
    }

    private void handleInvoicePaid(JsonNode obj, List<PendingWebhookNotification> pendingNotifs) {
        String stripeSubId = text(obj, "subscription");
        if (stripeSubId.isBlank()) {
            return;
        }
        Long periodEndSeconds = extractInvoiceLinePeriodEnd(obj);
        if (periodEndSeconds == null) {
            log.warn("invoice.paid : pas de period_end trouvé (stripe_sub={})", stripeSubId);
            return;
        }
        OffsetDateTime expiresAt = OffsetDateTime.ofInstant(Instant.ofEpochSecond(periodEndSeconds), ZoneOffset.UTC);
        int rows = Optional.ofNullable(transactionTemplate.execute(s ->
                        repository.renewFromInvoicePaid(stripeSubId, expiresAt)))
                .orElse(0);
        log.info("Renouvellement abonnement : stripe={} | expires_at={}", stripeSubId, expiresAt);
        if (rows > 0) {
            repository.findUserIdByStripeSubscriptionId(stripeSubId).ifPresent(userId -> pendingNotifs.add(
                    new PendingWebhookNotification(
                            userId,
                            "subscription_renewed",
                            "Abonnement renouvelé",
                            "Votre abonnement a été renouvelé avec succès.",
                            Map.of(
                                    "type", "subscription_renewed",
                                    "stripe_subscription_id", stripeSubId,
                                    "expires_at", expiresAt.toString()
                            )
                    )
            ));
        }
    }

    private void handleInvoicePaymentFailed(JsonNode obj, List<PendingWebhookNotification> pendingNotifs) {
        String stripeSubId = text(obj, "subscription");
        if (stripeSubId.isBlank()) {
            return;
        }
        int rows = Optional.ofNullable(transactionTemplate.execute(s -> repository.markPastDue(stripeSubId)))
                .orElse(0);
        log.warn("Paiement abonnement échoué : stripe_sub={}", stripeSubId);
        if (rows > 0) {
            repository.findUserIdByStripeSubscriptionId(stripeSubId).ifPresent(userId -> pendingNotifs.add(
                    new PendingWebhookNotification(
                            userId,
                            "subscription_payment_failed",
                            "Paiement abonnement échoué",
                            "Le renouvellement de votre abonnement a échoué. Veuillez mettre à jour votre moyen de paiement.",
                            Map.of(
                                    "type", "subscription_payment_failed",
                                    "stripe_subscription_id", stripeSubId
                            )
                    )
            ));
        }
    }

    private static String mapStripeSubscriptionStatus(String stripeStatus, boolean cancelAtPeriodEnd) {
        if ("active".equals(stripeStatus) && cancelAtPeriodEnd) {
            return "cancelling";
        }
        if ("active".equals(stripeStatus)) {
            return "active";
        }
        if ("canceled".equals(stripeStatus) || "cancelled".equals(stripeStatus)) {
            return "cancelled";
        }
        if ("past_due".equals(stripeStatus)) {
            return "past_due";
        }
        if ("trialing".equals(stripeStatus)) {
            return "trialing";
        }
        return stripeStatus;
    }

    private static Long extractInvoiceLinePeriodEnd(JsonNode obj) {
        JsonNode data = obj.path("lines").path("data");
        if (!data.isArray() || data.isEmpty()) {
            return null;
        }
        JsonNode period = data.get(0).path("period");
        if (!period.has("end") || period.get("end").isNull()) {
            return null;
        }
        return period.get("end").asLong();
    }

    private static String extractStripeSubscriptionId(String eventType, JsonNode obj) {
        if ("checkout.session.completed".equals(eventType)) {
            return text(obj, "subscription");
        }
        if (eventType != null && eventType.contains("customer.subscription")) {
            return text(obj, "id");
        }
        if ("invoice.paid".equals(eventType) || "invoice.payment_failed".equals(eventType)) {
            return text(obj, "subscription");
        }
        return null;
    }

    private static Map<String, Object> buildBenefitsSnapshot(SubscriptionPlanRow plan) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("plan_id", plan.planId());
        m.put("plan_name", plan.name());
        m.put("exempt_payer_fixed", plan.exemptPayerFixed());
        m.put("exempt_payer_percent", plan.exemptPayerPercent());
        m.put("exempt_receiver_fixed", plan.exemptReceiverFixed());
        m.put("exempt_receiver_percent", plan.exemptReceiverPercent());
        m.put("snapshotted_at", OffsetDateTime.now(ZoneOffset.UTC).toString());
        return m;
    }

    private String writeJson(Map<String, Object> map) {
        try {
            return objectMapper.writeValueAsString(map);
        } catch (Exception exc) {
            throw new IllegalStateException("JSON benefits_snapshot", exc);
        }
    }

    private static String text(JsonNode node, String field) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return "";
        }
        JsonNode v = node.get(field);
        return v == null || v.isNull() ? "" : v.asText("");
    }

    private static Long longOrNull(JsonNode node, String field) {
        JsonNode v = node.get(field);
        if (v == null || v.isNull() || !v.isNumber()) {
            return null;
        }
        return v.asLong();
    }

    private static String newSubscriptionId() {
        return "sub_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }
}
