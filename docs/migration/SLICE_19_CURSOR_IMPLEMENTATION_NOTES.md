# SLICE_19_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation Cursor
> Basé sur `stripe_service.py:1–237`, `booking_routes.py:524–912`, `expiry_worker.py:173–179`.
> Généré le 2026-02-XX.

---

## Objectif

Créer le **`StripePaymentService`** Java qui remplace tous les stubs Stripe écrits dans les Slices 12, 13, 15 et 18.

Après cette implémentation :
- Slice 12 (`/refuse`) → `stripeService.cancelPaymentIntent(piId, "refused")` = **appel réel**
- Slice 13 (`/accept` Cas A) → `stripeService.capturePaymentIntent(piId)` = **appel réel**
- Slice 15 (`/cancel`) → `stripeService.cancelPaymentIntent(...)` + `stripeService.createRefund(...)` = **appels réels**
- Slice 18 (`ExpiryWorker`) → `stripeService.cancelPaymentIntent(piId, "expired")` = **appel réel**

---

## 1. Dépendance Maven

```xml
<!-- pom.xml -->
<dependency>
    <groupId>com.stripe</groupId>
    <artifactId>stripe-java</artifactId>
    <version>28.2.0</version> <!-- Vérifier la dernière version stable -->
</dependency>
```

> Le SDK Stripe Java est synchrone. Pas besoin de dépendance réactive.

---

## 2. Configuration Spring

```yaml
# application.yml
stripe:
  api-key: ${STRIPE_API_KEY:}
  webhook-secret: ${STRIPE_WEBHOOK_SECRET:}
  # Proxy Emergent pour environnement de test
  api-base-override: ${STRIPE_API_BASE_OVERRIDE:}
```

```java
@Configuration
public class StripeConfig {

    @Value("${stripe.api-key:}")
    private String apiKey;

    @Value("${stripe.api-base-override:}")
    private String apiBaseOverride;

    @PostConstruct
    public void init() {
        Stripe.apiKey = apiKey;

        if (apiKey == null || apiKey.isBlank()) {
            log.warn("STRIPE_API_KEY non configurée — les appels Stripe échoueront");
            return;
        }

        // Proxy Emergent (conditionnel)
        if (apiBaseOverride != null && !apiBaseOverride.isBlank()) {
            Stripe.overrideApiBase(apiBaseOverride);
            log.info("Stripe configuré via proxy : {}", apiBaseOverride);
        } else if (apiKey.contains("sk_test_emergent")) {
            Stripe.overrideApiBase("https://integrations.emergentagent.com/stripe");
            log.info("Stripe configuré via proxy Emergent (auto-détecté)");
        }
    }
}
```

### Différence avec Python

| Python | Java |
|---|---|
| `stripe.api_key = ...` au module load | `Stripe.apiKey = ...` dans `@PostConstruct` |
| `stripe.api_base = ...` | `Stripe.overrideApiBase(...)` |
| `asyncio.to_thread(fn, ...)` | Appel direct (SDK synchrone natif) |
| Pas de DI | `@Service` + `@Autowired` |

---

## 3. Service principal — `StripePaymentService`

```java
package com.spotu.service;

import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import com.stripe.model.Refund;
import com.stripe.net.RequestOptions;
import com.stripe.param.PaymentIntentCaptureParams;
import com.stripe.param.PaymentIntentCancelParams;
import com.stripe.param.RefundCreateParams;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Map;

@Slf4j
@Service
public class StripePaymentService {

    // ── Mapping raisons métier → raisons Stripe ─────────────────────────────

    private static final Map<String, String> CANCEL_REASONS = Map.of(
        "refused",    "abandoned",
        "expired",    "abandoned",
        "cancelled",  "abandoned",
        "duplicate",  "duplicate",
        "fraudulent", "fraudulent"
    );

    private static final java.util.Set<String> REFUND_REASONS = java.util.Set.of(
        "requested_by_customer", "fraudulent", "duplicate"
    );

    // ── Capture ─────────────────────────────────────────────────────────────

    /**
     * Capture un PaymentIntent autorisé (status=requires_capture).
     * Appelé hors @Transactional par le caller (Slice 13 accept Cas A).
     *
     * @param intentId         pi_... (jamais null au point d'appel)
     * @param amountToCapture  centimes (null → full capture)
     * @return PaymentIntent capturé
     * @throws StripeException en cas d'erreur (caller doit catch)
     */
    public PaymentIntent capturePaymentIntent(String intentId, Long amountToCapture)
            throws StripeException {

        PaymentIntentCaptureParams.Builder builder = PaymentIntentCaptureParams.builder();
        if (amountToCapture != null) {
            builder.setAmountToCapture(amountToCapture);
        }

        PaymentIntent intent = PaymentIntent.retrieve(intentId);
        PaymentIntent captured = intent.capture(builder.build());

        log.info("PaymentIntent capturé : pi={} | status={}", captured.getId(), captured.getStatus());
        return captured;
    }

    /**
     * Surcharge sans montant (full capture — usage normal).
     */
    public PaymentIntent capturePaymentIntent(String intentId) throws StripeException {
        return capturePaymentIntent(intentId, null);
    }

    // ── Annulation ──────────────────────────────────────────────────────────

    /**
     * Annule une autorisation PaymentIntent (avant capture).
     * Appelé hors @Transactional par les callers (Slices 12, 15, 18).
     *
     * @param intentId pi_...
     * @param reason   raison métier ("refused", "expired", "cancelled", etc.)
     * @return PaymentIntent annulé
     * @throws StripeException en cas d'erreur (caller doit catch)
     */
    public PaymentIntent cancelPaymentIntent(String intentId, String reason)
            throws StripeException {

        String safeReason = CANCEL_REASONS.getOrDefault(reason, "abandoned");

        PaymentIntentCancelParams params = PaymentIntentCancelParams.builder()
            .setCancellationReason(
                PaymentIntentCancelParams.CancellationReason.valueOf(
                    safeReason.toUpperCase()
                )
            )
            .build();

        PaymentIntent intent = PaymentIntent.retrieve(intentId);
        PaymentIntent cancelled = intent.cancel(params);

        log.info("PaymentIntent annulé : pi={} | reason={} | status={}",
                 cancelled.getId(), safeReason, cancelled.getStatus());
        return cancelled;
    }

    // ── Remboursement ───────────────────────────────────────────────────────

    /**
     * Crée un remboursement Stripe pour une charge capturée.
     * Appelé hors @Transactional par le caller (Slice 15 cancel post-capture).
     *
     * @param chargeId       ch_... (stripe_charge_id depuis payments)
     * @param amountCents    centimes (null → full refund)
     * @param reason         raison ("requested_by_customer" par défaut)
     * @param idempotencyKey clé d'idempotence (recommandé: booking_id)
     * @return Refund créé
     * @throws StripeException en cas d'erreur (caller doit catch)
     */
    public Refund createRefund(String chargeId, Long amountCents,
                               String reason, String idempotencyKey)
            throws StripeException {

        String safeReason = REFUND_REASONS.contains(reason) ? reason : "requested_by_customer";

        RefundCreateParams.Builder builder = RefundCreateParams.builder()
            .setCharge(chargeId)
            .setReason(RefundCreateParams.Reason.valueOf(
                safeReason.toUpperCase().replace("_", "_")
                // Note: Stripe Java enum utilise le même format que la string
            ));

        if (amountCents != null && amountCents > 0) {
            builder.setAmount(amountCents);
        }

        // Idempotency key
        RequestOptions options = null;
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            options = RequestOptions.builder()
                .setIdempotencyKey("rf_" + idempotencyKey)
                .build();
        }

        Refund refund = (options != null)
            ? Refund.create(builder.build(), options)
            : Refund.create(builder.build());

        log.info("Remboursement créé : refund={} | charge={} | amount={} | reason={}",
                 refund.getId(), chargeId,
                 amountCents != null ? amountCents + "c" : "full",
                 safeReason);
        return refund;
    }

    // ── Lecture ──────────────────────────────────────────────────────────────

    /**
     * Récupère un PaymentIntent par son ID (lecture seule).
     */
    public PaymentIntent retrievePaymentIntent(String intentId) throws StripeException {
        return PaymentIntent.retrieve(intentId);
    }
}
```

---

## 4. Pattern d'appel dans les callers (remplacement des stubs)

### Slice 13 — `BookingController.accept()` (Cas A)

**AVANT (stub)** :
```java
// TODO Slice Stripe : stripe.paymentIntents().capture(piId)
log.info("[STUB] Stripe capture PI piId={}", piId);
```

**APRÈS (réel)** :
```java
// Hors @Transactional — après COMMIT
if (doCapture && piIdToCapture != null) {
    try {
        stripePaymentService.capturePaymentIntent(piIdToCapture);
        log.info("PaymentIntent capturé : pi={} | booking={}", piIdToCapture, bookingId);
    } catch (StripeException e) {
        log.error("Erreur capture PI pi={} booking={} : {}", piIdToCapture, bookingId, e.getMessage());
        // Erreur avalée — booking déjà confirmed en DB (BR-02)
    }
}
```

### Slice 12 — `BookingController.refuse()`

**AVANT (stub)** :
```java
log.info("[STUB] Stripe cancel PI piId={} reason={}", piId, reason);
```

**APRÈS (réel)** :
```java
if (piId != null) {
    try {
        stripePaymentService.cancelPaymentIntent(piId, "refused");
        log.info("Annulation Stripe réussie : pi={} | booking={}", piId, bookingId);
    } catch (StripeException e) {
        log.error("Erreur annulation Stripe pi={} : {}", piId, e.getMessage());
    }
}
```

### Slice 15 — `BookingController.cancel()` — Branche cancel PI

```java
if ("cancelled".equals(newPayStatus) && piId != null) {
    try {
        stripePaymentService.cancelPaymentIntent(piId, "cancelled");
        stripeAction = "pi_cancelled";
        log.info("PI annulé : pi={} | booking={}", piId, bookingId);
    } catch (StripeException e) {
        log.error("Erreur annulation PI pi={} booking={} : {}", piId, bookingId, e.getMessage());
    }
}
```

### Slice 15 — `BookingController.cancel()` — Branche refund

```java
else if ("refunded".equals(newPayStatus)) {
    if (chargeId != null) {
        try {
            stripePaymentService.createRefund(chargeId, null, "requested_by_customer", bookingId);
            stripeAction = "refund_created";
            log.info("Remboursement Stripe : charge={} | booking={}", chargeId, bookingId);
        } catch (StripeException e) {
            log.error("Erreur remboursement Stripe charge={} booking={} : {}", chargeId, bookingId, e.getMessage());
        }
    } else {
        log.warn("Paiement capturé sans stripe_charge_id — remboursement manuel requis (booking={})", bookingId);
    }
}
```

### Slice 18 — `ExpiryWorkerService` — Cancel PI post-commit

```java
// Après le @Transactional (DB commit)
if (piId != null && Set.of("requires_authorization", "authorized", "capture_pending").contains(payStatus)) {
    try {
        stripePaymentService.cancelPaymentIntent(piId, "expired");
        log.info("Stripe annulation expiration : pi={} | booking={}", piId, bookingId);
    } catch (StripeException e) {
        log.error("Erreur Stripe annulation pi={} : {}", piId, e.getMessage());
    }
}
```

---

## 5. Pièges critiques

### P1 — `CancellationReason` enum Java vs string Python

```
Python : cancellation_reason="abandoned" (string passée directement)
Java   : PaymentIntentCancelParams.CancellationReason.ABANDONED (enum)

Le SDK Java utilise des enums typés.
Mapping string → enum :
  "abandoned"  → CancellationReason.ABANDONED
  "duplicate"  → CancellationReason.DUPLICATE
  "fraudulent" → CancellationReason.FRAUDULENT

PIÈGE : Si une valeur inconnue arrive (après le mapping), le valueOf() lèvera
        IllegalArgumentException. Ajouter un try/catch ou une map explicite.
```

### P2 — `RefundCreateParams.Reason` enum

```
Java enum values :
  DUPLICATE               → "duplicate"
  FRAUDULENT              → "fraudulent"
  REQUESTED_BY_CUSTOMER   → "requested_by_customer"

PIÈGE : Le mapping String → Enum doit gérer le format exact.
        "requested_by_customer" → REQUESTED_BY_CUSTOMER (underscore et majuscules).
        Utiliser une Map<String, RefundCreateParams.Reason> plutôt que valueOf() brut.
```

### P3 — Ne PAS mettre `@Transactional` sur le service

```
Le StripePaymentService ne doit PAS être @Transactional.
Il ne touche pas la DB.
Les appels réseau Stripe peuvent prendre 1–30 secondes.
Si le service est @Transactional, il héritera de la transaction du caller
→ le lock DB sera tenu pendant l'appel réseau → timeout/deadlock.

Vérifier que les callers appellent le service APRÈS le COMMIT de leur @Transactional.
```

### P4 — PaymentIntent.retrieve() avant capture/cancel

```
Le SDK Java v28+ requiert de récupérer l'objet avant d'appeler .capture() ou .cancel().
Pattern :
  PaymentIntent intent = PaymentIntent.retrieve(intentId);
  intent.capture(params);

Alternative (si le SDK le supporte) :
  PaymentIntent.capture(intentId, params, options);  // static method

Vérifier la version exacte du SDK pour le pattern correct.
```

### P5 — Idempotency key : préfixe "rf_"

```
Python préfixe TOUJOURS la clé avec "rf_" pour les refunds.
Le booking_id brut n'est PAS la clé Stripe — c'est "rf_{booking_id}".
Ne pas oublier ce préfixe en Java.

Pour cancel et capture : PAS de clé d'idempotence (le caller ne passe rien).
La capture Stripe est naturellement idempotente (re-capturer = no-op ou erreur).
```

### P6 — `amount_to_capture` et `amount` sont en centimes (Long, pas Double)

```
Python : int (centimes)
Java   : Long (centimes)

NE PAS convertir en euros (pas de division par 100).
NE PAS utiliser Double (erreurs d'arrondi).
```

---

## 6. Repository pattern

**NON APPLICABLE.** Le `StripePaymentService` n'a pas de repository.
C'est un wrapper pur autour du SDK Stripe. Il n'accède à aucune table.

---

## 7. Structure des fichiers Java

```
src/main/java/com/spotu/
├── config/
│   └── StripeConfig.java              ← @Configuration + @PostConstruct
├── service/
│   └── StripePaymentService.java      ← @Service (CE FICHIER)
```

Le service est injecté dans :
```
├── controller/
│   └── BookingController.java         ← @Autowired StripePaymentService (Slices 12, 13, 15)
├── worker/
│   └── ExpiryWorkerService.java       ← @Autowired StripePaymentService (Slice 18)
```

---

## 8. Critères de done (Definition of Done)

| # | Critère | Tests associés |
|---|---|---|
| D1 | `capturePaymentIntent(piId)` appelle `PaymentIntent.capture()` réellement | TC-CAP-01 |
| D2 | `capturePaymentIntent(piId, amount)` passe `amount_to_capture` si non null | TC-CAP-02 |
| D3 | `cancelPaymentIntent(piId, "refused")` envoie `cancellation_reason=ABANDONED` | TC-CAN-01 |
| D4 | `cancelPaymentIntent(piId, "expired")` envoie `cancellation_reason=ABANDONED` | TC-CAN-02 |
| D5 | `cancelPaymentIntent(piId, "cancelled")` envoie `cancellation_reason=ABANDONED` | TC-CAN-03 |
| D6 | `cancelPaymentIntent(piId, "unknown")` → fallback ABANDONED | TC-CAN-04 |
| D7 | `createRefund(chId, null, reason, bkId)` → full refund + idempotency_key="rf_{bkId}" | TC-REF-01 |
| D8 | `createRefund(chId, amount, ...)` → partial refund avec amount | TC-REF-02 |
| D9 | Raison refund invalide → fallback "requested_by_customer" | TC-REF-03 |
| D10 | `StripeConfig.init()` configure apiKey + proxy conditionnel | TC-INIT-01, 02, 03 |
| D11 | Stubs Slice 12 remplacés par appel réel cancelPaymentIntent | TC-INT-03 |
| D12 | Stubs Slice 13 remplacés par appel réel capturePaymentIntent | TC-INT-01 |
| D13 | Stubs Slice 15 (cancel) remplacés par appel réel | TC-INT-04 |
| D14 | Stubs Slice 15 (refund) remplacés par appel réel | TC-INT-05 |
| D15 | Stubs Slice 18 remplacés par appel réel cancelPaymentIntent | TC-INT-07 |
| D16 | Service NE contient PAS de `@Transactional` | Review code |
| D17 | Service NE contient AUCUN accès DB | Review code |
| D18 | Tous les callers catch `StripeException` et log.error (erreur avalée) | TC-INT-02, 08 |

---

## 9. Relation avec les Slices précédentes

| Slice | Stub actuel | Remplacement S19 | Méthode |
|---|---|---|---|
| S12 `/refuse` | `log.info("[STUB] Stripe cancel PI")` | `stripePaymentService.cancelPaymentIntent(piId, "refused")` | `cancelPaymentIntent` |
| S13 `/accept` Cas A | `log.info("[STUB] Stripe capture PI")` | `stripePaymentService.capturePaymentIntent(piId)` | `capturePaymentIntent` |
| S15 `/cancel` pre-capture | `stripeService.cancelPaymentIntent(...)` (stub) | Appel réel (même signature) | `cancelPaymentIntent` |
| S15 `/cancel` post-capture | `stripeService.createRefund(...)` (stub) | Appel réel (même signature) | `createRefund` |
| S18 `ExpiryWorker` | `stripeService.cancelPaymentIntent(...)` (stub) | Appel réel (même signature) | `cancelPaymentIntent` |

**Après S19** : 0 stub Stripe restant dans le cycle booking write.
