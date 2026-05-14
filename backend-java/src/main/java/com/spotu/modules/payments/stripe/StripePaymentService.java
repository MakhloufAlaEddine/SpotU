package com.spotu.modules.payments.stripe;

import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import com.stripe.model.Refund;
import com.stripe.net.RequestOptions;
import com.stripe.param.PaymentIntentCancelParams;
import com.stripe.param.PaymentIntentCaptureParams;
import com.stripe.param.RefundCreateParams;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Set;

/**
 * Wrapper réseau Stripe (capture / cancel PI / refund), aligné sur {@code stripe_service.py}.
 * Aucune écriture DB, pas de {@code @Transactional} — uniquement appels SDK.
 */
@Service
public class StripePaymentService {

    private static final Logger log = LoggerFactory.getLogger(StripePaymentService.class);

    private static final Map<String, String> CANCEL_REASONS = Map.ofEntries(
            Map.entry("refused", "abandoned"),
            Map.entry("expired", "abandoned"),
            Map.entry("cancelled", "abandoned"),
            Map.entry("duplicate", "duplicate"),
            Map.entry("fraudulent", "fraudulent")
    );

    private static final Set<String> REFUND_REASONS = Set.of(
            "requested_by_customer",
            "fraudulent",
            "duplicate"
    );

    /**
     * Exposé pour tests (même logique que {@code _CANCEL_REASONS.get(reason, "abandoned")} en Python).
     */
    static String mapBusinessCancelReason(String reason) {
        if (reason == null || reason.isBlank()) {
            return "abandoned";
        }
        return CANCEL_REASONS.getOrDefault(reason, "abandoned");
    }

    /**
     * Exposé pour tests (même logique que {@code _REFUND_REASONS} en Python).
     */
    static String mapRefundReason(String reason) {
        if (reason != null && REFUND_REASONS.contains(reason)) {
            return reason;
        }
        return "requested_by_customer";
    }

    public PaymentIntent retrievePaymentIntent(String intentId) throws StripeException {
        return PaymentIntent.retrieve(intentId);
    }

    /** Lecture subscription Stripe (webhook checkout subscription — slice 20). */
    public com.stripe.model.Subscription retrieveSubscription(String subscriptionId) throws StripeException {
        return com.stripe.model.Subscription.retrieve(subscriptionId);
    }

    /**
     * @param amountToCapture centimes ; {@code null} ou ≤ 0 → capture totale (comportement Python sans 2e argument)
     */
    public PaymentIntent capturePaymentIntent(String intentId, Long amountToCapture) throws StripeException {
        PaymentIntentCaptureParams.Builder cap = PaymentIntentCaptureParams.builder();
        if (amountToCapture != null && amountToCapture > 0) {
            cap.setAmountToCapture(amountToCapture);
        }
        PaymentIntent intent = PaymentIntent.retrieve(intentId);
        PaymentIntent captured = intent.capture(cap.build());
        log.info("PaymentIntent capturé : pi={} | status={}", captured.getId(), captured.getStatus());
        return captured;
    }

    public PaymentIntent capturePaymentIntent(String intentId) throws StripeException {
        return capturePaymentIntent(intentId, null);
    }

    /**
     * @param reason raison métier ({@code refused}, {@code expired}, {@code cancelled}, …) — mappée comme en Python
     */
    public PaymentIntent cancelPaymentIntent(String intentId, String reason) throws StripeException {
        String safeReason = mapBusinessCancelReason(reason);
        PaymentIntentCancelParams.CancellationReason stripeReason = toStripeCancellationEnum(safeReason);

        PaymentIntentCancelParams params = PaymentIntentCancelParams.builder()
                .setCancellationReason(stripeReason)
                .build();

        PaymentIntent intent = PaymentIntent.retrieve(intentId);
        PaymentIntent cancelled = intent.cancel(params);
        log.info(
                "PaymentIntent annulé : pi={} | reason={} | status={}",
                cancelled.getId(),
                safeReason,
                cancelled.getStatus()
        );
        return cancelled;
    }

    private static PaymentIntentCancelParams.CancellationReason toStripeCancellationEnum(String safeReason) {
        return switch (safeReason) {
            case "duplicate" -> PaymentIntentCancelParams.CancellationReason.DUPLICATE;
            case "fraudulent" -> PaymentIntentCancelParams.CancellationReason.FRAUDULENT;
            default -> PaymentIntentCancelParams.CancellationReason.ABANDONED;
        };
    }

    /**
     * Remboursement charge ; idempotency key préfixée {@code rf_} comme en Python.
     */
    public Refund createRefund(
            String chargeId,
            Long amountCents,
            String reason,
            String idempotencyKey
    ) throws StripeException {
        String safeReason = mapRefundReason(reason);

        RefundCreateParams.Builder builder = RefundCreateParams.builder()
                .setCharge(chargeId)
                .setReason(toRefundReasonEnum(safeReason));

        if (amountCents != null && amountCents > 0) {
            builder.setAmount(amountCents);
        }

        RefundCreateParams params = builder.build();

        Refund refund;
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            RequestOptions options = RequestOptions.builder()
                    .setIdempotencyKey("rf_" + idempotencyKey)
                    .build();
            refund = Refund.create(params, options);
        } else {
            refund = Refund.create(params);
        }

        log.info(
                "Remboursement créé : refund={} | charge={} | amount={} | reason={}",
                refund.getId(),
                chargeId,
                amountCents != null && amountCents > 0 ? amountCents + "c" : "full",
                safeReason
        );
        return refund;
    }

    private static RefundCreateParams.Reason toRefundReasonEnum(String safeReason) {
        return switch (safeReason) {
            case "fraudulent" -> RefundCreateParams.Reason.FRAUDULENT;
            case "duplicate" -> RefundCreateParams.Reason.DUPLICATE;
            default -> RefundCreateParams.Reason.REQUESTED_BY_CUSTOMER;
        };
    }
}
