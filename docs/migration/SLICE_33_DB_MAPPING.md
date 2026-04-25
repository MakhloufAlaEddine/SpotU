# SLICE_33_DB_MAPPING.md — Mapping DB Webhook Payment Handlers
> Basé sur `webhook_handlers.py:122–180, 185–453`.
> Généré le 2026-04-25.

---

## Tables impliquées (5)

| Table | Rôle | Opérations Slice 33 |
|---|---|---|
| `payments` | Statuts paiement transactionnel | UPDATE (status, stripe_charge_id) + SELECT (payer/receiver, lookup) |
| `bookings` | Statut booking lié | UPDATE (status, payment_status) + SELECT (status guard) |
| `services` | Titre prestation pour notifs | SELECT (JOIN bookings) |
| `notifications` | Notifs persistées + WebSocket | INSERT (via `store_notification`) |
| `stripe_webhook_events` | Idempotence event-level | (déjà géré par S32 — non touché ici) |

---

## Table `payments` — colonnes utilisées

| Colonne | Type | Lecture | Écriture | Notes |
|---|---|---|---|---|
| `payment_id` | TEXT (PK) | WHERE / lookup | — | Clé fonctionnelle |
| `status` | TEXT | WHERE NOT IN (guards) | UPDATE | Valeurs : `'pending'`, `'authorized'`, `'captured'`, `'failed'`, `'cancelled'`, `'refunded'`, `'partially_refunded'` |
| `stripe_payment_intent_id` | TEXT | SELECT lookup | — | Lookup `_resolve_payment_id` strat. 2 |
| `stripe_checkout_session_id` | TEXT | SELECT lookup | — | Lookup strat. 3 |
| `stripe_charge_id` | TEXT NULL | SELECT lookup | UPDATE (PI succeeded avec `latest_charge`) | Lookup strat. 4 + populate à `payment_intent.succeeded` |
| `payer_user_id` | TEXT FK→users | SELECT (notif) | — | Destinataire des notifs `booking_confirmed` / `payment_failed` |
| `receiver_user_id` | TEXT FK→users | SELECT (notif) | — | Destinataire des notifs `booking_confirmed` / `payment_authorized` |
| `booking_id` | TEXT NULL FK→bookings | SELECT (resolve) | — | Récupéré dans `_resolve_payment_id` pour la suite du flow |
| `updated_at` | TIMESTAMPTZ | — | UPDATE NOW() | Toujours mis à jour |

### Transitions de statut autorisées

```
pending     → authorized     (payment_intent.amount_capturable_updated)
pending     → authorized     (checkout.session.completed unpaid + manual_approval)
pending     → captured       (checkout.session.completed paid)
pending     → captured       (checkout.session.completed unpaid + awaiting_payment)
pending     → captured       (payment_intent.succeeded)
pending     → failed         (payment_intent.payment_failed)
pending     → cancelled      (payment_intent.canceled)

authorized  → captured       (payment_intent.succeeded — ex: capture manuelle ultérieure)
authorized  → cancelled      (payment_intent.canceled)
authorized  → failed         (rare — Stripe peut décliner après auth)

captured    → (terminal sauf refunded en S34)
failed      → captured       (rare — retry réussi)
cancelled   → (terminal)
```

### Idempotence guards (CRITIQUE)

Chaque UPDATE porte un `WHERE status NOT IN (...)` qui empêche les régressions :

| Branche | Guard exact (Python) |
|---|---|
| `checkout.session.completed` (unpaid + awaiting → captured) | `AND status NOT IN ('captured','refunded','cancelled')` |
| `checkout.session.completed` (unpaid + autre → authorized) | `AND status NOT IN ('authorized','captured','refunded','cancelled')` |
| `checkout.session.completed` (paid → captured) | `AND status NOT IN ('captured','refunded')` |
| `payment_intent.amount_capturable_updated` (→ authorized) | `AND status NOT IN ('authorized','captured','refunded','cancelled')` |
| `payment_intent.succeeded` (→ captured) | `AND status NOT IN ('captured','refunded')` |
| `payment_intent.payment_failed` (→ failed) | `AND status NOT IN ('captured','refunded','failed')` |
| `payment_intent.canceled` (→ cancelled) | `AND status NOT IN ('captured','refunded','cancelled')` |

> ⚠️ Ces guards **diffèrent** entre branches. Reproduire **exactement** sinon le statut peut régresser ou être bloqué.

---

## Table `bookings` — colonnes utilisées

| Colonne | Type | Lecture | Écriture | Notes |
|---|---|---|---|---|
| `booking_id` | TEXT (PK) | WHERE | — | |
| `status` | TEXT | SELECT (router checkout.session) | UPDATE → `'confirmed'` | Valeurs : `'requested'`, `'awaiting_payment'`, `'confirmed'`, `'refused'`, `'cancelled'`, `'expired'`, … |
| `payment_status` | TEXT | — | UPDATE → `'paid'` | Statut paiement côté booking (séparé de `bookings.status`) |
| `service_id` | TEXT FK | — (JOIN) | — | Pour récupérer `services.title` |
| `updated_at` | TIMESTAMPTZ | — | UPDATE NOW() | |

### Lookup statut booking pour routage `checkout.session.completed`

```sql
SELECT status FROM bookings WHERE booking_id=$1
```

- Si `status == 'awaiting_payment'` → Branch A (auto-confirm)
- Sinon → Branch B (authorize only)

### UPDATE bookings (3 events seulement)

```sql
UPDATE bookings
   SET status='confirmed', payment_status='paid', updated_at=NOW()
 WHERE booking_id=$1
   AND status NOT IN ('confirmed','refused','cancelled','expired')
```

Émis uniquement par :
- `checkout.session.completed` (paid OR unpaid+awaiting_payment)
- `payment_intent.succeeded`

> ⚠️ Pas d'UPDATE bookings pour `failed`/`canceled`/`amount_capturable_updated`.

---

## Table `services` — JOIN pour notif title

```sql
SELECT s.title
  FROM bookings b
  JOIN services s ON b.service_id = s.service_id
 WHERE b.booking_id=$1
```

Si non trouvé → fallback string `"votre prestation"`.

> ⚠️ Java JPA : `LEFT JOIN` côté repo + `Optional<String>` retour, fallback applicatif.

---

## Table `notifications` — INSERT via `store_notification`

```sql
INSERT INTO notifications (notif_id, user_id, type, title, body, data)
VALUES ($1, $2, $3, $4, $5, $6)
```

| Colonne | Type | Notes |
|---|---|---|
| `notif_id` | TEXT (PK) | Format `"notif_" + 16 hex` (uuid4 truncated) |
| `user_id` | TEXT FK→users | Destinataire |
| `type` | TEXT | `'booking_confirmed'`, `'payment_authorized'`, `'payment_failed'` |
| `title` | TEXT | Titre court |
| `body` | TEXT | Corps détaillé |
| `data` | JSONB | Payload structuré pour app mobile |
| `read` | BOOLEAN DEFAULT FALSE | (mis à jour ailleurs) |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | |

### Effet WebSocket additionnel
`store_notification` appelle aussi `notif_manager.notify(user_id, ...)` pour push temps réel (compteur unread + payload).

> ⚠️ Java : appeler le service WebSocket **dans le même service** que l'INSERT pour préserver l'atomicité comportementale.

---

## Idempotence niveau handler

L'idempotence event-level est gérée par S32 (`stripe_webhook_events.event_id` PK).

L'idempotence **handler-level** (au cas où S32 n'aurait pas claimé pour une raison X — bug, retry interne, etc.) repose sur :
1. Les `WHERE status NOT IN (...)` (rows_updated = 0 si déjà final)
2. La condition `if rows_updated > 0` AVANT d'append à `pending_notifs`

> ✅ Double protection : event-level (PK) + statement-level (guards).

---

## Transactionnalité

### Branches Python qui utilisent `async with conn.transaction()`

| Branche | Transaction | Pourquoi |
|---|---|---|
| `checkout.session.completed` (unpaid+awaiting → captured + bookings.confirmed) | OUI | Atomicité payments+bookings |
| `checkout.session.completed` (paid → captured + bookings.confirmed) | OUI | Atomicité payments+bookings |
| `payment_intent.succeeded` (avec ou sans charge_id) | OUI | Atomicité payments+bookings |
| `checkout.session.completed` (unpaid+other → authorized seul) | NON | Single UPDATE |
| `payment_intent.amount_capturable_updated` | NON | Single UPDATE |
| `payment_intent.payment_failed` | NON | Single UPDATE |
| `payment_intent.canceled` | NON | Single UPDATE |

### Java Spring

```java
@Transactional
public void handleCheckoutSessionCompletedUnpaidAwaiting(...) {
    int rows = paymentRepo.markCaptured(paymentId);
    if (bookingId != null) {
        bookingRepo.markConfirmed(bookingId);
    }
    // notifs collectées dans pendingNotifs (out-param)
}
```

### Notifications HORS transaction
**Critique** : `store_notification` est appelée **hors** du pool/transaction par le dispatcher (S32). Java : exécuter `notifService.store(...)` après le commit du `@Transactional` du handler. Pattern post-commit listener OK.

---

## Diagramme de flow par event

```
┌──── _resolve_payment_id ────┐
│ 1. metadata.payment_id      │
│ 2. stripe_payment_intent_id │
│ 3. stripe_checkout_session  │
│ 4. stripe_charge_id (ch_*)  │
│ → (payment_id, booking_id)  │
└─────────────────────────────┘
            │
            ▼
┌─── _handle_payment_event ────────────────┐
│                                          │
│ event_type:                              │
│   ├─ checkout.session.completed          │
│   │    ├─ mode=subscription → return     │
│   │    ├─ ps=unpaid + bk=awaiting_pay    │
│   │    │    └─ TX(payments + bookings)   │
│   │    │         + 2 notifs              │
│   │    ├─ ps=unpaid + autre              │
│   │    │    └─ UPDATE payments authorized│
│   │    │         + 1 notif receiver      │
│   │    └─ ps=paid                        │
│   │         └─ TX(payments + bookings)   │
│   │              + 2 notifs              │
│   │                                      │
│   ├─ payment_intent.amount_capturable_updated
│   │    └─ UPDATE payments authorized     │
│   │         + 1 notif receiver           │
│   │                                      │
│   ├─ payment_intent.succeeded            │
│   │    ├─ avec latest_charge → +stripe_charge_id
│   │    └─ TX(payments + bookings)        │
│   │         + 2 notifs                   │
│   │                                      │
│   ├─ payment_intent.payment_failed       │
│   │    └─ UPDATE payments failed         │
│   │         + 1 notif payer              │
│   │                                      │
│   └─ payment_intent.canceled             │
│        └─ UPDATE payments cancelled      │
│             (PAS de notif)               │
└──────────────────────────────────────────┘
```

---

## Index recommandés

```sql
-- Lookup _resolve_payment_id stratégie 2
CREATE INDEX IF NOT EXISTS idx_payments_pi
  ON payments(stripe_payment_intent_id);

-- Stratégie 3
CREATE INDEX IF NOT EXISTS idx_payments_cs
  ON payments(stripe_checkout_session_id);

-- Stratégie 4
CREATE INDEX IF NOT EXISTS idx_payments_charge
  ON payments(stripe_charge_id);

-- Lookup notif user
CREATE INDEX IF NOT EXISTS idx_notif_user_unread
  ON notifications(user_id, read) WHERE read=FALSE;
```

> **À VALIDER** côté DB existante. Migration **non** créée par S33 (les tables existent déjà côté prod).

---

## Compat asyncpg → JPA mapping

| asyncpg Python | Spring/JPA |
|---|---|
| `conn.execute("UPDATE ...", ...)` retourne `"UPDATE 1"` | `@Modifying @Query` retourne `int rowsUpdated` |
| `_rows(res)` parse le tag | utiliser le `int` direct |
| `conn.fetchrow("SELECT ...")` | `Optional<Map<String,Object>>` ou DTO via `@Query` |
| `async with conn.transaction()` | `@Transactional` (PROPAGATION_REQUIRED par défaut) |
| `metadata.get("payment_id")` (dict) | `event.getDataObjectDeserializer().getObject().get().getMetadata().get("payment_id")` (Stripe Java) |

---

## Incertitudes / zones grises

| Zone | Question | Action |
|---|---|---|
| `bookings.payment_status` enum vs TEXT | CHECK constraint ? | Tester avec `'paid'` ; valeurs : `'unpaid'`, `'paid'`, `'refunded'` ? |
| `notifications.data` type | JSONB ou TEXT ? | Code Python passe un dict — JSONB probable |
| `services` peut être null si supprimé | Hard-delete ou soft-delete ? | Le JOIN échoue silencieusement → fallback string. Reproduire ce comportement |
| `payments.stripe_charge_id` peut-il être set par 2 events différents ? | Conflit potentiel | `payment_intent.succeeded` set le `stripe_charge_id`. Si déjà set par un autre flow, le UPDATE écrase. Acceptable. |
| `latest_charge` peut être un objet expanded plutôt qu'un string | Selon configuration Stripe API expand | Code Python teste `isinstance(charge_id, str) and charge_id.startswith("ch_")` — si non, fallback sans charge_id. Reproduire le test type strict. |
