# Slice 39 — Marketplace Product Creation (Seller)

Date: 2026-05-08

## Objectif

Implémenter les endpoints seller du Python `product_creation_routes.py` avec le path réel `/api/products`:

- `POST /api/products`
- `GET /api/products/mine`
- `GET /api/products/{id}/detail`

## Implémentation réalisée

### Endpoints

- `src/main/java/com/spotu/modules/marketplace/api/ProductCreationController.java`
  - `POST /api/products`
  - `GET /api/products/mine`
  - `GET /api/products/{productId}/detail`

### Service métier

- `src/main/java/com/spotu/modules/marketplace/service/ProductCreationService.java`
  - auth stricte via `AuthMeService.requireCurrentUser`
  - UPSERT applicatif (`product_id` fourni vs auto-généré `prod_<12hex>`)
  - validations minimales (400 `{error}`)
  - validations `pending_review` (422 `{error, details}`)
  - anti-downgrade draft (403 `{detail}`)
  - fallback `delivery_modes`
  - parsing prix robuste (virgule décimale)
  - mapping réponse `/mine` wrapper + `/detail` objet direct

### Repository SQL

- `src/main/java/com/spotu/modules/marketplace/infra/ProductCreationRepository.java`
  - insert/update/select sur `marketplace_products`
  - ownership WHERE `product_id + seller_id` sur update/detail
  - `/mine` avec filtre:
    - `status != 'deleted'`
    - `product_type IN ('rental','sale')`

### DTOs + erreurs

- `src/main/java/com/spotu/modules/marketplace/dto/ProductUpsertResponseDto.java`
- `src/main/java/com/spotu/modules/marketplace/dto/ProductMineResponseDto.java`
- `src/main/java/com/spotu/modules/marketplace/service/ProductCreationExceptions.java`

## Formats d’erreur S39 respectés

- 400 -> `{"error":"..."}`
- 403 -> `{"detail":"..."}`
- 422 -> `{"error":"...", "details":[...]}`
- 404 detail -> `{"error":"Produit introuvable ou accès refusé."}`

## Schéma + données de test

- `src/test/resources/test-schema-users.sql`
  - enrichissement table `marketplace_products` pour colonnes S39
- `src/test/resources/test-data-products-s39.sql`
  - seed seller/owner/other products pour tests create/mine/detail

## Tests ajoutés

- `src/test/java/com/spotu/modules/marketplace/api/ProductCreationIntegrationTest.java`

Couverture:
- POST nominal
- POST payload invalide 422
- 400 métier
- 403 anti-downgrade
- GET mine
- GET detail owner
- GET detail forbidden (404 opaque)
- persistance arrays (pricing_modes/tag_ids)

Exécution:
- `mvn -Dtest=ProductCreationIntegrationTest test` ✅

## Tables touchées

- `marketplace_products` (INSERT/UPDATE/SELECT)
- `users` (lookup admin ids — notif async)

## Écarts / décisions documentées

- Le path Python réel est respecté: `/api/products` (pas `/api/marketplace/products`).
- Implémentation Java en une transaction `@Transactional` pour l’upsert (amélioration de robustesse), tout en conservant le résultat API visible.
- Les colonnes tableau sont stockées en JSON string dans le schéma test H2 (`VARCHAR`) pour compat test; audit Postgres `text[]`/`jsonb` reste requis avant cutover DB prod.

## Blocages

- Aucun blocage technique restant pour S39 dans le périmètre demandé.
