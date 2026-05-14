package com.spotu.modules.bookings.service;

import com.spotu.error.ApiConflictException;
import com.spotu.error.ApiForbiddenException;
import com.spotu.error.ApiGoneException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.bookings.dto.BookingAcceptResponseDto;
import com.spotu.modules.bookings.dto.BookingCancelRequestDto;
import com.spotu.modules.bookings.dto.BookingCompleteResponseDto;
import com.spotu.modules.bookings.dto.BookingRefuseResponseDto;
import com.spotu.modules.bookings.infra.BookingWriteRepository;
import com.spotu.modules.payments.stripe.StripePaymentService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class BookingWriteService {

    private static final Logger log = LoggerFactory.getLogger(BookingWriteService.class);
    private static final int DEFAULT_PAY_NOW_CHECKOUT_MINUTES = 30;
    private static final int DEFAULT_PAY_LATER_MINUTES = 1440;

    private final AuthMeService authMeService;
    private final BookingWriteRepository bookingWriteRepository;
    private final TransactionTemplate transactionTemplate;
    private final StripePaymentService stripePaymentService;

    public BookingWriteService(
            AuthMeService authMeService,
            BookingWriteRepository bookingWriteRepository,
            TransactionTemplate transactionTemplate,
            StripePaymentService stripePaymentService
    ) {
        this.authMeService = authMeService;
        this.bookingWriteRepository = bookingWriteRepository;
        this.transactionTemplate = transactionTemplate;
        this.stripePaymentService = stripePaymentService;
    }

    public BookingRefuseResponseDto refuseBooking(String bookingId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        BookingWriteRepository.BookingRefuseRow booking = bookingWriteRepository.findBookingForRefuse(bookingId)
                .orElseThrow(() -> new ApiNotFoundException("Réservation introuvable"));

        if (!user.userId().equals(booking.receiverUserId())) {
            throw new ApiForbiddenException("Seul le bénéficiaire peut refuser cette réservation");
        }
        if ("refused".equals(booking.status())) {
            return new BookingRefuseResponseDto(true, "refused", null, true);
        }
        if (!"requested".equals(booking.status())) {
            throw new ApiConflictException("Impossible de refuser une réservation en état '" + booking.status() + "'");
        }

        BookingWriteRepository.PaymentStripeRow payment = bookingWriteRepository.findPaymentStripeByBookingId(bookingId).orElse(null);

        transactionTemplate.executeWithoutResult(status -> {
            bookingWriteRepository.updateBookingStatusRefused(bookingId);
            bookingWriteRepository.cancelPaymentsForRefuse(bookingId);
            if (booking.slotId() != null && !booking.slotId().isBlank()) {
                bookingWriteRepository.releasePendingSlot(booking.slotId());
            }
        });

        // Stripe hors transaction, erreur avalée comme en Python.
        if (payment != null && payment.stripePaymentIntentId() != null && !payment.stripePaymentIntentId().isBlank()) {
            String piId = payment.stripePaymentIntentId();
            try {
                stripePaymentService.cancelPaymentIntent(piId, "refused");
                log.info("Annulation Stripe réussie : pi={} | booking={}", piId, bookingId);
            } catch (Exception exc) {
                log.error("Erreur annulation Stripe pi={} : {}", piId, exc.getMessage(), exc);
            }
        }

        // Push non bloquant non implémenté dans cette slice Java (comportement externe).
        return new BookingRefuseResponseDto(true, "refused", bookingId, null);
    }

    public BookingAcceptResponseDto acceptBooking(String bookingId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        BookingWriteRepository.BookingAcceptRow booking = bookingWriteRepository.findBookingForAccept(bookingId)
                .orElseThrow(() -> new ApiNotFoundException("Réservation introuvable"));

        boolean isReceiver = user.userId().equals(booking.receiverUserId());
        boolean isAdmin = "admin".equals(user.role());
        if (!isReceiver && !isAdmin) {
            throw new ApiForbiddenException("Seul le bénéficiaire peut accepter cette réservation");
        }

        if ("awaiting_payment".equals(booking.status())
                || "accepted".equals(booking.status())
                || "confirmed".equals(booking.status())) {
            return new BookingAcceptResponseDto(true, booking.status(), bookingId, null, null, null, true);
        }

        if (!"requested".equals(booking.status())) {
            throw new ApiConflictException("Impossible d'accepter une réservation en état '" + booking.status() + "'");
        }

        if (booking.expiresAt() != null) {
            Instant expiresAt = booking.expiresAt().toInstant();
            if (expiresAt.isBefore(Instant.now())) {
                throw new ApiGoneException("Cette réservation a expiré — le créneau a été libéré");
            }
        }

        BookingWriteRepository.PaymentAcceptRow payment = bookingWriteRepository.findPaymentForAccept(bookingId).orElse(null);
        String payStatus = payment != null ? payment.payStatus() : null;
        String paymentMode = booking.paymentMode() == null || booking.paymentMode().isBlank()
                ? "pay_now"
                : booking.paymentMode();

        if ("pay_now".equals(paymentMode) && "authorized".equals(payStatus)) {
            transactionTemplate.executeWithoutResult(status -> {
                bookingWriteRepository.updateBookingAcceptedCaseA(bookingId);
                if (payment != null && payment.paymentId() != null && !payment.paymentId().isBlank()) {
                    bookingWriteRepository.capturePaymentById(payment.paymentId());
                }
                if (booking.slotId() != null && !booking.slotId().isBlank()) {
                    bookingWriteRepository.markSlotBookedForAccept(booking.slotId());
                }
            });

            if (payment != null && payment.stripePaymentIntentId() != null && !payment.stripePaymentIntentId().isBlank()) {
                String piId = payment.stripePaymentIntentId();
                try {
                    stripePaymentService.capturePaymentIntent(piId);
                    log.info("PaymentIntent capturé lors de l'acceptation : pi={} | booking={}", piId, bookingId);
                } catch (Exception exc) {
                    log.error("Erreur capture PI pi={} booking={} : {}", piId, bookingId, exc.getMessage(), exc);
                }
            }

            return new BookingAcceptResponseDto(true, "confirmed", bookingId, paymentMode, true, null, null);
        }

        int payExpiryMinutes;
        if ("pay_now".equals(paymentMode)) {
            Integer value = bookingWriteRepository.findPayNowCheckoutMinutesRaw();
            payExpiryMinutes = value == null ? DEFAULT_PAY_NOW_CHECKOUT_MINUTES : value;
        } else {
            payExpiryMinutes = booking.payLaterExpirationMinutes() == null
                    ? DEFAULT_PAY_LATER_MINUTES
                    : booking.payLaterExpirationMinutes();
        }

        Instant newExpiresAt = OffsetDateTime.now(ZoneOffset.UTC).plusMinutes(payExpiryMinutes).toInstant();
        String payExpiryInterval = payExpiryMinutes + " minutes";

        transactionTemplate.executeWithoutResult(status -> {
            bookingWriteRepository.updateBookingAcceptedCaseB(bookingId, newExpiresAt);
            if (booking.slotId() != null && !booking.slotId().isBlank()) {
                bookingWriteRepository.markSlotReservedForAccept(booking.slotId());
            }
        });

        return new BookingAcceptResponseDto(true, "awaiting_payment", bookingId, paymentMode, null, payExpiryInterval, null);
    }

    public BookingCompleteResponseDto completeBooking(String bookingId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String receiverUserId = bookingWriteRepository.findReceiverUserIdForComplete(bookingId)
                .orElseThrow(() -> new ApiNotFoundException("Réservation introuvable"));

        boolean isReceiver = user.userId().equals(receiverUserId);
        boolean isAdmin = "admin".equals(user.role());
        if (!isReceiver && !isAdmin) {
            throw new ApiForbiddenException("Seul le bénéficiaire peut marquer comme terminé");
        }

        transactionTemplate.executeWithoutResult(status -> {
            bookingWriteRepository.updateBookingCompleted(bookingId);
            bookingWriteRepository.markSlotCompletedForComplete(bookingId);
            bookingWriteRepository.captureAuthorizedPaymentsForComplete(bookingId);
        });

        return new BookingCompleteResponseDto(true, "completed");
    }

    public Map<String, Object> cancelBooking(String bookingId, BookingCancelRequestDto body, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String cancelReason = body != null ? body.reason() : null;

        BookingWriteRepository.BookingCancelRow booking = bookingWriteRepository.findBookingForCancel(bookingId)
                .orElseThrow(() -> new ApiNotFoundException("Réservation introuvable"));

        String uid = user.userId();
        boolean isAdmin = "admin".equals(user.role());
        boolean isPayer = uid.equals(booking.userId()) || uid.equals(booking.payerUserId());
        boolean isReceiver = uid.equals(booking.receiverUserId());

        if (!(isPayer || isReceiver || isAdmin)) {
            throw new ApiForbiddenException("Vous n'êtes pas autorisé à annuler cette réservation");
        }

        if (isReceiver && !isPayer && !isAdmin && !"accepted".equals(booking.status())) {
            throw new ApiConflictException(
                    "Le bénéficiaire peut annuler uniquement une réservation acceptée (état actuel : '"
                            + booking.status()
                            + "'). Pour refuser une demande en attente, utilisez /refuse."
            );
        }

        if ("cancelled".equals(booking.status())) {
            Map<String, Object> idempotent = new LinkedHashMap<>();
            idempotent.put("success", true);
            idempotent.put("status", "cancelled");
            idempotent.put("idempotent", true);
            return idempotent;
        }

        if ("completed".equals(booking.status()) || "refused".equals(booking.status()) || "expired".equals(booking.status())) {
            throw new ApiConflictException("Impossible d'annuler une réservation en état '" + booking.status() + "'");
        }

        String payStatus = booking.payStatus() != null ? booking.payStatus() : "";
        String newPayStatus;
        if ("requires_authorization".equals(payStatus)
                || "authorized".equals(payStatus)
                || "capture_pending".equals(payStatus)) {
            newPayStatus = "cancelled";
        } else if ("captured".equals(payStatus)) {
            newPayStatus = "refunded";
        } else {
            newPayStatus = payStatus;
        }

        transactionTemplate.executeWithoutResult(status -> {
            bookingWriteRepository.updateBookingCancelled(bookingId, uid, cancelReason);
            if (booking.paymentId() != null && !booking.paymentId().isBlank() && !newPayStatus.equals(payStatus)) {
                bookingWriteRepository.updatePaymentStatusByPaymentId(booking.paymentId(), newPayStatus);
            }
            if (booking.slotId() != null && !booking.slotId().isBlank()) {
                bookingWriteRepository.releaseSlotForCancel(booking.slotId());
            }
        });

        String stripeAction = null;
        String piId = booking.stripePaymentIntentId();
        String chargeId = booking.stripeChargeId();

        if ("cancelled".equals(newPayStatus) && piId != null && !piId.isBlank()) {
            try {
                stripePaymentService.cancelPaymentIntent(piId, "cancelled");
                stripeAction = "pi_cancelled";
                log.info("PI annulé : pi={} | booking={}", piId, bookingId);
            } catch (Exception exc) {
                log.error("Erreur annulation PI pi={} booking={} : {}", piId, bookingId, exc.getMessage(), exc);
            }
        } else if ("refunded".equals(newPayStatus)) {
            if (chargeId != null && !chargeId.isBlank()) {
                try {
                    stripePaymentService.createRefund(chargeId, null, "requested_by_customer", bookingId);
                    stripeAction = "refund_created";
                    log.info("Remboursement Stripe : charge={} | booking={}", chargeId, bookingId);
                } catch (Exception exc) {
                    log.error(
                            "Erreur remboursement Stripe charge={} booking={} : {}",
                            chargeId,
                            bookingId,
                            exc.getMessage(),
                            exc
                    );
                }
            } else {
                log.warn("Paiement capturé sans stripe_charge_id — remboursement manuel requis (booking={})", bookingId);
            }
        }

        // Push non bloquant non implémenté dans cette slice Java (comportement externe).
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("success", true);
        response.put("status", "cancelled");
        response.put("booking_id", bookingId);
        response.put("payment_status", newPayStatus);
        response.put("cancelled_by", uid);
        response.put("stripe_action", stripeAction);
        return response;
    }
}
