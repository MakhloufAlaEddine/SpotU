# SLICE_15_DB_MAPPING.md — Mapping DB de la Slice 15
> Basé sur `booking_routes.py:798–876`.
> Généré le 2026-02-XX.

---

## Tables utilisées

| Table | Opération | Rôle |
|---|---|---|
| `bookings` | SELECT (LEFT JOIN payments) + UPDATE | Lecture contrôle d'accès + statut + UPDATE cancellation |
| `payments` | LEFT JOIN lecture + UPDATE conditionnel | Lecture pay_status/stripe_ids + UPDATE statut |
| `service_slots` | UPDATE conditionnel | Libération créneau → `available` |

---

## Étape 0 — Lecture initiale (LEFT JOIN)

```sql
-- booking_routes.py:800–809
SELECT b.booking_id, b.status, b.user_id, b.slot_id,
       b.payer_user_id, b.receiver_user_id, b.service_id,
       p.status AS pay_status, p.payment_id,
       p.stripe_payment_intent_id, p.stripe_charge_id
FROM bookings b
LEFT JOIN payments p ON p.booking_id = b.booking_id
WHERE b.booking_id = $1
LIMIT 1
```

**Colonnes lues :**

| Colonne | Source | Usage |
|---|---|---|
| `booking_id` | `bookings` | Confirmation + réponse |
| `status` | `bookings` | Vérification idempotence + états non annulables |
| `user_id` | `bookings` | Vérification `is_payer` (legacy) |
| `payer_user_id` | `bookings` | Vérification `is_payer` |
| `receiver_user_id` | `bookings` | Vérification `is_receiver` |
| `slot_id` | `bookings` | UPDATE service_slots si non NULL |
| `service_id` | `bookings` | Présent dans SELECT, non utilisé directement |
| `pay_status` | `payments` (LEFT JOIN) | Matrice décision payment |
| `payment_id` | `payments` (LEFT JOIN) | UPDATE payments (si présent) |
| `stripe_payment_intent_id` | `payments` (LEFT JOIN) | Stripe PI cancel |
| `stripe_charge_id` | `payments` (LEFT JOIN) | Stripe refund |

> ⚠️ **LEFT JOIN** : si aucun enregistrement `payments` pour ce booking, tous les champs payments sont `NULL`.
> `pay_status = None`, `payment_id = None`, `pi_id = None`, `charge_id = None`.

---

## Matrice de décision payment

```python
# booking_routes.py:847–852
if pay_status in ("requires_authorization", "authorized", "capture_pending"):
    new_pay_status = "cancelled"
elif pay_status == "captured":
    new_pay_status = "refunded"
else:
    new_pay_status = pay_status  # pending / failed / None → pas de changement
```

| `pay_status` actuel | `new_pay_status` | Action Stripe |
|---|---|---|
| `requires_authorization` | `cancelled` | `cancel_payment_intent(pi_id)` (si pi_id présent) |
| `authorized` | `cancelled` | `cancel_payment_intent(pi_id)` (si pi_id présent) |
| `capture_pending` | `cancelled` | `cancel_payment_intent(pi_id)` (si pi_id présent) |
| `captured` | `refunded` | `create_refund(charge_id)` (si charge_id présent) |
| `pending` | inchangé | Aucune action Stripe |
| `failed` | inchangé | Aucune action Stripe |
| `NULL` (pas de payment) | inchangé | Aucune action Stripe |
| `refunded` | inchangé | Aucune action Stripe |
| `cancelled` | inchangé | Aucune action Stripe |

---

## Transaction atomique (3 UPDATEs)

```python
# booking_routes.py:854–875
async with conn.transaction():
    # UPDATE 1 — booking
    await conn.execute(...)
    # UPDATE 2 — payment (conditionnel)
    if bk.get("payment_id") and new_pay_status != pay_status:
        await conn.execute(...)
    # UPDATE 3 — slot (conditionnel)
    if bk["slot_id"]:
        await conn.execute(...)
```

### UPDATE 1 — bookings (toujours exécuté)

```sql
-- booking_routes.py:855–863
UPDATE bookings
SET status                 = 'cancelled',
    cancelled_by_user_id   = $2,
    cancellation_reason    = $3,
    updated_at             = NOW()
WHERE booking_id = $1
```

**Paramètres :**
- `$1` = booking_id
- `$2` = uid (l'utilisateur qui annule)
- `$3` = cancel_reason (peut être NULL)

**Colonnes modifiées :**

| Colonne | Valeur |
|---|---|
| `status` | `'cancelled'` |
| `cancelled_by_user_id` | `user_id` de l'appelant |
| `cancellation_reason` | Raison (NULL si non fournie) |
| `updated_at` | `NOW()` |

---

### UPDATE 2 — payments (conditionnel)

```sql
-- booking_routes.py:865–868
UPDATE payments
SET status     = $1,
    updated_at = NOW()
WHERE payment_id = $2
```

**Condition d'exécution :** `bk.get("payment_id") AND new_pay_status != pay_status`
- `payment_id` doit être non NULL (payment existe)
- Le statut doit avoir changé (évite un UPDATE inutile)

**Paramètres :**
- `$1` = new_pay_status
- `$2` = payment_id (depuis le LEFT JOIN)

> ⚠️ UPDATE par `payment_id` (PK directe), **pas** par `booking_id`.

---

### UPDATE 3 — service_slots (conditionnel)

```sql
-- booking_routes.py:870–874
UPDATE service_slots
SET slot_status = 'available'
WHERE slot_id = $1
  AND slot_status IN ('pending', 'reserved', 'booked')
```

**Condition d'exécution :** `bk["slot_id"]` est non NULL

**Paramètre :**
- `$1` = slot_id

**États source acceptés :** `pending`, `reserved`, `booked` → libération complète du créneau.

> ℹ️ Comparaison avec les autres slices :
> - `/refuse` libère seulement `pending`
> - `/accept` libère `pending`/`available`/`reserved`
> - `/cancel` libère `pending`, `reserved` **ET `booked`** — le scope le plus large

---

## Stripe — HORS TRANSACTION

Les appels Stripe sont effectués APRÈS le `conn.transaction()`, dans des blocs `try/except` séparés.

```python
# booking_routes.py:877–911
stripe_action: str | None = None
pi_id     = bk.get("stripe_payment_intent_id")
charge_id = bk.get("stripe_charge_id")

if new_pay_status == "cancelled" and pi_id:
    try:
        await stripe_service.cancel_payment_intent(pi_id, reason="cancelled")
        stripe_action = "pi_cancelled"
    except Exception as exc:
        log.error(...)

elif new_pay_status == "refunded":
    if charge_id:
        try:
            await stripe_service.create_refund(
                charge_id=charge_id,
                reason="requested_by_customer",
                idempotency_key=booking_id,
            )
            stripe_action = "refund_created"
        except Exception as exc:
            log.error(...)
    else:
        log.warning("Paiement capturé sans stripe_charge_id — remboursement manuel requis ...")
```

**Points critiques :**
- Si `cancel_payment_intent` échoue → `stripe_action` reste `None`, la DB est déjà `cancelled`
- Si `create_refund` échoue → `stripe_action` reste `None`, la DB est déjà `refunded`
- Si `captured` mais pas de `charge_id` → log WARNING uniquement, pas d'exception
- `idempotency_key` du refund = `booking_id` (prévient les doubles remboursements)

---

## Résumé des modifications DB

| Table | Colonne | Avant | Après | Condition |
|---|---|---|---|---|
| `bookings` | `status` | _toute valeur_ | `cancelled` | Toujours |
| `bookings` | `cancelled_by_user_id` | NULL | `user_id` de l'appelant | Toujours |
| `bookings` | `cancellation_reason` | NULL | raison (nullable) | Toujours |
| `bookings` | `updated_at` | ancien | `NOW()` | Toujours |
| `payments` | `status` | voir matrice | `cancelled` ou `refunded` | Si payment existe ET status change |
| `payments` | `updated_at` | ancien | `NOW()` | Si payment mis à jour |
| `service_slots` | `slot_status` | pending/reserved/booked | `available` | Si slot_id non NULL |
