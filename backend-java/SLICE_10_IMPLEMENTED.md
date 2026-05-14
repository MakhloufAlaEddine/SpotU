# Slice 10 — Référentiels publics (lecture)

## Endpoints implémentés

- `GET /api/domains`
- `GET /api/tags/categories`
- `GET /api/tags`

## Alignement Python (`domain_routes.py:11-140`)

- Endpoints publics sans auth (aucun 401/403).
- `/api/domains` :
  - `include_inactive=false` (défaut) => `active=true` seulement
  - `include_inactive=true` => tous les domaines
  - tri `ORDER BY name ASC`
- `/api/tags/categories` :
  - catégories actives filtrables par `domain_id` et `entity_type`
  - requête tags séparée uniquement si catégories trouvées
  - groupement par catégorie côté application
  - `linked_category_id` non exposé
- `/api/tags` :
  - reproduction des 3 branches SQL Python
  - branche A (`category_id` ou `entity_type`) avec `DISTINCT` + JOINs conditionnels
  - branche B (`domain_id` seul) sans JOIN
  - branche C (aucun filtre)
  - `LIMIT 200` dans toutes les branches

## Implémentation

- `modules/referential/api/ReferentialController`
- `modules/referential/service/ReferentialService`
- `modules/referential/infra/ReferentialRepository`
- DTOs :
  - `DomainDto`
  - `TagCategoryDto`
  - `TagDto`

## Tests ajoutés

- `ReferentialIntegrationTest` :
  - domains nominal + include_inactive + token invalide ignoré
  - categories nominal + filtres + vide + absence de `linked_category_id`
  - tags branches A/B/C + vide

## Notes

- Aucune pagination ajoutée (fidèle Python).
- Réponses vides retournées en `200 []` (pas de 404) sur les 3 endpoints.
