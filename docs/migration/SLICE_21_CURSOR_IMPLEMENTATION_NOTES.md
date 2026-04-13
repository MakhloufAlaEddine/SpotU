# SLICE_21_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation Cursor
> Basé sur `subscription_routes.py:130–449`, `stripe_service.py:354–535`.
> Généré le 2026-04-13.

---

## Objectif

Créer le `SubscriptionController` Java (6 endpoints utilisateur) et le `StripeSubscriptionService`
(5 méthodes réseau). Après S21, le cycle complet abonnement côté utilisateur est opérationnel.

---

## 1. Architecture Java cible

```
src/main/java/com/spotu/
├── controller/
│   └── SubscriptionController.java          ← 🔴 S21 (6 endpoints)
├── service/
│   ├── StripeSubscriptionService.java       ← 🔴 S21 (5 méthodes Stripe)
│   ├── SubscriptionService.java             ← 🔴 S21 (logique métier)
│   └── webhook/
│       └── SubscriptionWebhookHandler.java  ← S20 (existant)
├── repository/
│   ├── UserSubscriptionRepository.java      ← S20 (existant, à étendre)
│   └── SubscriptionPlanRepository.java      ← 🔴 S21 (read-only)
├── model/
│   ├── UserSubscription.java                ← S20 (existant)
│   └── SubscriptionPlan.java                ← 🔴 S21 (entity read-only)
├── dto/
│   └── SubscribeRequest.java                ← 🔴 S21
│   └── CancelSubscriptionRequest.java       ← 🔴 S21
│   └── SubscriptionResponse.java            ← 🔴 S21
```

---

## 2. Controller — `SubscriptionController`

```java
@Slf4j
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class SubscriptionController {

    private final SubscriptionService subscriptionService;
    private final StripeSubscriptionService stripeSubscriptionService;
    private final SubscriptionPlanRepository planRepo;
    private final UserSubscriptionRepository subscriptionRepo;
    private final UserRepository userRepo;

    // ── 1. GET /subscription-plans (PUBLIC) ─────────────────────────────

    @GetMapping("/subscription-plans")
    public List<Map<String, Object>> listPlans() {
        // SELECT ... WHERE active = TRUE ORDER BY priority DESC, price ASC
        // Pas d'auth, retourne [] si vide
        return planRepo.findActivePlansOrdered();
    }

    // ── 2. POST /subscriptions/subscribe ────────────────────────────────

    @PostMapping("/subscriptions/subscribe")
    public Map<String, Object> subscribe(@RequestBody SubscribeRequest body,
                                          HttpServletRequest request) {
        User user = authService.requireAuth(request);
        return subscriptionService.initiateSubscription(user, body);
    }

    // ── 3. GET /subscriptions/checkout/status/{sessionId} ───────────────

    @GetMapping("/subscriptions/checkout/status/{sessionId}")
    public Map<String, Object> checkoutStatus(@PathVariable String sessionId,
                                               HttpServletRequest request) {
        User user = authService.requireAuth(request);
        return subscriptionService.getCheckoutStatus(user, sessionId);
    }

    // ── 4. GET /subscriptions/me ────────────────────────────────────────

    @GetMapping("/subscriptions/me")
    public Map<String, Object> getMySubscription(HttpServletRequest request) {
        User user = authService.requireAuth(request);
        // Retourne {has_subscription, subscription} — PAS de 404
        return subscriptionService.getMySubscription(user.getUserId());
    }

    // ── 5. GET /subscriptions/history ───────────────────────────────────

    @GetMapping("/subscriptions/history")
    public List<Map<String, Object>> getHistory(HttpServletRequest request) {
        User user = authService.requireAuth(request);
        return subscriptionService.getHistory(user.getUserId());
    }

    // ── 6. POST /subscriptions/cancel ───────────────────────────────────

    @PostMapping("/subscriptions/cancel")
    public Map<String, Object> cancelSubscription(
            @RequestBody(required = false) CancelSubscriptionRequest body,
            HttpServletRequest request) {
        User user = authService.requireAuth(request);
        boolean immediate = (body != null) && Boolean.TRUE.equals(body.getImmediate());
        return subscriptionService.cancelSubscription(user, immediate);
    }
}
```

---

## 3. Service — `SubscriptionService` (logique métier)

### `initiateSubscription(user, body)` — Flow complet

```java
public Map<String, Object> initiateSubscription(User user, SubscribeRequest body) {
    String planId = body.getPlanId();
    if (planId == null || planId.isBlank()) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "plan_id requis");
    }

    // 1. Charger le plan
    SubscriptionPlan plan = planRepo.findById(planId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Plan introuvable"));
    if (!plan.isActive()) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
            "Ce plan n'est plus disponible à la souscription.");
    }

    // 2. Valider duration_days
    validateDuration(plan.getDurationDays());
    validatePrice(plan.getPrice());

    // 3. Vérifier doublon actif
    subscriptionRepo.findActiveByUserId(user.getUserId(), Set.of("active", "cancelling", "trialing"))
        .ifPresent(existing -> {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                String.format("Vous avez déjà un abonnement %s (id=%s). Annulez-le d'abord.",
                    existing.getStatus(), existing.getSubscriptionId()));
        });

    // 4. Garantir Product + Price Stripe (cache DB)
    String[] stripePriceResult = ensureStripePrice(plan);  // {productId, priceId}

    // 5. Customer Stripe
    String customerId = stripeSubscriptionService.getOrCreateCustomer(
        user.getUserId(), user.getEmail(), user.getName());
    // Stocker si NULL
    if (user.getStripeCustomerId() == null) {
        userRepo.updateStripeCustomerId(user.getUserId(), customerId);
    }

    // 6. Créer Checkout Session
    String originUrl = (body.getOriginUrl() != null) ? body.getOriginUrl().replaceAll("/$", "") : "";
    String successUrl = originUrl + "/subscription-success?session_id={CHECKOUT_SESSION_ID}";
    String cancelUrl = originUrl + "/subscription-plans";
    long window = System.currentTimeMillis() / 1000 / 300;
    String idempotencyKey = user.getUserId() + "_" + planId + "_" + window;

    var session = stripeSubscriptionService.createSubscriptionCheckoutSession(
        customerId, stripePriceResult[1], successUrl, cancelUrl,
        Map.of("plan_id", planId, "user_id", user.getUserId(), "product_type", "subscription"),
        idempotencyKey);

    return Map.of(
        "url", session.getUrl(),
        "session_id", session.getId(),
        "plan_id", planId
    );
}
```

### `cancelSubscription(user, immediate)` — Flow

```java
public Map<String, Object> cancelSubscription(User user, boolean immediate) {
    // 1. Guard admin pour immediate
    if (immediate && !"admin".equals(user.getRole())) {
        throw new ResponseStatusException(HttpStatus.FORBIDDEN,
            "L'annulation immédiate est réservée aux administrateurs.");
    }

    // 2. Trouver l'abonnement actif
    UserSubscription sub = subscriptionRepo
        .findActiveByUserId(user.getUserId(), Set.of("active", "cancelling", "trialing"))
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
            "Aucun abonnement actif à annuler"));

    String newStatus = immediate ? "cancelled" : "cancelling";

    // 3. Stripe AVANT DB (ordre spécifique subscription — différent de booking)
    if (sub.getStripeSubscriptionId() != null) {
        try {
            stripeSubscriptionService.cancelSubscription(
                sub.getStripeSubscriptionId(), !immediate);
            log.info("Abonnement Stripe annulé: sub_id={} immediate={}",
                sub.getStripeSubscriptionId(), immediate);
        } catch (Exception e) {
            log.error("Erreur annulation Stripe sub={}: {}",
                sub.getStripeSubscriptionId(), e.getMessage());
        }
    }

    // 4. DB UPDATE (après Stripe)
    subscriptionRepo.updateStatusAndCancelledAt(sub.getSubscriptionId(), newStatus);

    String message = immediate
        ? "Abonnement annulé immédiatement."
        : "Abonnement annulé à la fin de la période en cours. " +
          "Vous conservez vos avantages jusqu'à l'expiration.";

    return Map.of(
        "success", true,
        "subscription_id", sub.getSubscriptionId(),
        "status", newStatus,
        "message", message
    );
}
```

---

## 4. Service Stripe — `StripeSubscriptionService`

```java
@Slf4j
@Service
public class StripeSubscriptionService {

    /**
     * Cherche ou crée un Customer Stripe (idempotent par metadata.user_id).
     * SOURCE: stripe_service.py:55-77
     */
    public String getOrCreateCustomer(String userId, String email, String name)
            throws StripeException { ... }

    /**
     * Crée/récupère Product + Price Stripe pour un plan.
     * SOURCE: stripe_service.py:374-461
     */
    public String[] ensureSubscriptionPrice(String planId, String planName,
            String description, long amountCents, String currency, int durationDays)
            throws StripeException { ... }

    /**
     * Crée une Checkout Session en mode subscription.
     * SOURCE: stripe_service.py:464-500
     */
    public Session createSubscriptionCheckoutSession(String customerId, String priceId,
            String successUrl, String cancelUrl, Map<String, String> metadata,
            String idempotencyKey) throws StripeException { ... }

    /**
     * Annule un abonnement Stripe (at_period_end ou immédiat).
     * SOURCE: stripe_service.py:503-529
     */
    public Subscription cancelSubscription(String subscriptionId, boolean atPeriodEnd)
            throws StripeException { ... }

    /**
     * Récupère une Checkout Session par ID.
     * SOURCE: stripe_service.py:349-351
     */
    public Session retrieveCheckoutSession(String sessionId) throws StripeException { ... }
}
```

### Détails d'implémentation critiques

#### `getOrCreateCustomer`

```java
// Recherche par metadata
CustomerSearchParams searchParams = CustomerSearchParams.builder()
    .setQuery("metadata['user_id']:'" + userId + "'")
    .setLimit(1L)
    .build();
CustomerSearchResult result = Customer.search(searchParams);
if (!result.getData().isEmpty()) {
    return result.getData().get(0).getId();
}
// Créer
CustomerCreateParams createParams = CustomerCreateParams.builder()
    .setEmail(email).setName(name)
    .putMetadata("user_id", userId)
    .build();
return Customer.create(createParams).getId();
```

#### `cancelSubscription`

```java
if (atPeriodEnd) {
    SubscriptionUpdateParams params = SubscriptionUpdateParams.builder()
        .setCancelAtPeriodEnd(true).build();
    return Subscription.retrieve(subscriptionId).update(params);
} else {
    return Subscription.retrieve(subscriptionId).cancel();
}
```

---

## 5. Repository additions

### `SubscriptionPlanRepository`

```java
public interface SubscriptionPlanRepository extends JpaRepository<SubscriptionPlan, String> {

    @Query(value = """
        SELECT plan_id, name, description, price, duration_days,
               exempt_payer_fixed, exempt_payer_percent,
               exempt_receiver_fixed, exempt_receiver_percent,
               active, priority, created_at, updated_at
        FROM subscription_plans
        WHERE active = TRUE
        ORDER BY priority DESC, price ASC
        """, nativeQuery = true)
    List<Map<String, Object>> findActivePlansOrdered();

    @Modifying
    @Query(value = """
        UPDATE subscription_plans
        SET stripe_product_id = :productId, stripe_price_id = :priceId, updated_at = NOW()
        WHERE plan_id = :planId
        """, nativeQuery = true)
    void updateStripeIds(@Param("planId") String planId,
                         @Param("productId") String productId,
                         @Param("priceId") String priceId);
}
```

### `UserSubscriptionRepository` (extensions de S20)

```java
// Ajout pour S21
@Query("SELECT us FROM UserSubscription us WHERE us.userId = :uid " +
       "AND us.status IN :statuses ORDER BY us.startedAt DESC")
Optional<UserSubscription> findActiveByUserId(@Param("uid") String userId,
                                               @Param("statuses") Set<String> statuses);

@Modifying
@Query(value = """
    UPDATE user_subscriptions
    SET status = :status, cancelled_at = NOW(), updated_at = NOW()
    WHERE subscription_id = :sid
    """, nativeQuery = true)
void updateStatusAndCancelledAt(@Param("sid") String subscriptionId,
                                 @Param("status") String status);

// GET /me — avec JOIN plan
@Query(value = """
    SELECT us.*, sp.name AS plan_name, sp.description AS plan_description,
           sp.price AS plan_price, sp.duration_days,
           sp.exempt_payer_fixed, sp.exempt_payer_percent,
           sp.exempt_receiver_fixed, sp.exempt_receiver_percent
    FROM user_subscriptions us
    JOIN subscription_plans sp ON sp.plan_id = us.plan_id
    WHERE us.user_id = :uid
      AND us.status IN ('active','cancelling','past_due','trialing')
    ORDER BY us.started_at DESC LIMIT 1
    """, nativeQuery = true)
Map<String, Object> findCurrentSubscriptionWithPlan(@Param("uid") String userId);

// GET /history
@Query(value = """
    SELECT us.*, sp.name AS plan_name, sp.price AS plan_price
    FROM user_subscriptions us
    JOIN subscription_plans sp ON sp.plan_id = us.plan_id
    WHERE us.user_id = :uid
    ORDER BY us.created_at DESC
    """, nativeQuery = true)
List<Map<String, Object>> findHistoryByUserId(@Param("uid") String userId);
```

---

## 6. Pièges critiques

### P1 — Ordre Stripe/DB inversé pour cancel

```
Booking cancel (S15) : DB COMMIT → Stripe
Subscription cancel  : Stripe → DB UPDATE

NE PAS reproduire le pattern booking pour les subscriptions.
L'ordre est intentionnellement différent dans le code Python.
```

### P2 — `{CHECKOUT_SESSION_ID}` placeholder littéral

```
success_url = originUrl + "/subscription-success?session_id={CHECKOUT_SESSION_ID}"

Les accolades sont un PLACEHOLDER STRIPE (pas une variable Java).
Stripe les remplace lors de la redirection.
En Java : passer la string telle quelle, ne pas résoudre.
DÉJÀ DOCUMENTÉ : S17 (même piège).
```

### P3 — Idempotency key time window

```java
// Python: int(time.time() // 300)
// Java:
long window = System.currentTimeMillis() / 1000 / 300;
String idempotencyKey = userId + "_" + planId + "_" + window;
// Préfixé par stripe_service → "sub_cs_" + idempotencyKey
```

### P4 — /me retourne 200 (pas 404) si pas d'abonnement

```
Réponse : { "has_subscription": false, "subscription": null }
NE PAS lever une exception 404.
```

### P5 — Cancel body optionnel

```
Le body peut être absent, vide, ou non-JSON.
Python : try/except → body = {}
Java : @RequestBody(required = false) + null check
```

### P6 — Asymétrie filtre status /me vs /subscribe vs /cancel

```
/me      : IN ('active','cancelling','past_due','trialing')  ← inclut past_due
/subscribe guard : IN ('active','cancelling','trialing')      ← exclut past_due
/cancel  : IN ('active','cancelling','trialing')              ← exclut past_due

NE PAS utiliser la même constante pour les 3.
```

### P7 — `session.subscription` type variable

```
En Java Stripe SDK, Session.getSubscription() peut retourner un String (ID)
ou un objet Subscription (si expanded).
Vérifier le type avant cast. En mode non-expanded → String.
```

---

## 7. Critères de done

| # | Critère | Tests |
|---|---|---|
| D1 | `GET /subscription-plans` retourne plans actifs ordonnés | TC-PL-01, 02, 03 |
| D2 | Public (pas d'auth) sur plans | TC-PL-04 |
| D3 | `POST /subscribe` crée checkout session | TC-SUB-01 |
| D4 | Guards : 400 plan_id, 400 inactif, 404 absent, 409 doublon | TC-SUB-02 à 06 |
| D5 | past_due ne bloque PAS subscribe | TC-SUB-07 |
| D6 | Validation duration_days et price | TC-SUB-08, 09 |
| D7 | Idempotency key 5min window | TC-SUB-11 |
| D8 | `GET /checkout/status` ownership check | TC-CS-01, 03, 04 |
| D9 | `GET /me` retourne has_subscription:false (pas 404) | TC-ME-04 |
| D10 | /me inclut past_due | TC-ME-03 |
| D11 | benefits_snapshot désérialisé | TC-ME-06 |
| D12 | `POST /cancel` immediate → 403 si non admin | TC-CA-03 |
| D13 | Cancel Stripe AVANT DB | TC-CA-01 |
| D14 | Cancel Stripe échoue → DB quand même | TC-CA-07 |
| D15 | Cancel sans stripe_subscription_id → skip Stripe | TC-CA-06 |
| D16 | Cancel body absent → immediate=false | TC-CA-05 |

---

## 8. Relation avec les Slices

| Slice | Composant | Interaction avec S21 |
|---|---|---|
| S19 | StripePaymentService | Même pattern (mais S21 a son propre StripeSubscriptionService) |
| S20 | SubscriptionWebhookHandler | S20 crée les données que S21 lit (/me, /history) |
| S20 | UserSubscriptionRepository | S21 ÉTEND le repository (nouvelles queries) |
| S17 | Payment checkout | Même pattern success_url/cancel_url + placeholder |
| **S22** (futur) | Admin subscription endpoints | Utilise le même repository/service |
