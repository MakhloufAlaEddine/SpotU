# SLICE_21_API_CONTRACTS.md — Contrats API
> Basé sur `subscription_routes.py:130–449`.
> Généré le 2026-04-13.

---

## Endpoint 1 — `GET /api/subscription-plans`

### Auth : **AUCUNE** (public)

### Requête
- Path : `/api/subscription-plans`
- Méthode : `GET`
- Body : aucun

### Réponse 200

```json
[
  {
    "plan_id": "plan_001",
    "name": "Premium",
    "description": "Accès complet sans frais de service",
    "price": 9.99,
    "duration_days": 30,
    "exempt_payer_fixed": true,
    "exempt_payer_percent": false,
    "exempt_receiver_fixed": false,
    "exempt_receiver_percent": true,
    "active": true,
    "priority": 10,
    "created_at": "2026-01-01T00:00:00+00:00",
    "updated_at": "2026-04-01T00:00:00+00:00"
  }
]
```

**Champs masqués** : `stripe_product_id` et `stripe_price_id` sont exclus de la réponse (helper `_plan_to_dict` les `pop`).

> **ATTENTION** : Le code Python NE masque PAS ces champs ici. `_plan_to_dict` est défini mais **non utilisé** pour cet endpoint. Ligne 148 utilise `row_to_dict(r)` directement. En pratique, les champs `stripe_product_id`/`stripe_price_id` SONT retournés (souvent `null` si pas encore synchronisés avec Stripe).

### SQL

```sql
SELECT plan_id, name, description, price, duration_days,
       exempt_payer_fixed, exempt_payer_percent,
       exempt_receiver_fixed, exempt_receiver_percent,
       active, priority, created_at, updated_at
FROM subscription_plans
WHERE active = TRUE
ORDER BY priority DESC, price ASC
```

**Projection explicite** : 13 colonnes listées (pas de `SELECT *`). Exclut `stripe_product_id` et `stripe_price_id` au niveau SQL.

### Erreurs : aucune (retourne `[]` si aucun plan actif)

---

## Endpoint 2 — `POST /api/subscriptions/subscribe`

### Auth : **STRICTE** (`require_auth`)

### Requête

```json
{
  "plan_id": "plan_001",
  "origin_url": "https://app.spotu.com"
}
```

| Champ | Type | Requis | Règle |
|---|---|---|---|
| `plan_id` | string | OUI | 400 si absent |
| `origin_url` | string | NON (défaut `""`) | Utilisé pour construire success/cancel URLs |

### Réponse 200

```json
{
  "url": "https://checkout.stripe.com/c/pay/cs_test_...",
  "session_id": "cs_test_...",
  "plan_id": "plan_001"
}
```

### Flow détaillé (7 étapes)

```
1. require_auth → user
2. Charger plan (subscription_plans WHERE plan_id = $1)
   → 404 si introuvable, 400 si inactive
3. Vérifier doublon (user_subscriptions WHERE user_id AND status IN active/cancelling/trialing)
   → 409 si déjà abonné
4. Garantir Product + Price Stripe (_get_or_create_stripe_price)
   → Stripe réseau : ensure_subscription_price()
   → DB UPDATE subscription_plans SET stripe_product_id, stripe_price_id
5. Créer/récupérer Customer Stripe (get_or_create_customer)
   → Stripe réseau : Customer.search + Customer.create si nécessaire
   → DB UPDATE users SET stripe_customer_id
6. Créer Checkout Session (create_subscription_checkout_session)
   → Stripe réseau : Session.create(mode='subscription')
   → Idempotency key = {user_id}_{plan_id}_{5min_bucket}
7. Retourner {url, session_id, plan_id}
```

### Erreurs

| Code | Condition | Message |
|---|---|---|
| 400 | `plan_id` absent | "plan_id requis" |
| 400 | Plan inactif (`active=false`) | "Ce plan n'est plus disponible à la souscription." |
| 400 | `duration_days` null | "Ce plan n'a pas de durée configurée" |
| 400 | `duration_days` non supporté (pas 30 ni 365) | Message de `_duration_to_interval` |
| 400 | Prix ≤ 0 | "Le montant du plan doit être supérieur à 0." |
| 404 | Plan introuvable | "Plan introuvable" |
| 409 | Abonnement actif existant | "Vous avez déjà un abonnement {status} (id=...)" |

### Effets de bord

- **Stripe** : Customer créé (si nouveau), Product+Price créés (si premier abonné), Checkout Session créée
- **DB** : `users.stripe_customer_id` mis à jour (si NULL), `subscription_plans.stripe_product_id/stripe_price_id` mis à jour
- **Webhook** (asynchrone) : après le checkout, Stripe envoie `checkout.session.completed` → S20 crée `user_subscriptions`

### Idempotency key (CRITIQUE)

```python
import time as _time
_window = int(_time.time() // 300)  # buckets de 5 minutes
idempotency_key=f"{user['user_id']}_{plan_id}_{_window}"
```

Le préfixe `sub_cs_` est ajouté par `stripe_service.py:339` : `f"sub_cs_{idempotency_key}"`.

Résultat : `sub_cs_usr_001_plan_001_8765432` (change toutes les 5 minutes).

---

## Endpoint 3 — `GET /api/subscriptions/checkout/status/{session_id}`

### Auth : **STRICTE** (`require_auth`)

### Requête
- Path : `/api/subscriptions/checkout/status/{session_id}`
- Paramètre : `session_id` (string, `cs_test_...`)

### Réponse 200

```json
{
  "session_id": "cs_test_...",
  "session_status": "complete",
  "subscription_status": "complete",
  "stripe_sub_id": "sub_...",
  "local_sub_id": "sub_abc123",
  "local_status": "active",
  "metadata": { "plan_id": "plan_001", "user_id": "usr_001" }
}
```

### Flow

```
1. require_auth
2. Retrieve Checkout Session (Stripe réseau)
   → 404 si session introuvable
3. Vérifier ownership : session.customer == user.stripe_customer_id
   → 403 si mismatch (sauf admin)
4. Chercher user_subscriptions par stripe_subscription_id (si présent)
5. Retourner statut combiné (session + local)
```

### Erreurs

| Code | Condition | Message |
|---|---|---|
| 403 | Customer mismatch (pas admin) | "Accès refusé" |
| 404 | Session Stripe introuvable | "Session introuvable : {exc}" |

### Piège : `session.subscription` type

```python
stripe_sub_id = session.subscription if isinstance(session.subscription, str) else None
```

En Java : `session.getSubscription()` peut retourner un objet `Subscription` ou un `String` selon le mode expand. Vérifier le type avant cast.

---

## Endpoint 4 — `GET /api/subscriptions/me`

### Auth : **STRICTE** (`require_auth`)

### Réponse 200 (avec abonnement)

```json
{
  "has_subscription": true,
  "subscription": {
    "subscription_id": "sub_abc123",
    "user_id": "usr_001",
    "plan_id": "plan_001",
    "status": "active",
    "started_at": "2026-04-01T...",
    "expires_at": "2026-05-01T...",
    "stripe_subscription_id": "sub_...",
    "benefits_snapshot": { "plan_id": "plan_001", "exempt_payer_fixed": true, ... },
    "cancelled_at": null,
    "plan_name": "Premium",
    "plan_description": "Accès complet",
    "plan_price": 9.99,
    "duration_days": 30,
    "exempt_payer_fixed": true,
    "exempt_payer_percent": false,
    "exempt_receiver_fixed": false,
    "exempt_receiver_percent": true
  }
}
```

### Réponse 200 (sans abonnement)

```json
{
  "has_subscription": false,
  "subscription": null
}
```

### SQL

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

**Points clés** :
- JOIN avec `subscription_plans` pour enrichir avec les champs plan
- Filtre sur 4 statuts (PAS `cancelled`)
- `ORDER BY started_at DESC LIMIT 1` : le plus récent en premier
- `benefits_snapshot` est désérialisé (JSON string → dict) par `_sub_to_dict`

### Erreurs : aucune (retourne `has_subscription: false` si rien trouvé)

---

## Endpoint 5 — `GET /api/subscriptions/history`

### Auth : **STRICTE** (`require_auth`)

### Réponse 200

```json
[
  {
    "subscription_id": "sub_abc123",
    "user_id": "usr_001",
    "plan_id": "plan_001",
    "status": "cancelled",
    "started_at": "2026-01-01T...",
    "cancelled_at": "2026-03-01T...",
    "plan_name": "Premium",
    "plan_price": 9.99
  },
  { ... }
]
```

### SQL

```sql
SELECT us.*,
       sp.name AS plan_name, sp.price AS plan_price
FROM user_subscriptions us
JOIN subscription_plans sp ON sp.plan_id = us.plan_id
WHERE us.user_id = $1
ORDER BY us.created_at DESC
```

**Différences avec /me** :
- PAS de filtre sur status (inclut `cancelled`)
- PAS de `LIMIT`
- JOIN allégé (seulement `name` et `price` du plan, pas les exemptions)

### Erreurs : aucune (retourne `[]`)

---

## Endpoint 6 — `POST /api/subscriptions/cancel`

### Auth : **STRICTE** (`require_auth`)

### Requête (body optionnel)

```json
{
  "immediate": false
}
```

| Champ | Type | Requis | Défaut | Règle |
|---|---|---|---|---|
| `immediate` | bool | NON | `false` | `true` réservé aux admins (403 sinon) |

### Réponse 200

```json
{
  "success": true,
  "subscription_id": "sub_abc123",
  "status": "cancelling",
  "message": "Abonnement annulé à la fin de la période en cours. Vous conservez vos avantages jusqu'à l'expiration."
}
```

### Flow

```
1. require_auth
2. Lire body (try/except → {} si absent/invalide)
3. Si immediate=true ET user.role != "admin" → 403
4. SELECT abonnement actif (status IN active/cancelling/trialing, ORDER BY started_at DESC LIMIT 1)
   → 404 si rien trouvé
5. Déterminer new_status : "cancelled" si immediate, "cancelling" sinon
6. Stripe : cancel_subscription(stripe_subscription_id, at_period_end=!immediate)
   → Hors transaction, try/except → log.error si échec
7. DB : UPDATE user_subscriptions SET status, cancelled_at=NOW()
8. Retourner {success, subscription_id, status, message}
```

### Erreurs

| Code | Condition | Message |
|---|---|---|
| 403 | `immediate=true` mais pas admin | "L'annulation immédiate est réservée aux administrateurs." |
| 404 | Pas d'abonnement actif | "Aucun abonnement actif à annuler" |

### Effets de bord

- **Stripe** : subscription marquée `cancel_at_period_end=true` (ou annulée immédiatement si admin)
- **Webhook** (asynchrone) : Stripe envoie `customer.subscription.updated` → S20 met à jour le statut
- **DB** : UPDATE direct du statut + `cancelled_at`

### Asymétrie ordre Stripe/DB (CRITIQUE)

```
Booking cancel (S15) : DB COMMIT → Stripe (hors transaction)
Subscription cancel  : Stripe → DB UPDATE (pas de transaction explicite)
```

L'ordre est INVERSÉ par rapport aux bookings. Raison probable : l'annulation subscription est moins critique qu'une capture — si Stripe échoue, l'abonnement reste actif. Le webhook rattrapera.

---

## Helpers partagés

### `_plan_to_dict(row)` — Lignes 42–48

Masque `stripe_product_id` et `stripe_price_id`. Utilisé uniquement par l'endpoint admin (pas le public).

### `_sub_to_dict(row)` — Lignes 51–57

Désérialise `benefits_snapshot` de JSON string vers dict. Utilisé par /me, /history, admin.

### `_get_or_create_stripe_price(conn, plan)` — Lignes 59–109

Garantit l'existence du Product + Price Stripe pour un plan. Cache en DB (`stripe_price_id`).
Appelle `stripe_service.ensure_subscription_price()` + UPDATE plan si nouvelle création.
Valide `duration_days` et `price > 0`.

### `_build_benefits_snapshot(plan)` — Lignes 112–125

Construit le JSONB des exemptions figées au moment de l'activation.
Déjà documenté dans S20 (même fonction dupliquée dans `webhook_handlers.py:938`).
