# Slice 03 — `GET /api/users/me`

Implémentation Java de l’équivalent Python `GET /api/users/profile` (`user_routes.py:11-30`), sans toucher aux slices 01/02.

## Ce qui a été fait

- Endpoint ajouté : `GET /api/users/me` dans `UserProfileController`.
- Auth réutilisée depuis la slice 02 via `AuthMeService.requireCurrentUser(...)` :
  - `Not authenticated`
  - `Invalid token`
  - `Token expired`
  - `User not found`
- Mapping réponse : 23 champs
  - 18 champs hérités de `CurrentUserDto` (`USER_FIELDS`)
  - + `avg_rating`, `review_count`, `iban`, `bic`, `iban_name`
- Requêtes DB alignées Python :
  - `SELECT rating FROM reviews WHERE reviewee_id = ?`
  - `SELECT iban, bic, iban_name FROM users WHERE user_id = ?`
- Règle métier rating reproduite :
  - pas de review -> `avg_rating = null`, `review_count = 0`
  - sinon `round(sum/count, 1)` Python reproduit avec `BigDecimal` + `RoundingMode.HALF_EVEN`

## Tests ajoutés

- `UserProfileIntegrationTest`
  - nominal avec reviews + IBAN
  - sans reviews / sans IBAN
  - token absent
  - token invalide
  - user introuvable

Fixtures de test enrichies :
- `test-schema-users.sql` : colonnes `iban`, `bic`, `iban_name` + table `reviews`
- `test-data-users.sql` : données bancaires + reviews de test

## Écarts / points à noter

- Le chemin Python est `/api/users/profile`; la cible Java de migration est `/api/users/me`.
- Les erreurs DB restent gérées globalement en `503` côté Java (`DataAccessException`), alors que FastAPI remonte souvent un `500` implicite.
