# SLICE_26_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation Cursor
> Généré le 2026-04-15.

---

## Objectif

Créer le `TagPointReadController` Java (7 endpoints lecture), le `TagPointReadService` (logique),
et les repositories avec queries PostGIS natives. Après S26, l'utilisateur peut rechercher, consulter
le détail, et naviguer dans les SpotYou.

---

## 1. Architecture Java cible

```
src/main/java/com/spotu/
├── controller/
│   └── TagPointReadController.java        ← 🔴 S26 (7 endpoints)
├── service/
│   ├── TagPointReadService.java           ← 🔴 S26 (logique + scoring)
│   ├── NextSessionDateCalculator.java     ← 🔴 S26 (import spot_you_routes)
│   └── PrecisionMaskingService.java       ← 🔴 S26 (offset + address masking)
├── repository/
│   ├── TagPointRepository.java            ← 🔴 S26 (native PostGIS queries)
│   ├── SpotYouMemberRepository.java       ← 🔴 S26 (membership queries)
│   └── SpotYouAttendanceRepository.java   ← 🔴 S26 (going queries)
├── model/
│   └── TagPoint.java                      ← 🔴 S26 (entity JPA)
```

---

## 2. Détail endpoint — Queries parallèles en Java

### Option A : CompletableFuture (parallèle, complexe)

```java
CompletableFuture<List<Map>> tagsFuture = CompletableFuture.supplyAsync(() -> tagRepo.findTagLabels(tagIds));
CompletableFuture<Map> voteStatsFuture = CompletableFuture.supplyAsync(() -> voteRepo.findStats(pointId));
CompletableFuture<Map> voteDistFuture = CompletableFuture.supplyAsync(() -> voteRepo.findDistribution(pointId));
CompletableFuture<Integer> memberCountFuture = CompletableFuture.supplyAsync(() -> memberRepo.countAccepted(pointId));

CompletableFuture.allOf(tagsFuture, voteStatsFuture, voteDistFuture, memberCountFuture).join();
```

**PIÈGE** : les méthodes JPA Repository sont liées au thread appelant (EntityManager).
En `@Async` ou `CompletableFuture.supplyAsync()`, chaque thread a besoin de son propre `EntityManager`.
Utiliser `@Transactional(readOnly = true)` sur chaque méthode repository OU un `TaskExecutor` configuré.

### Option B : Séquentiel (simple, compatible)

```java
var tags = tagRepo.findTagLabels(tagIds);
var voteStats = voteRepo.findStats(pointId);
var voteDist = voteRepo.findDistribution(pointId);
var memberCount = memberRepo.countAccepted(pointId);
```

**Recommandation** : Option B pour la v1 (compatibilité, simplicité, pas de risque threading).
L'overhead séquentiel est ~10-20ms par query (acceptable pour un détail).

---

## 3. Search — SQL dynamique en Java

### Pattern : StringBuilder + named parameters

```java
public List<Map<String, Object>> searchSpots(Double lat, Double lng, Integer radius,
                                              String domainId, List<String> tagIds,
                                              String currentUserId) {
    StringBuilder sql = new StringBuilder("SELECT ");
    sql.append(TP_FIELDS);
    Map<String, Object> params = new HashMap<>();

    List<String> conditions = new ArrayList<>();
    conditions.add("tp.active = TRUE");

    if (currentUserId != null) {
        conditions.add("tp.user_id != :userId");
        params.put("userId", currentUserId);
    }
    if (lat != null && lng != null) {
        conditions.add("ST_DWithin(tp.location::geography, " +
            "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius)");
        params.put("lng", lng); params.put("lat", lat); params.put("radius", radius);
        sql.append(", ST_Distance(tp.location::geography, " +
            "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) as distance");
    }
    if (domainId != null) {
        conditions.add("tp.domain_id = :domainId");
        params.put("domainId", domainId);
    }
    if (tagIds != null && !tagIds.isEmpty()) {
        conditions.add("tp.tag_ids ?| array[:tagIds]");
        params.put("tagIds", tagIds);
    }

    sql.append(" FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id WHERE ");
    sql.append(String.join(" AND ", conditions));

    if (lat != null && lng != null) {
        sql.append(" ORDER BY tp.location::geography <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography");
    }
    sql.append(" LIMIT 200");

    // Execute with NamedParameterJdbcTemplate
    return namedJdbc.queryForList(sql.toString(), params);
}
```

**PIÈGE `?|` operator** : Le `?` character est un JDBC placeholder. Utiliser un **backslash** ou **NamedParameterJdbcTemplate** pour éviter le conflit. Alternative : `tag_ids @> ANY(...)`.

---

## 4. PrecisionMaskingService

```java
@Service
public class PrecisionMaskingService {

    public double[] applyOffset(double lat, double lng, String precision, String seed) {
        if ("exact".equals(precision) || precision == null) return new double[]{lat, lng};

        int radiusM = "100m".equals(precision) ? 100 : "1000m".equals(precision) ? 1000 : 0;
        if (radiusM == 0) return new double[]{lat, lng};

        // Deterministic random from seed
        Random rng = new Random(seed != null ? seed.hashCode() : 0);
        double angle = rng.nextDouble() * 2 * Math.PI;
        double distance = radiusM * Math.sqrt(rng.nextDouble());

        double latOffset = (distance * Math.cos(angle)) / 111320.0;
        double lngOffset = (distance * Math.sin(angle)) / (111320.0 * Math.cos(Math.toRadians(lat)));

        return new double[]{lat + latOffset, lng + lngOffset};
    }

    public String maskAddress(String address, String precision) {
        // Reproduire _mask_address de service_routes.py
        // "exact" → full, "100m" → mask number, "1000m" → mask number+street
        ...
    }
}
```

---

## 5. NextSessionDateCalculator

```java
@Service
public class NextSessionDateCalculator {
    /**
     * Calcule la prochaine date de session pour un SpotYou.
     * Logique importée de spot_you_routes.get_next_session_date().
     * Analyse schedule (JSONB) et event_date pour déterminer la prochaine occurrence.
     */
    public LocalDate getNextSessionDate(Map<String, Object> point) {
        // event_date → si futur, c'est la prochaine session
        // schedule → analyser les jours de la semaine récurrents
        // Timezone : Europe/Paris
        ...
    }
}
```

**Note** : cette logique doit être auditée depuis `spot_you_routes.py:get_next_session_date()`.
C'est un import cross-module — documenter la logique exacte est hors scope S26 mais la dépendance
doit être reproduite.

---

## 6. Pièges critiques

### P1 — `?|` JSONB operator vs JDBC `?` placeholder

```
PostgreSQL : tag_ids ?| ARRAY['tag_001', 'tag_002']
JDBC : ? est un placeholder positionnel
Conflit : le parser JDBC interprète ? comme un paramètre

Solutions :
a) NamedParameterJdbcTemplate avec :tagIds (pas de ?)
b) Escaper : tag_ids \\?| ARRAY[...]
c) Réécrire : EXISTS(SELECT 1 FROM jsonb_array_elements_text(tag_ids) t WHERE t = ANY(:tags))
Recommandation : option (c) pour éviter tout conflit.
```

### P2 — Precision offset : hashCode Python != Java

```
Python : random.seed(hash("sp_abc123")) → hash Python64
Java : new Random("sp_abc123".hashCode()) → hashCode Java32
Les offsets seront DIFFÉRENTS entre Python et Java.
Acceptable : l'offset est approximatif (privacy).
```

### P3 — asyncio.gather → séquentiel ou CompletableFuture

```
Python detail fait 4+3 queries en parallèle.
Java sans async → séquentiel (10-20ms overhead).
Java avec CompletableFuture → parallèle mais EntityManager threading issues.
Recommandation : séquentiel pour v1.
```

### P4 — TP_FIELDS sous-requêtes corrélées

```
Les 3 sous-requêtes (AVG rating, COUNT votes, COUNT members) dans TP_FIELDS
sont exécutées pour CHAQUE ligne. Pour une liste de 200 items → 600 sous-requêtes.
En Java native query : reproduire tel quel.
Optimisation future : JOIN ou subquery dans FROM.
```

### P5 — get_next_session_date import cross-module

```
La logique de calcul de prochaine session est dans spot_you_routes.py.
En Java : créer NextSessionDateCalculator comme service indépendant.
Nécessite un audit séparé de la logique (schedule parsing, timezone Europe/Paris).
```

---

## 7. Critères de done

| # | Critère | Tests |
|---|---|---|
| D1 | GET /tag-points search avec PostGIS + filtres | TC-SR-01 à 04 |
| D2 | Search exclut ses propres SpotYou si connecté | TC-SR-05 |
| D3 | Precision offset appliqué pour non-owners | TC-SR-07 |
| D4 | GET /tag-points/mine enrichi (batch queries) | TC-MY-01 |
| D5 | GET /tag-points/saved enrichi | TC-SV-01 |
| D6 | GET /tag-points/{id} détail complet (8 queries) | TC-DT-01, 02 |
| D7 | Détail : inactive → 404 pour non-owner, 200 pour owner | TC-DT-05, 06 |
| D8 | Détail : join_status, is_going, is_saved | TC-DT-02, 03, 08 |
| D9 | GET /similar : tags OR distance < 10km | TC-SM-01 |
| D10 | GET /participants : créateur en premier | TC-PT-01 |
| D11 | GET /pending-requests enrichi | TC-PR-01 |
| D12 | build_point_response : owner object, address mask, GeoJSON | Tous |

---

## 8. Relation avec les Slices

| Slice | Interaction |
|---|---|
| S23 | Auth optionnelle + require_auth |
| S25 | Home feed utilise un SQL similaire pour SpotYou (TP_FIELDS subset) |
| S27 (futur) | Notifications — réutilise les mêmes tables |
| S28 (futur) | SpotYou CRUD — réutilise build_point_response, TP_FIELDS, precision |
| S29 (futur) | SpotYou join/invite — réutilise membership queries |
