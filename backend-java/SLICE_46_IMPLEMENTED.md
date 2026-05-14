# Slice 46 — Services Save / Unsave

## Statut
Implémentée dans `backend-java` avec 2 endpoints :

- `POST /api/services/{service_id}/save`
- `DELETE /api/services/{service_id}/unsave`

## Comportements alignés Python

- Path asymétrique conservé : `POST /save` et `DELETE /unsave`.
- Auth JWT obligatoire sur les deux endpoints (401 sinon).
- `POST /save` :
  - vérifie `services.active = TRUE`
  - 404 `{"detail":"Service not found"}` si inexistant/inactif
  - insert idempotent `service_saves` (pas de doublon)
  - `saved_at` inchangé en re-save
  - réponse `{ "success": true, "is_saved": true }`
- `DELETE /unsave` :
  - suppression silencieuse (`service_id`,`user_id`) sans 404
  - pas de filtre `active=TRUE`
  - réponse `{ "success": true, "is_saved": false }`

## Implémentation technique

- `ServicesController` :
  - `@PostMapping("/{serviceId}/save")`
  - `@DeleteMapping("/{serviceId}/unsave")`
- `ServicesWriteService` :
  - `saveService(...)`
  - `unsaveService(...)`
- `ServicesRepository` :
  - `existsActiveServiceById(...)`
  - `saveServiceForUser(...)` (PG `ON CONFLICT DO NOTHING`, H2 fallback sans update de `saved_at`)
  - `unsaveServiceForUser(...)`
- Migration ajoutée :
  - `V10__service_saves_unique.sql` (unique `(service_id, user_id)`)
- Schéma test aligné :
  - index unique `uq_service_saves_service_user` dans `test-schema-users.sql`

## Tables touchées

- `service_saves`
- `services` (lecture existence active uniquement)

## Tests

`ServicesIntegrationTest` enrichi :

- save nominal
- save idempotent + conservation `saved_at`
- save inactive => 404
- unsave nominal
- unsave inexistant silent
- round-trip avec `GET /api/services/saved` (S42)
- auth absente => 401

Exécution :

- `mvn -Dtest=ServicesIntegrationTest test` ✅
- 30 tests, 0 échec

## Hors scope conservé

- Aucune route `DELETE /save` ajoutée
- Aucun endpoint supplémentaire de statut favori
- Aucun audit/notification/rate-limit ajouté
