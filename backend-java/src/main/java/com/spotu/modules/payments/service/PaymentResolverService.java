package com.spotu.modules.payments.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.spotu.modules.payments.infra.StripeWebhookRepository;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class PaymentResolverService {

    private final StripeWebhookRepository repository;

    public PaymentResolverService(StripeWebhookRepository repository) {
        this.repository = repository;
    }

    public ResolvedPayment resolve(String eventType, JsonNode obj) {
        JsonNode metadata = obj.path("metadata");
        String paymentId = metadata.path("payment_id").asText("");
        String bookingId = metadata.path("booking_id").asText("");
        if (!paymentId.isBlank()) {
            return new ResolvedPayment(paymentId, bookingId.isBlank() ? null : bookingId);
        }

        String eventPiId;
        if (eventType.contains("payment_intent")) {
            eventPiId = obj.path("id").asText("");
        } else {
            eventPiId = obj.path("payment_intent").asText("");
        }
        if (!eventPiId.isBlank()) {
            Optional<StripeWebhookRepository.PaymentLookupRow> fromPi = repository.findPaymentByIntentId(eventPiId);
            if (fromPi.isPresent()) {
                return new ResolvedPayment(fromPi.get().paymentId(), fromPi.get().bookingId());
            }
        }

        if (eventType.contains("checkout.session")) {
            String checkoutSessionId = obj.path("id").asText("");
            if (!checkoutSessionId.isBlank()) {
                Optional<StripeWebhookRepository.PaymentLookupRow> fromSession =
                        repository.findPaymentByCheckoutSessionId(checkoutSessionId);
                if (fromSession.isPresent()) {
                    return new ResolvedPayment(fromSession.get().paymentId(), fromSession.get().bookingId());
                }
            }
        }

        String chargeId = eventType.startsWith("charge.")
                ? obj.path("id").asText("")
                : obj.path("charge").asText("");
        if (chargeId.startsWith("ch_")) {
            Optional<StripeWebhookRepository.PaymentLookupRow> fromCharge = repository.findPaymentByChargeId(chargeId);
            if (fromCharge.isPresent()) {
                return new ResolvedPayment(fromCharge.get().paymentId(), fromCharge.get().bookingId());
            }
        }

        return new ResolvedPayment(null, null);
    }

    public record ResolvedPayment(String paymentId, String bookingId) {
    }
}
