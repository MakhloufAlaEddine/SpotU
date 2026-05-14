# Stabilisation technique — Implémentation

## Périmètre traité

Priorités exécutées dans l'ordre demandé :

1. collisions admin bloquantes (neutralisation de risque)
2. CORS production-safe
3. réduction de l'écart PostGIS sur `/api/services`
4. corrections mineures low-risk documentées

## Corrections appliquées

### 1) Collisions admin

- État actuel Java : aucune route admin encore implémentée, donc aucune collision runtime aujourd'hui.
- Décision appliquée et figée pour les futures slices admin :
  - `GET /api/admin/subscriptions` : référence unique `payment_routes.py:497`
  - `GET /api/admin/subscription-plans` : référence unique `admin_routes.py:210`
  - tri conservé : `ORDER BY priority DESC, created_at` (`created_at` ASC implicite) — décision validée
- Impact : neutralisation du risque d'ambiguous mapping lors de l'ajout des routes admin.

### 2) CORS prod-safe

- Fichier modifié : `src/main/java/com/spotu/config/WebConfig.java`
- Suppression de `allowedOriginPatterns("*")`.
- Remplacement par liste explicite d'origines :
  - propriété : `app.cors.allowed-origins`
  - env : `APP_CORS_ALLOWED_ORIGINS`
- Credentials explicitement autorisés (`allowCredentials(true)`) avec méthodes/headers fermés :
  - méthodes : `GET, POST, PUT, PATCH, DELETE, OPTIONS`
  - headers : `Authorization, Content-Type`
- Fichier modifié : `src/main/resources/application.yml`
  - ajout de `app.cors.allowed-origins` avec fallback dev local.

### 3) Écart PostGIS `/api/services`

- Fichier modifié : `src/main/java/com/spotu/modules/services/infra/ServicesRepository.java`
- Requête géo principale alignée Python :
  - `ST_DWithin(sl.location::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)`
  - ordre des paramètres aligné : `lng`, `lat`, `radius`
- Fallback conservé si PostGIS indisponible (H2/dev sans colonne `location`) :
  - approximation lat/lng existante, uniquement en repli.

### 4) Corrections mineures low-risk

- Ajout test CORS ciblé :
  - `ReferentialIntegrationTest#cors_allowedOrigin_returnsExplicitOriginAndCredentials`
- Pas de changement sur la politique HTTP DB :
  - `DataAccessException -> 503` conservé (décision validée).

## Tests

- Exécuté : `mvn test`
- Résultat : **88 tests**, **0 failure**, **0 error**
- Non-régression validée slices `01 -> 10`.

## Fichiers modifiés / créés

- Modifiés :
  - `src/main/java/com/spotu/config/WebConfig.java`
  - `src/main/resources/application.yml`
  - `src/main/java/com/spotu/modules/services/infra/ServicesRepository.java`
  - `src/test/java/com/spotu/modules/referential/api/ReferentialIntegrationTest.java`
  - `KNOWN_GAPS_VS_PYTHON.md`
- Créé :
  - `STABILIZATION_IMPLEMENTED.md`

## Ce qui reste / dépendances infra

- **PostGIS infra réelle** :
  - pour fonctionnement strict sans fallback : extension PostGIS active + colonne `service_locations.location` en base PostgreSQL.
- **Auth filter global** :
  - reste à durcir avant les slices booking write/admin.
- **Admin endpoints** :
  - pas encore implémentés ; décisions de collision déjà verrouillées pour éviter les futurs conflits.
