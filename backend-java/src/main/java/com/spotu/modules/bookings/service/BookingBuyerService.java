package com.spotu.modules.bookings.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.error.ApiBadRequestException;
import com.spotu.error.ApiConflictException;
import com.spotu.error.ApiForbiddenException;
import com.spotu.error.ApiGoneException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.common.JdbcSqlDialect;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.auth.support.PythonIsoTimestamps;
import com.spotu.modules.bookings.dto.BookingPayResponseDto;
import com.spotu.modules.bookings.infra.BookingBuyerRepository;
import com.spotu.modules.payments.service.StripeCheckoutService;
import com.spotu.modules.spotyou.support.EmergentIds;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.HttpStatus;

@Service
public class BookingBuyerService {

    private static final Logger log = LoggerFactory.getLogger(BookingBuyerService.class);

    private static final int BOOKING_EXPIRY_HOURS_DEFAULT = 48;
    private static final int DEFAULT_PAY_NOW_CHECKOUT_MINUTES = 30;
    private static final int DEFAULT_PAY_LATER_MINUTES = 1440;

    private final AuthMeService authMeService;
    private final BookingBuyerRepository repository;
    private final BookingPricingEngine pricingEngine;
    private final TransactionTemplate transactionTemplate;
    private final StripeCheckoutService stripeCheckoutService;
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final JdbcSqlDialect jdbcSqlDialect;

    public BookingBuyerService(
            AuthMeService authMeService,
            BookingBuyerRepository repository,
            BookingPricingEngine pricingEngine,
            TransactionTemplate transactionTemplate,
            StripeCheckoutService stripeCheckoutService,
            JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper,
            JdbcSqlDialect jdbcSqlDialect
    ) {
        this.authMeService = authMeService;
        this.repository = repository;
        this.pricingEngine = pricingEngine;
        this.transactionTemplate = transactionTemplate;
        this.stripeCheckoutService = stripeCheckoutService;
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.jdbcSqlDialect = jdbcSqlDialect;
    }

    public Map<String, Object> previewPrice(HttpServletRequest request, Map<String, Object> body) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String serviceId = asString(body == null ? null : body.get("service_id"));
        if (serviceId == null || serviceId.isBlank()) {
            throw new ApiBadRequestException("service_id requis");
        }

        BookingBuyerRepository.ServicePreviewRow svc = repository.findServiceForPreview(serviceId)
                .orElseThrow(() -> new ApiNotFoundException("Service introuvable ou inactif"));

        BookingPricingEngine.PricingResult pricing = pricingEngine.computePricing("service_booking", svc.price(), "EUR");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("base_amount", pricing.baseAmount());
        out.put("payer_fixed_fee", pricing.payerFixedFee());
        out.put("payer_percent_fee_amount", pricing.payerPercentFeeAmount());
        out.put("receiver_fixed_fee", pricing.receiverFixedFee());
        out.put("receiver_percent_fee_amount", pricing.receiverPercentFeeAmount());
        out.put("platform_total_fee", pricing.platformTotalFee());
        out.put("receiver_net_amount", pricing.receiverNetAmount());
        out.put("payer_total_amount", pricing.payerTotalAmount());
        out.put("currency", pricing.currency());
        return out;
    }

    public Map<String, Object> requestBooking(HttpServletRequest request, Map<String, Object> body) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String payerUserId = user.userId();

        String serviceId = asString(body == null ? null : body.get("service_id"));
        if (serviceId == null || serviceId.isBlank()) {
            throw new ApiBadRequestException("service_id requis");
        }
        String paymentMode = Optional.ofNullable(asString(body.get("payment_mode"))).orElse("pay_now").trim();
        if (!"pay_now".equals(paymentMode) && !"pay_later".equals(paymentMode)) {
            throw new ApiBadRequestException("payment_mode doit être 'pay_now' ou 'pay_later'");
        }
        String idempotencyKey = asString(body.get("idempotency_key"));
        String slotId = asString(body.get("slot_id"));
        String locationId = asString(body.get("location_id"));
        String notes = asString(body.get("notes"));
        Timestamp scheduledAt = parseIsoTimestamp(asString(body.get("scheduled_at")));

        BookingBuyerRepository.ServiceRequestRow svc = repository.findServiceForRequest(serviceId)
                .orElseThrow(() -> new ApiNotFoundException("Service introuvable ou inactif"));
        if (svc.coachId() != null && svc.coachId().equals(payerUserId)) {
            throw new ApiBadRequestException("Impossible de réserver son propre service");
        }

        Map<String, Boolean> flags = repository.findGlobalBookingFlags();
        boolean globalAllowManual = flags.getOrDefault("enable_manual_approval_for_services", false);
        boolean globalAllowPayLater = flags.getOrDefault("enable_pay_later_for_services", false);
        int payNowMinutes = Optional.ofNullable(repository.findPayNowCheckoutMinutesRaw()).orElse(DEFAULT_PAY_NOW_CHECKOUT_MINUTES);

        String approvalMode = svc.bookingApprovalMode() == null || svc.bookingApprovalMode().isBlank()
                ? "manual_approval"
                : svc.bookingApprovalMode();
        boolean allowPayLater = Boolean.TRUE.equals(svc.allowPayLater());
        int payLaterExpiryMinutes = svc.payLaterExpirationMinutes() == null ? DEFAULT_PAY_LATER_MINUTES : svc.payLaterExpirationMinutes();

        if (!globalAllowManual) {
            approvalMode = "instant_booking";
        }
        if (!globalAllowPayLater) {
            allowPayLater = false;
            if ("pay_later".equals(paymentMode)) {
                throw new ApiConflictException("Le paiement différé n'est pas activé sur cette plateforme — veuillez choisir 'pay_now'");
            }
        }
        if ("pay_later".equals(paymentMode) && !allowPayLater) {
            throw new ApiBadRequestException("Ce service ne permet pas le paiement différé");
        }

        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            Optional<String> existing = repository.findBookingIdByIdempotencyKey(idempotencyKey);
            if (existing.isPresent()) {
                return apiBooking(existing.get());
            }
        }
        if (slotId != null && !slotId.isBlank()) {
            Optional<String> existing = repository.findActiveBookingIdBySlotAndUser(slotId, payerUserId);
            if (existing.isPresent()) {
                return apiBooking(existing.get());
            }
        }

        String bookingId = EmergentIds.newId("bkg");
        String paymentId = EmergentIds.newId("pay");
        String finalApprovalMode = approvalMode;
        String finalPaymentMode = paymentMode;
        int finalPayLaterExpiryMinutes = payLaterExpiryMinutes;

        BookingCreateState state = transactionTemplate.execute(status -> {
            String slotType = null;
            if (slotId != null && !slotId.isBlank()) {
                BookingBuyerRepository.SlotRow slot;
                try {
                    slot = repository.lockSlotNowait(slotId)
                            .orElseThrow(() -> new ApiNotFoundException("Créneau introuvable"));
                } catch (CannotAcquireLockException ex) {
                    throw new ApiConflictException("Ce créneau est en cours de réservation — réessayez");
                } catch (DataAccessException ex) {
                    if (isLockNowaitConflict(ex)) {
                        throw new ApiConflictException("Ce créneau est en cours de réservation — réessayez");
                    }
                    throw ex;
                }
                slotType = slot.slotType();
                if (("single".equals(slotType) || "specific".equals(slotType)) && !"available".equals(slot.slotStatus())) {
                    throw new ApiConflictException("Créneau indisponible (état : " + slot.slotStatus() + ")");
                }
            }

            BookingPricingEngine.PricingResult pricing = pricingEngine.computePricing("service_booking", svc.price(), "EUR");

            Instant now = Instant.now();
            String initialStatus;
            String initialSlotStatus;
            Timestamp expiresAt;
            String expiresLabel;
            if ("instant_booking".equals(finalApprovalMode)) {
                initialStatus = "awaiting_payment";
                initialSlotStatus = "reserved";
                int minutes = "pay_now".equals(finalPaymentMode) ? payNowMinutes : finalPayLaterExpiryMinutes;
                expiresAt = Timestamp.from(now.plus(Duration.ofMinutes(minutes)));
                expiresLabel = minutes + " minutes";
            } else {
                initialStatus = "requested";
                initialSlotStatus = "pending";
                expiresAt = Timestamp.from(now.plus(Duration.ofHours(BOOKING_EXPIRY_HOURS_DEFAULT)));
                expiresLabel = BOOKING_EXPIRY_HOURS_DEFAULT + " hours";
            }

            repository.insertBooking(
                    bookingId,
                    serviceId,
                    payerUserId,
                    svc.coachId(),
                    initialStatus,
                    scheduledAt,
                    slotId,
                    locationId,
                    notes,
                    pricing.payerTotalAmount(),
                    payerUserId,
                    svc.coachId(),
                    writeJson(pricing.snapshot()),
                    idempotencyKey,
                    finalPaymentMode,
                    expiresAt
            );

            Map<String, Object> paymentSnapshot = new LinkedHashMap<>(pricing.snapshot());
            BookingBuyerRepository.PaymentInsertRow paymentRow = new BookingBuyerRepository.PaymentInsertRow(
                    paymentId,
                    payerUserId,
                    svc.coachId(),
                    "service_booking",
                    serviceId,
                    bookingId,
                    null,
                    null,
                    null,
                    "requires_authorization",
                    "EUR",
                    pricing.baseAmount(),
                    pricing.payerFixedFee(),
                    pricing.payerPercentFeeAmount(),
                    pricing.receiverFixedFee(),
                    pricing.receiverPercentFeeAmount(),
                    pricing.platformTotalFee(),
                    pricing.receiverNetAmount(),
                    pricing.payerTotalAmount(),
                    writeJson(paymentSnapshot)
            );
            repository.insertPayment(paymentRow);

            if (slotId != null && !slotId.isBlank() && ("single".equals(slotType) || "specific".equals(slotType))) {
                repository.updateSlotStatus(slotId, initialSlotStatus);
            }

            registerAfterCommit(() -> fireAndForgetBookingPush(
                    payerUserId,
                    user.name(),
                    svc.coachId(),
                    serviceId,
                    bookingId,
                    initialStatus
            ));

            log.info("Booking créé : bk={} | approval={} | payment={} | status={} | expiry={}",
                    bookingId, finalApprovalMode, finalPaymentMode, initialStatus, expiresLabel);
            return new BookingCreateState(initialStatus, finalApprovalMode);
        });
        if (state == null) {
            throw new IllegalStateException("Booking creation transaction failed");
        }
        return apiBooking(bookingId);
    }

    public BookingPayResponseDto payBooking(String bookingId, HttpServletRequest request, Map<String, Object> body) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String originUrl = asString(body == null ? null : body.get("origin_url"));
        if (originUrl == null || originUrl.isBlank()) {
            originUrl = Optional.ofNullable(System.getenv("APP_URL")).orElse("");
        }

        BookingBuyerRepository.PayBookingGuardRow booking = repository.findPayGuard(bookingId)
                .orElseThrow(() -> new ApiNotFoundException("Réservation introuvable"));

        String effectivePayer = booking.payerUserId() == null || booking.payerUserId().isBlank()
                ? booking.userId() : booking.payerUserId();
        if (!user.userId().equals(effectivePayer) && !"admin".equals(user.role())) {
            throw new ApiForbiddenException("Seul le payeur peut initier le paiement");
        }
        if (!"awaiting_payment".equals(booking.status())) {
            throw new ApiConflictException("Le paiement n'est disponible que pour les réservations en attente de paiement (statut actuel : '" + booking.status() + "')");
        }
        if (booking.expiresAt() != null && booking.expiresAt().isBefore(Instant.now())) {
            throw new ApiGoneException("Le délai de paiement a expiré — réservation annulée");
        }

        BookingBuyerRepository.PayPaymentRow payment = repository.findPaymentForPay(bookingId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Enregistrement de paiement manquant pour cette réservation"));

        String existingSessionId = payment.stripeCheckoutSessionId();
        if (existingSessionId != null && !existingSessionId.isBlank()) {
            try {
                StripeCheckoutService.CheckoutSession existing = stripeCheckoutService.retrieveCheckoutSession(existingSessionId);
                if ("open".equals(existing.status())) {
                    return new BookingPayResponseDto(existing.url(), existing.url(), existing.id(), true);
                }
            } catch (Exception ignored) {
            }
        }

        BigDecimal total = payment.payerTotalAmount() == null ? BigDecimal.ZERO : payment.payerTotalAmount();
        long amountCents = total.multiply(new BigDecimal("100")).setScale(0, RoundingMode.HALF_UP).longValue();
        String currency = (payment.currency() == null || payment.currency().isBlank() ? "eur" : payment.currency())
                .toLowerCase(Locale.ROOT);
        String successUrl = originUrl + "/payment-success?session_id={CHECKOUT_SESSION_ID}&booking_id=" + bookingId;
        String cancelUrl = originUrl + "/bookings";

        Map<String, String> metadata = new LinkedHashMap<>();
        metadata.put("payment_id", payment.paymentId());
        metadata.put("booking_id", bookingId);

        StripeCheckoutService.CheckoutSession session = stripeCheckoutService.createCheckoutSession(
                amountCents,
                currency,
                successUrl,
                cancelUrl,
                metadata,
                payment.paymentId()
        );

        String paymentIntentId = session.paymentIntent();
        transactionTemplate.executeWithoutResult(status -> {
            repository.updatePaymentAfterStripeSession(session.id(), paymentIntentId, payment.paymentId());
            repository.updateBookingPaymentStatusForPay(bookingId);
        });

        return new BookingPayResponseDto(session.url(), session.url(), session.id(), null);
    }

    private Map<String, Object> apiBooking(String bookingId) {
        Map<String, Object> row = repository.fetchBookingForApi(bookingId)
                .orElseThrow(() -> new ApiNotFoundException("Réservation introuvable"));
        LinkedHashMap<String, Object> out = new LinkedHashMap<>();
        out.put("booking_id", row.get("booking_id"));
        out.put("service_id", row.get("service_id"));
        out.put("user_id", row.get("user_id"));
        out.put("coach_id", row.get("coach_id"));
        out.put("status", row.get("status"));
        out.put("scheduled_at", toIso(row.get("scheduled_at")));
        out.put("slot_id", row.get("slot_id"));
        out.put("location_id", row.get("location_id"));
        out.put("notes", row.get("notes"));
        out.put("amount", row.get("amount"));
        out.put("payment_status", row.get("payment_status"));
        out.put("payer_user_id", row.get("payer_user_id"));
        out.put("receiver_user_id", row.get("receiver_user_id"));
        out.put("pricing_snapshot", deserializePricingSnapshot(row.get("pricing_snapshot")));
        out.put("idempotency_key", row.get("idempotency_key"));
        out.put("currency", row.get("currency"));
        out.put("created_at", toIso(row.get("created_at")));
        out.put("updated_at", toIso(row.get("updated_at")));
        out.put("expires_at", toIso(row.get("expires_at")));
        out.put("cancelled_by_user_id", row.get("cancelled_by_user_id"));
        out.put("cancellation_reason", row.get("cancellation_reason"));
        out.put("payment_mode", row.get("payment_mode"));
        out.put("service_title", row.get("service_title"));
        out.put("address", row.get("address"));
        return out;
    }

    private void fireAndForgetBookingPush(
            String payerUserId,
            String senderName,
            String receiverUserId,
            String serviceId,
            String bookingId,
            String initialStatus
    ) {
        String userName = repository.findUserName(payerUserId).orElse("Un utilisateur");
        String serviceName = repository.findServiceTitle(serviceId).orElse("votre service");
        String title;
        String body;
        String dataType;
        if ("awaiting_payment".equals(initialStatus)) {
            title = "Créneau réservé (paiement en attente)";
            body = userName + " a réservé un créneau : " + serviceName;
            dataType = "booking_awaiting_payment";
        } else {
            title = "Nouvelle demande de réservation";
            body = userName + " souhaite réserver : " + serviceName;
            dataType = "new_booking";
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("type", dataType);
        data.put("bookingId", bookingId);
        data.put("service_id", serviceId);
        data.put("sender_id", payerUserId);
        data.put("sender_name", senderName == null ? "" : senderName);

        try {
            jdbcTemplate.update(
                    jdbcSqlDialect.notificationInsertSql(),
                    "ntf_" + EmergentIds.newId("").replace("_", "").substring(0, 12),
                    receiverUserId,
                    "new_booking",
                    title,
                    body,
                    writeJson(data)
            );
        } catch (Exception exc) {
            log.warn("Booking push side effect failed for user={} : {}", receiverUserId, exc.getMessage());
        }
    }

    private boolean isLockNowaitConflict(DataAccessException ex) {
        Throwable cursor = ex;
        while (cursor != null) {
            if (cursor instanceof java.sql.SQLException sql) {
                if ("55P03".equals(sql.getSQLState())) {
                    return true;
                }
            }
            String msg = cursor.getMessage();
            if (msg != null && (msg.contains("55P03") || msg.toLowerCase(Locale.ROOT).contains("nowait"))) {
                return true;
            }
            cursor = cursor.getCause();
        }
        return false;
    }

    private Object deserializePricingSnapshot(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof String s) {
            try {
                return objectMapper.readValue(s, new TypeReference<Map<String, Object>>() {
                });
            } catch (Exception ignored) {
                return raw;
            }
        }
        return raw;
    }

    private static String toIso(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof Timestamp ts) {
            return PythonIsoTimestamps.fromTimestamp(ts);
        }
        if (raw instanceof Instant instant) {
            return PythonIsoTimestamps.fromTimestamp(Timestamp.from(instant));
        }
        return String.valueOf(raw);
    }

    private static Timestamp parseIsoTimestamp(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Timestamp.from(Instant.parse(value));
        } catch (DateTimeParseException ignored) {
            try {
                return Timestamp.from(OffsetDateTime.parse(value).toInstant());
            } catch (DateTimeParseException e) {
                throw new ApiBadRequestException("scheduled_at invalide");
            }
        }
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot serialize JSON", e);
        }
    }

    private static void registerAfterCommit(Runnable runnable) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    runnable.run();
                }
            });
        } else {
            runnable.run();
        }
    }

    private record BookingCreateState(String initialStatus, String approvalMode) {
    }
}
