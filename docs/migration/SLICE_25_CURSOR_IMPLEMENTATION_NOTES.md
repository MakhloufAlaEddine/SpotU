# SLICE_25_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation Cursor
> Basé sur `home_routes.py`.
> Généré le 2026-04-15.

---

## Objectif

Créer le `HomeController` Java avec les 2 endpoints home et le `HomeFeedService` qui encapsule
la logique de scoring, auto-expansion, et requêtes PostGIS. Après S25, l'écran d'accueil fonctionne.

---

## 1. Architecture Java cible

```
src/main/java/com/spotu/
├── controller/
│   └── HomeController.java              ← 🔴 S25 (2 endpoints)
├── service/
│   └── HomeFeedService.java             ← 🔴 S25 (scoring + expansion + PostGIS queries)
├── repository/
│   ├── TagPointRepository.java          ← 🔴 S25 (SpotYou queries — native PostGIS)
│   └── ServiceRepository.java           ← 🔴 S25 (Services queries — native PostGIS)
├── dto/
│   ├── NearestSectorResponse.java       ← 🔴 S25
│   └── HomeFeedResponse.java            ← 🔴 S25
```

---

## 2. PostGIS — Configuration requise

### Vérifier l'extension

```sql
-- Déjà présent dans le schéma de production, mais à vérifier :
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Pattern de requête Java (native query)

```java
@Repository
public interface TagPointRepository extends JpaRepository<TagPoint, String> {

    @Query(value = """
        SELECT tp.point_id, tp.title, ...,
               ST_Y(tp.location::geometry) AS latitude,
               ST_X(tp.location::geometry) AS longitude,
               ST_Distance(
                   tp.location::geography,
                   ST_SetSRID(ST_MakePoint(:lng::float8, :lat::float8), 4326)::geography
               ) AS distance
        FROM tag_points tp
        WHERE tp.active = TRUE
          AND ST_DWithin(
              tp.location::geography,
              ST_SetSRID(ST_MakePoint(:lng::float8, :lat::float8), 4326)::geography,
              :radius::float8
          )
        ORDER BY distance
        LIMIT 60
        """, nativeQuery = true)
    List<Map<String, Object>> findSpotsInRadius(
        @Param("lng") double lng, @Param("lat") double lat,
        @Param("radius") double radius);
}
```

**PIÈGE** : JPA `@Query` native avec PostGIS functions fonctionne directement —
les functions PostGIS sont côté SQL, pas côté Java. Pas besoin de Hibernate Spatial.

---

## 3. HomeFeedService — Logique principale

```java
@Slf4j
@Service
@RequiredArgsConstructor
public class HomeFeedService {

    private final TagPointRepository tagPointRepo;
    private final ServiceRepository serviceRepo;
    private final UserRepository userRepo;

    private static final int[] RADIUS_STEPS = {50_000, 100_000, 200_000, 500_000};
    private static final int MIN_RESULTS = 3;

    public Map<String, Object> getFeed(Double lat, Double lng, String userId) {
        // 1. Charger données utilisateur (si connecté)
        List<String> userTags = List.of();
        Set<String> memberIds = Set.of();
        if (userId != null) {
            userTags = loadUserTags(userId);
            memberIds = loadMemberIds(userId);
        }

        // 2. Auto-expansion du rayon
        int actualRadius = RADIUS_STEPS[0];
        List<Map<String, Object>> rawSpots = List.of();
        List<Map<String, Object>> rawServices = List.of();

        for (int radius : RADIUS_STEPS) {
            actualRadius = radius;

            if (lat != null && lng != null) {
                rawSpots = tagPointRepo.findSpotsInRadius(lng, lat, radius, userId);
                rawServices = serviceRepo.findServicesInRadius(lng, lat, radius, userId);
            } else {
                rawSpots = tagPointRepo.findAllActiveSpots(userId);
                rawServices = serviceRepo.findAllActiveServices(userId);
            }

            // Batch is_going
            if (userId != null && !rawSpots.isEmpty()) {
                Set<String> goingIds = tagPointRepo.findGoingSpotIds(
                    rawSpots.stream().map(s -> (String)s.get("point_id")).toList(),
                    userId);
                rawSpots.forEach(s -> s.put("is_going", goingIds.contains(s.get("point_id"))));
            }

            if (rawSpots.size() + rawServices.size() >= MIN_RESULTS) break;
        }

        // 3. Scoring
        boolean hasPersonalization = !userTags.isEmpty() || !memberIds.isEmpty();
        List<Map<String, Object>> scoredSpots = scoreAndSortSpots(rawSpots, userTags, memberIds);
        List<Map<String, Object>> scoredServices = scoreAndSortServices(rawServices, userTags);

        // 4. Wrap coach object for services
        scoredServices.forEach(this::wrapCoachObject);

        return Map.of(
            "spotyou", scoredSpots.subList(0, Math.min(30, scoredSpots.size())),
            "services", scoredServices.subList(0, Math.min(20, scoredServices.size())),
            "actual_radius_km", actualRadius / 1000,
            "is_expanded", actualRadius > RADIUS_STEPS[0],
            "has_personalization", hasPersonalization,
            "total_count", scoredSpots.size() + scoredServices.size()
        );
    }

    // Scoring methods...
    private double scoreSpot(Map<String, Object> spot, List<String> userTags,
                             Set<String> memberIds, double maxDist, double maxPop) {
        double score = 0;
        // Tags communs (0-40)
        List<String> spotTags = parseTags(spot.get("tag_ids"));
        long common = spotTags.stream().filter(userTags::contains).count();
        score += Math.min(common * 20, 40);
        // Popularité (0-30)
        int pop = toInt(spot, "going_count") + toInt(spot, "participants_count");
        if (maxPop > 0) score += (pop / maxPop) * 30;
        // Distance (0-30)
        double dist = toDouble(spot, "distance", maxDist);
        if (maxDist > 0) score += ((maxDist - Math.min(dist, maxDist)) / maxDist) * 30;
        // Bonus membre
        if (memberIds.contains(spot.get("point_id"))) score += 20;
        return score;
    }
}
```

---

## 4. Auth optionnelle — Pattern Java

```java
@GetMapping("/home/feed")
public Map<String, Object> homeFeed(
        @RequestParam(required = false) Double lat,
        @RequestParam(required = false) Double lng,
        HttpServletRequest request) {

    // Auth optionnelle : extraire user_id du JWT si présent, null sinon
    String userId = null;
    try {
        Map<String, Object> payload = (Map<String, Object>) request.getAttribute("jwt_payload");
        if (payload != null) userId = (String) payload.get("user_id");
    } catch (Exception e) {
        // Pas d'auth → mode anonyme
    }

    return homeFeedService.getFeed(lat, lng, userId);
}
```

**Note** : Le `JwtAuthFilter` (S23) stocke le payload dans `request.setAttribute("jwt_payload", payload)`.
Pour l'auth optionnelle, on lit l'attribute sans lever d'exception si absent.

---

## 5. Pièges critiques

### P1 — `ST_MakePoint(lng, lat)` : ordre CRITIQUE

```
PostGIS : ST_MakePoint(x=longitude, y=latitude)
Le front envoie ?lat=48.8&lng=2.3
Le SQL reçoit : ST_MakePoint(2.3, 48.8)

PIÈGE : Inverser → l'utilisateur se retrouve au large de la Somalie au lieu de Paris.
Vérifier avec un test : distance Paris→Eiffel Tower ≈ 0 km.
```

### P2 — Auto-expansion : boucle avec requêtes coûteuses

```
Worst case : 4 itérations × (1 spot query + 1 service query + 1 is_going) = 12 queries.
Optimisation : les requêtes PostGIS avec index GiST sont rapides.
Mais si la base est volumineuse, considérer un cache ou une requête unique
avec ORDER BY LIMIT sans filtre rayon.

Recommandation : implémenter tel quel (compat Python), optimiser en P2.
```

### P3 — SQL dynamique conditionnel

```
Le SQL Python construit dynamiquement les conditions et positions $N.
En Java natif : utiliser des named parameters (:userId, :lng, :lat, :radius)
au lieu de positional. Plus lisible et moins error-prone.

Alternative : 2 requêtes @Query distinctes (avec geo / sans geo).
```

### P4 — JSONB tag_ids double parsing

```
Python fait json.loads si le champ est un string.
Java JPA peut retourner un String ou un List selon le driver/converter.
Tester avec les données réelles et ajouter un parsing défensif.
```

### P5 — `_score_spot` division par zéro

```
Python : max_pop et max_dist initialisés à `1` si 0 (via `or 1`).
Java : reproduire le guard `maxPop > 0 ? ... : 0`.
```

### P6 — nearest-sector retourne `null` (pas `{}`)

```
Python : return None → JSON null.
Java Spring : return null dans le controller → 200 avec body vide.
Pour compatibilité : ResponseEntity.ok(null) ou return null.
Vérifier que Jackson sérialise null correctement.
```

---

## 6. Critères de done

| # | Critère | Tests |
|---|---|---|
| D1 | GET /home/nearest-sector retourne le SpotYou le plus proche | TC-NS-01 |
| D2 | nearest-sector retourne null si aucun SpotYou | TC-NS-02 |
| D3 | nearest-sector exclut le user connecté | TC-NS-03 |
| D4 | GET /home/feed retourne SpotYou + Services triés par score | TC-FD-01 |
| D5 | Feed anonyme fonctionne (has_personalization=false) | TC-FD-02 |
| D6 | Feed sans coordonnées (pas de filtre géo) | TC-FD-03 |
| D7 | Auto-expansion 50→100→200→500 km | TC-FD-04, 05 |
| D8 | Scoring : tags communs priorisés | TC-FD-06 |
| D9 | Scoring : bonus membre | TC-FD-07 |
| D10 | is_going batch | TC-FD-08 |
| D11 | is_full calculation | TC-FD-09 |
| D12 | Exclut ses propres SpotYou/services | TC-FD-10 |
| D13 | Coach object wrapping dans services | TC-FD-11 |
| D14 | Limites 30/20 | TC-FD-12 |
| D15 | PostGIS ST_MakePoint(lng, lat) correct | Test distance |

---

## 7. Relation avec les Slices

| Slice | Interaction |
|---|---|
| S23 | JwtAuthFilter fournit jwt_payload pour l'auth optionnelle |
| S09 | GET /services (read) — S25 utilise un SQL similaire avec PostGIS |
| S27 | GET /tag-points (list) — réutilisera le même pattern PostGIS |
| S29 | POST /tag-points (create) — les nouveaux SpotYou apparaîtront dans le feed |
| S32 | POST /services (create) — les nouveaux services apparaîtront dans le feed |
