# SLICE_16_API_CONTRACTS.md — Contrats API de la Slice 16
> Source : `payment_routes.py:354–405`.
> Généré le 2026-02-XX.

---

## Endpoint — Webhook Stripe

```
POST /api/webhook/stripe
```

### Nature de cet endpoint

Ce n'est PAS un endpoint utilisateur. Il est appelé **exclusivement par Stripe** (serveur Stripe → backend SpotU). Il n'y a aucun utilisateur authentifié, aucun Bearer token.

---

### Authentification

| Propriété | Valeur |
|---|---|
| Méthode | HMAC-SHA256 (header `Stripe-Signature`) |
| Secret | `STRIPE_WEBHOOK_SECRET` (env var `whsec_...`) |
| Obligatoire | OUI en production |
| Dev/test | Si `STRIPE_WEBHOOK_SECRET` vide → parse JSON brut sans vérification |

---

### Headers requis

| Header | Valeur | Obligatoire |
|---|---|---|
| `Content-Type` | `application/json` | OUI (body JSON) |
| `Stripe-Signature` | `t=...;v1=...` | OUI en production |

> ⚠️ **CRITIQUE** : Le header `Stripe-Signature` est calculé par Stripe sur le **body brut**. Si Spring Boot parse ou réencode le body JSON avant la vérification, la signature est invalide.

---

### Body

```json
{
  "id": "evt_xxx",
  "type": "payment_intent.succeeded",
  "data": {
    "object": { ... }
  }
}
```

Le body est un **Stripe Event Object** (format fixe Stripe). Il doit être lu en bytes bruts.

---

### Réponse succès

```
HTTP 200 OK
Content-Type: application/json
```

```json
{ "received": true }
```

> ℹ️ La réponse est **toujours `{"received": true}`** quel que soit le résultat du traitement.
> Même en cas d'erreur dans le handler, retourner HTTP 200 (sinon Stripe réessaie).
> Les erreurs sont loggées en DB (`stripe_webhook_events.status = 'error'`).

### Réponse idempotente (event déjà traité)

```json
{ "received": true, "idempotent_skip": true }
```

---

### Codes d'erreur

| Code HTTP | Condition | Message |
|---|---|---|
| `400` | Signature invalide (`SignatureVerificationError`) | `"Signature invalide : ..."` |
| `400` | Body JSON invalide (mode dev uniquement) | `"Body JSON invalide"` |
| `400` | `event_id` ou `event_type` manquant | `"event id/type manquant"` |
| `200` | Toute autre erreur (handler exception) | `{"received": true}` — NE PAS lever 500 |

---

### Effets de bord (selon event_type)

#### `checkout.session.completed` (mode=payment, ps=unpaid, booking=awaiting_payment)
- `payments.status` → `captured`
- `bookings.status` → `confirmed`, `bookings.payment_status` → `paid`
- Notifications → payer ("Réservation confirmée !") + receiver ("Nouvelle réservation !")

#### `checkout.session.completed` (mode=payment, ps=unpaid, booking=requested)
- `payments.status` → `authorized`
- Notification → receiver ("Paiement autorisé")

#### `checkout.session.completed` (mode=payment, ps=paid)
- `payments.status` → `captured`
- `bookings.status` → `confirmed`, `bookings.payment_status` → `paid`
- Notifications → payer + receiver

#### `payment_intent.amount_capturable_updated`
- `payments.status` → `authorized`
- Notification → receiver ("Paiement autorisé")

#### `payment_intent.succeeded`
- `payments.status` → `captured`, `payments.stripe_charge_id` = `latest_charge` (si `ch_...`)
- `bookings.status` → `confirmed`, `bookings.payment_status` → `paid`
- Notifications → payer + receiver

#### `payment_intent.payment_failed`
- `payments.status` → `failed`
- Notification → payer ("Paiement échoué")

#### `payment_intent.canceled`
- `payments.status` → `cancelled`
- Aucune notification (booking déjà notifié via refuse/cancel)

#### `charge.refunded` (full)
- `payments.status` → `refunded`, `payments.refund_amount` = montant remboursé
- `payments.refund_status` → `succeeded`, `payments.stripe_charge_id` = COALESCE existant
- Notification → payer ("Remboursement effectué")

#### `charge.refunded` (partial)
- `payments.status` → `partially_refunded`, `payments.refund_amount` = montant
- Notification → payer ("Remboursement partiel")

#### `refund.updated`
- `payments.refund_status` → valeur Stripe (succeeded/failed/canceled)
- Si amount = payer_total_amount et refund succeeded → `payments.status` → `refunded`
- Aucune notification supplémentaire

---

### Exemples de payloads Stripe

#### `payment_intent.succeeded`
```json
{
  "id": "evt_001",
  "type": "payment_intent.succeeded",
  "data": {
    "object": {
      "id": "pi_xxx",
      "status": "succeeded",
      "latest_charge": "ch_yyy",
      "metadata": {
        "payment_id": "pay_abc",
        "booking_id": "bkg_xyz"
      }
    }
  }
}
```

#### `charge.refunded`
```json
{
  "id": "evt_002",
  "type": "charge.refunded",
  "data": {
    "object": {
      "id": "ch_yyy",
      "payment_intent": "pi_xxx",
      "amount_refunded": 5000,
      "refunded": true,
      "metadata": {}
    }
  }
}
```

---

### Appel curl de test (mode dev — sans signature)

```bash
# Mode dev : STRIPE_WEBHOOK_SECRET vide → pas de vérification signature
curl -X POST "$API_URL/api/webhook/stripe" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt_test_001",
    "type": "payment_intent.succeeded",
    "data": {
      "object": {
        "id": "pi_test",
        "latest_charge": "ch_test",
        "metadata": {
          "payment_id": "pay_abc",
          "booking_id": "bkg_xyz"
        }
      }
    }
  }'
```

> ⚠️ En production avec `STRIPE_WEBHOOK_SECRET` configuré, utiliser `stripe trigger` ou
> le Stripe CLI pour générer une signature valide.

---

### Appel Stripe CLI (test avec signature)

```bash
stripe trigger payment_intent.succeeded \
  --add payment_intent:metadata.payment_id=pay_abc \
  --add payment_intent:metadata.booking_id=bkg_xyz
```
