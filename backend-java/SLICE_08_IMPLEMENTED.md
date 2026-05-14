# Slice 08 — User Reviews (lecture)

## Endpoint implémenté

- `GET /api/users/{userId}/reviews`

## Alignement Python (`user_routes.py:238-259`)

- Endpoint public (aucune auth).
- Vérification d’existence utilisateur via `SELECT show_reviews`.
- `user_id` inexistant => `404 {"detail":"User not found"}`.
- `show_reviews=false` => `[]` (HTTP 200, pas 403).
- Tri SQL : `ORDER BY r.created_at DESC`.
- Réponse avec 7 champs :
  - `review_id`, `rating`, `comment`, `created_at`,
  - `reviewer_id`, `reviewer_name`, `reviewer_picture`
- `booking_id` et `reviewee_id` non exposés.

## Implémentation

- `UserReviewsController`
- `UserReviewsService`
- `UserReviewsRepository`
- DTO `UserReviewItemDto`

## Tests ajoutés

- `UserReviewsIntegrationTest`
  - nominal public + tri
  - show_reviews=false => []
  - user inexistant => 404
  - token invalide ignoré => 200
  - cohérence avec `review_count` du profil public (slice 04)

## Notes

- Pas de pagination (fidèle Python).
- Format `created_at` aligné sur helper ISO Python (`+00:00`).
