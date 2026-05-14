# P1-05 PostGIS Perf Baseline (micro-lot 1)

Objectif de ce sous-lot: produire une preuve executable (sans refactor) pour cadrer la validation perf SQL/PostGIS sur les requetes critiques.

## Scope couvert

- Inventaire des requetes geospatiales critiques identifiees dans:
  - `com.spotu.modules.home.infra.HomeRepository`
  - `com.spotu.modules.services.infra.ServicesRepository`
  - `com.spotu.modules.spotyou.infra.TagPointReadRepository`
- Verification schema migrations: aucun index geospatial explicite detecte dans `src/main/resources/db/migration`.
- Preparation d'une baseline reproductible pour pre-prod/prod-like.

## Validation reelle executee dans cet environnement

- Tentative execution locale Postgres:
  - `psql` indisponible (`command not found`)
  - `docker` indisponible (`command not found`)
- Conclusion: impossible de produire un `EXPLAIN ANALYZE` PostGIS reel dans l'environnement courant.
- Decision anti-tuning-speculatif:
  - **aucun index geospatial ajoute dans ce micro-lot** sans preuve plan avant/apres.

## Requetes critiques a profiler

1. Recherche services avec rayon (`ST_DWithin`)  
   - Source: `ServicesRepository.searchServices(...)`
2. Home nearest / listing geospatial (`ST_DWithin`, `ST_Distance`)  
   - Source: `HomeRepository`
3. SpotYou read geospatial (`ST_DWithin`, KNN `<->`, `ST_Distance`)  
   - Source: `TagPointReadRepository`

## Audit technique des requetes (sans refactor)

- `ServicesRepository.searchServices(...)`
  - filtre rayon via `EXISTS + ST_DWithin(...)` puis `LIMIT 100`.
  - risque potentiel: scan large de `service_locations` si absence index spatial.
- `HomeRepository`
  - combinaison `ST_DWithin` + `ST_Distance` + tri distance + `LIMIT`.
  - risque potentiel: tri geospatial couteux si plan ne bascule pas sur index KNN/GiST.
- `TagPointReadRepository`
  - usage explicite KNN (`ORDER BY ... <-> ...`) et `ST_DWithin`.
  - index spatial attendu pour performance stable sous charge.
- N+1:
  - pas de N+1 geospatial evident dans les chemins critiques identifies; le risque principal reste le cout des plans geospatiaux.

## Commandes SQL de baseline (PostgreSQL + PostGIS)

Executer en pre-prod avec dataset representatif:

```sql
-- services search radius
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.service_id
FROM services s
WHERE s.active = TRUE
  AND EXISTS (
    SELECT 1
    FROM service_locations sl
    WHERE sl.service_id = s.service_id
      AND ST_DWithin(
        sl.location::geography,
        ST_SetSRID(ST_MakePoint(2.35, 48.85), 4326)::geography,
        10000
      )
  )
LIMIT 100;
```

```sql
-- tag points distance / nearest
EXPLAIN (ANALYZE, BUFFERS)
SELECT tp.tag_point_id
FROM tag_points tp
WHERE tp.is_active = TRUE
  AND ST_DWithin(
    tp.location::geography,
    ST_SetSRID(ST_MakePoint(2.35, 48.85), 4326)::geography,
    10000
  )
ORDER BY tp.location::geography <-> ST_SetSRID(ST_MakePoint(2.35, 48.85), 4326)::geography
LIMIT 100;
```

```sql
-- home nearest sector/tagpoint style
EXPLAIN (ANALYZE, BUFFERS)
SELECT tp.tag_point_id
FROM tag_points tp
WHERE ST_DWithin(
  tp.location::geography,
  ST_SetSRID(ST_MakePoint(2.35, 48.85), 4326)::geography,
  10000
)
ORDER BY ST_Distance(
  tp.location::geography,
  ST_SetSRID(ST_MakePoint(2.35, 48.85), 4326)::geography
)
LIMIT 1;
```

## Acceptance perf a valider (P1-05 complet)

- Capturer P50/P95/P99 sur ces endpoints en charge cible.
- Confirmer plans stables (pas de seq scan massif non controle).
- Si derive, introduire indexes geospatiaux dedies via migration SQL (hors scope de ce micro-lot).

## Candidats indexes (a appliquer seulement apres plans reels)

- `service_locations USING GIST(location)`
- `tag_points USING GIST(location)`

Raison:
- correspondance directe avec predicates `ST_DWithin(...)` et tri KNN `<->`.
- impact fort attendu sur scans/tri geospatiaux.

Non-applique ici:
- faute de plan reel avant/apres dans l'environnement disponible.
- contrainte projet: pas de tuning speculatif.

## Limites du micro-lot

- Pas de benchmark charge automatise ici.
- Pas de modification schema/index dans ce lot (decision explicite anti-speculatif).
- Pas de SLO valide en environnement local H2 (non representatif PostGIS).
