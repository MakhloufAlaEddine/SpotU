# SLICE_30_CURSOR_IMPLEMENTATION_NOTES.md — Notes Java/Spring Boot
> Basé sur `booking_routes.py:115–382, 558–670`, règles BR-30.01 à BR-30.18, cas T30.
> Généré le 2026-04-20.
>
> ⚠️ **Reproduire 1:1 le comportement Python. Ne pas "améliorer".**

---

## 1. Structure Spring Boot

```
src/main/java/com/spotu/booking/create/
├── controller/
│   └── BookingCreateController.java         ← preview + request + pay
├── service/
│   ├── BookingPricingPreviewService.java    ← preview seul
│   ├── BookingCreateService.java            ← request (transaction)
│   └── BookingPayService.java               ← pay (Stripe + transaction post)
├── repository/
│   ├── BookingRepository.java
│   ├── PaymentRepository.java
│   ├── ServiceSlotRepository.java           ← LOCK NOWAIT
│   ├── ServiceRepository.java               ← SELECT config
│   ├── AppConfigRepository.java             ← flags
│   └── UserRepository.java                  ← name pour push
├── dto/
│   ├── PricePreviewRequest.java
│   ├── PricePreviewResponse.java
│   ├── BookingRequestDto.java
│   ├── BookingResponse.java
│   ├── PayBookingRequest.java
│   └── PayBookingResponse.java
├── pricing/                                  ← partagé avec slices futures
│   ├── PricingEngine.java
│   ├── PricingResult.java                    ← record avec to_snapshot/to_payment_dict
│   └── PricingRulesRepository.java
├── stripe/                                   ← partagé avec slices futures
│   └── StripeCheckoutClient.java             ← wrapper stripe-java
├── event/
│   └── BookingCreatedEvent.java              ← push post-commit
└── listener/
    └── BookingCreatedPushListener.java       ← @TransactionalEventListener AFTER_COMMIT
```

---

## 2. Controller

```java
@RestController
@RequestMapping("/api/bookings")
@RequiredArgsConstructor
public class BookingCreateController {

    private final BookingPricingPreviewService pricingPreviewService;
    private final BookingCreateService createService;
    private final BookingPayService payService;

    @PostMapping("/price-preview")
    public PricePreviewResponse pricePreview(
            @RequestBody PricePreviewRequest body,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return pricingPreviewService.preview(body.serviceId(), caller);
    }

    // Endpoint principal
    @PostMapping("/request")
    public BookingResponse requestBooking(
            @RequestBody BookingRequestDto body,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return createService.request(body, caller);
    }

    // Alias rétrocompat (même comportement)
    @PostMapping
    public BookingResponse createBookingAlias(
            @RequestBody BookingRequestDto body,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return createService.request(body, caller);
    }

    @PostMapping("/{bookingId}/pay")
    public PayBookingResponse pay(
            @PathVariable String bookingId,
            @RequestBody(required = false) PayBookingRequest body,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        String originUrl = body != null ? body.originUrl() : null;
        return payService.pay(bookingId, originUrl, caller);
    }
}
```

---

## 3. Service — BookingPricingPreviewService

```java
@Service
@RequiredArgsConstructor
public class BookingPricingPreviewService {

    private final ServiceRepository serviceRepo;
    private final PricingEngine pricingEngine;

    @Transactional(readOnly = true)
    public PricePreviewResponse preview(String serviceId, AuthenticatedUser caller) {
        if (serviceId == null || serviceId.isBlank()) {
            throw new BadRequestException("service_id requis");
        }
        ServicePreviewRow svc = serviceRepo.findForPreview(serviceId)
            .orElseThrow(() -> new NotFoundException("Service introuvable ou inactif"));

        PricingResult pricing = pricingEngine.computePricing(
            caller.userId(), svc.coachId(), "service_booking",
            svc.price(), "EUR"
        );

        PricingSnapshot snap = pricing.toSnapshot();
        return new PricePreviewResponse(
            snap.baseAmount(), snap.payerFixedFee(), snap.payerPercentFeeAmount(),
            snap.receiverFixedFee(), snap.receiverPercentFeeAmount(),
            snap.platformTotalFee(), snap.receiverNetAmount(), snap.payerTotalAmount(),
            snap.currency()
        );
    }
}
```

---

## 4. Service — BookingCreateService (le gros morceau)

```java
@Service
@RequiredArgsConstructor
public class BookingCreateService {

    private final ServiceRepository serviceRepo;
    private final AppConfigRepository appConfigRepo;
    private final BookingRepository bookingRepo;
    private final PaymentRepository paymentRepo;
    private final ServiceSlotRepository slotRepo;
    private final PricingEngine pricingEngine;
    private final ApplicationEventPublisher events;

    @Value("${booking.expiry.hours:48}")
    private int bookingExpiryHours;

    private static final int DEFAULT_PAY_NOW_CHECKOUT_MINUTES = 30;
    private static final int DEFAULT_PAY_LATER_MINUTES = 1440;

    public BookingResponse request(BookingRequestDto body, AuthenticatedUser caller) {
        // ── Validation input
        String paymentMode = StringUtils.stripToNull(body.paymentMode() != null ? body.paymentMode() : "pay_now");
        if (!"pay_now".equals(paymentMode) && !"pay_later".equals(paymentMode)) {
            throw new BadRequestException("payment_mode doit être 'pay_now' ou 'pay_later'");
        }

        // ── 1. Service config (hors transaction)
        ServiceConfigRow svc = serviceRepo.findForBookingRequest(body.serviceId())
            .orElseThrow(() -> new NotFoundException("Service introuvable ou inactif"));
        if (Objects.equals(svc.coachId(), caller.userId())) {
            throw new BadRequestException("Impossible de réserver son propre service");
        }

        // ── 2. Flags globaux
        Map<String,Boolean> cfg = appConfigRepo.getBooleanFlags(List.of(
            "enable_manual_approval_for_services",
            "enable_pay_later_for_services"
        ));
        boolean globalAllowManual = cfg.getOrDefault("enable_manual_approval_for_services", false);
        boolean globalAllowPayLater = cfg.getOrDefault("enable_pay_later_for_services", false);
        int payNowMinutes = appConfigRepo.getIntOrDefault("pay_now_checkout_minutes", DEFAULT_PAY_NOW_CHECKOUT_MINUTES);

        String approvalMode = svc.bookingApprovalMode() != null ? svc.bookingApprovalMode() : "manual_approval";
        boolean allowPayLater = Boolean.TRUE.equals(svc.allowPayLater());
        int expiryMinutes = svc.payLaterExpirationMinutes() != null ? svc.payLaterExpirationMinutes() : DEFAULT_PAY_LATER_MINUTES;

        // Normalisation par flags globaux
        if (!globalAllowManual) approvalMode = "instant_booking";
        if (!globalAllowPayLater) {
            allowPayLater = false;
            if ("pay_later".equals(paymentMode)) {
                throw new ConflictException("Le paiement différé n'est pas activé sur cette plateforme — veuillez choisir 'pay_now'");
            }
        }
        if ("pay_later".equals(paymentMode) && !allowPayLater) {
            throw new BadRequestException("Ce service ne permet pas le paiement différé");
        }

        // ── 3. Idempotence 1 : clé explicite (hors transaction)
        if (body.idempotencyKey() != null) {
            Optional<String> existing = bookingRepo.findByIdempotencyKey(body.idempotencyKey());
            if (existing.isPresent()) {
                return bookingRepo.fetchComplete(existing.get())
                    .orElseThrow(() -> new IllegalStateException("inconsistent idempotency"));
            }
        }

        // ── 4. Idempotence 2 : (slot_id, user_id) (hors transaction)
        if (body.slotId() != null) {
            Optional<String> dup = bookingRepo.findActiveBySlotAndUser(body.slotId(), caller.userId());
            if (dup.isPresent()) {
                return bookingRepo.fetchComplete(dup.get()).orElseThrow();
            }
        }

        // ── 5. Transaction : lock + pricing + INSERTs
        final String approvalModeFinal = approvalMode;
        final int expiryMinutesFinal = expiryMinutes;
        return executeTransactional(body, caller, svc, approvalModeFinal,
            paymentMode, payNowMinutes, expiryMinutesFinal);
    }

    @Transactional
    protected BookingResponse executeTransactional(
            BookingRequestDto body, AuthenticatedUser caller, ServiceConfigRow svc,
            String approvalMode, String paymentMode, int payNowMinutes, int expiryMinutes) {

        String slotType = null;
        if (body.slotId() != null) {
            SlotRow slot;
            try {
                slot = slotRepo.lockForUpdateNowait(body.slotId())
                    .orElseThrow(() -> new NotFoundException("Créneau introuvable"));
            } catch (CannotAcquireLockException | PessimisticLockingFailureException ex) {
                // PostgreSQL SQLState 55P03
                throw new ConflictException("Ce créneau est en cours de réservation — réessayez");
            }
            slotType = slot.slotType();
            if (("single".equals(slotType) || "specific".equals(slotType))
                && !"available".equals(slot.slotStatus())) {
                throw new ConflictException("Créneau indisponible (état : " + slot.slotStatus() + ")");
            }
        }

        PricingResult pricing = pricingEngine.computePricing(
            caller.userId(), svc.coachId(), "service_booking", svc.price(), "EUR"
        );

        String bid = IdGenerator.newId("bkg");
        String pid = IdGenerator.newId("pay");

        Instant now = Instant.now();
        String initialStatus;
        String initialSlotStatus;
        Instant expiresAt;
        if ("instant_booking".equals(approvalMode)) {
            initialStatus = "awaiting_payment";
            initialSlotStatus = "reserved";
            int mins = "pay_now".equals(paymentMode) ? payNowMinutes : expiryMinutes;
            expiresAt = now.plus(Duration.ofMinutes(mins));
        } else {
            initialStatus = "requested";
            initialSlotStatus = "pending";
            expiresAt = now.plus(Duration.ofHours(bookingExpiryHours));
        }

        bookingRepo.insertBooking(
            bid, body.serviceId(), caller.userId(), svc.coachId(), initialStatus,
            body.scheduledAt(), body.slotId(), body.locationId(), body.notes(),
            pricing.payerTotalAmount(), caller.userId(), svc.coachId(),
            pricing.toSnapshotJson(), body.idempotencyKey(), paymentMode, expiresAt
        );

        PaymentInsertRow pd = pricing.toPaymentRow(pid, caller.userId(), svc.coachId(),
            "service_booking", body.serviceId(), bid);
        paymentRepo.insertPayment(pd);  // status='requires_authorization'

        if (body.slotId() != null && ("single".equals(slotType) || "specific".equals(slotType))) {
            slotRepo.updateStatus(body.slotId(), initialSlotStatus);
        }

        // Event pour push (post-commit)
        events.publishEvent(new BookingCreatedEvent(
            bid, body.serviceId(), caller, svc.coachId(), initialStatus
        ));

        log.info("Booking créé : bk={} | approval={} | payment={} | status={} | expiry={}",
                 bid, approvalMode, paymentMode, initialStatus,
                 "instant_booking".equals(approvalMode) ? 
                   (("pay_now".equals(paymentMode) ? payNowMinutes : expiryMinutes) + " minutes") :
                   (bookingExpiryHours + " hours"));

        return bookingRepo.fetchComplete(bid).orElseThrow();
    }
}
```

### Lock NOWAIT — repository

```java
@Repository
public interface ServiceSlotRepository {

    /**
     * SELECT ... FOR UPDATE NOWAIT. Throw CannotAcquireLockException si déjà locké.
     * Spring JPA mappe SQLState 55P03 automatiquement.
     */
    @Query(value = """
        SELECT slot_id AS slotId, slot_type AS slotType, slot_status AS slotStatus
          FROM service_slots
         WHERE slot_id = :slotId
           FOR UPDATE NOWAIT
    """, nativeQuery = true)
    Optional<SlotRow> lockForUpdateNowait(@Param("slotId") String slotId);

    @Modifying
    @Query(value = """
        UPDATE service_slots SET slot_status = :status WHERE slot_id = :slotId
    """, nativeQuery = true)
    int updateStatus(@Param("slotId") String slotId, @Param("status") String status);
}
```

---

## 5. Service — BookingPayService

```java
@Service
@RequiredArgsConstructor
public class BookingPayService {

    private final BookingRepository bookingRepo;
    private final PaymentRepository paymentRepo;
    private final StripeCheckoutClient stripe;

    @Value("${app.url:}")
    private String appUrlDefault;

    public PayBookingResponse pay(String bookingId, String originUrlInput, AuthenticatedUser caller) {
        String originUrl = (originUrlInput != null && !originUrlInput.isEmpty())
                           ? originUrlInput : appUrlDefault;

        // ── Guards (hors transaction, read-only)
        BookingPayGuardRow bk = bookingRepo.findForPayGuard(bookingId)
            .orElseThrow(() -> new NotFoundException("Réservation introuvable"));

        String effectivePayer = bk.payerUserId() != null ? bk.payerUserId() : bk.userId();
        if (!Objects.equals(effectivePayer, caller.userId()) && !"admin".equals(caller.role())) {
            throw new ForbiddenException("Seul le payeur peut initier le paiement");
        }

        if (!"awaiting_payment".equals(bk.status())) {
            throw new ConflictException(
                "Le paiement n'est disponible que pour les réservations en attente de paiement (statut actuel : '" + bk.status() + "')"
            );
        }
        if (bk.expiresAt() != null && bk.expiresAt().isBefore(Instant.now())) {
            throw new GoneException("Le délai de paiement a expiré — réservation annulée");
        }

        PaymentForPayRow pay = paymentRepo.findByBookingForPay(bookingId)
            .orElseThrow(() -> new InternalServerException("Enregistrement de paiement manquant pour cette réservation"));

        // ── Idempotence Stripe
        if (pay.stripeCheckoutSessionId() != null) {
            try {
                var existing = stripe.retrieveCheckoutSession(pay.stripeCheckoutSessionId());
                if ("open".equals(existing.getStatus())) {
                    return new PayBookingResponse(
                        existing.getUrl(), existing.getUrl(), existing.getId(), true
                    );
                }
            } catch (StripeException ignored) { /* silent fallback */ }
        }

        // ── Création session Stripe (hors transaction DB)
        long amountCents = pay.payerTotalAmount()
            .multiply(new BigDecimal("100"))
            .setScale(0, RoundingMode.HALF_UP)
            .longValueExact();
        String currency = (pay.currency() != null ? pay.currency() : "eur").toLowerCase(Locale.ROOT);
        String successUrl = originUrl + "/payment-success?session_id={CHECKOUT_SESSION_ID}&booking_id=" + bookingId;
        String cancelUrl = originUrl + "/bookings";

        var session = stripe.createCheckoutSession(
            amountCents, currency, successUrl, cancelUrl,
            Map.of("payment_id", pay.paymentId(), "booking_id", bookingId),
            pay.paymentId()  // idempotency_key
        );

        String piId = session.getPaymentIntent();  // Stripe: string ou null (objet expanded, pas notre cas)
        updatePayAndBooking(pay.paymentId(), bookingId, session.getId(), piId);

        return new PayBookingResponse(session.getUrl(), session.getUrl(), session.getId(), null);
    }

    @Transactional
    protected void updatePayAndBooking(String paymentId, String bookingId, String sessionId, String piId) {
        paymentRepo.updateStripeRefsAndStatus(sessionId, piId, paymentId);
        bookingRepo.updatePaymentStatusIfNotPaid(bookingId);
    }
}
```

### Repository payments (pay)

```java
@Query(value = """
    UPDATE payments
       SET stripe_checkout_session_id = :sessionId,
           stripe_payment_intent_id   = COALESCE(:piId, stripe_payment_intent_id),
           status                      = CASE
                WHEN status NOT IN ('requires_authorization','authorized','captured')
                  THEN 'requires_authorization' ELSE status END,
           updated_at                  = NOW()
     WHERE payment_id = :paymentId
""", nativeQuery = true)
@Modifying
int updateStripeRefsAndStatus(@Param("sessionId") String sessionId,
                               @Param("piId") String piId,
                               @Param("paymentId") String paymentId);
```

---

## 6. DTOs — JSON strict

### PayBookingResponse (avec optionnel `reused`)

```java
@JsonPropertyOrder({"url","checkout_url","session_id","reused"})
public record PayBookingResponse(
    String url,
    @JsonProperty("checkout_url") String checkoutUrl,
    @JsonProperty("session_id") String sessionId,
    @JsonInclude(JsonInclude.Include.NON_NULL) Boolean reused
) {}
```

> `@JsonInclude(NON_NULL)` pour que `"reused"` disparaisse du JSON quand c'est une création (valeur `null`).

### BookingResponse (projection complète)

Ordre des champs à préserver (cf. SLICE_30_API_CONTRACTS.md §Endpoint 2 Réponse 200).

---

## 7. Stripe Client

```java
@Component
@RequiredArgsConstructor
public class StripeCheckoutClient {

    @Value("${stripe.api.key}")
    private String stripeApiKey;

    @PostConstruct
    void init() {
        Stripe.apiKey = stripeApiKey;
    }

    public Session createCheckoutSession(
            long amountCents, String currency, String successUrl, String cancelUrl,
            Map<String,String> metadata, String idempotencyKey) throws StripeException {

        SessionCreateParams params = SessionCreateParams.builder()
            .setMode(SessionCreateParams.Mode.PAYMENT)
            .addLineItem(SessionCreateParams.LineItem.builder()
                .setQuantity(1L)
                .setPriceData(SessionCreateParams.LineItem.PriceData.builder()
                    .setCurrency(currency)
                    .setUnitAmount(amountCents)
                    .setProductData(SessionCreateParams.LineItem.PriceData.ProductData.builder()
                        .setName("SpotU booking")   // ⚠️ vérifier le name exact utilisé par Python
                        .build())
                    .build())
                .build())
            .setSuccessUrl(successUrl)
            .setCancelUrl(cancelUrl)
            .putAllMetadata(metadata)
            .build();

        RequestOptions opts = RequestOptions.builder()
            .setIdempotencyKey(idempotencyKey)
            .build();

        return Session.create(params, opts);
    }

    public Session retrieveCheckoutSession(String sessionId) throws StripeException {
        return Session.retrieve(sessionId);
    }
}
```

> ⚠️ **À VÉRIFIER** dans `stripe_service.py:292` : nom du produit, quantité, mode exact, line items construits identiquement. Ne pas diverger.

---

## 8. Transactions — résumé

| Endpoint | Scope `@Transactional` | Appels externes |
|---|---|---|
| preview | `readOnly=true` | aucun |
| request | Transaction autour du lock + INSERTs uniquement (§4 `executeTransactional`). Idempotence checks **hors** tx. | aucun (Stripe pas appelé) |
| pay | Transaction UNIQUEMENT autour des 2 UPDATE post-Stripe (§5 `updatePayAndBooking`). Appel Stripe **hors** tx. Guards read-only **hors** tx. | Stripe `retrieveCheckoutSession` + `createCheckoutSession` |

---

## 9. Events & Listener

```java
public record BookingCreatedEvent(
    String bookingId,
    String serviceId,
    AuthenticatedUser payer,
    String receiverUserId,
    String initialStatus   // "awaiting_payment" | "requested"
) {}
```

```java
@Component
@RequiredArgsConstructor
public class BookingCreatedPushListener {

    private final PushService pushService;
    private final UserRepository userRepo;
    private final ServiceRepository serviceRepo;

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onBookingCreated(BookingCreatedEvent e) {
        String userName = userRepo.findNameById(e.payer().userId()).orElse("Un utilisateur");
        String svcName  = serviceRepo.findTitleById(e.serviceId()).orElse("votre service");

        boolean isAwaiting = "awaiting_payment".equals(e.initialStatus());
        String title = isAwaiting ? "Créneau réservé (paiement en attente)" : "Nouvelle demande de réservation";
        String body  = isAwaiting
            ? userName + " a réservé un créneau : " + svcName
            : userName + " souhaite réserver : " + svcName;
        String dataType = isAwaiting ? "booking_awaiting_payment" : "new_booking";

        Map<String,Object> data = new LinkedHashMap<>();
        data.put("type", dataType);
        data.put("bookingId", e.bookingId());
        data.put("service_id", e.serviceId());
        data.put("sender_id", e.payer().userId());
        data.put("sender_name", e.payer().name() != null ? e.payer().name() : "");

        pushService.sendPushToUser(e.receiverUserId(), title, body, data, "new_booking");
    }
}
```

---

## 10. Exceptions → HTTP

```java
@ControllerAdvice
public class BookingExceptionHandler {
    @ExceptionHandler(BadRequestException.class)
    public ResponseEntity<Map<String,String>> badRequest(BadRequestException e) {
        return ResponseEntity.status(400).body(Map.of("detail", e.getMessage()));
    }
    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<Map<String,String>> notFound(NotFoundException e) {
        return ResponseEntity.status(404).body(Map.of("detail", e.getMessage()));
    }
    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<Map<String,String>> forbidden(ForbiddenException e) {
        return ResponseEntity.status(403).body(Map.of("detail", e.getMessage()));
    }
    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<Map<String,String>> conflict(ConflictException e) {
        return ResponseEntity.status(409).body(Map.of("detail", e.getMessage()));
    }
    @ExceptionHandler(GoneException.class)
    public ResponseEntity<Map<String,String>> gone(GoneException e) {
        return ResponseEntity.status(410).body(Map.of("detail", e.getMessage()));
    }
    @ExceptionHandler(InternalServerException.class)
    public ResponseEntity<Map<String,String>> internal(InternalServerException e) {
        return ResponseEntity.status(500).body(Map.of("detail", e.getMessage()));
    }
}
```

---

## 11. Pricing engine — interface attendue

```java
public interface PricingEngine {
    PricingResult computePricing(
        String payerUserId,
        String receiverUserId,
        String productType,     // "service_booking"
        BigDecimal baseAmount,
        String currency         // "EUR"
    );
}

public record PricingResult(
    String productType,
    BigDecimal baseAmount,
    BigDecimal payerFixedFee,
    BigDecimal payerPercentFeeAmount,
    BigDecimal receiverFixedFee,
    BigDecimal receiverPercentFeeAmount,
    BigDecimal platformTotalFee,
    BigDecimal receiverNetAmount,
    BigDecimal payerTotalAmount,
    String currency,
    Map<String,Object> ruleSnapshot   // règle DB utilisée
) {
    public PricingSnapshot toSnapshot() { ... }
    public String toSnapshotJson() { ... }  // json.dumps équivalent
    public PaymentInsertRow toPaymentRow(String paymentId, String payerId, String receiverId,
                                          String productType, String productId, String bookingId) { ... }
}
```

> **À implémenter dans slice séparée** ou au même moment. Le scope exact du `PricingEngine` n'est PAS dans cette slice mais **son API doit être stable** avant la livraison de S30.

---

## 12. Intégration externe — Stripe

### Dépendance Maven
```xml
<dependency>
  <groupId>com.stripe</groupId>
  <artifactId>stripe-java</artifactId>
  <version>28.0.0</version>  <!-- dernière stable, vérifier au moment impl -->
</dependency>
```

### Config
```properties
# application.yml
stripe.api.key=${STRIPE_API_KEY}
app.url=${APP_URL:}
booking.expiry.hours=${BOOKING_EXPIRY_HOURS:48}
```

### Clé test
Fournie par Emergent (voir pod env). Format `sk_test_...`.

### Mode Stripe
`SessionCreateParams.Mode.PAYMENT` — le flow auth-then-capture se fait via le webhook + `/bookings/{id}/accept` (slice ultérieure). Ici on crée juste la session.

---

## 13. Pièges à éviter

| # | Piège | Mitigation |
|---|---|---|
| 1 | Mettre toute la logique Stripe + DB dans un `@Transactional` | Séparer : guards read-only → Stripe call hors tx → UPDATE tx courte |
| 2 | Utiliser `JPA @Version` pour concurrence au lieu de `FOR UPDATE NOWAIT` | Compat stricte = pessimistic lock. Pas d'optimistic. |
| 3 | Mapper `LockNotAvailable` (55P03) en 500 au lieu de 409 | Catch `CannotAcquireLockException` explicit + throw `ConflictException` |
| 4 | Pydantic default `payment_mode='pay_now'` → Java `null` non mappé | Dans DTO : `paymentMode` + défaut dans service : `paymentMode != null ? paymentMode : "pay_now"` |
| 5 | Sérialiser BigDecimal en scientific notation (e.g. `5.175E+1`) | Utiliser ObjectMapper avec `.setNumberFormat` ou `@JsonFormat(shape=STRING)` puis conversion front |
| 6 | Encoder `{CHECKOUT_SESSION_ID}` en URL | Passer la string EXACTE à Stripe, pas de URLEncoder |
| 7 | Amount en euros au lieu de cents à Stripe | `×100` + `setScale(0,HALF_UP)` |
| 8 | Garder `currency` uppercase | `.toLowerCase()` avant Stripe |
| 9 | Oublier `COALESCE` sur `stripe_payment_intent_id` | SQL UPDATE exact du §5 |
| 10 | Retourner `reused: false` en nominal | `reused=null` + `@JsonInclude(NON_NULL)` pour que la clé disparaisse |
| 11 | Ne pas tester les 4 flux ABCD séparément | Tests unitaires T30-REQ-01..04 obligatoires |
| 12 | Flags globaux : `'true'`/`'false'` string comparé avec `== Boolean.TRUE` | `"true".equals(value)` pour match bit-pour-bit |
| 13 | Push envoyé sur rollback | `@TransactionalEventListener(AFTER_COMMIT)` + `@Async` |
| 14 | Idempotence `(slot_id, user_id)` : ne pas filtrer sur `status NOT IN (refused, cancelled, expired)` | Le SQL doit exclure ces 3 status |
| 15 | Rounding amount_cents avec HALF_EVEN au lieu de HALF_UP | Python `round()` est HALF_EVEN (banker's) — **tester explicitement** et choisir ce qui matche le Python en pratique |

---

## 14. Critères de Done

| # | Critère | Test |
|---|---|---|
| 1 | 3 endpoints exposés (preview, request, alias, pay) — 4 routes | curl chaque |
| 2 | 4 flux ABCD couverts (matrice BR-30.02) | T30-REQ-01..04 |
| 3 | Triple idempotence (key, slot×user, Stripe session) | T30-REQ-07,08 ; T30-PAY-02 |
| 4 | Lock NOWAIT → 409 | T30-REQ-14 |
| 5 | Ordre strict 404→409→403 (pay) | T30-PAY-08,09,10 |
| 6 | 410 Gone sur expires_at | T30-PAY-11 |
| 7 | Flags globaux normalisent approval_mode et bloquent pay_later | T30-REQ-13, T30-REQ-18 |
| 8 | Payload Stripe correct (cents, currency lowercase, metadata, idempotency_key) | T30-PAY-01 |
| 9 | `url` et `checkout_url` dupliqués | T30-COMPAT-02 |
| 10 | `reused: true` uniquement en idempotent | T30-COMPAT-02 |
| 11 | `success_url` avec token `{CHECKOUT_SESSION_ID}` non-encodé | T30-COMPAT-06 |
| 12 | `payment_status='pending'` et `currency='EUR'` littéraux à l'INSERT booking | T30-REQ-01 assertions DB |
| 13 | Push AFTER_COMMIT uniquement | Test rollback mi-transaction |
| 14 | Messages erreur bit-pour-bit | T30-COMPAT-01 |
| 15 | Compat pricing_snapshot JSONB | JSONAssert STRICT |

---

## 15. Validation finale

- [ ] 45 cas de test passent (SLICE_30_TEST_CASES.md)
- [ ] Pricing engine Java aligné sur Python (hors périmètre mais **prérequis**)
- [ ] Stripe test-key utilisée en staging
- [ ] Tests concurrence (ex: 100 parallel POST /request même slot) → 1 succès, 99 erreurs 409
- [ ] Webhook Stripe (hors scope) n'est PAS cassé par cette migration
- [ ] Les endpoints Python `/bookings/{id}/accept`, `/refuse`, `/cancel` continuent de fonctionner même si S30 est migrée en Java (phase de dual-run)
- [ ] Documentation OpenAPI générée conforme à SLICE_30_API_CONTRACTS.md
