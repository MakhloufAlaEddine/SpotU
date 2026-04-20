# SLICE_29_CURSOR_IMPLEMENTATION_NOTES.md — Notes pour l'implémentation Java/Spring Boot
> Basé sur `deletion_routes.py:260–431`, règles BR-29.01 à BR-29.13, cas T29-DEL-01 à T29-STRESS-03.
> Généré le 2026-04-20.
>
> ⚠️ **Ne pas inventer de patterns non documentés ici.** Reproduire 1:1 le comportement Python.

---

## 1. Structure recommandée (Spring Boot)

```
src/main/java/com/spotu/tagpoint/lifecycle/
├── controller/
│   └── TagPointLifecycleController.java     ← DELETE + POST reactivate
├── service/
│   └── TagPointLifecycleService.java        ← Logique métier + transaction
├── repository/
│   ├── TagPointRepository.java              ← (déjà créée en S27/S28 — étendre)
│   ├── ConversationContextRepository.java   ← NOUVEAU (update context_deleted)
│   ├── PendingFileDeletionRepository.java   ← NOUVEAU
│   └── SpotYouMembersRepository.java        ← (déjà créée — réutiliser le SELECT)
├── dto/
│   ├── DeleteTagPointResponse.java
│   └── ReactivateTagPointResponse.java
├── event/
│   ├── SpotYouDeletedEvent.java             ← ApplicationEvent (post-commit)
│   └── SpotYouReactivatedEvent.java         ← ApplicationEvent (post-commit)
└── listener/
    └── SpotYouLifecyclePushListener.java    ← @TransactionalEventListener AFTER_COMMIT
```

---

## 2. Controller — signatures

```java
@RestController
@RequestMapping("/api/tag-points")
@RequiredArgsConstructor
public class TagPointLifecycleController {

    private final TagPointLifecycleService service;

    @DeleteMapping("/{pointId}")
    public DeleteTagPointResponse softDelete(
            @PathVariable String pointId,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return service.softDelete(pointId, caller);
    }

    @PostMapping("/{pointId}/reactivate")
    public ReactivateTagPointResponse reactivate(
            @PathVariable String pointId,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return service.reactivate(pointId, caller);
    }
}
```

- **Pas de `@RequestBody`** — les 2 endpoints n'acceptent pas de body.
- `AuthenticatedUser` doit exposer : `user_id`, `role`, `name`, `picture` (cf. BR-29.10 dépendance S23).

---

## 3. Service — implémentation

### 3.1 `TagPointLifecycleService.softDelete`

```java
private static final Duration MEDIA_RETENTION = Duration.ofDays(90);

@Transactional
public DeleteTagPointResponse softDelete(String pointId, AuthenticatedUser caller) {
    Instant now = Instant.now();
    Instant mediaPurgeAt = now.plus(MEDIA_RETENTION);

    // Guards — ordre strict 404 → 409 → 403
    TagPointGuardRow tp = tagPointRepo.findGuardRowForLifecycle(pointId)
        .orElseThrow(() -> new NotFoundException("SpotYou introuvable"));
    if (tp.deletedAt() != null) {
        throw new ConflictException("Ce SpotYou est déjà supprimé");
    }
    boolean isAdmin = "admin".equals(caller.role());
    if (!Objects.equals(tp.userId(), caller.userId()) && !isAdmin) {
        throw new ForbiddenException("Non autorisé");
    }

    // Mutations (même ordre que Python)
    tagPointRepo.softDelete(pointId, now, caller.userId(), mediaPurgeAt);

    int conversationsMarked = conversationRepo.markContextDeleted(List.of(pointId));

    List<String> imageUrls = ImagesJson.parse(tp.imagesRaw()); // _parse_images equiv.
    int imagesQueued = pendingFileDeletionRepo.scheduleAll(
        imageUrls, "tag_point", pointId, mediaPurgeAt
    );

    List<String> memberUserIds = membersRepo.findUserIdsExceptOwner(pointId, tp.userId());

    // Event post-commit pour push
    String titleStr = (tp.title() == null || tp.title().isEmpty()) ? "SpotYou" : tp.title();
    applicationEventPublisher.publishEvent(new SpotYouDeletedEvent(
        pointId, caller, titleStr, tp.imagesRaw(), memberUserIds
    ));

    log.info("[SOFTDEL] SpotYou {} supprimé par {} (médias dans {}j, membres notifiés: {})",
             pointId, caller.userId(), MEDIA_RETENTION.toDays(), memberUserIds.size());

    return new DeleteTagPointResponse(
        true, true, pointId,
        conversationsMarked, imagesQueued, memberUserIds.size(),
        mediaPurgeAt
    );
}
```

### 3.2 `TagPointLifecycleService.reactivate`

```java
@Transactional
public ReactivateTagPointResponse reactivate(String pointId, AuthenticatedUser caller) {
    Instant now = Instant.now();

    // Guards — ordre strict 404 → 409 → 403
    TagPointReactivateGuardRow tp = tagPointRepo.findReactivateGuardRow(pointId)
        .orElseThrow(() -> new NotFoundException("SpotYou introuvable"));
    if (tp.active() && tp.deletedAt() == null) {
        throw new ConflictException("Ce SpotYou est déjà actif");
    }
    boolean isAdmin = "admin".equals(caller.role());
    if (!Objects.equals(tp.userId(), caller.userId()) && !isAdmin) {
        throw new ForbiddenException("Non autorisé");
    }

    int cancelled = pendingFileDeletionRepo.cancelPending(pointId);

    tagPointRepo.reactivate(pointId, now);

    conversationRepo.unmarkContextDeleted(pointId);

    List<String> memberUserIds = membersRepo.findUserIdsExceptOwner(pointId, caller.userId());

    String titleRaw = (tp.title() == null || tp.title().isEmpty()) ? "SpotYou" : tp.title();
    String titleStr = titleRaw.length() > 50 ? titleRaw.substring(0, 50) : titleRaw;
    applicationEventPublisher.publishEvent(new SpotYouReactivatedEvent(
        pointId, caller, titleStr, memberUserIds
    ));

    log.info("[REACTIVATE] SpotYou {} réactivé par {} (médias_purgés={}, membres notifiés: {})",
             pointId, caller.userId(), tp.mediaPurged(), memberUserIds.size());

    return new ReactivateTagPointResponse(
        true, true, pointId,
        tp.mediaPurged(), tp.mediaPurged(), cancelled
    );
}
```

> **NOTE** : `requires_media_reupload == media_purged` (deux fois le même booléen sérialisé).

---

## 4. Repositories — requêtes exactes

### 4.1 `TagPointRepository`

```java
interface TagPointRepository {

    @Query("""
        SELECT user_id AS userId,
               images  AS imagesRaw,
               title,
               deleted_at AS deletedAt
          FROM tag_points
         WHERE point_id = :pointId
    """)
    Optional<TagPointGuardRow> findGuardRowForLifecycle(@Param("pointId") String pointId);

    @Query("""
        SELECT user_id     AS userId,
               deleted_at  AS deletedAt,
               active,
               media_purged AS mediaPurged,
               title
          FROM tag_points
         WHERE point_id = :pointId
    """)
    Optional<TagPointReactivateGuardRow> findReactivateGuardRow(@Param("pointId") String pointId);

    @Modifying
    @Query("""
        UPDATE tag_points
           SET active                   = FALSE,
               deleted_at               = :now,
               deleted_by               = :deletedBy,
               updated_at               = :now,
               media_purge_scheduled_at = :mediaPurgeAt
         WHERE point_id = :pointId
    """)
    int softDelete(@Param("pointId") String pointId,
                   @Param("now") Instant now,
                   @Param("deletedBy") String deletedBy,
                   @Param("mediaPurgeAt") Instant mediaPurgeAt);

    @Modifying
    @Query("""
        UPDATE tag_points
           SET active                   = TRUE,
               deleted_at               = NULL,
               deleted_by               = NULL,
               updated_at               = :now,
               media_purge_scheduled_at = NULL,
               media_purge_notified_at  = NULL,
               reactivated_at           = :now
         WHERE point_id = :pointId
    """)
    int reactivate(@Param("pointId") String pointId, @Param("now") Instant now);
}
```

### 4.2 `ConversationContextRepository`

```java
interface ConversationContextRepository {

    /**
     * Retourne le nombre de conversations marquées (via RETURNING).
     * Attention : SQL natif car Spring Data JPA @Modifying ne supporte pas RETURNING directement.
     */
    @Query(value = """
        UPDATE conversations
           SET context_deleted = TRUE
         WHERE context_id = ANY(:contextIds)
           AND context_deleted = FALSE
         RETURNING conversation_id
    """, nativeQuery = true)
    List<String> markContextDeletedReturning(@Param("contextIds") String[] contextIds);

    default int markContextDeleted(List<String> contextIds) {
        if (contextIds == null || contextIds.isEmpty()) return 0;
        return markContextDeletedReturning(contextIds.toArray(new String[0])).size();
    }

    @Modifying
    @Query(value = """
        UPDATE conversations
           SET context_deleted = FALSE
         WHERE context_id = :contextId
           AND context_deleted = TRUE
    """, nativeQuery = true)
    void unmarkContextDeleted(@Param("contextId") String contextId);
}
```

### 4.3 `PendingFileDeletionRepository`

```java
interface PendingFileDeletionRepository {

    @Modifying
    @Query(value = """
        INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at)
        VALUES (:fileUrl, :entityType, :entityId, :scheduledAt)
        ON CONFLICT DO NOTHING
    """, nativeQuery = true)
    int insertIfAbsent(@Param("fileUrl") String fileUrl,
                       @Param("entityType") String entityType,
                       @Param("entityId") String entityId,
                       @Param("scheduledAt") Instant scheduledAt);

    default int scheduleAll(List<String> urls, String entityType, String entityId, Instant scheduledAt) {
        int count = 0;
        for (String url : urls) {
            if (url != null && !url.isEmpty()) {
                insertIfAbsent(url, entityType, entityId, scheduledAt);
                count++;  // mirror Python : incrémente même si ON CONFLICT DO NOTHING
            }
        }
        return count;
    }

    @Modifying
    @Query(value = """
        DELETE FROM pending_file_deletions
         WHERE entity_id = :entityId
           AND status    = 'pending'
    """, nativeQuery = true)
    int cancelPending(@Param("entityId") String entityId);
}
```

> ⚠️ **`scheduleAll` count logic** : Python incrémente `count` pour chaque URL **non-vide**, indépendamment du succès SQL (ON CONFLICT fait silence). Java doit faire pareil — ne PAS utiliser le count du `INSERT` retourné, utiliser le count des URLs itérées.

### 4.4 `SpotYouMembersRepository`

```java
interface SpotYouMembersRepository {

    @Query(value = """
        SELECT user_id
          FROM spot_you_members
         WHERE spot_you_id = :spotYouId
           AND user_id    != :excludedUserId
    """, nativeQuery = true)
    List<String> findUserIdsExceptOwner(
        @Param("spotYouId") String spotYouId,
        @Param("excludedUserId") String excludedUserId);
}
```

> ⚠️ **Pas de filtre sur `status='accepted'`** — cf. BR-29 DB_MAPPING. Compat stricte.

---

## 5. Helper `ImagesJson.parse` (équivalent `_parse_images`)

```java
public final class ImagesJson {
    private static final ObjectMapper M = new ObjectMapper();

    public static List<String> parse(Object raw) {
        if (raw == null) return List.of();
        if (raw instanceof List<?> list) {
            return list.stream().filter(Objects::nonNull).map(Object::toString).toList();
        }
        if (raw instanceof String s) {
            if (s.isEmpty()) return List.of();
            try {
                return M.readValue(s, new TypeReference<List<String>>() {});
            } catch (Exception e) {
                return List.of();  // silent fallback, comme Python
            }
        }
        return List.of();
    }

    public static String firstImage(Object raw) {
        List<String> imgs = parse(raw);
        return imgs.isEmpty() ? null : imgs.get(0);
    }
}
```

---

## 6. Events & Listener (push post-commit)

```java
public record SpotYouDeletedEvent(
    String pointId,
    AuthenticatedUser sender,
    String titleStr,
    Object imagesRaw,
    List<String> memberUserIds
) {}

public record SpotYouReactivatedEvent(
    String pointId,
    AuthenticatedUser sender,
    String titleStr,       // déjà tronqué à 50 chars dans le service
    List<String> memberUserIds
) {}
```

```java
@Component
@RequiredArgsConstructor
public class SpotYouLifecyclePushListener {

    private final PushService pushService;

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onDeleted(SpotYouDeletedEvent e) {
        String firstImg = ImagesJson.firstImage(e.imagesRaw());
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("type", "spotyu_deactivated");
        data.put("point_id", e.pointId());
        data.put("sender_id", e.sender().userId());
        data.put("sender_name", e.sender().name());
        data.put("sender_picture", e.sender().picture() != null ? e.sender().picture() : "");
        data.put("action_text", "a désactivé le SpotYou");
        data.put("content_title", e.titleStr());
        data.put("image_url", firstImg);

        String body = '"' + e.titleStr() + "\" a été désactivé. Vous pouvez encore quitter cette communauté depuis votre onglet Communautés.";
        for (String uid : e.memberUserIds()) {
            pushService.sendPushToUser(uid,
                "SpotYou désactivé", body, data, "spotyu_deactivated");
        }
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onReactivated(SpotYouReactivatedEvent e) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("type", "spotyu_reactivated");
        data.put("point_id", e.pointId());

        String body = "«" + e.titleStr() + "» est de retour ! Rejoignez les prochaines séances.";
        for (String uid : e.memberUserIds()) {
            pushService.sendPushToUser(uid,
                "SpotYou réactivé 🎉", body, data, "spotyu_reactivated");
        }
    }
}
```

---

## 7. DTOs — ordre des champs JSON (strict)

```java
@JsonPropertyOrder({
    "success", "deleted", "point_id",
    "conversations_marked", "images_queued", "members_notified",
    "media_purge_scheduled_at"
})
public record DeleteTagPointResponse(
    boolean success,
    boolean deleted,
    @JsonProperty("point_id") String pointId,
    @JsonProperty("conversations_marked") int conversationsMarked,
    @JsonProperty("images_queued") int imagesQueued,
    @JsonProperty("members_notified") int membersNotified,
    @JsonProperty("media_purge_scheduled_at") Instant mediaPurgeScheduledAt
) {}

@JsonPropertyOrder({
    "success", "reactivated", "point_id",
    "media_purged", "requires_media_reupload", "pending_deletions_cancelled"
})
public record ReactivateTagPointResponse(
    boolean success,
    boolean reactivated,
    @JsonProperty("point_id") String pointId,
    @JsonProperty("media_purged") boolean mediaPurged,
    @JsonProperty("requires_media_reupload") boolean requiresMediaReupload,
    @JsonProperty("pending_deletions_cancelled") int pendingDeletionsCancelled
) {}
```

**ISO-8601 format Instant** : configurer `ObjectMapper` avec `.registerModule(new JavaTimeModule()).disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)`. Pour reproduire `+00:00` (et pas `Z`), utiliser un sérialiseur custom :

```java
public class InstantAsOffsetSerializer extends JsonSerializer<Instant> {
    private static final DateTimeFormatter FMT =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSSSSxxx")
                         .withZone(ZoneOffset.UTC);
    @Override public void serialize(Instant v, JsonGenerator g, SerializerProvider s) throws IOException {
        g.writeString(FMT.format(v));
    }
}
```

Appliquer via `@JsonSerialize(using = InstantAsOffsetSerializer.class)` sur le champ.

---

## 8. Exceptions → HTTP

```java
@ControllerAdvice
public class LifecycleExceptionHandler {
    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<Map<String,String>> notFound(NotFoundException e) {
        return ResponseEntity.status(404).body(Map.of("detail", e.getMessage()));
    }
    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<Map<String,String>> conflict(ConflictException e) {
        return ResponseEntity.status(409).body(Map.of("detail", e.getMessage()));
    }
    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<Map<String,String>> forbidden(ForbiddenException e) {
        return ResponseEntity.status(403).body(Map.of("detail", e.getMessage()));
    }
}
```

> **Clé `"detail"`** et pas `"message"` — compat FastAPI. Cf. T29-COMPAT-02.

---

## 9. Transaction & ordre d'écriture

### Ordre obligatoire dans `softDelete` (service)
1. SELECT guard (hors mutation)
2. UPDATE tag_points
3. UPDATE conversations (+ collect count)
4. INSERT pending_file_deletions × N (loop)
5. SELECT spot_you_members
6. `publishEvent` (NE déclenche les push qu'APRÈS commit)
7. log + return

### Ordre obligatoire dans `reactivate`
1. SELECT guard
2. DELETE pending_file_deletions
3. UPDATE tag_points
4. UPDATE conversations
5. SELECT spot_you_members
6. `publishEvent`
7. log + return

> ⚠️ Si Java veut factoriser ou réorganiser pour "propreté" → **NE PAS FAIRE**. La compat stricte exige cet ordre exact (tests golden path le vérifient).

---

## 10. Critères de "Done"

| # | Critère | Comment tester |
|---|---|---|
| 1 | 2 endpoints REST exposés et accessibles | `curl DELETE/POST` → HTTP 200 sur cas nominal |
| 2 | Ordre strict 404→409→403 respecté | T29-DEL-08, T29-REA-08 |
| 3 | Soft-delete ne supprime pas physiquement | Vérifier row `tag_points` reste, `active=FALSE` |
| 4 | Reactivate avant J+90 restaure complètement | T29-REA-01 passe |
| 5 | Reactivate après J+90 renvoie `requires_media_reupload=true` | T29-REA-02 passe |
| 6 | Conversations `context_deleted` synchronisé bidirectionnel | T29-DEL-01, T29-REA-01 |
| 7 | Push envoyés uniquement APRÈS commit (pas sur rollback) | Test avec exception mid-transaction |
| 8 | Push payload exact (keys, types, valeurs) | T29-COMPAT-04 |
| 9 | Messages d'erreur "detail" exacts | T29-COMPAT-02 |
| 10 | `media_purge_scheduled_at` format ISO-8601 avec `+00:00` | T29-COMPAT-03 |
| 11 | `ON CONFLICT DO NOTHING` sur `pending_file_deletions` | Test concurrent T29-STRESS-03 |
| 12 | REACTIVATE NULL-out `media_purge_notified_at` | Assert DB après T29-REA-01 |
| 13 | Aucune modif du schéma DB | `git diff migrations/` = vide |
| 14 | Aucune régression S26/S27/S28 | Lancer suites de test des 3 slices précédentes |
| 15 | Workers `media_purge_worker` et `media_notif_worker` continuent de fonctionner | Test d'intégration bout-à-bout |

---

## 11. Pièges à éviter

| # | Piège | Mitigation |
|---|---|---|
| 1 | Swap 409/403 (sémantique sécurité) | Code review + test T29-DEL-08 |
| 2 | Utiliser `@EventListener` au lieu de `@TransactionalEventListener(AFTER_COMMIT)` → push sur rollback | Obliger `phase = AFTER_COMMIT` |
| 3 | Sérialiser `Instant` en ISO-8601 avec `Z` au lieu de `+00:00` | Serializer custom (§7) |
| 4 | Filtrer `spot_you_members.status='accepted'` (harmonisation "logique") | Compat stricte = PAS de filtre (cf. BR-29) |
| 5 | Tronquer `title_str` à 50 chars aussi au DELETE (harmonisation) | Compat stricte = troncature REACTIVATE uniquement |
| 6 | Retourner `conversations_marked` aussi dans REACTIVATE | Compat stricte = absent |
| 7 | Renvoyer `null` pour `sender_picture` au lieu de `""` | `caller.picture != null ? picture : ""` |
| 8 | Utiliser JPA `@Entity` qui cache les colonnes `deleted_at`, `media_purge_scheduled_at` via `@SoftDelete` annotation | NE PAS utiliser les soft-delete annotations natives Hibernate — piloter nous-mêmes. Sinon les SELECT des autres slices (S26/S27) vont implicitement cacher les soft-deleted. |
| 9 | Utiliser `setActive(false)` sans toucher les autres colonnes | Obligation d'écrire **5 colonnes** au DELETE, **6 colonnes** à la REACTIVATE |
| 10 | Parser `images` avec une lib JSON stricte qui throw sur format inattendu | Utiliser `ImagesJson.parse` (silent fallback à `[]`) |
| 11 | Utiliser `@Query` JPQL pour `ANY($1::text[])` | Obliger SQL natif (`nativeQuery = true`) |
| 12 | Oublier `ON CONFLICT DO NOTHING` sur INSERT `pending_file_deletions` | Idempotence retry + concurrence T29-STRESS-03 |
| 13 | Incrémenter `imagesQueued` uniquement sur INSERT réel | **Compter les URLs non-vides itérées**, pas les inserts DB réussis |

---

## 12. Validation finale avant merge

- [ ] 30 cas de test passent (cf. SLICE_29_TEST_CASES.md)
- [ ] Aucune modif hors périmètre (`git diff --stat` : uniquement les nouveaux fichiers Java de §1)
- [ ] Tests Python existants passent toujours (non-régression si le Python tourne en parallèle pendant la phase de migration progressive)
- [ ] Workers `media_purge_worker` / `media_notif_worker` consomment correctement les colonnes écrites par le Java
- [ ] Docs OpenAPI générées matchent les specs (cf. SLICE_29_API_CONTRACTS.md)
