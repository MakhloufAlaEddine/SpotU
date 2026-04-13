# STABILIZATION_POSTGIS.md — Analyse de l'écart PostGIS
> Basé sur `service_routes.py:381–413`, `001_initial_schema.sql`, `KNOWN_GAPS_VS_PYTHON.md — slice 09`.
> Généré le 2026-02-XX.

---

## Contexte de l'écart

### Ce que fait Python (CONSTAT CERTAIN)

**Endpoint concerné :** `GET /api/services?lat=X&lng=Y&radius=Z`

```python
# service_routes.py:381–392
if lat is not None and lng is not None:
    conditions.append(
        f"""EXISTS (
            SELECT 1 FROM service_locations sl
            WHERE sl.service_id = service_id
            AND ST_DWithin(sl.location::geography,
                ST_SetSRID(ST_MakePoint(${param_idx}, ${param_idx+1}), 4326)::geography,
                ${param_idx+2})
        )"""
    )
    params.extend([lng, lat, radius])  # ← ORDRE : longitude PUIS latitude
    param_idx += 3
```

**Colonne utilisée :** `service_locations.location` — type PostgreSQL `geography` (coordonnées sphériques WGS 84)

**Fonctions PostGIS :**
| Fonction | Rôle |
|---|---|
| `ST_MakePoint(lng, lat)` | Crée un point géométrique (ORDRE : longitude d'abord, latitude ensuite) |
| `ST_SetSRID(..., 4326)` | Assigne le système de coordonnées WGS 84 (GPS standard) |
| `::geography` | Cast en type géographique (calcul en mètres sur sphère, pas en degrés) |
| `ST_DWithin(A, B, radius_metres)` | Retourne TRUE si distance entre A et B ≤ radius_metres (sphérique) |

**Résultat :** Filtre précis sur une sphère → rayon en mètres exact, prend en compte la courbure terrestre.

**Extraction des coordonnées (lecture) :**
```sql
-- service_routes.py:103-104 et 260-261
ST_Y(location::geometry) as latitude,
ST_X(location::geometry) as longitude
```

---

### Ce que fait Java actuellement (d'après KNOWN_GAPS_VS_PYTHON.md)

> "approximation lat/lng sans PostGIS (écart v1 documenté)"

Implémentation probable : filtre bounding-box approximatif en degrés
```sql
-- Approximation bounding-box (exemple typique v1)
WHERE ABS(latitude - ?) < (radius / 111000.0)
  AND ABS(longitude - ?) < (radius / (111000.0 * COS(RADIANS(latitude))))
```

**Problème :**
- Calcul en degrés, pas en mètres → erreurs jusqu'à 10–15% selon la latitude
- Ne correspond pas au comportement Python → résultats incohérents si les deux backends tournent en parallèle
- `service_locations.location` est stocké en `geography` → la bounding-box doit d'abord extraire lat/lng

---

## Options Java pour corriger l'écart

### Option A — JDBC + SQL natif PostGIS ✅ RECOMMANDÉE

**Principe :** Utiliser `JdbcTemplate.query(...)` avec la même requête SQL PostgreSQL/PostGIS exacte que Python.

```java
// ServiceRepository.java
private static final String GEO_FILTER_SQL =
    "EXISTS (" +
    "  SELECT 1 FROM service_locations sl" +
    "  WHERE sl.service_id = s.service_id" +
    "  AND ST_DWithin(sl.location::geography," +
    "    ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography," +
    "    ?" +
    "  )" +
    ")";

// Paramètres : lng, lat, radius (ordre PostGIS)
params.add(lng);   // ← longitude en premier
params.add(lat);   // ← latitude en second
params.add(radius);
```

**Prérequis :**
- Extension PostGIS activée sur le cluster PostgreSQL : `CREATE EXTENSION IF NOT EXISTS postgis;`
- Vérification : `SELECT PostGIS_version();` → doit retourner une version
- Driver JDBC PostgreSQL standard (pas besoin de jar PostGIS séparé — le SQL natif passe directement)
- **Aucune dépendance Maven supplémentaire** — `org.postgresql:postgresql` suffit

**Avantages :**
- Comportement identique à Python (même SQL)
- Aucune bibliothèque supplémentaire
- Facile à déboguer (SQL lisible)
- Compatible avec la requête de lecture (`ST_X`, `ST_Y`) déjà utilisée

**Inconvénients :**
- Pas de type safety Java pour les géométries
- SQL natif difficile à tester avec H2 (pas de PostGIS) → à mocker en test ou utiliser un profil `@Profile("!test")`

---

### Option B — Hibernate Spatial / JTS

**Principe :** Utiliser `hibernate-spatial` (inclus dans Spring Boot Spatial) avec `Point` JTS.

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.hibernate.orm</groupId>
    <artifactId>hibernate-spatial</artifactId>
</dependency>
```

```java
// Avec JTS
import org.locationtech.jts.geom.Point;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.PrecisionModel;

GeometryFactory gf = new GeometryFactory(new PrecisionModel(), 4326);
Point point = gf.createPoint(new Coordinate(lng, lat));
// Puis utiliser dans une @Query avec distance()
```

**Inconvénients :**
- Complexité supplémentaire (nouveau modèle d'entité, mapping colonne `geography`)
- Hibernate Spatial supporte `geometry`, moins bien `geography` (type sphérique)
- Risque de divergence subtile avec le comportement Python

**→ Non recommandée pour v1.**

---

### Option C — Calcul Haversine en Java (sans PostGIS)

**Principe :** Calculer la distance en Java plutôt qu'en SQL.

```java
// Charger les services sans filtre géo → filtrer en Java
public static double haversineMetres(double lat1, double lon1, double lat2, double lon2) {
    double R = 6_371_000.0; // rayon Terre en mètres
    double dLat = Math.toRadians(lat2 - lat1);
    double dLon = Math.toRadians(lon2 - lon1);
    double a = Math.sin(dLat/2)*Math.sin(dLat/2)
             + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
             * Math.sin(dLon/2)*Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
```

**Inconvénients :**
- Charge tous les services actifs en mémoire avant filtrage → mauvaise performance si BDD volumineuse
- Pas de LIMIT efficace (LIMIT 100 s'applique avant le filtrage)
- Résultat final différent de Python pour les bords de zone

**→ Non recommandée sauf fallback temporaire.**

---

## Recommandation finale

**Option A (JDBC + SQL natif PostGIS).**

Justification :
1. SQL identique à Python → parité garantie
2. Zéro dépendance Maven supplémentaire
3. PostGIS est déjà actif sur le cluster (preuve : Python l'utilise en production)
4. Effort estimé : **MOYEN** (1–2 jours) — principalement pour adapter la construction dynamique du `WHERE` en Java

---

## Impact performance

| Aspect | Impact |
|---|---|
| Index spatial | PostGIS utilise les index GIST sur `service_locations.location` → requête O(log n) → pas de dégradation de performance |
| Connexion JDBC | Même driver PostgreSQL standard — aucune latence supplémentaire |
| Tests H2 | H2 ne supporte pas PostGIS → les tests géo nécessitent un profil `@Profile("!test")` ou un mock explicite |

---

## Piège critique — Ordre des paramètres

```python
# Python (CONSTAT CERTAIN — service_routes.py:391)
params.extend([lng, lat, radius])  # ← LONGITUDE d'abord, LATITUDE ensuite
```

**En Java :** Passer les paramètres dans le même ordre.
```java
params.add(lng);    // $1 → ST_MakePoint(lng, ...)
params.add(lat);    // $2 → ST_MakePoint(..., lat)
params.add(radius); // $3 → ST_DWithin distance
```

Inverser lng/lat est la cause n°1 d'erreur sur les requêtes géospatiales.
