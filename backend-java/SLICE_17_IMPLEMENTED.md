# Slice 17 — Stripe Checkout synchrone (payments)

## Endpoints implémentés

- `POST /api/payments/checkout/session`
- `GET /api/payments/checkout/status/{sessionId}`

## Implémentation

- Controller :
  - `modules/payments/api/CheckoutController`
- Service :
  - `modules/payments/service/CheckoutService`
  - logique strictement alignée `payment_routes.py` (guards, lookup, transitions)
- Repository :
  - `modules/payments/infra/CheckoutRepository`
  - SQL aligné Python (lookup payer en `WHERE`, double lookup `cs_/pi_`, CASE update)
- Intégration Stripe (v1 de migration) :
  - `modules/payments/service/StripeCheckoutService`
  - création/récupération de session Checkout, avec idempotence métier répliquée côté service Java

## Règles métier couvertes

- POST :
  - auth stricte via JWT (`401` si absent/invalide)
  - `booking_id` obligatoire -> `400 {"detail":"booking_id requis"}`
  - lookup paiement filtré payer -> `404 {"detail":"Paiement non trouvé"}` si non-payer (jamais 403)
  - guard `captured` -> `400 {"detail":"Ce paiement est déjà complété"}`
  - montant uniquement depuis `payments.payer_total_amount` (aucun recalcul métier)
  - réutilisation d'une session existante `open`
  - placeholder Stripe conservé en littéral : `{{CHECKOUT_SESSION_ID}}`
  - update SQL `CASE` idempotent (`payments.status` + `bookings.payment_status`)
- GET status :
  - auth optionnelle (aucun blocage si token absent)
  - lookup DB double clé : `stripe_checkout_session_id` OU `stripe_payment_intent_id`
  - `real_session_id` pour Stripe : `stripe_checkout_session_id` DB sinon param path
  - fallback graceful si Stripe indisponible : `status="unknown"` + données DB
  - transitions alignées Python :
    - `complete + unpaid + awaiting_payment` -> payment `captured`, booking `confirmed/paid`
    - `complete + unpaid + requested` -> payment `authorized`, booking payment_status `authorized`
    - `stripe_status=paid` -> payment `captured`, booking `confirmed/paid`
    - `expired + authorized` -> payment `cancelled`

## Schéma / données test ajustés

- `test-data-users.sql` :
  - ajout fixtures Slice 17 : `booking_040..045`, `pay_040..045`

## Tests ajoutés

- `CheckoutIntegrationTest`
  - POST nominal
  - POST `401`
  - POST non-payer `404`
  - GET nominal
  - GET lookup double clé (`pi_...`)
  - GET session inconnue `404`
  - GET Stripe indisponible -> `status=unknown`
  - assertions d'effets DB

## Validation

- `mvn -Dtest=CheckoutIntegrationTest test` ✅
- `mvn test` ✅ (non-régression slices 01 → 16)

## Notes / écarts documentés

- Les notifications push du flux `GET /checkout/status` ne sont pas branchées en Java v1 (même logique que les slices Stripe précédentes : side-effects push documentés comme gap mineur).
- L’intégration Stripe est encapsulée dans un service Java de migration; les contrats HTTP/SQL et transitions de statut restent alignés au backend Python.
