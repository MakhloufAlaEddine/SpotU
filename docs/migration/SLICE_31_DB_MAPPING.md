# SLICE_31_DB_MAPPING.md — Mapping DB Checkout Status
> Basé sur `payment_routes.py:195–351`.
> Généré le 2026-04-20.

---

## Tables impliquées (3)

| Table | Rôle | Opérations Slice 31 |
|---|---|---|
| `payments` | Paiement lié au booking | SELECT (lookup par session OR intent), UPDATE status/updated_at (3 branches) |
| `bookings` | Réservation | SELECT status (pour discriminer instant vs manual), UPDATE status/payment_status/updated_at (2 branches) |
| `services` | Service (pour push) | SELECT title (1 branche : instant_booking captured) |

> Pas de table `users` en SELECT direct (push_service résout le push token interne).

---

## Table `payments` — colonnes utilisées

### Lecture initiale (lookup)

```sql
SELECT *                         -- Toutes les colonnes (SELECT *)
  FROM payments
 WHERE stripe_checkout_session_id = $1
    OR stripe_payment_intent_id   = $1
 LIMIT 1
```

Colonnes consommées ensuite par le code :

| Colonne | Type PG | Usage |
|---|---|---|
| `payment_id` | TEXT (PK) | WHERE des UPDATEs + réponse JSON |
| `booking_id` | TEXT NULL | Discriminer présence booking + réponse JSON |
| `payer_user_id` | TEXT | SELECT pour push (branche 1 instant) |
| `receiver_user_id` | TEXT | SELECT pour push (branche 1 instant) |
| `stripe_checkout_session_id` | TEXT NULL | Lookup + `real_session_id` pour Stripe retrieve |
| `stripe_payment_intent_id` | TEXT NULL | Lookup rétrocompat |
| `status` | TEXT | Guards + transitions (3 branches) |
| `payer_total_amount` | NUMERIC | Fallback amount si Stripe session incomplète |
| `currency` | TEXT | Fallback currency |

### UPDATE — 4 variantes selon branche

#### Branche 1-A (instant_booking → captured)
```sql
UPDATE payments
   SET status     = 'captured',
       updated_at = NOW()
 WHERE payment_id = $1
```

#### Branche 1-B (manual_approval → authorized)
```sql
UPDATE payments
   SET status     = 'authorized',
       updated_at = NOW()
 WHERE payment_id = $1
```

#### Branche 2 (stripe_ps='paid' → captured)
```sql
UPDATE payments
   SET status     = 'captured',
       updated_at = NOW()
 WHERE payment_id = $1
```

#### Branche 3 (session expired → cancelled)
```sql
UPDATE payments
   SET status     = 'cancelled',
       updated_at = NOW()
 WHERE payment_id = $1
```

> ⚠️ **Aucun garde `WHERE status NOT IN (...)`** sur les UPDATEs payments (contraste avec bookings). Un appel re-déclenché peut écraser un status plus avancé (ex: passer de 'captured' à 'authorized' si logique mal aiguillée). **Compat stricte** = ne pas ajouter de garde. Le contrôle est fait par le `if db_status NOT IN (...)` **avant** l'UPDATE au niveau Python, pas au niveau SQL.

### Re-SELECT après UPDATE (branche 1-A instant)

```sql
SELECT payer_user_id, receiver_user_id
  FROM payments
 WHERE payment_id = $1
```

Cette re-lecture n'apporte rien (les valeurs sont déjà dans `payment` dict). **Code Python sous-optimal mais à reproduire.**

---

## Table `bookings` — colonnes utilisées

### Lecture guard (avant branches)

```sql
SELECT status
  FROM bookings
 WHERE booking_id = $1
```

Uniquement si `payment.booking_id` est présent. Utilisé pour discriminer instant (status='awaiting_payment') vs manual (status='requested').

### UPDATE — 2 variantes

#### Branche 1-A et Branche 2 (instant → confirmed + paid)
```sql
UPDATE bookings
   SET status         = 'confirmed',
       payment_status = 'paid',
       updated_at     = NOW()
 WHERE booking_id = $1
   AND status NOT IN ('confirmed','refused','cancelled','expired')
```

> **Garde anti-régression** : ne passe pas `refused/cancelled/expired` vers `confirmed`. Ne re-confirme pas un booking déjà `confirmed`.

#### Branche 1-B (manual → payment_status uniquement)
```sql
UPDATE bookings
   SET payment_status = 'authorized',
       updated_at     = NOW()
 WHERE booking_id = $1
```

> ⚠️ **Pas de garde WHERE status NOT IN (...)** ici (contraste avec 1-A et 2). Un booking 'cancelled' pourrait voir son `payment_status` mis à 'authorized'. **Compat stricte** = reproduire.

---

## Table `services` — lecture title

### Pour push notifications (branche 1-A instant captured)

```sql
SELECT s.title
  FROM bookings b
  JOIN services s ON b.service_id = s.service_id
 WHERE b.booking_id = $1
```

Fallback si row absente : `"votre prestation"`.

---

## Diagramme décisionnel

```
  [GET /payments/checkout/status/{session_id}]
            │
            ├── Auth try/except (optionnelle)
            │
            ├── SELECT payments (session_id OR intent_id) → payment
            │     └─ 404 si absent
            │
            ├── retrieve Stripe session (try/except)
            │     └─ Si échec → return JSON fallback "unknown"
            │
            ├── SELECT bookings.status (si booking_id) → bk_row
            │
            ├── Décision :
            │     ┌─ s_status='complete' AND stripe_ps='unpaid'
            │     │  AND db_status ∉ {authorized, captured, paid}
            │     │     │
            │     │     ├─ is_instant (bk_row.status='awaiting_payment') :
            │     │     │     Tx : UPDATE payments→captured
            │     │     │           UPDATE bookings→confirmed/paid (guardé)
            │     │     │     Push payer "Réservation confirmée !" (await)
            │     │     │     Push receiver "Nouvelle réservation !" (await)
            │     │     │     db_status = 'captured'
            │     │     │
            │     │     └─ else (manual_approval + pay_now) :
            │     │           Tx : UPDATE payments→authorized
            │     │                 UPDATE bookings→payment_status=authorized (non-guardé)
            │     │           db_status = 'authorized'
            │     │
            │     ├─ stripe_ps='paid' AND db_status ≠ 'captured'
            │     │     Tx : UPDATE payments→captured
            │     │           UPDATE bookings→confirmed/paid (guardé)
            │     │     db_status = 'captured'
            │     │
            │     ├─ s_status='expired' AND db_status='authorized'
            │     │     UPDATE payments→cancelled  (⚠️ PAS dans une transaction explicite)
            │     │     db_status = 'cancelled'
            │     │
            │     └─ else : aucun UPDATE
            │
            └── return JSON (payment_id, booking_id, session_id, status, payment_status,
                             stripe_status, amount, currency)
```

---

## Transactionnalité

| Branche | Transaction explicite Python ? | À faire en Java |
|---|---|---|
| 1-A instant | **OUI** (`async with conn.transaction()` autour UPDATE payments + UPDATE bookings) | `@Transactional` englobant les 2 UPDATE |
| 1-B manual | **OUI** idem | `@Transactional` |
| 2 | **OUI** idem | `@Transactional` |
| 3 (expired) | **NON** — UPDATE direct sans `conn.transaction()` | Transaction simple (un seul UPDATE — pas d'impact) |

### Push notifications (branche 1-A)
- `await send_push_to_user(...)` × 2 **après fin de transaction** (hors `async with conn.transaction()`).
- **SYNC (bloquant)** — pas fire-and-forget. Si push 1 fail → push 2 n'est pas tenté (short-circuit).

### Java — recommandation
```java
@Transactional
public CheckoutStatusResponse updateAndReturn(...) {
    // UPDATE payments
    // UPDATE bookings
    // (retour des user_ids pour push)
}
// Puis HORS @Transactional :
pushService.sendPush(payerId, ...);   // sync await
pushService.sendPush(receiverId, ...);
```

---

## Ordre des requêtes SQL (critique)

```
1. SELECT payments (lookup)
2. [Stripe retrieve — externe]
3. SELECT bookings.status (si booking_id)
4. [conditionnel] BEGIN
     UPDATE payments
     UPDATE bookings
   COMMIT
5. [conditionnel branche 1-A] SELECT payments (re-lecture inutile mais présente)
6. [conditionnel branche 1-A] SELECT bookings JOIN services (pour push title)
7. [conditionnel branche 1-A] push × 2
8. return JSON
```

**Java doit reproduire cet ordre** (y compris la re-lecture inutile #5 pour compat bit-pour-bit des logs/traces).

---

## Gardes WHERE — récapitulatif

| Table | UPDATE | Garde WHERE |
|---|---|---|
| payments (1-A instant) | status='captured' | **aucun garde** (contrôle via `if db_status NOT IN (...)` Python en amont) |
| payments (1-B manual) | status='authorized' | aucun |
| payments (branche 2) | status='captured' | aucun |
| payments (branche 3) | status='cancelled' | aucun |
| bookings (1-A + branche 2) | status=confirmed, payment_status=paid | `WHERE status NOT IN ('confirmed','refused','cancelled','expired')` |
| bookings (1-B) | payment_status=authorized | **aucun garde sur status** |

---

## `amount` — calcul et fallback

### Stripe Session object
- `session.amount_total` : int, en cents (ex: `5175` pour 51.75 EUR). Peut être `None` si session pas encore complète.

### Calcul
```python
amount = session.amount_total / 100 if session.amount_total else float(payment["payer_total_amount"])
```

- **Division entière vs flottante** : Python 3 → `5175 / 100 = 51.75` (float, pas 51). OK.
- Fallback `payment.payer_total_amount` : NUMERIC DB → converti en `float` explicitement.
- Java : `session.getAmountTotal()` retourne `Long`. Conversion : `new BigDecimal(amountTotal).divide(new BigDecimal(100))` OU `amountTotal / 100.0` si on retourne en float.

### Précision
Compat stricte : float (Python) vs BigDecimal (Java JPA). **Tester la sérialisation JSON** pour garantir `51.75` et pas `51.749999...`.

---

## `currency` — source chain

```python
currency = session.currency or payment.get("currency", "EUR")
```

- `session.currency` (Stripe) → **lowercase** (`"eur"`)
- `payment.currency` (DB) → **uppercase** (`"EUR"`)
- Fallback final : `"EUR"` (littéral uppercase)

### Conséquence
La réponse peut contenir soit `"eur"` soit `"EUR"` selon la source. **Le front doit être case-insensitive.** Java : **ne pas normaliser** — garder la casse exacte retournée par Stripe/DB.

---

## Incertitudes / zones grises

| Zone | Question | Action |
|---|---|---|
| `session.payment_status` values exactes | `"paid"` / `"unpaid"` / `"no_payment_required"` | Documenté Stripe — [Stripe Checkout Session Object](https://stripe.com/docs/api/checkout/sessions/object) |
| `session.status` values | `"open"` / `"complete"` / `"expired"` | idem |
| `bookings.status` complet | Enum Python `BookingStatus` (models.py:30) | À croiser avec les slices bookings |
| Le re-SELECT payments branche 1-A | Inutile techniquement | **Garder pour compat stricte**. Pas d'optim. |
| Comportement si `pi_...` en param pour Stripe retrieve | Stripe throw → fallback "unknown" | Testable via mock |
| `session.amount_total=0` | float(0) → 0.0, `or` vaudra falsy → fallback DB | Edge case : Python `0 / 100 = 0.0` mais `if session.amount_total` = False (0 est falsy) → **prend fallback DB**. À reproduire. |
| Typing `session` (Python stripe lib) | Objet avec attributs, pas dict | Java utilise stripe-java récent, attributs typés |

---

## Cas limite `amount_total == 0`

Python :
```python
amount = session.amount_total / 100 if session.amount_total else float(payment["payer_total_amount"])
```

Si `session.amount_total = 0` → l'expression `0` est falsy → branche `else` → `float(payment.payer_total_amount)`.

**Java équivalent** :
```java
long at = session.getAmountTotal() != null ? session.getAmountTotal() : 0L;
double amount = at > 0 ? at / 100.0 : payment.payerTotalAmount().doubleValue();
```

⚠️ `!= null` seul ne suffit pas — il faut `> 0` pour match la falsy check Python.
