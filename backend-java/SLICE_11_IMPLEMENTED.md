# Slice 11 — Booking read-only

## Endpoints implémentés

- `GET /api/bookings/me`
- `GET /api/users/me/bookings` (alias)
- `GET /api/bookings/received`
- `GET /api/receiver/requests` (alias)
- `GET /api/bookings/{bookingId}`

## Alignement Python (`booking_routes.py:1035-1110`)

- Auth stricte via `requireCurrentUser` sur les 3 endpoints (401 si absent/invalide).
- Listes sans pagination, tri `created_at DESC`.
- Aliases HTTP conservés pour `/me` et `/received`.
- Contrôle d'accès détail fidèle :
  - autorisé si user dans `{user_id, payer_user_id, receiver_user_id, coach_id}`
  - ou si rôle admin
  - sinon 403 `{"detail":"Accès refusé"}`
- 404 détail fidèle : `{"detail":"Réservation introuvable"}`.

## Implémentation

- `modules/bookings/api/BookingController`
- `modules/bookings/service/BookingReadService`
- `modules/bookings/infra/BookingReadRepository`
- DTOs :
  - `BookingMeDto`
  - `BookingReceivedDto`
  - `BookingDetailDto`

## Points techniques clés

- Parsing conditionnel de `pricing_snapshot` :
  - string JSON legacy -> objet JSON
  - déjà objet -> conservé
  - null -> null
- Parsing `service_images` sur le détail avec la même logique.
- COALESCE reproduits fidèlement dans SQL :
  - receiver : `COALESCE(receiver_user_id, coach_id)`
  - payer (détail) : `COALESCE(payer_user_id, user_id)`

## Tests ajoutés

- `BookingReadIntegrationTest`
  - nominal `/bookings/me` + alias
  - nominal `/bookings/received` + alias
  - liste vide
  - token absent/invalide -> 401
  - booking introuvable -> 404
  - accès interdit -> 403
  - admin autorisé sur détail

## Données de test

- Schéma `bookings` test enrichi pour couvrir les 22 champs de projection.
- Jeu de données booking enrichi (cas nominal, legacy, accès refusé, slot null).
