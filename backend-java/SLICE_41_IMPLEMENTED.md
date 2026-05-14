# Slice 41 — Marketplace Admin Moderation

Date: 2026-05-08

## Objectif

Implémenter la modération admin marketplace côté Java:

- `GET /api/admin/products/pending`
- `GET /api/admin/products/{id}`
- `POST /api/admin/products/{id}/approve`
- `POST /api/admin/products/{id}/reject`
- worker `AdminProductReminderWorker` (cadence 600s)

## Implémentation réalisée

### Endpoints admin

- `src/main/java/com/spotu/modules/marketplace/api/AdminProductController.java`
  - routes `/api/admin/products/*` ajoutées
  - erreurs 404 formatées en `{ "error": "Produit introuvable." }`

- `src/main/java/com/spotu/modules/marketplace/service/AdminProductService.java`
  - auth admin stricte (`role == admin`)
  - 403 non-admin: `{ "detail": "Admin only" }`
  - approve/reject sans guard sur statut courant (anomalie Python préservée)
  - reject écrit la même valeur dans `rejection_reason` et `admin_comment`
  - approve/reject ajoutent une notification seller (type `product_approved` / `product_rejected`)
  - payload reject garde `admin_comment` push potentiellement `""` (string vide)

- `src/main/java/com/spotu/modules/marketplace/infra/AdminProductRepository.java`
  - `GET pending` FIFO `ORDER BY created_at ASC`
  - `quality_score` calculé en SQL (formule Python 9 critères)
  - `GET detail` avec `SELECT p.*` + `seller_email`
  - update moderation + inserts notifications

### Worker reminder

- `src/main/java/com/spotu/modules/workers/service/AdminProductReminderScheduler.java`
  - scheduler toutes les `600s` configurable:
    - `admin.product.reminder.interval.secs` (default 600)
  - délègue à `AdminProductService.runReminderCycle()`

- reminder cycle:
  - scan produits `pending_review` vieux de plus de 2h
  - batch update `admin_reminder_sent_at`
  - notification à tous les admins (`admin_product_reminder`)

## Schéma / migrations

- `src/main/resources/db/migration/V7__marketplace_admin_moderation_columns.sql`
  - `admin_validated_by`
  - `admin_validated_at`
  - `admin_reminder_sent_at`

- `src/test/resources/test-schema-users.sql`
  - alignement des colonnes de modération

## Tests ajoutés

- `src/test/java/com/spotu/modules/marketplace/api/AdminProductIntegrationTest.java`
  - pending nominal FIFO + quality_score
  - detail nominal + seller_email
  - 403 format `{detail:"Admin only"}`
  - 404 format `{error:"Produit introuvable."}`
  - approve nominal
  - reject nominal (duplication `rejection_reason/admin_comment`)
  - approve sur produit deleted (anomalie Python)

- `src/test/java/com/spotu/modules/workers/service/AdminProductReminderSchedulerTest.java`
  - cycle reminder nominal
  - update `admin_reminder_sent_at`
  - notifications admins

- seed dédié:
  - `src/test/resources/test-data-products-s41.sql`

## Exécution tests

- `mvn -Dtest=AdminProductIntegrationTest,AdminProductReminderSchedulerTest test` ✅
- `mvn -Dtest=MarketplaceProductsIntegrationTest,ProductCreationIntegrationTest,ProductLifecycleIntegrationTest,MarketplaceMediaPurgeSchedulerTest,AdminProductIntegrationTest,AdminProductReminderSchedulerTest test` ✅

## Tables touchées

- `marketplace_products` (SELECT/UPDATE modération + reminder timestamp)
- `users` (JOIN admin detail/list + lookup admins pour reminder)
- `notifications` (persist notifications seller/admin)

## Anomalies Python conservées

- approve/reject sans guard `status='pending_review'`
- approve possible sur produit `deleted` (résurrection)
- reject écrit la même valeur dans `rejection_reason` et `admin_comment`
- asymétrie erreurs conservée:
  - 403 -> `{detail}`
  - 404 -> `{error}`

## Impact rétroactif documenté (`image_urls` jsonb)

L’expression SQL Python `jsonb_array_length(COALESCE(p.image_urls, '[]'::jsonb))` est reproduite côté PostgreSQL dans S41.  
Conséquence: `image_urls` doit être traité comme `jsonb` sur l’environnement PostgreSQL cible (impact à consolider pour S39/S40).
