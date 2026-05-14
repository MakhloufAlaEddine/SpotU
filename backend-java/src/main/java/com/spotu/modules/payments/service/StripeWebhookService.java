package com.spotu.modules.payments.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.error.ApiBadRequestException;
import com.spotu.modules.payments.infra.StripeWebhookRepository;
import com.spotu.modules.payments.subscription.PendingWebhookNotification;
import com.spotu.modules.payments.subscription.SubscriptionWebhookHandler;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.net.Webhook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import jakarta.annotation.PostConstruct;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class StripeWebhookService {

    private static final Logger log = LoggerFactory.getLogger(StripeWebhookService.class);

    private final ObjectMapper objectMapper;
    private final StripeWebhookRepository repository;
    private final PaymentResolverService paymentResolverService;
    private final PaymentEventHandler paymentEventHandler;
    private final ChargeEventHandler chargeEventHandler;
    private final SubscriptionWebhookHandler subscriptionWebhookHandler;
    private final Environment environment;

    @Value("${app.stripe.webhook-secret:}")
    private String webhookSecret;

    public StripeWebhookService(
            ObjectMapper objectMapper,
            StripeWebhookRepository repository,
            PaymentResolverService paymentResolverService,
            PaymentEventHandler paymentEventHandler,
            ChargeEventHandler chargeEventHandler,
            SubscriptionWebhookHandler subscriptionWebhookHandler,
            Environment environment
    ) {
        this.objectMapper = objectMapper;
        this.repository = repository;
        this.paymentResolverService = paymentResolverService;
        this.paymentEventHandler = paymentEventHandler;
        this.chargeEventHandler = chargeEventHandler;
        this.subscriptionWebhookHandler = subscriptionWebhookHandler;
        this.environment = environment;
    }

    @PostConstruct
    void validateWebhookSecretForProd() {
        if (!isProdProfileActive()) {
            return;
        }
        if (webhookSecret == null || webhookSecret.isBlank()) {
            throw new IllegalStateException("STRIPE_WEBHOOK_SECRET est obligatoire en profil prod");
        }
    }

    private boolean isProdProfileActive() {
        return Arrays.stream(environment.getActiveProfiles())
                .anyMatch("prod"::equalsIgnoreCase);
    }

    public Map<String, Object> process(byte[] bodyBytes, String stripeSignatureHeader) {
        Map<String, Object> ok = new LinkedHashMap<>();
        ok.put("received", true);

        try {
            JsonNode event;
            try {
                if (webhookSecret != null && !webhookSecret.isBlank()) {
                    Webhook.constructEvent(
                            new String(bodyBytes, StandardCharsets.UTF_8),
                            stripeSignatureHeader == null ? "" : stripeSignatureHeader,
                            webhookSecret
                    );
                }
                event = objectMapper.readTree(bodyBytes);
            } catch (Exception exc) {
                if (webhookSecret != null && !webhookSecret.isBlank() && isSignatureError(exc)) {
                    log.warn("Signature webhook invalide : {}", rootMessage(exc));
                    throw new ApiBadRequestException("Signature invalide : " + rootMessage(exc));
                }
                if (webhookSecret == null || webhookSecret.isBlank()) {
                    throw new ApiBadRequestException("Body JSON invalide");
                }
                throw new ApiBadRequestException("Signature invalide : " + rootMessage(exc));
            }

            String eventId = event.path("id").asText("");
            String eventType = event.path("type").asText("");
            JsonNode obj = event.path("data").path("object");

            if (eventId.isBlank() || eventType.isBlank()) {
                throw new ApiBadRequestException("event id/type manquant");
            }
            log.info("Webhook reçu : type={} | id={}", eventType, eventId);

            boolean claimed = repository.claimEvent(eventId, eventType);
            if (!claimed) {
                log.debug("Webhook doublon ignoré : event_id={} type={}", eventId, eventType);
                ok.put("idempotent_skip", true);
                return ok;
            }

            String relatedId = null;
            List<PendingWebhookNotification> pendingNotifs = new ArrayList<>();
            try {
                PaymentResolverService.ResolvedPayment resolved = paymentResolverService.resolve(eventType, obj);
                String paymentId = resolved.paymentId();
                String bookingId = resolved.bookingId();
                relatedId = paymentId;

                if (ChargeEventHandler.CHARGE_EVENTS.contains(eventType)) {
                    String chargeRelated = chargeEventHandler.handle(eventType, obj, paymentId, pendingNotifs);
                    if (relatedId == null || relatedId.isBlank()) {
                        relatedId = chargeRelated;
                    }
                }

                if (PaymentEventHandler.PAYMENT_EVENTS.contains(eventType)) {
                    if (paymentId != null && !paymentId.isBlank()) {
                        paymentEventHandler.handle(eventType, obj, paymentId, bookingId, pendingNotifs);
                    } else if (!"checkout.session.completed".equals(eventType)) {
                        log.debug("Webhook payment sans payment_id : type={}", eventType);
                    }
                }

                // Abonnements (slice 20) — même point d’entrée que Python {@code _SUBSCRIPTION_EVENTS}.
                if (SubscriptionWebhookHandler.isSubscriptionEventType(eventType)) {
                    subscriptionWebhookHandler.handleEvent(eventType, obj, pendingNotifs);
                    String subRelated = subscriptionWebhookHandler.resolveRelatedSubscriptionId(eventType, obj);
                    if (relatedId == null || relatedId.isBlank()) {
                        relatedId = subRelated;
                    }
                }

                repository.markDone(eventId, "success", relatedId, null);
                subscriptionWebhookHandler.persistCollectedNotifications(pendingNotifs);
            } catch (Exception exc) {
                log.error("Erreur handler webhook event={} id={}: {}", eventType, eventId, exc.getMessage());
                repository.markDone(eventId, "error", relatedId, truncate(exc.getMessage()));
            }

            return ok;
        } catch (ApiBadRequestException exc) {
            throw exc;
        } catch (Exception exc) {
            log.error("Erreur interne webhook (toujours 200): {}", exc.getMessage());
            return ok;
        }
    }

    private boolean isSignatureError(Exception exc) {
        Throwable cur = exc;
        while (cur != null) {
            if (cur instanceof SignatureVerificationException) {
                return true;
            }
            cur = cur.getCause();
        }
        return false;
    }

    private String rootMessage(Throwable throwable) {
        Throwable cur = throwable;
        Throwable last = throwable;
        while (cur != null) {
            last = cur;
            cur = cur.getCause();
        }
        return last.getMessage() == null ? "invalid signature" : last.getMessage();
    }

    private String truncate(String input) {
        if (input == null) {
            return null;
        }
        return input.length() <= 500 ? input : input.substring(0, 500);
    }

}
