package com.spotu.modules.workers.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.payments.stripe.StripePaymentService;
import com.spotu.modules.workers.infra.ExpiryWorkerRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class ExpiryWorkerService {

    private static final Logger log = LoggerFactory.getLogger(ExpiryWorkerService.class);
    private static final int EXPIRY_BATCH_SIZE = 50;

    private final ExpiryWorkerRepository expiryWorkerRepository;
    private final StripePaymentService stripePaymentService;
    private final TransactionTemplate transactionTemplate;
    private final ObjectMapper objectMapper;

    public ExpiryWorkerService(
            ExpiryWorkerRepository expiryWorkerRepository,
            StripePaymentService stripePaymentService,
            TransactionTemplate transactionTemplate,
            ObjectMapper objectMapper
    ) {
        this.expiryWorkerRepository = expiryWorkerRepository;
        this.stripePaymentService = stripePaymentService;
        this.transactionTemplate = transactionTemplate;
        this.objectMapper = objectMapper;
    }

    public int drainExpiredBookings() {
        int total = 0;
        while (true) {
            int count = processBatch(EXPIRY_BATCH_SIZE);
            total += count;
            if (count < EXPIRY_BATCH_SIZE) {
                return total;
            }
        }
    }

    public int processBatch(int batchSize) {
        List<ExpiryWorkerRepository.ExpiredBookingRow> rows = transactionTemplate.execute(status ->
                expiryWorkerRepository.findExpiredBatchLocked(batchSize));
        if (rows == null || rows.isEmpty()) {
            return 0;
        }

        int processed = 0;
        for (ExpiryWorkerRepository.ExpiredBookingRow row : rows) {
            try {
                boolean committed = processOneRowInTransaction(row);
                if (!committed) {
                    continue;
                }
                processed++;
                maybeCancelStripeAfterCommit(row);
                log.info("Booking expire worker: booking={} prev_status={} slot={} pay_status={}",
                        row.bookingId(), row.bookingStatus(), row.slotId(), row.payStatus());
            } catch (Exception exc) {
                log.error("Erreur expiration booking {} : {}", row.bookingId(), exc.getMessage(), exc);
            }
        }
        return processed;
    }

    private boolean processOneRowInTransaction(ExpiryWorkerRepository.ExpiredBookingRow row) {
        Boolean result = transactionTemplate.execute(status -> {
            boolean updated = expiryWorkerRepository.expireBookingGuarded(row.bookingId());
            if (!updated) {
                return false;
            }

            if (row.slotId() != null && !row.slotId().isBlank()) {
                expiryWorkerRepository.releaseSlotForExpiry(row.slotId());
            }
            if (row.paymentId() != null && !row.paymentId().isBlank() && eligiblePaymentStatus(row.payStatus())) {
                expiryWorkerRepository.cancelPaymentForExpiry(row.paymentId());
            }

            String serviceTitle = expiryWorkerRepository.findServiceTitle(row.serviceId());
            if (serviceTitle == null || serviceTitle.isBlank()) {
                serviceTitle = "un service";
            }
            insertNotifications(row, serviceTitle);
            return true;
        });
        return Boolean.TRUE.equals(result);
    }

    private void maybeCancelStripeAfterCommit(ExpiryWorkerRepository.ExpiredBookingRow row) {
        if (row.stripePaymentIntentId() == null || row.stripePaymentIntentId().isBlank()) {
            return;
        }
        if (!eligiblePaymentStatus(row.payStatus())) {
            return;
        }
        try {
            stripePaymentService.cancelPaymentIntent(row.stripePaymentIntentId(), "expired");
            log.info(
                    "Stripe annulation expiration : pi={} | booking={}",
                    row.stripePaymentIntentId(),
                    row.bookingId()
            );
        } catch (Exception exc) {
            log.error("Erreur Stripe annulation pi={} : {}", row.stripePaymentIntentId(), exc.getMessage());
        }
    }

    private void insertNotifications(ExpiryWorkerRepository.ExpiredBookingRow row, String serviceTitle) {
        Map<String, Object> payerData = new LinkedHashMap<>();
        payerData.put("type", "booking_expired");
        payerData.put("bookingId", row.bookingId());
        payerData.put("service_id", row.serviceId());
        payerData.put("service_title", serviceTitle);

        String payerBody = "awaiting_payment".equals(row.bookingStatus())
                ? "Votre réservation pour « " + serviceTitle + " » a expiré (délai de paiement dépassé)."
                : "Votre demande pour « " + serviceTitle + " » n'a pas reçu de réponse et a expiré.";
        expiryWorkerRepository.insertNotification(
                row.payerUserId(),
                "booking_expired",
                "Demande expirée",
                payerBody,
                toJson(payerData)
        );

        Map<String, Object> receiverData = new LinkedHashMap<>(payerData);
        receiverData.put("payer_id", row.payerUserId());
        String receiverTitle = "awaiting_payment".equals(row.bookingStatus())
                ? "Réservation non payée"
                : "Demande non traitée";
        String receiverBody = "awaiting_payment".equals(row.bookingStatus())
                ? "Le client n'a pas payé dans les délais pour « " + serviceTitle + " » — créneau libéré."
                : "Une demande de réservation pour « " + serviceTitle + " » a expiré sans avoir été traitée.";
        expiryWorkerRepository.insertNotification(
                row.receiverUserId(),
                "booking_expired",
                receiverTitle,
                receiverBody,
                toJson(receiverData)
        );
    }

    private String toJson(Map<String, Object> data) {
        try {
            return objectMapper.writeValueAsString(data);
        } catch (JsonProcessingException exc) {
            throw new IllegalStateException("Impossible de sérialiser la notification", exc);
        }
    }

    private boolean eligiblePaymentStatus(String payStatus) {
        return "requires_authorization".equals(payStatus)
                || "authorized".equals(payStatus)
                || "capture_pending".equals(payStatus);
    }
}
