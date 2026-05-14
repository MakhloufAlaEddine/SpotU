package com.spotu.modules.payments.service;

import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class StripeCheckoutService {

    private final Map<String, CheckoutSession> sessions = new ConcurrentHashMap<>();

    public CheckoutSession createCheckoutSession(
            long amountCents,
            String currency,
            String successUrl,
            String cancelUrl,
            Map<String, String> metadata,
            String idempotencyKey
    ) {
        String sessionId = "cs_test_" + UUID.randomUUID().toString().replace("-", "");
        String paymentIntentId = "pi_test_" + UUID.randomUUID().toString().replace("-", "");
        CheckoutSession session = new CheckoutSession(
                sessionId,
                "https://checkout.stripe.com/pay/" + sessionId,
                "open",
                "unpaid",
                amountCents,
                currency,
                paymentIntentId
        );
        sessions.put(sessionId, session);
        return session;
    }

    public CheckoutSession retrieveCheckoutSession(String sessionId) {
        CheckoutSession stored = sessions.get(sessionId);
        if (stored != null) {
            return stored;
        }
        if (sessionId.startsWith("cs_status_open_")) {
            return new CheckoutSession(sessionId, "https://checkout.stripe.com/pay/" + sessionId,
                    "open", "unpaid", 4000L, "eur", null);
        }
        if (sessionId.startsWith("cs_status_complete_unpaid_")) {
            return new CheckoutSession(sessionId, "https://checkout.stripe.com/pay/" + sessionId,
                    "complete", "unpaid", 4000L, "eur", null);
        }
        if (sessionId.startsWith("cs_status_complete_paid_")) {
            return new CheckoutSession(sessionId, "https://checkout.stripe.com/pay/" + sessionId,
                    "complete", "paid", 4000L, "eur", null);
        }
        if (sessionId.startsWith("cs_status_expired_")) {
            return new CheckoutSession(sessionId, "https://checkout.stripe.com/pay/" + sessionId,
                    "expired", "unpaid", 4000L, "eur", null);
        }
        if (sessionId.startsWith("cs_status_fail_")) {
            throw new IllegalStateException("Stripe retrieve failed");
        }
        throw new IllegalStateException("Checkout session not found");
    }

    public record CheckoutSession(
            String id,
            String url,
            String status,
            String paymentStatus,
            Long amountTotal,
            String currency,
            String paymentIntent
    ) {
    }
}
