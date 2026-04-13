# SLICE_13_DB_MAPPING.md — Mapping base de données
> Basé sur `booking_routes.py:430–521`, `_get_pay_now_minutes:56–66`, `001_initial_schema.sql`.
> Généré le 2026-02-XX.

---

## Tables impliquées

| Table | Opération | Condition |
|---|---|---|
| `bookings` | SELECT (lecture) + UPDATE (écriture) | Toujours |
| `services` | JOIN sur SELECT (lecture seule) | Toujours — pour `pay_later_expiration_minutes` |
| `payments` | SELECT (lecture PI) + UPDATE (Cas A uniquement) | SELECT : toujours — UPDATE : Cas A si payment_id non null |
| `app_config` | SELECT (lecture config) | Cas B + payment_mode='pay_now' uniquement |
| `service_slots` | UPDATE (conditionnel) | Si `slot_id` non null |

---

## Requête 1 — Lecture booking + service (JOIN)

```sql
SELECT b.booking_id, b.status, b.receiver_user_id, b.slot_id, b.expires_at,
       b.user_id AS payer_user_id,
       b.service_id, b.payment_mode,
       s.pay_later_expiration_minutes,
       s.booking_approval_mode
FROM bookings b
JOIN services s ON s.service_id = b.service_id
WHERE b.booking_id = $1
```

**Note :** JOIN `services` (pas LEFT JOIN) — le service doit exister. Si le service a été supprimé → résultat null → 404 (comportement Python).

**Colonnes lues :**
| Colonne DB | Alias | Utilisation |
|---|---|---|
| `b.booking_id` | `booking_id` | Identité |
| `b.status` | `status` | Idempotence + garde + TTL |
| `b.receiver_user_id` | `receiver_user_id` | Contrôle accès |
| `b.slot_id` | `slot_id` | UPDATE conditionnel service_slots |
| `b.expires_at` | `expires_at` | Garde TTL |
| `b.user_id` | `payer_user_id` | Destinataire push notification |
| `b.service_id` | `service_id` | Informationnel |
| `b.payment_mode` | `payment_mode` | Branchement Cas A/B |
| `s.pay_later_expiration_minutes` | `pay_later_expiration_minutes` | Expiry Cas B pay_later |
| `s.booking_approval_mode` | `booking_approval_mode` | Lu mais non utilisé dans accept |

**Note `booking_approval_mode` :** lu dans le SELECT mais **non utilisé dans la logique accept**. C'est un résidu du SELECT partagé avec d'autres routes. En Java : inclure dans la projection pour cohérence mais ignorer la valeur.

---

## Requête 2 — Lecture app_config (Cas B + pay_now uniquement)

```sql
SELECT config_value
FROM app_config
WHERE config_key = 'pay_now_checkout_minutes'
```

Résultat :
- Si trouvé → `int(config_value)` (peut lever ValueError → fallback 30)
- Si absent → `return DEFAULT_PAY_NOW_CHECKOUT_MINUTES = 30`

**En Java :** `Integer.parseInt()` avec try/catch → fallback 30 si absent ou non parseable.

---

## Requête 3 — Lecture payment (pré-transaction)

```sql
SELECT payment_id, stripe_payment_intent_id, status AS pay_status
FROM payments
WHERE booking_id = $1
LIMIT 1
```

**Colonnes lues :**
| Alias | Utilisation |
|---|---|
| `payment_id` | UPDATE payments (Cas A), si non null |
| `stripe_payment_intent_id` | Capture Stripe (Cas A) |
| `pay_status` | Détermination branche Cas A (== 'authorized') |

---

## Transactions par cas

### Cas A — Transaction atomique (3 instructions)

```sql
-- UPDATE 1 : bookings → confirmed (3 champs modifiés + updated_at)
UPDATE bookings
SET status = 'confirmed',
    payment_status = 'captured',
    expires_at = NULL,
    updated_at = NOW()
WHERE booking_id = $1

-- UPDATE 2 : payments → captured (si payment_id non null)
UPDATE payments
SET status = 'captured',
    updated_at = NOW()
WHERE payment_id = $1   ← payment_id (pas booking_id)

-- UPDATE 3 : service_slots → booked (si slot_id non null)
UPDATE service_slots
SET slot_status = 'booked'
WHERE slot_id = $1
  AND slot_status IN ('pending', 'available', 'reserved')
```

**Note UPDATE payments :** filtre sur `payment_id` (PK) — pas de filtre sur statut courant.

**Note UPDATE service_slots :** `IN ('pending', 'available', 'reserved')` — 3 états acceptables pour `booked`. Comportement différent de `/refuse` qui n'acceptait que `pending`.

---

### Cas B — Transaction atomique (2 instructions)

```sql
-- UPDATE 1 : bookings → awaiting_payment + expires_at calculé
UPDATE bookings
SET status = 'awaiting_payment',
    expires_at = $2,               ← datetime calculée côté application
    updated_at = NOW()
WHERE booking_id = $1

-- UPDATE 2 : service_slots → reserved (si slot_id non null)
UPDATE service_slots
SET slot_status = 'reserved'       ← 'reserved' (pas 'booked')
WHERE slot_id = $1
  AND slot_status IN ('pending', 'available')   ← seulement 2 états (pas 'reserved')
```

**Note :** pas d'UPDATE `payments` en Cas B.

---

## Calcul `expires_at` en Cas B (côté application)

```python
# booking_routes.py:501–506
if payment_mode == "pay_now":
    pay_expiry_minutes = await _get_pay_now_minutes(conn)  # SELECT app_config
else:  # pay_later
    pay_expiry_minutes = int(bk.get("pay_later_expiration_minutes") or DEFAULT_PAY_LATER_MINUTES)

new_expires_at = datetime.now(timezone.utc) + timedelta(minutes=pay_expiry_minutes)
pay_expiry_interval = f"{pay_expiry_minutes} minutes"
```

**Sources d'expiry :**
| payment_mode | Source | Fallback |
|---|---|---|
| `pay_now` | `app_config.pay_now_checkout_minutes` | `30` (DEFAULT_PAY_NOW_CHECKOUT_MINUTES) |
| `pay_later` | `services.pay_later_expiration_minutes` (du JOIN) | `1440` (DEFAULT_PAY_LATER_MINUTES) |

---

## Séquence complète d'exécution

```
1. acquire connexion pool
2. SELECT booking + service (JOIN)       ← pré-transaction
3. Contrôle accès (memory)
4. Idempotence check (memory)
5. Garde statut (memory)
6. Garde TTL expires_at (memory)
7. SELECT payment (pi_id, pay_status)    ← pré-transaction
8a. Si Cas A (pay_now + authorized):
    8a1. BEGIN TRANSACTION
         UPDATE bookings → confirmed + captured + expires_at=NULL
         UPDATE payments → captured (si payment_id)
         UPDATE service_slots → booked (si slot_id)
    8a2. COMMIT
9a. Stripe capture_payment_intent [HORS TRANSACTION]
10a. push "confirmée" [fire-and-forget]

8b. Si Cas B (autres):
    8b1. SELECT app_config pay_now_checkout_minutes (si pay_now) ← pré-transaction
    8b2. Calcul new_expires_at (memory)
    8b3. BEGIN TRANSACTION
         UPDATE bookings → awaiting_payment + expires_at
         UPDATE service_slots → reserved (si slot_id)
    8b4. COMMIT
10b. push "acceptée paiement requis" [fire-and-forget]

11. return HTTP 200
```

---

## Mapping réponse

| Cas | Champ réponse | Valeur |
|---|---|---|
| A | `success` | `true` |
| A | `status` | `"confirmed"` |
| A | `booking_id` | path param |
| A | `payment_mode` | `bk["payment_mode"]` ou `"pay_now"` |
| A | `payment_captured` | `true` |
| B | `success` | `true` |
| B | `status` | `"awaiting_payment"` |
| B | `booking_id` | path param |
| B | `payment_mode` | `bk["payment_mode"]` ou `"pay_now"` |
| B | `pay_expiry_interval` | `"30 minutes"` (format string) |
| Idempotent | `success` | `true` |
| Idempotent | `status` | `bk["status"]` (état réel actuel) |
| Idempotent | `booking_id` | path param |
| Idempotent | `idempotent` | `true` |
