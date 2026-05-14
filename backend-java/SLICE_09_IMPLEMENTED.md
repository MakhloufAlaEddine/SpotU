# Slice 09 — Services publics (lecture)

## Endpoints implémentés

- `GET /api/services`
- `GET /api/services/{serviceId}`

## Alignement Python (`service_routes.py:352-413`, `service_routes.py:718-753`)

- Auth soft/optionnelle sur les 2 endpoints : token absent ou invalide ignoré (pas de 401).
- Liste `GET /api/services` :
  - filtre `active=true` toujours appliqué
  - exclusion des services du viewer si token valide
  - filtres `coach_id`, `domain_id`, `lat/lng/radius`
  - `LIMIT 100` sans pagination
  - enrichissement `coach`, `avg_rating`, `review_count`, `locations`, `tags`
  - `slots=[]`, `packages=[]`, `is_owner=false` forcés
- Détail `GET /api/services/{serviceId}` :
  - `404 {"detail":"Service not found"}` si introuvable
  - enrichissement complet (slots + packages)
  - `is_owner=true` si viewer = coach ou `role=admin`
  - `original_address` / `locations[].original_description` visibles uniquement owner/admin

## Implémentation

- `modules/services/api/ServicesController`
- `modules/services/service/ServicesQueryService`
- `modules/services/infra/ServicesRepository`
- DTOs :
  - `ServiceDto`
  - `CoachSummaryDto`
  - `ServiceLocationDto`
  - `TagDetailDto`
  - `ServiceSlotDto`
  - `ServicePackageDto`
  - `ServicePackageSlotDto`
- Utilitaire :
  - `AddressMaskUtil`

## Tests ajoutés

- `ServicesIntegrationTest`
  - nominal liste publique
  - filtres `coach_id`
  - exclusion des propres services avec token valide
  - token invalide ignoré
  - liste vide
  - détail nominal
  - vue owner (coach + admin)
  - service introuvable (404)

## Notes / écarts documentés

- Le filtre géographique Java utilise une approximation lat/lng (`service_locations.latitude/longitude`) au lieu de `ST_DWithin` PostGIS.
