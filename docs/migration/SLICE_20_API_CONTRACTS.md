# SLICE_20_API_CONTRACTS.md — Contrats webhook subscription
> Basé sur `webhook_handlers.py:584–935`.
> Généré le 2026-04-13.

---

## Nature du composant

Ce n'est **PAS** un endpoint HTTP dédié. Les events subscription arrivent via le webhook unifié
`POST /api/webhook/stripe` (S16) et sont routés par le dispatcher vers `_handle_subscription_event()`.

Ce document décrit les **contrats par type d'événement** : payload Stripe attendu, transitions DB,
et notifications émises.

---

## Event 1 — `checkout.session.completed` (mode=subscription)

### Payload Stripe (champs utilisés)

```json
{
  "id": "evt_...",
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "mode": "subscription",        // ← discriminant (pas "payment")
      "subscription": "sub_...",     // ← stripe_subscription_id
      "metadata": {
        "plan_id": "plan_...",       // ← ID plan interne
        "user_id": "usr_...",        // ← ID user interne
        "product_type": "subscription"
      }
    }
  }
}
```

### Guards

| Condition | Action si échoue |
|---|---|
| `mode != "subscription"` | `return` (silencieux — géré par payment handler) |
| `plan_id` ou `user_id` ou `stripe_sub_id` manquant | `log.warning` + `return` |
| `subscription_plans.plan_id` introuvable | `log.warning` + `return` |
| `user_subscriptions.stripe_subscription_id` déjà existant | `log.debug` + `return` (idempotence) |

### Effets

| Table | Opération | Colonnes |
|---|---|---|
| `subscription_plans` | SELECT | `*` (pour benefits_snapshot) |
| `user_subscriptions` | SELECT (idempotence) | `subscription_id WHERE stripe_subscription_id=$1` |
| `user_subscriptions` | INSERT | `subscription_id, user_id, plan_id, status='active', started_at=NOW(), expires_at, stripe_subscription_id, benefits_snapshot` |

### Appel Stripe réseau (DANS le handler)

```python
stripe_sub = await stripe_service.retrieve_subscription(stripe_sub_id)
expires_at = datetime.fromtimestamp(stripe_sub.current_period_end, tz=timezone.utc)
```
- **Protégé par try/except** — si l'appel échoue, `expires_at=None`
- Appelé pour obtenir `current_period_end` (pas disponible dans le payload checkout)

### Notification

```json
{
  "type": "subscription_activated",
  "title": "Abonnement activé !",
  "body": "Votre abonnement {plan_name} est maintenant actif.",
  "data": {
    "type": "subscription_activated",
    "subscription_id": "sub_...",
    "plan_id": "plan_...",
    "plan_name": "..."
  }
}
```

---

## Event 2 — `customer.subscription.created`

### Payload Stripe (champs utilisés)

```json
{
  "type": "customer.subscription.created",
  "data": {
    "object": {
      "id": "sub_...",              // ← stripe_subscription_id
      "current_period_end": 1234567890,
      "metadata": {
        "plan_id": "plan_...",
        "user_id": "usr_..."
      }
    }
  }
}
```

### Guards

| Condition | Action si échoue |
|---|---|
| `plan_id` ou `user_id` manquant dans metadata | `return` (souscription Dashboard Stripe) |
| `stripe_subscription_id` déjà en DB | `return` (déjà traité via checkout.session.completed) |
| `subscription_plans.plan_id` introuvable | `return` |

### Effets

Identiques à Event 1 (INSERT user_subscriptions + notification), mais :
- **PAS d'appel Stripe réseau** — `current_period_end` est directement dans le payload
- `expires_at` calculé depuis `obj.current_period_end`

### Rôle

**Filet de sécurité** pour les souscriptions créées par API directe (pas via Checkout).
Dans le flux normal (Checkout), Event 1 arrive AVANT Event 2. Event 2 est alors idempotent (skip).

---

## Event 3 — `customer.subscription.updated`

### Payload Stripe (champs utilisés)

```json
{
  "type": "customer.subscription.updated",
  "data": {
    "object": {
      "id": "sub_...",
      "status": "active",            // ou "canceled", "past_due", "trialing"
      "cancel_at_period_end": true,  // true = annulation programmée
      "current_period_end": 1234567890
    }
  }
}
```

### Mapping statut Stripe → statut interne (CRITIQUE)

| `stripe_status` | `cancel_at_period_end` | Statut interne |
|---|---|---|
| `"active"` | `true` | `"cancelling"` |
| `"active"` | `false` | `"active"` |
| `"canceled"` ou `"cancelled"` | — | `"cancelled"` |
| `"past_due"` | — | `"past_due"` |
| `"trialing"` | — | `"trialing"` |
| Toute autre valeur | — | Passthrough (valeur brute) |

### Guard

```sql
WHERE stripe_subscription_id = $N AND status NOT IN ('cancelled')
```
Un abonnement déjà `cancelled` ne peut PAS être réactivé par un webhook `updated`.

### Effets

| Table | Opération | Colonnes |
|---|---|---|
| `user_subscriptions` | UPDATE | `status, expires_at (si présent), updated_at` |

### SQL conditionnel (expires_at optionnel)

```python
if expires_at:
    UPDATE ... SET status=$1, expires_at=$2, updated_at=NOW() WHERE stripe_subscription_id=$3 AND status NOT IN ('cancelled')
else:
    UPDATE ... SET status=$1, updated_at=NOW() WHERE stripe_subscription_id=$2 AND status NOT IN ('cancelled')
```

**Piège Java** : 2 requêtes SQL distinctes selon la présence de `expires_at`. En Java, utiliser un `@Query` natif conditionnel ou un `CriteriaBuilder`.

### Notifications (conditionnelles sur `_rows(res) > 0`)

| Statut | Notification |
|---|---|
| `"cancelling"` | `subscription_cancelling` — "Annulation programmée" |
| `"cancelled"` | `subscription_cancelled` — "Abonnement annulé" |
| Autres | **Pas de notification** |

---

## Event 4 — `customer.subscription.deleted`

### Payload Stripe

```json
{
  "type": "customer.subscription.deleted",
  "data": {
    "object": {
      "id": "sub_..."
    }
  }
}
```

### Effets

```sql
UPDATE user_subscriptions
SET status='cancelled', cancelled_at=NOW(), updated_at=NOW()
WHERE stripe_subscription_id=$1
```

**Pas de guard `NOT IN ('cancelled')`** — contrairement à Event 3, cette branche fait un UPDATE inconditionnel.
Raison : `subscription.deleted` est l'event TERMINAL de Stripe — il doit toujours s'appliquer.

### Notification

```json
{
  "type": "subscription_cancelled",
  "title": "Abonnement résilié",
  "body": "Votre abonnement a été résilié."
}
```
Émise uniquement si `_rows(res) > 0` (vraie transition).

### Lookup user_id

`user_id` est récupéré AVANT l'UPDATE via :
```python
row = await conn.fetchrow("SELECT user_id FROM user_subscriptions WHERE stripe_subscription_id=$1 LIMIT 1", stripe_sub_id)
```

---

## Event 5 — `invoice.paid`

### Payload Stripe (champs utilisés)

```json
{
  "type": "invoice.paid",
  "data": {
    "object": {
      "subscription": "sub_...",
      "lines": {
        "data": [
          {
            "period": {
              "end": 1234567890     // ← nouvelle date d'expiration
            }
          }
        ]
      }
    }
  }
}
```

### Guards

| Condition | Action si échoue |
|---|---|
| `subscription` absent | `return` (pas un invoice abonnement) |
| `period_end` non trouvé dans `lines.data[0].period.end` | `log.warning` + pas d'UPDATE |

### Effets

```sql
UPDATE user_subscriptions
SET expires_at=$1, status='active', updated_at=NOW()
WHERE stripe_subscription_id=$2
  AND status NOT IN ('cancelled')
```

**Rôle** : renouvellement automatique — met à jour `expires_at` et force `status='active'`
(un abonnement `past_due` qui redevient payé → `active`).

### Extraction `period_end` (PIÈGE)

```python
lines     = _get(obj, "lines", {})
data_list = lines.get("data", []) if isinstance(lines, dict) else getattr(lines, "data", [])
period    = data_list[0].get("period", {}) if data_list else {}
period_end = period.get("end") if isinstance(period, dict) else getattr(period, "end", None)
```

**Piège Java** : `invoice.lines.data` est un objet paginé Stripe avec une propriété `data` qui est une liste.
En Java, utiliser `invoice.getLines().getData().get(0).getPeriod().getEnd()` avec des null checks.

### Notification

```json
{
  "type": "subscription_renewed",
  "title": "Abonnement renouvelé",
  "body": "Votre abonnement a été renouvelé avec succès.",
  "data": {
    "expires_at": "2026-05-13T..."
  }
}
```

---

## Event 6 — `invoice.payment_failed`

### Payload Stripe

```json
{
  "type": "invoice.payment_failed",
  "data": {
    "object": {
      "subscription": "sub_..."
    }
  }
}
```

### Guard

```sql
WHERE stripe_subscription_id=$1 AND status NOT IN ('cancelled')
```

### Effets

```sql
UPDATE user_subscriptions
SET status='past_due', updated_at=NOW()
WHERE stripe_subscription_id=$1
  AND status NOT IN ('cancelled')
```

### Notification

```json
{
  "type": "subscription_payment_failed",
  "title": "Paiement abonnement échoué",
  "body": "Le renouvellement de votre abonnement a échoué. Veuillez mettre à jour votre moyen de paiement."
}
```

---

## Sous-dispatcher — `_dispatch_subscription()`

### Rôle

Appelé par `dispatch()` après le routing par `_SUBSCRIPTION_EVENTS`.
Responsabilités :
1. Guard `mode=subscription` pour `checkout.session.completed`
2. Appel `_handle_subscription_event()`
3. Résolution `related_id` (lookup `subscription_id` depuis `stripe_subscription_id`)

### Retour

`subscription_id` local (pour `_mark_done(related_id=...)`) ou `None`.

```python
# webhook_handlers.py:1074–1105
async def _dispatch_subscription(conn, event_type, obj, pending_notifs) -> str | None:
    if event_type == "checkout.session.completed":
        mode = _get(obj, "mode", "")
        if mode != "subscription":
            return None

    await _handle_subscription_event(conn, event_type, obj, pending_notifs)

    # Lookup subscription_id pour related_id
    stripe_sub_id = ...
    row = await conn.fetchrow(
        "SELECT subscription_id FROM user_subscriptions WHERE stripe_subscription_id=$1",
        stripe_sub_id)
    return row["subscription_id"] if row else None
```

---

## Résumé des contrats par event

| Event | DB Write | Stripe Call | Notification | Guard |
|---|---|---|---|---|
| checkout.session.completed (sub) | INSERT | `retrieve_subscription` | activated | mode + metadata + idempotence |
| subscription.created | INSERT | — | activated | metadata + idempotence |
| subscription.updated | UPDATE status | — | cancelling/cancelled | NOT IN ('cancelled') |
| subscription.deleted | UPDATE cancelled | — | cancelled | inconditionnel |
| invoice.paid | UPDATE active + expires | — | renewed | NOT IN ('cancelled') + period_end |
| invoice.payment_failed | UPDATE past_due | — | payment_failed | NOT IN ('cancelled') |
