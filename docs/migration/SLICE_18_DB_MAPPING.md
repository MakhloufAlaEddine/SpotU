# SLICE_18_DB_MAPPING.md — Mapping DB de la Slice 18
> Worker : `ExpiryWorker` — `expiry_worker.py`.
> Généré le 2026-02-XX.

---

## Tables impliquées

| Table | Mode | Colonnes utilisées |
|---|---|---|
| `bookings` | SELECT (SKIP LOCKED) + UPDATE | `booking_id`, `status`, `slot_id`, `payer_user_id`, `receiver_user_id`, `service_id`, `expires_at`, `updated_at` |
| `payments` | SELECT (LEFT JOIN) + UPDATE (conditionnel) | `payment_id`, `status`, `stripe_payment_intent_id`, `stripe_checkout_session_id`, `booking_id`, `updated_at` |
| `service_slots` | UPDATE (conditionnel) | `slot_id`, `slot_status`, `slot_type` |
| `notifications` | INSERT (x2 par booking) | `notif_id`, `user_id`, `type`, `title`, `body`, `data`, `created_at` |
| `services` | SELECT (lecture titre) | `service_id`, `title` |

---

## Schéma des colonnes clés

### `bookings`

```sql
-- migrations/001_initial_schema.sql:42–65
CREATE TABLE public.bookings (
    booking_id   text NOT NULL PRIMARY KEY,
    service_id   text,                       -- FK vers services
    user_id      text,                       -- legacy (alias payer)
    coach_id     text,                       -- legacy (alias receiver)
    status       text DEFAULT 'pending',     -- 'requested'|'awaiting_payment' → 'expired'
    slot_id      text,                       -- FK optionnelle vers service_slots
    payer_user_id    text,                   -- utilisé pour notifications
    receiver_user_id text,                   -- utilisé pour notifications
    expires_at   timestamp with time zone,   -- NULL si pas de TTL (confirmed, etc.)
    updated_at   timestamp with time zone DEFAULT now()
    -- autres colonnes non lues par le worker
);

-- Index partiels utilisés par le worker (critical for performance)
CREATE INDEX idx_bookings_expiry_worker    ON bookings (expires_at) WHERE status = 'requested';
CREATE INDEX idx_bookings_expiry_worker_v2 ON bookings (expires_at) WHERE status = ANY (ARRAY['requested','awaiting_payment']);
-- → Java doit s'appuyer sur idx_bookings_expiry_worker_v2 (le plus récent)
```

### `payments`

```sql
-- migrations/001_initial_schema.sql:203–230
CREATE TABLE public.payments (
    payment_id               text NOT NULL PRIMARY KEY,
    booking_id               text,           -- FK vers bookings (LEFT JOIN dans SELECT)
    status                   text DEFAULT 'pending',
    -- 'requires_authorization'|'authorized'|'capture_pending' → 'cancelled'
    -- 'pending'|'captured'|'cancelled'|'refunded' → inchangés
    stripe_payment_intent_id text,           -- pi_xxx — utilisé pour appel Stripe
    stripe_checkout_session_id text,         -- cs_xxx — LU mais non utilisé par le worker
    updated_at               timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_payments_booking     ON payments (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX idx_payments_stripe_intent ON payments (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
```

### `service_slots`

```sql
-- migrations/001_initial_schema.sql:316–330
CREATE TABLE public.service_slots (
    slot_id     text NOT NULL PRIMARY KEY,
    slot_type   text DEFAULT 'recurring',
    -- 'single'|'specific' → libéré par worker
    -- 'recurring'         → jamais libéré par worker
    slot_status text DEFAULT 'available' NOT NULL
    -- 'pending'|'reserved' → 'available'  (si slot_type correct)
    -- 'available'|'booked' → inchangé
);
```

### `notifications`

```sql
-- migrations/001_initial_schema.sql:189–200
CREATE TABLE public.notifications (
    notif_id   text NOT NULL PRIMARY KEY,  -- format "ntf_{12 hex chars}"
    user_id    text,
    type       text NOT NULL,              -- "booking_expired"
    title      text NOT NULL,
    body       text NOT NULL,
    data       jsonb DEFAULT '{}',         -- JSON sérialisé
    read       boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);
```

### `services`

```sql
-- Lecture uniquement : SELECT title FROM services WHERE service_id=$1
-- expiry_worker.py:136–139
```

---

## Flux de lecture / écriture par booking

```
┌─────────────┐     SELECT FOR UPDATE SKIP LOCKED     ┌──────────┐
│  bookings   │◄────────────────────────────────────── │  Worker  │
│  (b)        │                                        │          │
│  payments   │──── LEFT JOIN ────────────────────────►│  (JOIN)  │
│  (p)        │                                        └──────────┘
└─────────────┘
                        BEGIN TRANSACTION
                              │
                   ┌──────────▼──────────┐
                   │ UPDATE bookings     │
                   │ status → 'expired'  │
                   │ RETURNING booking_id│
                   └──────────┬──────────┘
                              │ [si slot_id + type ok]
                   ┌──────────▼──────────┐
                   │ UPDATE service_slots│
                   │ status → 'available'│
                   └──────────┬──────────┘
                              │ [si payment_id + pay_status ok]
                   ┌──────────▼──────────┐
                   │ UPDATE payments     │
                   │ status → 'cancelled'│
                   └──────────┬──────────┘
                              │
                   ┌──────────▼──────────┐
                   │ SELECT services     │
                   │ title               │
                   └──────────┬──────────┘
                              │
                   ┌──────────▼──────────┐
                   │ INSERT notifications│
                   │ x2 (payer+receiver) │
                   └──────────┬──────────┘
                              │
                        COMMIT TRANSACTION
                              │
                   ┌──────────▼──────────┐
                   │ stripe.cancel_pi()  │ ← HORS transaction
                   └─────────────────────┘
```

---

## Logique transactionnelle

### Périmètre de la transaction

```
DANS la transaction :
  ✅ UPDATE bookings
  ✅ UPDATE service_slots
  ✅ UPDATE payments
  ✅ SELECT services
  ✅ INSERT notifications (x2)

HORS transaction (après COMMIT) :
  ⚡ stripe_service.cancel_payment_intent()
```

### Atomicité garantie

- Si `UPDATE bookings` échoue → rollback complet (slot/payment/notifs NON modifiés)
- Si `RETURNING booking_id` retourne NULL → `continue` (pas d'exception, booking skipé)
- Si une exception inattendue se produit → transaction rollbackée automatiquement, `log.exception(...)`, **le worker continue sur le booking suivant**

---

## Index critiques à créer côté Java/Spring Boot

```sql
-- idx_bookings_expiry_worker_v2 (déjà en prod — à recréer si migration schema vierge)
CREATE INDEX idx_bookings_expiry_worker_v2
ON bookings (expires_at)
WHERE status = ANY (ARRAY['requested','awaiting_payment']);

-- idx_payments_booking (pour le LEFT JOIN)
CREATE INDEX idx_payments_booking
ON payments (booking_id)
WHERE booking_id IS NOT NULL;
```

> ⚠️ Sans `idx_bookings_expiry_worker_v2`, le worker fait un seq scan sur toute la table `bookings` à chaque tick (toutes les 60s). En production, c'est critique.

---

## Liens avec les Slices précédentes

| Slice | Relation avec S18 |
|---|---|
| S11 (`GET /bookings/me`) | Lit `bookings.status='expired'` — l'ExpiryWorker est ce qui produit ces bookings |
| S13 (`/accept`) | Crée `awaiting_payment` avec `expires_at=NOW()+30min` — S18 expire si paiement absent |
| S15 (`/cancel`) | Annule manuellement — S18 annule automatiquement via TTL |
| S16 (webhook) | Réceptionne `payment_intent.canceled` si Stripe envoie l'event après l'annulation S18 |
| S17 (`/checkout/session`) | Le payer appelle S17 pour payer avant que S18 expire le booking |
