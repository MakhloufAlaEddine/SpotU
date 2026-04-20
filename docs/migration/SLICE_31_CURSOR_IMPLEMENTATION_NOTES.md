# SLICE_31_CURSOR_IMPLEMENTATION_NOTES.md — Notes Java/Spring Boot Checkout Status
> Basé sur `payment_routes.py:195–351`, règles BR-31.01 à BR-31.19, cas T31.
> Généré le 2026-04-20.
>
> ⚠️ **Reproduire 1:1 le comportement Python. Ne pas "améliorer" (pas de lock ajouté, pas de @Async sur les push, pas de garde SQL ajoutée).**

---

## 1. Structure Spring Boot

```
src/main/java/com/spotu/payment/checkout/
├── controller/
│   └── CheckoutStatusController.java
├── service/
│   └── CheckoutStatusService.java
├── repository/
│   ├── PaymentRepository.java          ← findBySessionOrIntent, updateStatus × 4
│   └── BookingRepository.java          ← findStatusById, updateConfirmedPaid, updatePaymentStatus
├── dto/
│   ├── CheckoutStatusResponse.java     ← nominal
│   └── CheckoutStatusUnknownResponse.java  ← fallback sans stripe_status
├── stripe/
│   └── StripeCheckoutClient.java       ← retrieveCheckoutSession (réutilisé S30)
└── push/
    └── PushService.java                ← sendPushToUser (réutilisé)
```

---

## 2. Controller

```java
@RestController
@RequestMapping("/api/payments/checkout")
@RequiredArgsConstructor
public class CheckoutStatusController {

    private final CheckoutStatusService service;

    @GetMapping("/status/{sessionId}")
    public Object getStatus(
            @PathVariable String sessionId,
            @AuthenticationPrincipal(errorOnInvalidType = false) AuthenticatedUser caller) {
        // caller peut être null — auth OPTIONNELLE. Voir §3 SecurityConfig.
        return service.getStatus(sessionId, caller);
    }
}
```

### Pourquoi `Object` en retour ?
Deux formats de réponse possibles :
- `CheckoutStatusResponse` (nominal avec `stripe_status`)
- `CheckoutStatusUnknownResponse` (fallback sans `stripe_status`)

Alternativement utiliser un seul DTO avec `@JsonInclude(NON_NULL)` sur `stripeStatus` (plus propre) — voir §4.

---

## 3. Security — Auth OPTIONNELLE (critique)

### SecurityConfig
```java
@Configuration
public class SecurityConfig {
    @Bean
    SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(auth -> auth
            .requestMatchers(HttpMethod.GET, "/api/payments/checkout/status/*").permitAll()
            // autres endpoints sécurisés
            .anyRequest().authenticated()
        );
        return http.build();
    }
}
```

### JWT Filter
Doit tenter de parser le token JWT **sans throw** si invalide/absent :
- Si valide → attacher `AuthenticatedUser` au contexte
- Si invalide/absent → **continuer sans user** (pas 401)

Utiliser `OncePerRequestFilter` avec try/catch interne silencieux pour ce endpoint.

### Test
```java
@Test void anonymousAccessAllowed() {
    mvc.perform(get("/api/payments/checkout/status/cs_abc"))
       .andExpect(status().isOk())  // ou 404 si session absente, jamais 401
    ;
}
```

---

## 4. DTO unique avec `@JsonInclude(NON_NULL)`

```java
@JsonPropertyOrder({"payment_id","booking_id","session_id","status","payment_status","stripe_status","amount","currency"})
public record CheckoutStatusResponse(
    @JsonProperty("payment_id")     String paymentId,
    @JsonProperty("booking_id")     String bookingId,       // nullable
    @JsonProperty("session_id")     String sessionId,
    String status,                                           // "open"|"complete"|"expired"|"unknown"
    @JsonProperty("payment_status") String paymentStatus,
    @JsonProperty("stripe_status")
    @JsonInclude(JsonInclude.Include.NON_NULL)
    String stripeStatus,                                     // null en fallback
    double amount,
    String currency
) {}
```

- **`bookingId` nullable** : `@JsonInclude.ALWAYS` par défaut → sérialise `null` si absent (comme Python `payment.get("booking_id")` qui peut être None).
- **`stripeStatus` NON_NULL** : disparaît du JSON en fallback.

---

## 5. Service — implémentation

```java
@Service
@RequiredArgsConstructor
public class CheckoutStatusService {

    private final PaymentRepository paymentRepo;
    private final BookingRepository bookingRepo;
    private final StripeCheckoutClient stripe;
    private final PushService pushService;
    private static final Logger log = LoggerFactory.getLogger(CheckoutStatusService.class);

    public CheckoutStatusResponse getStatus(String sessionId, AuthenticatedUser callerOrNull) {
        // ── 1. Lookup payment (session OR payment_intent)
        PaymentRow payment = paymentRepo.findBySessionOrIntent(sessionId)
            .orElseThrow(() -> new NotFoundException("Session de paiement non trouvée"));

        // ── 2. Stripe retrieve (avec fallback silencieux)
        String realSessionId = payment.stripeCheckoutSessionId() != null
                               ? payment.stripeCheckoutSessionId() : sessionId;
        Session session;
        try {
            session = stripe.retrieveCheckoutSession(realSessionId);
        } catch (Exception exc) {
            log.warn("Impossible de récupérer la session Stripe {} : {}", realSessionId, exc.getMessage());
            return fallbackUnknown(payment, sessionId);
        }

        // ── 3. Charger booking.status si présent
        String dbStatus = payment.status();
        String stripePs = session.getPaymentStatus();   // "paid"|"unpaid"|"no_payment_required"
        String sStatus  = session.getStatus();          // "open"|"complete"|"expired"

        String bkStatus = null;
        if (payment.bookingId() != null) {
            bkStatus = bookingRepo.findStatusById(payment.bookingId()).orElse(null);
        }

        // ── 4. Décision (if/elif/elif strict)
        String newDbStatus = dbStatus;

        if ("complete".equals(sStatus) && "unpaid".equals(stripePs)) {
            if (!Set.of("authorized","captured","paid").contains(dbStatus)) {
                boolean isInstant = "awaiting_payment".equals(bkStatus);
                if (isInstant) {
                    applyInstantCaptured(payment);
                    newDbStatus = "captured";
                    sendInstantPushes(payment);
                } else {
                    applyManualAuthorized(payment);
                    newDbStatus = "authorized";
                }
            }
        } else if ("paid".equals(stripePs) && !"captured".equals(dbStatus)) {
            applyStripePaidCaptured(payment);
            newDbStatus = "captured";
        } else if ("expired".equals(sStatus) && "authorized".equals(dbStatus)) {
            paymentRepo.updateStatus(payment.paymentId(), "cancelled");
            newDbStatus = "cancelled";
        }
        // else : pas d'UPDATE

        // ── 5. Réponse nominal
        double amount = (session.getAmountTotal() != null && session.getAmountTotal() > 0)
                       ? session.getAmountTotal() / 100.0
                       : payment.payerTotalAmount().doubleValue();
        String currency = session.getCurrency() != null
                         ? session.getCurrency()
                         : (payment.currency() != null ? payment.currency() : "EUR");

        return new CheckoutStatusResponse(
            payment.paymentId(),
            payment.bookingId(),
            sessionId,
            sStatus,
            newDbStatus,
            stripePs,           // présent en nominal
            amount,
            currency
        );
    }

    // ── Sous-branches (@Transactional sur les mutations)

    @Transactional
    protected void applyInstantCaptured(PaymentRow payment) {
        paymentRepo.updateStatus(payment.paymentId(), "captured");
        bookingRepo.updateConfirmedPaid(payment.bookingId());
    }

    @Transactional
    protected void applyManualAuthorized(PaymentRow payment) {
        paymentRepo.updateStatus(payment.paymentId(), "authorized");
        if (payment.bookingId() != null) {
            bookingRepo.updatePaymentStatus(payment.bookingId(), "authorized");
        }
    }

    @Transactional
    protected void applyStripePaidCaptured(PaymentRow payment) {
        paymentRepo.updateStatus(payment.paymentId(), "captured");
        if (payment.bookingId() != null) {
            bookingRepo.updateConfirmedPaid(payment.bookingId());
        }
    }

    private void sendInstantPushes(PaymentRow payment) {
        // Re-SELECT payments pour compat bit-pour-bit (cf. BR-31.11)
        PaymentUsersRow usersRow = paymentRepo.findUsersById(payment.paymentId())
            .orElseThrow(() -> new IllegalStateException("payment disparu"));

        String title = bookingRepo.findServiceTitleByBookingId(payment.bookingId())
                                  .orElse("votre prestation");

        // AWAIT SYNCHRONE — pas de @Async, pas de fire-and-forget
        pushService.sendPushToUser(
            usersRow.payerUserId(),
            "Réservation confirmée !",
            "Votre réservation pour « " + title + " » est confirmée. À bientôt !",
            Map.of("type", "booking_confirmed", "booking_id", payment.bookingId()),
            "booking_confirmed"
        );
        pushService.sendPushToUser(
            usersRow.receiverUserId(),
            "Nouvelle réservation !",
            "Paiement reçu pour « " + title + " ». Votre planning a été mis à jour.",
            Map.of("type", "booking_confirmed", "booking_id", payment.bookingId()),
            "booking_confirmed"
        );
    }

    private CheckoutStatusResponse fallbackUnknown(PaymentRow payment, String sessionId) {
        double amount = payment.payerTotalAmount().doubleValue();
        String currency = payment.currency() != null ? payment.currency() : "EUR";
        return new CheckoutStatusResponse(
            payment.paymentId(),
            payment.bookingId(),
            sessionId,
            "unknown",
            payment.status() != null ? payment.status() : "unknown",
            null,              // stripe_status absent (NON_NULL filtre)
            amount,
            currency
        );
    }
}
```

---

## 6. Repositories

### PaymentRepository

```java
@Repository
public interface PaymentRepository {

    @Query(value = """
        SELECT p.*
          FROM payments p
         WHERE p.stripe_checkout_session_id = :id
            OR p.stripe_payment_intent_id   = :id
         LIMIT 1
    """, nativeQuery = true)
    Optional<PaymentRow> findBySessionOrIntent(@Param("id") String id);

    @Query(value = "SELECT payer_user_id, receiver_user_id FROM payments WHERE payment_id = :id",
           nativeQuery = true)
    Optional<PaymentUsersRow> findUsersById(@Param("id") String paymentId);

    @Modifying
    @Query(value = "UPDATE payments SET status = :status, updated_at = NOW() WHERE payment_id = :id",
           nativeQuery = true)
    int updateStatus(@Param("id") String paymentId, @Param("status") String status);
}
```

### BookingRepository

```java
@Repository
public interface BookingRepository {

    @Query(value = "SELECT status FROM bookings WHERE booking_id = :id", nativeQuery = true)
    Optional<String> findStatusById(@Param("id") String bookingId);

    @Modifying
    @Query(value = """
        UPDATE bookings
           SET status         = 'confirmed',
               payment_status = 'paid',
               updated_at     = NOW()
         WHERE booking_id = :id
           AND status NOT IN ('confirmed','refused','cancelled','expired')
    """, nativeQuery = true)
    int updateConfirmedPaid(@Param("id") String bookingId);

    @Modifying
    @Query(value = """
        UPDATE bookings
           SET payment_status = :status,
               updated_at     = NOW()
         WHERE booking_id = :id
    """, nativeQuery = true)
    int updatePaymentStatus(@Param("id") String bookingId, @Param("status") String status);

    @Query(value = """
        SELECT s.title
          FROM bookings b
          JOIN services s ON b.service_id = s.service_id
         WHERE b.booking_id = :id
    """, nativeQuery = true)
    Optional<String> findServiceTitleByBookingId(@Param("id") String bookingId);
}
```

---

## 7. Stripe client (réutilisé S30)

```java
public Session retrieveCheckoutSession(String sessionId) throws StripeException {
    return Session.retrieve(sessionId);
}
```

### Valeurs attendues

| Méthode | Type | Valeurs |
|---|---|---|
| `session.getStatus()` | String | `"open"` / `"complete"` / `"expired"` |
| `session.getPaymentStatus()` | String | `"paid"` / `"unpaid"` / `"no_payment_required"` |
| `session.getAmountTotal()` | Long (nullable) | cents, nullable |
| `session.getCurrency()` | String (nullable) | lowercase ISO ("eur") |

---

## 8. Exception handlers

```java
@ExceptionHandler(NotFoundException.class)
public ResponseEntity<Map<String,String>> notFound(NotFoundException e) {
    return ResponseEntity.status(404).body(Map.of("detail", e.getMessage()));
}
```

Pas d'autre handler spécifique nécessaire pour cette slice.

---

## 9. Transactions — résumé

| Action | Transaction | Rationale |
|---|---|---|
| SELECT lookup payment | readOnly | Pas de mutation |
| Stripe retrieve | (hors transaction) | Externe |
| SELECT bookings.status | readOnly | Guard |
| UPDATE payments + UPDATE bookings (branches 1-A, 2) | `@Transactional` (atomique) | Consistency |
| UPDATE payments + UPDATE bookings.payment_status (branche 1-B) | `@Transactional` | Consistency |
| UPDATE payments seul (branche 3) | **Pas de transaction explicite** en Python | Java : peut être auto-commit JPA. Ne pas wrapper. |
| Push × 2 (await sync) | **Hors transaction** | Python fait await APRÈS fin tx |

### ⚠️ Push sync (compat stricte)
**Ne pas utiliser** `@Async`, `@TransactionalEventListener`, ou `@Scheduled`. Appeler `pushService.sendPushToUser(...)` directement dans le thread de la requête. Si le push échoue → exception remonte → 500.

---

## 10. Concurrence & idempotence

### Pattern Python
- **Pas de SELECT FOR UPDATE** sur payments/bookings
- **Pas de lock applicatif**
- **Gardes SQL** `WHERE status NOT IN (...)` sur bookings (branches 1-A et 2)
- **Gardes Python** `if db_status NOT IN (...)` en amont

### Java — reproduire
- Même SQL, même gardes Python-side
- **Ne PAS ajouter** `@Lock(LockModeType.PESSIMISTIC_WRITE)` sur le SELECT initial
- Accepter la double-push race connue (2 appels concurrents → potentiellement 4 push)

### Alternative optim (HORS SCOPE)
Une slice ultérieure "Idempotence endpoint sync" pourra ajouter :
- SELECT FOR UPDATE NOWAIT sur payments au lookup
- Marquer compat breaking (à documenter)

---

## 11. Sérialisation JSON — pièges

### `amount` en float vs BigDecimal
- Python `session.amount_total / 100` → float (`51.75`)
- Java : `long / 100.0` → double

JSON sérialisation :
- Jackson `double` → `51.75` (OK)
- Jackson `BigDecimal` (sans config) → peut produire `"51.75"` (string) — **à éviter**.

Config ObjectMapper : `.disable(SerializationFeature.WRITE_BIGDECIMAL_AS_PLAIN)` si on utilise BigDecimal.

**Recommandation** : utiliser `double` dans le record pour match Python bit-pour-bit.

### Précision
`51.75` → OK. `0.1 + 0.2 = 0.30000000000000004` (piège float). Tester avec des valeurs typiques seulement.

### `currency` casse
Garder la valeur Stripe (lowercase) ou DB (uppercase) telle quelle. **Ne pas normaliser.**

---

## 12. Pièges à éviter

| # | Piège | Mitigation |
|---|---|---|
| 1 | Ajouter `@PreAuthorize` ou throw 401 | SecurityConfig `permitAll()` + filter silencieux |
| 2 | Utiliser `@Async` sur les push | Appel direct synchrone (compat stricte) |
| 3 | Ajouter `@Lock(PESSIMISTIC_WRITE)` sur lookup payment | Ne pas ajouter — compat stricte |
| 4 | Swap branches if/elif/elif | Ordre exact §BR-31.03 |
| 5 | Ajouter garde SQL `WHERE status NOT IN` sur `updatePaymentStatus` branche 1-B | Pas de garde — compat stricte |
| 6 | Normaliser currency en uppercase | Garder la source — compat stricte |
| 7 | Supprimer le re-SELECT payments (branche 1-A) | Garder — compat bit-pour-bit logs/traces |
| 8 | Harmoniser `booking_id` vs `bookingId` dans push data | snake_case `booking_id` en S31 (vs camelCase `bookingId` en S30) |
| 9 | Retourner `stripe_status=null` explicitement | `@JsonInclude(NON_NULL)` pour que la clé disparaisse |
| 10 | Mapper StripeException en 500 | Catch + retourner fallback "unknown" + log warn |
| 11 | Oublier le check `amountTotal > 0` | Python falsy check sur 0 — `> 0` en Java |
| 12 | Utiliser `@EntityGraph` qui cache/filtre soft-deleted | Pas d'impact ici (payments pas soft-deleted) mais attention si des intercepteurs globaux existent |
| 13 | Re-throw l'exception si push échoue | Laisser remonter (Python ne catch pas) → 500 OK |

---

## 13. Critères de Done

| # | Critère | Test |
|---|---|---|
| 1 | Endpoint exposé sans auth | T31-07..10 |
| 2 | 404 "Session de paiement non trouvée" | T31-11 |
| 3 | Lookup session OR payment_intent | T31-12 |
| 4 | Branches 1-A / 1-B / 2 / 3 toutes testées | T31-01..04 |
| 5 | Branche 5 no-op quand état déjà cohérent | T31-05, T31-06 |
| 6 | Fallback "unknown" sans `stripe_status` | T31-13, T31-14 |
| 7 | Push sync × 2 en branche 1-A | T31-01 |
| 8 | Aucune push en autres branches | T31-02..04 |
| 9 | Garde `WHERE status NOT IN` sur bookings confirmed | T31-23 |
| 10 | Pas de garde sur bookings.payment_status en branche 1-B | T31-22 |
| 11 | Format réponse bit-pour-bit (nominal + fallback) | T31-25, T31-26 |
| 12 | amount fallback si Stripe amount=0 ou null | T31-17, T31-18 |
| 13 | currency case preserved (lowercase Stripe) | T31-20 |
| 14 | Pas de SELECT FOR UPDATE | grep code |
| 15 | Re-SELECT payments présent (bit-pour-bit) | Inspection logs SQL |

---

## 14. Validation finale

- [ ] 30 cas T31 passent
- [ ] Aucun modif aux autres endpoints de `payment_routes.py` (webhook, /me, /{id}, etc.)
- [ ] Compat avec S30 validée (chaîne create → pay → checkout-status)
- [ ] Performance acceptable : p99 < 500ms (Stripe API latency incluse)
- [ ] Logs conformes (warning message exact pour fallback)
- [ ] UTF-8 guillemets français corrects dans push body
- [ ] Documentation OpenAPI générée
