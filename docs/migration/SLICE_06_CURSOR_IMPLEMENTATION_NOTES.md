# SLICE_06_CURSOR_IMPLEMENTATION_NOTES.md — Notes pour Cursor
> Basé sur `user_routes.py:568–613`, `auth_utils.py:86–100`.
> Généré le 2026-02-XX.

---

## Prérequis

- Slice 02 : `JwtAuthFilter` + `JwtAuthPrincipal`
- Slice 05 : `UserFollowsRepository` (réutilisé)
- Table `user_blocks` accessible (Supabase)

---

## Architecture cible

```
com.spotu.users/
├── controller/
│   └── FollowListController.java          # GET /followers + GET /following
├── service/
│   └── FollowListService.java             # Orchestration
├── repository/
│   └── FollowListRepository.java          # 2 requêtes SQL natives
└── dto/
    ├── FollowerItemDto.java               # {user_id, name, picture, role, is_following_back, is_blocked}
    └── FollowingItemDto.java              # {user_id, name, picture, role, follows_back, is_blocked}
```

**Note :** Deux DTOs distincts à cause du nom de champ différent (`is_following_back` vs `follows_back`).

---

## 1. DTOs

### `FollowerItemDto` (pour /followers)

```java
public class FollowerItemDto {

    @JsonProperty("user_id")
    private String userId;

    @JsonProperty("name")
    private String name;

    @JsonProperty("picture")
    private String picture;  // nullable

    @JsonProperty("role")
    private String role;

    @JsonProperty("is_following_back")    // NOM EXACT — ne pas renommer
    private boolean isFollowingBack;

    @JsonProperty("is_blocked")
    private boolean isBlocked;
}
```

### `FollowingItemDto` (pour /following)

```java
public class FollowingItemDto {

    @JsonProperty("user_id")
    private String userId;

    @JsonProperty("name")
    private String name;

    @JsonProperty("picture")
    private String picture;  // nullable

    @JsonProperty("role")
    private String role;

    @JsonProperty("follows_back")         // NOM EXACT — différent de FollowerItemDto
    private boolean followsBack;

    @JsonProperty("is_blocked")
    private boolean isBlocked;
}
```

---

## 2. Controller — `FollowListController`

```java
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class FollowListController {

    private final FollowListService followListService;

    @GetMapping("/{userId}/followers")
    public ResponseEntity<List<FollowerItemDto>> listFollowers(
            @PathVariable String userId,
            @AuthenticationPrincipal(required = false) JwtAuthPrincipal principal) {

        String meId = principal != null ? principal.getUserId() : null;
        return ResponseEntity.ok(followListService.getFollowers(userId, meId));
    }

    @GetMapping("/{userId}/following")
    public ResponseEntity<List<FollowingItemDto>> listFollowing(
            @PathVariable String userId,
            @AuthenticationPrincipal(required = false) JwtAuthPrincipal principal) {

        String meId = principal != null ? principal.getUserId() : null;
        return ResponseEntity.ok(followListService.getFollowing(userId, meId));
    }
}
```

**Sécurité :**
```java
.requestMatchers(HttpMethod.GET, "/api/users/*/followers").permitAll()
.requestMatchers(HttpMethod.GET, "/api/users/*/following").permitAll()
```

---

## 3. Service — `FollowListService`

```java
@Service
@RequiredArgsConstructor
public class FollowListService {

    private final FollowListRepository repo;

    public List<FollowerItemDto> getFollowers(String userId, String meId) {
        return repo.findFollowers(userId, meId);
    }

    public List<FollowingItemDto> getFollowing(String userId, String meId) {
        return repo.findFollowing(userId, meId);
    }
}
```

---

## 4. Repository — `FollowListRepository`

### Requête `/followers` (reproduit exactement le SQL Python)

```java
@Repository
public interface FollowListRepository {

    @Query(value = """
        SELECT
            u.user_id,
            u.name,
            u.picture,
            u.role,
            CASE WHEN CAST(:meId AS TEXT) IS NOT NULL THEN
                EXISTS(SELECT 1 FROM user_follows
                       WHERE follower_id = CAST(:meId AS TEXT)
                         AND following_id = u.user_id)
            ELSE FALSE END AS is_following_back,
            CASE WHEN CAST(:meId AS TEXT) IS NOT NULL THEN
                EXISTS(SELECT 1 FROM user_blocks
                       WHERE blocker_id = CAST(:meId AS TEXT)
                         AND blocked_id = u.user_id)
            ELSE FALSE END AS is_blocked
        FROM user_follows uf
        JOIN users u ON u.user_id = uf.follower_id
        WHERE uf.following_id = :userId
        ORDER BY u.name ASC
        """, nativeQuery = true)
    List<FollowerItemDto> findFollowers(@Param("userId") String userId,
                                        @Param("meId") String meId);

    @Query(value = """
        SELECT
            u.user_id,
            u.name,
            u.picture,
            u.role,
            CASE WHEN CAST(:meId AS TEXT) IS NOT NULL THEN
                EXISTS(SELECT 1 FROM user_follows
                       WHERE follower_id = u.user_id
                         AND following_id = CAST(:meId AS TEXT))
            ELSE FALSE END AS follows_back,
            CASE WHEN CAST(:meId AS TEXT) IS NOT NULL THEN
                EXISTS(SELECT 1 FROM user_blocks
                       WHERE blocker_id = CAST(:meId AS TEXT)
                         AND blocked_id = u.user_id)
            ELSE FALSE END AS is_blocked
        FROM user_follows uf
        JOIN users u ON u.user_id = uf.following_id
        WHERE uf.follower_id = :userId
        ORDER BY u.name ASC
        """, nativeQuery = true)
    List<FollowingItemDto> findFollowing(@Param("userId") String userId,
                                          @Param("meId") String meId);
}
```

### Gestion de `meId = null` en Spring Data

En Python, le paramètre `$1::TEXT IS NOT NULL` gère le cas `me_id = None`.
En Java, `@Param("meId")` avec `null` sera passé comme SQL `NULL`.
Le `CAST(:meId AS TEXT) IS NOT NULL` évalue alors à `FALSE` → `CASE WHEN FALSE` → retourne `FALSE`.

**Tester impérativement** : passer `meId = null` depuis Java vers la requête native.
Certains drivers JDBC ont des comportements variables avec `null` dans les CASE WHEN SQL.
Si problème → utiliser deux requêtes séparées (avec et sans meId).

---

## 5. Projections Spring Data pour les DTOs

Utiliser des interfaces de projection pour les résultats des requêtes natives :

```java
// Pour /followers
public interface FollowerProjection {
    String getUser_id();
    String getName();
    String getPicture();
    String getRole();
    boolean getIs_following_back();
    boolean getIs_blocked();
}

// Pour /following
public interface FollowingProjection {
    String getUser_id();
    String getName();
    String getPicture();
    String getRole();
    boolean getFollows_back();
    boolean getIs_blocked();
}
```

Ou mapper manuellement depuis `List<Map<String, Object>>` (plus flexible).

---

## 6. Choses à NE PAS faire

| Interdiction | Raison |
|---|---|
| Ne PAS retourner 401 si token absent | Auth optionnelle — HTTP 200 dans tous les cas |
| Ne PAS retourner 404 si user_id inexistant | Retourner `[]` — comportement Python |
| Ne PAS ajouter de pagination | Python retourne tout sans limit |
| Ne PAS nommer le champ `follows_back` dans `/followers` | Le champ s'appelle `is_following_back` |
| Ne PAS nommer le champ `is_following_back` dans `/following` | Le champ s'appelle `follows_back` |
| Ne PAS trier applicativement | Utiliser `ORDER BY u.name ASC` SQL |
| Ne PAS filtrer les utilisateurs bloqués | `is_blocked` est une info, pas un filtre |
| Ne PAS utiliser `@Transactional` | Lecture seule |

---

## 7. Critères de Done

- [ ] `GET /api/users/{userId}/followers` retourne HTTP 200 avec tableau (vide ou rempli)
- [ ] `GET /api/users/{userId}/following` retourne HTTP 200 avec tableau (vide ou rempli)
- [ ] Token absent → HTTP 200, `is_following_back/follows_back/is_blocked = false`
- [ ] Token invalide → HTTP 200 (pas 401)
- [ ] user_id inexistant → HTTP 200, `[]`
- [ ] Champ `is_following_back` dans `/followers` (pas `follows_back`)
- [ ] Champ `follows_back` dans `/following` (pas `is_following_back`)
- [ ] Tri `ORDER BY u.name ASC` respecté (vérifier avec 5+ items)
- [ ] TC-10 (tri alphabétique) passé
- [ ] TC-11 (noms de champs différents) passé
- [ ] TC-12 (cohérence avec Slice 05) passé
- [ ] Pas de régression sur Slices 02–05
