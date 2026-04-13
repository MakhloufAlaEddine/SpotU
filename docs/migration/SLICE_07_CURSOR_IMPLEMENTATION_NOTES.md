# SLICE_07_CURSOR_IMPLEMENTATION_NOTES.md — Notes pour Cursor
> Basé sur `user_routes.py:632–664`, `migrations/001_initial_schema.sql`.
> Généré le 2026-02-XX.

---

## Prérequis

- Slice 02 : `JwtAuthFilter`, `JwtAuthPrincipal`
- Slice 05 : `UserFollowsRepository` (réutilisé pour le DELETE bidirectionnel)

---

## Architecture cible

```
com.spotu.users/
├── controller/
│   └── BlockController.java               # POST + DELETE /api/users/{userId}/block
├── service/
│   └── BlockService.java                  # Logique + règles
├── repository/
│   ├── UserBlocksRepository.java          # INSERT ON CONFLICT, DELETE
│   └── UserFollowsRepository.java         # Réutilisé — DELETE bidirectionnel (Slice 05)
└── dto/
    └── BlockResponseDto.java              # {"blocked": boolean}
```

---

## 1. DTO — `BlockResponseDto`

```java
public class BlockResponseDto {

    @JsonProperty("blocked")
    private boolean blocked;

    public BlockResponseDto(boolean blocked) {
        this.blocked = blocked;
    }

    // getter
}
```

---

## 2. Controller — `BlockController`

```java
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class BlockController {

    private final BlockService blockService;

    @PostMapping("/{userId}/block")
    public ResponseEntity<BlockResponseDto> blockUser(
            @PathVariable String userId,
            @AuthenticationPrincipal JwtAuthPrincipal principal) {

        blockService.block(principal.getUserId(), userId);
        return ResponseEntity.ok(new BlockResponseDto(true));
    }

    @DeleteMapping("/{userId}/block")
    public ResponseEntity<BlockResponseDto> unblockUser(
            @PathVariable String userId,
            @AuthenticationPrincipal JwtAuthPrincipal principal) {

        blockService.unblock(principal.getUserId(), userId);
        return ResponseEntity.ok(new BlockResponseDto(false));
    }
}
```

**Sécurité :**
```java
.requestMatchers(HttpMethod.POST,   "/api/users/*/block").authenticated()
.requestMatchers(HttpMethod.DELETE, "/api/users/*/block").authenticated()
```

---

## 3. Service — `BlockService`

```java
@Service
@RequiredArgsConstructor
public class BlockService {

    private final UserBlocksRepository blocksRepo;
    private final UserFollowsRepository followsRepo;

    public void block(String blockerId, String targetId) {

        // RG-02 — Self-block interdit
        if (blockerId.equals(targetId)) {
            throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                "Vous ne pouvez pas vous bloquer vous-même."
            );
        }

        // R1 — DELETE follows bidirectionnel
        followsRepo.deleteBidirectional(blockerId, targetId);

        // R2 — INSERT block ON CONFLICT DO NOTHING
        blocksRepo.blockUser(blockerId, targetId);
    }

    public void unblock(String blockerId, String targetId) {

        // Pas de self-check, pas de vérif existence

        // R3 — DELETE block (silencieux si inexistant)
        blocksRepo.unblockUser(blockerId, targetId);
    }
}
```

---

## 4. Repository — `UserBlocksRepository`

```java
@Repository
public interface UserBlocksRepository extends JpaRepository<UserBlocks, UserBlocksId> {

    // R2 — INSERT ON CONFLICT DO NOTHING
    @Modifying
    @Transactional
    @Query(value = """
        INSERT INTO user_blocks(blocker_id, blocked_id)
        VALUES(:blockerId, :blockedId)
        ON CONFLICT DO NOTHING
        """, nativeQuery = true)
    void blockUser(@Param("blockerId") String blockerId,
                   @Param("blockedId") String blockedId);

    // R3 — DELETE block
    @Modifying
    @Transactional
    @Query(value = """
        DELETE FROM user_blocks
        WHERE blocker_id = :blockerId AND blocked_id = :blockedId
        """, nativeQuery = true)
    int unblockUser(@Param("blockerId") String blockerId,
                    @Param("blockedId") String blockedId);
}
```

### Entité `UserBlocks`

```java
@Entity
@Table(name = "user_blocks")
@IdClass(UserBlocksId.class)
public class UserBlocks {

    @Id
    @Column(name = "blocker_id")
    private String blockerId;

    @Id
    @Column(name = "blocked_id")
    private String blockedId;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;
}

public class UserBlocksId implements Serializable {
    private String blockerId;
    private String blockedId;
    // equals + hashCode obligatoires
}
```

---

## 5. Repository — Extension de `UserFollowsRepository` (Slice 05)

Ajouter la méthode de DELETE bidirectionnel à `UserFollowsRepository` (créé en Slice 05) :

```java
// Dans UserFollowsRepository.java — ajouter cette méthode
@Modifying
@Transactional
@Query(value = """
    DELETE FROM user_follows
    WHERE (follower_id = :userId1 AND following_id = :userId2)
       OR (follower_id = :userId2 AND following_id = :userId1)
    """, nativeQuery = true)
int deleteBidirectional(@Param("userId1") String userId1,
                        @Param("userId2") String userId2);
```

---

## 6. Gestion des transactions (décision de conception)

**Python :** Pas de transaction explicite — `R1` puis `R2` séquentiellement dans la même connexion.

**Java — deux options :**

**Option A (fidèle Python) :** Pas de `@Transactional` au niveau Service.
```java
// Pas d'annotation — risque de split si coupure entre R1 et R2
followsRepo.deleteBidirectional(blockerId, targetId);
blocksRepo.blockUser(blockerId, targetId);
```

**Option B (recommandée) :** Ajouter `@Transactional` au service pour garantir l'atomicité.
```java
@Transactional
public void block(String blockerId, String targetId) {
    // ...
}
```
Cela améliore légèrement le comportement Python sans changer la sémantique visible.
**Recommandé** car le Python ne gère pas non plus le cas de panne partielle.

---

## 7. Messages d'erreur exacts

| Situation | Code | Message exact (à reproduire fidèlement) |
|---|---|---|
| Self-block | 400 | `"Vous ne pouvez pas vous bloquer vous-même."` |
| Token absent | 401 | `"Not authenticated"` |

Format FastAPI à reproduire : `{"detail": "<message>"}`

---

## 8. Choses à NE PAS faire

| Interdiction | Raison |
|---|---|
| Ne PAS retourner 409 sur double block | Python retourne 200 (`ON CONFLICT DO NOTHING`) |
| Ne PAS retourner 404 si user_id inconnu | Python ne vérifie pas — silencieux |
| Ne PAS restaurer les follows dans unblock | Python ne le fait pas |
| Ne PAS ajouter self-check dans unblock | Python n'en a pas |
| Ne PAS oublier le DELETE `user_follows` bidirectionnel dans block | Effet secondaire clé |
| Ne PAS utiliser `DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2` uniquement | Il faut le DELETE **bidirectionnel** (les deux sens avec OR) |

---

## 9. Critères de Done

- [ ] `POST /api/users/{userId}/block` retourne `{"blocked": true}` — HTTP 200
- [ ] Bloc insère dans `user_blocks`
- [ ] Bloc supprime les follows bidirectionnels dans `user_follows`
- [ ] Double block → HTTP 200, pas de doublon
- [ ] Self-block → HTTP 400, message exact en français
- [ ] `DELETE /api/users/{userId}/block` retourne `{"blocked": false}` — HTTP 200
- [ ] Unblock supprime de `user_blocks` uniquement
- [ ] Unblock ne modifie pas `user_follows`
- [ ] Unblock inexistant → HTTP 200 silencieux
- [ ] Sans token → HTTP 401 (les deux endpoints)
- [ ] TC-09 (follows non restaurés après unblock) passé
- [ ] TC-12 (cohérence Slice 04 après block) passé
- [ ] TC-13 (follow possible après unblock) passé
- [ ] Pas de régression sur Slices 02–06
