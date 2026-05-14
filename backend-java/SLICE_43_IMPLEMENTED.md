# Slice 43 — Services Coach CRUD (writes)

## Statut
Implémenté dans `backend-java` pour les endpoints :

- `POST /api/services`
- `PUT /api/services/{id}`
- `PATCH /api/services/{id}`
- `DELETE /api/services/{id}`
- `POST /api/services/{id}/reactivate`

## Couverture fonctionnelle

- Auth et permissions alignées :
  - création réservée `coach|admin` (`403 detail=Coach role required`)
  - update/delete owner ou admin (`403 detail=Not authorized`)
  - reactivate owner ou admin (`403 detail=Non autorisé`)
- Erreurs alignées (`detail`) :
  - 404 update/delete : `Service not found`
  - 404 reactivate : `Service introuvable`
  - 409 reactivate : `Ce service est déjà actif`
  - 409 delete avec bookings actifs (coach) : message Python avec compteur
- Validation create en `422` style Pydantic (`detail: [ ... ]`) :
  - title trim + min 5
  - images max 5
  - price >= 0
- Asymétries Python conservées :
  - PUT/PATCH sans validations fortes du POST
  - `images`: `null/absent => keep`, `[] => wipe`, liste => diff + suppression immédiate retirées
  - DELETE : purge médias différée 90 jours via `pending_file_deletions`
  - UPDATE : purge médias immédiate via `FileStorageService.deleteUploadFile`
  - defaults booking différents POST vs PUT (manual vs instant)

## Implémentation technique

- Nouveau service transactionnel `ServicesWriteService` (`@Transactional`) :
  - `create`, `update`, `delete`, `reactivate`
- `ServicesController` enrichi avec les routes write + handler `422`
- `ServicesRepository` étendu :
  - guards write
  - insert/update dynamique `services`
  - replace `service_locations` avec write PostGIS `ST_SetSRID(ST_MakePoint(...),4326)` + fallback H2
  - soft delete / reactivate lifecycle
  - `pending_file_deletions` schedule/cancel
  - conversations archive/unarchive
  - lecture flags `app_config`

## Tables touchées

- `services` (create/update/delete/reactivate)
- `service_locations` (write PostGIS + replace)
- `bookings` (garde delete)
- `pending_file_deletions` (delete/reactivate lifecycle)
- `conversations` (context_deleted true/false)
- `app_config` (flags booking)

## Hors scope conservé (conforme S43)

- Persistance détaillée `slots` (S44)
- Persistance détaillée `packages` (S45)
- save/unsave services

## Tests

- `ServicesIntegrationTest` enrichi pour couvrir S43 :
  - create nominal + 422
  - patch owner/non-owner
  - delete owner conflict + delete admin bypass
  - reactivate nominal
- Exécution :
  - `mvn -Dtest=ServicesIntegrationTest test` ✅
  - 19 tests, 0 failure

## Écarts restants

- Aucun blocage S43.
- `slots/packages` acceptés au niveau payload mais non persistés (scope explicitement reporté S44/S45).
