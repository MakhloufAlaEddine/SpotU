# SLICE_22_DB_MAPPING.md — Mapping base de données
> Basé sur `admin_routes.py:208–283`, `subscription_routes.py:453–511`.
> Généré le 2026-04-13.

---

## Tables impliquées

### Table `subscription_plans` — CRUD complet

| Endpoint | Opération | SQL |
|---|---|---|
| GET plans | SELECT | `SELECT * FROM subscription_plans ORDER BY priority DESC, created_at` |
| POST plans | INSERT | `INSERT INTO subscription_plans (...11 cols...) VALUES (...) RETURNING *` |
| PUT plans | UPDATE | `UPDATE subscription_plans SET {dynamique}, updated_at=NOW() WHERE plan_id=$1` |
| DELETE plans | DELETE | `DELETE FROM subscription_plans WHERE plan_id=$1` |

#### Colonnes INSERT (11)

| Colonne | Source | Type DB |
|---|---|---|
| `plan_id` | `new_id("plan")` | text PK |
| `name` | body.name (requis) | text NOT NULL |
| `description` | body.description | text |
| `price` | `float(body.get("price", 0))` | numeric(10,2) |
| `duration_days` | body.duration_days | integer |
| `exempt_payer_fixed` | bool, défaut false | boolean |
| `exempt_payer_percent` | bool, défaut false | boolean |
| `exempt_receiver_fixed` | bool, défaut false | boolean |
| `exempt_receiver_percent` | bool, défaut false | boolean |
| `active` | bool, défaut true | boolean |
| `priority` | int, défaut 0 | integer |

**Colonnes NON insérées** (gérées par DB ou par S21) :
- `created_at` → `DEFAULT now()`
- `updated_at` → `DEFAULT now()`
- `stripe_product_id` → NULL (créé par S21 au premier subscribe)
- `stripe_price_id` → NULL (créé par S21 au premier subscribe)

#### Colonnes UPDATE (set `allowed`)

```
name, description, price, duration_days,
exempt_payer_fixed, exempt_payer_percent,
exempt_receiver_fixed, exempt_receiver_percent,
active, priority
```

`updated_at = NOW()` est toujours ajouté au SET.
`stripe_product_id` et `stripe_price_id` ne sont PAS dans `allowed` → ne peuvent pas être modifiés par l'admin via PUT.

---

### Table `user_subscriptions` — SELECT + UPDATE

| Endpoint | Opération | SQL |
|---|---|---|
| GET subscriptions | SELECT | JOIN users + subscription_plans, LIMIT 500 |
| POST cancel | SELECT | `SELECT * FROM user_subscriptions WHERE subscription_id=$1` |
| POST cancel | UPDATE | `UPDATE ... SET status=$1, cancelled_at=NOW(), updated_at=NOW() WHERE subscription_id=$2` |

### Table `users` — SELECT (JOIN)

| Endpoint | Opération | Colonnes |
|---|---|---|
| GET subscriptions | SELECT (LEFT JOIN) | `name AS user_name, email` |

---

## FK Constraint — Risque DELETE plan

```sql
ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(plan_id);
```

**Pas de `ON DELETE CASCADE`** — la FK est simple (pas de clause ON DELETE).
PostgreSQL par défaut : `ON DELETE NO ACTION` → erreur si des `user_subscriptions` référencent le plan.

Le code Python NE gère PAS cette erreur. En production, supprimer un plan avec des abonnements liés → 500.

**Recommandation Java** : catch `DataIntegrityViolationException` → HTTP 409.

---

## Aucune migration de schéma requise

Les tables existent déjà. Aucune colonne, index ou contrainte à ajouter.
