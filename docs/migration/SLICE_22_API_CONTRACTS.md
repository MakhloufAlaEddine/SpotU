# SLICE_22_API_CONTRACTS.md — Contrats API admin
> Basé sur `admin_routes.py:208–283`, `subscription_routes.py:453–511`.
> Généré le 2026-04-13.

---

## Endpoint 1 — `GET /api/admin/subscription-plans`

### Auth : **ADMIN** (`require_role "admin"`)

### Réponse 200

```json
[
  {
    "plan_id": "plan_001",
    "name": "Premium",
    "description": "Accès complet",
    "price": 9.99,
    "duration_days": 30,
    "exempt_payer_fixed": true,
    "exempt_payer_percent": false,
    "exempt_receiver_fixed": false,
    "exempt_receiver_percent": true,
    "active": true,
    "priority": 10,
    "created_at": "2026-01-01T...",
    "updated_at": "2026-04-01T...",
    "stripe_product_id": "prod_...",
    "stripe_price_id": "price_..."
  }
]
```

**Différence avec GET /subscription-plans (public, S21)** :
- Inclut les plans **inactifs** (pas de `WHERE active=TRUE`)
- Inclut `stripe_product_id` et `stripe_price_id` (masqués côté public)
- Retourne `SELECT *` (toutes les colonnes)

### SQL (handler effectif : admin_routes.py)

```sql
SELECT * FROM subscription_plans ORDER BY priority DESC, created_at
```

**Pas de LIMIT.** Retourne tous les plans.

---

## Endpoint 2 — `POST /api/admin/subscription-plans`

### Auth : **ADMIN**

### Requête

```json
{
  "name": "Premium",
  "description": "Accès complet sans frais",
  "price": 9.99,
  "duration_days": 30,
  "exempt_payer_fixed": true,
  "exempt_payer_percent": false,
  "exempt_receiver_fixed": false,
  "exempt_receiver_percent": true,
  "active": true,
  "priority": 10
}
```

| Champ | Type | Requis | Défaut | Règle |
|---|---|---|---|---|
| `name` | string | **OUI** | — | 400 si absent |
| `description` | string | NON | `null` | — |
| `price` | number | NON | `0` | `float(body.get("price", 0))` |
| `duration_days` | int | NON | `null` | Validé au subscribe (pas ici) |
| `exempt_payer_fixed` | bool | NON | `false` | — |
| `exempt_payer_percent` | bool | NON | `false` | — |
| `exempt_receiver_fixed` | bool | NON | `false` | — |
| `exempt_receiver_percent` | bool | NON | `false` | — |
| `active` | bool | NON | `true` | — |
| `priority` | int | NON | `0` | Ordre d'affichage |

### Réponse 200

```json
{
  "plan_id": "plan_abc123",
  "name": "Premium",
  "price": 9.99,
  ...
}
```

Retourne `RETURNING *` — le plan complet nouvellement créé.

### SQL

```sql
INSERT INTO subscription_plans
  (plan_id, name, description, price, duration_days,
   exempt_payer_fixed, exempt_payer_percent,
   exempt_receiver_fixed, exempt_receiver_percent,
   active, priority)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
RETURNING *
```

### Erreurs

| Code | Condition | Message |
|---|---|---|
| 400 | `name` absent | "name is required" |

**Pas de validation** : `price`, `duration_days`, `priority` ne sont PAS validés à la création.
La validation de `duration_days` (30 ou 365) est faite au moment du `subscribe` (S21).

### Effets de bord

- **Aucun appel Stripe** — le Product/Price Stripe est créé lazily au premier `subscribe` (S21)
- `stripe_product_id` et `stripe_price_id` restent `NULL` après la création

---

## Endpoint 3 — `PUT /api/admin/subscription-plans/{plan_id}`

### Auth : **ADMIN**

### Requête (body partiel)

```json
{
  "price": 14.99,
  "active": false
}
```

Seuls les champs dans le set `allowed` sont acceptés :

```python
allowed = {
    "name", "description", "price", "duration_days",
    "exempt_payer_fixed", "exempt_payer_percent",
    "exempt_receiver_fixed", "exempt_receiver_percent",
    "active", "priority",
}
```

Tout champ hors du set est **silencieusement ignoré** (pas d'erreur).

### Réponse 200

```json
{ "success": true }
```

### SQL dynamique

```python
fields = {k: v for k, v in body.items() if k in allowed}
set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
# → "price = $2, active = $3"
await conn.execute(
    f"UPDATE subscription_plans SET {set_clause}, updated_at = NOW() WHERE plan_id = $1",
    plan_id, *fields.values()
)
```

**Piège Java** : La construction SQL est dynamique. En Java, options :
- JPA `@DynamicUpdate` si entity
- `CriteriaBuilder` pour construire l'UPDATE dynamiquement
- Requête native avec `StringBuilder`

### Erreurs

| Code | Condition | Message |
|---|---|---|
| 400 | Aucun champ valide dans le body | "No valid fields to update" |
| 404 | Plan introuvable (`UPDATE 0`) | "Plan not found" |

### Effets de bord

- **Pas de mise à jour Stripe** : si `price` ou `duration_days` change, les objets Stripe (Product/Price) ne sont PAS mis à jour. Un nouveau Price Stripe sera créé au prochain `subscribe` si le cache ne correspond plus.
- **Pas d'impact sur les abonnements existants** : les bénéfices sont figés dans `benefits_snapshot` (S20 BR-08).

---

## Endpoint 4 — `DELETE /api/admin/subscription-plans/{plan_id}`

### Auth : **ADMIN**

### Réponse 200

```json
{ "success": true }
```

### SQL

```sql
DELETE FROM subscription_plans WHERE plan_id = $1
```

### Erreurs

**AUCUNE erreur gérée explicitement.** Si le plan n'existe pas → DELETE 0 rows → `{"success": true}` quand même.

### Risque FK

```sql
-- user_subscriptions.plan_id → subscription_plans.plan_id (FK)
-- Si un abonnement référence ce plan → PostgreSQL lèvera une ForeignKeyViolationError
-- Le code Python NE gère PAS cette erreur → HTTP 500 (non catchée)
```

**En Java** : catch `DataIntegrityViolationException` → HTTP 409 "Plan utilisé par des abonnements actifs".

---

## Endpoint 5 — `GET /api/admin/subscriptions`

### Auth : **ADMIN**

### Réponse 200

```json
[
  {
    "subscription_id": "sub_abc",
    "user_id": "usr_001",
    "plan_id": "plan_001",
    "status": "active",
    "started_at": "2026-04-01T...",
    "expires_at": "2026-05-01T...",
    "stripe_subscription_id": "sub_...",
    "benefits_snapshot": { ... },
    "cancelled_at": null,
    "user_name": "Jean Dupont",
    "email": "jean@example.com",
    "plan_name": "Premium",
    "plan_price": 9.99
  }
]
```

### SQL

```sql
SELECT us.*,
       u.name AS user_name, u.email,
       sp.name AS plan_name, sp.price AS plan_price
FROM user_subscriptions us
LEFT JOIN users u              ON u.user_id   = us.user_id
LEFT JOIN subscription_plans sp ON sp.plan_id = us.plan_id
ORDER BY us.created_at DESC
LIMIT 500
```

**Points clés** :
- `LEFT JOIN` (pas INNER) — retourne les subscriptions même si user ou plan supprimé
- `LIMIT 500` — protection contre les réponses trop volumineuses
- Pas de filtre sur status — retourne TOUT (actifs + annulés)
- `benefits_snapshot` désérialisé par `_sub_to_dict`

---

## Endpoint 6 — `POST /api/admin/subscriptions/{subscription_id}/cancel`

### Auth : **ADMIN**

### Requête (body optionnel)

```json
{
  "immediate": false
}
```

| Champ | Type | Défaut | Règle |
|---|---|---|---|
| `immediate` | bool | `false` | Pas de restriction admin (contrairement à S21 user cancel) |

### Réponse 200

```json
{
  "success": true,
  "status": "cancelling"
}
```

### Flow

```
1. require_role("admin")
2. SELECT * FROM user_subscriptions WHERE subscription_id = $1
   → 404 si introuvable
3. new_status = "cancelled" si immediate, "cancelling" sinon
4. Stripe cancel (si stripe_subscription_id présent)
   → Hors transaction, try/except
5. DB UPDATE status + cancelled_at
6. Retourner {success, status}
```

### Différences avec user cancel (S21)

| Aspect | User cancel (S21) | Admin cancel (S22) |
|---|---|---|
| Lookup | `WHERE user_id=$1 AND status IN (...)` | `WHERE subscription_id=$1` (pas de filtre status) |
| Guard immediate | 403 si non admin | Pas de guard (admin par définition) |
| Réponse | `{success, subscription_id, status, message}` | `{success, status}` (PAS de message, PAS de subscription_id) |
| Scope | Abonnement actif de l'utilisateur | N'importe quel abonnement par ID |

### Erreurs

| Code | Condition | Message |
|---|---|---|
| 404 | Subscription introuvable | "Abonnement introuvable" |

### Piège : pas de guard status

Le code ne vérifie PAS si l'abonnement est déjà cancelled. Un admin peut "annuler" un abonnement déjà annulé → UPDATE quand même (`cancelled_at` mis à jour).
