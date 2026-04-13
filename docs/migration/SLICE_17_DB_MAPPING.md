# SLICE_17_DB_MAPPING.md — Mapping DB de la Slice 17
> Source : `payment_routes.py:83–351`.
> Généré le 2026-02-XX.

---

## Tables utilisées

| Table | Endpoint | Opération | Rôle |
|---|---|---|---|
| `payments` | POST + GET | SELECT + UPDATE | Source des montants, cible des statuts |
| `bookings` | POST + GET | UPDATE (GET: aussi SELECT) | Sync statut + payment_status |

---

## POST /payments/checkout/session

### Étape 1 — Lecture initiale (LEFT JOIN)

```sql
-- payment_routes.py:106–111
SELECT p.*, b.service_id
FROM payments p
LEFT JOIN bookings b ON b.booking_id = p.booking_id
WHERE p.booking_id = $1
  AND p.payer_user_id = $2
```

**Paramètres :** `booking_id`, `user_id` (payer)

**Colonnes lues :**

| Colonne | Source | Usage |
|---|---|---|
| `payment_id` | `payments` | Clé pour UPDATEs + Stripe idempotency_key |
| `status` | `payments` | Guard "déjà capturé" + CASE UPDATE |
| `payer_total_amount` | `payments` | Calcul `amount_cents` (JAMAIS recalculé) |
| `currency` | `payments` | Code devise |
| `stripe_checkout_session_id` | `payments` | Idempotence : session existante |
| `product_id` | `payments` (ou `bookings`) | Used in cancel_url |
| `booking_id` | `bookings` | Propagé dans metadata |
| `service_id` | `bookings` | Présent dans SELECT, non utilisé directement |

> ⚠️ **`payer_total_amount`** est le montant pré-calculé depuis le pricing snapshot.
> `amount_cents = int(round(float(payment["payer_total_amount"]) * 100))`
> JAMAIS recalculer ce montant en Java.

---

### Étape 2 — Idempotence Stripe (si session existante)

```python
# payment_routes.py:122–130
if payment.get("stripe_checkout_session_id"):
    existing = await stripe_service.retrieve_checkout_session(payment["stripe_checkout_session_id"])
    if existing.status == "open":
        return {"url": existing.url, "session_id": existing.id}
```

Si `existing.status != "open"` (expired, complete) → continuer vers création d'une nouvelle session.

---

### Étape 3 — UPDATE transaction (après création Stripe)

```sql
-- payment_routes.py:166–190
BEGIN;

-- 3a. Update payments
UPDATE payments
SET stripe_checkout_session_id = $1,
    stripe_payment_intent_id   = $2,
    status = CASE
        WHEN status NOT IN ('requires_authorization','authorized','captured')
        THEN 'requires_authorization'
        ELSE status
    END,
    updated_at = NOW()
WHERE payment_id = $3;

-- 3b. Sync dénormalisée bookings.payment_status
UPDATE bookings
SET payment_status = CASE
        WHEN payment_status NOT IN ('requires_authorization','authorized','captured','paid')
        THEN 'requires_authorization'
        ELSE payment_status
    END,
    updated_at = NOW()
WHERE booking_id = $1;

COMMIT;
```

**Paramètres :**
- `$1` = `session.id` (cs_...)
- `$2` = `pi_id` (`session.payment_intent if isinstance(..., str) else None`)
- `$3` = `payment_id`

**Colonnes modifiées :**

| Table | Colonne | Valeur |
|---|---|---|
| `payments` | `stripe_checkout_session_id` | ID Stripe Checkout Session |
| `payments` | `stripe_payment_intent_id` | ID PaymentIntent (nullable si non-string) |
| `payments` | `status` | CASE → `requires_authorization` si pas encore avancé |
| `payments` | `updated_at` | NOW() |
| `bookings` | `payment_status` | CASE → `requires_authorization` si pas encore avancé |
| `bookings` | `updated_at` | NOW() |

---

## GET /payments/checkout/status/{session_id}

### Étape 1 — Lecture DB (double clé)

```sql
-- payment_routes.py:211–217
SELECT * FROM payments
WHERE stripe_checkout_session_id = $1
   OR stripe_payment_intent_id   = $1
LIMIT 1
```

> ℹ️ Le paramètre `session_id` peut être un `cs_...` ou un `pi_...`.
> Les deux champs sont indexés (ou devraient l'être).

---

### Étape 2 — Lecture booking (conditionnel)

```sql
-- payment_routes.py:247–249
SELECT status FROM bookings WHERE booking_id = $1
```

Exécuté uniquement si `s_status == 'complete' AND stripe_ps == 'unpaid'`.
Nécessaire pour distinguer instant_booking (`awaiting_payment`) vs manual_approval (`requested`).

---

### Étape 3 — Mutations selon état Stripe

#### Branche A — instant_booking (awaiting_payment)

```sql
-- payment_routes.py:259–272
BEGIN;
  UPDATE payments SET status='captured', updated_at=NOW() WHERE payment_id=$1;
  UPDATE bookings
  SET status='confirmed', payment_status='paid', updated_at=NOW()
  WHERE booking_id=$1
    AND status NOT IN ('confirmed','refused','cancelled','expired');
COMMIT;
```

**Guard `bookings`** : `status NOT IN ('confirmed','refused','cancelled','expired')` — idempotent.

#### Branche B — manual_approval (requested)

```sql
-- payment_routes.py:303–311
BEGIN;
  UPDATE payments SET status='authorized', updated_at=NOW() WHERE payment_id=$1;
  UPDATE bookings SET payment_status='authorized', updated_at=NOW() WHERE booking_id=$1;
COMMIT;
```

**Pas de guard booking** : bookings.status reste inchangé (receiver n'a pas encore accepté).

#### Branche C — stripe_ps='paid' (capture immédiate)

```sql
-- payment_routes.py:315–329
BEGIN;
  UPDATE payments SET status='captured', updated_at=NOW()
  WHERE payment_id=$1 AND status NOT IN ('captured',);

  UPDATE bookings
  SET status='confirmed', payment_status='paid', updated_at=NOW()
  WHERE booking_id=$1
    AND status NOT IN ('confirmed','refused','cancelled','expired');
COMMIT;
```

#### Branche D — session expirée

```sql
-- payment_routes.py:331–336
UPDATE payments SET status='cancelled', updated_at=NOW()
WHERE payment_id=$1
-- (pas de guard explicite sur payment.status dans Python)
```

> ⚠️ Pas de transaction ni de guard sur cette branche — UPDATE simple.

---

## Résumé des colonnes modifiées

| Endpoint | Table | Colonne | Valeur(s) |
|---|---|---|---|
| POST | `payments` | `stripe_checkout_session_id` | `cs_...` |
| POST | `payments` | `stripe_payment_intent_id` | `pi_...` ou NULL |
| POST | `payments` | `status` | CASE → `requires_authorization` |
| POST | `payments` | `updated_at` | NOW() |
| POST | `bookings` | `payment_status` | CASE → `requires_authorization` |
| POST | `bookings` | `updated_at` | NOW() |
| GET (A) | `payments` | `status` | `captured` |
| GET (A) | `bookings` | `status` | `confirmed` |
| GET (A) | `bookings` | `payment_status` | `paid` |
| GET (B) | `payments` | `status` | `authorized` |
| GET (B) | `bookings` | `payment_status` | `authorized` |
| GET (C) | `payments` | `status` | `captured` |
| GET (C) | `bookings` | `status` | `confirmed` |
| GET (C) | `bookings` | `payment_status` | `paid` |
| GET (D) | `payments` | `status` | `cancelled` |

---

## Transactions

| Opération | Transaction | Contenu |
|---|---|---|
| POST — UPDATE payments + bookings | OUI | Les deux UPDATEs ensemble |
| GET — Branche A (instant) | OUI | payments→captured + bookings→confirmed |
| GET — Branche B (manual) | OUI | payments→authorized + bookings→payment_status |
| GET — Branche C (paid) | OUI | payments→captured + bookings→confirmed |
| GET — Branche D (expired) | NON | payments→cancelled seul |
