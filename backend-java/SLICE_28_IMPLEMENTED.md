# SLICE_28_IMPLEMENTED — SpotYou CRUD (create / update / new-date)

Implémentation alignée sur `backend/routes/tagpoint_routes.py` (l.1808–2051), `randomize_for_storage` (l.118–143) et `models.TagPointCreate` / `TagPointUpdate`.

## Endpoints livrés

| Méthode | Chemin |
|---------|--------|
| POST | `/api/tag-points` |
| PUT | `/api/tag-points/{pointId}` |
| PATCH | `/api/tag-points/{pointId}/new-date` |

## Fichiers principaux

- `modules/spotyou/api/TagPointWriteController.java`
- `modules/spotyou/service/TagPointWriteService.java`
- `modules/spotyou/infra/TagPointWriteRepository.java`
- `modules/spotyou/dto/TagPointCreateRequest.java`
- `modules/spotyou/support/GeoRandomizer.java` — **stockage** uniquement (≠ `TagPointResponseBuilder.applyPrecisionOffset` lecture S26)
- `modules/spotyou/support/TagPointValueDiff.java` — équivalent `_vals_equal`

## Tables touchées

- `tag_points` — INSERT / UPDATE dynamique / toggle `new_date_coming`
- `spot_you_members` — INSERT auto-membre créateur (`accepted`)

## PostGIS / JSONB

- **Postgres** (`spring.datasource.url` commence par `jdbc:postgresql:`) : `INSERT` avec `ST_SetSRID(ST_MakePoint(lng, lat), 4326)`, JSON via `CAST(? AS jsonb)`.
- **H2 (tests)** : `latitude` / `longitude` numériques ; JSON en `VARCHAR` ; membre owner via `INSERT … SELECT … WHERE NOT EXISTS` (H2 ne parse pas `ON CONFLICT` comme Postgres dans ce setup).

## Règles métier couvertes

- Validations create/update : tags requis, max 10 images, min/max participants (auto-complétion, min ≥ 1), min ≤ max.
- Défauts : `visibility_type=public`, `join_mode=open`, `invite_permissions=admin_only`.
- `randomize_for_storage` si `precision` ∈ {`100m`, `1000m`} ; `exact` ou inconnu → pas de décalage stockage.
- Update : owner ou JWT `role=admin` ; corps vide → réponse courante sans `UPDATE` ; SQL dynamique sur champs autorisés ; `latitude`+`longitude` ensemble → mise à jour position.
- Diff réel → notifications membres (`spot_you_members` où `user_id` ≠ owner, **tous statuts**, comme Python) si `has_real_changes` et `cancelled=false`.
- Images retirées : suppression fichier via `FileStorageService` pour URLs absentes du nouveau tableau.
- `PATCH new-date` : toggle `new_date_coming`, owner ou admin.

## Tests

- `TagPointWriteIntegrationTest` — create + membership, tags vides, coords 100m, update owner/admin/non-owner, corps vide, new-date, 401.

## Écarts / limites

- Push Expo : inchangé (slice 27) — seule persistance `notifications`.
- Champ `is_public` éventuel dans un JSON d’update : **ignoré** (colonne retirée côté Python/DB migration 013).
- Réponse create/update : `TagPointResponseBuilder.buildPointResponse(..., is_owner=true)` comme Python après re-read `TP_FIELDS` — pas le même enrichissement que `GET …/detail` (S26) ; le front qui consomme le détail complet peut refaire un `GET`.

## Blocages

Aucun.
