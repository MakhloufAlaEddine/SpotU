# SLICE_03_CURSOR_IMPLEMENTATION_NOTES.md — Notes pour Cursor
> Basé sur `user_routes.py:11–30`, `auth_utils.py`, `database.py`.
> Généré le 2026-02-XX.

---

## Prérequis

Avant d'implémenter cette slice, **Slice 02 doit être complète et testée** :
- `JwtAuthFilter` opérationnel
- `UserRepository` avec les 18 colonnes `USER_FIELDS`
- `AuthMeController` retournant `AuthMeDto` fonctionnel

---

## Architecture cible (Spring Boot 3.x / Java 21)

```
com.spotu.users/
├── controller/
│   └── UserProfileController.java     # GET /api/users/me
├── service/
│   └── UserProfileService.java        # Logique métier (avg_rating, banking)
├── repository/
│   ├── UserRepository.java            # Hérité Slice 02 (étendre avec banking)
│   └── ReviewRepository.java          # Nouveau — table reviews
├── dto/
│   └── UserProfileDto.java            # 23 champs = AuthMeDto + 5 champs extra
└── entity/
    └── Review.java                    # Entité légère (rating uniquement lu)
```

---

## 1. DTO — `UserProfileDto`

**Étendre `AuthMeDto`** (Slice 02) en ajoutant les 5 champs supplémentaires :

```java
public class UserProfileDto extends AuthMeDto {

    // Champs supplémentaires vs /api/auth/me
    @JsonProperty("avg_rating")
    private Double avgRating;          // null si 0 review

    @JsonProperty("review_count")
    private int reviewCount;           // 0 si aucune review (jamais null)

    @JsonProperty("iban")
    private String iban;               // nullable

    @JsonProperty("bic")
    private String bic;                // nullable

    @JsonProperty("iban_name")
    private String ibanName;           // nullable

    // getters / setters
}
```

**Règles :**
- `avgRating` : `Double` (boxed, nullable) — **pas** `double` primitif
- `reviewCount` : `int` primitif — jamais null, default 0
- `@JsonProperty` obligatoire pour respecter le snake_case Python

---

## 2. Repository — `ReviewRepository`

**Requête SQL équivalente à `user_routes.py:16` :**

```java
@Repository
public interface ReviewRepository extends JpaRepository<Review, String> {

    @Query("SELECT r.rating FROM Review r WHERE r.revieweeId = :userId")
    List<Integer> findRatingsByRevieweeId(@Param("userId") String userId);
}
```

**Ou en JDBC natif (plus fidèle au Python) :**
```java
@Query(value = "SELECT rating FROM reviews WHERE reviewee_id = :userId", nativeQuery = true)
List<Integer> findRatingsByRevieweeId(@Param("userId") String userId);
```

---

## 3. Repository — Enrichir `UserRepository` pour les colonnes IBAN

**Nouvelle projection pour les données bancaires (équivalent `user_routes.py:17–18`) :**

```java
@Query(value = "SELECT iban, bic, iban_name FROM users WHERE user_id = :userId", nativeQuery = true)
Optional<BankingProjection> findBankingByUserId(@Param("userId") String userId);

// Projection interface
public interface BankingProjection {
    String getIban();
    String getBic();
    @Value("#{target.iban_name}")
    String getIbanName();
}
```

**Alternative recommandée :** Ajouter ces 3 colonnes directement à l'entité `User` comme champs
lazy ou dans une projection spécifique. Ne PAS les ajouter à `USER_FIELDS` (respecter la
frontière Slice 02 / Slice 03).

---

## 4. Service — `UserProfileService`

```java
@Service
@RequiredArgsConstructor
public class UserProfileService {

    private final UserRepository userRepository;
    private final ReviewRepository reviewRepository;

    public UserProfileDto getMyProfile(String userId) {

        // Q1 — 18 champs USER_FIELDS (hérité Slice 02)
        UserDto baseUser = userRepository.findUserFieldsById(userId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));

        UserProfileDto dto = new UserProfileDto(baseUser);

        // Q2 — Calcul avg_rating + review_count
        List<Integer> ratings = reviewRepository.findRatingsByRevieweeId(userId);
        if (ratings.isEmpty()) {
            dto.setAvgRating(null);    // CRITIQUE : null, pas 0.0
            dto.setReviewCount(0);
        } else {
            double avg = ratings.stream().mapToInt(Integer::intValue).average().orElse(0.0);
            dto.setAvgRating(Math.round(avg * 10.0) / 10.0);
            dto.setReviewCount(ratings.size());
        }

        // Q3 — Données bancaires
        userRepository.findBankingByUserId(userId).ifPresentOrElse(
            banking -> {
                dto.setIban(banking.getIban());
                dto.setBic(banking.getBic());
                dto.setIbanName(banking.getIbanName());
            },
            () -> {
                dto.setIban(null);
                dto.setBic(null);
                dto.setIbanName(null);
            }
        );

        return dto;
    }
}
```

---

## 5. Controller — `UserProfileController`

```java
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserProfileController {

    private final UserProfileService userProfileService;

    @GetMapping("/me")
    public ResponseEntity<UserProfileDto> getMyProfile(
            @AuthenticationPrincipal JwtAuthPrincipal principal) {

        UserProfileDto profile = userProfileService.getMyProfile(principal.getUserId());
        return ResponseEntity.ok(profile);
    }
}
```

**Note :** `JwtAuthPrincipal` est l'objet SecurityContext rempli par `JwtAuthFilter` (Slice 02).
Il expose `getUserId()` — le `user_id` extrait du claim JWT.

---

## 6. Entité `Review` (minimale)

Seul `rating` est nécessaire pour cette slice :

```java
@Entity
@Table(name = "reviews")
public class Review {

    @Id
    @Column(name = "review_id")
    private String reviewId;

    @Column(name = "reviewee_id")
    private String revieweeId;

    @Column(name = "rating")
    private Integer rating;

    // Pas d'autres champs requis pour cette slice
}
```

---

## 7. Choses à NE PAS faire

| Interdiction | Raison |
|---|---|
| Ne PAS ajouter `iban/bic/iban_name` à `AuthMeDto` (Slice 02) | Ces champs ne doivent PAS apparaître dans `GET /api/auth/me` |
| Ne PAS retourner `avg_rating = 0.0` quand il n'y a pas de reviews | Python retourne `null` — le frontend affiche "non noté" |
| Ne PAS filtrer sur `deleted_at` dans `require_auth` | Reproduire le comportement Python exact (RG-05) |
| Ne PAS utiliser `LocalDateTime` pour `created_at` / `updated_at` | Perte du fuseau horaire — utiliser `OffsetDateTime` |
| Ne PAS exposer `password_hash` ou tout champ hors des 23 définis | Fuite de données sensibles |
| Ne PAS mettre `@Transactional` sur `getMyProfile` | Lecture seule, pas nécessaire — 3 requêtes indépendantes |
| Ne PAS renommer le chemin Java en `/api/users/profile` | Profiter de la migration pour normaliser en `/api/users/me` |
| Ne PAS ajouter de cache (Redis) dans cette slice | Non présent en Python v1, hors scope |

---

## 8. Configuration Spring Security

Ajouter la nouvelle route dans la config de sécurité :

```java
// Dans SecurityConfig.java
.requestMatchers(HttpMethod.GET, "/api/users/me").authenticated()
```

---

## 9. Test d'intégration suggéré

```java
@SpringBootTest
@AutoConfigureMockMvc
class UserProfileControllerTest {

    @Test
    void getMyProfile_withValidToken_returns23Fields() throws Exception {
        // Setup : insérer un user avec reviews et IBAN en DB test
        String token = jwtTestHelper.createToken("user_test001", "coach");

        mockMvc.perform(get("/api/users/me")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.user_id").value("user_test001"))
            .andExpect(jsonPath("$.avg_rating").isNumber())
            .andExpect(jsonPath("$.review_count").isNumber())
            .andExpect(jsonPath("$.iban").exists())  // peut être null
            .andExpect(jsonPath("$.bic").exists())
            .andExpect(jsonPath("$.iban_name").exists());
    }

    @Test
    void getMyProfile_withNoReviews_avgRatingIsNull() throws Exception {
        String token = jwtTestHelper.createToken("user_no_reviews", "user");

        mockMvc.perform(get("/api/users/me")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.avg_rating").value(IsNull.nullValue()))
            .andExpect(jsonPath("$.review_count").value(0));
    }

    @Test
    void getMyProfile_withoutToken_returns401() throws Exception {
        mockMvc.perform(get("/api/users/me"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.detail").value("Not authenticated"));
    }
}
```

---

## 10. Critères de Done

- [ ] `GET /api/users/me` retourne HTTP 200 avec exactement 23 champs
- [ ] `avg_rating = null` quand 0 reviews (pas `0.0`)
- [ ] `review_count = 0` quand 0 reviews (pas `null`)
- [ ] `iban/bic/iban_name` présents dans la réponse (valeur null autorisée)
- [ ] `created_at` / `updated_at` au format ISO 8601 avec timezone
- [ ] Token Python accepté par Java (compatibilité croisée)
- [ ] Token cookie `winek_token` fonctionnel (fallback)
- [ ] Tous les codes d'erreur 401 retournent les bons messages (TC-04 à TC-07)
- [ ] TC-11 (compat croisée) passé
- [ ] `password_hash` et champs sensibles absents de la réponse
- [ ] `iban/bic/iban_name` absents de `GET /api/auth/me` (pas de régression Slice 02)
