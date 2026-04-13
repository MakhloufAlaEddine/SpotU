# SLICE_05_CURSOR_IMPLEMENTATION_NOTES.md — Notes pour Cursor
> Basé sur `user_routes.py:494–522`, `migrations/001_initial_schema.sql`.
> Généré le 2026-02-XX.

---

## Prérequis

- Slice 02 complète : `JwtAuthFilter`, `JwtAuthPrincipal.getUserId()`
- Table `user_follows` accessible (Supabase)

---

## Architecture cible

```
com.spotu.users/
├── controller/
│   └── FollowController.java         # POST + DELETE /api/users/{userId}/follow
├── service/
│   └── FollowService.java            # Logique métier + règles (self-check, 404)
├── repository/
│   └── UserFollowsRepository.java    # INSERT ON CONFLICT, DELETE, COUNT
└── dto/
    └── FollowResponseDto.java        # {"is_following": bool, "followers_count": int}
```

---

## 1. DTO — `FollowResponseDto`

```java
public class FollowResponseDto {

    @JsonProperty("is_following")
    private boolean isFollowing;

    @JsonProperty("followers_count")
    private int followersCount;

    public FollowResponseDto(boolean isFollowing, int followersCount) {
        this.isFollowing = isFollowing;
        this.followersCount = followersCount;
    }

    // getters
}
```

**Note :** Réponse identique pour follow et unfollow, seul `isFollowing` diffère (`true` / `false`).

---

## 2. Controller — `FollowController`

```java
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class FollowController {

    private final FollowService followService;

    @PostMapping("/{userId}/follow")
    public ResponseEntity<FollowResponseDto> followUser(
            @PathVariable String userId,
            @AuthenticationPrincipal JwtAuthPrincipal principal) {

        FollowResponseDto response = followService.follow(principal.getUserId(), userId);
        return ResponseEntity.ok(response);
    }

    @DeleteMapping("/{userId}/follow")
    public ResponseEntity<FollowResponseDto> unfollowUser(
            @PathVariable String userId,
            @AuthenticationPrincipal JwtAuthPrincipal principal) {

        FollowResponseDto response = followService.unfollow(principal.getUserId(), userId);
        return ResponseEntity.ok(response);
    }
}
```

---

## 3. Service — `FollowService`

```java
@Service
@RequiredArgsConstructor
public class FollowService {

    private final UserFollowsRepository followsRepo;
    private final UserRepository userRepo;  // pour vérifier existence cible

    public FollowResponseDto follow(String meId, String targetId) {

        // RG-02 — Self-follow interdit
        if (meId.equals(targetId)) {
            throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                "Vous ne pouvez pas vous suivre vous-même."
            );
        }

        // RG-03 — Vérification existence cible
        if (!userRepo.existsByUserId(targetId)) {
            throw new ResponseStatusException(
                HttpStatus.NOT_FOUND,
                "Utilisateur introuvable."
            );
        }

        // R2 — INSERT ON CONFLICT DO NOTHING (idempotent)
        followsRepo.followUser(meId, targetId);

        // R4 — COUNT recalculé depuis DB
        int count = followsRepo.countFollowers(targetId);

        return new FollowResponseDto(true, count);
    }

    public FollowResponseDto unfollow(String meId, String targetId) {

        // PAS de self-check, PAS de vérif existence cible (RG-04)

        // R3 — DELETE (0 ou 1 row — silencieux si inexistant)
        followsRepo.unfollowUser(meId, targetId);

        // R4 — COUNT recalculé depuis DB
        int count = followsRepo.countFollowers(targetId);

        return new FollowResponseDto(false, count);
    }
}
```

---

## 4. Repository — `UserFollowsRepository`

```java
@Repository
public interface UserFollowsRepository extends JpaRepository<UserFollows, UserFollowsId> {

    // R2 — INSERT ON CONFLICT DO NOTHING
    @Modifying
    @Transactional
    @Query(value = """
        INSERT INTO user_follows(follower_id, following_id)
        VALUES(:followerId, :followingId)
        ON CONFLICT DO NOTHING
        """, nativeQuery = true)
    void followUser(@Param("followerId") String followerId,
                    @Param("followingId") String followingId);

    // R3 — DELETE
    @Modifying
    @Transactional
    @Query(value = """
        DELETE FROM user_follows
        WHERE follower_id = :followerId AND following_id = :followingId
        """, nativeQuery = true)
    int unfollowUser(@Param("followerId") String followerId,
                     @Param("followingId") String followingId);

    // R4 — COUNT followers de la cible
    @Query(value = "SELECT COUNT(*) FROM user_follows WHERE following_id = :userId",
           nativeQuery = true)
    int countFollowers(@Param("userId") String userId);

    // Pour le service : vérif rapide existence relation (optionnel)
    @Query(value = """
        SELECT EXISTS(SELECT 1 FROM user_follows
                      WHERE follower_id = :followerId AND following_id = :followingId)
        """, nativeQuery = true)
    boolean existsRelation(@Param("followerId") String followerId,
                           @Param("followingId") String followingId);
}
```

### Entité `UserFollows`

```java
@Entity
@Table(name = "user_follows")
@IdClass(UserFollowsId.class)
public class UserFollows {

    @Id
    @Column(name = "follower_id")
    private String followerId;

    @Id
    @Column(name = "following_id")
    private String followingId;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;
}

// Classe de clé composite
public class UserFollowsId implements Serializable {
    private String followerId;
    private String followingId;
    // equals + hashCode obligatoires
}
```

---

## 5. Sécurité Spring

Ajouter les deux routes en `.authenticated()` :

```java
.requestMatchers(HttpMethod.POST,   "/api/users/*/follow").authenticated()
.requestMatchers(HttpMethod.DELETE, "/api/users/*/follow").authenticated()
```

**Note :** Ces routes sont en `.authenticated()` (strict), contrairement à
`GET /api/users/*/public` (Slice 04) qui est en `.permitAll()`.

---

## 6. Gestion des transactions

Le Python utilise **asyncpg sans transaction explicite** sur le handler.
Les deux opérations (INSERT/DELETE puis COUNT) sont exécutées dans la même connexion
mais pas dans une transaction atomique.

**En Java :** Ne pas encapsuler dans `@Transactional`. Exécuter les deux requêtes
séquentiellement sans transaction — fidèle au comportement Python.

Si un `@Transactional` est ajouté pour les méthodes `@Modifying`, limiter son scope
aux seules méthodes Repository (pas au niveau Service).

---

## 7. Messages d'erreur exacts

Les messages doivent être **identiques au Python** (en français) pour compatibilité frontend :

| Situation | Code | Message exact |
|---|---|---|
| Self-follow | 400 | `"Vous ne pouvez pas vous suivre vous-même."` |
| User cible inexistant | 404 | `"Utilisateur introuvable."` |
| Token absent | 401 | `"Not authenticated"` |

**En Java :** Utiliser `ResponseStatusException` avec `HttpStatus.BAD_REQUEST` / `NOT_FOUND`.
Vérifier que le corps est `{"detail": "<message>"}` (format FastAPI).

Format de corps d'erreur FastAPI à reproduire :
```java
// Dans un ExceptionHandler global ou dans ResponseStatusException
// Le corps doit être : {"detail": "message"}
// Configurer via @ControllerAdvice ou ResponseEntityExceptionHandler
```

---

## 8. Choses à NE PAS faire

| Interdiction | Raison |
|---|---|
| Ne PAS retourner 409 sur double follow | Python retourne 200 silencieusement (ON CONFLICT DO NOTHING) |
| Ne PAS retourner 404 sur unfollow inexistant | Python retourne 200 silencieusement |
| Ne PAS calculer `followers_count ± 1` applicativement | Toujours refaire le SELECT COUNT depuis DB |
| Ne PAS ajouter de self-check dans unfollow | Python n'en a pas — comportement attendu par le frontend |
| Ne PAS ajouter `@Transactional` au niveau Service | Pas de transaction explicite en Python |
| Ne PAS renvoyer le profil complet dans la réponse | Réponse minimaliste : 2 champs seulement |
| Ne PAS vérifier l'existence de la cible dans unfollow | Python ne le fait pas — silencieux |

---

## 9. Critères de Done

- [ ] `POST /api/users/{userId}/follow` retourne `{"is_following": true, "followers_count": N}` — HTTP 200
- [ ] Double follow → HTTP 200, pas de doublon en DB
- [ ] Self-follow → HTTP 400, message exact en français
- [ ] Follow user inexistant → HTTP 404, message exact en français
- [ ] `DELETE /api/users/{userId}/follow` retourne `{"is_following": false, "followers_count": N}` — HTTP 200
- [ ] Unfollow inexistant → HTTP 200 silencieux
- [ ] Unfollow user inexistant → HTTP 200 silencieux
- [ ] Sans token → HTTP 401 (les deux endpoints)
- [ ] Token invalide → HTTP 401 (pas 200 comme Slice 04)
- [ ] TC-11 (séquence F→U→F) → counts cohérents
- [ ] TC-12 (cohérence avec Slice 04 is_following) → valeurs synchronisées
- [ ] Pas de régression sur Slice 02, 03, 04
