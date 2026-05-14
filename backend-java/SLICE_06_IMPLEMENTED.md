# Slice 06 — Followers / Following (lecture)

## Endpoints implémentés

- `GET /api/users/{userId}/followers`
- `GET /api/users/{userId}/following`

## Comportement reproduit depuis Python

- Auth **optionnelle** (jamais 401).
- Sans token / token invalide / token expiré / user token introuvable :
  - réponse HTTP 200
  - champs contextuels à `false`.
- `userId` inexistant : HTTP 200 avec `[]` (pas de 404).
- Pas de pagination (retour complet).
- Tri SQL strict : `ORDER BY u.name ASC`.
- Noms de champs asymétriques respectés :
  - `/followers` => `is_following_back`
  - `/following` => `follows_back`

## Implémentation

- `FollowListController`
- `FollowListService`
- `FollowListRepository`
- DTOs :
  - `FollowerItemDto`
  - `FollowingItemDto`
- `OptionalAuthResolver` (partagé pour reproduire `get_optional_auth` Python).

## Tests ajoutés

- `FollowListIntegrationTest`
  - nominal followers/following
  - sans token
  - token invalide
  - user inexistant -> `[]`
  - tri alphabétique
  - cohérence avec slice 05 après `POST /follow`

## Notes

- Aucun changement Python.
- Pas de refactor global ; slices 01→05 conservées.
