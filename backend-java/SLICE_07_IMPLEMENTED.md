# Slice 07 — Block / Unblock

## Endpoints implémentés

- `POST /api/users/{userId}/block`
- `DELETE /api/users/{userId}/block`

## Comportement aligné Python (`user_routes.py:632-664`)

- Auth stricte via `requireCurrentUser` (401 si token absent/invalide/expiré).
- `POST /block` :
  - self-block interdit (`400`, message FR exact).
  - supprime d’abord les follows bidirectionnels (`A->B` et `B->A`).
  - ajoute ensuite le blocage de façon idempotente.
  - réponse `{"blocked": true}`.
- `DELETE /block` :
  - suppression idempotente du blocage.
  - aucun restore des follows.
  - réponse `{"blocked": false}`.

## Implémentation

- `BlockController`
- `BlockService`
- `BlockRepository`
- extension `FollowRepository.deleteBidirectional(...)`
- DTO `BlockResponseDto`

## Tests ajoutés

- `BlockIntegrationTest`
  - block nominal + effet bidirectionnel sur follows
  - double block idempotent
  - self-block
  - auth absente
  - unblock nominal
  - unblock inexistant
  - unblock ne restaure pas les follows
  - séquence block -> unblock -> follow

## Note

- Aucune modification du backend Python.
- Aucune dépendance Stripe/bookings/uploads/workers/websockets ajoutée.
