# SLICE_30_DB_MAPPING.md — Mapping DB Booking Create + Pay
> Basé sur `booking_routes.py:115–382, 558–670`, `pricing_engine.py:36–143`.
> Généré le 2026-04-20.

---

## Tables impliquées (6)

| Table | Rôle | Opérations Slice 30 |
|---|---|---|
| `bookings` | Entité booking principale | INSERT (request), SELECT (request idempotence + pay guard), UPDATE (pay) |
| `payments` | Enregistrement paiement couplé 1-1 booking | INSERT (request), SELECT (pay), UPDATE (pay — stripe IDs + status) |
| `service_slots` | Créneaux réservables | SELECT FOR UPDATE NOWAIT (request), UPDATE (request) |
| `services` | Offre de service + config workflow | SELECT (preview, request) |
| `app_config` | Flags et paramètres globaux plateforme | SELECT (request, pay) |
| `users` | Utilisateurs | SELECT `name` (request, post-commit pour push) |

---

## Table `bookings` — colonnes utilisées

### Schéma effectif (déduit du code + des enum `BookingStatus`)

| Colonne | Type PG | Lecture | INSERT request | UPDATE pay | Notes |
|---|---|---|---|---|---|
| `booking_id` | TEXT (PK) | WHERE | ✅ `new_id("bkg")` | WHERE | Ex: `"bkg_8f2e..."` |
| `service_id` | TEXT (FK services) | — | ✅ | — | |
| `user_id` | TEXT (FK users) | fallback pay | ✅ = payer | — | Alias legacy du payer |
| `coach_id` | TEXT (FK users) | — | ✅ = receiver | — | Alias legacy du receiver |
| `status` | TEXT | guard pay | ✅ `'awaiting_payment'` OR `'requested'` | — | Enum `BookingStatus` (models.py:30) |
| `scheduled_at` | TIMESTAMPTZ NULL | — | ✅ (body) | — | |
| `slot_id` | TEXT NULL (FK service_slots) | idempotence | ✅ (body) | — | |
| `location_id` | TEXT NULL | — | ✅ (body) | — | |
| `notes` | TEXT NULL | — | ✅ (body) | — | |
| `amount` | NUMERIC | — | ✅ = pricing.payer_total_amount | — | Total payeur |
| `payment_status` | TEXT | — | ✅ `'pending'` (littéral) | ✅ `'requires_authorization'` | **Hardcodé 'pending'** à l'INSERT ≠ `PaymentStatus.PENDING` |
| `payer_user_id` | TEXT | fallback pay | ✅ = payer | — | |
| `receiver_user_id` | TEXT | — | ✅ = coach_id | — | |
| `pricing_snapshot` | JSONB | _deserialize | ✅ `json.dumps(snap)` | — | Clé du contrat — cf. §Pricing |
| `idempotency_key` | TEXT UNIQUE NULL | idempotence 1 | ✅ (body) | — | UNIQUE INDEX |
| `currency` | TEXT | — | ✅ `'EUR'` (littéral) | — | |
| `created_at` | TIMESTAMPTZ | — | (default NOW()) | — | Colonne auto |
| `updated_at` | TIMESTAMPTZ | — | (default NOW()) | ✅ NOW() | |
| `expires_at` | TIMESTAMPTZ NULL | guard pay | ✅ calculé | — | TTL booking/paiement |
| `cancelled_by_user_id` | TEXT NULL | — | NULL | — | Slice cancel future |
| `cancellation_reason` | TEXT NULL | — | NULL | — | Slice cancel future |
| `payment_mode` | TEXT | — | ✅ `"pay_now"` / `"pay_later"` | — | Scope pricing et expiration |

### SQL INSERT bookings (request) — **bit-pour-bit**

```sql
INSERT INTO bookings
  (booking_id, service_id, user_id, coach_id, status,
   scheduled_at, slot_id, location_id, notes, amount,
   payer_user_id, receiver_user_id, pricing_snapshot,
   payment_status, currency, idempotency_key,
   payment_mode, expires_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
        'pending','EUR',$14,$15,$16)
```

- `payment_status` et `currency` sont **hardcodés** dans le VALUES, pas en paramètres. Ne pas confondre avec la colonne `payments.currency` qui EST paramétrée.
- `pricing_snapshot` passé en **`json.dumps(...)`** (string), pas object asyncpg — implicit cast vers JSONB.

### SQL UPDATE bookings (pay)

```sql
UPDATE bookings
   SET payment_status = 'requires_authorization',
       updated_at     = NOW()
 WHERE booking_id     = $1
   AND payment_status NOT IN ('authorized','captured','paid')
```

- Garde défensive : ne **rétrograde pas** un booking déjà payé.

---

## Table `payments` — colonnes utilisées

### Schéma effectif (20 colonnes dans l'INSERT)

| Colonne | Type PG | INSERT request | UPDATE pay | Notes |
|---|---|---|---|---|
| `payment_id` | TEXT (PK) | ✅ `new_id("pay")` | WHERE | |
| `payer_user_id` | TEXT | ✅ | — | |
| `receiver_user_id` | TEXT | ✅ | — | |
| `product_type` | TEXT | ✅ `'service_booking'` | — | Scope pricing |
| `product_id` | TEXT | ✅ = service_id | — | |
| `booking_id` | TEXT (FK bookings) | ✅ | WHERE | 1-1 relation logique |
| `stripe_payment_intent_id` | TEXT NULL | ✅ NULL à l'INSERT (via `to_payment_dict`) | ✅ COALESCE | Peut être set par pay |
| `stripe_charge_id` | TEXT NULL | ✅ NULL | — | Populé par webhook |
| `stripe_transfer_id` | TEXT NULL | ✅ NULL | — | Populé par webhook Connect |
| `stripe_checkout_session_id` | TEXT NULL | (pas dans INSERT — colonne seulement en UPDATE pay) | ✅ | |
| `status` | TEXT | ✅ `'requires_authorization'` | ✅ CASE (voir SQL ci-dessous) | Enum `PaymentStatus` |
| `currency` | TEXT | ✅ `'EUR'` (via pricing.currency) | — | |
| `base_amount` | NUMERIC | ✅ | — | |
| `payer_fixed_fee` | NUMERIC | ✅ | — | |
| `payer_percent_fee_amount` | NUMERIC | ✅ | — | |
| `receiver_fixed_fee` | NUMERIC | ✅ | — | |
| `receiver_percent_fee_amount` | NUMERIC | ✅ | — | |
| `platform_total_fee` | NUMERIC | ✅ | — | = payer_fees + receiver_fees |
| `receiver_net_amount` | NUMERIC | ✅ | — | = base_amount - receiver_fees |
| `payer_total_amount` | NUMERIC | ✅ | — | = base_amount + payer_fees |
| `pricing_rule_snapshot` | JSONB | ✅ `json.dumps(...)` | — | Règle DB utilisée, traçabilité |
| `updated_at` | TIMESTAMPTZ | (default NOW()) | ✅ NOW() | |

### SQL INSERT payments (request) — 20 paramètres

```sql
INSERT INTO payments (
    payment_id, payer_user_id, receiver_user_id,
    product_type, product_id, booking_id,
    stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id,
    status, currency,
    base_amount, payer_fixed_fee, payer_percent_fee_amount,
    receiver_fixed_fee, receiver_percent_fee_amount,
    platform_total_fee, receiver_net_amount, payer_total_amount,
    pricing_rule_snapshot
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          $12,$13,$14,$15,$16,$17,$18,$19,$20)
```

### SQL UPDATE payments (pay) — CASE pour status

```sql
UPDATE payments
   SET stripe_checkout_session_id = $1,
       stripe_payment_intent_id   = COALESCE($2, stripe_payment_intent_id),
       status                      = CASE
           WHEN status NOT IN ('requires_authorization','authorized','captured')
             THEN 'requires_authorization'
           ELSE status
       END,
       updated_at                  = NOW()
 WHERE payment_id = $3
```

- **COALESCE sur `stripe_payment_intent_id`** : ne pas écraser une valeur existante avec NULL si la session Stripe renvoyée n'a pas (encore) de `payment_intent`.
- **CASE sur `status`** : ne pas rétrograder un status plus avancé.

---

## Table `service_slots` — verrou critique

### Schéma effectif (colonnes lues/écrites)

| Colonne | Type PG | Lecture | Écriture | Notes |
|---|---|---|---|---|
| `slot_id` | TEXT (PK) | WHERE | WHERE | |
| `slot_type` | TEXT | ✅ | — | Enum : `'single'`, `'specific'`, `'recurring'` — seuls `single`/`specific` sont verrouillés |
| `slot_status` | TEXT | ✅ guard | ✅ transition | Enum `SlotStatus` : `available`, `pending`, `reserved`, `booked`, `completed` |

### SQL SELECT FOR UPDATE NOWAIT (request)

```sql
SELECT slot_id, slot_type, slot_status
  FROM service_slots
 WHERE slot_id = $1
   FOR UPDATE NOWAIT
```

- **Lock pessimiste** : bloque le slot pour d'autres transactions jusqu'au commit.
- **NOWAIT** : si déjà locked → `asyncpg.LockNotAvailableError` **immédiate** (PostgreSQL SQLState `55P03`).
- **→ HTTP 409** `"Ce créneau est en cours de réservation — réessayez"` (cas concurrence).

### SQL UPDATE service_slots (request)

```sql
UPDATE service_slots
   SET slot_status = $1   -- 'reserved' (instant_booking) OR 'pending' (manual_approval)
 WHERE slot_id     = $2
```

- **Uniquement pour `slot_type ∈ ('single','specific')`**. Les slots `recurring` ne sont pas verrouillés (capacité illimitée logique — hors périmètre).

### Matrice de transitions slot

| slot_type | Avant | Après create | Condition |
|---|---|---|---|
| `single` / `specific` | `available` | `pending` | `approval_mode='manual_approval'` |
| `single` / `specific` | `available` | `reserved` | `approval_mode='instant_booking'` |
| `recurring` | (non touché) | (non touché) | — |

---

## Table `services` — config source

### Colonnes lues

| Colonne | Type PG | Preview | Request | Pay | Notes |
|---|---|---|---|---|---|
| `service_id` | TEXT (PK) | WHERE | WHERE | via JOIN (_fetch_booking uniquement) | |
| `coach_id` | TEXT | ✅ | ✅ | — | `receiver_user_id` |
| `price` | NUMERIC | ✅ | ✅ `base_amount` | — | |
| `active` | BOOLEAN | WHERE=TRUE | WHERE=TRUE | — | Filtre inactifs |
| `booking_approval_mode` | TEXT | — | ✅ | — | `'manual_approval'` / `'instant_booking'` |
| `allow_pay_later` | BOOLEAN | — | ✅ | — | |
| `pay_later_expiration_minutes` | INT NULL | — | ✅ | — | Fallback 1440 (24h) |

### SQL SELECT services (request)

```sql
SELECT service_id, coach_id, price,
       booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
  FROM services
 WHERE service_id = $1
   AND active     = TRUE
```

### SQL SELECT services (preview)

```sql
SELECT service_id, coach_id, price
  FROM services
 WHERE service_id = $1
   AND active     = TRUE
```

> Projections **distinctes** — Java doit faire 2 requêtes différentes, pas une projection universelle.

---

## Table `app_config` — flags globaux

| Clé | Valeur attendue | Utilisé par | Effet |
|---|---|---|---|
| `enable_manual_approval_for_services` | `'true'` / `'false'` (string) | request | Si `'false'` → force `approval_mode='instant_booking'` même si le service est `manual_approval` |
| `enable_pay_later_for_services` | `'true'` / `'false'` | request | Si `'false'` → `allow_pay_later=false` + demande `pay_later` = 409 |
| `pay_now_checkout_minutes` | int (string) | request, pay (via accept) | TTL pour flux pay_now (défaut 30) |

### SQL SELECT flags (request)

```sql
SELECT config_key, config_value
  FROM app_config
 WHERE config_key IN ('enable_manual_approval_for_services','enable_pay_later_for_services')
```

### SQL SELECT pay_now_minutes

```sql
SELECT config_value
  FROM app_config
 WHERE config_key = 'pay_now_checkout_minutes'
```

> Note Java : parser en string puis convertir int. Un `ValueError`/`TypeError` → retourner le défaut **silencieusement** (cf. `_get_pay_now_minutes` lignes 56–66). Ne pas lever d'erreur.

---

## Table `users` — read-only post-commit

### SQL SELECT (request, post-transaction, pour push)

```sql
SELECT name FROM users WHERE user_id = $1
```

Fallback si row absente : `"Un utilisateur"`.

---

## Le `pricing_snapshot` JSONB (contrat clé)

### Format produit par `PricingResult.to_snapshot()` (pricing_engine.py)

```json
{
  "base_amount":                50.00,
  "payer_fixed_fee":             0.50,
  "payer_percent_fee_amount":    1.25,
  "receiver_fixed_fee":          0.00,
  "receiver_percent_fee_amount": 2.50,
  "platform_total_fee":          4.25,
  "receiver_net_amount":         47.50,
  "payer_total_amount":          51.75,
  "currency":                    "EUR",
  "product_type":                "service_booking"
}
```

- **Sérialisé via `json.dumps(...)`** → la colonne `bookings.pricing_snapshot` contient la string JSON (asyncpg cast JSONB auto).
- **Désérialisé au read via `_deserialize()`** : si la colonne revient en string (certains drivers), `json.loads()`.

> Java : utiliser un `@JdbcTypeCode(SqlTypes.JSON)` sur une Map<String,Object> ou un record dédié `PricingSnapshot`. Sérialiser via Jackson avec ordre des clés identique (utiliser `@JsonPropertyOrder`).

### Format produit par `PricingResult.to_payment_dict()` (20 champs INSERT payments)

Cf. §Table payments. Les noms de colonnes DB matchent exactement les clés du dict Python.

---

## Diagramme transactionnel — POST /bookings/request (flux instant_booking + pay_now)

```
  [REST POST /bookings/request]
            │
            ├── pool.acquire()
            │
            ├─► SELECT services (config)
            ├─► SELECT app_config flags × 2
            ├─► SELECT app_config pay_now_minutes
            │
            ├─► Guards (400/409 pré-transaction)
            │
            ├─► Idempotence 1 : SELECT by idempotency_key → si hit, return (sort du flow)
            ├─► Idempotence 2 : SELECT by (slot_id,user_id) → si hit, return
            │
            ├── conn.transaction()  ══════════════════ DÉBUT TRANSACTION
            │     │
            │     ├─► SELECT service_slots FOR UPDATE NOWAIT
            │     │     └─ LockNotAvailableError → 409 (rollback auto)
            │     │
            │     ├─► pricing_engine.compute_pricing (SELECT pricing_rules + subscriptions)
            │     │
            │     ├─► INSERT bookings (18 colonnes)
            │     ├─► INSERT payments (20 colonnes)
            │     ├─► UPDATE service_slots (transition état)
            │     │
            │     └── COMMIT                         ══════════════════ FIN TRANSACTION
            │
            ├─► SELECT booking complet (JOIN services, _fetch_booking) — hors transaction
            │
            └── [Nouvelle connexion] :
                 ├─► SELECT users.name
                 ├─► SELECT services.title
                 └─► asyncio.create_task(send_push)  (fire-and-forget)
```

## Diagramme transactionnel — POST /bookings/{id}/pay

```
  [REST POST /bookings/{id}/pay]
            │
            ├── pool.acquire() #1
            │     ├─► SELECT booking (guards)
            │     └─► SELECT payment (idempotence Stripe)
            ├── [pool.release]
            │
            ├── [Idempotence Stripe] :
            │     stripe.retrieve_checkout_session → si 'open' → return (court-circuit)
            │
            ├── [APPEL EXTERNE STRIPE — hors transaction DB]
            │     stripe.create_checkout_session(amount, currency, urls, metadata, idempotency_key)
            │
            └── pool.acquire() #2 + conn.transaction()  ══════════ TRANSACTION
                  ├─► UPDATE payments (stripe IDs + status CASE)
                  ├─► UPDATE bookings (payment_status)
                  └── COMMIT
```

> ⚠️ **Deux connexions séparées** dans `pay_booking` (pas une). Java peut factoriser en une seule connexion si `@Transactional(propagation=REQUIRED)` englobe, **mais** l'appel Stripe doit rester **hors transaction** pour éviter un rollback qui laisserait Stripe dans un état incohérent.

---

## Transactionnalité — résumé pour Java

| Endpoint | Scope transaction | Remarque |
|---|---|---|
| `price-preview` | Aucune (SELECT only) | `@Transactional(readOnly=true)` optionnel |
| `POST /bookings/request` | `@Transactional` sur la partie INSERT/UPDATE ; les SELECT de config hors transaction possibles | Idempotence courts-circuits **avant** `@Transactional` |
| `POST /bookings/{id}/pay` | `@Transactional` **uniquement autour des UPDATE post-Stripe**. Appel Stripe **hors** `@Transactional` | Sinon rollback laisse session Stripe orpheline |

---

## Index & performance (référence)

Indices supposés nécessaires (à vérifier côté migrations) :

```sql
CREATE UNIQUE INDEX idx_bookings_idempotency_key
  ON bookings(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_bookings_slot_user
  ON bookings(slot_id, user_id)
  WHERE status NOT IN ('refused','cancelled','expired');

CREATE INDEX idx_payments_booking
  ON payments(booking_id);

-- app_config : clé primaire sur config_key
```

> **À valider lors de l'implémentation Java** en inspectant les migrations DB. Ne PAS ajouter d'index spécifiquement pour cette slice.

---

## Incertitudes / zones grises

| Zone | Question | Action |
|---|---|---|
| Contrainte UNIQUE `bookings.idempotency_key` | PARTIAL INDEX sur NOT NULL ? | Vérifier migrations |
| `services.active` comportement soft-delete | Toujours TRUE sauf soft-deleted ? | Cohérent avec logic slice S28 (CRUD services pas encore migré) |
| `pricing_rules` format DB | Cf. `pricing_engine.py:187` `SELECT WHERE product_type=$1 AND active=TRUE` | Hors périmètre Slice 30 mais nécessite documentation future |
| Sérialisation `numeric` côté réponse JSON | float Python vs BigDecimal Java | Utiliser `BigDecimal` en Java avec serialisation à 2 décimales OU en float selon compat — **tester bit-pour-bit** |
| `new_id("bkg")` / `new_id("pay")` format exact | `"bkg_<uuid>"` ou `"bkg_<short>"` ? | Lire `models.py:new_id` au moment de l'impl Java |
| Colonne `bookings.created_at` / `updated_at` auto-default | `DEFAULT NOW()` ? Ou à set explicitement ? | À vérifier migrations — Python ne les set pas à l'INSERT |
