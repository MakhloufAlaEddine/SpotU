# SLICE_19_DB_MAPPING.md — Mapping base de données
> Basé sur `stripe_service.py` (intégral), `booking_routes.py`, `expiry_worker.py`.
> Généré le 2026-02-XX.

---

## Principe fondamental

**Le `StripeService` ne fait AUCUN accès base de données.**

Les 3 méthodes (`capture`, `cancel`, `refund`) sont des appels réseau purs vers l'API Stripe.
La responsabilité DB appartient exclusivement aux **callers** documentés dans les Slices 12, 13, 15, 18.

Ce document décrit les **interactions DB des callers** pour situer les appels Stripe dans le flux transactionnel global.

---

## Vue d'ensemble — Stripe dans le flux transactionnel

```
┌──────────────────────────────────────────────────────────────┐
│ Caller (Controller / Worker)                                 │
│                                                              │
│  1. Lire booking + payment (SELECT)                          │
│  2. Vérifier droits + statut (guards)                        │
│  3. ┌─ @Transactional ──────────────────────────────┐        │
│     │  UPDATE bookings SET status = ...              │        │
│     │  UPDATE payments SET status = ...              │        │
│     │  UPDATE service_slots SET slot_status = ...    │        │
│     └───────────────────────────────── COMMIT ───────┘        │
│  4. ┌─ HORS TRANSACTION ───────────────────────────┐         │
│     │  stripeService.capture / cancel / refund      │ ← S19  │
│     │  (try/catch → log.error, erreur avalée)       │         │
│     └───────────────────────────────────────────────┘         │
│  5. Push notification (fire-and-forget)                       │
│  6. Return HTTP response                                      │
└──────────────────────────────────────────────────────────────┘
```

**Règle invariante** : l'appel Stripe est TOUJOURS après le COMMIT DB.
Si Stripe échoue, la DB reste dans l'état final correct.
Le webhook Stripe (Slice 16) rattrapera l'état si nécessaire.

---

## Tables impactées par les callers (contexte pour Slice 19)

### Table `payments`

| Colonne | Type | Rôle dans le flux Stripe |
|---|---|---|
| `payment_id` | `VARCHAR PK` | Identifiant interne du paiement |
| `stripe_payment_intent_id` | `VARCHAR` | `pi_...` — ID du PaymentIntent Stripe. Paramètre d'entrée pour `capture` et `cancel`. |
| `stripe_charge_id` | `VARCHAR` | `ch_...` — ID de la Charge Stripe. Paramètre d'entrée pour `refund`. Stocké par le webhook `payment_intent.succeeded` (Slice 16). |
| `status` | `VARCHAR` | État interne du paiement. Mis à jour par le CALLER avant l'appel Stripe. |
| `booking_id` | `VARCHAR FK` | Liaison avec la réservation. |

### Flux de `status` payment par opération

| Opération Stripe | Status AVANT (en DB) | Status APRÈS (en DB) | Qui met à jour la DB |
|---|---|---|---|
| `capture` | `authorized` | `captured` | Caller (Slice 13, dans la transaction) |
| `cancel` (pre-capture) | `requires_authorization` / `authorized` / `capture_pending` | `cancelled` | Caller (Slice 12/15/18, dans la transaction) |
| `refund` (post-capture) | `captured` | `refunded` | Caller (Slice 15, dans la transaction) |

### Point critique — Ordre DB → Stripe

```
DB UPDATE status='captured'     →  COMMIT  →  stripe.capture()
DB UPDATE status='cancelled'    →  COMMIT  →  stripe.cancel()
DB UPDATE status='refunded'     →  COMMIT  →  stripe.refund()
```

La DB est TOUJOURS mise à jour AVANT l'appel Stripe réseau.
Si Stripe échoue → la DB est déjà en état final → le webhook Stripe rattrapera.

---

### Table `bookings`

| Colonne | Rôle | Opération Stripe liée |
|---|---|---|
| `status` | `confirmed` (capture), `refused`/`cancelled`/`expired` (cancel), `cancelled` (refund) | Toutes |
| `payment_status` | Copie du status payment pour affichage rapide | Toutes |
| `expires_at` | `NULL` après capture (Slice 13 Cas A) | capture |

### Table `service_slots`

| Colonne | Rôle | Opération Stripe liée |
|---|---|---|
| `slot_status` | `booked` (capture), `available` (cancel/refund) | Toutes |

---

## Détail par méthode — Contexte DB du caller

### 1. `capturePaymentIntent` — Contexte DB (Slice 13, accept Cas A)

```sql
-- DANS la transaction (avant l'appel Stripe)
UPDATE bookings SET status='confirmed', payment_status='captured', expires_at=NULL, updated_at=NOW()
  WHERE booking_id=$1;

UPDATE payments SET status='captured', updated_at=NOW()
  WHERE payment_id=$1;

UPDATE service_slots SET slot_status='booked'
  WHERE slot_id=$1 AND slot_status IN ('pending','available','reserved');

-- COMMIT

-- HORS transaction : stripeService.capturePaymentIntent(piId)
```

**Lecture nécessaire au caller** :
```sql
SELECT p.stripe_payment_intent_id, p.status AS pay_status
FROM payments p WHERE p.booking_id = $1 LIMIT 1
```

### 2. `cancelPaymentIntent` — Contexte DB

#### Slice 12 (refuse)
```sql
-- Transaction
UPDATE bookings SET status='refused', updated_at=NOW() WHERE booking_id=$1;
UPDATE payments SET status='cancelled', updated_at=NOW()
  WHERE booking_id=$1 AND status IN ('requires_authorization','authorized');
UPDATE service_slots SET slot_status='available' WHERE slot_id=$1 AND slot_status='pending';
-- COMMIT → stripeService.cancelPaymentIntent(piId, "refused")
```

#### Slice 15 (cancel, branche pre-capture)
```sql
-- Transaction
UPDATE bookings SET status='cancelled', cancelled_by_user_id=$2, cancellation_reason=$3, updated_at=NOW()
  WHERE booking_id=$1;
UPDATE payments SET status='cancelled', updated_at=NOW() WHERE payment_id=$2;
UPDATE service_slots SET slot_status='available'
  WHERE slot_id=$1 AND slot_status IN ('pending','reserved','booked');
-- COMMIT → stripeService.cancelPaymentIntent(piId, "cancelled")
```

#### Slice 18 (expiry worker)
```sql
-- Transaction (FOR UPDATE SKIP LOCKED)
UPDATE bookings SET status='expired', updated_at=NOW()
  WHERE booking_id=$1 AND status IN ('requested','awaiting_payment') RETURNING booking_id;
UPDATE service_slots SET slot_status='available'
  WHERE slot_id=$1 AND slot_status IN ('pending','reserved') AND slot_type IN ('single','specific');
UPDATE payments SET status='cancelled', updated_at=NOW() WHERE payment_id=$1;
INSERT INTO notifications (...) VALUES (...);  -- x2
-- COMMIT → stripeService.cancelPaymentIntent(piId, "expired")
```

### 3. `createRefund` — Contexte DB (Slice 15, cancel branche captured)

```sql
-- Transaction
UPDATE bookings SET status='cancelled', cancelled_by_user_id=$2, cancellation_reason=$3, updated_at=NOW()
  WHERE booking_id=$1;
UPDATE payments SET status='refunded', updated_at=NOW() WHERE payment_id=$2;
UPDATE service_slots SET slot_status='available'
  WHERE slot_id=$1 AND slot_status IN ('pending','reserved','booked');
-- COMMIT → stripeService.createRefund(chargeId, "requested_by_customer", bookingId)
```

**Lecture nécessaire au caller** :
```sql
SELECT p.stripe_payment_intent_id, p.stripe_charge_id, p.status AS pay_status, p.payment_id
FROM payments p
  ... (JOIN bookings)
```

**Condition d'appel** :
```python
if charge_id:           # ch_... non null → refund possible
    stripe.create_refund(...)
else:
    log.warning("stripe_charge_id absent — remboursement manuel requis")
```

---

## Aucune migration de schéma requise

Cette slice ne modifie aucune table, aucune colonne, aucun index.
Les colonnes `stripe_payment_intent_id` et `stripe_charge_id` existent déjà dans `payments`.
Aucune DDL nécessaire.
