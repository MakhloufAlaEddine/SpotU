# Slice 38 — Marketplace Products

Date: 2026-04-28

## Objectif

Implémenter `GET /api/marketplace/products` (endpoint public) avec parité Python, sans casser les slices 01→37.

## Endpoint créé

- `GET /api/marketplace/products`
  - query params optionnels: `tag_ids`, `spotyou_id`, `user_lat`, `user_lng`
  - réponse: `{"products":[...], "count": N}`
  - endpoint public (compatible front sans JWT)

## Implémentation réalisée

### Controller
- `src/main/java/com/spotu/modules/marketplace/api/MarketplaceProductsController.java`

### Service
- `src/main/java/com/spotu/modules/marketplace/service/MarketplaceProductsService.java`
  - logique 4 branches (`tag_ids` / `spotyou_id` / feed / filtre vide)
  - merge produits + services
  - badges owner/other
  - distance haversine + format (`m`/`km`)
  - enrichissement `seller_stats` via requêtes parallèles `CompletableFuture`

### Repository
- `src/main/java/com/spotu/modules/marketplace/infra/MarketplaceProductsRepository.java`
  - produits actifs (feed)
  - produits filtrés tags
  - services filtrés tags
  - resolve `spotyou_id` (PostGIS si dispo, fallback `latitude/longitude`)
  - ratings/counts seller stats
  - conversion timestamps au format Python ISO `+00:00`

### DTO + support
- `src/main/java/com/spotu/modules/marketplace/dto/MarketplaceProductsResponseDto.java`
- `src/main/java/com/spotu/modules/marketplace/support/MarketplaceDistanceSupport.java`
- `src/main/java/com/spotu/modules/marketplace/config/MarketplaceAsyncConfig.java`

## Mapping / schéma test

- Table test ajoutée:
  - `src/test/resources/test-schema-users.sql`: `marketplace_products`
- Seed test dédié:
  - `src/test/resources/test-data-marketplace.sql`

## Tests

Fichier ajouté:
- `src/test/java/com/spotu/modules/marketplace/api/MarketplaceProductsIntegrationTest.java`

Cas couverts:
- liste nominale (feed public)
- filtre tags (mélange products + services)
- endpoint sans auth
- liste vide (`spotyou_id` invalide)
- compat contrat Python (wrapper, champs clés, badges, distances, seller_stats)

Exécution:
- `mvn -Dtest=MarketplaceProductsIntegrationTest test` ✅

## Tables touchées

- Lecture:
  - `marketplace_products`
  - `services`
  - `users`
  - `tag_points`
  - `reviews`
- Aucune écriture métier.

## Écarts restants

- Aucun écart bloquant identifié dans le périmètre S38.
- L’implémentation conserve les asymétries Python documentées (mode feed sans services, `spotyou_id` invalide => 200 vide, doublon `seller_picture`/`seller_picture_url`).
