# SLICE_21_DB_MAPPING.md — Mapping base de données
> Basé sur `subscription_routes.py:130–449`.
> Généré le 2026-04-13.

---

## Tables impliquées

### Table `subscription_plans` (SELECT uniquement)

| Endpoint | Opération | Colonnes | Condition |
|---|---|---|---|
| `GET /subscription-plans` | SELECT | 13 colonnes (sans stripe_*) | `WHERE active = TRUE ORDER BY priority DESC, price ASC` |
| `POST /subscribe` | SELECT | `*` | `WHERE plan_id = $1` |
| `POST /subscribe` | UPDATE | `stripe_product_id, stripe_price_id, updated_at` | `WHERE plan_id = $1` (après création Stripe) |
| `GET /me` | SELECT (JOIN) | `name, description, price, duration_days, exempt_*` | `ON sp.plan_id = us.plan_id` |
| `GET /history` | SELECT (JOIN) | `name, price` | `ON sp.plan_id = us.plan_id` |

### Table `user_subscriptions`

| Endpoint | Opération | Colonnes | Condition |
|---|---|---|---|
| `POST /subscribe` | SELECT (guard) | `subscription_id, status` | `WHERE user_id=$1 AND status IN ('active','cancelling','trialing') LIMIT 1` |
| `GET /me` | SELECT (JOIN) | `us.*, sp.*` | `WHERE us.user_id=$1 AND us.status IN ('active','cancelling','past_due','trialing') ORDER BY started_at DESC LIMIT 1` |
| `GET /history` | SELECT (JOIN) | `us.*, sp.name, sp.price` | `WHERE us.user_id=$1 ORDER BY created_at DESC` |
| `POST /cancel` | SELECT | `subscription_id, stripe_subscription_id, status` | `WHERE user_id=$1 AND status IN ('active','cancelling','trialing') ORDER BY started_at DESC LIMIT 1` |
| `POST /cancel` | UPDATE | `status, cancelled_at, updated_at` | `WHERE subscription_id=$1` |
| `GET /checkout/status` | SELECT | `subscription_id, status` | `WHERE stripe_subscription_id=$1` |

### Table `users`

| Endpoint | Opération | Colonnes | Condition |
|---|---|---|---|
| `POST /subscribe` | UPDATE | `stripe_customer_id` | `WHERE user_id=$1 AND stripe_customer_id IS NULL` |
| `GET /checkout/status` | SELECT | `stripe_customer_id` | `WHERE user_id=$1` |

---

## Détail par endpoint

### `GET /subscription-plans`

```sql
-- Une seule requête, pas de transaction
SELECT plan_id, name, description, price, duration_days,
       exempt_payer_fixed, exempt_payer_percent,
       exempt_receiver_fixed, exempt_receiver_percent,
       active, priority, created_at, updated_at
FROM subscription_plans
WHERE active = TRUE
ORDER BY priority DESC, price ASC
```

### `POST /subscriptions/subscribe`

```sql
-- Étape 1 : charger le plan
SELECT * FROM subscription_plans WHERE plan_id = $1

-- Étape 2 : vérifier doublon
SELECT subscription_id, status FROM user_subscriptions
WHERE user_id = $1 AND status IN ('active', 'cancelling', 'trialing')
LIMIT 1

-- Étape 4 (après Stripe ensure_price) : mettre à jour plan
UPDATE subscription_plans
SET stripe_product_id = $1, stripe_price_id = $2, updated_at = NOW()
WHERE plan_id = $3

-- Étape 5 (après Stripe get_or_create_customer) : stocker customer_id
UPDATE users SET stripe_customer_id = $1
WHERE user_id = $2 AND stripe_customer_id IS NULL
```

**Pas de transaction explicite** — les 4 requêtes sont dans des `pool.acquire()` séparés.
Les étapes Stripe (3, 5, 6) sont intercalées entre les requêtes DB.

### `GET /subscriptions/me`

```sql
SELECT us.*,
       sp.name AS plan_name, sp.description AS plan_description,
       sp.price AS plan_price, sp.duration_days,
       sp.exempt_payer_fixed, sp.exempt_payer_percent,
       sp.exempt_receiver_fixed, sp.exempt_receiver_percent
FROM user_subscriptions us
JOIN subscription_plans sp ON sp.plan_id = us.plan_id
WHERE us.user_id = $1
  AND us.status IN ('active', 'cancelling', 'past_due', 'trialing')
ORDER BY us.started_at DESC
LIMIT 1
```

**Asymétrie /me vs /subscribe guard** :
- `/me` inclut `past_due` dans le filtre (affiche l'abonnement même si le paiement a échoué)
- `/subscribe` guard N'inclut PAS `past_due` (permet de souscrire un nouveau plan si le précédent est en échec de paiement)

### `GET /subscriptions/history`

```sql
SELECT us.*,
       sp.name AS plan_name, sp.price AS plan_price
FROM user_subscriptions us
JOIN subscription_plans sp ON sp.plan_id = us.plan_id
WHERE us.user_id = $1
ORDER BY us.created_at DESC
```

Pas de filtre sur status, pas de LIMIT. Retourne TOUT l'historique.

### `POST /subscriptions/cancel`

```sql
-- Lecture
SELECT subscription_id, stripe_subscription_id, status
FROM user_subscriptions
WHERE user_id = $1
  AND status IN ('active', 'cancelling', 'trialing')
ORDER BY started_at DESC
LIMIT 1

-- Écriture (après Stripe cancel)
UPDATE user_subscriptions
SET status = $1, cancelled_at = NOW(), updated_at = NOW()
WHERE subscription_id = $2
```

**Ordre** : Stripe cancel → DB UPDATE (pas de transaction).

### `GET /subscriptions/checkout/status/{session_id}`

```sql
-- Vérifier ownership
SELECT stripe_customer_id FROM users WHERE user_id = $1

-- Chercher la subscription locale
SELECT subscription_id, status
FROM user_subscriptions
WHERE stripe_subscription_id = $1
```

---

## Asymétries filtre status

| Endpoint | Filtre status | `past_due` inclus ? | Raison |
|---|---|---|---|
| `/subscribe` (guard) | `IN ('active','cancelling','trialing')` | **NON** | Permet de re-souscrire si `past_due` |
| `/me` | `IN ('active','cancelling','past_due','trialing')` | **OUI** | Affiche l'abonnement même en échec |
| `/cancel` | `IN ('active','cancelling','trialing')` | **NON** | On ne peut pas annuler un `past_due` |
| `/history` | Aucun filtre | Tous | Historique complet |

---

## Aucune migration de schéma requise

Les tables existent déjà. Aucune colonne, index ou contrainte à ajouter.
