# Slice 42 — Services Coach Reads (Java)

## Statut
Implémenté côté `backend-java` avec couverture des 5 endpoints demandés :

- `GET /api/services` (search public + soft auth)
- `GET /api/services/mine` (auth requise)
- `GET /api/services/saved` (auth requise, format plat distinct)
- `GET /api/services/deactivated` (auth requise, format lifecycle)
- `GET /api/services/{service_id}` (public + soft auth)

## Comportements alignés Python (S42)

- Search avec auth optionnelle : JWT invalide ignoré, auto-exclusion `coach_id != current_user`.
- Search: `LIMIT 100`, filtres dynamiques (`lat/lng/radius`, `coach_id`, `domain_id`), `slots=[]`, `packages=[]`, `is_owner=false`.
- Detail: `is_owner = coach OR admin`, masquage des champs sensibles pour non-owner, 404 avec `{"detail":"Service not found"}`.
- Mine: services actifs du coach, enrichissement owner (slots/packages inclus), `is_owner=true`.
- Saved: format JSON plat distinct (pas `tags/slots/packages`) + `available_slots`.
- Deactivated: filtre `deleted_at IS NOT NULL` + garde `reactivated_at`, calcul `days_until_media_purge`.

## Implémentation technique

- Controller enrichi: `ServicesController` avec les routes `mine/saved/deactivated`.
- Service métier: `ServicesQueryService` étendu pour les 3 nouvelles lectures.
- Repository: `ServicesRepository` étendu avec:
  - `findMineByCoachId`
  - `findSavedByUserId`
  - `findDeactivatedByCoachId`
- DTOs dédiés par endpoint:
  - `ServiceSearchDto`
  - `ServiceMineDto`
  - `ServiceSavedDto`
  - `ServiceDeactivatedDto`
  - `ServiceDetailDto`

## Schéma / migrations

- Nouvelle migration `V8__services_read_support.sql` :
  - colonnes lifecycle sur `services` (`deleted_at`, `media_purge_scheduled_at`, etc.)
  - création table `service_saves`
- Schéma test H2 aligné (`test-schema-users.sql`) avec colonnes lifecycle + table `service_saves`.

## Tests

- `ServicesIntegrationTest` étendu :
  - auth obligatoire pour `mine/saved/deactivated` (401)
  - format owner pour `mine`
  - format plat distinct pour `saved`
  - champs lifecycle pour `deactivated`
- Exécution ciblée :
  - `mvn -Dtest=ServicesIntegrationTest test` ✅

## Écarts restants

- Aucun écart bloquant détecté sur le périmètre S42 implémenté.
- Fallback SQL H2 conservé pour la requête `saved` quand `TO_CHAR(NOW(), ...)` n’est pas supporté.
