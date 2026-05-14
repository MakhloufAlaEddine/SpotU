# SLICE_26_IMPLEMENTED.md — SpotYou / TagPoints (lecture)

Implémentation alignée sur `backend/routes/tagpoint_routes.py` (search, mine, saved, detail, similar, participants, pending-requests) et `spot_you_routes.get_next_session_date` (sans repli `schedule`, comme en Python).

## Endpoints Java

| Méthode | Chemin | Auth |
|---------|--------|------|
| GET | `/api/tag-points` | optionnelle |
| GET | `/api/tag-points/mine` | stricte |
| GET | `/api/tag-points/saved` | stricte |
| GET | `/api/tag-points/{point_id}` | optionnelle |
| GET | `/api/tag-points/{point_id}/similar` | optionnelle |
| GET | `/api/tag-points/{point_id}/participants` | aucune |
| GET | `/api/users/me/pending-requests` | stricte |

## Fichiers principaux

- `modules/spotyou/api/TagPointReadController.java`
- `modules/spotyou/service/TagPointReadService.java`
- `modules/spotyou/infra/TagPointReadRepository.java` (SQL natif PostGIS + fallback H2)
- `modules/spotyou/support/TagPointResponseBuilder.java`, `AddressMasker.java`
- `modules/users/util/NextSessionDateCalculator.java` (`computeFromPointMap` pour maps JDBC)
- `modules/users/api/UserProfileController.java` — route `pending-requests`

## Tables lues

`tag_points`, `users`, `spot_you_members`, `spot_you_attendance`, `tag_point_saves`, `tag_point_votes`, `tags`.

## PostGIS / SQL

- Recherche : `ST_DWithin`, `ST_Distance`, `<->` (tri KNN), filtre tags via `jsonb_exists_any` (évite `?|` vs JDBC).
- Similar : `jsonb_array_elements_text` + `jsonb_typeof` + unwrap `#>> '{}'` comme Python.
- Fallback H2 : distances approximatives `latitude` / `longitude`, filtres tags en mémoire si besoin.

## Tests

`TagPointReadIntegrationTest` — cas nominaux, filtres, 401/404, participants publics, pending, détail membre / pending.

## Helpers réutilisables (futures slices write)

- `TagPointReadRepository.TP_FIELDS_POSTGIS` / `TP_FIELDS_FALLBACK`
- `TagPointResponseBuilder.buildPointResponse`, `applyPrecisionOffset`, `firstImage`
- `AddressMasker.maskAddress`
- `NextSessionDateCalculator.computeFromPointMap`
