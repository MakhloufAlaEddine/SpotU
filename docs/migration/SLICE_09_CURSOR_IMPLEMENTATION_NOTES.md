# SLICE_09_CURSOR_IMPLEMENTATION_NOTES.md — Notes pour Cursor
> Basé sur `service_routes.py:1–753`.
> Généré le 2026-02-XX.

---

## Prérequis

- Connexion Supabase JDBC (avec extension PostGIS si filtre géo requis)
- Slice 02 : `JwtAuthFilter` + `get_optional_auth` pattern
- Tables : `services`, `users`, `reviews`, `service_locations`, `tags`, `service_slots`, `service_packages`, `bookings`

---

## Architecture cible

```
com.spotu.services/
├── controller/
│   └── ServiceController.java            # GET /api/services + GET /api/services/{id}
├── service/
│   ├── ServiceSearchService.java         # Logique liste (GET /api/services)
│   └── ServiceDetailService.java         # Logique détail (GET /api/services/{id})
├── repository/
│   ├── ServiceRepository.java            # Requête principale services
│   └── ServiceEnrichmentRepository.java  # Batch enrichments
├── dto/
│   ├── ServiceListItemDto.java           # Pour GET /api/services
│   ├── ServiceDetailDto.java             # Pour GET /api/services/{id}
│   ├── CoachSummaryDto.java              # coach{} (4 champs)
│   ├── ServiceLocationDto.java           # locations[]
│   ├── TagDetailDto.java                 # tags[]
│   ├── SlotDto.java                      # slots[] (détail uniquement)
│   └── PackageDto.java                   # packages[] avec slots
└── util/
    └── AddressMaskUtil.java              # _mask_address (regex Python → Java)
```

---

## 1. DTOs

### `ServiceListItemDto` (GET /api/services)

```java
public class ServiceListItemDto {
    @JsonProperty("service_id")   private String serviceId;
    @JsonProperty("coach_id")     private String coachId;
    @JsonProperty("title")        private String title;
    @JsonProperty("description")  private String description;
    @JsonProperty("address")      private String address;     // masqué
    @JsonProperty("price")        private BigDecimal price;
    @JsonProperty("duration_min") private Integer durationMin;
    @JsonProperty("tag_ids")      private List<String> tagIds;
    @JsonProperty("domain_id")    private String domainId;
    @JsonProperty("location_description") private String locationDescription;
    @JsonProperty("max_participants")     private Integer maxParticipants;
    @JsonProperty("active")       private boolean active;
    @JsonProperty("images")       private List<String> images;
    @JsonProperty("created_at")   private String createdAt;
    @JsonProperty("updated_at")   private String updatedAt;
    @JsonProperty("booking_approval_mode")         private String bookingApprovalMode;
    @JsonProperty("allow_pay_later")               private boolean allowPayLater;
    @JsonProperty("pay_later_expiration_minutes")  private Integer payLaterExpirationMinutes;
    // Enrichissements
    @JsonProperty("coach")         private CoachSummaryDto coach;
    @JsonProperty("avg_rating")    private Double avgRating;
    @JsonProperty("review_count")  private int reviewCount;
    @JsonProperty("locations")     private List<ServiceLocationDto> locations;
    @JsonProperty("tags")          private List<TagDetailDto> tags;
    @JsonProperty("slots")         private List<Object> slots = new ArrayList<>();   // toujours []
    @JsonProperty("packages")      private List<Object> packages = new ArrayList<>(); // toujours []
    @JsonProperty("is_owner")      private boolean isOwner = false;                  // toujours false
}
```

### `ServiceDetailDto` extends `ServiceListItemDto`

Remplace `slots` et `packages` par les vraies listes, et ajoute `is_owner` contextuel :
```java
@JsonProperty("slots")           private List<SlotDto> slots;
@JsonProperty("packages")        private List<PackageDto> packages;
@JsonProperty("is_owner")        private boolean isOwner;
@JsonProperty("original_address") @JsonInclude(NON_NULL)
                                 private String originalAddress;
```

---

## 2. Controller — `ServiceController`

```java
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class ServiceController {

    private final ServiceSearchService searchService;
    private final ServiceDetailService detailService;

    @GetMapping("/services")
    public ResponseEntity<List<ServiceListItemDto>> searchServices(
            @RequestParam(required = false) Double lat,
            @RequestParam(required = false) Double lng,
            @RequestParam(defaultValue = "10000") Integer radius,
            @RequestParam(required = false) String coachId,
            @RequestParam(required = false) String domainId,
            @AuthenticationPrincipal(required = false) JwtAuthPrincipal principal) {

        String currentUserId = principal != null ? principal.getUserId() : null;
        return ResponseEntity.ok(
            searchService.search(lat, lng, radius, coachId, domainId, currentUserId));
    }

    @GetMapping("/services/{serviceId}")
    public ResponseEntity<ServiceDetailDto> getService(
            @PathVariable String serviceId,
            @AuthenticationPrincipal(required = false) JwtAuthPrincipal principal) {

        String viewerId = principal != null ? principal.getUserId() : null;
        String viewerRole = principal != null ? principal.getRole() : null;
        return ResponseEntity.ok(detailService.getDetail(serviceId, viewerId, viewerRole));
    }
}
```

**Sécurité :**
```java
.requestMatchers(HttpMethod.GET, "/api/services").permitAll()
.requestMatchers(HttpMethod.GET, "/api/services/*").permitAll()
```

---

## 3. AddressMaskUtil — `_mask_address` Java

```java
@Component
public class AddressMaskUtil {

    private static final Set<String> COUNTRY_NAMES = Set.of("france","fr","francia","frankreich");
    private static final Pattern NUMBER_PREFIX = Pattern.compile(
        "^\\d+\\s*(bis|ter|quater)?\\s*[,.]?\\s*", Pattern.CASE_INSENSITIVE);
    private static final Pattern POSTAL_CODE = Pattern.compile("^\\d{4,5}\\s+(.+)$");

    public String mask(String description, String precision) {
        if (description == null || description.isBlank() || "exact".equals(precision))
            return description;

        if ("1000m".equals(precision)) {
            String[] parts = Arrays.stream(description.split(","))
                .map(String::trim).toArray(String[]::new);
            for (int i = parts.length - 1; i >= 0; i--) {
                String candidate = parts[i].trim();
                if (!candidate.isEmpty() && !COUNTRY_NAMES.contains(candidate.toLowerCase())) {
                    Matcher m = POSTAL_CODE.matcher(candidate);
                    return m.matches() ? m.group(1).trim() : candidate;
                }
            }
            return parts[parts.length - 1];
        }

        // 100m: remove street number
        String streetPart = description.split(",")[0].trim();
        String masked = NUMBER_PREFIX.matcher(streetPart).replaceFirst("").trim();
        return !masked.isEmpty() ? masked : streetPart;
    }
}
```

---

## 4. Requête géo — PostGIS en JDBC natif

```java
// Dans ServiceRepository
@Query(value = """
    SELECT service_id, coach_id, title, description, address, price, duration_min,
           tag_ids::text, domain_id, location_description, max_participants, active,
           images::text, created_at, updated_at,
           booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
    FROM services
    WHERE active = TRUE
    AND EXISTS (
        SELECT 1 FROM service_locations sl
        WHERE sl.service_id = services.service_id
        AND ST_DWithin(sl.location::geography,
            ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
            :radius)
    )
    LIMIT 100
    """, nativeQuery = true)
List<Object[]> findByLocation(@Param("lat") double lat,
                               @Param("lng") double lng,
                               @Param("radius") int radius);
```

**Note :** Si PostGIS n'est pas disponible en v1 Java, documenter et ignorer le filtre géo.

---

## 5. Requête slots (GET /api/services/{id})

```java
@Query(value = """
    SELECT service_id, slot_id, slot_type, slot_status, location_id, package_id,
           day_of_week, days_of_week::text, start_time, end_time, slot_date
    FROM service_slots ss
    WHERE ss.service_id = ANY(:serviceIds::text[])
    AND (
        ss.slot_date IS NULL
        OR (ss.slot_date || ' ' || ss.start_time)::timestamp > NOW()::timestamp
    )
    AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.slot_id = ss.slot_id
        AND b.status IN ('pending', 'accepted', 'awaiting_payment', 'confirmed')
    )
    ORDER BY ss.slot_date NULLS LAST, ss.start_time
    """, nativeQuery = true)
List<Object[]> findAvailableSlots(@Param("serviceIds") String[] serviceIds);
```

---

## 6. Choses à NE PAS faire

| Interdiction | Raison |
|---|---|
| Ne PAS charger slots/packages dans `GET /api/services` | Intentionnellement vides (performance) |
| Ne PAS normaliser `booking_approval_mode` en GET | Normalisation côté write uniquement |
| Ne PAS retourner 401 si token absent ou invalide | Soft/optional auth sur les deux endpoints |
| Ne PAS filtrer `active=FALSE` (l'inclure) | Python exclut toujours les inactifs |
| Ne PAS exposer `original_address` si `is_owner=false` | Comportement ligne 749–752 |
| Ne PAS calculer `avg_rating` par `service_id` | C'est par `coach_id` |
| Ne PAS ajouter de pagination | `LIMIT 100` hardcodé |
| Ne PAS ajouter `bookings` dans la réponse | Indirect (filtrage slots seulement) |

---

## 7. Critères de Done

### GET /api/services

- [ ] HTTP 200 sans token
- [ ] Filtre `coach_id` fonctionnel
- [ ] Filtre `domain_id` fonctionnel
- [ ] Propres services exclus si token valide
- [ ] Token invalide → 200 (pas 401)
- [ ] `slots = []`, `packages = []`, `is_owner = false` pour chaque item
- [ ] `coach{}` enrichi (4 champs)
- [ ] `avg_rating` / `review_count` par coach_id
- [ ] `locations[]` avec adresses masquées
- [ ] `images` tableau JSON (jamais string, jamais null)
- [ ] LIMIT 100 respecté

### GET /api/services/{serviceId}

- [ ] HTTP 200 sans token
- [ ] HTTP 404 si service_id inconnu
- [ ] `is_owner = true` pour coach propriétaire
- [ ] `is_owner = true` pour admin
- [ ] `original_address` absent si `is_owner = false`
- [ ] `slots[]` chargés (futurs + non réservés)
- [ ] `packages[]` chargés avec leurs slots
- [ ] TC-14 (slots passés filtrés) passé
- [ ] TC-15 (slots réservés filtrés) passé
- [ ] Pas de régression sur Slices 02–08
