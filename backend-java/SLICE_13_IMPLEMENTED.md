# Slice 13 — Booking write (accept)

## Endpoint implémenté

- `POST /api/bookings/{bookingId}/accept`

## Alignement Python (`booking_routes.py:401-552`)

- Auth stricte via `requireCurrentUser` (401 absent/invalide).
- Contrôle d'accès fidèle :
  - receiver **ou** admin autorisé
  - message 403 exact : `Seul le bénéficiaire peut accepter cette réservation`
- Idempotence fidèle :
  - statuts idempotents : `awaiting_payment`, `accepted`, `confirmed`
  - retour du **statut réel courant** (`bk["status"]`), sans hardcode
- Gardes fidèles :
  - statut accepté seulement depuis `requested` sinon 409
  - TTL expiré (`expires_at < now`) -> 410 avec message Python exact
- Branches métier strictement séparées :
  - **Cas A** (`pay_now` + payment `authorized`) :
    - `bookings.status='confirmed'`
    - `bookings.payment_status='captured'`
    - `bookings.expires_at=NULL`
    - `payments.status='captured'` sur `payment_id`
    - `service_slots.slot_status='booked'` si état in (`pending`,`available`,`reserved`)
  - **Cas B** (tous les autres cas) :
    - `bookings.status='awaiting_payment'`
    - `bookings.expires_at=now+minutes`
    - pas d'update `payments`
    - `service_slots.slot_status='reserved'` si état in (`pending`,`available`)

## Calcul `expires_at` (Cas B)

- `payment_mode=pay_now` :
  - lecture `app_config.pay_now_checkout_minutes`
  - fallback `30` si absent/non parseable
- `payment_mode=pay_later` :
  - lecture `services.pay_later_expiration_minutes` (JOIN)
  - fallback `1440`
- Format de réponse conforme : `pay_expiry_interval = "{n} minutes"`

## Stripe et push

- Stripe capture hors transaction en Cas A :
  - stub Java v1 loggé
  - erreur avalée (DB déjà commit), comme Python
- Push `booking_accepted/booking_confirmed` non implémenté en Java dans cette slice (comportement externe), documenté.

## Implémentation

- `modules/bookings/service/BookingWriteService` (ajout `acceptBooking`)
- `modules/bookings/infra/BookingWriteRepository` (requêtes accept + app_config)
- DTO : `BookingAcceptResponseDto`
- Controller étendu : `BookingController` (`POST /bookings/{bookingId}/accept`)
- Erreur 410 dédiée : `ApiGoneException` + mapping `GlobalExceptionHandler`

## Tables touchées

- Lecture : `bookings`, `services`, `payments`, `app_config`
- Écriture :
  - Cas A : `bookings`, `payments`, `service_slots`
  - Cas B : `bookings`, `service_slots`

## Données de test

- Jeux de données booking enrichis :
  - Cas A (`pay_now` + `authorized`)
  - Cas B pay_now (config présente + fallback config absente)
  - Cas B pay_later avec fallback `1440`
  - idempotence (`awaiting_payment`, `accepted`, `confirmed`)
  - booking expiré (410)
  - booking sans service joignable (404 via `JOIN services`)

## Tests ajoutés

- `BookingAcceptIntegrationTest`
  - nominal Cas A
  - nominal Cas B pay_now
  - Cas B pay_later fallback 1440
  - fallback pay_now 30 si config absente
  - idempotence (statut réel retourné)
  - admin autorisé même hors receiver
  - 403 accès interdit
  - 404 booking/service introuvable
  - 410 booking expiré
  - 401 token absent/invalide

## Validation

- `mvn test` : **110 tests verts**, 0 failure, 0 error.
