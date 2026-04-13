# SLICE_19_API_CONTRACTS.md — Contrats d'interface du StripeService
> Basé sur `stripe_service.py:34–237`.
> Généré le 2026-02-XX.

---

## Nature du composant

`StripeService` n'est **PAS** un endpoint HTTP. C'est un **service interne Spring** (`@Service`) appelé par les controllers des Slices 12, 13, 15, 18.

Ce document décrit les **contrats d'interface Java** (signatures de méthodes, paramètres, retours, exceptions) — l'équivalent des "API contracts" pour un composant interne.

---

## Méthode 1 — `capturePaymentIntent`

### Signature Python (source de vérité)

```python
# stripe_service.py:138–153
async def capture_payment_intent(
    intent_id: str,
    amount_to_capture: int | None = None,
) -> stripe.PaymentIntent:
```

### Contrat Java cible

```java
/**
 * Capture un PaymentIntent autorisé (status=requires_capture).
 * Appelé par: BookingController.accept() — Slice 13, Cas A.
 *
 * @param intentId       ID du PaymentIntent (pi_...)
 * @param amountToCapture Montant à capturer en centimes. Si null → capture full.
 * @return PaymentIntent Stripe mis à jour
 * @throws StripeException en cas d'erreur réseau ou Stripe
 */
PaymentIntent capturePaymentIntent(String intentId, @Nullable Long amountToCapture)
    throws StripeException;
```

### Paramètres

| Param | Type | Requis | Source Python | Règle |
|---|---|---|---|---|
| `intentId` | `String` | OUI | `intent_id` | Format `pi_...` — jamais null au point d'appel (le caller vérifie `if pi_id_to_capture`) |
| `amountToCapture` | `Long` (nullable) | NON | `amount_to_capture` | Si null → capture le montant autorisé complet. **Non utilisé dans le code actuel.** |

### Retour

| Champ | Type | Description |
|---|---|---|
| Retour direct | `PaymentIntent` | Objet Stripe complet. Le caller ne l'utilise PAS (fire-and-forget avec log). |

### Erreurs

| Exception | Quand | Comportement caller |
|---|---|---|
| `StripeException` | Réseau, PI non trouvé, PI déjà captured, PI cancelled | **Avalée** par le caller (`try/except → log.error`). La DB est déjà en état `confirmed`. |

### Caller actuel

```python
# booking_routes.py:524–530
if do_capture and pi_id_to_capture:
    try:
        await stripe_service.capture_payment_intent(pi_id_to_capture)
        log.info("PaymentIntent capturé : pi=%s | booking=%s", pi_id_to_capture, booking_id)
    except Exception as exc:
        log.error("Erreur capture PI pi=%s booking=%s : %s", pi_id_to_capture, booking_id, exc)
```

### Effets de bord visibles

- **Stripe** : le client est débité (la banque reçoit l'instruction de transfert)
- **Webhook** : Stripe enverra `payment_intent.succeeded` + `charge.updated` → traités par Slice 16
- **Aucun effet DB** : le service ne touche aucune table

---

## Méthode 2 — `cancelPaymentIntent`

### Signature Python (source de vérité)

```python
# stripe_service.py:166–185
async def cancel_payment_intent(
    intent_id: str,
    reason: str = "abandoned",
) -> stripe.PaymentIntent:
```

### Contrat Java cible

```java
/**
 * Annule une autorisation PaymentIntent (avant capture).
 * Appelé par:
 *   - BookingController.refuse()  — Slice 12 (reason="refused")
 *   - BookingController.cancel()  — Slice 15 (reason="cancelled")
 *   - ExpiryWorker                — Slice 18 (reason="expired")
 *
 * @param intentId ID du PaymentIntent (pi_...)
 * @param reason   Raison métier (mappée vers Stripe: "abandoned"|"duplicate"|"fraudulent")
 * @return PaymentIntent Stripe annulé
 * @throws StripeException en cas d'erreur réseau ou Stripe
 */
PaymentIntent cancelPaymentIntent(String intentId, String reason) throws StripeException;
```

### Paramètres

| Param | Type | Requis | Source Python | Règle |
|---|---|---|---|---|
| `intentId` | `String` | OUI | `intent_id` | Format `pi_...` |
| `reason` | `String` | OUI (défaut `"abandoned"`) | `reason` | Valeur métier mappée via `_CANCEL_REASONS` |

### Mapping des raisons (CRITIQUE)

```python
# stripe_service.py:158–164
_CANCEL_REASONS = {
    "refused":   "abandoned",
    "expired":   "abandoned",
    "cancelled": "abandoned",
    "duplicate": "duplicate",
    "fraudulent": "fraudulent",
}
```

| Raison métier (entrée) | Raison Stripe (sortie) | Caller |
|---|---|---|
| `"refused"` | `"abandoned"` | `/refuse` (Slice 12) |
| `"expired"` | `"abandoned"` | ExpiryWorker (Slice 18) |
| `"cancelled"` | `"abandoned"` | `/cancel` (Slice 15) |
| `"duplicate"` | `"duplicate"` | Non utilisé actuellement |
| `"fraudulent"` | `"fraudulent"` | Non utilisé actuellement |
| toute autre valeur | `"abandoned"` (fallback) | Défense en profondeur |

### Retour

| Champ | Type | Description |
|---|---|---|
| Retour direct | `PaymentIntent` | Objet Stripe annulé. Le caller ne l'utilise PAS. |

### Erreurs

| Exception | Quand | Comportement caller |
|---|---|---|
| `StripeException` | Réseau, PI non trouvé, PI déjà cancelled, PI déjà captured | **Avalée** par tous les 3 callers. La DB est déjà en état final. |

### Callers actuels

```python
# booking_routes.py:729 (refuse)
await stripe_service.cancel_payment_intent(pi_id, reason="refused")

# booking_routes.py:884 (cancel, branche pre-capture)
await stripe_service.cancel_payment_intent(pi_id, reason="cancelled")

# expiry_worker.py:176 (expiry)
await stripe_service.cancel_payment_intent(pi_id, reason="expired")
```

### Effets de bord visibles

- **Stripe** : l'autorisation est libérée — la banque du client débloque les fonds
- **Webhook** : Stripe enverra `payment_intent.canceled` → traité par Slice 16
- **Aucun effet DB** : le service ne touche aucune table

---

## Méthode 3 — `createRefund`

### Signature Python (source de vérité)

```python
# stripe_service.py:199–237
async def create_refund(
    charge_id: str,
    amount_cents: int | None = None,
    reason: str = "requested_by_customer",
    idempotency_key: str | None = None,
) -> stripe.Refund:
```

### Contrat Java cible

```java
/**
 * Crée un remboursement Stripe pour une charge déjà capturée.
 * Appelé par: BookingController.cancel() — Slice 15 (paiement captured).
 *
 * @param chargeId       ID de la charge Stripe (ch_...)
 * @param amountCents    Montant en centimes (null → remboursement complet)
 * @param reason         Raison Stripe: "requested_by_customer"|"fraudulent"|"duplicate"
 * @param idempotencyKey Clé d'idempotence (recommandé: booking_id)
 * @return Refund Stripe créé
 * @throws StripeException en cas d'erreur réseau ou Stripe
 */
Refund createRefund(String chargeId, @Nullable Long amountCents,
                    String reason, @Nullable String idempotencyKey)
    throws StripeException;
```

### Paramètres

| Param | Type | Requis | Source Python | Règle |
|---|---|---|---|---|
| `chargeId` | `String` | OUI | `charge_id` | Format `ch_...` — stocké dans `payments.stripe_charge_id` |
| `amountCents` | `Long` (nullable) | NON | `amount_cents` | Si null → remboursement complet. **Non utilisé actuellement (toujours full).** |
| `reason` | `String` | OUI (défaut `"requested_by_customer"`) | `reason` | Validé contre `_REFUND_REASONS`, fallback si invalide |
| `idempotencyKey` | `String` (nullable) | NON | `idempotency_key` | Préfixé `rf_` en Python. Empêche les doublons Stripe. |

### Validation des raisons

```python
# stripe_service.py:197
_REFUND_REASONS = {"requested_by_customer", "fraudulent", "duplicate"}
```

| Raison entrée | Valide ? | Sortie |
|---|---|---|
| `"requested_by_customer"` | ✅ | `"requested_by_customer"` |
| `"fraudulent"` | ✅ | `"fraudulent"` |
| `"duplicate"` | ✅ | `"duplicate"` |
| toute autre valeur | ❌ → fallback | `"requested_by_customer"` |

### Idempotency key — format

```python
# stripe_service.py:228–229
if idempotency_key:
    kwargs["idempotency_key"] = f"rf_{idempotency_key}"
```

Le caller passe `booking_id` → le service préfixe `rf_` → Stripe reçoit `rf_bkg_abc123`.
En Java : `RequestOptions.builder().setIdempotencyKey("rf_" + idempotencyKey).build()`.

### Retour

| Champ | Type | Description |
|---|---|---|
| Retour direct | `Refund` | Objet Stripe. Le caller ne l'utilise PAS (fire-and-forget avec log). |

### Erreurs

| Exception | Quand | Comportement caller |
|---|---|---|
| `StripeException` | Réseau, charge non trouvée, charge déjà remboursée, montant > charge | **Avalée** par le caller. La DB est déjà en état `refunded`. |

### Caller actuel

```python
# booking_routes.py:892–906
if charge_id:
    try:
        await stripe_service.create_refund(
            charge_id=charge_id,
            reason="requested_by_customer",
            idempotency_key=booking_id,
        )
        stripe_action = "refund_created"
    except Exception as exc:
        log.error("Erreur remboursement Stripe charge=%s booking=%s : %s", ...)
else:
    log.warning("Paiement capturé sans stripe_charge_id — remboursement manuel requis")
```

### Effets de bord visibles

- **Stripe** : le client est remboursé (transfert inversé)
- **Webhook** : Stripe enverra `charge.refunded` + `refund.updated` → traités par Slice 16
- **Aucun effet DB** : le service ne touche aucune table

---

## Méthode auxiliaire — `retrievePaymentIntent`

### Signature Python

```python
# stripe_service.py:190–192
async def retrieve_payment_intent(intent_id: str) -> stripe.PaymentIntent:
    return await _run_sync(stripe.PaymentIntent.retrieve, intent_id)
```

### Contrat Java

```java
/**
 * Récupère un PaymentIntent par son ID (lecture seule).
 * Utilisé dans payment_routes.py pour le status check.
 */
PaymentIntent retrievePaymentIntent(String intentId) throws StripeException;
```

Méthode triviale (1 ligne) — incluse car elle fait partie du même service et partage la même init SDK.

---

## Infrastructure partagée — Init & Config

### Variables d'environnement

| Variable | Usage | Obligatoire |
|---|---|---|
| `STRIPE_API_KEY` | `stripe.api_key` — clé secrète | OUI (warning si absent) |
| `STRIPE_WEBHOOK_SECRET` | `parse_webhook_event` (Slice 16) — lu ici mais hors scope | NON pour S19 |

### Proxy Emergent (conditionnel)

```python
# stripe_service.py:39–42
if "sk_test_emergent" in _STRIPE_KEY:
    stripe.api_base = "https://integrations.emergentagent.com/stripe"
```

En Java : `Stripe.overrideApiBase(...)` conditionnel dans `@PostConstruct`.

### Wrapping async → sync

```python
# stripe_service.py:48–50
async def _run_sync(fn, *args, **kwargs):
    return await asyncio.to_thread(fn, *args, **kwargs)
```

En Java : **NON NÉCESSAIRE**. Le Stripe Java SDK est synchrone nativement. Les méthodes `PaymentIntent.capture()`, `PaymentIntent.cancel()`, `Refund.create()` sont bloquantes. Appeler directement depuis le service Spring.

> **PIÈGE** : NE PAS envelopper dans `CompletableFuture.supplyAsync()` sauf si le caller exige du non-bloquant. Les callers actuels (controllers S12–S18) sont synchrones côté requête.
