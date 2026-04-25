# SLICE_33_API_CONTRACTS.md — Contrats API Webhook Payment Handlers
> Basé sur `webhook_handlers.py:122–180, 185–453, 1007–1027`.
> Généré le 2026-04-25.

---

## Endpoint réutilisé — `POST /api/webhook/stripe` (S32)

S33 **n'expose pas** de nouvel endpoint. Le contrat HTTP du wrapper (signature, raw body, format réponse) est intégralement défini dans `SLICE_32_API_CONTRACTS.md`.

S33 documente :
- Les **payloads Stripe** attendus par event
- Les **transitions DB** déclenchées
- Les **notifications** émises
- Les **effets de bord** par event

---

## Event 1 — `checkout.session.completed` (mode=payment)

### Payload Stripe (extrait pertinent)

```json
{
  "id": "evt_001",
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "id": "cs_test_xxx",
      "object": "checkout.session",
      "mode": "payment",                      // OU "subscription" → S35
      "payment_status": "unpaid" | "paid",
      "payment_intent": "pi_xxx",
      "amount_total": 5175,
      "currency": "eur",
      "metadata": {
        "payment_id": "pay_abc",              // CRITIQUE — set en S30
        "booking_id": "bkg_xyz"
      }
    }
  }
}
```

### Routage

```
SI mode == "subscription" → return immédiat (S35)
SINON :
  SI payment_status == "unpaid" :
    Lookup bookings.status WHERE booking_id=$1
    SI bookings.status == "awaiting_payment" :
      → Branch A : capture immédiate (instant_booking)
    SINON :
      → Branch B : autorisation seulement (manual_approval)
  SINON SI payment_status == "paid" :
    → Branch C : capture immédiate
```

### Branch A — `unpaid` + `awaiting_payment` (instant_booking auto-confirm)

**Effets DB (transaction atomique)** :
```sql
-- (1) UPDATE payments
UPDATE payments
   SET status='captured', updated_at=NOW()
 WHERE payment_id=$1
   AND status NOT IN ('captured','refunded','cancelled')
-- → rows_updated = N

-- (2) UPDATE bookings (si booking_id présent)
UPDATE bookings
   SET status='confirmed', payment_status='paid', updated_at=NOW()
 WHERE booking_id=$1
   AND status NOT IN ('confirmed','refused','cancelled','expired')
```

**Notifications** (si `rows_updated > 0` ET `booking_id` présent) :
- → `payer_user_id` : `booking_confirmed` — *"Réservation confirmée !" + "Votre réservation pour « {title} » est confirmée. À bientôt !"*
- → `receiver_user_id` : `booking_confirmed` — *"Nouvelle réservation !" + "Paiement reçu pour « {title} ». Votre planning a été mis à jour."*

### Branch B — `unpaid` + autre statut (manual_approval, autorisation seule)

**Effets DB** :
```sql
UPDATE payments
   SET status='authorized', updated_at=NOW()
 WHERE payment_id=$1
   AND status NOT IN ('authorized','captured','refunded','cancelled')
```

**Notifications** (si `rows_updated > 0`) :
- → `receiver_user_id` : `payment_authorized` — *"Paiement autorisé" + "Le paiement pour votre prestation a été autorisé."*

### Branch C — `paid` (capture immédiate Stripe)

**Effets DB (transaction atomique)** : identiques à Branch A (capture + confirm).

**Notifications** (si `rows_captured > 0` ET `booking_id` présent) : 2 notifs `booking_confirmed` (libellés très légèrement différents — voir BUSINESS_RULES BR-33.04).

---

## Event 2 — `payment_intent.amount_capturable_updated`

### Payload Stripe

```json
{
  "id": "evt_002",
  "type": "payment_intent.amount_capturable_updated",
  "data": {
    "object": {
      "id": "pi_xxx",
      "amount_capturable": 5175,
      "metadata": { "payment_id": "pay_abc", "booking_id": "bkg_xyz" }
    }
  }
}
```

### Effets DB

```sql
UPDATE payments
   SET status='authorized', updated_at=NOW()
 WHERE payment_id=$1
   AND status NOT IN ('authorized','captured','refunded','cancelled')
```

### Notifications (si `rows_updated > 0`)

- → `receiver_user_id` : `payment_authorized` — *"Paiement autorisé" + "Le paiement pour votre prestation est confirmé — vous pouvez procéder."*

> ⚠️ Body de la notification **différent** de Branch B (subtil mais à reproduire).

---

## Event 3 — `payment_intent.succeeded`

### Payload Stripe

```json
{
  "id": "evt_003",
  "type": "payment_intent.succeeded",
  "data": {
    "object": {
      "id": "pi_xxx",
      "latest_charge": "ch_xxx",          // peut être null
      "amount_received": 5175,
      "metadata": { "payment_id": "pay_abc", "booking_id": "bkg_xyz" }
    }
  }
}
```

### Effets DB (transaction atomique)

**Branche A — `latest_charge` est un string commençant par `"ch_"`** :
```sql
UPDATE payments
   SET status='captured', stripe_charge_id=$1, updated_at=NOW()
 WHERE payment_id=$2
   AND status NOT IN ('captured','refunded')
```

**Branche B — `latest_charge` absent ou invalide** :
```sql
UPDATE payments
   SET status='captured', updated_at=NOW()
 WHERE payment_id=$1
   AND status NOT IN ('captured','refunded')
```

Puis (toujours, si `booking_id` présent) :
```sql
UPDATE bookings
   SET status='confirmed', payment_status='paid', updated_at=NOW()
 WHERE booking_id=$1
   AND status NOT IN ('confirmed','refused','cancelled','expired')
```

### Notifications (si `rows_captured > 0` ET `booking_id` présent)

- → `payer_user_id` : `booking_confirmed` — *"Réservation confirmée !" + "Votre réservation pour « {title} » est confirmée."*
- → `receiver_user_id` : `booking_confirmed` — *"Nouvelle réservation !" + "Paiement capturé pour « {title} ». Votre planning a été mis à jour."*

> ⚠️ Body receiver dit **"Paiement capturé"** (PI succeeded) vs **"Paiement reçu"** (checkout.session paid). À reproduire.

---

## Event 4 — `payment_intent.payment_failed`

### Payload Stripe

```json
{
  "id": "evt_004",
  "type": "payment_intent.payment_failed",
  "data": {
    "object": {
      "id": "pi_xxx",
      "last_payment_error": { "code": "card_declined", "message": "..." },
      "metadata": { "payment_id": "pay_abc", "booking_id": "bkg_xyz" }
    }
  }
}
```

### Effets DB

```sql
UPDATE payments
   SET status='failed', updated_at=NOW()
 WHERE payment_id=$1
   AND status NOT IN ('captured','refunded','failed')
```

### Notifications (si `rows_updated > 0`)

- → `payer_user_id` : `payment_failed` — *"Paiement échoué" + "Votre paiement n'a pas pu être traité. Veuillez vérifier votre moyen de paiement."*

> ⚠️ Pas de notif au `receiver` (asymétrie volontaire).

> ⚠️ **Aucune action sur `bookings`** : la booking reste dans son état (le buyer peut retry).

---

## Event 5 — `payment_intent.canceled`

### Payload Stripe

```json
{
  "id": "evt_005",
  "type": "payment_intent.canceled",
  "data": {
    "object": {
      "id": "pi_xxx",
      "cancellation_reason": "requested_by_customer",
      "metadata": { "payment_id": "pay_abc", "booking_id": "bkg_xyz" }
    }
  }
}
```

### Effets DB

```sql
UPDATE payments
   SET status='cancelled', updated_at=NOW()
 WHERE payment_id=$1
   AND status NOT IN ('captured','refunded','cancelled')
```

### Notifications

**AUCUNE.** Justification (commentaire Python ligne 443) : *"Pas de notification : la réservation a déjà notifié via refuse/cancel"*.

> ⚠️ Java doit reproduire cette asymétrie. **Ne pas ajouter de notif "par cohérence".**

---

## Réponse HTTP (toutes branches)

Le wrapper S32 retourne toujours :

| Cas | HTTP | Body |
|---|---|---|
| Event traité avec succès | 200 | `{"received": true}` |
| Event doublon (idempotence) | 200 | `{"received": true, "idempotent_skip": true}` |
| Handler exception (catché par dispatcher) | 200 | `{"received": true}` (mais `stripe_webhook_events.status='error'`) |

---

## Effets de bord par event — synthèse

| Event | UPDATE payments | UPDATE bookings | Notifs émises (max) |
|---|---|---|---|
| `checkout.session.completed` (mode=payment, ps=unpaid, awaiting_payment) | captured | confirmed + paid | 2 (booking_confirmed) |
| `checkout.session.completed` (mode=payment, ps=unpaid, autre) | authorized | aucune | 1 (payment_authorized) |
| `checkout.session.completed` (mode=payment, ps=paid) | captured | confirmed + paid | 2 (booking_confirmed) |
| `checkout.session.completed` (mode=subscription) | aucune | aucune | aucune (S35) |
| `payment_intent.amount_capturable_updated` | authorized | aucune | 1 (payment_authorized) |
| `payment_intent.succeeded` | captured (+stripe_charge_id) | confirmed + paid | 2 (booking_confirmed) |
| `payment_intent.payment_failed` | failed | aucune | 1 (payment_failed) |
| `payment_intent.canceled` | cancelled | aucune | **0** |

---

## Logging requis (compat stricte)

Après chaque appel `_handle_payment_event`, log INFO :
```
"Payment event traité : type=%s | payment=%s | booking=%s"
```

SLF4J Java :
```java
log.info("Payment event traité : type={} | payment={} | booking={}", eventType, paymentId, bookingId);
```

> Le log est émis **même si aucune transition** (rows_updated == 0) — il indique seulement que le handler a été invoqué.

---

## Cas limites

| Cas | Comportement Python | Java doit reproduire |
|---|---|---|
| `payment_id` introuvable (`_resolve_payment_id` retourne `None,None`) + event ≠ `checkout.session.completed` | log DEBUG `"Webhook payment sans payment_id : type=..."` + skip handler + mark_done success | ✅ |
| `payment_id` introuvable + event = `checkout.session.completed` | skip silencieux (peut être subscription) | ✅ |
| `booking_id` absent (paiement orphelin) | UPDATE payments OK, **PAS** d'UPDATE bookings, **PAS** de notif (les notifs nécessitent `booking_id`) | ✅ |
| `services.title` introuvable (JOIN échoue) | fallback `"votre prestation"` | ✅ |
| `latest_charge` non-string (ex: dict expanded ou null) | branche fallback sans stripe_charge_id | ✅ |
| `rows_updated == 0` (status déjà final) | aucune notif émise | ✅ |
