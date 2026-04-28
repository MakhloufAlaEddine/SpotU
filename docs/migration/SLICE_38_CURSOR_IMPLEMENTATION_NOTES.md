# SLICE_38_CURSOR_IMPLEMENTATION_NOTES.md — Notes Java/Spring Boot Marketplace Products
> Basé sur `routes/marketplace_routes.py:1–267`, BR-38.01 à BR-38.18.
> Généré le 2026-04-28.
>
> ⚠️ **Reproduire 1:1 le comportement Python.** Endpoint PUBLIC. Native queries obligatoires (PostGIS + opérateurs `&&` / `?|`).

---

## 1. Structure Spring Boot

```
src/main/java/com/spotu/marketplace/
├── controller/
│   └── MarketplaceProductController.java     ← GET /api/marketplace/products
├── service/
│   ├── MarketplaceProductService.java        ← orchestration
│   └── HaversineService.java                 ← util distance
├── repository/
│   ├── MarketplaceProductRepository.java     ← native queries
│   ├── ServiceRepository.java                ← reads services
│   ├── TagPointRepository.java               ← resolve spotyou_id (PostGIS)
│   └── ReviewRepository.java                 ← seller_stats ratings
├── dto/
│   ├── MarketplaceItemDto.java               ← record commun
│   ├── ProductRow.java                       ← native query result
│   ├── ServiceRow.java
│   ├── TagPointRow.java                      ← avec slat/slng
│   ├── SellerStatsDto.java
│   └── MarketplaceResponseDto.java           ← wrapper {products, count}
└── config/
    └── MarketplaceSecurityConfig.java        ← permitAll
```

---

## 2. Controller

```java
@RestController
@RequestMapping("/api/marketplace")
@RequiredArgsConstructor
public class MarketplaceProductController {

    private final MarketplaceProductService service;

    @GetMapping("/products")
    public MarketplaceResponseDto getProducts(
        @RequestParam(required = false) String tag_ids,
        @RequestParam(required = false) String spotyou_id,
        @RequestParam(required = false) Double user_lat,
        @RequestParam(required = false) Double user_lng
    ) {
        return service.getProducts(tag_ids, spotyou_id, user_lat, user_lng);
    }
}
```

> ⚠️ Noms de paramètres en **snake_case** (compat front mobile qui appelle avec `?tag_ids=...`).

---

## 3. SecurityConfig (PUBLIC)

```java
@Configuration
public class MarketplaceSecurityConfig {

    @Bean
    public SecurityFilterChain marketplaceFilterChain(HttpSecurity http) throws Exception {
        http.securityMatcher("/api/marketplace/**")
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        return http.build();
    }
}
```

> ⚠️ `permitAll()` strict (BR-38.01). Premier endpoint public.

---

## 4. Service principal

```java
@Service
@RequiredArgsConstructor
public class MarketplaceProductService {

    private final MarketplaceProductRepository productRepo;
    private final ServiceRepository serviceRepo;
    private final TagPointRepository tagPointRepo;
    private final ReviewRepository reviewRepo;

    @Qualifier("marketplaceExecutor")
    private final Executor executor;

    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public MarketplaceResponseDto getProducts(String tagIds, String spotyouId,
                                              Double userLat, Double userLng) {
        // ── 1. Parse tags
        boolean filterRequested = (tagIds != null) || (spotyouId != null);
        List<String> tags = parseCsv(tagIds);
        String ownerId = null;
        Double slat = null, slng = null;

        // ── 2. Resolve spotyou_id (BR-38.04)
        if (spotyouId != null) {
            Optional<TagPointRow> row = tagPointRepo.findById(spotyouId);
            if (row.isPresent()) {
                ownerId = row.get().userId();
                slat = row.get().slat();
                slng = row.get().slng();
                if (tags.isEmpty()) {
                    tags = deserializeTagIds(row.get().rawTagIds());
                }
            }
        }

        // ── 3. SELECT products
        List<Map<String, Object>> products;
        List<Map<String, Object>> services = new ArrayList<>();

        if (!tags.isEmpty()) {
            products = productRepo.findByTags(tags, ownerId);
            services = serviceRepo.findByTags(tags, ownerId);
        } else if (filterRequested) {
            products = List.of();
        } else {
            products = productRepo.findFeed(20);
        }

        // ── 4. Enrichissement products
        for (Map<String, Object> p : products) {
            p.put("item_type", "product");
            castPriceToFloat(p);
            applyDistanceToProduct(p, slat, slng, userLat, userLng);
            applyBadgeProduct(p, ownerId);
        }

        // ── 5. Enrichissement services
        for (Map<String, Object> s : services) {
            s.put("item_type", "service");
            s.put("is_physical", false);
            castPriceToFloat(s);
            deserializeJsonbStringList(s, "images");
            deserializeJsonbStringList(s, "tag_ids");
            applyBadgeService(s, ownerId);
        }

        // ── 6. Merge owner-first (BR-38.06)
        List<Map<String, Object>> allItems = new ArrayList<>();
        allItems.addAll(products);
        allItems.addAll(services);

        List<Map<String, Object>> ownerItems = allItems.stream()
            .filter(i -> "owner".equals(i.get("badge_type"))).toList();
        List<Map<String, Object>> otherItems = allItems.stream()
            .filter(i -> !"owner".equals(i.get("badge_type"))).toList();
        List<Map<String, Object>> items = new ArrayList<>(ownerItems);
        items.addAll(otherItems);

        // ── 7. Seller_stats parallèles (BR-38.15)
        Set<String> sids = items.stream()
            .map(i -> (String) (i.get("seller_id") != null ? i.get("seller_id") : i.get("coach_id")))
            .filter(Objects::nonNull).collect(Collectors.toSet());

        if (!sids.isEmpty()) {
            attachSellerStats(items, new ArrayList<>(sids));
        }

        return new MarketplaceResponseDto(items, items.size());
    }

    // ── Helpers
    private void attachSellerStats(List<Map<String, Object>> items, List<String> sids) {
        CompletableFuture<Map<String, Map<String,Object>>> fR =
            CompletableFuture.supplyAsync(() -> reviewRepo.findRatings(sids), executor);
        CompletableFuture<Map<String, Integer>> fP =
            CompletableFuture.supplyAsync(() -> productRepo.countBySeller(sids), executor);
        CompletableFuture<Map<String, Integer>> fS =
            CompletableFuture.supplyAsync(() -> serviceRepo.countActiveByCoach(sids), executor);
        CompletableFuture<Map<String, Integer>> fT =
            CompletableFuture.supplyAsync(() -> tagPointRepo.countByUser(sids), executor);

        CompletableFuture.allOf(fR, fP, fS, fT).join();

        Map<String, Map<String,Object>> ratingMap = fR.join();
        Map<String, Integer> prodMap = fP.join();
        Map<String, Integer> svcMap  = fS.join();
        Map<String, Integer> spotMap = fT.join();

        for (Map<String, Object> it : items) {
            String sid = (String) (it.get("seller_id") != null ? it.get("seller_id") : it.get("coach_id"));
            Map<String,Object> rd = sid != null ? ratingMap.get(sid) : null;
            it.put("seller_stats", Map.of(
                "rating_avg",     rd != null ? rd.get("avg")   : null,
                "rating_count",   rd != null ? rd.get("count") : 0,
                "products_count", prodMap.getOrDefault(sid, 0),
                "services_count", svcMap.getOrDefault(sid, 0),
                "spotyou_count",  spotMap.getOrDefault(sid, 0)
            ));
        }
    }

    // (autres helpers : parseCsv, deserializeTagIds, applyDistanceToProduct, etc.)
}
```

---

## 5. Repositories — native queries critiques

### MarketplaceProductRepository

```java
public interface MarketplaceProductRepository extends Repository<Object, String> {

    // Mode feed
    @Query(value = """
        SELECT p.*, u.name AS seller_name, u.picture AS seller_picture, u.picture AS seller_picture_url
          FROM marketplace_products p
          LEFT JOIN users u ON p.seller_id = u.user_id
         WHERE p.status = 'active'
         ORDER BY p.created_at DESC
         LIMIT :limit
    """, nativeQuery = true)
    List<Map<String,Object>> findFeed(@Param("limit") int limit);

    // Filtre tags (array overlap `&&`)
    @Query(value = """
        SELECT p.*, u.name AS seller_name, u.picture AS seller_picture, u.picture AS seller_picture_url
          FROM marketplace_products p
          LEFT JOIN users u ON p.seller_id = u.user_id
         WHERE p.tag_ids && CAST(:tags AS text[])
           AND p.status = 'active'
         ORDER BY CASE WHEN p.seller_id = :ownerId THEN 0 ELSE 1 END, p.created_at DESC
    """, nativeQuery = true)
    List<Map<String,Object>> findByTags(@Param("tags") String[] tags,
                                          @Param("ownerId") String ownerId);

    // Counts
    @Query(value = "SELECT seller_id, COUNT(*) AS cnt FROM marketplace_products WHERE seller_id = ANY(CAST(:sids AS text[])) GROUP BY seller_id",
           nativeQuery = true)
    List<Object[]> countBySellerRaw(@Param("sids") String[] sids);

    default Map<String, Integer> countBySeller(List<String> sids) {
        return countBySellerRaw(sids.toArray(new String[0])).stream()
            .collect(Collectors.toMap(r -> (String)r[0], r -> ((Number)r[1]).intValue()));
    }
}
```

### ServiceRepository

```java
@Query(value = """
    SELECT s.service_id, s.coach_id, s.title, s.description,
           s.price, s.duration_min, s.images, s.tag_ids,
           s.location_description, s.address,
           u.name AS coach_name, u.picture AS coach_picture
      FROM services s
      LEFT JOIN users u ON s.coach_id = u.user_id
     WHERE s.active = TRUE
       AND s.tag_ids ?| CAST(:tags AS text[])
     ORDER BY CASE WHEN s.coach_id = :ownerId THEN 0 ELSE 1 END, s.created_at DESC
     LIMIT 20
""", nativeQuery = true)
List<Map<String,Object>> findByTags(@Param("tags") String[] tags, @Param("ownerId") String ownerId);
```

> ⚠️ **Opérateur `?|` JSONB any-key**. Hibernate/JPA peut interpréter `?` comme un placeholder de paramètre. **Échapper en doublant** : `??|` ou utiliser `jsonb_path_ops` selon version JPA. **Tester dans un test d'intégration.**

### TagPointRepository (PostGIS)

```java
@Query(value = """
    SELECT tag_ids, user_id,
           ST_Y(location::geometry) AS slat,
           ST_X(location::geometry) AS slng
      FROM tag_points
     WHERE point_id = :id
""", nativeQuery = true)
Optional<Map<String,Object>> findByPointIdRaw(@Param("id") String pointId);

default Optional<TagPointRow> findById(String pointId) {
    return findByPointIdRaw(pointId).map(m -> new TagPointRow(
        (String) m.get("user_id"),
        ((Number) m.get("slat")).doubleValue(),
        ((Number) m.get("slng")).doubleValue(),
        m.get("tag_ids")
    ));
}
```

### ReviewRepository

```java
@Query(value = """
    SELECT reviewee_id,
           ROUND(AVG(rating)::numeric, 1) AS avg_r,
           COUNT(*) AS cnt_r
      FROM reviews
     WHERE reviewee_id = ANY(CAST(:sids AS text[]))
     GROUP BY reviewee_id
""", nativeQuery = true)
List<Object[]> findRatingsRaw(@Param("sids") String[] sids);

default Map<String, Map<String,Object>> findRatings(List<String> sids) {
    return findRatingsRaw(sids.toArray(new String[0])).stream()
        .collect(Collectors.toMap(
            r -> (String) r[0],
            r -> Map.of("avg", ((BigDecimal) r[1]).doubleValue(), "count", ((Number) r[2]).intValue())
        ));
}
```

---

## 6. Helpers calcul

```java
@Service
public class HaversineService {

    private static final double R_KM = 6371;

    public static double haversineKm(double lat1, double lon1, double lat2, double lon2) {
        double dlat = Math.toRadians(lat2 - lat1);
        double dlon = Math.toRadians(lon2 - lon1);
        double a = Math.pow(Math.sin(dlat / 2), 2)
                 + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                 * Math.pow(Math.sin(dlon / 2), 2);
        double km = R_KM * 2 * Math.asin(Math.sqrt(a));
        return Math.round(km * 10) / 10.0;  // 1 decimal
    }

    public static String fmtDist(double km) {
        if (km < 1) return ((int)(km * 1000)) + " m";
        return String.format(Locale.ROOT, "%.1f km", km);
    }
}
```

---

## 7. Configuration Executor pour parallélisme

```java
@Configuration
public class MarketplaceAsyncConfig {
    @Bean(name = "marketplaceExecutor")
    public Executor marketplaceExecutor() {
        ThreadPoolTaskExecutor exec = new ThreadPoolTaskExecutor();
        exec.setCorePoolSize(8);
        exec.setMaxPoolSize(16);
        exec.setQueueCapacity(100);
        exec.setThreadNamePrefix("marketplace-stats-");
        exec.initialize();
        return exec;
    }
}
```

> ⚠️ Sans threadpool dédié, `CompletableFuture.supplyAsync` utilise `ForkJoinPool.commonPool` qui peut être saturé.

---

## 8. Configuration Jackson (réutilise S34)

Identique à S34 : snake_case, `+00:00` datetime, BigDecimal-as-plain.

---

## 9. Pièges à éviter

| # | Piège | Mitigation |
|---|---|---|
| 1 | Ajouter `require_auth` (compat S34 réutilisé par erreur) | NON. Endpoint PUBLIC (BR-38.01). |
| 2 | Retourner liste directe au lieu de wrapper `{products, count}` | Wrapper obligatoire (BR-38.17). |
| 3 | Inverser opérateurs tags (`&&` services / `?|` products) | Reproduire syntaxe exacte (BR-38.04). |
| 4 | Implémenter en JPQL/Criteria au lieu de native query | Native obligatoire (PostGIS + array operators). |
| 5 | Calculer distance pour services avec address | NON. Services toujours `is_physical=false` (BR-38.10). |
| 6 | Ajouter pagination quand tags fournis | NON (BR-38.13). |
| 7 | Filtrer `products_count` par `status='active'` | NON, count tous (BR-38.15). |
| 8 | Oublier `seller_picture_url` doublon | Reproduire (BR-38.14). |
| 9 | Format datetime `Z` au lieu de `+00:00` | Configurer Jackson. |
| 10 | Locale-dependent format distance (virgule au lieu de point) | Locale.ROOT (BR-38.11). |
| 11 | Pas de parallélisme stats → 4x lent | CompletableFuture obligatoire (BR-38.15). |
| 12 | Renvoyer 404 si spotyou_id invalide | NON, renvoyer `{[], 0}` (BR-38.05). |
| 13 | Ne pas reproduire le 2-niveau owner-first (SQL + applicatif) | 2 niveaux (BR-38.06). |
| 14 | Default badge_label uniforme (pas "SpotU" / "Coach") | Asymétrie (BR-38.07). |
| 15 | Appliquer `MAX_DIST_KM=40` filter | NON, constante non utilisée (BR-38.16). |
| 16 | Mode feed avec services | NON, mode feed = produits seulement (BR-38.03). |
| 17 | Désérialiser `tag_ids` products comme string JSON | NON, c'est TEXT[] natif (BR-38.12 services seulement). |

---

## 10. Critères de Done

| # | Critère | Test |
|---|---|---|
| 1 | Endpoint PUBLIC accessible sans JWT | T38-24 |
| 2 | Mode feed (sans param) → 20 products | T38-01 |
| 3 | Mode feed sans services | T38-01 |
| 4 | Filtre tags products `&&` array | T38-04 |
| 5 | Filtre tags services `?|` JSONB | T38-05 |
| 6 | spotyou_id valide → resolve owner+GPS+tags | T38-08 |
| 7 | spotyou_id invalide → liste vide | T38-09 |
| 8 | Tags utilisateur prioritaires sur tag_points | T38-10 |
| 9 | Distance Haversine R=6371, round 1 décimale | T38-11 |
| 10 | fmt_dist < 1 km en mètres | T38-12 |
| 11 | fmt_dist Locale.ROOT (point décimal) | T38-12 |
| 12 | Services `is_physical=false` toujours | T38-16 |
| 13 | Owner-first 2 niveaux (SQL + applicatif post-merge) | T38-17 |
| 14 | seller_stats 4 SELECT parallèles | T38-18, T38-20 |
| 15 | products_count sans filtre status | BR-38.15 |
| 16 | services_count avec active=TRUE | BR-38.15 |
| 17 | tag_ids services désérialisé conditionnel | T38-21 |
| 18 | images services désérialisé conditionnel | T38-22 |
| 19 | Wrapper `{products, count}` | T38-29 |
| 20 | seller_picture + seller_picture_url doublon | T38-28 |
| 21 | Format datetime `+00:00` | T38-26 |
| 22 | price number JSON (pas string) | T38-27 |
| 23 | Default badge_label "SpotU" / "Coach" | BR-38.07 |

---

## 11. Validation finale

- [ ] 30 cas T38 passent
- [ ] Test PostGIS : `tag_points.location` extract `slat`/`slng` correct
- [ ] Test perf : 4 SELECT seller_stats < 100ms en parallèle
- [ ] Test snapshot diff : capturer une réponse Python prod-like et asserter `JSONAssert STRICT`
- [ ] Test charset UTF-8 (titres avec emojis 🚲, accents)
- [ ] Test 100+ products simultanés (pas de pagination donc payload large)

---

## 12. Roadmap S38 → S39+

| Slice | Contenu |
|---|---|
| **S38 (cette slice)** | Marketplace products LIST (lecture publique) |
| **S39** | `POST /bookings/{id}/cancel` (recommandation antérieure) OU writes marketplace |
| **S40+** | Routes création produit (`product_creation_routes.py` 567 lignes) |
| **S41+** | Routes admin produit (`admin_product_routes.py` 206 lignes) |

> **Recommandation** : enchaîner sur **booking cancel (S39)** pour finir le parcours buyer avant de plonger dans les writes marketplace (gros chantier).
