package com.spotu.modules.payments.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.spotu.modules.payments.infra.StripeWebhookRepository;
import com.spotu.modules.payments.subscription.PendingWebhookNotification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Service
public class ChargeEventHandler {

    private static final Logger log = LoggerFactory.getLogger(ChargeEventHandler.class);
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final BigDecimal TOLERANCE = new BigDecimal("0.02");

    public static final Set<String> CHARGE_EVENTS = Set.of(
            "charge.refunded",
            "refund.updated"
    );

    private final StripeWebhookRepository repository;

    public ChargeEventHandler(StripeWebhookRepository repository) {
        this.repository = repository;
    }

    public String handle(
            String eventType,
            JsonNode obj,
            String resolvedPaymentId,
            List<PendingWebhookNotification> pendingNotifs
    ) {
        return switch (eventType) {
            case "charge.refunded" -> handleChargeRefunded(obj, resolvedPaymentId, pendingNotifs);
            case "refund.updated" -> handleRefundUpdated(obj, resolvedPaymentId);
            default -> resolvedPaymentId;
        };
    }

    private String handleChargeRefunded(
            JsonNode obj,
            String paymentId,
            List<PendingWebhookNotification> pendingNotifs
    ) {
        String chargeId = obj.path("id").isMissingNode() || obj.path("id").isNull() ? null : obj.path("id").asText(null);
        if (paymentId == null || paymentId.isBlank()) {
            if (chargeId != null && !chargeId.isBlank()) {
                paymentId = repository.findPaymentIdByChargeId(chargeId).orElse(null);
            }
            if (paymentId == null || paymentId.isBlank()) {
                log.debug("charge.refunded : payment_id introuvable (charge={})", chargeId);
                return null;
            }
        }

        long amountRefundedCents = readLong(obj.get("amount_refunded"), 0L);
        BigDecimal amountRefunded = BigDecimal.valueOf(amountRefundedCents).divide(HUNDRED, 2, RoundingMode.HALF_UP);
        boolean fullyRefunded = obj.path("refunded").asBoolean(false);
        String newStatus = fullyRefunded ? "refunded" : "partially_refunded";
        String refundStatus = "succeeded";

        int rowsUpdated = repository.updateRefundFromChargeRefunded(
                paymentId,
                newStatus,
                amountRefunded,
                refundStatus,
                chargeId
        );

        log.info(
                "Remboursement : payment={} | amount={}€ | full={} → status={}",
                paymentId,
                String.format(Locale.ROOT, "%.2f", amountRefunded),
                fullyRefunded ? "True" : "False",
                newStatus
        );

        if (rowsUpdated > 0) {
            Optional<String> payerUserId = repository.findPayerUserId(paymentId);
            if (payerUserId.isPresent() && payerUserId.get() != null && !payerUserId.get().isBlank()) {
                String amountFmt = String.format(Locale.ROOT, "%.2f", amountRefunded);
                String title = fullyRefunded ? "Remboursement effectué" : "Remboursement partiel";
                String body = fullyRefunded
                        ? "Vous avez été remboursé de " + amountFmt + " €."
                        : "Un remboursement partiel de " + amountFmt + " € a été initié.";
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("type", "payment_refunded");
                data.put("payment_id", paymentId);
                data.put("refund_amount", amountRefunded.doubleValue());
                data.put("fully_refunded", fullyRefunded);
                pendingNotifs.add(new PendingWebhookNotification(
                        payerUserId.get(),
                        "payment_refunded",
                        title,
                        body,
                        data
                ));
            }
        }
        return paymentId;
    }

    private String handleRefundUpdated(JsonNode obj, String paymentId) {
        String refundId = textOrNull(obj.get("id"));
        String refundStatus = textOrNull(obj.get("status"));
        String chargeId = textOrNull(obj.get("charge"));
        BigDecimal amount = BigDecimal.valueOf(readLong(obj.get("amount"), 0L)).divide(HUNDRED, 2, RoundingMode.HALF_UP);

        if ((paymentId == null || paymentId.isBlank()) && chargeId != null && !chargeId.isBlank()) {
            Optional<StripeWebhookRepository.RefundLookupRow> lookup = repository.findRefundLookupByChargeId(chargeId);
            if (lookup.isPresent()) {
                paymentId = lookup.get().paymentId();
                BigDecimal total = lookup.get().payerTotalAmount() == null ? BigDecimal.ZERO : lookup.get().payerTotalAmount();
                boolean matchesFull =
                        "succeeded".equals(refundStatus)
                                && amount.subtract(total).abs().compareTo(TOLERANCE) < 0;
                if (matchesFull) {
                    repository.updateRefundAsFullyRefundedEdgeCase(paymentId, refundStatus, amount);
                    log.info("refund.updated → remboursement complet confirmé : refund={} | payment={}", refundId, paymentId);
                    return paymentId;
                }
            }
        }

        if (paymentId != null && !paymentId.isBlank()) {
            repository.updateRefundStatusOnly(paymentId, refundStatus);
            log.info("refund.updated : refund={} | status={} | payment={}", refundId, refundStatus, paymentId);
            return paymentId;
        }

        log.debug("refund.updated : payment introuvable (refund={} charge={})", refundId, chargeId);
        return null;
    }

    private static long readLong(JsonNode node, long defaultValue) {
        if (node == null || node.isNull()) {
            return defaultValue;
        }
        if (node.isNumber()) {
            return node.asLong();
        }
        if (node.isTextual()) {
            try {
                return Long.parseLong(node.asText());
            } catch (NumberFormatException ignored) {
                return defaultValue;
            }
        }
        return defaultValue;
    }

    private static String textOrNull(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return null;
        }
        String value = node.asText(null);
        return (value == null || value.isBlank()) ? null : value;
    }
}
