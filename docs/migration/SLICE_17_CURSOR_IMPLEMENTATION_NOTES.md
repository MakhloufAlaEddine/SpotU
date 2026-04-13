# SLICE_17_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation pour Cursor
> Slice 17 : `POST /payments/checkout/session` + `GET /payments/checkout/status/{sessionId}`
> Source : `payment_routes.py:83–351`.
> Généré le 2026-02-XX.

---

## Architecture recommandée

```
CheckoutController
  ├─ POST /payments/checkout/session
  │    └─ CheckoutService.createSession(bookingId, originUrl, userId)
  │         ├─ PaymentRepository.findForCheckout(bookingId, userId)
  │         ├─ [idempotence] StripeService.retrieveCheckoutSession(existingSessionId)
  │         ├─ StripeService.createCheckoutSession(...)
  │         └─ PaymentRepository.updateAfterSessionCreation(paymentId, sessionId, piId, bookingId)
  │
  └─ GET /payments/checkout/status/{sessionId}
       └─ CheckoutService.getStatus(sessionId)
            ├─ PaymentRepository.findBySessionOrIntentId(sessionId)
            ├─ StripeService.retrieveCheckoutSession(realSessionId)
            ├─ BookingRepository.findStatusById(bookingId)      [conditionnel]
            ├─ [branches A/B/C/D] PaymentRepository.update*(...)
            └─ [branche A instant] PushService.sendAsync(...)
```

---

## Controller

### Fichier suggéré

`CheckoutController.java`

```java
@RestController
@RequestMapping("/payments")
public class CheckoutController {

    @Autowired private CheckoutService checkoutService;
    @Autowired private AuthService authService;

    // ── POST /payments/checkout/session ──────────────────────────────────────
    @PostMapping("/checkout/session")
    public ResponseEntity<Map<String, Object>> createSession(
        @RequestBody CheckoutSessionRequest body,
        HttpServletRequest request) {

        AuthUser user = authService.requireAuth(request);  // 401 si absent
        return ResponseEntity.ok(
            checkoutService.createSession(body.getBookingId(), body.getOriginUrl(), user.getUserId())
        );
    }

    // ── GET /payments/checkout/status/{sessionId} ─────────────────────────────
    @GetMapping("/checkout/status/{sessionId}")
    public ResponseEntity<Map<String, Object>> getStatus(
        @PathVariable String sessionId,
        HttpServletRequest request) {

        // Auth optionnelle — ne jamais bloquer
        // (pas de user passé au service)
        return ResponseEntity.ok(checkoutService.getStatus(sessionId));
    }
}
```

### Modèle body POST

```java
public class CheckoutSessionRequest {
    @JsonProperty("booking_id")
    @NotBlank
    private String bookingId;

    @JsonProperty("origin_url")
    private String originUrl = "";  // défaut ""
}
```

---

## Service

### `CheckoutService.createSession`

```java
@Service
public class CheckoutService {

    @Autowired private PaymentRepository paymentRepo;
    @Autowired private StripeService stripeService;

    public Map<String, Object> createSession(String bookingId, String originUrl, String userId) {

        // ── 1. Validation ─────────────────────────────────────────────────────
        if (bookingId == null || bookingId.isBlank()) {
            throw new BadRequestException("booking_id requis");
        }

        // ── 2. Lecture payment (payer check implicite dans WHERE) ─────────────
        // ⚠️ 404 si pas payer — pas 403
        PaymentCheckoutView payment = paymentRepo.findForCheckout(bookingId, userId);
        if (payment == null) throw new NotFoundException("Paiement non trouvé");

        // ── 3. Guard captured ─────────────────────────────────────────────────
        if ("captured".equals(payment.getStatus())) {
            throw new BadRequestException("Ce paiement est déjà complété");
        }

        // ── 4. Idempotence : session open existante ───────────────────────────
        if (payment.getStripeCheckoutSessionId() != null) {
            try {
                Session existing = stripeService.retrieveCheckoutSession(
                    payment.getStripeCheckoutSessionId());
                if ("open".equals(existing.getStatus())) {
                    return Map.of("url", existing.getUrl(), "session_id", existing.getId());
                }
            } catch (Exception e) {
                log.warn("Impossible de récupérer la session existante : {}", e.getMessage());
                // Continuer vers création nouvelle session
            }
        }

        // ── 5. Calcul montant (JAMAIS recalculer) ─────────────────────────────
        long amountCents = Math.round(payment.getPayerTotalAmount().doubleValue() * 100);
        String currency  = payment.getCurrency() != null ? payment.getCurrency().toLowerCase() : "eur";
        String paymentId = payment.getPaymentId();

        // ── 6. URLs de redirection ─────────────────────────────────────────────
        String base       = originUrl != null ? originUrl.stripTrailing() : "";
        // ⚠️ {CHECKOUT_SESSION_ID} = placeholder Stripe — ne pas interpoler
        String successUrl = base + "/payment-success?session_id={CHECKOUT_SESSION_ID}&booking_id=" + bookingId;
        String cancelUrl  = base + "/booking/confirm?serviceId=" + (payment.getProductId() != null ? payment.getProductId() : "");

        // ── 7. Metadata Stripe ────────────────────────────────────────────────
        Map<String, String> meta = Map.of(
            "payment_id",    paymentId,
            "booking_id",    bookingId,
            "payer_user_id", userId
        );

        // ── 8. Création session Stripe ────────────────────────────────────────
        Session session = stripeService.createCheckoutSession(
            amountCents, currency, successUrl, cancelUrl, meta,
            "cs_" + paymentId  // idempotency_key
        );

        // ── 9. Type check payment_intent ──────────────────────────────────────
        // ⚠️ payment_intent peut être String ou objet selon expand
        String piId = null;
        if (session.getPaymentIntent() instanceof String) {
            piId = (String) session.getPaymentIntent();
        }

        // ── 10. UPDATE DB (transaction) ───────────────────────────────────────
        paymentRepo.updateAfterSessionCreation(paymentId, session.getId(), piId, bookingId);

        return Map.of("url", session.getUrl(), "session_id", session.getId());
    }
```

---

### `CheckoutService.getStatus`

```java
    public Map<String, Object> getStatus(String sessionId) {

        // ── 1. Lookup double clé ──────────────────────────────────────────────
        PaymentCheckoutView payment = paymentRepo.findBySessionOrIntentId(sessionId);
        if (payment == null) throw new NotFoundException("Session de paiement non trouvée");

        // ── 2. Retrieve session Stripe ────────────────────────────────────────
        String realSessionId = payment.getStripeCheckoutSessionId() != null
            ? payment.getStripeCheckoutSessionId()
            : sessionId;

        Session session;
        try {
            session = stripeService.retrieveCheckoutSession(realSessionId);
        } catch (Exception e) {
            // ⚠️ Graceful — retourner données DB avec status="unknown"
            log.warn("Impossible de récupérer session Stripe {} : {}", realSessionId, e.getMessage());
            return buildUnknownResponse(payment, sessionId);
        }

        // ── 3. Variables Stripe ───────────────────────────────────────────────
        String sStatus  = session.getStatus();         // open / complete / expired
        String stripePs = session.getPaymentStatus();  // paid / unpaid / no_payment_required
        String dbStatus = payment.getStatus();

        // ── 4. Branches de transition ─────────────────────────────────────────
        if ("complete".equals(sStatus) && "unpaid".equals(stripePs)) {
            if (!List.of("authorized","captured","paid").contains(dbStatus)) {
                // Lire booking.status (SELECT obligatoire)
                String bookingStatus = bookingRepo.findStatusById(payment.getBookingId());

                if ("awaiting_payment".equals(bookingStatus)) {
                    // Branche A : instant_booking → captured + confirmed
                    paymentRepo.transitionToCaptured(payment.getPaymentId(), payment.getBookingId());
                    dbStatus = "captured";
                    // Push uniquement branche A
                    pushService.sendAsync(payment.getPayerUserId(), "Réservation confirmée !", ...);
                    pushService.sendAsync(payment.getReceiverUserId(), "Nouvelle réservation !", ...);
                } else {
                    // Branche B : manual_approval → authorized
                    paymentRepo.transitionToAuthorized(payment.getPaymentId(), payment.getBookingId());
                    dbStatus = "authorized";
                }
            }
        } else if ("paid".equals(stripePs) && !"captured".equals(dbStatus)) {
            // Branche C : paid direct → captured + confirmed
            paymentRepo.transitionToCaptured(payment.getPaymentId(), payment.getBookingId());
            dbStatus = "captured";
        } else if ("expired".equals(sStatus) && "authorized".equals(dbStatus)) {
            // Branche D : session expirée → cancelled
            paymentRepo.transitionToCancelled(payment.getPaymentId());
            dbStatus = "cancelled";
        }

        // ── 5. Réponse ────────────────────────────────────────────────────────
        double amount = session.getAmountTotal() != null
            ? session.getAmountTotal() / 100.0
            : payment.getPayerTotalAmount().doubleValue();
        String currency = session.getCurrency() != null ? session.getCurrency() : payment.getCurrency();

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("payment_id",     payment.getPaymentId());
        response.put("booking_id",     payment.getBookingId());
        response.put("session_id",     sessionId);
        response.put("status",         sStatus);
        response.put("payment_status", dbStatus);
        response.put("stripe_status",  stripePs);
        response.put("amount",         amount);
        response.put("currency",       currency);
        return response;
    }
```

---

## Repository

### Fichier suggéré

`PaymentCheckoutRepository.java`

#### `findForCheckout`

```java
// payment_routes.py:106–112
// SELECT p.*, b.service_id FROM payments p
// LEFT JOIN bookings b ON b.booking_id = p.booking_id
// WHERE p.booking_id=$1 AND p.payer_user_id=$2
PaymentCheckoutView findForCheckout(String bookingId, String userId);
// null si non trouvé → 404 dans le service
```

#### `updateAfterSessionCreation` (transaction)

```java
// payment_routes.py:165–191
// BEGIN;
//   UPDATE payments SET stripe_checkout_session_id=$1, stripe_payment_intent_id=$2,
//     status = CASE WHEN status NOT IN ('requires_authorization','authorized','captured')
//              THEN 'requires_authorization' ELSE status END,
//     updated_at=NOW() WHERE payment_id=$3;
//   UPDATE bookings SET payment_status = CASE WHEN payment_status NOT IN (...)
//     THEN 'requires_authorization' ELSE payment_status END,
//     updated_at=NOW() WHERE booking_id=$4;
// COMMIT;
@Transactional
void updateAfterSessionCreation(String paymentId, String sessionId, String piId, String bookingId);
// ⚠️ piId peut être NULL — utiliser nullable parameter
```

#### `findBySessionOrIntentId`

```java
// payment_routes.py:210–217
// SELECT * FROM payments
// WHERE stripe_checkout_session_id=$1 OR stripe_payment_intent_id=$1 LIMIT 1
PaymentCheckoutView findBySessionOrIntentId(String sessionOrIntentId);
```

#### `transitionToCaptured` (transaction — branche A + C)

```java
// payment_routes.py:259–271 + 317–329
// BEGIN;
//   UPDATE payments SET status='captured', updated_at=NOW() WHERE payment_id=$1;
//   UPDATE bookings SET status='confirmed', payment_status='paid', updated_at=NOW()
//     WHERE booking_id=$1 AND status NOT IN ('confirmed','refused','cancelled','expired');
// COMMIT;
@Transactional
void transitionToCaptured(String paymentId, String bookingId);
```

#### `transitionToAuthorized` (transaction — branche B)

```java
// payment_routes.py:303–311
// BEGIN;
//   UPDATE payments SET status='authorized', updated_at=NOW() WHERE payment_id=$1;
//   UPDATE bookings SET payment_status='authorized', updated_at=NOW() WHERE booking_id=$1;
// COMMIT;
@Transactional
void transitionToAuthorized(String paymentId, String bookingId);
```

#### `transitionToCancelled` (PAS de transaction — branche D)

```java
// payment_routes.py:332–336
// UPDATE payments SET status='cancelled', updated_at=NOW() WHERE payment_id=$1
// (pas de guard, pas de transaction)
void transitionToCancelled(String paymentId);
```

---

## Projection `PaymentCheckoutView`

```java
public class PaymentCheckoutView {
    private String paymentId;
    private String status;
    private BigDecimal payerTotalAmount;    // montant snapshot
    private String currency;
    private String bookingId;
    private String productId;              // pour cancel_url
    private String stripeCheckoutSessionId;
    private String stripePaymentIntentId;
    private String payerUserId;            // pour push
    private String receiverUserId;         // pour push
    // service_id présent dans SELECT mais non utilisé
}
```

---

## Intégration Stripe SDK Java

```java
// POST checkout/session : stripe_service.py:292–346
Session session = Session.create(
    SessionCreateParams.builder()
        .addLineItem(SessionCreateParams.LineItem.builder()
            .setPriceData(...)
            .setQuantity(1L)
            .build())
        .setMode(SessionCreateParams.Mode.PAYMENT)
        .setPaymentIntentData(
            SessionCreateParams.PaymentIntentData.builder()
                .setCaptureMethod(SessionCreateParams.PaymentIntentData.CaptureMethod.MANUAL)
                .putAllMetadata(meta)
                .build())
        .setSuccessUrl(successUrl)
        .setCancelUrl(cancelUrl)
        .putAllMetadata(meta)
        .build(),
    RequestOptions.builder().setIdempotencyKey("cs_" + paymentId).build()
);

// GET checkout/status : stripe_service.py:349–351
Session session = Session.retrieve(realSessionId);
```

---

## Critères de done (Definition of Done)

| # | Critère | Test |
|---|---|---|
| D1 | POST crée session + URLs correctes | TC-01 |
| D2 | POST idempotence session open | TC-02 |
| D3 | POST recréation si session expirée | TC-03 |
| D4 | POST guard captured → 400 | TC-04 |
| D5 | POST 404 si pas payer (pas 403) | TC-06 |
| D6 | POST `payment_intent` non-string → NULL | TC-08 |
| D7 | POST CASE idempotent si webhook déjà passé | TC-10 |
| D8 | GET instant_booking → captured + confirmed + push | TC-11 |
| D9 | GET manual → authorized, pas de push | TC-12 |
| D10 | GET idempotence si déjà captured | TC-16 |
| D11 | GET Stripe injoignable → "unknown" + 200 | TC-17 |
| D12 | GET lookup via pi_xxx | TC-18 |
| D13 | GET sans token (auth optionnelle) | TC-20 |
| D14 | GET `real_session_id` depuis DB (pas le param) | TC-18 |
| D15 | `{{CHECKOUT_SESSION_ID}}` littéral dans success_url | TC-09 |

---

## Relation avec les Slices précédentes

| Slice | Relation |
|---|---|
| S13 `/accept` Cas B | Crée un booking `awaiting_payment` → **Slice 17 POST** crée la session pour le payer |
| S16 webhook | Traite `checkout.session.completed` de façon asynchrone — **Slice 17 GET** est le pendant synchrone |
| S16 `payment_intent.succeeded` | Stocke `stripe_charge_id` — Slice 17 ne le fait pas |
| **S18** | Lecture payments (`GET /payments/me`, `GET /payments/{id}`) |
