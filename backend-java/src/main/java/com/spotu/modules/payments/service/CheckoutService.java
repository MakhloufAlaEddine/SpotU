package com.spotu.modules.payments.service;

import com.spotu.error.ApiBadRequestException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.payments.infra.CheckoutRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Service
public class CheckoutService {

    private static final Logger log = LoggerFactory.getLogger(CheckoutService.class);

    private final CheckoutRepository checkoutRepository;
    private final StripeCheckoutService stripeCheckoutService;
    private final TransactionTemplate transactionTemplate;
    private final ObjectMapper objectMapper;

    public CheckoutService(
            CheckoutRepository checkoutRepository,
            StripeCheckoutService stripeCheckoutService,
            TransactionTemplate transactionTemplate,
            ObjectMapper objectMapper
    ) {
        this.checkoutRepository = checkoutRepository;
        this.stripeCheckoutService = stripeCheckoutService;
        this.transactionTemplate = transactionTemplate;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> createCheckoutSession(String bookingId, String originUrl, String userId) {
        if (bookingId == null || bookingId.isBlank()) {
            throw new ApiBadRequestException("booking_id requis");
        }

        CheckoutRepository.CheckoutPaymentRow payment = checkoutRepository.findForCheckout(bookingId, userId)
                .orElseThrow(() -> new ApiNotFoundException("Paiement non trouvé"));

        if ("captured".equals(payment.status())) {
            throw new ApiBadRequestException("Ce paiement est déjà complété");
        }

        if (payment.stripeCheckoutSessionId() != null && !payment.stripeCheckoutSessionId().isBlank()) {
            try {
                StripeCheckoutService.CheckoutSession existing = stripeCheckoutService.retrieveCheckoutSession(payment.stripeCheckoutSessionId());
                if ("open".equals(existing.status())) {
                    Map<String, Object> reused = new LinkedHashMap<>();
                    reused.put("url", existing.url());
                    reused.put("session_id", existing.id());
                    return reused;
                }
            } catch (Exception ignored) {
            }
        }

        long amountCents = Math.round(payment.payerTotalAmount().doubleValue() * 100.0d);
        String currency = payment.currency() == null || payment.currency().isBlank() ? "eur" : payment.currency().toLowerCase();
        String normalizedOrigin = originUrl == null ? "" : originUrl.replaceAll("/+$", "");
        String successUrl = normalizedOrigin + "/payment-success?session_id={{CHECKOUT_SESSION_ID}}&booking_id=" + bookingId;
        String cancelUrl = normalizedOrigin + "/booking/confirm?serviceId=";

        Map<String, String> metadata = new LinkedHashMap<>();
        metadata.put("payment_id", payment.paymentId());
        metadata.put("booking_id", bookingId);
        metadata.put("payer_user_id", userId);

        StripeCheckoutService.CheckoutSession session = stripeCheckoutService.createCheckoutSession(
                amountCents,
                currency,
                successUrl,
                cancelUrl,
                metadata,
                payment.paymentId()
        );

        String paymentIntentId = session.paymentIntent();
        transactionTemplate.executeWithoutResult(status ->
                checkoutRepository.updateAfterSessionCreation(payment.paymentId(), session.id(), paymentIntentId, bookingId)
        );

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("url", session.url());
        result.put("session_id", session.id());
        return result;
    }

    public Map<String, Object> getCheckoutStatus(String sessionId) {
        CheckoutRepository.CheckoutPaymentRow payment = checkoutRepository.findBySessionOrIntentId(sessionId)
                .orElseThrow(() -> new ApiNotFoundException("Session de paiement non trouvée"));

        String realSessionId = payment.stripeCheckoutSessionId() != null && !payment.stripeCheckoutSessionId().isBlank()
                ? payment.stripeCheckoutSessionId()
                : sessionId;

        StripeCheckoutService.CheckoutSession session;
        try {
            session = stripeCheckoutService.retrieveCheckoutSession(realSessionId);
        } catch (Exception exc) {
            log.warn("Impossible de récupérer la session Stripe {} : {}", realSessionId, exc.getMessage());
            Map<String, Object> unknown = new LinkedHashMap<>();
            unknown.put("payment_id", payment.paymentId());
            unknown.put("booking_id", payment.bookingId());
            unknown.put("session_id", sessionId);
            unknown.put("status", "unknown");
            unknown.put("payment_status", payment.status() == null ? "unknown" : payment.status());
            unknown.put("amount", payment.payerTotalAmount().doubleValue());
            unknown.put("currency", payment.currency() == null ? "EUR" : payment.currency());
            return unknown;
        }

        String dbStatus = payment.status();
        String stripePs = session.paymentStatus();
        String stripeStatus = session.status();

        if ("complete".equals(stripeStatus) && "unpaid".equals(stripePs)) {
            if (!"authorized".equals(dbStatus) && !"captured".equals(dbStatus) && !"paid".equals(dbStatus)) {
                boolean isInstant = payment.bookingId() != null
                        && checkoutRepository.findBookingStatus(payment.bookingId()).map("awaiting_payment"::equals).orElse(false);
                if (isInstant) {
                    transactionTemplate.executeWithoutResult(status -> {
                        checkoutRepository.updatePaymentCaptured(payment.paymentId());
                        if (payment.bookingId() != null) {
                            checkoutRepository.updateBookingConfirmedPaidGuarded(payment.bookingId());
                        }
                    });
                    dbStatus = "captured";
                    CheckoutRepository.PaymentUsersRow users = checkoutRepository.findPaymentUsers(payment.paymentId()).orElse(null);
                    String title = checkoutRepository.findServiceTitleByBookingId(payment.bookingId()).orElse("votre prestation");
                    if (users != null) {
                        sendSyncNotification(
                                users.payerUserId(),
                                "booking_confirmed",
                                "Réservation confirmée !",
                                "Votre réservation pour « " + title + " » est confirmée. À bientôt !",
                                Map.of("type", "booking_confirmed", "booking_id", payment.bookingId())
                        );
                        sendSyncNotification(
                                users.receiverUserId(),
                                "booking_confirmed",
                                "Nouvelle réservation !",
                                "Paiement reçu pour « " + title + " ». Votre planning a été mis à jour.",
                                Map.of("type", "booking_confirmed", "booking_id", payment.bookingId())
                        );
                    }
                } else {
                    transactionTemplate.executeWithoutResult(status -> {
                        checkoutRepository.updatePaymentAuthorized(payment.paymentId());
                        if (payment.bookingId() != null) {
                            checkoutRepository.updateBookingPaymentAuthorized(payment.bookingId());
                        }
                    });
                    dbStatus = "authorized";
                }
            }
        } else if ("paid".equals(stripePs) && !"captured".equals(dbStatus)) {
            transactionTemplate.executeWithoutResult(status -> {
                checkoutRepository.updatePaymentCaptured(payment.paymentId());
                if (payment.bookingId() != null) {
                    checkoutRepository.updateBookingConfirmedPaidGuarded(payment.bookingId());
                }
            });
            dbStatus = "captured";
        } else if ("expired".equals(stripeStatus) && "authorized".equals(dbStatus)) {
            checkoutRepository.updatePaymentCancelled(payment.paymentId());
            dbStatus = "cancelled";
        }

        BigDecimal amount = (session.amountTotal() != null && session.amountTotal() > 0)
                ? BigDecimal.valueOf(session.amountTotal() / 100.0d)
                : payment.payerTotalAmount();
        String currency = session.currency() != null && !session.currency().isBlank()
                ? session.currency()
                : (payment.currency() == null ? "EUR" : payment.currency());

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("payment_id", payment.paymentId());
        response.put("booking_id", payment.bookingId());
        response.put("session_id", sessionId);
        response.put("status", stripeStatus);
        response.put("payment_status", dbStatus);
        response.put("stripe_status", stripePs);
        response.put("amount", amount.doubleValue());
        response.put("currency", currency);
        return response;
    }

    private void sendSyncNotification(
            String userId,
            String type,
            String title,
            String body,
            Map<String, Object> data
    ) {
        if (userId == null || userId.isBlank()) {
            return;
        }
        String notifId = "ntf_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String dataJson;
        try {
            dataJson = objectMapper.writeValueAsString(data);
        } catch (Exception exc) {
            throw new IllegalStateException("Push payload serialization failed", exc);
        }
        checkoutRepository.insertNotification(notifId, userId, type, title, body, dataJson);
    }
}
