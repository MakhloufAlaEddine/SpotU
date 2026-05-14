# Slice 15 — Booking write (cancel)

## Endpoint implémenté

- `POST /api/bookings/{bookingId}/cancel`

## Alignement Python (`booking_routes.py:754-977`)

- Auth stricte via `requireCurrentUser` (401 absent/invalide).
- Contrôle d'accès à 3 acteurs :
  - payer (`user_id` **ou** `payer_user_id`)
  - receiver
  - admin
- Restriction receiver fidèle :
  - receiver non payer/non admin autorisé **uniquement** sur `accepted`
  - sinon 409 (et non 403) avec message Python exact
- Idempotence fidèle :
  - si booking déjà `cancelled` -> `{"success":true,"status":"cancelled","idempotent":true}`
- États non annulables fidèles :
  - `completed`, `refused`, `expired` -> 409
- Matrice payment fidèle :
  - `requires_authorization` / `authorized` / `capture_pending` -> `cancelled`
  - `captured` -> `refunded`
  - autres / absent -> inchangé (`""` si payment absent)
- Transaction DB atomique fidèle :
  - `bookings` -> `cancelled` + `cancelled_by_user_id` + `cancellation_reason` + `updated_at`
  - `payments` update conditionnel par `payment_id` si statut change
  - `service_slots` -> `available` si `slot_status IN ('pending','reserved','booked')`

## Stripe et push

- Stripe hors transaction :
  - branche PI cancel (`pi_cancelled`) sur `stripe_payment_intent_id`
  - branche refund (`refund_created`) sur `stripe_charge_id` avec warning si `charge_id` absent
- Java v1 garde un comportement **stub** pour Stripe (logs), erreur avalée.
- Push non implémenté dans cette slice Java (comportement externe), documenté dans les gaps.

## Réponse

- Réponse nominale alignée clés Python :
  - `success`, `status`, `booking_id`, `payment_status`, `cancelled_by`, `stripe_action`
- `stripe_action` explicitement nullable (présent avec `null` si aucune action).

## Implémentation

- `modules/bookings/service/BookingWriteService` (ajout `cancelBooking`)
- `modules/bookings/infra/BookingWriteRepository` (requêtes cancel)
- DTO body : `BookingCancelRequestDto` (`reason` optionnel)
- Controller étendu : `BookingController` (`POST /bookings/{bookingId}/cancel`)
- Support test legacy : `TestJwtTokens.validZoeToken()`

## Tables touchées

- Lecture : `bookings`, `payments` (LEFT JOIN)
- Écriture : `bookings`, `payments`, `service_slots`

## Tests ajoutés

- `BookingCancelIntegrationTest`
  - nominal payer
  - nominal receiver
  - nominal admin
  - introuvable
  - 401 absent/invalide
  - 409 receiver sur mauvais statut
  - compat legacy `user_id`/`payer_user_id`
  - refund avec `charge_id`
  - paiement capturé sans `charge_id` (`stripe_action=null`)
  - payment absent (`payment_status=""`)
  - non-annulable 409

## Validation

- `mvn test` : **126 tests verts**, 0 failure, 0 error.
