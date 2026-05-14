# Slice 05 — Follow / Unfollow

## Endpoints implémentés

- `POST /api/users/{userId}/follow`
- `DELETE /api/users/{userId}/follow`

## Alignement Python (`user_routes.py:494-522`)

- Auth obligatoire via logique slice 02 (`requireCurrentUser`) pour les deux routes.
- `POST /follow` :
  - self-follow interdit (`400`, message exact FR)
  - cible inexistante => `404`, message exact FR
  - follow idempotent (pas de doublon)
  - réponse `{ "is_following": true, "followers_count": N }`
- `DELETE /follow` :
  - silencieux si relation inexistante
  - silencieux si cible inexistante
  - réponse `{ "is_following": false, "followers_count": N }`
- `followers_count` recalculé depuis DB après chaque mutation.

## Implémentation

- `FollowController`
- `FollowService`
- `FollowRepository` (INSERT idempotent, DELETE, COUNT, exists target)
- `FollowResponseDto`
- `ApiBadRequestException` + handler `{"detail":"..."}` dans `GlobalExceptionHandler`

## Tests ajoutés

- `FollowIntegrationTest`
  - nominal follow
  - double follow idempotent
  - nominal unfollow
  - unfollow inexistant
  - self-follow
  - follow cible inexistante
  - unfollow cible inexistante
  - token absent
  - token invalide
  - cohérence avec slice 04 (`is_following` visible sur public profile)

## Notes

- Pas de refactor global.
- Pas de transaction service explicite, comme en Python.
