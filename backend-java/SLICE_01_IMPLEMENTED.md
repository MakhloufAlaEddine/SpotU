# SLICE_01_IMPLEMENTED.md — Configuration publique (`/api/config/*`)

## Réalisé

- **`GET /api/config/booking`** : lecture PostgreSQL table `app_config`, clés identiques au Python (`server.py` `public_booking_config`), mêmes défauts (`"false"` / `30`) et comparaison `"true"` insensible à la casse pour les booléens.
- **`GET /api/config/commission`** : lecture `pricing_rules` avec filtre `product_type = 'service_booking' AND active = TRUE`, tri `ORDER BY priority DESC, created_at DESC LIMIT 1`, réponse identique au dict Python (float + `has_rule`).
- **Couches** : `PublicConfigController` → `PublicConfigService` → `AppConfigJdbcRepository` / `PricingRulesJdbcRepository` (JdbcTemplate).
- **DTO** : `BookingConfigResponse`, `CommissionConfigResponse` avec `@JsonNaming(SnakeCaseStrategy)` pour JSON snake_case comme FastAPI.
- **Flyway** : `V2__app_config_and_pricing_rules.sql` (schéma aligné `001_initial_schema.sql`, sous-ensemble).
- **Erreurs** : `DataAccessException` → **503** via `GlobalExceptionHandler` (voir écarts ci-dessous).
- **Tests** : intégration données complètes (`SpotuApplicationTest`), données vides (`PublicConfigEmptyDataIntegrationTest`), unitaires service (`PublicConfigServiceTest`), WebMvc (`PublicConfigControllerWebMvcTest`).

## Non modifié (socle)

- `GET /api/liveness`, `GET /api/readiness` inchangés (`InfraApiController`).

## Écarts vs Python (documentés, non bloquants)

| Sujet | Python | Java slice 01 |
|-------|--------|----------------|
| Erreur SQL / DB indisponible sur `/api/config/*` | Exception non gérée → typiquement **500** FastAPI | **`DataAccessException` → 503** avec corps `ErrorResponse` |
| Champ `_stub` | Absent | Supprimé (n’existait que côté Java bootstrap) |

## Incertitudes

- Aucune sur les **requêtes SQL** et la **structure de réponse** : copiées du fichier `backend/server.py` et du schéma `backend/migrations/001_initial_schema.sql`.

## Fichiers principaux

- `src/main/java/com/spotu/modules/config/**`
- `src/main/resources/db/migration/V2__app_config_and_pricing_rules.sql`
- `src/test/resources/test-schema-config.sql`, `test-data-config.sql`, `test-data-config-defaults.sql`
