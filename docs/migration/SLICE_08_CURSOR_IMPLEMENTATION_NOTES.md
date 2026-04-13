# SLICE_08_CURSOR_IMPLEMENTATION_NOTES.md — Notes pour Cursor
> Basé sur `user_routes.py:238–259`, `database.py:53–69`.
> Généré le 2026-02-XX.

---

## Prérequis

- Slice 02 : connexion Supabase JDBC fonctionnelle
- Table `reviews` accessible
- Table `users` accessible (JOIN)
- Jackson configuré pour ISO 8601 avec timezone

---

## Architecture cible

```
com.spotu.reviews/
├── controller/
│   └── UserReviewsController.java         # GET /api/users/{userId}/reviews
├── service/
│   └── UserReviewsService.java            # Logique privacy gate
├── repository/
│   └── UserReviewsRepository.java         # 2 requêtes SQL
└── dto/
    └── ReviewItemDto.java                 # 7 champs
```

---

## 1. DTO — `ReviewItemDto`

```java
public class ReviewItemDto {

    @JsonProperty("review_id")
    private String reviewId;

    @JsonProperty("rating")
    private int rating;

    @JsonProperty("comment")
    private String comment;               // nullable

    @JsonProperty("created_at")
    private String createdAt;             // ISO 8601 string — hérité de row_to_dict Python

    @JsonProperty("reviewer_id")
    private String reviewerId;

    @JsonProperty("reviewer_name")
    private String reviewerName;

    @JsonProperty("reviewer_picture")
    private String reviewerPicture;       // nullable

    // constructeur, getters
}
```

**Note sur `created_at` :**
Option A — `String` : sérialiser manuellement `OffsetDateTime.toString()` → format `+00:00`
Option B — `OffsetDateTime` + Jackson : configurer `WRITE_DATES_AS_TIMESTAMPS=false` + `ISO_OFFSET_DATE_TIME`

Si on utilise `OffsetDateTime` :
```java
@JsonProperty("created_at")
@JsonSerialize(using = OffsetDateTimeSerializer.class)
@JsonDeserialize(using = OffsetDateTimeDeserializer.class)
private OffsetDateTime createdAt;
```
Vérifier que Jackson sérialise `"2026-04-10T14:30:00.000000+00:00"` et non `"2026-04-10T14:30:00Z"`.

---

## 2. Controller — `UserReviewsController`

```java
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserReviewsController {

    private final UserReviewsService userReviewsService;

    @GetMapping("/{userId}/reviews")
    public ResponseEntity<List<ReviewItemDto>> getUserReviews(
            @PathVariable String userId) {

        // Pas d'auth — endpoint totalement public
        List<ReviewItemDto> reviews = userReviewsService.getReviews(userId);
        return ResponseEntity.ok(reviews);
    }
}
```

**Sécurité :**
```java
.requestMatchers(HttpMethod.GET, "/api/users/*/reviews").permitAll()
```

---

## 3. Service — `UserReviewsService`

```java
@Service
@RequiredArgsConstructor
public class UserReviewsService {

    private final UserReviewsRepository repo;

    public List<ReviewItemDto> getReviews(String userId) {

        // R1 — Vérification existence + privacy flag
        Boolean showReviews = repo.findShowReviews(userId);

        if (showReviews == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found");
        }

        // Privacy gate : show_reviews=false → [] sans erreur
        if (!showReviews) {
            return Collections.emptyList();
        }

        // R2 — Fetch reviews avec JOIN users
        return repo.findReviewsByRevieweeId(userId);
    }
}
```

---

## 4. Repository — `UserReviewsRepository`

```java
@Repository
public interface UserReviewsRepository {

    // R1 — Vérification existence + flag show_reviews
    @Query(value = "SELECT show_reviews FROM users WHERE user_id = :userId",
           nativeQuery = true)
    Boolean findShowReviews(@Param("userId") String userId);

    // R2 — Liste reviews avec JOIN auteur
    @Query(value = """
        SELECT r.review_id,
               r.rating,
               r.comment,
               r.created_at,
               u.user_id  AS reviewer_id,
               u.name     AS reviewer_name,
               u.picture  AS reviewer_picture
        FROM reviews r
        JOIN users u ON u.user_id = r.reviewer_id
        WHERE r.reviewee_id = :userId
        ORDER BY r.created_at DESC
        """, nativeQuery = true)
    List<ReviewItemDto> findReviewsByRevieweeId(@Param("userId") String userId);
}
```

### Gestion du `null` pour `findShowReviews`

`@Query` avec retour `Boolean` : si aucune ligne → Spring Data retourne `null`.
Cela permet de distinguer :
- `null` → user inexistant → 404
- `true` → continuer
- `false` → retourner `[]`

---

## 5. Projection Spring Data pour `ReviewItemDto`

Pour les résultats de la requête native, utiliser une interface de projection :

```java
public interface ReviewProjection {
    String getReview_id();
    int getRating();
    String getComment();             // nullable
    OffsetDateTime getCreated_at();  // ou String selon choix de sérialisation
    String getReviewer_id();
    String getReviewer_name();
    String getReviewer_picture();    // nullable
}
```

Puis mapper vers `ReviewItemDto` dans le service (avec conversion `OffsetDateTime → ISO string` si besoin).

---

## 6. Sérialisation `created_at` — Configuration Jackson

Pour reproduire `"2026-04-10T14:30:00.000000+00:00"` (format Python `.isoformat()`) :

```yaml
# application.yml
spring:
  jackson:
    serialization:
      write-dates-as-timestamps: false
    time-zone: UTC
    date-format: "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXX"
```

**Note :** Python `.isoformat()` sur TIMESTAMPTZ UTC retourne typiquement
`"2026-04-10T14:30:00.000000+00:00"` (6 décimales microsecondes + `+00:00`).
Java `OffsetDateTime` par défaut peut retourner `"2026-04-10T14:30:00Z"`.
Cette différence de format est acceptable (les deux sont ISO 8601 valides),
mais la documenter pour éviter les comparaisons strictes de chaînes côté tests.

---

## 7. Choses à NE PAS faire

| Interdiction | Raison |
|---|---|
| Ne PAS ajouter d'auth | Endpoint entièrement public — `permitAll()` |
| Ne PAS retourner 403 si show_reviews=false | Python retourne `[]` HTTP 200 |
| Ne PAS ajouter `booking_id` dans la réponse | Absent du SELECT Python intentionnellement |
| Ne PAS ajouter `reviewee_id` dans la réponse | Absent du SELECT Python (implicite dans le path) |
| Ne PAS filtrer sur `booking_id IS NULL` | Toutes les reviews sont retournées |
| Ne PAS ajouter de pagination | Python retourne tout sans LIMIT |
| Ne PAS trier applicativement | `ORDER BY r.created_at DESC` SQL — fidèle au comportement DB |

---

## 8. Critères de Done

- [ ] `GET /api/users/{userId}/reviews` retourne HTTP 200
- [ ] Pas d'auth requise — accessible sans token
- [ ] `user_id` inexistant → HTTP 404 `{"detail": "User not found"}`
- [ ] `show_reviews=false` → HTTP 200 + `[]` (pas 403)
- [ ] `show_reviews=true`, 0 reviews → HTTP 200 + `[]`
- [ ] 7 champs par review (review_id, rating, comment, created_at, reviewer_id, reviewer_name, reviewer_picture)
- [ ] `booking_id` absent de la réponse
- [ ] Tri `ORDER BY r.created_at DESC` respecté
- [ ] `created_at` au format ISO 8601 avec timezone
- [ ] Token présent mais ignoré → HTTP 200 (TC-05)
- [ ] Token invalide → HTTP 200 (pas 401) (TC-06)
- [ ] TC-09 (cohérence Slice 04 avg_rating/review_count) passé
- [ ] Pas de régression sur Slices 02–07
