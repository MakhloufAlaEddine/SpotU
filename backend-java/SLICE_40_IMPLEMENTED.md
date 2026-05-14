# Slice 40 — Marketplace Seller Lifecycle (delete/reactivate + media purge)

Date: 2026-05-08

## Objectif

Clore le lifecycle seller marketplace côté Java avec:

- `DELETE /api/products/{id}`
- `POST /api/products/{id}/reactivate`
- worker de purge média différée (cadence 3600s)

## Implémentation réalisée

### Endpoints

- `src/main/java/com/spotu/modules/marketplace/api/ProductCreationController.java`
  - ajout `DELETE /api/products/{productId}`
  - ajout `POST /api/products/{productId}/reactivate`

### Service lifecycle

- `src/main/java/com/spotu/modules/marketplace/service/ProductCreationService.java`
  - `deleteProduct(...)`:
    - owner-only (`product_id + seller_id + status != 'deleted'`)
    - soft-delete (`status='deleted'`, `deleted_at`, `deleted_by`, `media_purge_scheduled_at=now+90j`, `updated_at`)
    - scheduling `pending_file_deletions` 1 row par URL `image_urls[]`
    - réponse `{ok, media_purge_scheduled_at}`
    - erreur 404 DELETE au format `{ "error": "Produit introuvable ou non autorisé." }`
  - `reactivateProduct(...)`:
    - owner OU admin
    - ordre strict checks: 404 -> 409 -> 403
    - suppression `pending_file_deletions` uniquement `status='pending'`
    - restore forcé `status='active'`
    - reset `deleted_at/deleted_by/media_purge_scheduled_at/media_purge_notified_at`
    - `media_purged` conservé
    - réponse `{ok, reactivated, product_id, media_purged, requires_media_reupload}`

### Repository SQL

- `src/main/java/com/spotu/modules/marketplace/infra/ProductCreationRepository.java`
  - méthodes lifecycle ajoutées:
    - `findDeleteGuardRow`
    - `softDeleteProduct`
    - `scheduleFileDeletion`
    - `findReactivateGuardRow`
    - `cancelPendingFileDeletions`
    - `reactivateProduct`
    - worker: `findDueProductIdsForMediaPurge`, `markProductsMediaPurged`

### Worker S40

- `src/main/java/com/spotu/modules/workers/service/MarketplaceMediaPurgeScheduler.java`
  - cadence configurable: `${media.purge.interval.secs:3600}`
  - startup tick + periodic tick
  - idempotence stricte:
    - `media_purged = FALSE`
    - `status = 'deleted'`
    - `(reactivated_at IS NULL OR reactivated_at < deleted_at)`
  - délègue à `MarketplaceFilePurgeService.runPurge(0)` dans un `try/catch` non bloquant

- `src/main/java/com/spotu/modules/workers/service/MarketplaceFilePurgeService.java`
  - stub explicite (log-only) pour la purge physique

## DB / migrations

- `src/main/resources/db/migration/V6__marketplace_products_lifecycle.sql` (nouveau)
  - `deleted_at`, `deleted_by`
  - `media_purge_scheduled_at`, `media_purge_notified_at`
  - `media_purged`, `media_purged_at`
  - `reactivated_at`

- `src/test/resources/test-schema-users.sql`
  - alignement colonnes lifecycle marketplace

## Tests ajoutés

- `src/test/java/com/spotu/modules/marketplace/api/ProductLifecycleIntegrationTest.java`
  - DELETE nominal
  - DELETE non-owner 404 `{error}`
  - REACTIVATE nominal
  - REACTIVATE après purge (`requires_media_reupload=true`)
  - formats d’erreur distincts
  - pending_file_deletions: suppression `pending` uniquement

- `src/test/java/com/spotu/modules/workers/service/MarketplaceMediaPurgeSchedulerTest.java`
  - purge worker nominale
  - garde idempotence `reactivated_at >= deleted_at` (non purge)
  - non-répétition au 2e tick

- seed dédié:
  - `src/test/resources/test-data-products-s40.sql`

## Exécution tests

- `mvn -Dtest=ProductLifecycleIntegrationTest,MarketplaceMediaPurgeSchedulerTest test` ✅
- `mvn -Dtest=MarketplaceProductsIntegrationTest,ProductCreationIntegrationTest,ProductLifecycleIntegrationTest,MarketplaceMediaPurgeSchedulerTest test` ✅

## Tables touchées

- `marketplace_products` (UPDATE/SELECT lifecycle + worker)
- `pending_file_deletions` (INSERT/DELETE)
- `users` (indirect déjà utilisé sur S39)

## Parité / anomalies conservées

- DELETE retourne 404 opaque pour `inexistant | non-owner | déjà deleted` (anti-énumération)
- asymétrie formats erreurs conservée:
  - DELETE -> `{error}`
  - REACTIVATE -> `{detail}`
- REACTIVATE force toujours `status='active'` (même si ancien état draft/pending_review)
- REACTIVATE ne reset pas `media_purged`
- purge DELETE basée sur `image_urls[]` uniquement (pas de purge explicite séparée `cover_image_url`)

## Écarts restants / suites

- purge physique média (R2) laissée en stub dans `MarketplaceFilePurgeService`:
  - à brancher dans une slice infra dédiée
- extension worker multi-entités (`tag_points/services/users`) possible ensuite sans changer le contrat S40 seller marketplace
