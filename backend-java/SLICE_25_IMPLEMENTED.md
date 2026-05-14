# Slice 25 — Home (nearest-sector + feed)

Implémentée le **2026-04-15**.

## Endpoints implémentés

- `GET /api/home/nearest-sector`
- `GET /api/home/feed`

## Fichiers ajoutés/modifiés

- `src/main/java/com/spotu/modules/home/api/HomeController.java`
- `src/main/java/com/spotu/modules/home/service/HomeService.java`
- `src/main/java/com/spotu/modules/home/infra/HomeRepository.java`
- `src/test/java/com/spotu/modules/home/api/HomeIntegrationTest.java`
- `src/test/resources/test-schema-users.sql`
- `src/test/resources/test-data-users.sql`

## Comportements Python reproduits

- Auth **optionnelle** sur les 2 endpoints (pas de 401 si token absent/invalide).
- `nearest-sector` :
  - recherche SpotYou actif le plus proche,
  - exclusion des propres spots si user connecté,
  - retour `null` si aucun spot.
- `feed` :
  - auto-expansion rayon `50 -> 100 -> 200 -> 500 km` (4 itérations max),
  - SQL conditionnelle selon auth / coords,
  - mix SpotYou + Services,
  - scoring identique (tags, popularité, distance, bonus membre pour SpotYou),
  - tri score desc,
  - wrapping `coach` sur les services,
  - limites de sortie `spotyou[:30]`, `services[:20]`.

## PostGIS

- Les requêtes de prod utilisent les fonctions PostGIS attendues :
  - `ST_MakePoint(lng, lat)` (ordre strict respecté),
  - `ST_SetSRID(..., 4326)`,
  - `ST_DWithin(...::geography, ..., radius_m)`,
  - `ST_Distance(...::geography, ...)`,
  - `ST_X`/`ST_Y`.
- En environnement test H2 (sans PostGIS), fallback géométrique local pour éviter de casser la suite de tests.

## Tables lues (read-only)

- `tag_points`
- `users`
- `spot_you_members`
- `spot_you_attendance`
- `services`
- `service_locations`
- `bookings`

## Tests

- Ajout `HomeIntegrationTest` couvrant :
  - nominal `nearest-sector`,
  - exclusion user connecté sur `nearest-sector`,
  - nominal feed sans auth,
  - feed sans coordonnées,
  - auto-expansion du rayon.
- Régression globale : `mvn test` vert.

## Écarts / notes

- En Spring MVC, retour `null` sur endpoint produit une réponse vide ; pour rester compatible contrat JSON `null`, `nearest-sector` renvoie explicitement le littéral `null` quand aucun secteur n’est trouvé.
- En test H2, la distance est approximée sans PostGIS ; la logique métier (ordre des coords, expansion, scoring, personnalisation) reste identique.
