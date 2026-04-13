# SLICE_16_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation pour Cursor
> Slice 16 : `POST /api/webhook/stripe` (paiements uniquement)
> Sources : `payment_routes.py:354–405`, `webhook_handlers.py:1–583`, `webhook_handlers.py:951–1071`.
> Généré le 2026-02-XX.

---

## Architecture recommandée

```
StripeWebhookController           ← POST /api/webhook/stripe
  └─ StripeWebhookService.dispatch(eventId, eventType, obj)
       ├─ WebhookEventRepository.claimEvent(eventId, eventType)  → INSERT ON CONFLICT
       ├─ PaymentResolver.resolvePaymentId(eventType, obj)        → 4 fallbacks
       ├─ [if _PAYMENT_EVENTS]  PaymentEventHandler.handle(...)
       ├─ [if _CHARGE_EVENTS]   ChargeEventHandler.handle(...)
       ├─ [if _SUBSCRIPTION_EVENTS] SubscriptionEventHandler (Slice 18)
       ├─ WebhookEventRepository.markDone(eventId, status, relatedId)
       └─ [async] NotificationService.sendPending(pendingNotifs)
```

---

## Controller

### Fichier suggéré

`StripeWebhookController.java`

### Point d'attention CRITIQUE — Body raw bytes

```java
@PostMapping(
    value = "/webhook/stripe",
    consumes = MediaType.APPLICATION_JSON_VALUE
)
@ResponseStatus(HttpStatus.OK)
public ResponseEntity<Map<String, Object>> stripeWebhook(
    HttpServletRequest request) {

    // ⚠️ CRITIQUE : lire le body EN BYTES avant tout parsing
    // Spring Boot NE DOIT PAS auto-parse ce body
    byte[] bodyBytes;
    try {
        bodyBytes = request.getInputStream().readAllBytes();
    } catch (IOException e) {
        return ResponseEntity.badRequest().body(Map.of("detail", "Body invalide"));
    }

    String sig = request.getHeader("Stripe-Signature");
    return ResponseEntity.ok(stripeWebhookService.process(bodyBytes, sig));
}
```

> ⚠️ **CRITIQUE** : désactiver le `HttpMessageConverter` JSON pour ce path,
> ou utiliser `HttpServletRequest.getInputStream()` directement.
> Si Spring parse le body avant, la signature HMAC est invalide.

### Configuration Spring à ajouter

```java
// Dans WebMvcConfig ou SecurityConfig
// Exclure /api/webhook/stripe de l'auto-parsing JSON
// OU configurer un filtre pour lire et stocker les raw bytes
```

---

## Service principal

### Fichier suggéré

`StripeWebhookService.java`

```java
@Service
public class StripeWebhookService {

    @Value("${stripe.webhook.secret:}") // vide = mode dev
    private String webhookSecret;

    @Autowired private WebhookEventRepository webhookRepo;
    @Autowired private PaymentResolver paymentResolver;
    @Autowired private PaymentEventHandler paymentHandler;
    @Autowired private ChargeEventHandler chargeHandler;
    @Autowired private NotificationService notificationService;

    public Map<String, Object> process(byte[] bodyBytes, String sig) {

        // ── 1. Vérification signature ─────────────────────────────────────
        StripeEvent event;
        if (webhookSecret != null && !webhookSecret.isEmpty()) {
            try {
                event = Webhook.constructEvent(
                    new String(bodyBytes, StandardCharsets.UTF_8), sig, webhookSecret
                );
            } catch (SignatureVerificationException e) {
                throw new BadRequestException("Signature invalide : " + e.getMessage());
            }
        } else {
            // Mode dev : parse JSON brut
            try {
                event = parseRawJson(bodyBytes);
            } catch (Exception e) {
                throw new BadRequestException("Body JSON invalide");
            }
        }

        String eventId   = event.getId();
        String eventType = event.getType();
        Object obj       = event.getData().getObject();

        if (eventId == null || eventType == null) {
            throw new BadRequestException("event id/type manquant");
        }

        // ── 2. Dispatch (toujours retourner 200 après ce point) ───────────
        return dispatch(eventId, eventType, obj);
    }

    public Map<String, Object> dispatch(String eventId, String eventType, Object obj) {
        List<Map<String, Object>> pendingNotifs = new ArrayList<>();
        String relatedId = null;

        try {
            // ── 2a. Idempotence ────────────────────────────────────────────
            boolean isNew = webhookRepo.claimEvent(eventId, eventType);
            if (!isNew) {
                return Map.of("received", true, "idempotent_skip", true);
            }

            // ── 2b. Résolution payment_id ──────────────────────────────────
            PaymentRef ref = paymentResolver.resolve(eventType, obj);
            relatedId = ref.getPaymentId();

            // ── 2c. Dispatch handlers ──────────────────────────────────────
            if (CHARGE_EVENTS.contains(eventType)) {
                chargeHandler.handle(eventType, obj, ref.getPaymentId(), pendingNotifs);
            }
            if (PAYMENT_EVENTS.contains(eventType)) {
                if (ref.getPaymentId() != null) {
                    paymentHandler.handle(eventType, obj, ref.getPaymentId(),
                        ref.getBookingId(), pendingNotifs);
                }
            }
            // SUBSCRIPTION_EVENTS → StripeSubscriptionHandler (Slice 18)

            // ── 2d. Marquer succès ─────────────────────────────────────────
            webhookRepo.markDone(eventId, "success", relatedId, null);

        } catch (Exception e) {
            log.error("Erreur handler webhook event={} id={} : {}", eventType, eventId, e.getMessage());
            try {
                webhookRepo.markDone(eventId, "error", relatedId, e.getMessage().substring(0, 500));
            } catch (Exception ignored) {}
            // ⚠️ NE PAS relancer l'exception — retourner {"received": true}
        }

        // ── 3. Notifications hors transaction ─────────────────────────────
        if (!pendingNotifs.isEmpty()) {
            notificationService.sendAsync(pendingNotifs);  // @Async
        }

        return Map.of("received", true);
    }

    private static final Set<String> PAYMENT_EVENTS = Set.of(
        "checkout.session.completed",
        "payment_intent.amount_capturable_updated",
        "payment_intent.succeeded",
        "payment_intent.payment_failed",
        "payment_intent.canceled"
    );
    private static final Set<String> CHARGE_EVENTS = Set.of(
        "charge.refunded", "refund.updated"
    );
}
```

---

## Repository — `WebhookEventRepository`

### Fichier suggéré

`WebhookEventRepository.java`

#### `claimEvent` — INSERT ON CONFLICT

```java
// webhook_handlers.py:90–101
// INSERT INTO stripe_webhook_events (event_id, event_type, status, processed_at, updated_at)
// VALUES ($1, $2, 'processing', NOW(), NOW())
// ON CONFLICT (event_id) DO NOTHING
// → retourne true si INSERT, false si conflit (event déjà vu)

@Modifying
@Query(value = """
    INSERT INTO stripe_webhook_events (event_id, event_type, status, processed_at, updated_at)
    VALUES (:eventId, :eventType, 'processing', NOW(), NOW())
    ON CONFLICT (event_id) DO NOTHING
    """, nativeQuery = true)
int claimEvent(String eventId, String eventType);
// retourne 1 si inséré, 0 si conflit
```

#### `markDone`

```java
@Modifying
@Query(value = """
    UPDATE stripe_webhook_events
    SET status=:status, related_id=:relatedId, error_message=:errorMessage, updated_at=NOW()
    WHERE event_id=:eventId
    """, nativeQuery = true)
void markDone(String eventId, String status, String relatedId, String errorMessage);
```

---

## Handler — `PaymentEventHandler`

### Fichier suggéré

`PaymentEventHandler.java`

#### Points critiques par event_type

**`checkout.session.completed`**
```java
// webhook_handlers.py:205–332
// 1. Lire obj.mode → si "subscription" return (Slice 18)
// 2. Lire obj.payment_status
// 3. Si ps="unpaid" → SELECT booking.status → 2 branches (awaiting_payment vs requested)
// 4. Si ps="paid" → directement captured
```

**`payment_intent.succeeded`**
```java
// webhook_handlers.py:355–420
// ⚠️ Lire latest_charge → str.startsWith("ch_")
// Si present → SET stripe_charge_id=$1 dans l'UPDATE payments
// Si absent  → UPDATE sans stripe_charge_id
```

**Guards obligatoires (reproduire exactement)**
```java
// authorized  : WHERE status NOT IN ('authorized','captured','refunded','cancelled')
// captured    : WHERE status NOT IN ('captured','refunded')
// failed      : WHERE status NOT IN ('captured','refunded','failed')
// cancelled   : WHERE status NOT IN ('captured','refunded','cancelled')
```

---

## Handler — `ChargeEventHandler`

### Fichier suggéré

`ChargeEventHandler.java`

```java
// charge.refunded :
//   - Lire obj.amount_refunded (centimes), obj.refunded (boolean), obj.id (charge_id)
//   - amount_refunded_euros = amount_refunded_cents / 100.0 (arrondi 2 décimales)
//   - fully_refunded = obj.refunded
//   - new_status = fully_refunded ? "refunded" : "partially_refunded"
//   - UPDATE payments SET status=$1, refund_amount=$2, refund_status='succeeded',
//     stripe_charge_id=COALESCE(stripe_charge_id, $3), updated_at=NOW()
//     WHERE payment_id=$4 AND status NOT IN ('refunded')

// refund.updated :
//   - Lire obj.charge → lookup payment si payment_id absent
//   - Si status='succeeded' et abs(amount - payer_total_amount) < 0.02 → status='refunded'
//   - Sinon : UPDATE payments SET refund_status=$1, updated_at=NOW() WHERE payment_id=$2
```

---

## Service — `PaymentResolver`

### Fichier suggéré

`PaymentResolver.java`

```java
// webhook_handlers.py:122–180
// 4 fallbacks dans l'ordre :
// 1. metadata.payment_id → retour immédiat si présent
// 2. stripe_payment_intent_id (pour events payment_intent.*)
// 3. stripe_checkout_session_id (pour checkout.session.*)
// 4. stripe_charge_id (pour charge.*/refund.*)
// Retourne PaymentRef{paymentId, bookingId} ou {null, null}
```

---

## Intégration Stripe SDK Java

### Dépendance Maven/Gradle

```xml
<dependency>
    <groupId>com.stripe</groupId>
    <artifactId>stripe-java</artifactId>
    <version>25.x.x</version>
</dependency>
```

### Configuration

```java
@Configuration
public class StripeConfig {
    @Value("${stripe.api.key}") private String apiKey;
    @Value("${stripe.webhook.secret:}") private String webhookSecret;

    @PostConstruct
    public void init() {
        Stripe.apiKey = apiKey;
        // Si proxy Emergent : Stripe.overrideApiBase("https://integrations.emergentagent.com/stripe")
    }
}
```

### Variables d'environnement Java

```properties
stripe.api.key=${STRIPE_API_KEY}
stripe.webhook.secret=${STRIPE_WEBHOOK_SECRET:}
```

---

## Transaction scope

| Handler | @Transactional requis | Contenu |
|---|---|---|
| `claimEvent` | NON (@Modifying seul) | INSERT ON CONFLICT |
| `markDone` | NON | UPDATE stripe_webhook_events |
| `PaymentEventHandler` (cs.completed awaiting) | OUI | UPDATE payments + bookings |
| `PaymentEventHandler` (cs.completed requested) | NON | UPDATE payments seul |
| `PaymentEventHandler` (cs.completed paid) | OUI | UPDATE payments + bookings |
| `PaymentEventHandler` (payment_intent.succeeded) | OUI | UPDATE payments + bookings |
| `PaymentEventHandler` (payment_intent.*) | NON | UPDATE payments seul |
| `ChargeEventHandler` | NON | UPDATE payments seul |
| `NotificationService.sendAsync` | NON (async) | Hors transaction |

---

## Critères de done (Definition of Done)

| # | Critère | Test |
|---|---|---|
| D1 | Signature valide → 200 | TC-03 (avec secret) |
| D2 | Signature invalide → 400 | TC-01 |
| D3 | Double event → idempotent_skip | TC-00 |
| D4 | `payment_intent.succeeded` → captured + charge_id | TC-03 |
| D5 | `checkout.session.completed` instant_booking → captured + confirmed | TC-05 |
| D6 | `checkout.session.completed` manual → authorized | TC-06 |
| D7 | `checkout.session.completed` subscription → ignoré | TC-07 |
| D8 | Guard anti-régression : captured ne recule pas | TC-11 |
| D9 | `charge.refunded` → refunded/partially_refunded | TC-12, TC-13 |
| D10 | `charge.refunded` fallback lookup par charge_id | TC-14 |
| D11 | `refund.updated` tolérance 0.02€ | TC-15 |
| D12 | Event inconnu → 200 sans erreur | TC-16 |
| D13 | `_resolve_payment_id` fallback pi_id | TC-17 |
| D14 | Exception handler → 200 (jamais 500) | (injection d'erreur) |
| D15 | Notifications envoyées APRÈS conn.release | (vérification asynchrone) |
| D16 | stripe_checkout_session_id exclu de scope abonnement | TC-07 |

---

## Relation avec les Slices précédentes

| Slice | Dépend de Slice 16 |
|---|---|
| S12 `/refuse` | PI cancel stub → Slice 16 envoie `payment_intent.canceled` confirmation |
| S13 `/accept` | Capture stub → Slice 16 envoie `payment_intent.succeeded` confirmation |
| S15 `/cancel` | Refund → Slice 16 envoie `charge.refunded` confirmation |
| **S17** | `POST /payments/checkout/session` crée le PI → Slice 16 le confirme via webhook |
| **S18** | Webhook abonnements (subscription events) |
