# SLICE_30_IMPLEMENTED.md

Slice 30 implémente le parcours acheteur core côté Java/Spring Boot :

- `POST /api/bookings/price-preview`
- `POST /api/bookings/request`
- alias `POST /api/bookings`
- `POST /api/bookings/{id}/pay`

Objectif atteint : parcours front-ready `preview -> request -> pay`, avec lock de concurrence, idempotence et payloads JSON compatibles Python.

## 1) Endpoints ajoutés

Implémentation dans `BookingController` (module `bookings`) :

- `POST /api/bookings/price-preview`
  - auth stricte
  - `service_id` requis (400 si absent)
  - service actif requis (404 sinon)
  - pricing calculé serveur

- `POST /api/bookings/request`
- `POST /api/bookings` (alias rétrocompat)
  - auth stricte
  - validation `payment_mode in {pay_now,pay_later}`
  - normalisation via flags globaux `app_config`
  - idempotence explicite (`idempotency_key`)
  - idempotence `(slot_id,user_id)`
  - lock pessimiste `FOR UPDATE NOWAIT`
  - création atomique booking + payment + transition slot
  - push post-commit (insert `notifications`)

- `POST /api/bookings/{booking_id}/pay`
  - auth stricte (payer ou admin)
  - guards 404 / 403 / 409 / 410 alignés
  - idempotence Stripe session `open` (retour `reused: true`)
  - création session Stripe hors transaction DB
  - update DB transactionnel court post-Stripe

## 2) Composants créés/modifiés

### Nouveaux fichiers Java

- `src/main/java/com/spotu/modules/bookings/service/BookingBuyerService.java`
- `src/main/java/com/spotu/modules/bookings/service/BookingPricingEngine.java`
- `src/main/java/com/spotu/modules/bookings/infra/BookingBuyerRepository.java`
- `src/main/java/com/spotu/modules/bookings/dto/BookingPayResponseDto.java`

### Fichiers Java modifiés

- `src/main/java/com/spotu/modules/bookings/api/BookingController.java`
  - wiring des 4 routes S30

## 3) SQL / tables touchées

### Migrations runtime (Postgres)

- `src/main/resources/db/migration/V4__bookings_buyer_core.sql`
  - enrichit `bookings` (idempotency_key, pricing_snapshot, payer/receiver, expires/payment_mode)
  - enrichit `payments` (colonnes pricing/produit/frais/transfer/snapshot)
  - ajoute index unique `bookings.idempotency_key` (partiel non-null)

### Schéma de tests H2

- `src/test/resources/test-schema-users.sql`
  - colonnes supplémentaires sur `payments`
  - index unique `bookings.idempotency_key`

- `src/test/resources/test-data-users.sql`
  - seed bookings/payments dédiés S30 (`booking_s30_*`, `pay_s30_*`)
  - sans impact sur les compteurs globaux de tests existants

## 4) Fidélité Python appliquée

- pricing recalculé côté serveur uniquement
- lock SQL `FOR UPDATE NOWAIT` + mapping conflit lock en `409`
- priorité flags globaux `app_config` sur config service
- triple idempotence request :
  - clé explicite
  - tuple `(slot_id,user_id)`
  - pay idempotent via session Stripe `open`
- alias `POST /api/bookings` strictement aligné sur `/request`
- code `410 Gone` pour `expires_at` dépassé dans `/pay`
- `url` et `checkout_url` dupliqués en réponse pay
- `reused` présent uniquement en cas de réutilisation session
- side-effects push `request` déclenchés en post-commit

## 5) Stripe / locking

- Stripe :
  - création session via `StripeCheckoutService`
  - `amount_cents` calculé en centimes
  - currency forcée lower-case pour Stripe
  - URLs success/cancel compatibles Python (`{CHECKOUT_SESSION_ID}` conservé)
  - idempotency key Stripe = `payment_id`

- Locking :
  - verrouillage slot en transaction avec `FOR UPDATE NOWAIT`
  - pas d’attente bloquante
  - conflit lock mappé en `409 "Ce créneau est en cours de réservation — réessayez"`

## 6) Tests

Nouveau fichier :

- `src/test/java/com/spotu/modules/bookings/api/BookingBuyerIntegrationTest.java`

Couverture ajoutée :

- preview nominal + erreurs 400/404
- request nominal + alias + idempotence clé explicite
- guards `pay_later` (409 global OFF, 400 service OFF)
- conflit slot état indisponible
- conflit lock NOWAIT (slot verrouillé)
- pay nominal + pay idempotent (`reused=true`)
- erreurs pay : 401 / 403 / 404 / 410 / 500 payment manquant
- auth stricte request/pay

Validation non-régression :

- `mvn test` vert sur la suite complète.

## 7) Écarts restants connus

- Push : comme sur les slices SpotYou précédentes, Java persiste les notifications (`notifications`) mais n’envoie pas encore via Expo.
- Le moteur de pricing Java est aligné sur les règles actives `pricing_rules`, sans branchements additionnels d’abonnement avancés non nécessaires aux cas S30 courants.
