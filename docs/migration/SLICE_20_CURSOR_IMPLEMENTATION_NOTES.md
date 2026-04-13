# SLICE_20_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation Cursor
> Basé sur `webhook_handlers.py:584–1105`.
> Généré le 2026-04-13.

---

## Objectif

Étendre le `WebhookDispatcherService` (ou `StripeWebhookService`) existant de la Slice 16
pour traiter les 6 event types subscription. Créer un `SubscriptionWebhookHandler`
qui implémente les transitions d'état d'abonnement.

---

## 1. Architecture Java cible

```
src/main/java/com/spotu/
├── service/
│   └── webhook/
│       ├── WebhookDispatcherService.java    ← S16 (existant) — ajouter routing subscription
│       ├── PaymentWebhookHandler.java       ← S16 (existant)
│       ├── ChargeWebhookHandler.java        ← S16 (existant)
│       └── SubscriptionWebhookHandler.java  ← 🔴 S20 (NOUVEAU)
├── repository/
│   └── UserSubscriptionRepository.java      ← 🔴 S20 (NOUVEAU)
├── model/
│   └── UserSubscription.java                ← 🔴 S20 (NOUVEAU — entity JPA)
│   └── SubscriptionPlan.java                ← 🔴 S20 (NOUVEAU — entity JPA, read-only)
```

---

## 2. Entity JPA — `UserSubscription`

```java
@Entity
@Table(name = "user_subscriptions")
public class UserSubscription {

    @Id
    @Column(name = "subscription_id")
    private String subscriptionId;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "plan_id")
    private String planId;

    private String status;                     // active, cancelling, cancelled, past_due, trialing

    @Column(name = "started_at")
    private OffsetDateTime startedAt;

    @Column(name = "expires_at")
    private OffsetDateTime expiresAt;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "stripe_subscription_id")
    private String stripeSubscriptionId;

    @Column(name = "benefits_snapshot", columnDefinition = "jsonb")
    @Convert(converter = JsonbConverter.class)  // ou @Type(type = "jsonb")
    private Map<String, Object> benefitsSnapshot;

    @Column(name = "cancelled_at")
    private OffsetDateTime cancelledAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
```

**Piège JSONB** : `benefits_snapshot` est un champ JSONB. En JPA, utiliser un converter custom
ou la dépendance `hibernate-types` / `hypersistence-utils` pour le mapping Map ↔ JSONB.

---

## 3. Repository — `UserSubscriptionRepository`

```java
public interface UserSubscriptionRepository extends JpaRepository<UserSubscription, String> {

    // Idempotence INSERT (events 1, 2)
    Optional<UserSubscription> findByStripeSubscriptionId(String stripeSubscriptionId);

    // Lookup user_id pour notifications (events 3, 4, 5, 6)
    @Query("SELECT us.userId FROM UserSubscription us WHERE us.stripeSubscriptionId = :sid")
    Optional<String> findUserIdByStripeSubscriptionId(@Param("sid") String stripeSubscriptionId);

    // UPDATE status (event 3 — avec expires_at)
    @Modifying
    @Query(value = """
        UPDATE user_subscriptions
        SET status = :status, expires_at = :expiresAt, updated_at = NOW()
        WHERE stripe_subscription_id = :sid AND status NOT IN ('cancelled')
        """, nativeQuery = true)
    int updateStatusWithExpiry(@Param("sid") String sid,
                               @Param("status") String status,
                               @Param("expiresAt") OffsetDateTime expiresAt);

    // UPDATE status (event 3 — sans expires_at)
    @Modifying
    @Query(value = """
        UPDATE user_subscriptions
        SET status = :status, updated_at = NOW()
        WHERE stripe_subscription_id = :sid AND status NOT IN ('cancelled')
        """, nativeQuery = true)
    int updateStatus(@Param("sid") String sid, @Param("status") String status);

    // UPDATE cancelled (event 4 — SANS guard)
    @Modifying
    @Query(value = """
        UPDATE user_subscriptions
        SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE stripe_subscription_id = :sid
        """, nativeQuery = true)
    int markCancelled(@Param("sid") String sid);

    // UPDATE renouvellement (event 5)
    @Modifying
    @Query(value = """
        UPDATE user_subscriptions
        SET expires_at = :expiresAt, status = 'active', updated_at = NOW()
        WHERE stripe_subscription_id = :sid AND status NOT IN ('cancelled')
        """, nativeQuery = true)
    int renewSubscription(@Param("sid") String sid, @Param("expiresAt") OffsetDateTime expiresAt);

    // UPDATE past_due (event 6)
    @Modifying
    @Query(value = """
        UPDATE user_subscriptions
        SET status = 'past_due', updated_at = NOW()
        WHERE stripe_subscription_id = :sid AND status NOT IN ('cancelled')
        """, nativeQuery = true)
    int markPastDue(@Param("sid") String sid);
}
```

---

## 4. Handler — `SubscriptionWebhookHandler`

```java
@Slf4j
@Service
@RequiredArgsConstructor
public class SubscriptionWebhookHandler {

    private final UserSubscriptionRepository subscriptionRepo;
    private final SubscriptionPlanRepository planRepo;      // JpaRepository read-only
    private final StripePaymentService stripeService;       // S19 — pour retrieve_subscription
    private final IdGenerator idGenerator;                  // new_id("sub")

    /**
     * Point d'entrée principal — routage par event_type.
     * Appelé par WebhookDispatcherService après _claim_event.
     *
     * @return subscription_id local (pour related_id), ou null
     */
    public String handle(String eventType, Map<String, Object> obj,
                         List<PendingNotification> pendingNotifs) {

        switch (eventType) {
            case "checkout.session.completed" -> handleCheckoutCompleted(obj, pendingNotifs);
            case "customer.subscription.created" -> handleSubscriptionCreated(obj, pendingNotifs);
            case "customer.subscription.updated" -> handleSubscriptionUpdated(obj, pendingNotifs);
            case "customer.subscription.deleted" -> handleSubscriptionDeleted(obj, pendingNotifs);
            case "invoice.paid" -> handleInvoicePaid(obj, pendingNotifs);
            case "invoice.payment_failed" -> handleInvoicePaymentFailed(obj, pendingNotifs);
        }

        // Résoudre related_id
        return resolveRelatedId(eventType, obj);
    }

    // ── checkout.session.completed (mode=subscription) ────────────────────

    private void handleCheckoutCompleted(Map<String, Object> obj,
                                         List<PendingNotification> pendingNotifs) {
        String mode = getString(obj, "mode");
        if (!"subscription".equals(mode)) return;

        Map<String, String> meta = getMetadata(obj);
        String planId       = meta.get("plan_id");
        String userId       = meta.get("user_id");
        String stripeSubId  = getString(obj, "subscription");

        if (planId == null || userId == null || stripeSubId == null) {
            log.warn("checkout.session subscription: données incomplètes meta={} sub={}",
                     meta, stripeSubId);
            return;
        }

        // Idempotence
        if (subscriptionRepo.findByStripeSubscriptionId(stripeSubId).isPresent()) {
            log.debug("checkout.session subscription déjà enregistré: sub={}", stripeSubId);
            return;
        }

        // Charger le plan
        SubscriptionPlan plan = planRepo.findById(planId).orElse(null);
        if (plan == null) {
            log.warn("Plan {} introuvable pour webhook checkout subscription", planId);
            return;
        }

        // Récupérer expires_at depuis Stripe
        OffsetDateTime expiresAt = null;
        try {
            var stripeSub = stripeService.retrieveSubscription(stripeSubId);  // S19 ou nouveau
            Long periodEnd = stripeSub.getCurrentPeriodEnd();
            if (periodEnd != null) {
                expiresAt = Instant.ofEpochSecond(periodEnd).atOffset(ZoneOffset.UTC);
            }
        } catch (Exception e) {
            log.warn("Impossible de récupérer la subscription Stripe {} : {}", stripeSubId, e.getMessage());
        }

        // Construire benefits_snapshot
        Map<String, Object> benefits = buildBenefitsSnapshot(plan);

        // INSERT
        String subId = idGenerator.generate("sub");
        UserSubscription sub = new UserSubscription();
        sub.setSubscriptionId(subId);
        sub.setUserId(userId);
        sub.setPlanId(planId);
        sub.setStatus("active");
        sub.setStartedAt(OffsetDateTime.now(ZoneOffset.UTC));
        sub.setExpiresAt(expiresAt);
        sub.setStripeSubscriptionId(stripeSubId);
        sub.setBenefitsSnapshot(benefits);
        sub.setUpdatedAt(OffsetDateTime.now(ZoneOffset.UTC));
        subscriptionRepo.save(sub);

        log.info("Abonnement activé (checkout): sub={} | user={} | plan={}", subId, userId, planId);

        pendingNotifs.add(PendingNotification.builder()
            .userId(userId)
            .type("subscription_activated")
            .title("Abonnement activé !")
            .body("Votre abonnement " + plan.getName() + " est maintenant actif.")
            .data(Map.of("type", "subscription_activated",
                         "subscription_id", subId,
                         "plan_id", planId,
                         "plan_name", plan.getName()))
            .build());
    }

    // ── customer.subscription.updated ─────────────────────────────────────

    private void handleSubscriptionUpdated(Map<String, Object> obj,
                                           List<PendingNotification> pendingNotifs) {
        String stripeSubId        = getString(obj, "id");
        String stripeStatus       = getString(obj, "status");
        boolean cancelAtPeriodEnd = getBoolean(obj, "cancel_at_period_end");
        Long periodEnd            = getLong(obj, "current_period_end");

        // Mapping statut
        String newStatus;
        if ("active".equals(stripeStatus) && cancelAtPeriodEnd) {
            newStatus = "cancelling";
        } else if ("active".equals(stripeStatus)) {
            newStatus = "active";
        } else if ("canceled".equals(stripeStatus) || "cancelled".equals(stripeStatus)) {
            newStatus = "cancelled";
        } else if ("past_due".equals(stripeStatus)) {
            newStatus = "past_due";
        } else if ("trialing".equals(stripeStatus)) {
            newStatus = "trialing";
        } else {
            newStatus = stripeStatus;  // passthrough
        }

        int rowsUpdated;
        if (periodEnd != null) {
            OffsetDateTime expiresAt = Instant.ofEpochSecond(periodEnd).atOffset(ZoneOffset.UTC);
            rowsUpdated = subscriptionRepo.updateStatusWithExpiry(stripeSubId, newStatus, expiresAt);
        } else {
            rowsUpdated = subscriptionRepo.updateStatus(stripeSubId, newStatus);
        }

        log.info("Abonnement mis à jour: stripe={} | status={} | cancel_at_period_end={}",
                 stripeSubId, newStatus, cancelAtPeriodEnd);

        if (rowsUpdated > 0) {
            String userId = subscriptionRepo.findUserIdByStripeSubscriptionId(stripeSubId)
                .orElse(null);
            if (userId != null) {
                if ("cancelling".equals(newStatus)) {
                    pendingNotifs.add(/* subscription_cancelling notification */);
                } else if ("cancelled".equals(newStatus)) {
                    pendingNotifs.add(/* subscription_cancelled notification */);
                }
                // Autres statuts : PAS de notification
            }
        }
    }

    // ── Autres handlers (subscription.deleted, invoice.paid, invoice.payment_failed)
    // Pattern identique : appel repository, vérification rowsUpdated, notification conditionnelle

    // ── Helpers ───────────────────────────────────────────────────────────

    private Map<String, Object> buildBenefitsSnapshot(SubscriptionPlan plan) {
        return Map.of(
            "plan_id",                 plan.getPlanId(),
            "plan_name",               plan.getName(),
            "exempt_payer_fixed",      plan.isExemptPayerFixed(),
            "exempt_payer_percent",    plan.isExemptPayerPercent(),
            "exempt_receiver_fixed",   plan.isExemptReceiverFixed(),
            "exempt_receiver_percent", plan.isExemptReceiverPercent(),
            "snapshotted_at",          OffsetDateTime.now(ZoneOffset.UTC).toString()
        );
    }

    private String resolveRelatedId(String eventType, Map<String, Object> obj) {
        String stripeSubId = null;
        if ("checkout.session.completed".equals(eventType)) {
            stripeSubId = getString(obj, "subscription");
        } else if (eventType.contains("subscription")) {
            stripeSubId = getString(obj, "id");
        } else if (eventType.startsWith("invoice.")) {
            stripeSubId = getString(obj, "subscription");
        }
        if (stripeSubId != null) {
            return subscriptionRepo.findByStripeSubscriptionId(stripeSubId)
                .map(UserSubscription::getSubscriptionId)
                .orElse(null);
        }
        return null;
    }
}
```

---

## 5. Intégration dans le dispatcher existant (S16)

### Modification de `WebhookDispatcherService`

```java
// Ajouter le set d'events subscription
private static final Set<String> SUBSCRIPTION_EVENTS = Set.of(
    "checkout.session.completed",      // dual: aussi dans PAYMENT_EVENTS
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed"
);

// Dans la méthode dispatch(), APRÈS le bloc payment :
if (SUBSCRIPTION_EVENTS.contains(eventType)) {
    // Guard mode pour checkout
    if ("checkout.session.completed".equals(eventType)) {
        String mode = getString(obj, "mode");
        if (!"subscription".equals(mode)) {
            // Pas un event subscription — skip
        } else {
            String subRelatedId = subscriptionHandler.handle(eventType, obj, pendingNotifs);
            if (relatedId == null) relatedId = subRelatedId;
        }
    } else {
        String subRelatedId = subscriptionHandler.handle(eventType, obj, pendingNotifs);
        if (relatedId == null) relatedId = subRelatedId;
    }
}
```

**Piège dual dispatch** : `checkout.session.completed` est DANS LES DEUX sets.
Le guard `mode` doit être dans le dispatcher, pas dans le handler (le Python fait le guard
dans les DEUX endroits par défense en profondeur — en Java : au minimum dans le dispatcher).

---

## 6. Pièges critiques

### P1 — JSONB benefits_snapshot

```
Hibernate ne mappe pas nativement Map<String, Object> ↔ JSONB.
Options :
a) @Convert avec un converter custom (Jackson ObjectMapper)
b) Dépendance hypersistence-utils : @Type(JsonType.class)
c) Stocker comme String et parse manuellement (déconseillé)

Recommandation : option (b) si le projet utilise déjà hypersistence-utils,
sinon (a) avec un converter ~10 lignes.
```

### P2 — Dual routing checkout.session.completed

```
Python appelle TOUS les handlers qui matchent le set, chacun filtre par mode.
Java doit reproduire ce comportement :
  - Le même event est routé vers PaymentWebhookHandler ET SubscriptionWebhookHandler
  - Chacun fait un early return si mode != expected

Alternative plus propre en Java :
  - Router UNE fois par (eventType, mode) dans le dispatcher
  - Un seul handler appelé

Recommandation : alternative propre (un seul handler), MAIS documenter la divergence
avec Python pour la traçabilité.
```

### P3 — `_rows()` pattern en Java

```
Python utilise _rows(res) pour extraire le nombre de lignes modifiées depuis
le command tag asyncpg ("UPDATE 1").
En Java Spring Data : les méthodes @Modifying @Query retournent int (nombre de rows).
→ Directement compatible. Utiliser la valeur de retour de la méthode repository.
```

### P4 — `subscription.updated` : 2 SQL distincts

```
La branche subscription.updated a DEUX requêtes SQL distinctes selon que
expires_at est présent ou non. Les positional parameters changent.
En Java @Query : 2 méthodes repository distinctes (updateStatusWithExpiry vs updateStatus).
NE PAS utiliser une seule requête avec COALESCE — reproduire le pattern Python.
```

### P5 — `subscription.deleted` SANS guard

```
C'est le SEUL event dont le UPDATE n'a PAS de WHERE status NOT IN ('cancelled').
Tous les autres (updated, invoice.paid, invoice.payment_failed) ont ce guard.
NE PAS ajouter de guard par réflexe — reproduire exactement l'asymétrie Python.
```

### P6 — `retrieve_subscription()` DANS le handler

```
L'event checkout.session.completed fait un appel Stripe DANS la méthode @Transactional
(si le handler est @Transactional). Cela tient le lock DB.
Options Java :
a) Ne PAS mettre @Transactional sur le handler — gérer manuellement
b) Faire l'appel Stripe AVANT la transaction
c) Reproduire le pattern Python (appel dans le handler, protégé par try/catch)

Recommandation : option (c) pour compatibilité, car checkout est un event rare
et le try/catch protège déjà contre les timeouts.
```

---

## 7. Stripe SDK pour `retrieveSubscription`

```java
// Méthode à ajouter au StripePaymentService (S19) ou nouveau StripeSubscriptionService

public Subscription retrieveSubscription(String subscriptionId) throws StripeException {
    return Subscription.retrieve(subscriptionId);
}
```

**Note** : `Subscription` est `com.stripe.model.Subscription` (déjà dans le SDK S19).

---

## 8. Critères de done (Definition of Done)

| # | Critère | Tests |
|---|---|---|
| D1 | checkout.session.completed (sub) → INSERT active + benefits | TC-CS-01, 08 |
| D2 | Idempotence INSERT par stripe_subscription_id | TC-CS-02, TC-SC-02 |
| D3 | subscription.created → INSERT (fallback) | TC-SC-01 |
| D4 | subscription.updated → mapping 5 statuts | TC-SU-01 à 05 |
| D5 | Guard NOT IN ('cancelled') sur updated/invoice | TC-SU-06, TC-IP-04, TC-IF-03 |
| D6 | subscription.deleted SANS guard | TC-SD-01, 02 |
| D7 | invoice.paid → active + expires_at | TC-IP-01 |
| D8 | invoice.paid force active (past_due/cancelling→active) | TC-IP-02, 03 |
| D9 | invoice.payment_failed → past_due | TC-IF-01 |
| D10 | Notifications conditionnelles (rows > 0) | TC-SU-02, TC-IF-02 |
| D11 | JSONB benefits_snapshot stocké correctement | TC-CS-08 |
| D12 | Dual routing checkout.session.completed | TC-CS-06 |
| D13 | retrieve_subscription protégé par try/catch | TC-CS-07 |
| D14 | related_id résolu dans stripe_webhook_events | TC-DI-02 |
| D15 | Erreur handler → error marqué, HTTP 200 | TC-DI-03 |
| D16 | Notifications envoyées hors connexion DB | TC-DI-04 |

---

## 9. Relation avec les Slices précédentes et suivantes

| Slice | Composant | Interaction avec S20 |
|---|---|---|
| S16 | WebhookDispatcherService | S20 ÉTEND le dispatcher (ajoute SUBSCRIPTION_EVENTS) |
| S16 | _claim_event / _mark_done | Réutilisés tels quels |
| S16 | pending_notifs pattern | Même pattern collect → send |
| S19 | StripePaymentService | S20 utilise `retrieveSubscription()` (à ajouter) |
| **S21** (futur) | POST /subscribe | Déclenche le checkout qui génère les events S20 |
| **S21** (futur) | POST /cancel | Déclenche subscription.updated/deleted (events S20) |
| **S21** (futur) | GET /subscriptions/me | Lit les données créées par S20 |
