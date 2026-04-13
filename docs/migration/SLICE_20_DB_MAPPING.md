# SLICE_20_DB_MAPPING.md — Mapping base de données
> Basé sur `webhook_handlers.py:584–935`, `migrations/001_initial_schema.sql`.
> Généré le 2026-04-13.

---

## Tables impliquées

### Table principale — `user_subscriptions`

```sql
CREATE TABLE public.user_subscriptions (
    subscription_id          text NOT NULL PRIMARY KEY,
    user_id                  text REFERENCES users(user_id) ON DELETE CASCADE,
    plan_id                  text REFERENCES subscription_plans(plan_id),
    status                   text DEFAULT 'active',
    started_at               timestamptz DEFAULT now(),
    expires_at               timestamptz,
    created_at               timestamptz DEFAULT now(),
    plan_code                text,                           -- legacy, non utilisé
    stripe_subscription_id   text,                           -- sub_... (Stripe)
    benefits_snapshot        jsonb,                           -- snapshot exemptions au moment activation
    cancelled_at             timestamptz,
    updated_at               timestamptz DEFAULT now()
);
```

#### Index

```sql
CREATE INDEX idx_user_subscriptions_user ON user_subscriptions (user_id, status);
```

#### Statuts possibles

| Statut | Signification | Transitions entrantes |
|---|---|---|
| `active` | Abonnement en cours | INSERT (events 1,2), invoice.paid (event 5) |
| `cancelling` | Annulation programmée fin de période | subscription.updated (cancel_at_period_end=true) |
| `cancelled` | Annulation effective | subscription.updated, subscription.deleted |
| `past_due` | Paiement échoué | invoice.payment_failed, subscription.updated |
| `trialing` | Période d'essai | subscription.updated (status=trialing) |

---

### Table de référence — `subscription_plans`

```sql
CREATE TABLE public.subscription_plans (
    plan_id                  text NOT NULL PRIMARY KEY,
    name                     text NOT NULL,
    description              text,
    price                    numeric(10,2) DEFAULT 0 NOT NULL,
    duration_days            integer,
    exempt_payer_fixed       boolean DEFAULT false,
    exempt_payer_percent     boolean DEFAULT false,
    exempt_receiver_fixed    boolean DEFAULT false,
    exempt_receiver_percent  boolean DEFAULT false,
    active                   boolean DEFAULT true,
    priority                 integer DEFAULT 0,
    created_at               timestamptz DEFAULT now(),
    updated_at               timestamptz DEFAULT now(),
    stripe_product_id        text,
    stripe_price_id          text
);
```

#### Index uniques (conditionnels)

```sql
CREATE UNIQUE INDEX idx_subscription_plans_stripe_price ON subscription_plans (stripe_price_id) WHERE stripe_price_id IS NOT NULL;
CREATE UNIQUE INDEX idx_subscription_plans_stripe_product ON subscription_plans (stripe_product_id) WHERE stripe_product_id IS NOT NULL;
```

---

### Table d'idempotence — `stripe_webhook_events` (déjà en S16)

```sql
-- Documentée en S16. Rappel du schema pour contexte :
-- PK: event_id (text) — l'event_id Stripe (evt_...)
-- Colonnes : event_type, status (processing/success/error/ignored), related_id, error_message, processed_at, updated_at
```

---

## Opérations DB par event type

### Event 1 — `checkout.session.completed` (mode=subscription)

| # | Opération | Table | SQL |
|---|---|---|---|
| 1 | SELECT plan | `subscription_plans` | `SELECT * FROM subscription_plans WHERE plan_id=$1` |
| 2 | SELECT idempotence | `user_subscriptions` | `SELECT subscription_id FROM user_subscriptions WHERE stripe_subscription_id=$1` |
| 3 | INSERT | `user_subscriptions` | Voir ci-dessous |

```sql
INSERT INTO user_subscriptions
  (subscription_id, user_id, plan_id, status,
   started_at, expires_at, stripe_subscription_id,
   benefits_snapshot, updated_at)
VALUES ($1, $2, $3, 'active', NOW(), $4, $5, $6, NOW())
```

| Colonne | Source |
|---|---|
| `subscription_id` | `new_id("sub")` — ID généré côté application |
| `user_id` | `metadata.user_id` |
| `plan_id` | `metadata.plan_id` |
| `status` | Hardcodé `'active'` |
| `started_at` | `NOW()` |
| `expires_at` | `stripe_sub.current_period_end` (via `retrieve_subscription`) — nullable |
| `stripe_subscription_id` | `obj.subscription` |
| `benefits_snapshot` | `json.dumps(_build_benefits_snapshot(plan))` — JSONB |

### Event 2 — `customer.subscription.created`

Identique à Event 1, mais :
- `expires_at` vient de `obj.current_period_end` (pas d'appel Stripe)
- Guard identique (SELECT idempotence)

### Event 3 — `customer.subscription.updated`

| # | Opération | Table | SQL |
|---|---|---|---|
| 1 | UPDATE (avec expires_at) | `user_subscriptions` | `UPDATE ... SET status=$1, expires_at=$2, updated_at=NOW() WHERE stripe_subscription_id=$3 AND status NOT IN ('cancelled')` |
| 1bis | UPDATE (sans expires_at) | `user_subscriptions` | `UPDATE ... SET status=$1, updated_at=NOW() WHERE stripe_subscription_id=$2 AND status NOT IN ('cancelled')` |
| 2 | SELECT user_id (si notif) | `user_subscriptions` | `SELECT user_id FROM user_subscriptions WHERE stripe_subscription_id=$1 LIMIT 1` |

**Piège SQL** : 2 requêtes UPDATE distinctes selon la présence de `expires_at`. Le nombre de paramètres positionnels change ($2 vs $3 pour stripe_subscription_id).

### Event 4 — `customer.subscription.deleted`

| # | Opération | Table | SQL |
|---|---|---|---|
| 1 | SELECT user_id (AVANT update) | `user_subscriptions` | `SELECT user_id FROM user_subscriptions WHERE stripe_subscription_id=$1 LIMIT 1` |
| 2 | UPDATE | `user_subscriptions` | `UPDATE ... SET status='cancelled', cancelled_at=NOW(), updated_at=NOW() WHERE stripe_subscription_id=$1` |

**Asymétrie** : PAS de guard `NOT IN ('cancelled')` — contrairement aux events 3, 5, 6.

### Event 5 — `invoice.paid`

| # | Opération | Table | SQL |
|---|---|---|---|
| 1 | UPDATE | `user_subscriptions` | `UPDATE ... SET expires_at=$1, status='active', updated_at=NOW() WHERE stripe_subscription_id=$2 AND status NOT IN ('cancelled')` |
| 2 | SELECT user_id (si notif) | `user_subscriptions` | `SELECT user_id FROM user_subscriptions WHERE stripe_subscription_id=$1 LIMIT 1` |

**Effet secondaire** : Force `status='active'` — un abonnement `past_due` ou `cancelling` qui reçoit un paiement réussi redevient `active`.

### Event 6 — `invoice.payment_failed`

| # | Opération | Table | SQL |
|---|---|---|---|
| 1 | UPDATE | `user_subscriptions` | `UPDATE ... SET status='past_due', updated_at=NOW() WHERE stripe_subscription_id=$1 AND status NOT IN ('cancelled')` |
| 2 | SELECT user_id (si notif) | `user_subscriptions` | `SELECT user_id FROM user_subscriptions WHERE stripe_subscription_id=$1 LIMIT 1` |

---

## `benefits_snapshot` — Structure JSONB

```json
{
  "plan_id":                 "plan_...",
  "plan_name":               "Premium",
  "exempt_payer_fixed":      true,
  "exempt_payer_percent":    false,
  "exempt_receiver_fixed":   false,
  "exempt_receiver_percent": true,
  "snapshotted_at":          "2026-04-13T12:00:00+00:00"
}
```

Stocké uniquement à l'INSERT (events 1 et 2). Jamais mis à jour ensuite.
Les lecteurs (`/subscriptions/me`, pricing_engine) le désérialisent en dict.

---

## Diagramme de transitions d'état

```
                                         invoice.paid
                                    ┌──────────────────┐
                                    ▼                  │
             ┌──────────┐     ┌──────────┐     ┌──────────────┐
  INSERT ──→ │  active   │────→│cancelling│────→│  cancelled   │
             └──────────┘     └──────────┘     └──────────────┘
                  │                                    ▲
                  │ invoice.payment_failed              │
                  ▼                                    │
             ┌──────────┐     subscription.deleted     │
             │ past_due  │─────────────────────────────┘
             └──────────┘
                  │
                  │ invoice.paid
                  ▼
             ┌──────────┐
             │  active   │  (retour)
             └──────────┘
```

**Transitions détaillées** :
- `active` → `cancelling` (subscription.updated + cancel_at_period_end=true)
- `active` → `past_due` (invoice.payment_failed)
- `active` → `cancelled` (subscription.updated status=canceled / subscription.deleted)
- `cancelling` → `cancelled` (subscription.updated status=canceled / subscription.deleted)
- `cancelling` → `active` (invoice.paid — le renouvellement annule l'annulation programmée)
- `past_due` → `active` (invoice.paid — le paiement rattrape)
- `past_due` → `cancelled` (subscription.deleted)

**Transitions IMPOSSIBLES** (guard `NOT IN ('cancelled')`) :
- `cancelled` → tout autre statut (sauf via subscription.deleted qui est inconditionnel)

---

## Aucune migration de schéma requise

Les tables `user_subscriptions` et `subscription_plans` existent déjà.
Aucune colonne, index ou contrainte à ajouter pour cette slice.
