# SLICE_42_CURSOR_IMPLEMENTATION_NOTES.md — Notes implémentation Cursor (Java/Spring)
> Basé sur `routes/service_routes.py:1–754` + slices précédentes (S23 auth, S25 home feed PostGIS, S38–S41 marketplace patterns).
> Généré le 2026-04-30.

---

## 1. Squelette Spring Boot

### Package
```
com.spotyou.service.read
├── controller/ServiceReadController.java
├── service/ServiceQueryService.java
├── service/ServiceEnrichmentService.java          # _batch_enrich_*
├── service/AddressMaskingService.java             # _mask_address
├── repository/ServiceRepository.java
├── repository/ServiceLocationRepository.java
├── repository/ServiceSlotRepository.java
├── repository/ServicePackageRepository.java
├── repository/ServiceSaveRepository.java
├── repository/ReviewRepository.java                # AVG/COUNT par reviewee
├── repository/UserBatchRepository.java             # SELECT user_id WHERE = ANY
├── repository/TagBatchRepository.java              # SELECT tag_id WHERE = ANY
├── dto/ServiceDto.java                             # vue search/mine/detail enrichie
├── dto/SavedServiceDto.java                        # vue saved plate (DISTINCT)
├── dto/DeactivatedServiceDto.java                  # vue deactivated avec lifecycle
├── dto/CoachLite.java                              # {user_id, name, picture, is_coach_verified}
├── dto/LocationDto.java
├── dto/SlotDto.java
├── dto/PackageDto.java
└── dto/TagDto.java
```

### Controller mappings

```java
@RestController
@RequestMapping("/api/services")
@RequiredArgsConstructor
public class ServiceReadController {

    private final ServiceQueryService queryService;

    @GetMapping
    public List<ServiceDto> search(
            @RequestParam(required = false) Double lat,
            @RequestParam(required = false) Double lng,
            @RequestParam(required = false, defaultValue = "10000") Integer radius,
            @RequestParam(required = false) String coach_id,
            @RequestParam(required = false) String domain_id,
            HttpServletRequest request) {
        String currentUserId = jwtService.tryExtractUserId(request);  // null si absent/invalide
        return queryService.search(currentUserId, lat, lng, radius, coach_id, domain_id);
    }

    @GetMapping("/mine")
    public List<ServiceDto> mine(@AuthenticationPrincipal AuthUser user) {
        return queryService.mine(user.userId());
    }

    @GetMapping("/saved")
    public List<SavedServiceDto> saved(@AuthenticationPrincipal AuthUser user) {
        return queryService.saved(user.userId());
    }

    @GetMapping("/deactivated")
    public List<DeactivatedServiceDto> deactivated(@AuthenticationPrincipal AuthUser user) {
        return queryService.deactivated(user.userId());
    }

    @GetMapping("/{serviceId}")
    public ServiceDto detail(@PathVariable String serviceId, HttpServletRequest request) {
        Optional<AuthUser> viewer = jwtService.tryExtractUser(request);
        return queryService.detail(serviceId, viewer);
    }
}
```

> ⚠️ `search` et `detail` sont **publics** (`permitAll`). Les 3 autres → `authenticated()`.

---

## 2. Spring Security config

```java
.requestMatchers(HttpMethod.GET, "/api/services").permitAll()
.requestMatchers(HttpMethod.GET, "/api/services/{serviceId:[a-zA-Z0-9_-]+}").permitAll()
.requestMatchers("/api/services/mine", "/api/services/saved", "/api/services/deactivated").authenticated()
```

> ⚠️ Spécifier le pattern `{serviceId}` strict pour éviter que `/services/mine` matche `/services/{id}` accidentellement (ordre de matching Spring).

---

## 3. Service — `search`

```java
@Transactional(readOnly = true)
public List<ServiceDto> search(String currentUserId, Double lat, Double lng,
                               Integer radius, String coachId, String domainId) {
    // 1. Build dynamic SQL
    StringBuilder sql = new StringBuilder("SELECT " + SVC_FIELDS + " FROM services WHERE active = TRUE");
    Map<String, Object> params = new HashMap<>();

    if (currentUserId != null) { sql.append(" AND coach_id != :currentUserId"); params.put("currentUserId", currentUserId); }
    if (lat != null && lng != null) {
        sql.append(" AND EXISTS (SELECT 1 FROM service_locations sl WHERE sl.service_id = services.service_id ")
           .append("AND ST_DWithin(sl.location::geography, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius))");
        params.put("lng", lng); params.put("lat", lat); params.put("radius", radius);
    }
    if (coachId != null) { sql.append(" AND coach_id = :coachId"); params.put("coachId", coachId); }
    if (domainId != null) { sql.append(" AND domain_id = :domainId"); params.put("domainId", domainId); }
    sql.append(" LIMIT 100");

    // 2. Execute + map
    List<ServiceLite> rows = jdbc.query(sql.toString(), params, serviceLiteMapper);
    List<ServiceDto> services = rows.stream().map(this::buildService).toList();

    // 3. Batch enrich (4 queries //)
    return enrichmentService.enrichForSearch(services);
}
```

> ⚠️ **PIÈGE-DB-01** résolu : `services.service_id` qualifié explicitement pour lever l'ambiguïté de l'EXISTS.

---

## 4. Service — `mine` / `detail` (réutilise enrich owner)

```java
@Transactional(readOnly = true)
public List<ServiceDto> mine(String userId) {
    List<ServiceLite> rows = jdbc.query(
        "SELECT " + SVC_FIELDS + " FROM services WHERE coach_id = :uid AND active = TRUE ORDER BY created_at DESC",
        Map.of("uid", userId), serviceLiteMapper);
    List<ServiceDto> services = rows.stream().map(this::buildService).toList();
    return enrichmentService.enrichForOwner(services);
}

@Transactional(readOnly = true)
public ServiceDto detail(String serviceId, Optional<AuthUser> viewer) {
    ServiceLite row = jdbc.query(
        "SELECT " + SVC_FIELDS + " FROM services WHERE service_id = :id",
        Map.of("id", serviceId), serviceLiteMapper).stream().findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service not found"));
    ServiceDto svc = buildService(row);

    boolean isOwner = viewer.isPresent()
        && (viewer.get().userId().equals(svc.coachId()) || "admin".equals(viewer.get().role()));

    List<ServiceDto> enriched = enrichmentService.enrichForOwner(List.of(svc));
    ServiceDto result = enriched.get(0);
    result.setIsOwner(isOwner);
    if (!isOwner) {
        result.setOriginalAddress(null);
        if (result.getLocations() != null) {
            result.getLocations().forEach(l -> l.setOriginalDescription(null));
        }
    }
    return result;
}
```

> ⚠️ `ResponseStatusException` produit `{"detail":"Service not found"}` côté Spring 6 (compat Python HTTPException).

---

## 5. Enrichment service — pattern parallèle

```java
@Service
@RequiredArgsConstructor
public class ServiceEnrichmentService {

    private final UserBatchRepository userRepo;
    private final ServiceLocationRepository locationRepo;
    private final ReviewRepository reviewRepo;
    private final TagBatchRepository tagRepo;
    private final ServiceSlotRepository slotRepo;
    private final ServicePackageRepository packageRepo;
    private final AddressMaskingService maskingService;

    @Async("dbReadExecutor")
    public CompletableFuture<...> fetchAsync(...) { ... }

    /** Enrichment pour search — 4 queries parallèles */
    public List<ServiceDto> enrichForSearch(List<ServiceDto> services) {
        if (services.isEmpty()) return services;
        List<String> svcIds = services.stream().map(ServiceDto::serviceId).toList();
        Set<String> coachIds = services.stream().map(ServiceDto::coachId).filter(Objects::nonNull).collect(Collectors.toSet());
        Set<String> tagIds = services.stream()
            .flatMap(s -> s.tagIds() == null ? Stream.empty() : s.tagIds().stream())
            .collect(Collectors.toSet());

        var coachesF = CompletableFuture.supplyAsync(() -> userRepo.findByIds(coachIds));
        var locationsF = CompletableFuture.supplyAsync(() -> locationRepo.findByServiceIds(svcIds));
        var reviewsF = CompletableFuture.supplyAsync(() -> reviewRepo.aggregateByRevieweeIds(coachIds));
        var tagsF = CompletableFuture.supplyAsync(() -> tagRepo.findByIds(tagIds));

        CompletableFuture.allOf(coachesF, locationsF, reviewsF, tagsF).join();

        // Assemble → return services with slots=[], packages=[], is_owner=false
        return assembleSearch(services, coachesF.get(), locationsF.get(), reviewsF.get(), tagsF.get());
    }

    /** Enrichment pour mine + detail — 6 queries // + 1 séq */
    public List<ServiceDto> enrichForOwner(List<ServiceDto> services) {
        if (services.isEmpty()) return services;
        // ... 6 queries // (+ slots + packages)
        var slotsF = CompletableFuture.supplyAsync(() -> slotRepo.findAvailableByServiceIds(svcIds));
        var packagesF = CompletableFuture.supplyAsync(() -> packageRepo.findByServiceIds(svcIds));
        // ... join
        // Puis query séquentielle
        List<String> pkgIds = packagesF.get().stream().map(PackageDto::packageId).toList();
        List<PackageSlotRow> pkgSlots = pkgIds.isEmpty() ? List.of() : slotRepo.findAvailableByPackageIds(pkgIds);
        // Assemble avec is_owner=true, original_address exposé
        return assembleOwner(services, ...);
    }
}
```

### `dbReadExecutor` config
```java
@Bean
@ConfigurationProperties("app.db-read-executor")
public ThreadPoolTaskExecutor dbReadExecutor() {
    var executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(8);
    executor.setMaxPoolSize(16);
    executor.setQueueCapacity(100);
    executor.setThreadNamePrefix("db-read-");
    return executor;
}
```

---

## 6. AddressMaskingService

Port octet-pour-octet du Python (l. 68–112). Tester avec les exemples du fichier Python.

```java
@Service
public class AddressMaskingService {
    private static final Set<String> COUNTRY_NAMES = Set.of("france","francia","frankreich","fr");

    public String mask(String description, String precision) {
        if (description == null || description.isEmpty() || "exact".equals(precision)) return description;
        if ("1000m".equals(precision)) return mask1000m(description);
        if ("100m".equals(precision)) return mask100m(description);
        return description;
    }

    private String mask1000m(String d) { /* split "," + walk backwards skipping countries */ }
    private String mask100m(String d) { /* regex "^\d+\s*" remove leading number */ }
}
```

---

## 7. Repositories — SQL exacts

### ServiceSlotRepository.findAvailableByServiceIds

```java
private static final String SQL = """
    SELECT service_id, slot_id, slot_type, slot_status, location_id, package_id,
           day_of_week, days_of_week, start_time, end_time, slot_date
    FROM service_slots ss
    WHERE ss.service_id = ANY(:svcIds::text[])
      AND (
          ss.slot_date IS NULL
          OR (ss.slot_date || ' ' || ss.start_time)::timestamp > NOW()::timestamp
      )
      AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.slot_id = ss.slot_id
          AND b.status IN ('pending','accepted','awaiting_payment','confirmed')
      )
    ORDER BY ss.slot_date NULLS LAST, ss.start_time
    """;

public List<SlotRow> findAvailableByServiceIds(List<String> svcIds) {
    return jdbc.query(SQL, new MapSqlParameterSource("svcIds", svcIds.toArray(new String[0])), slotMapper);
}
```

> ⚠️ **Préserver SQL exact** (concaténation date+time + cast timestamp). Ne pas optimiser.

### Saved query — JSON inline mapping

```java
private static final String SQL_SAVED = """
    SELECT s.service_id, s.title, s.price, s.images, s.address, s.location_description,
           s.duration_min, ss.saved_at,
           json_build_object('user_id', u.user_id, 'name', u.name, 'picture', u.picture) as coach,
           (SELECT json_agg(json_build_object('latitude', ST_Y(sl.location), 'longitude', ST_X(sl.location)))
            FROM service_locations sl WHERE sl.service_id = s.service_id) as locations,
           (SELECT COUNT(*) FROM service_slots slt
            WHERE slt.service_id = s.service_id
              AND slt.slot_status = 'available'
              AND slt.slot_date >= TO_CHAR(NOW(), 'YYYY-MM-DD')) as available_slots
    FROM service_saves ss
    JOIN services s ON ss.service_id = s.service_id
    JOIN users u ON s.coach_id = u.user_id
    WHERE ss.user_id = :uid
    ORDER BY ss.saved_at DESC
    """;

public List<SavedServiceDto> findSavedByUserId(String userId) {
    return jdbc.query(SQL_SAVED, Map.of("uid", userId), (rs, n) -> {
        SavedServiceDto dto = new SavedServiceDto();
        dto.setServiceId(rs.getString("service_id"));
        // ... champs simples
        // Coach JSON inline → parsing manuel
        String coachJson = rs.getString("coach");
        dto.setCoach(coachJson != null ? mapper.readValue(coachJson, CoachLite.class) : null);
        // Locations JSON agg → première location
        String locsJson = rs.getString("locations");
        if (locsJson != null) {
            List<Map<String,Object>> locs = mapper.readValue(locsJson, new TypeReference<>() {});
            if (!locs.isEmpty()) {
                dto.setLatitude(((Number)locs.get(0).get("latitude")).doubleValue());
                dto.setLongitude(((Number)locs.get(0).get("longitude")).doubleValue());
            }
        }
        dto.setAvailableSlots(rs.getInt("available_slots"));
        // images parsing dual
        Object rawImages = rs.getObject("images");
        dto.setImages(parseImages(rawImages));
        return dto;
    });
}
```

> ⚠️ **JSON inline** : Java `getString("coach")` retourne la string JSON. `mapper.readValue` côté row mapper.

---

## 8. SVC_FIELDS — constante partagée

```java
public static final String SVC_FIELDS = """
    service_id, coach_id, title, description, address, price, duration_min,
    tag_ids, domain_id, location_description, max_participants, active, images, created_at, updated_at,
    booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
    """;
```

Utilisée dans 4 SELECT (search, mine, deactivated, detail).

---

## 9. DTOs

```java
public record ServiceDto(
    @JsonProperty("service_id") String serviceId,
    @JsonProperty("coach_id") String coachId,
    String title, String description, String address,
    BigDecimal price, Integer durationMin,
    @JsonProperty("tag_ids") List<String> tagIds,
    @JsonProperty("domain_id") String domainId,
    @JsonProperty("location_description") String locationDescription,
    @JsonProperty("max_participants") Integer maxParticipants,
    Boolean active,
    List<String> images,
    @JsonProperty("created_at") OffsetDateTime createdAt,
    @JsonProperty("updated_at") OffsetDateTime updatedAt,
    @JsonProperty("booking_approval_mode") String bookingApprovalMode,
    @JsonProperty("allow_pay_later") Boolean allowPayLater,
    @JsonProperty("pay_later_expiration_minutes") Integer payLaterExpirationMinutes,
    // Enrichment
    CoachLite coach,
    @JsonProperty("avg_rating") Double avgRating,
    @JsonProperty("review_count") Integer reviewCount,
    List<TagDto> tags,
    List<LocationDto> locations,
    @JsonProperty("original_address") String originalAddress,
    List<SlotDto> slots,
    List<PackageDto> packages,
    @JsonProperty("is_owner") Boolean isOwner
) {}

public record SavedServiceDto(...) {}      // format plat distinct
public record DeactivatedServiceDto(..., @JsonProperty("days_until_media_purge") Long daysUntilMediaPurge) {}
public record CoachLite(@JsonProperty("user_id") String userId, String name, String picture, @JsonProperty("is_coach_verified") Boolean isCoachVerified) {}
```

> Si `spring.jackson.property-naming-strategy=SNAKE_CASE` global, retirer les `@JsonProperty` redondants.

---

## 10. Pièges identifiés (récap)

| Piège | Action |
|---|---|
| Ambiguïté `WHERE sl.service_id = service_id` | Qualifier `services.service_id` explicitement |
| Cast `(slot_date \|\| ' ' \|\| start_time)::timestamp` | Préserver SQL exact, ne pas refactorer |
| `slot_date >= TO_CHAR(NOW(), 'YYYY-MM-DD')` | Préserver SQL exact (compat strict) |
| Sous-requêtes `json_build_object` + `json_agg` | Parsing Jackson dans row mapper |
| `images` parsing dual jsonb/text | Helper `parseImages` fallback |
| `tag_ids` parsing dual | Idem |
| `ST_MakePoint(lng, lat)` ordre | Toujours (lng, lat) PAS (lat, lng) |
| `_fetch_pkg_slots` séquentiel post-packages | Join puis fetch packages slots après |
| Auto-exclusion services personnels search | `if (currentUserId != null) AND coach_id != ?` |
| `is_owner` (coach OR admin) detail | Applicatif post-SELECT |
| Suppression `original_*` non-owner detail | Setter null ou ne pas inclure |
| Saved format plat distinct | DTO séparé `SavedServiceDto` |
| LIMIT 100 hardcodé search | Préserver |
| Pas de filtre `active` ni `deleted_at` sur detail | Préserver compat permissive |
| 404 `{"detail":"Service not found"}` | `ResponseStatusException` Spring 6 |
| `available_slots` saved sans NOT EXISTS booking | Préserver (asymétrie compat) |
| `days_until_media_purge` `Math.max(0, days)` | Préserver |

---

## 11. Tests Spring Boot

### Tests unitaires service (`@MockBean` repos)
- Reproduire les ~67 cas T42-XX-NN du fichier TEST_CASES.

### Tests d'intégration controller (`@SpringBootTest` + `MockMvc` + Testcontainers PostgreSQL+PostGIS)
- Vérifier PostGIS `ST_DWithin` réel
- Vérifier batch enrich parallèle (mesurer durée < 300ms pour 100 services)
- Vérifier `_mask_address` cas par cas

### Tests régressions cross-slice
- `GET /bookings/{id}` (S11) doit pouvoir consommer `GET /services/{id}` (S42) via shape compatible

---

## 12. Critères de Done

- [ ] **Path correct** : `/api/services` (search), `/services/mine`, `/services/saved`, `/services/deactivated`, `/services/{id}`
- [ ] Auth selon endpoint (search+detail public, 3 autres authenticated)
- [ ] Auto-exclusion services personnels search si JWT présent (try/catch silencieux)
- [ ] Filtres dynamiques composables (lat+lng+radius, coach_id, domain_id)
- [ ] LIMIT 100 hardcodé search
- [ ] PostGIS `ST_DWithin` + ST_X/ST_Y mappés
- [ ] AddressMaskingService porté avec `_COUNTRY_NAMES` FR
- [ ] `is_owner` détection (coach OR admin) detail
- [ ] Suppression `original_address`/`original_description` si non-owner
- [ ] Search vue light : `slots:[], packages:[], is_owner:false` toujours
- [ ] Mine vue owner : slots+packages chargés, original_address visible
- [ ] Saved format plat distinct (DTO séparé)
- [ ] Deactivated avec `days_until_media_purge` calcul UTC-aware
- [ ] Detail sans filtre `active` ni `deleted_at` (compat permissive)
- [ ] 404 detail `{"detail":"Service not found"}` (clé `detail`)
- [ ] Filtre slots futurs + NOT EXISTS bookings (4 statuts)
- [ ] Batch enrich 4 queries // (search) et 6 queries // + 1 séq (owner)
- [ ] `images` et `tag_ids` parsing dual jsonb/text
- [ ] Régressions S11 (booking detail), S25 (home feed), S37 (price-preview), S38 (catalogue) vertes
- [ ] DDL Supabase auditée pour types `tag_ids`, `images` (`jsonb` vs `text`)
- [ ] Tests T42-XX-NN passent (~67 cas)

---

## 13. Hors scope (rappel)

NE PAS implémenter dans S42 :
- POST /services (create) → S43
- PUT/PATCH /services/{id} → S43
- DELETE /services/{id} → S43 (réutilise pattern S40)
- POST /services/{id}/reactivate → S43
- POST /services/{id}/save + DELETE /unsave → S43
- service_slots writes (création créneaux) → S44 dédiée
- service_packages writes → S43 ou S44
- Helpers `_get_booking_flags` + `_normalize_booking_config` → S43

---

## 14. Roadmap suggérée post-S42

| Slice | Périmètre |
|---|---|
| **S43** | Services CRUD writes : create, update, delete (soft), reactivate, save, unsave + helpers booking_flags |
| **S44** | Service slots writes : création récurrents/spécifiques + booking constraints |
| **S45** | Service packages writes : CRUD packages |
| Suite | Chat (B-P0-01), Notifications, Adresses... |

Le pattern enrich `_batch_enrich_*` mis en place par S42 sera **réutilisé tel quel** par S43 (les writes retournent le service enrichi via le même service).
