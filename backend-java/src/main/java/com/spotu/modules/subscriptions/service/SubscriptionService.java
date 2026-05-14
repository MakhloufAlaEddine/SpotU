package com.spotu.modules.subscriptions.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.error.ApiBadRequestException;
import com.spotu.error.ApiConflictException;
import com.spotu.error.ApiForbiddenException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.payments.stripe.StripeSubscriptionService;
import com.spotu.modules.subscriptions.infra.SubscriptionJdbcRepository;
import com.stripe.exception.StripeException;
import com.stripe.model.checkout.Session;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Cycle abonnement utilisateur (slice 21), aligné sur {@code subscription_routes.py}.
 */
@Service
public class SubscriptionService {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionService.class);

    private final SubscriptionJdbcRepository repository;
    private final StripeSubscriptionService stripeSubscriptionService;
    private final ObjectMapper objectMapper;

    public SubscriptionService(
            SubscriptionJdbcRepository repository,
            StripeSubscriptionService stripeSubscriptionService,
            ObjectMapper objectMapper
    ) {
        this.repository = repository;
        this.stripeSubscriptionService = stripeSubscriptionService;
        this.objectMapper = objectMapper;
    }

    public List<Map<String, Object>> listActivePlans() {
        return repository.findActivePlansForPublicApi();
    }

    public Map<String, Object> subscribe(CurrentUserDto user, String planId, String originUrl) {
        if (planId == null || planId.isBlank()) {
            throw new ApiBadRequestException("plan_id requis");
        }
        String origin = originUrl == null ? "" : originUrl.replaceAll("/+$", "");

        Map<String, Object> plan = repository.findPlanById(planId)
                .orElseThrow(() -> new ApiNotFoundException("Plan introuvable"));

        Boolean active = (Boolean) plan.get("active");
        if (active == null || !active) {
            throw new ApiBadRequestException("Ce plan n'est plus disponible à la souscription.");
        }

        repository.findBlockingSubscriptionForSubscribe(user.userId()).ifPresent(row -> {
            throw new ApiConflictException(
                    "Vous avez déjà un abonnement "
                            + row.get("status")
                            + " (id="
                            + row.get("subscription_id")
                            + "). Annulez-le d'abord via POST /api/subscriptions/cancel."
            );
        });

        String priceId = ensureStripePriceForPlan(plan);

        String customerId;
        try {
            customerId = stripeSubscriptionService.getOrCreateCustomer(
                    user.userId(),
                    user.email() == null ? "" : user.email(),
                    user.name() == null ? "" : user.name()
            );
        } catch (StripeException e) {
            throw stripeAsBadRequest(e);
        }

        repository.updateUserStripeCustomerIdIfNull(user.userId(), customerId);

        String successUrl = origin + "/subscription-success?session_id={CHECKOUT_SESSION_ID}";
        String cancelUrl = origin + "/subscription-plans";
        Map<String, String> meta = new LinkedHashMap<>();
        meta.put("plan_id", planId);
        meta.put("user_id", user.userId());
        meta.put("product_type", "subscription");

        long window = System.currentTimeMillis() / 1000 / 300;
        String idempotencyRaw = user.userId() + "_" + planId + "_" + window;

        Session session;
        try {
            session = stripeSubscriptionService.createSubscriptionCheckoutSession(
                    customerId,
                    priceId,
                    successUrl,
                    cancelUrl,
                    meta,
                    idempotencyRaw
            );
        } catch (StripeException e) {
            throw stripeAsBadRequest(e);
        }

        log.info("Checkout abonnement créée : user={} | plan={} | cs={}", user.userId(), planId, session.getId());

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("url", session.getUrl());
        res.put("session_id", session.getId());
        res.put("plan_id", planId);
        return res;
    }

    /**
     * Équivalent {@code _get_or_create_stripe_price} : met à jour la DB si création Stripe.
     */
    private String ensureStripePriceForPlan(Map<String, Object> plan) {
        String planId = (String) plan.get("plan_id");
        String existingPrice = (String) plan.get("stripe_price_id");
        if (existingPrice != null && !existingPrice.isBlank()) {
            return existingPrice;
        }

        Integer durationDays = (Integer) plan.get("duration_days");
        if (durationDays == null) {
            throw new ApiBadRequestException("Ce plan n'a pas de durée configurée (duration_days=null).");
        }
        try {
            StripeSubscriptionService.durationToInterval(durationDays);
        } catch (IllegalArgumentException e) {
            throw new ApiBadRequestException(e.getMessage());
        }

        BigDecimal priceBd = plan.get("price") instanceof BigDecimal bd
                ? bd
                : BigDecimal.valueOf(((Number) plan.get("price")).doubleValue());
        int amountCents = priceBd.multiply(BigDecimal.valueOf(100)).setScale(0, RoundingMode.HALF_UP).intValue();
        if (amountCents <= 0) {
            throw new ApiBadRequestException("Le montant du plan doit être supérieur à 0.");
        }

        String currency = "EUR";

        String[] ids;
        try {
            ids = stripeSubscriptionService.ensureSubscriptionPrice(
                    planId,
                    (String) plan.get("name"),
                    (String) plan.get("description"),
                    amountCents,
                    currency,
                    durationDays
            );
        } catch (StripeException e) {
            throw stripeAsBadRequest(e);
        }
        repository.updatePlanStripeIds(planId, ids[0], ids[1]);
        log.info("Plan Stripe synchronisé : plan={} | product={} | price={}", planId, ids[0], ids[1]);
        return ids[1];
    }

    public Map<String, Object> getCheckoutStatus(CurrentUserDto user, String sessionId) {
        Session session;
        try {
            session = stripeSubscriptionService.retrieveCheckoutSession(sessionId);
        } catch (StripeException e) {
            throw new ApiNotFoundException("Session introuvable : " + e.getMessage());
        }

        Optional<String> dbCustomer = repository.findStripeCustomerId(user.userId());
        String sessionCustomer = extractCustomerId(session);
        if (dbCustomer.isPresent()
                && sessionCustomer != null
                && !sessionCustomer.isBlank()
                && !dbCustomer.get().equals(sessionCustomer)
                && !"admin".equals(user.role())) {
            throw new ApiForbiddenException("Accès refusé");
        }

        String stripeSubId = extractSubscriptionIdFromSession(session);

        Map<String, String> local = stripeSubId == null || stripeSubId.isBlank()
                ? null
                : repository.findLocalSubscriptionByStripeId(stripeSubId).orElse(null);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("session_id", sessionId);
        out.put("session_status", session.getStatus());
        out.put("subscription_status", session.getStatus());
        out.put("stripe_sub_id", stripeSubId);
        out.put("local_sub_id", local == null ? null : local.get("subscription_id"));
        out.put("local_status", local == null ? null : local.get("status"));
        Map<String, String> meta = session.getMetadata();
        out.put("metadata", meta == null ? Map.of() : new LinkedHashMap<>(meta));
        return out;
    }

    public Map<String, Object> getMySubscription(String userId) {
        Optional<Map<String, Object>> row = repository.findCurrentSubscriptionForMe(userId);
        if (row.isEmpty()) {
            Map<String, Object> empty = new LinkedHashMap<>();
            empty.put("has_subscription", false);
            empty.put("subscription", null);
            return empty;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("has_subscription", true);
        out.put("subscription", deserializeSubscriptionRow(row.get()));
        return out;
    }

    public List<Map<String, Object>> getHistory(String userId) {
        return repository.findSubscriptionHistory(userId).stream()
                .map(this::deserializeSubscriptionRow)
                .toList();
    }

    /**
     * Liste admin (slice 22) — aligné {@code subscription_routes.py:453–469}.
     */
    public List<Map<String, Object>> listSubscriptionsForAdmin() {
        return repository.findAllSubscriptionsForAdmin().stream()
                .map(this::deserializeSubscriptionRow)
                .toList();
    }

    /**
     * Annulation admin (slice 22) — aligné {@code subscription_routes.py:472–511}.
     */
    public Map<String, Object> adminCancelSubscription(String subscriptionId, boolean immediate) {
        Map<String, String> row = repository.findSubscriptionStripeIdBySubscriptionId(subscriptionId)
                .orElseThrow(() -> new ApiNotFoundException("Abonnement introuvable"));

        String newStatus = immediate ? "cancelled" : "cancelling";
        String stripeSubId = row.get("stripe_subscription_id");
        if (stripeSubId != null && !stripeSubId.isBlank()) {
            try {
                stripeSubscriptionService.cancelStripeSubscription(stripeSubId, !immediate);
                log.info("Admin annulation Stripe : sub_id={} | immediate={}", stripeSubId, immediate);
            } catch (Exception e) {
                log.error("Admin cancel Stripe error: {}", e.getMessage());
            }
        }

        repository.updateSubscriptionStatusAndCancelledAt(subscriptionId, newStatus);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("success", true);
        res.put("status", newStatus);
        return res;
    }

    public Map<String, Object> cancel(CurrentUserDto user, boolean immediate) {
        if (immediate && !"admin".equals(user.role())) {
            throw new ApiForbiddenException("L'annulation immédiate est réservée aux administrateurs.");
        }

        Map<String, String> sub = repository.findSubscriptionForCancel(user.userId())
                .orElseThrow(() -> new ApiNotFoundException("Aucun abonnement actif à annuler"));

        String newStatus = immediate ? "cancelled" : "cancelling";
        String stripeSubId = sub.get("stripe_subscription_id");
        if (stripeSubId != null && !stripeSubId.isBlank()) {
            try {
                stripeSubscriptionService.cancelStripeSubscription(stripeSubId, !immediate);
                log.info("Abonnement Stripe annulé : sub_id={} | immediate={}", stripeSubId, immediate);
            } catch (Exception e) {
                log.error("Erreur annulation Stripe sub={} : {}", stripeSubId, e.getMessage());
            }
        }

        repository.updateSubscriptionStatusAndCancelledAt(sub.get("subscription_id"), newStatus);

        String message = immediate
                ? "Abonnement annulé immédiatement."
                : "Abonnement annulé à la fin de la période en cours. "
                + "Vous conservez vos avantages jusqu'à l'expiration.";

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("success", true);
        res.put("subscription_id", sub.get("subscription_id"));
        res.put("status", newStatus);
        res.put("message", message);
        return res;
    }

    private Map<String, Object> deserializeSubscriptionRow(Map<String, Object> row) {
        Map<String, Object> copy = new LinkedHashMap<>(row);
        Object snap = copy.get("benefits_snapshot");
        if (snap instanceof String s && !s.isBlank()) {
            try {
                copy.put("benefits_snapshot", objectMapper.readValue(s, Object.class));
            } catch (Exception e) {
                // laisser la string si parse KO
            }
        }
        return copy;
    }

    private static String extractCustomerId(Session session) {
        try {
            // stripe-java 28 : ids non expandés renvoyés en String
            String c = session.getCustomer();
            return c == null || c.isBlank() ? null : c;
        } catch (Exception e) {
            return null;
        }
    }

    private static String extractSubscriptionIdFromSession(Session session) {
        try {
            String sub = session.getSubscription();
            return sub == null || sub.isBlank() ? null : sub;
        } catch (Exception e) {
            return null;
        }
    }

    private static ApiBadRequestException stripeAsBadRequest(StripeException e) {
        return new ApiBadRequestException(e.getMessage() == null ? "Erreur Stripe" : e.getMessage());
    }
}
