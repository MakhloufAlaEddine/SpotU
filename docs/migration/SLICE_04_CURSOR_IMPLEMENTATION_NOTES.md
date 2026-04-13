# SLICE_04_CURSOR_IMPLEMENTATION_NOTES.md — Notes pour Cursor
> Basé sur `user_routes.py:99–235`, `spot_you_routes.py:27–109`.
> Généré le 2026-02-XX.

---

## Prérequis

- Slice 02 complète : `JwtAuthFilter`, `UserRepository` BASE
- Slice 03 complète : `UserProfileService`, `ReviewRepository` (réutilisés partiellement)
- Nouvel accès requis aux tables : `user_follows`, `tags`, `services`, `tag_points`, `spot_you_members`, `spot_you_attendance`, `tag_point_votes`

---

## Architecture cible

```
com.spotu.users/
├── controller/
│   └── PublicProfileController.java       # GET /api/users/{userId}/public
├── service/
│   └── PublicProfileService.java          # Orchestration des 11 requêtes
├── repository/
│   ├── UserPublicProjectionRepo.java      # Q1 — 13 colonnes (différent de UserRepository Slice 02)
│   ├── UserFollowsRepository.java         # Q2, Q3, Q4
│   ├── TagRepository.java                 # Q5
│   ├── PublicReviewRepository.java        # Q6
│   ├── PublicServiceRepository.java       # Q7
│   └── PublicTagPointRepository.java      # Q8–Q11
├── dto/
│   ├── PublicProfileDto.java              # Réponse complète (23+ champs)
│   ├── InterestDto.java                   # Objet interests[]
│   ├── ServiceSummaryDto.java             # Objet services[]
│   └── TagPointPublicDto.java             # Objet tag_points[]
├── util/
│   └── NextSessionDateCalculator.java     # get_next_session_date — spot_you_routes.py:27–109
└── entity/
    └── (projections uniquement — pas d'entités complètes requises ici)
```

---

## 1. DTO — `PublicProfileDto`

```java
@JsonInclude(JsonInclude.Include.NON_NULL)  // pour la clé "services" conditionnelle
public class PublicProfileDto {

    // Champs DB direct (Q1)
    private String userId;
    private String name;
    private String picture;
    private String coverPicture;
    private Double coverOffsetY;
    private Double coverScale;
    private String role;
    private String bio;
    private Boolean isCoachVerified;
    private List<String> coachTags;
    private boolean showPhone;
    private boolean showReviews;
    private String phone;           // null si show_phone=false (RG-03)

    // Calculés
    private int followersCount;
    private int followingCount;
    private boolean isFollowing;
    private List<InterestDto> interests;
    private Double avgRating;       // null si 0 reviews ou show_reviews=false
    private int reviewCount;
    private List<TagPointPublicDto> tagPoints;

    // Conditionnel — NE PAS sérialiser si null
    @JsonProperty("services")
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private List<ServiceSummaryDto> services;  // null si non-coach → absent du JSON

    // getters/setters avec @JsonProperty snake_case...
}
```

**Règle critique sur `services` :**
- Coach → `services = [...]` (liste, peut être vide)
- Non-coach → `services = null` + `@JsonInclude(NON_NULL)` → **clé absente du JSON**

---

## 2. Controller — `PublicProfileController`

```java
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class PublicProfileController {

    private final PublicProfileService publicProfileService;

    @GetMapping("/{userId}/public")
    public ResponseEntity<PublicProfileDto> getPublicProfile(
            @PathVariable String userId,
            // Auth optionnelle — null si non authentifié / token invalide
            @AuthenticationPrincipal(required = false) JwtAuthPrincipal principal) {

        String meId = principal != null ? principal.getUserId() : null;
        PublicProfileDto profile = publicProfileService.getPublicProfile(userId, meId);
        return ResponseEntity.ok(profile);
    }
}
```

**Sécurité :** La route doit être `permitAll()` dans `SecurityConfig` :
```java
.requestMatchers(HttpMethod.GET, "/api/users/*/public").permitAll()
```

**Note :** `@AuthenticationPrincipal(required = false)` retourne `null` si le filtre JWT
a échoué (token invalide/absent) au lieu de renvoyer 401. S'assurer que `JwtAuthFilter`
ne rejette pas silencieusement les requêtes sans token pour les routes `permitAll()`.

---

## 3. Service — `PublicProfileService`

```java
@Service
@RequiredArgsConstructor
public class PublicProfileService {

    private final UserPublicProjectionRepo userRepo;
    private final UserFollowsRepository followsRepo;
    private final TagRepository tagRepo;
    private final PublicReviewRepository reviewRepo;
    private final PublicServiceRepository serviceRepo;
    private final PublicTagPointRepository tagPointRepo;
    private final NextSessionDateCalculator nextSessionCalc;

    public PublicProfileDto getPublicProfile(String userId, String meId) {

        // Q1 — 13 colonnes
        UserPublicProjection user = userRepo.findPublicById(userId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));

        PublicProfileDto dto = mapBaseFields(user);

        // RG-03 Phone masking
        if (!user.isShowPhone()) {
            dto.setPhone(null);
        }

        // Q2+Q3 Followers/following counts
        dto.setFollowersCount((int) followsRepo.countByFollowingId(userId));
        dto.setFollowingCount((int) followsRepo.countByFollowerId(userId));

        // Q4 is_following (conditionnel)
        boolean isFollowing = false;
        if (meId != null && !meId.equals(userId)) {
            isFollowing = followsRepo.existsByFollowerIdAndFollowingId(meId, userId);
        }
        dto.setIsFollowing(isFollowing);

        // Q5 interests
        List<String> tagIds = user.getCoachTagsAsList(); // gère double-parse JSONB
        if (!tagIds.isEmpty()) {
            List<InterestDto> interests = tagRepo.findByTagIds(tagIds);
            dto.setInterests(interests);
        } else {
            dto.setInterests(Collections.emptyList());
        }

        // Q6 reviews (conditionnel show_reviews)
        if (user.isShowReviews()) {
            List<Integer> ratings = reviewRepo.findRatingsByRevieweeId(userId);
            if (!ratings.isEmpty()) {
                double avg = ratings.stream().mapToInt(Integer::intValue).average().orElse(0.0);
                dto.setAvgRating(Math.round(avg * 10.0) / 10.0);
                dto.setReviewCount(ratings.size());
            } else {
                dto.setAvgRating(null);
                dto.setReviewCount(0);
            }
        } else {
            dto.setAvgRating(null);
            dto.setReviewCount(0);
        }

        // Q7 services (conditionnel role=coach)
        if ("coach".equals(user.getRole())) {
            List<ServiceSummaryDto> services = serviceRepo.findActiveByCoachId(userId);
            dto.setServices(services); // [] si aucun — clé présente dans JSON
        }
        // si non-coach : dto.services reste null → clé ABSENTE du JSON (@JsonInclude NON_NULL)

        // Q8 tag_points
        List<TagPointPublicDto> tagPoints = tagPointRepo.findActiveByUserId(userId, 20);
        if (!tagPoints.isEmpty()) {
            // Q9–Q11 Batch enrichment
            List<String> pointIds = tagPoints.stream()
                .map(TagPointPublicDto::getPointId)
                .collect(Collectors.toList());

            Map<String, Integer> participantsMap = tagPointRepo.batchCountMembers(pointIds);
            Map<String, Integer> goingMap = tagPointRepo.batchCountGoing(pointIds);
            Map<String, double[]> ratingsMap = tagPointRepo.batchRatings(pointIds);

            for (TagPointPublicDto tp : tagPoints) {
                String pid = tp.getPointId();
                int goingCount = goingMap.getOrDefault(pid, 0);
                Integer maxP = tp.getMaximumParticipants();

                tp.setParticipantsCount(participantsMap.getOrDefault(pid, 0));
                tp.setGoingCount(goingCount);

                double[] rv = ratingsMap.get(pid);
                tp.setRating(rv != null ? rv[0] : 0.0);
                tp.setVoteCount(rv != null ? (int) rv[1] : 0);

                // next_session_date — fuseau Paris obligatoire
                LocalDate nextDate = nextSessionCalc.compute(tp);
                tp.setNextSessionDate(nextDate != null ? nextDate.toString() : null);

                // is_full
                tp.setFull(maxP != null && goingCount >= maxP);
            }
        }
        dto.setTagPoints(tagPoints);

        return dto;
    }
}
```

---

## 4. Utilitaire critique — `NextSessionDateCalculator`

**Reproduit exactement `spot_you_routes.py:27–109`.**

```java
@Component
public class NextSessionDateCalculator {

    private static final ZoneId PARIS = ZoneId.of("Europe/Paris");

    /**
     * Calcule la prochaine date de séance d'un tag_point.
     * Convention weekday : 0=Lundi … 6=Dimanche (identique Python weekday()).
     * ATTENTION : DayOfWeek Java = 1(Mon)..7(Sun) — ajuster lors du mapping.
     */
    public LocalDate compute(TagPointPublicDto tp) {
        ZonedDateTime nowParis = ZonedDateTime.now(PARIS);
        LocalDate today = nowParis.toLocalDate();

        Object eventSchedule = tp.getEventSchedule(); // JSONB — Object/Map
        Object eventDate = tp.getEventDate();

        // Préférer event_schedule (récurrent) sur event_date (ponctuel)
        if (eventSchedule instanceof Map<?, ?> sched) {
            if (!"weekly".equals(sched.get("type"))) return null;

            @SuppressWarnings("unchecked")
            Map<String, ?> schedule = (Map<String, ?>) sched.get("schedule");
            if (schedule == null || schedule.isEmpty()) return null;

            LocalDate earliest = null;
            for (Map.Entry<String, ?> entry : schedule.entrySet()) {
                int dayIdx = Integer.parseInt(entry.getKey()); // 0=Lun…6=Dim
                List<?> slots = (List<?>) entry.getValue();
                if (slots == null || slots.isEmpty()) continue;

                // Extraire heure du premier slot
                String startTime = extractStartTime(slots.get(0));
                if (startTime == null) continue;

                String[] parts = startTime.split(":");
                int h = Integer.parseInt(parts[0]);
                int m = Integer.parseInt(parts[1]);

                // dayOfWeek Python 0=Lun → Java DayOfWeek.getValue() 1=Lun
                // Convertir : javaDay = dayIdx + 1
                int todayIdx = today.getDayOfWeek().getValue() - 1; // 0=Lun
                int daysUntil = Math.floorMod(dayIdx - todayIdx, 7);

                if (daysUntil == 0) {
                    // Aujourd'hui : comparer en heure Paris
                    ZonedDateTime sessionTime = nowParis
                        .withHour(h).withMinute(m).withSecond(0).withNano(0);
                    if (!nowParis.isBefore(sessionTime)) {
                        daysUntil = 7; // Séance déjà passée aujourd'hui → semaine suivante
                    }
                }

                LocalDate candidate = today.plusDays(daysUntil);
                if (earliest == null || candidate.isBefore(earliest)) {
                    earliest = candidate;
                }
            }
            return earliest;
        }

        // Événement ponctuel
        if (eventDate != null) {
            LocalDate d;
            if (eventDate instanceof LocalDate ld) {
                d = ld;
            } else if (eventDate instanceof String s) {
                try { d = LocalDate.parse(s.substring(0, 10)); }
                catch (Exception e) { return null; }
            } else {
                return null;
            }
            return !d.isBefore(today) ? d : null;
        }

        return null;
    }

    private String extractStartTime(Object slot) {
        if (slot instanceof String s) return s;
        if (slot instanceof Map<?, ?> m) {
            Object start = m.get("start");
            return start instanceof String ? (String) start : null;
        }
        return null;
    }
}
```

---

## 5. Q1 — UserPublicProjection (différente de USER_FIELDS)

**NE PAS réutiliser** le `UserRepository` de Slice 02 tel quel — les colonnes sont différentes.

```java
@Query(value = """
    SELECT user_id, name, picture, cover_picture, cover_offset_y, cover_scale,
           role, bio, is_coach_verified, coach_tags,
           show_phone, show_reviews, phone
    FROM users WHERE user_id = :userId
    """, nativeQuery = true)
Optional<UserPublicProjection> findPublicById(@Param("userId") String userId);
```

Interface de projection :
```java
public interface UserPublicProjection {
    String getUserId();
    String getName();
    String getPicture();
    String getCoverPicture();
    Double getCoverOffsetY();
    Double getCoverScale();
    String getRole();
    String getBio();
    Boolean getIsCoachVerified();
    String getCoachTagsRaw();  // JSON string brut — parser avec double-protection
    boolean isShowPhone();
    boolean isShowReviews();
    String getPhone();

    // Helper pour double-parse protection (coach_tags)
    default List<String> getCoachTagsAsList() {
        String raw = getCoachTagsRaw();
        if (raw == null || raw.isBlank()) return Collections.emptyList();
        try {
            // First parse
            Object obj = new ObjectMapper().readValue(raw, Object.class);
            if (obj instanceof List<?> list) {
                return list.stream().map(Object::toString).collect(Collectors.toList());
            }
            // Double-encoded : obj is a String — second parse
            if (obj instanceof String s) {
                List<?> list2 = new ObjectMapper().readValue(s, List.class);
                return list2.stream().map(Object::toString).collect(Collectors.toList());
            }
        } catch (Exception ignored) {}
        return Collections.emptyList();
    }
}
```

---

## 6. Choses à NE PAS faire

| Interdiction | Raison |
|---|---|
| Ne PAS renvoyer 401 si token absent | Le endpoint est public — `me_id = null` silencieusement |
| Ne PAS renvoyer 401 si token invalide | Même comportement — try/except Python → me_id=null |
| Ne PAS exposer `email`, `language`, `iban`, `bic`, `iban_name` | Profil PUBLIC — jamais de données privées |
| Ne PAS sérialiser `services` pour non-coach | `null` + `@JsonInclude(NON_NULL)` → clé absente |
| Ne PAS utiliser UTC pour `get_next_session_date` | Fuseau `Europe/Paris` obligatoire |
| Ne PAS retourner `avg_rating = 0.0` | `null` si 0 reviews ou show_reviews=false |
| Ne PAS filtrer `deleted_at` | Python ne le fait pas — reproduire exactement |
| Ne PAS utiliser `USER_FIELDS` de Slice 02 | Q1 utilise 13 colonnes DIFFÉRENTES |
| Ne PAS ajouter `@Transactional` | Lecture seule, pas nécessaire |
| Ne PAS mettre la route en `.authenticated()` | `.permitAll()` — accès public |

---

## 7. Critères de Done

- [ ] `GET /api/users/{userId}/public` retourne HTTP 200 sans token
- [ ] HTTP 404 si user_id inexistant
- [ ] Token invalide → HTTP 200, `is_following = false` (pas 401)
- [ ] `phone = null` si `show_phone = false`
- [ ] `avg_rating = null` si `show_reviews = false`
- [ ] `avg_rating = null` si `show_reviews = true` mais 0 reviews
- [ ] Clé `services` **absente** si non-coach
- [ ] Clé `services` **présente** (même si `[]`) si coach
- [ ] `interests` tableau d'objets `{tag_id, label_fr, label_en, icon}`
- [ ] `tag_points` enrichis avec `participants_count`, `going_count`, `rating`, `vote_count`, `next_session_date`, `is_full`
- [ ] `next_session_date` calculé en fuseau `Europe/Paris`
- [ ] `is_full = false` si `maximum_participants = null`
- [ ] TC-05 (token invalide → 200, pas 401) passé
- [ ] TC-12 (clé services absente si non-coach) passé
- [ ] TC-13 (next_session_date tz Paris) passé
- [ ] Pas de régression sur Slice 02 (`/api/auth/me`) et Slice 03 (`/api/users/me`)
