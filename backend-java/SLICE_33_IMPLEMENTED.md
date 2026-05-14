# Slice 33 — Webhook Payment Handlers

Date: 2026-04-25

## Objectif

Finaliser la partie métier paiements du webhook Stripe en Java, sur l’infrastructure Slice 32 déjà validée, avec parité Python stricte sur:

- set exact des 5 events paiement
- ordre de résolution `_resolve_payment_id`
- 3 branches `checkout.session.completed`
- guards/idempotence par `UPDATE`
- libellés notifications

## Implémentation réalisée

### 1) `PaymentResolverService` (nouveau)

Fichier:
- `src/main/java/com/spotu/modules/payments/service/PaymentResolverService.java`

Comportement:
- Résolution dans l’ordre strict:
  1. `metadata.payment_id` (court-circuit immédiat)
  2. lookup `payments.stripe_payment_intent_id`
  3. lookup `payments.stripe_checkout_session_id` (seulement `checkout.session`)
  4. lookup `payments.stripe_charge_id` (seulement `ch_*`)
- Retour `(paymentId, bookingId)` ou `(null, null)`.

### 2) `PaymentEventHandler` (nouveau)

Fichier:
- `src/main/java/com/spotu/modules/payments/service/PaymentEventHandler.java`

Set exact `_PAYMENT_EVENTS`:
- `checkout.session.completed`
- `payment_intent.amount_capturable_updated`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`

Branches implémentées:
- `checkout.session.completed`
  - `mode=subscription` -> skip (laisser subscription handler)
  - `payment_status=unpaid` + `booking.status=awaiting_payment` -> capture (guard A) + booking confirm + 2 notifs `booking_confirmed` (labels branch A)
  - `payment_status=unpaid` + autre statut -> authorize + 1 notif `payment_authorized` receiver (label branch B)
  - `payment_status=paid` -> capture (guard C) + booking confirm + 2 notifs `booking_confirmed` (labels branch C)
- `payment_intent.amount_capturable_updated`
  - authorize + notif receiver avec libellé dédié
- `payment_intent.succeeded`
  - capture avec `stripe_charge_id` si `latest_charge` est un string `ch_*`
  - sinon capture fallback sans charge
  - booking confirm + 2 notifs (`payer`: confirmé, `receiver`: "Paiement capturé ...")
- `payment_intent.payment_failed`
  - status `failed` + notif payer seulement
- `payment_intent.canceled`
  - status `cancelled`, sans notification

Log strict ajouté:
- `Payment event traité : type={} | payment={} | booking={}`

### 3) Intégration dispatcher central (Slice 32)

Fichier:
- `src/main/java/com/spotu/modules/payments/service/StripeWebhookService.java`

Changements:
- Appel `PaymentResolverService.resolve(...)`
- Branche paiement activée uniquement pour `PaymentEventHandler.PAYMENT_EVENTS`
- Si `payment_id` absent:
  - skip silencieux pour `checkout.session.completed`
  - debug pour autres events paiement: `Webhook payment sans payment_id : type={}`
- Conservation du pattern S32:
  - `claimEvent` idempotent
  - `markDone(success|error)`
  - notifications envoyées hors bloc handler via `pendingNotifs`

### 4) Repository webhook enrichi

Fichier:
- `src/main/java/com/spotu/modules/payments/infra/StripeWebhookRepository.java`

Ajouts:
- guards distincts:
  - `updatePaymentCapturedGuardA`
  - `updatePaymentCapturedGuardC`
  - `updatePaymentFailed`
  - `updatePaymentCancelled`
- lookup notifications:
  - `findPaymentUsers(payment_id)` -> `payer_user_id`, `receiver_user_id`
  - `findServiceTitleByBookingId(booking_id)` -> fallback applicatif `"votre prestation"`

## Tests ajoutés/ajustés

Fichier:
- `src/test/java/com/spotu/modules/payments/api/StripeWebhookIntegrationTest.java`

Cas couverts en plus:
- `payment_intent.amount_capturable_updated` (authorized + label notif spécifique)
- `payment_intent.payment_failed` (notif payer only)
- `payment_intent.canceled` (pas de notif additionnelle)
- `checkout.session.completed` branch C (label payer sans "À bientôt !")
- `payment_intent.succeeded` (label receiver avec "Paiement capturé")
- priorité resolver metadata sur lookup PI DB

## Tables touchées (S33)

- `payments` (status, stripe_charge_id)
- `bookings` (status, payment_status)
- `notifications` (insertion via boucle pending notifications)
- `stripe_webhook_events` (déjà slice 32 via claim/markDone)

## Validation

- `mvn -Dtest=StripeWebhookIntegrationTest test` ✅
- `mvn test` (régression complète backend-java) ✅

## Écarts restants connus

- Aucun écart Slice 33 bloquant identifié sur le périmètre paiement webhook documenté.
- Les domaines refunds (`_CHARGE_EVENTS`) et subscriptions avancées restent traités dans leurs slices dédiées (hors périmètre S33).

