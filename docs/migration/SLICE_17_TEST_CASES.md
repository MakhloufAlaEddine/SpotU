# SLICE_17_TEST_CASES.md — Cas de test de la Slice 17
> Source : `payment_routes.py:83–351`.
> Généré le 2026-02-XX.

---

## POST /payments/checkout/session

### TC-01 — Nominal : création d'une nouvelle session

```
Préconditions :
  - booking.status = 'awaiting_payment' OU 'requested'
  - payments.status = 'requires_authorization' (ou 'pending')
  - payments.stripe_checkout_session_id = NULL
  - Appelant = payer_user_id

Appel :
  POST /api/payments/checkout/session
  Authorization: Bearer <payer_token>
  { "booking_id": "bkg_abc123", "origin_url": "https://app.spotu.fr" }

Résultat attendu :
  HTTP 200
  { "url": "https://checkout.stripe.com/pay/cs_xxx", "session_id": "cs_xxx" }

Vérifications DB :
  - payments.stripe_checkout_session_id = 'cs_xxx'
  - payments.stripe_payment_intent_id = 'pi_xxx' (si session.payment_intent est string)
  - payments.status = 'requires_authorization' (si était pending)
  - bookings.payment_status = 'requires_authorization'
```

---

### TC-02 — Idempotence : session Stripe encore ouverte

```
Préconditions :
  - payments.stripe_checkout_session_id = 'cs_existant'
  - Stripe session 'cs_existant'.status = 'open'

Appel : idem TC-01

Résultat attendu :
  HTTP 200
  { "url": "https://checkout.stripe.com/pay/cs_existant", "session_id": "cs_existant" }

Vérifications DB :
  - Aucune modification (réutilisation)
  - Aucun appel stripe.create_checkout_session
```

---

### TC-03 — Idempotence : session Stripe expirée → recréation

```
Préconditions :
  - payments.stripe_checkout_session_id = 'cs_expired'
  - Stripe session 'cs_expired'.status = 'expired' (ou 'complete')

Résultat attendu :
  HTTP 200 — nouvelle session créée
  { "url": "https://checkout.stripe.com/pay/cs_new", "session_id": "cs_new" }

Vérifications DB :
  - payments.stripe_checkout_session_id = 'cs_new'
```

---

### TC-04 — Statut déjà `captured` → 400

```
Préconditions :
  - payments.status = 'captured'

Résultat attendu :
  HTTP 400
  { "detail": "Ce paiement est déjà complété" }

Vérification DB : aucun UPDATE
```

---

### TC-05 — booking_id manquant → 400

```
Appel :
  POST /api/payments/checkout/session
  { "origin_url": "https://app.spotu.fr" }
  (pas de booking_id)

Résultat attendu :
  HTTP 400 { "detail": "booking_id requis" }
```

---

### TC-06 — Appelant n'est pas le payer → 404

```
Préconditions :
  - Booking existe mais user_id ≠ payer_user_id

Résultat attendu :
  HTTP 404 { "detail": "Paiement non trouvé" }
  (Pas 403 — contrôle implicite dans le WHERE)
```

---

### TC-07 — Token absent → 401

```
Appel sans Authorization header
Résultat attendu : HTTP 401
```

---

### TC-08 — `payment_intent` non-string (NULL stocké)

```
Préconditions :
  - Stripe retourne session avec payment_intent = objet (pas string)

Résultat attendu :
  HTTP 200 — session créée normalement
  payments.stripe_payment_intent_id = NULL  (isinstance check false → None)
```

---

### TC-09 — origin_url vide → URLs relatives

```
Appel :
  POST /api/payments/checkout/session
  { "booking_id": "bkg_abc123" }
  (origin_url absent → défaut "")

Résultat attendu :
  HTTP 200
  Stripe Checkout créée avec :
    success_url = "/payment-success?session_id={CHECKOUT_SESSION_ID}&booking_id=bkg_abc123"
    cancel_url  = "/booking/confirm?serviceId=..."
```

---

### TC-10 — STATUS CASE idempotent : webhook déjà passé

```
Préconditions :
  - payments.status = 'authorized' (webhook déjà passé avant POST)

Résultat attendu :
  HTTP 200 — session créée

Vérification DB :
  - payments.status = 'authorized' (INCHANGÉ — CASE guard 'authorized' IN (...))
  - bookings.payment_status = 'authorized' (INCHANGÉ — CASE guard)
```

---

## GET /payments/checkout/status/{session_id}

### TC-11 — Nominal : instant_booking payé (complete + unpaid + awaiting_payment)

```
Préconditions :
  - payments.status = 'requires_authorization'
  - bookings.status = 'awaiting_payment'
  - Stripe session : status='complete', payment_status='unpaid'

Appel :
  GET /api/payments/checkout/status/cs_xxx
  (sans Authorization)

Résultat attendu :
  HTTP 200
  { "status": "complete", "payment_status": "captured", "stripe_status": "unpaid", ... }

Vérifications DB :
  - payments.status = 'captured'
  - bookings.status = 'confirmed'
  - bookings.payment_status = 'paid'

Notifications attendues :
  - payer : "Réservation confirmée !"
  - receiver : "Nouvelle réservation !"
```

---

### TC-12 — manual_approval payé (complete + unpaid + requested)

```
Préconditions :
  - payments.status = 'requires_authorization'
  - bookings.status = 'requested'
  - Stripe session : status='complete', payment_status='unpaid'

Résultat attendu :
  HTTP 200
  { "payment_status": "authorized", "status": "complete", ... }

Vérifications DB :
  - payments.status = 'authorized'
  - bookings.status = 'requested' (INCHANGÉ)
  - bookings.payment_status = 'authorized'

Notifications :
  AUCUNE
```

---

### TC-13 — stripe_ps='paid' (capture_method=automatic)

```
Préconditions :
  - payments.status = 'requires_authorization'
  - Stripe session : payment_status='paid'

Résultat attendu :
  HTTP 200 { "payment_status": "captured", ... }

Vérifications DB :
  - payments.status = 'captured'
  - bookings.status = 'confirmed'
```

---

### TC-14 — Session expirée (expired + authorized)

```
Préconditions :
  - payments.status = 'authorized'
  - Stripe session : status='expired'

Résultat attendu :
  HTTP 200 { "payment_status": "cancelled", "status": "expired", ... }

Vérification DB :
  - payments.status = 'cancelled'
```

---

### TC-15 — Aucune transition (session open, pas encore payé)

```
Préconditions :
  - payments.status = 'requires_authorization'
  - Stripe session : status='open', payment_status='unpaid'

Résultat attendu :
  HTTP 200 { "payment_status": "requires_authorization", "status": "open", ... }

Vérification DB : aucun UPDATE
```

---

### TC-16 — Idempotence : payment déjà `captured`

```
Préconditions :
  - payments.status = 'captured' (webhook déjà passé)
  - Stripe session : status='complete', payment_status='unpaid'

Résultat attendu :
  HTTP 200 { "payment_status": "captured", ... }

Vérification DB :
  - payments.status = 'captured' (INCHANGÉ — guard db_status NOT IN ('authorized','captured','paid'))
  - Aucun push en double
```

---

### TC-17 — Stripe injoignable → graceful + "unknown"

```
Préconditions :
  - Stripe est injoignable (timeout ou erreur)

Résultat attendu :
  HTTP 200
  { "status": "unknown", "payment_status": "requires_authorization", "amount": 50.0, "currency": "EUR" }

Vérification :
  - Aucun UPDATE DB
  - Pas d'exception 500
```

---

### TC-18 — Lookup via payment_intent_id (pas session_id)

```
Appel :
  GET /api/payments/checkout/status/pi_xxx
  (session_id = pi_xxx, pas cs_xxx)

Préconditions :
  - payments.stripe_payment_intent_id = 'pi_xxx'
  - payments.stripe_checkout_session_id = 'cs_xxx'

Résultat attendu :
  HTTP 200 — payment trouvé via pi_xxx

Vérifications :
  - retrieve_checkout_session appelé avec 'cs_xxx' (real_session_id depuis DB)
  - Pas avec 'pi_xxx'
```

---

### TC-19 — session_id inconnu → 404

```
Appel : GET /api/payments/checkout/status/cs_inexistant
Résultat attendu : HTTP 404 { "detail": "Session de paiement non trouvée" }
```

---

### TC-20 — GET sans token (redirect web)

```
Appel :
  GET /api/payments/checkout/status/cs_xxx
  (sans Authorization header)

Résultat attendu :
  HTTP 200 — retourne les données du payment (auth optionnelle → user=None)
```

---

## Tableau récapitulatif

| TC | Scénario | HTTP | Priorité |
|---|---|---|---|
| TC-01 | POST nominal — nouvelle session | 200 | CRITIQUE |
| TC-02 | POST idempotence session open | 200 | OUI |
| TC-03 | POST idempotence session expirée → recréation | 200 | OUI |
| TC-04 | POST paiement déjà captured → 400 | 400 | CRITIQUE |
| TC-05 | POST booking_id manquant → 400 | 400 | OUI |
| TC-06 | POST pas payer → 404 | 404 | CRITIQUE |
| TC-07 | POST token absent → 401 | 401 | OUI |
| TC-08 | POST pi non-string → NULL stocké | 200 | OUI |
| TC-09 | POST origin_url vide → URLs relatives | 200 | OUI |
| TC-10 | POST CASE idempotent (webhook déjà passé) | 200 | CRITIQUE |
| TC-11 | GET instant_booking captured + confirmed + push | 200 | CRITIQUE |
| TC-12 | GET manual_approval authorized (pas de push) | 200 | CRITIQUE |
| TC-13 | GET stripe_ps=paid → captured | 200 | OUI |
| TC-14 | GET expired + authorized → cancelled | 200 | OUI |
| TC-15 | GET session open → aucune mutation | 200 | OUI |
| TC-16 | GET idempotence payment déjà captured | 200 | CRITIQUE |
| TC-17 | GET Stripe injoignable → "unknown" | 200 | CRITIQUE |
| TC-18 | GET lookup via pi_xxx | 200 | OUI |
| TC-19 | GET session_id inconnu → 404 | 404 | OUI |
| TC-20 | GET sans token (redirect web) | 200 | CRITIQUE |
