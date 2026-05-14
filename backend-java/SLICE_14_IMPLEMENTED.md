# Slice 14 — Booking write (complete)

## Endpoint implémenté

- `POST /api/bookings/{bookingId}/complete`

## Alignement Python (`booking_routes.py:984-1028`, branche `completed`)

- Auth stricte via `requireCurrentUser` (401 absent/invalide).
- Contrôle d'accès fidèle :
  - receiver **ou** admin autorisé
  - message 403 exact : `Seul le bénéficiaire peut marquer comme terminé`
- Aucune garde sur statut courant :
  - aucun 409 ajouté
  - transition vers `completed` autorisée depuis n'importe quel statut source, comme Python
- Transaction DB fidèle :
  - `bookings.status='completed'`, `updated_at=CURRENT_TIMESTAMP`
  - `service_slots.slot_status='completed'` uniquement via sous-requête corrélée :
    - `WHERE slot_id = (SELECT slot_id FROM bookings WHERE booking_id=?)`
    - condition `slot_status='booked'`
    - si `slot_id` null : update silencieux (0 ligne), sans erreur
  - `payments.status='captured'` seulement si `status='authorized'`

## Effets externes

- **Aucun appel Stripe** dans `/complete`.
- **Aucune push notification** dans `/complete`.

## Réponse

- HTTP 200 :
  - `{"success": true, "status": "completed"}`

## Implémentation

- `modules/bookings/service/BookingWriteService` (ajout `completeBooking`)
- `modules/bookings/infra/BookingWriteRepository` (lecture receiver + 3 UPDATEs)
- DTO : `BookingCompleteResponseDto`
- Controller étendu : `BookingController` (`POST /bookings/{bookingId}/complete`)

## Tables touchées

- Lecture : `bookings` (`receiver_user_id`)
- Écriture : `bookings`, `service_slots`, `payments`

## Tests ajoutés

- `BookingCompleteIntegrationTest`
  - nominal (slot booked + payment authorized)
  - accès interdit
  - introuvable
  - slot null -> no-op silencieux
  - payment déjà capturé inchangé
  - statut source `refused` -> 200 (pas de 409)
  - 401 token absent/invalide

## Validation

- `mvn test` : **117 tests verts**, 0 failure, 0 error.
