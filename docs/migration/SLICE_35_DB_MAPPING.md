# SLICE_35_DB_MAPPING.md — Mapping DB Webhook Charge/Refund Handlers
> Basé sur `webhook_handlers.py:458–582`.
> Généré le 2026-04-25.

---

## Tables impliquées (2)

| Table | Rôle | Opérations Slice 35 |
|---|---|---|
| `payments` | Statuts paiement + colonnes refund | UPDATE (status, refund_amount, refund_status, stripe_charge_id) + SELECT (payer_user_id, payer_total_amount, lookup par charge) |
| `notifications` | Notif payer (1 par charge.refunded) | INSERT (via `store_notification` du dispatcher S32-S33) |
| `stripe_webhook_events` | (déjà géré par S32) | — |

> **Aucune autre table** modifiée. Pas d'écriture dans `bookings` (asymétrie vs S33 où captured met aussi à jour bookings.confirmed). **À reproduire strictement.**

---

## Table `payments` — colonnes utilisées

| Colonne | Type | Lecture | Écriture | Notes |
|---|---|---|---|---|
| `payment_id` | TEXT (PK) | WHERE / lookup | — | |
| `status` | TEXT | WHERE NOT IN guard | UPDATE → `'refunded'` ou `'partially_refunded'` | |
| `refund_amount` | NUMERIC ou DECIMAL | — | UPDATE (charge.refunded + Phase 1 refund.updated) | euros (cents/100), 2 décimales |
| `refund_status` | TEXT | — | UPDATE | `'pending'`, `'succeeded'`, `'failed'`, `'canceled'` |
| `stripe_charge_id` | TEXT NULL | — (lecture par lookup) | UPDATE (COALESCE) | Set en S33 normalement, S35 le set en backup via COALESCE |
| `payer_user_id` | TEXT FK | SELECT (notif) | — | Destinataire notif `payment_refunded` |
| `payer_total_amount` | NUMERIC ou DECIMAL | SELECT (refund.updated edge case Phase 1) | — | Pour comparer avec `refund.amount` et détecter full-refund |
| `updated_at` | TIMESTAMPTZ | — | UPDATE NOW() | |

### Schéma colonnes refund probables

```sql
-- À VÉRIFIER côté migrations existantes
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS refund_amount  NUMERIC(10,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refund_status  TEXT;
```

> ⚠️ Le code Python suppose ces colonnes existent. **Pas de migration créée par S35** (read-only docs). Java doit utiliser le schéma existant.

---

## SQL exact

### `charge.refunded` — UPDATE principal

```sql
UPDATE payments
   SET status=$1,                                     -- 'refunded' OR 'partially_refunded'
       refund_amount=$2,                              -- euros (DECIMAL 2 dec)
       refund_status=$3,                              -- 'succeeded'
       stripe_charge_id=COALESCE(stripe_charge_id, $4),  -- set si null
       updated_at=NOW()
 WHERE payment_id=$5
   AND status NOT IN ('refunded')
```

### `charge.refunded` — Lookup payer_user_id pour notif

```sql
SELECT payer_user_id FROM payments WHERE payment_id=$1
```

### `charge.refunded` — Lookup payment via charge_id (fallback)

```sql
SELECT payment_id FROM payments WHERE stripe_charge_id=$1 LIMIT 1
```

### `refund.updated` — Lookup payment + total (Phase 1)

```sql
SELECT payment_id, payer_total_amount
  FROM payments
 WHERE stripe_charge_id=$1
 LIMIT 1
```

### `refund.updated` — UPDATE Phase 1 (edge case full)

```sql
UPDATE payments
   SET refund_status=$1,                              -- 'succeeded'
       refund_amount=$2,                              -- euros
       status='refunded',
       updated_at=NOW()
 WHERE payment_id=$3
   AND status != 'refunded'                          -- ⚠️ != pas NOT IN
```

> ⚠️ **Asymétrie subtile** : Phase 1 utilise `status != 'refunded'` (single value). Le UPDATE `charge.refunded` utilise `status NOT IN ('refunded')` (set). **Comportement équivalent** pour un seul élément, mais reproduire la syntaxe exacte par souci de compat 1:1.

### `refund.updated` — UPDATE Phase 2 (sync simple)

```sql
UPDATE payments
   SET refund_status=$1,
       updated_at=NOW()
 WHERE payment_id=$2
```

> ⚠️ **Pas de guard** sur status. Le `refund_status` peut être updated quel que soit le status courant. Reproduire l'absence de guard.

---

## Idempotence

### Niveau event (S32)
PRIMARY KEY sur `stripe_webhook_events.event_id` empêche le double traitement même event_id.

### Niveau handler (statement-level)

| Branche | Guard | Comportement re-run |
|---|---|---|
| `charge.refunded` UPDATE | `WHERE status NOT IN ('refunded')` | rows=0 si déjà refunded ; pas de notif (`if rows_updated > 0` test) |
| `refund.updated` Phase 1 UPDATE | `WHERE status != 'refunded'` | rows=0 si déjà refunded ; pas d'effet, pas de notif |
| `refund.updated` Phase 2 UPDATE | aucun guard | UPDATE du `refund_status` toujours appliqué |

> ⚠️ Phase 2 sans guard signifie que `refund_status` peut être overwritten plusieurs fois (ex: pending → succeeded → failed). C'est intentionnel pour suivre le cycle de vie Stripe.

### Notification (charge.refunded uniquement)

```python
if _rows(res) > 0:
    pending_notifs.append({...})
```

> ⚠️ Doublons évités via le guard. **Java doit reproduire ce check `rows_updated > 0` AVANT d'append à `pendingNotifs`.**

---

## Transactions

### Branches Python qui utilisent `async with conn.transaction()`

**AUCUNE.** Le handler `_handle_charge_event` n'utilise **PAS** de transaction explicite (contrairement à `_handle_payment_event` Branch A/C).

### Justification
- `charge.refunded` : 1 seul UPDATE atomique sur `payments`. Pas besoin de TX.
- `refund.updated` Phase 1 : 1 seul UPDATE.
- `refund.updated` Phase 2 : 1 seul UPDATE.

### Java
```java
// PAS de @Transactional autour de chaque branche
public void handle(...) {
    int rows = paymentRepo.markRefunded(...);  // single UPDATE
    if (rows > 0) {
        // collecte notif
    }
}
```

> Optionnel : `@Transactional(readOnly = false)` global sur le handler pour grouper UPDATE + SELECT payer. Pas nécessaire mais sans risque.

### Notifications HORS transaction
Idem S33 : collecter dans `pendingNotifs`, exécuter `notifService.storeNotification(...)` post-handler dans le dispatcher S32.

---

## Sérialisation / conversions

### Centimes → Euros

**Python** :
```python
amount_refunded_cents = _get(obj, "amount_refunded", 0)
amount_refunded       = round(amount_refunded_cents / 100, 2)
```

**Java** :
```java
long cents = (Long) obj.getOrDefault("amount_refunded", 0L);
BigDecimal amount = BigDecimal.valueOf(cents)
    .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
```

> ⚠️ **Ne JAMAIS** faire `cents / 100` en `int` (perte précision).

### Comparaison amount ≈ total

**Python** :
```python
abs(amount - total) < 0.02
```

**Java** :
```java
BigDecimal threshold = new BigDecimal("0.02");
boolean isFull = amount.subtract(total).abs().compareTo(threshold) < 0;
```

> ⚠️ Tolérance **0.02 €** (= 2 centimes), pas 0.01. Reproduire la valeur exacte.

### Boolean `refunded` Stripe

**Python** :
```python
fully_refunded = bool(_get(obj, "refunded", False))
```

**Java** :
```java
boolean fullyRefunded = Boolean.TRUE.equals(obj.get("refunded"));
```

---

## Diagramme de flow

```
┌──── _handle_charge_event ─────────────────────────────────┐
│                                                           │
│  event_type:                                              │
│    ├─ charge.refunded                                     │
│    │   ├─ payment_id résolu (par resolver S33 ou lookup)  │
│    │   │   ├─ extraction amount_refunded, refunded, ch_id │
│    │   │   ├─ UPDATE payments status, refund_*            │
│    │   │   ├─ log INFO "Remboursement: ..."               │
│    │   │   └─ SI rows>0:                                  │
│    │   │       SELECT payer_user_id                       │
│    │   │       append PendingNotif (full ou partial body) │
│    │   │                                                  │
│    │   └─ payment_id introuvable                          │
│    │       └─ log DEBUG + return                          │
│    │                                                      │
│    └─ refund.updated                                      │
│        ├─ payment_id non résolu + charge_id présent       │
│        │   └─ SELECT payment_id, payer_total_amount       │
│        │       └─ SI status='succeeded' & amount==total:  │
│        │           ├─ UPDATE status='refunded' + refund_* │
│        │           ├─ log INFO "complet confirmé"         │
│        │           └─ RETURN ← early                      │
│        ├─ payment_id résolu (par S33 OU Phase 1 partielle)│
│        │   ├─ UPDATE refund_status seul                   │
│        │   └─ log INFO "refund.updated: ..."              │
│        └─ payment_id introuvable                          │
│            └─ log DEBUG                                   │
└───────────────────────────────────────────────────────────┘
```

---

## Index recommandés

```sql
-- Lookup par stripe_charge_id (utilisé en S35)
CREATE INDEX IF NOT EXISTS idx_payments_charge ON payments(stripe_charge_id);
-- (déjà recommandé en S33 pour resolver strat. 4)

-- Aucun nouvel index spécifique S35
```

> **À VALIDER** côté migrations.

---

## Compat asyncpg → JPA mapping

| asyncpg Python | Spring/JPA |
|---|---|
| `_get(obj, "amount_refunded", 0)` | `(Long) map.getOrDefault("amount_refunded", 0L)` |
| `round(cents / 100, 2)` | `BigDecimal.divide(100, 2, HALF_UP)` |
| `bool(obj.refunded)` | `Boolean.TRUE.equals(map.get("refunded"))` |
| `abs(a - b) < 0.02` | `a.subtract(b).abs().compareTo(new BigDecimal("0.02")) < 0` |
| `COALESCE(col, $)` | identique en native query JPA |
| `WHERE status NOT IN ('refunded')` | identique |
| `WHERE status != 'refunded'` | identique (Phase 1 spécifique) |
| `conn.execute(UPDATE ...)` retourne `"UPDATE 1"` | `int rowsUpdated` via `@Modifying @Query` |

---

## Concurrence

### Cas A : `charge.refunded` puis `refund.updated` quasi-simultanés
- `charge.refunded` arrive en premier → status='refunded'
- `refund.updated` arrive après → Phase 1 ne se déclenche pas (payment_id résolu via metadata) → Phase 2 UPDATE refund_status (no-op puisque déjà 'succeeded')

### Cas B : `refund.updated` arrive AVANT `charge.refunded` (rare mais possible)
- `refund.updated` Phase 1 si charge_id présent ET amount==total → set status='refunded' + early return
- `charge.refunded` arrive ensuite → guard bloque (`status NOT IN ('refunded')`) → rows=0 → **pas de notif**

> ⚠️ **Trou fonctionnel** : si `refund.updated` arrive en premier en mode full-refund, le payer ne reçoit **PAS** de notif (Phase 1 est silencieuse). C'est une asymétrie volontaire Python (`charge.refunded` est censé arriver et émettre la notif). En pratique Stripe envoie `charge.refunded` quasi-systématiquement. **Reproduire ce comportement Python tel quel.**

---

## Incertitudes / zones grises

| Zone | Question | Action |
|---|---|---|
| Type colonne `refund_amount` | NUMERIC(10,2) ou DECIMAL ? | Tester `SELECT pg_typeof(refund_amount) FROM payments LIMIT 1` |
| Type colonne `refund_status` | TEXT ou enum ? | Tester avec valeurs `'pending'`, `'succeeded'`, `'failed'`, `'canceled'` |
| Tolérance 0.02 — basée sur quoi ? | Erreurs d'arrondi cumulés ? Stripe convertit centimes → € → centimes ailleurs ? | Conservative : reproduire à l'identique |
| `payer_total_amount` peut-il différer de `amount` (charge total) ? | Frais Stripe? Promo? | Le code Python compare au `payer_total_amount` (montant payé par buyer), pas au `amount` Stripe. Probable que ce soit le total visible buyer (avant frais). |
| `charge.refunded` peut-il être envoyé pour une charge non liée à un payment local ? | Charge créée hors flow SpotU | Oui (test mode, ancien paiement purgé). Code gère via early return. |
| `metadata.payment_id` est-il toujours présent dans `charge.refunded` ? | Stripe forward le metadata du PI/CS ? | Oui en pratique car `charge.refunded` propage le metadata du PI parent. **À tester en intégration.** |
