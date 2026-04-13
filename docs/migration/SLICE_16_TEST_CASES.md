# SLICE_16_TEST_CASES.md — Cas de test de la Slice 16
> Source : `webhook_handlers.py`, `payment_routes.py:354–405`.
> Généré le 2026-02-XX.

---

## Pré-requis tests

> ℹ️ Pour tester le webhook en développement :
> - Laisser `STRIPE_WEBHOOK_SECRET` vide → le body JSON est accepté sans vérification de signature
> - Utiliser `stripe listen --forward-to localhost:8001/api/webhook/stripe` pour les tests avec signature réelle

---

## TC-00 — Infrastructure : double event (idempotence)

```
Précondition :
  - event_id "evt_test_001" n'existe PAS dans stripe_webhook_events

Appel 1 :
  POST /api/webhook/stripe
  Body: {"id": "evt_test_001", "type": "payment_intent.canceled", "data": {"object": {"id": "pi_xxx", "metadata": {"payment_id": "pay_abc"}}}}

Résultat attendu appel 1 :
  HTTP 200
  {"received": true}
  stripe_webhook_events.status = 'success'
  payments.status = 'cancelled'

Appel 2 (même body, même event_id) :
  POST /api/webhook/stripe

Résultat attendu appel 2 :
  HTTP 200
  {"received": true, "idempotent_skip": true}
  payments.status = 'cancelled' (INCHANGÉ)
  stripe_webhook_handlers : event_id toujours présent, status inchangé
```

---

## TC-01 — Signature invalide → 400

```
Précondition :
  - STRIPE_WEBHOOK_SECRET = "whsec_test" (non vide)

Appel :
  POST /api/webhook/stripe
  Stripe-Signature: t=1234567890;v1=invalide_signature
  Body: {"id": "evt_001", "type": "payment_intent.succeeded", ...}

Résultat attendu :
  HTTP 400
  {"detail": "Signature invalide : ..."}
  Aucune entrée dans stripe_webhook_events
```

---

## TC-02 — Event ID ou type manquant → 400

```
Appel :
  POST /api/webhook/stripe
  Body: {"type": "payment_intent.succeeded", "data": {...}}
  (pas de "id")

Résultat attendu :
  HTTP 400
  {"detail": "event id/type manquant"}
```

---

## TC-03 — `payment_intent.succeeded` — nominal

```
Préconditions :
  - payments.payment_id = 'pay_abc', status = 'authorized'
  - bookings.booking_id = 'bkg_xyz', status = 'accepted'
  - pi metadata: payment_id='pay_abc', booking_id='bkg_xyz'
  - latest_charge = 'ch_yyy'

Body :
  {"id": "evt_pi_001", "type": "payment_intent.succeeded",
   "data": {"object": {"id": "pi_xxx", "latest_charge": "ch_yyy",
     "metadata": {"payment_id": "pay_abc", "booking_id": "bkg_xyz"}}}}

Résultat attendu :
  HTTP 200 {"received": true}

Vérifications DB :
  - payments.status = 'captured'
  - payments.stripe_charge_id = 'ch_yyy'
  - payments.updated_at mis à jour
  - bookings.status = 'confirmed'
  - bookings.payment_status = 'paid'
  - stripe_webhook_events.status = 'success'
  - stripe_webhook_events.related_id = 'pay_abc'

Notifications attendues :
  - payer : "Réservation confirmée !"
  - receiver : "Nouvelle réservation !"
```

---

## TC-04 — `payment_intent.succeeded` — sans charge_id

```
Préconditions :
  - payments.payment_id = 'pay_abc', status = 'authorized'
  - latest_charge = None (ou ne commence pas par 'ch_')

Body :
  {"type": "payment_intent.succeeded", "data": {"object": {
    "id": "pi_xxx", "latest_charge": null,
    "metadata": {"payment_id": "pay_abc", "booking_id": "bkg_xyz"}}}}

Résultat attendu :
  HTTP 200

Vérifications DB :
  - payments.status = 'captured'
  - payments.stripe_charge_id = NULL (INCHANGÉ — pas de stockage si absent)
```

---

## TC-05 — `checkout.session.completed` — instant_booking (awaiting_payment)

```
Préconditions :
  - bookings.status = 'awaiting_payment'
  - payments.status = 'requires_authorization'
  - session.payment_status = 'unpaid', session.mode = 'payment'

Body :
  {"type": "checkout.session.completed",
   "data": {"object": {"id": "cs_xxx", "mode": "payment",
     "payment_status": "unpaid", "payment_intent": "pi_xxx",
     "metadata": {"payment_id": "pay_abc", "booking_id": "bkg_xyz"}}}}

Résultat attendu :
  HTTP 200

Vérifications DB :
  - payments.status = 'captured'   (instant confirmation)
  - bookings.status = 'confirmed'
  - bookings.payment_status = 'paid'

Notifications :
  - payer + receiver
```

---

## TC-06 — `checkout.session.completed` — manual_approval (requested)

```
Préconditions :
  - bookings.status = 'requested'
  - payments.status = 'requires_authorization'
  - session.payment_status = 'unpaid', mode = 'payment'

Résultat attendu :
  HTTP 200

Vérifications DB :
  - payments.status = 'authorized'   (PAS 'captured')
  - bookings.status = 'requested'    (INCHANGÉ)
  - bookings.payment_status inchangé

Notifications :
  - receiver uniquement ("Paiement autorisé")
```

---

## TC-07 — `checkout.session.completed` — mode=subscription → ignoré

```
Body :
  {"type": "checkout.session.completed",
   "data": {"object": {"mode": "subscription", "subscription": "sub_xxx",
     "metadata": {"plan_id": "plan_pro", "user_id": "usr_abc"}}}}

Résultat attendu :
  HTTP 200 {"received": true}

Vérifications :
  - stripe_webhook_events.status = 'success'
  - Aucun UPDATE payments
  - Aucun UPDATE bookings
  (routé vers _handle_subscription_event → hors scope Slice 16)
```

---

## TC-08 — `payment_intent.amount_capturable_updated`

```
Préconditions :
  - payments.status = 'requires_authorization'

Body :
  {"type": "payment_intent.amount_capturable_updated",
   "data": {"object": {"id": "pi_xxx",
     "metadata": {"payment_id": "pay_abc", "booking_id": "bkg_xyz"}}}}

Vérifications DB :
  - payments.status = 'authorized'
  - Notification → receiver
```

---

## TC-09 — `payment_intent.payment_failed`

```
Préconditions :
  - payments.status = 'authorized' (ou requires_authorization)

Vérifications :
  - payments.status = 'failed'
  - Notification → payer ("Paiement échoué")
```

---

## TC-10 — `payment_intent.canceled`

```
Préconditions :
  - payments.status = 'authorized'

Vérifications :
  - payments.status = 'cancelled'
  - Aucune notification
```

---

## TC-11 — Guard anti-régression : payment déjà `captured`

```
Préconditions :
  - payments.status = 'captured'

Appel : `payment_intent.canceled`

Vérifications :
  - payments.status = 'captured'  (INCHANGÉ — guard WHERE status NOT IN ('captured','refunded','cancelled'))
  - stripe_webhook_events.status = 'success'
```

---

## TC-12 — `charge.refunded` (full)

```
Préconditions :
  - payments.stripe_charge_id = 'ch_yyy'
  - payments.status = 'captured'

Body :
  {"type": "charge.refunded",
   "data": {"object": {"id": "ch_yyy", "amount_refunded": 5000,
     "refunded": true, "payment_intent": "pi_xxx",
     "metadata": {}}}}

Vérifications :
  - payments.status = 'refunded'
  - payments.refund_amount = 50.00  (5000 / 100)
  - payments.refund_status = 'succeeded'
  - Notification → payer ("Remboursement effectué")
```

---

## TC-13 — `charge.refunded` (partial)

```
Body :
  {"type": "charge.refunded",
   "data": {"object": {"id": "ch_yyy", "amount_refunded": 2500,
     "refunded": false, "metadata": {}}}}

Vérifications :
  - payments.status = 'partially_refunded'
  - payments.refund_amount = 25.00
  - Notification → payer ("Remboursement partiel")
```

---

## TC-14 — `charge.refunded` sans payment_id dans metadata (lookup fallback)

```
Préconditions :
  - L'event n'a pas de metadata.payment_id
  - payments.stripe_charge_id = 'ch_yyy' en DB

Body :
  {"type": "charge.refunded",
   "data": {"object": {"id": "ch_yyy", "amount_refunded": 5000,
     "refunded": true, "metadata": {}}}}

Vérifications :
  - _resolve_payment_id() trouve le payment via stripe_charge_id lookup
  - payments.status = 'refunded'
```

---

## TC-15 — `refund.updated` — confirmation remboursement complet

```
Préconditions :
  - payments.payer_total_amount = 50.00
  - payments.stripe_charge_id = 'ch_yyy'

Body :
  {"type": "refund.updated",
   "data": {"object": {"id": "re_xxx", "status": "succeeded",
     "charge": "ch_yyy", "amount": 5000}}}

Vérifications :
  - payments.status = 'refunded'  (amount 50.00 ≈ payer_total_amount 50.00 — tolérance 0.02€)
  - payments.refund_status = 'succeeded'
  - Aucune notification
```

---

## TC-16 — Event inconnu (type non géré)

```
Body :
  {"id": "evt_unknown", "type": "customer.created",
   "data": {"object": {"id": "cus_xxx"}}}

Résultat attendu :
  HTTP 200 {"received": true}
  stripe_webhook_events : inséré avec status 'processing' → 'success' (ou 'ignored')
  Aucun UPDATE sur payments ou bookings
```

---

## TC-17 — `_resolve_payment_id` fallback via stripe_payment_intent_id

```
Préconditions :
  - L'event n'a PAS de metadata.payment_id
  - payments.stripe_payment_intent_id = 'pi_xxx'

Body :
  {"type": "payment_intent.succeeded",
   "data": {"object": {"id": "pi_xxx", "latest_charge": "ch_yyy", "metadata": {}}}}

Vérifications :
  - payment_id résolu via lookup stripe_payment_intent_id
  - payments.status = 'captured'
```

---

## Tableau récapitulatif

| TC | Scénario | HTTP | Priorité |
|---|---|---|---|
| TC-00 | Idempotence double event | 200+200 | CRITIQUE |
| TC-01 | Signature invalide → 400 | 400 | CRITIQUE |
| TC-02 | Event ID manquant → 400 | 400 | CRITIQUE |
| TC-03 | `payment_intent.succeeded` nominal | 200 | CRITIQUE |
| TC-04 | `payment_intent.succeeded` sans charge_id | 200 | OUI |
| TC-05 | `checkout.session.completed` instant_booking | 200 | CRITIQUE |
| TC-06 | `checkout.session.completed` manual_approval | 200 | CRITIQUE |
| TC-07 | `checkout.session.completed` mode=subscription → ignoré | 200 | OUI |
| TC-08 | `amount_capturable_updated` | 200 | OUI |
| TC-09 | `payment_failed` | 200 | OUI |
| TC-10 | `payment_intent.canceled` | 200 | OUI |
| TC-11 | Guard anti-régression | 200 (payment inchangé) | CRITIQUE |
| TC-12 | `charge.refunded` full | 200 | OUI |
| TC-13 | `charge.refunded` partial | 200 | OUI |
| TC-14 | `charge.refunded` fallback lookup | 200 | OUI |
| TC-15 | `refund.updated` complet | 200 | OUI |
| TC-16 | Event inconnu | 200 | OUI |
| TC-17 | `_resolve_payment_id` fallback pi_id | 200 | OUI |
