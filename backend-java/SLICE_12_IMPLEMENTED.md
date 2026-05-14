# Slice 12 — Booking write (refuse)

## Endpoint implémenté

- `POST /api/bookings/{bookingId}/refuse`

## Alignement Python (`booking_routes.py:675-747`)

- Auth stricte via `requireCurrentUser` (401 absent/invalide).
- Receiver uniquement (`receiver_user_id` strict) :
  - aucun droit admin spécial
  - message 403 exact : `Seul le bénéficiaire peut refuser cette réservation`
- Idempotence fidèle :
  - si booking déjà `refused` -> `{"success":true,"status":"refused","idempotent":true}`
  - sans `booking_id` dans cette réponse
- Garde statut fidèle :
  - seul `requested` est refusable
  - sinon 409 avec message incluant l'état actuel
- Transaction DB :
  - `bookings.status -> refused`
  - `payments.status -> cancelled` seulement si `status IN ('requires_authorization','authorized')`
  - `service_slots.slot_status -> available` seulement si `slot_status='pending'`

## Stripe et push

- Stripe exécuté hors transaction et non bloquant :
  - stub loggé en Java v1
  - erreur avalée (pas de rollback DB), comme Python
- Push `booking_refused` non implémenté en Java dans cette slice (comportement externe), documenté.

## Implémentation

- `modules/bookings/service/BookingWriteService`
- `modules/bookings/infra/BookingWriteRepository`
- DTO : `BookingRefuseResponseDto`
- Controller étendu : `BookingController` (`POST /bookings/{bookingId}/refuse`)
- Erreur 409 dédiée : `ApiConflictException` + mapping dans `GlobalExceptionHandler`

## Données de test

- Table `payments` ajoutée au schéma test.
- Jeu de données enrichi :
  - booking `requested` nominal + slot `pending` + payment `requires_authorization`
  - booking `requested` avec slot `reserved` + payment `captured`
  - booking déjà `refused`

## Tests ajoutés

- `BookingRefuseIntegrationTest`
  - nominal
  - non receiver -> 403
  - introuvable -> 404
  - idempotence déjà refused
  - conflit statut incompatible -> 409
  - slot `pending` libéré
  - slot non `pending` inchangé
  - payment ajusté/inchangé selon statut
  - 401 token absent/invalide
