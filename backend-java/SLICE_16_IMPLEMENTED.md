# Slice 16 — Stripe webhook (payments)

## Endpoint implémenté

- `POST /api/webhook/stripe`

## Implémentation

- Controller :
  - `modules/payments/api/StripeWebhookController`
  - lecture du body en `byte[]` brut (`@RequestBody byte[]`) avant tout parsing métier
- Service :
  - `modules/payments/service/StripeWebhookService`
  - parsing JSON event, validation signature HMAC `Stripe-Signature` avec `app.stripe.webhook-secret`
  - idempotence via table `stripe_webhook_events`
  - dispatch paiement (scope Slice 16)
- Repository :
  - `modules/payments/infra/StripeWebhookRepository`
  - claim/markDone event + lookups payment + updates `payments`/`bookings`

## Règles métier couvertes (scope Slice 16)

- Aucune auth utilisateur.
- Signature Stripe vérifiée si secret configuré.
- Idempotence event (`event_id`) avec skip sur doublon.
- `checkout.session.completed` :
  - `mode=subscription` -> ignoré (hors scope abonnement)
  - `payment_status=unpaid` + booking `awaiting_payment` -> `payments.captured` + `bookings.confirmed/paid`
  - `payment_status=unpaid` + booking `requested` -> `payments.authorized` uniquement
  - `payment_status=paid` -> `payments.captured` + `bookings.confirmed/paid`
- `payment_intent.succeeded` :
  - `payments.captured`
  - stockage `stripe_charge_id` depuis `latest_charge` si préfixe `ch_`
  - `bookings.confirmed/paid`

## Comportement d'erreur

- Jamais de propagation d'exception non gérée au client.
- Retour du webhook en HTTP 200 avec `{"received": true}` même si handler en erreur.
- Erreurs de traitement persistées dans `stripe_webhook_events.status='error'`.

## Schéma / données test ajustés

- `test-schema-users.sql` :
  - table `stripe_webhook_events`
  - colonnes payments ajoutées : `stripe_checkout_session_id`, `refund_amount`, `refund_status`, `payer_total_amount`
- `test-data-users.sql` :
  - données webhook dédiées (`booking_030`, `booking_031`, `pay_012`, `pay_013`)

## Config

- `application.yml` :
  - `app.stripe.webhook-secret: ${STRIPE_WEBHOOK_SECRET:}`
- `application-test.yml` :
  - `app.stripe.webhook-secret: "whsec_test_secret"`

## Tests ajoutés

- `StripeWebhookIntegrationTest`
  - signature valide
  - signature invalide (retour 200 + event marqué error)
  - idempotence event déjà vu
  - event inconnu
  - `checkout.session.completed` branche `requested`
  - `checkout.session.completed` branche `awaiting_payment`
  - branche `mode=subscription` ignorée

## Validation

- `mvn -Dtest=StripeWebhookIntegrationTest test` ✅
- `mvn test` ✅ (non-régression slices 01 → 15)
