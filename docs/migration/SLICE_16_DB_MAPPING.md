# SLICE_16_DB_MAPPING.md — Mapping DB de la Slice 16
> Sources : `webhook_handlers.py:80–583`, `payment_routes.py:354–405`.
> Généré le 2026-02-XX.

---

## Tables utilisées

| Table | Opération | Rôle |
|---|---|---|
| `stripe_webhook_events` | INSERT + UPDATE | Idempotence — registre des events traités |
| `payments` | SELECT + UPDATE | Transitions de statut paiements |
| `bookings` | SELECT + UPDATE | Sync statut + payment_status |
| ~~`user_subscriptions`~~ | **EXCLU Slice 18** | |
| ~~`subscription_plans`~~ | **EXCLU Slice 18** | |

---

## Table `stripe_webhook_events` — Idempotence

### Schéma déduit

```sql
-- webhook_handlers.py:90–96
CREATE TABLE stripe_webhook_events (
    event_id       VARCHAR PRIMARY KEY,          -- Stripe event ID (evt_...)
    event_type     VARCHAR,                      -- 'payment_intent.succeeded', etc.
    status         VARCHAR,                      -- 'processing' | 'success' | 'error' | 'ignored'
    related_id     VARCHAR,                      -- payment_id ou subscription_id local
    error_message  VARCHAR(500),                 -- message d'erreur si status='error'
    processed_at   TIMESTAMPTZ,                  -- date de premier traitement
    updated_at     TIMESTAMPTZ                   -- date de dernière mise à jour
);
```

### `_claim_event` — INSERT ON CONFLICT

```sql
-- webhook_handlers.py:90–96
INSERT INTO stripe_webhook_events
    (event_id, event_type, status, processed_at, updated_at)
VALUES ($1, $2, 'processing', NOW(), NOW())
ON CONFLICT (event_id) DO NOTHING
```

**Retourne :** "INSERT 0 1" si inséré (nouvel event), "INSERT 0 0" si conflit (event déjà vu).
**Comportement Java :** L'INSERT retourne le nombre de lignes affectées (0 ou 1).

### `_mark_done` — UPDATE statut final

```sql
-- webhook_handlers.py:112–116
UPDATE stripe_webhook_events
SET status = $1, related_id = $2, error_message = $3, updated_at = NOW()
WHERE event_id = $4
```

**Valeurs de `status`** : `'success'`, `'error'`, `'ignored'`

---

## Séquence par event_type

### A. `checkout.session.completed` (mode=payment, ps=unpaid, booking=awaiting_payment)

```sql
-- 1. Vérifier le statut du booking
SELECT status FROM bookings WHERE booking_id = $1

-- 2. Transaction atomique
BEGIN;
  -- 2a. Update payment → captured
  UPDATE payments SET status='captured', updated_at=NOW()
  WHERE payment_id=$1
    AND status NOT IN ('captured','refunded','cancelled')

  -- 2b. Update booking → confirmed (conditionnel)
  UPDATE bookings
  SET status='confirmed', payment_status='paid', updated_at=NOW()
  WHERE booking_id=$1
    AND status NOT IN ('confirmed','refused','cancelled','expired')
COMMIT;

-- 3. Lecture pour notifications
SELECT payer_user_id, receiver_user_id FROM payments WHERE payment_id=$1
SELECT s.title FROM bookings b JOIN services s ON b.service_id=s.service_id WHERE b.booking_id=$1
```

---

### B. `checkout.session.completed` (mode=payment, ps=unpaid, booking=requested)

```sql
-- (pas de transaction — single UPDATE)
UPDATE payments SET status='authorized', updated_at=NOW()
WHERE payment_id=$1
  AND status NOT IN ('authorized','captured','refunded','cancelled')

-- Lecture pour notification receiver
SELECT receiver_user_id FROM payments WHERE payment_id=$1
```

---

### C. `checkout.session.completed` (mode=payment, ps=paid)

```sql
BEGIN;
  UPDATE payments SET status='captured', updated_at=NOW()
  WHERE payment_id=$1 AND status NOT IN ('captured','refunded')

  UPDATE bookings
  SET status='confirmed', payment_status='paid', updated_at=NOW()
  WHERE booking_id=$1
    AND status NOT IN ('confirmed','refused','cancelled','expired')
COMMIT;

-- Lecture pour notifications
SELECT payer_user_id, receiver_user_id FROM payments WHERE payment_id=$1
SELECT s.title FROM bookings b JOIN services s ON ... WHERE b.booking_id=$1
```

---

### D. `payment_intent.amount_capturable_updated`

```sql
UPDATE payments SET status='authorized', updated_at=NOW()
WHERE payment_id=$1
  AND status NOT IN ('authorized','captured','refunded','cancelled')

SELECT receiver_user_id FROM payments WHERE payment_id=$1
```

---

### E. `payment_intent.succeeded`

```sql
-- Cas 1 : latest_charge présent (ch_...)
BEGIN;
  UPDATE payments
  SET status='captured', stripe_charge_id=$1, updated_at=NOW()
  WHERE payment_id=$2 AND status NOT IN ('captured','refunded')

  UPDATE bookings
  SET status='confirmed', payment_status='paid', updated_at=NOW()
  WHERE booking_id=$1
    AND status NOT IN ('confirmed','refused','cancelled','expired')
COMMIT;

-- Cas 2 : latest_charge absent
BEGIN;
  UPDATE payments SET status='captured', updated_at=NOW()
  WHERE payment_id=$1 AND status NOT IN ('captured','refunded')

  UPDATE bookings ...
COMMIT;

-- Lecture pour notifications
SELECT payer_user_id, receiver_user_id FROM payments WHERE payment_id=$1
SELECT s.title FROM bookings b JOIN services s ON ... WHERE b.booking_id=$1
```

> ⚠️ **Trap P5** : stocker `stripe_charge_id` uniquement si `charge_id.startsWith("ch_")`.

---

### F. `payment_intent.payment_failed`

```sql
UPDATE payments SET status='failed', updated_at=NOW()
WHERE payment_id=$1
  AND status NOT IN ('captured','refunded','failed')

SELECT payer_user_id FROM payments WHERE payment_id=$1
```

---

### G. `payment_intent.canceled`

```sql
-- Pas de notification
UPDATE payments SET status='cancelled', updated_at=NOW()
WHERE payment_id=$1
  AND status NOT IN ('captured','refunded','cancelled')
```

---

### H. `charge.refunded`

```sql
-- Si payment_id non résolu via metadata → lookup par charge_id
SELECT payment_id FROM payments WHERE stripe_charge_id=$1 LIMIT 1

-- Extraction des données de l'event :
--   amount_refunded_cents = obj.amount_refunded
--   fully_refunded = obj.refunded  (bool)
--   charge_id = obj.id

-- Update : refunded OU partially_refunded
UPDATE payments
SET status = $1,             -- 'refunded' ou 'partially_refunded'
    refund_amount = $2,      -- centimes / 100 (en euros)
    refund_status = 'succeeded',
    stripe_charge_id = COALESCE(stripe_charge_id, $3),
    updated_at = NOW()
WHERE payment_id=$4
  AND status NOT IN ('refunded')   -- guard anti-régression

SELECT payer_user_id FROM payments WHERE payment_id=$1
```

---

### I. `refund.updated`

```sql
-- Lookup par charge_id si payment_id non résolu
SELECT payment_id, payer_total_amount FROM payments WHERE stripe_charge_id=$1 LIMIT 1

-- Cas : remboursement complet confirmé
UPDATE payments
SET refund_status=$1, refund_amount=$2, status='refunded', updated_at=NOW()
WHERE payment_id=$3 AND status != 'refunded'

-- Cas général
UPDATE payments SET refund_status=$1, updated_at=NOW() WHERE payment_id=$2
```

---

## `_resolve_payment_id` — 4 stratégies de lookup

```
Priorité 1 : metadata.payment_id   → direct (le plus fiable)
Priorité 2 : stripe_payment_intent_id  → SELECT payment_id, booking_id FROM payments WHERE stripe_payment_intent_id=$1
Priorité 3 : stripe_checkout_session_id → SELECT ... WHERE stripe_checkout_session_id=$1
Priorité 4 : stripe_charge_id       → SELECT ... WHERE stripe_charge_id=$1
```

**Chaque fallback génère un SELECT supplémentaire.** En Java, implémenter les 4 niveaux dans l'ordre exact.

---

## Transactions — Récapitulatif

| Event | Transaction | Contenu |
|---|---|---|
| `checkout.session.completed` (awaiting_payment) | OUI | payments UPDATE + bookings UPDATE |
| `checkout.session.completed` (requested) | NON | payments UPDATE seul |
| `checkout.session.completed` (paid) | OUI | payments UPDATE + bookings UPDATE |
| `payment_intent.amount_capturable_updated` | NON | payments UPDATE seul |
| `payment_intent.succeeded` | OUI | payments UPDATE + bookings UPDATE |
| `payment_intent.payment_failed` | NON | payments UPDATE seul |
| `payment_intent.canceled` | NON | payments UPDATE seul |
| `charge.refunded` | NON | payments UPDATE seul |
| `refund.updated` | NON | payments UPDATE seul |

---

## Colonnes modifiées par table

### `payments`

| Colonne | Événements déclencheurs |
|---|---|
| `status` | Tous les events payment |
| `stripe_charge_id` | `payment_intent.succeeded`, `charge.refunded` (COALESCE) |
| `refund_amount` | `charge.refunded`, `refund.updated` |
| `refund_status` | `charge.refunded`, `refund.updated` |
| `updated_at` | Tous |

### `bookings`

| Colonne | Événements déclencheurs |
|---|---|
| `status` | `checkout.session.completed` (captured), `payment_intent.succeeded` |
| `payment_status` | `checkout.session.completed` (captured), `payment_intent.succeeded` |
| `updated_at` | Idem |

### `stripe_webhook_events`

| Colonne | Opération |
|---|---|
| `event_id` | INSERT (PK) |
| `event_type` | INSERT |
| `status` | INSERT → `processing`, puis UPDATE → `success`/`error`/`ignored` |
| `related_id` | UPDATE (payment_id ou subscription_id) |
| `error_message` | UPDATE (si erreur) |
| `processed_at` | INSERT |
| `updated_at` | INSERT + UPDATE |
