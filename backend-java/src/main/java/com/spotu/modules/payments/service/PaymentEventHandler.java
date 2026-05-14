package com.spotu.modules.payments.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.spotu.modules.payments.infra.StripeWebhookRepository;
import com.spotu.modules.payments.subscription.PendingWebhookNotification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Service
public class PaymentEventHandler {

    private static final Logger log = LoggerFactory.getLogger(PaymentEventHandler.class);

    public static final Set<String> PAYMENT_EVENTS = Set.of(
            "checkout.session.completed",
            "payment_intent.amount_capturable_updated",
            "payment_intent.succeeded",
            "payment_intent.payment_failed",
            "payment_intent.canceled"
    );

    private final StripeWebhookRepository repository;
    private final TransactionTemplate transactionTemplate;

    public PaymentEventHandler(StripeWebhookRepository repository, TransactionTemplate transactionTemplate) {
        this.repository = repository;
        this.transactionTemplate = transactionTemplate;
    }

    public void handle(
            String eventType,
            JsonNode obj,
            String paymentId,
            String bookingId,
            List<PendingWebhookNotification> pendingNotifs
    ) {
        switch (eventType) {
            case "checkout.session.completed" -> handleCheckoutSessionCompleted(obj, paymentId, bookingId, pendingNotifs);
            case "payment_intent.amount_capturable_updated" ->
                    handleAmountCapturableUpdated(paymentId, bookingId, pendingNotifs);
            case "payment_intent.succeeded" -> handlePaymentIntentSucceeded(obj, paymentId, bookingId, pendingNotifs);
            case "payment_intent.payment_failed" -> handlePaymentIntentFailed(paymentId, bookingId, pendingNotifs);
            case "payment_intent.canceled" -> handlePaymentIntentCanceled(paymentId);
            default -> {
            }
        }
        log.info("Payment event traité : type={} | payment={} | booking={}", eventType, paymentId, bookingId);
    }

    private void handleCheckoutSessionCompleted(
            JsonNode obj,
            String paymentId,
            String bookingId,
            List<PendingWebhookNotification> pendingNotifs
    ) {
        String mode = obj.path("mode").asText("");
        if ("subscription".equals(mode)) {
            return;
        }

        String paymentStatus = obj.path("payment_status").asText("");
        if ("unpaid".equals(paymentStatus)) {
            Optional<String> bookingStatus = bookingId == null ? Optional.empty() : repository.findBookingStatus(bookingId);
            if (bookingStatus.isPresent() && "awaiting_payment".equals(bookingStatus.get())) {
                Integer rowsUpdated = transactionTemplate.execute(status -> {
                    int rows = repository.updatePaymentCapturedGuardA(paymentId);
                    if (bookingId != null && !bookingId.isBlank()) {
                        repository.updateBookingConfirmedPaid(bookingId);
                    }
                    return rows;
                });
                if (rowsUpdated != null && rowsUpdated > 0 && bookingId != null && !bookingId.isBlank()) {
                    appendBookingConfirmedBranchA(paymentId, bookingId, pendingNotifs);
                }
            } else {
                int rowsUpdated = repository.updatePaymentAuthorized(paymentId);
                if (rowsUpdated > 0) {
                    repository.findPaymentUsers(paymentId).ifPresent(users ->
                            addIfUserPresent(
                                    pendingNotifs,
                                    users.receiverUserId(),
                                    "payment_authorized",
                                    "Paiement autorisé",
                                    "Le paiement pour votre prestation a été autorisé.",
                                    notifData("payment_authorized", bookingId, paymentId)
                            ));
                }
            }
            return;
        }

        if ("paid".equals(paymentStatus)) {
            Integer rowsCaptured = transactionTemplate.execute(status -> {
                int rows = repository.updatePaymentCapturedGuardC(paymentId);
                if (bookingId != null && !bookingId.isBlank()) {
                    repository.updateBookingConfirmedPaid(bookingId);
                }
                return rows;
            });
            if (rowsCaptured != null && rowsCaptured > 0 && bookingId != null && !bookingId.isBlank()) {
                appendBookingConfirmedBranchC(paymentId, bookingId, pendingNotifs);
            }
        }
    }

    private void handleAmountCapturableUpdated(
            String paymentId,
            String bookingId,
            List<PendingWebhookNotification> pendingNotifs
    ) {
        int rowsUpdated = repository.updatePaymentAuthorized(paymentId);
        if (rowsUpdated > 0) {
            repository.findPaymentUsers(paymentId).ifPresent(users ->
                    addIfUserPresent(
                            pendingNotifs,
                            users.receiverUserId(),
                            "payment_authorized",
                            "Paiement autorisé",
                            "Le paiement pour votre prestation est confirmé — vous pouvez procéder.",
                            notifData("payment_authorized", bookingId, paymentId)
                    ));
        }
    }

    private void handlePaymentIntentSucceeded(
            JsonNode obj,
            String paymentId,
            String bookingId,
            List<PendingWebhookNotification> pendingNotifs
    ) {
        Object latestChargeRaw = extractRawNodeValue(obj.get("latest_charge"));
        Integer rowsCaptured = transactionTemplate.execute(status -> {
            int rows;
            if (latestChargeRaw instanceof String latestCharge && latestCharge.startsWith("ch_")) {
                rows = repository.updatePaymentCapturedWithCharge(paymentId, latestCharge);
            } else {
                rows = repository.updatePaymentCapturedGuardC(paymentId);
            }
            if (bookingId != null && !bookingId.isBlank()) {
                repository.updateBookingConfirmedPaid(bookingId);
            }
            return rows;
        });

        if (rowsCaptured != null && rowsCaptured > 0 && bookingId != null && !bookingId.isBlank()) {
            String title = repository.findServiceTitleByBookingId(bookingId).orElse("votre prestation");
            repository.findPaymentUsers(paymentId).ifPresent(users -> {
                addIfUserPresent(
                        pendingNotifs,
                        users.payerUserId(),
                        "booking_confirmed",
                        "Réservation confirmée !",
                        "Votre réservation pour « " + title + " » est confirmée.",
                        notifData("booking_confirmed", bookingId, paymentId)
                );
                addIfUserPresent(
                        pendingNotifs,
                        users.receiverUserId(),
                        "booking_confirmed",
                        "Nouvelle réservation !",
                        "Paiement capturé pour « " + title + " ». Votre planning a été mis à jour.",
                        notifData("booking_confirmed", bookingId, paymentId)
                );
            });
        }
    }

    private void handlePaymentIntentFailed(
            String paymentId,
            String bookingId,
            List<PendingWebhookNotification> pendingNotifs
    ) {
        int rowsUpdated = repository.updatePaymentFailed(paymentId);
        if (rowsUpdated > 0) {
            repository.findPaymentUsers(paymentId).ifPresent(users ->
                    addIfUserPresent(
                            pendingNotifs,
                            users.payerUserId(),
                            "payment_failed",
                            "Paiement échoué",
                            "Votre paiement n'a pas pu être traité. Veuillez vérifier votre moyen de paiement.",
                            notifData("payment_failed", bookingId, paymentId)
                    ));
        }
    }

    private void handlePaymentIntentCanceled(String paymentId) {
        repository.updatePaymentCancelled(paymentId);
    }

    private void appendBookingConfirmedBranchA(
            String paymentId,
            String bookingId,
            List<PendingWebhookNotification> pendingNotifs
    ) {
        String title = repository.findServiceTitleByBookingId(bookingId).orElse("votre prestation");
        repository.findPaymentUsers(paymentId).ifPresent(users -> {
            addIfUserPresent(
                    pendingNotifs,
                    users.payerUserId(),
                    "booking_confirmed",
                    "Réservation confirmée !",
                    "Votre réservation pour « " + title + " » est confirmée. À bientôt !",
                    notifData("booking_confirmed", bookingId, paymentId)
            );
            addIfUserPresent(
                    pendingNotifs,
                    users.receiverUserId(),
                    "booking_confirmed",
                    "Nouvelle réservation !",
                    "Paiement reçu pour « " + title + " ». Votre planning a été mis à jour.",
                    notifData("booking_confirmed", bookingId, paymentId)
            );
        });
    }

    private void appendBookingConfirmedBranchC(
            String paymentId,
            String bookingId,
            List<PendingWebhookNotification> pendingNotifs
    ) {
        String title = repository.findServiceTitleByBookingId(bookingId).orElse("votre prestation");
        repository.findPaymentUsers(paymentId).ifPresent(users -> {
            addIfUserPresent(
                    pendingNotifs,
                    users.payerUserId(),
                    "booking_confirmed",
                    "Réservation confirmée !",
                    "Votre réservation pour « " + title + " » est confirmée.",
                    notifData("booking_confirmed", bookingId, paymentId)
            );
            addIfUserPresent(
                    pendingNotifs,
                    users.receiverUserId(),
                    "booking_confirmed",
                    "Nouvelle réservation !",
                    "Paiement reçu pour « " + title + " ». Votre planning a été mis à jour.",
                    notifData("booking_confirmed", bookingId, paymentId)
            );
        });
    }

    private static Map<String, Object> notifData(String type, String bookingId, String paymentId) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("type", type);
        data.put("booking_id", bookingId);
        data.put("payment_id", paymentId);
        return data;
    }

    private static void addIfUserPresent(
            List<PendingWebhookNotification> pendingNotifs,
            String userId,
            String type,
            String title,
            String body,
            Map<String, Object> data
    ) {
        if (userId == null || userId.isBlank()) {
            return;
        }
        pendingNotifs.add(new PendingWebhookNotification(userId, type, title, body, data));
    }

    private static Object extractRawNodeValue(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isTextual()) {
            return node.asText();
        }
        return node;
    }
}
