# SLICE_15_TEST_CASES.md — Cas de test de la Slice 15
> Basé sur `booking_routes.py:754–977`.
> Généré le 2026-02-XX.

---

## Cas nominaux — Payer annule

### TC-01 — Payer annule un booking `requested`

```
Préconditions :
  - booking.status = 'requested'
  - payments.status = 'requires_authorization'
  - Appelant = payer_user_id (ou user_id)

Appel :
  POST /api/bookings/{id}/cancel
  Authorization: Bearer <payer_token>
  { "reason": "Changement de plans" }

Résultat attendu :
  HTTP 200
  {
    "success": true, "status": "cancelled",
    "payment_status": "cancelled",
    "cancelled_by": "<payer_id>",
    "stripe_action": "pi_cancelled"   (si pi_id présent)
  }

Vérifications DB :
  - bookings.status = 'cancelled'
  - bookings.cancelled_by_user_id = payer_user_id
  - bookings.cancellation_reason = 'Changement de plans'
  - payments.status = 'cancelled'
  - service_slots.slot_status = 'available'  (si slot_id et slot en pending/reserved)
```

---

### TC-02 — Payer annule un booking `accepted` (paiement non encore effectué)

```
Préconditions :
  - booking.status = 'accepted'
  - payments.status = 'requires_authorization'

Résultat attendu :
  HTTP 200 — idem TC-01 (même branche payment)
  stripe_action = "pi_cancelled"
```

---

### TC-03 — Payer annule un booking confirmé et payé (refund)

```
Préconditions :
  - booking.status = 'confirmed'
  - payments.status = 'captured'
  - payments.stripe_charge_id = 'ch_xxx' (présent)

Résultat attendu :
  HTTP 200
  {
    "payment_status": "refunded",
    "stripe_action": "refund_created"
  }

Vérifications DB :
  - payments.status = 'refunded'
  - bookings.status = 'cancelled'
```

---

### TC-04 — Payer annule sans body (reason null)

```
Appel :
  POST /api/bookings/{id}/cancel
  Authorization: Bearer <payer_token>
  (body absent)

Résultat attendu :
  HTTP 200 — succès normal

Vérification DB :
  - bookings.cancellation_reason = NULL
```

---

## Cas nominaux — Receiver annule

### TC-05 — Receiver annule un booking `accepted`

```
Préconditions :
  - booking.status = 'accepted'
  - payments.status = 'requires_authorization'
  - Appelant = receiver_user_id

Résultat attendu :
  HTTP 200
  {
    "payment_status": "cancelled",
    "cancelled_by": "<receiver_id>",
    "stripe_action": "pi_cancelled"
  }

Push attendu :
  → payer : "Réservation annulée par le prestataire"
```

---

### TC-06 — Receiver annule un booking confirmé (refund)

```
Préconditions :
  - booking.status = 'confirmed'
  - payments.status = 'captured', charge_id présent
  - Appelant = receiver

Résultat attendu :
  HTTP 200
  {
    "payment_status": "refunded",
    "stripe_action": "refund_created"
  }

Push attendu :
  → payer : "Réservation annulée par le prestataire. Un remboursement a été initié."
```

---

## Cas nominaux — Admin annule

### TC-07 — Admin annule tout état annulable

```
Préconditions :
  - booking.status = 'requested'  (ou 'accepted', 'awaiting_payment', 'confirmed')
  - Appelant = admin (role='admin')

Résultat attendu :
  HTTP 200 — succès

Push attendu :
  → payer  : "Réservation annulée" (cancelled_by: "admin")
  → receiver : "Réservation annulée" (cancelled_by: "admin")
  (2 notifications distinctes)
```

---

## Cas d'accès refusé

### TC-08 — Tiers non impliqué → 403

```
Préconditions :
  - Appelant = utilisateur ni payer ni receiver ni admin

Résultat attendu :
  HTTP 403 — "Vous n'êtes pas autorisé à annuler cette réservation"
```

---

### TC-09 — Token absent → 401

```
Appel sans Authorization header
Résultat attendu : HTTP 401
```

---

### TC-10 — Receiver tente d'annuler un booking `requested` → 409

```
Préconditions :
  - booking.status = 'requested'
  - Appelant = receiver (pas payer, pas admin)

Résultat attendu :
  HTTP 409
  {
    "detail": "Le bénéficiaire peut annuler uniquement une réservation acceptée
               (état actuel : 'requested'). Pour refuser une demande en attente, utilisez /refuse."
  }

Vérification DB : bookings.status INCHANGÉ
```

---

### TC-11 — Receiver tente d'annuler un booking `awaiting_payment` → 409

```
Préconditions :
  - booking.status = 'awaiting_payment'
  - Appelant = receiver

Résultat attendu : HTTP 409 (même message que TC-10)
```

---

## Statuts non annulables → 409

### TC-12 — Booking `completed` → 409

```
Préconditions : booking.status = 'completed', appelant = payer ou receiver ou admin
Résultat attendu :
  HTTP 409 — "Impossible d'annuler une réservation en état 'completed'"
```

---

### TC-13 — Booking `refused` → 409

```
Préconditions : booking.status = 'refused'
Résultat attendu : HTTP 409 — "Impossible d'annuler une réservation en état 'refused'"
```

---

### TC-14 — Booking `expired` → 409

```
Préconditions : booking.status = 'expired'
Résultat attendu : HTTP 409 — "Impossible d'annuler une réservation en état 'expired'"
```

---

## Booking introuvable

### TC-15 — booking_id inexistant → 404

```
Appel : POST /api/bookings/bkg_inexistant/cancel
Résultat attendu : HTTP 404
```

---

## Idempotence

### TC-16 — Double annulation (déjà cancelled)

```
Séquence :
  1. POST /cancel → HTTP 200 {"status": "cancelled"}
  2. POST /cancel (même booking, même token) → ?

Résultat attendu 2e appel :
  HTTP 200
  { "success": true, "status": "cancelled", "idempotent": true }

⚠️ Pas de payment_status, cancelled_by, stripe_action dans la réponse idempotente.
Vérification DB : bookings.status inchangé à 'cancelled'.
```

---

## Cas Stripe spécifiques

### TC-17 — Capture effectuée sans `charge_id` (refund impossible)

```
Préconditions :
  - payments.status = 'captured'
  - payments.stripe_charge_id = NULL (proxy Emergent / PI sans capture physique)
  - Appelant = payer

Résultat attendu :
  HTTP 200
  {
    "payment_status": "refunded",   ← DB mise à jour
    "stripe_action": null           ← Stripe non appelé
  }

Comportement interne :
  - DB payments.status → 'refunded'
  - Aucun appel Stripe (log WARNING uniquement)
  - Pas d'exception levée

⚠️ stripe_action = null même si payment_status = 'refunded'.
```

---

### TC-18 — Annulation sans PaymentIntent (booking sans paiement initié)

```
Préconditions :
  - payments.status = 'requires_authorization'
  - payments.stripe_payment_intent_id = NULL
  - Appelant = payer

Résultat attendu :
  HTTP 200
  {
    "payment_status": "cancelled",
    "stripe_action": null   ← pi_id absent → pas d'appel Stripe
  }
```

---

### TC-19 — Payment en état `pending` ou `failed` (inchangé)

```
Préconditions :
  - payments.status = 'pending'  (ou 'failed')

Résultat attendu :
  HTTP 200
  {
    "payment_status": "pending",  ← inchangé
    "stripe_action": null
  }
```

---

### TC-20 — Aucun enregistrement payments (LEFT JOIN → NULL)

```
Préconditions :
  - Aucune ligne dans payments pour ce booking_id

Résultat attendu :
  HTTP 200
  {
    "payment_status": "",   ← pay_status = None → or "" → branche else inchangé
    "stripe_action": null
  }

Vérification DB :
  - bookings.status = 'cancelled'
  - Aucun UPDATE payments exécuté (payment_id = None)
```

---

## Slots

### TC-21 — Slot en état `booked` libéré lors annulation

```
Préconditions :
  - booking avec slot_id non NULL
  - service_slots.slot_status = 'booked'

Résultat attendu :
  HTTP 200

Vérification DB :
  - service_slots.slot_status = 'available'
```

---

### TC-22 — Slot NULL (pas de créneau associé)

```
Préconditions :
  - booking.slot_id = NULL

Résultat attendu :
  HTTP 200 — succès sans erreur

Vérification DB :
  - Aucun UPDATE service_slots exécuté
```

---

## Tableau récapitulatif

| TC | Scénario | HTTP | Priorité |
|---|---|---|---|
| TC-01 | Payer annule requested (PI cancel) | 200 | OUI |
| TC-02 | Payer annule accepted | 200 | OUI |
| TC-03 | Payer annule confirmed (refund) | 200 | OUI |
| TC-04 | Sans body (reason null) | 200 | OUI |
| TC-05 | Receiver annule accepted | 200 | OUI |
| TC-06 | Receiver annule confirmed (refund) | 200 | OUI |
| TC-07 | Admin annule (2 pushes) | 200 | OUI |
| TC-08 | Tiers → 403 | 403 | OUI |
| TC-09 | Token absent → 401 | 401 | OUI |
| TC-10 | Receiver sur requested → 409 | 409 | CRITIQUE |
| TC-11 | Receiver sur awaiting_payment → 409 | 409 | CRITIQUE |
| TC-12 | completed → 409 | 409 | OUI |
| TC-13 | refused → 409 | 409 | OUI |
| TC-14 | expired → 409 | 409 | OUI |
| TC-15 | Introuvable → 404 | 404 | OUI |
| TC-16 | Idempotence (déjà cancelled) | 200 + idempotent | OUI |
| TC-17 | captured + no charge_id | 200, stripe_action=null | PIÈGE |
| TC-18 | No PI id | 200, stripe_action=null | OUI |
| TC-19 | payment pending/failed | 200, inchangé | OUI |
| TC-20 | No payment record | 200, inchangé | OUI |
| TC-21 | Slot booked libéré | 200 | OUI |
| TC-22 | slot_id NULL | 200 silencieux | OUI |
