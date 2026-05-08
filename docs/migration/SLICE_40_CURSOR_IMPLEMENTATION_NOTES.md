# SLICE_40_CURSOR_IMPLEMENTATION_NOTES.md — Notes implémentation Cursor (Java/Spring)
> Basé sur `routes/product_creation_routes.py:459–556` + `media_purge_worker.py:1–127` + `migrations/009_*.sql` + `migrations/011_*.sql`.
> Généré le 2026-04-30.

---

## 1. Squelette Spring Boot

### Package
```
com.spotyou.product.lifecycle
├── controller/ProductLifecycleController.java
├── service/ProductLifecycleService.java
├── service/MediaPurgeWorker.java                     # Spring @Scheduled
├── service/FilePurgeService.java                     # STUB pour S40 (vraie purge en slice infra)
├── repository/MarketplaceProductLifecycleRepository.java
├── repository/PendingFileDeletionRepository.java
├── dto/DeleteProductResponse.java                    # {ok, media_purge_scheduled_at}
├── dto/ReactivateProductResponse.java                # {ok, reactivated, product_id, media_purged, requires_media_reupload}
└── dto/ProductLifecycleRow.java                      # SELECT existence (DELETE + reactivate read)
```

### Controller mappings

```java
@RestController
@RequestMapping("/api/products")
@RequiredArgsConstructor
public class ProductLifecycleController {

    private final ProductLifecycleService service;

    @DeleteMapping("/{productId}")
    public DeleteProductResponse delete(
            @PathVariable String productId,
            @AuthenticationPrincipal AuthUser user) {
        return service.softDelete(productId, user.userId());
    }

    @PostMapping("/{productId}/reactivate")
    public ReactivateProductResponse reactivate(
            @PathVariable String productId,
            @AuthenticationPrincipal AuthUser user) {
        return service.reactivate(productId, user.userId(), user.isAdmin());
    }
}
```

> ⚠️ **Path `/api/products/{...}`** (PAS `/api/marketplace/products/{...}` — voir SCOPE).

---

## 2. Service — flow `softDelete`

```java
@Service
@RequiredArgsConstructor
public class ProductLifecycleService {

    private final MarketplaceProductLifecycleRepository repo;
    private final PendingFileDeletionRepository pfdRepo;
    private final ObjectMapper objectMapper;

    @Transactional
    public DeleteProductResponse softDelete(String productId, String userId) {
        // 1. SELECT existence + ownership + non-deleted
        ProductLifecycleRow row = repo.findActiveByIdAndSeller(productId, userId)
            .orElseThrow(() -> new NotFoundJsonResponseException("Produit introuvable ou non autorisé."));

        // 2. Calcul timestamps
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        OffsetDateTime mediaPurgeAt = now.plusDays(90);

        // 3. UPDATE soft-delete
        repo.softDelete(productId, userId, now, mediaPurgeAt);

        // 4. Parse image_urls (BR-40.04 + PIÈGE-DB-06)
        List<String> imgs = parseImageUrls(row.getImageUrls());

        // 5. INSERT pending_file_deletions (1 par image)
        for (String url : imgs) {
            if (url != null && !url.isEmpty()) {
                pfdRepo.scheduleDeletion(url, "product", productId, mediaPurgeAt);
            }
        }

        return new DeleteProductResponse(true, mediaPurgeAt);
    }

    private List<String> parseImageUrls(Object raw) {
        if (raw == null) return List.of();
        if (raw instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        if (raw instanceof String s) {
            try {
                return objectMapper.readValue(s, new TypeReference<List<String>>() {});
            } catch (Exception e) {
                return List.of();  // fallback Python-compat
            }
        }
        return List.of();
    }
}
```

### Exception personnalisée DELETE (clé JSON `error` ≠ `detail`)

```java
@ResponseStatus(HttpStatus.NOT_FOUND)
public class NotFoundJsonResponseException extends RuntimeException {
    public NotFoundJsonResponseException(String msg) { super(msg); }
}

@ExceptionHandler(NotFoundJsonResponseException.class)
public ResponseEntity<Map<String,String>> handle(NotFoundJsonResponseException ex) {
    return ResponseEntity.status(404).body(Map.of("error", ex.getMessage()));
}
```

---

## 3. Service — flow `reactivate`

```java
@Transactional
public ReactivateProductResponse reactivate(String productId, String userId, boolean isAdmin) {
    // 1. SELECT existence (sans filtre seller_id)
    ProductLifecycleRow row = repo.findById(productId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Produit introuvable"));

    // 2. Validations (ordre exact : 404 > 409 > 403)
    if (!"deleted".equals(row.getStatus()) || row.getDeletedAt() == null) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "Ce produit n'est pas supprimé");
    }
    if (!row.getSellerId().equals(userId) && !isAdmin) {
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Non autorisé");
    }

    // 3. Capture media_purged AVANT update (la valeur restera celle-ci dans la réponse — BR-40.08)
    boolean wasPurged = row.isMediaPurged();

    // 4. DELETE pending_file_deletions status='pending'
    pfdRepo.cancelPendingForEntity(productId, "product");

    // 5. UPDATE restauration (status=active, reactivated_at=now)
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    repo.reactivate(productId, now);

    return new ReactivateProductResponse(true, true, productId, wasPurged, wasPurged);
}
```

> ⚠️ `ResponseStatusException` génère par défaut un body `{"detail": "..."}` côté Spring 6 (à confirmer selon `spring.mvc.problemdetails.enabled`). Sinon, créer des exceptions customs avec handler retournant `Map.of("detail", msg)`.

---

## 4. Repository

### `MarketplaceProductLifecycleRepository`

```java
@Repository
@RequiredArgsConstructor
public class MarketplaceProductLifecycleRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public Optional<ProductLifecycleRow> findActiveByIdAndSeller(String productId, String sellerId) {
        return jdbc.query("""
            SELECT product_id, image_urls, cover_image_url, seller_id, status, deleted_at, media_purged
            FROM marketplace_products
            WHERE product_id = :pid AND seller_id = :sid AND status != 'deleted'
        """, Map.of("pid", productId, "sid", sellerId), rowMapper)
            .stream().findFirst();
    }

    public Optional<ProductLifecycleRow> findById(String productId) {
        return jdbc.query("""
            SELECT product_id, image_urls, cover_image_url, seller_id, status, deleted_at, media_purged, title
            FROM marketplace_products
            WHERE product_id = :pid
        """, Map.of("pid", productId), rowMapper).stream().findFirst();
    }

    public void softDelete(String productId, String userId, OffsetDateTime now, OffsetDateTime purgeAt) {
        jdbc.update("""
            UPDATE marketplace_products
            SET status = 'deleted',
                deleted_at = :now,
                deleted_by = :uid,
                media_purge_scheduled_at = :purgeAt,
                updated_at = :now
            WHERE product_id = :pid AND seller_id = :uid AND status != 'deleted'
        """, Map.of("pid", productId, "uid", userId, "now", now, "purgeAt", purgeAt));
        // Note: AND seller_id ajouté par défense en profondeur (PIÈGE-DB-02)
        // Note: AND status != 'deleted' ajouté pour fermer PIÈGE-DB-03
    }

    public void reactivate(String productId, OffsetDateTime now) {
        jdbc.update("""
            UPDATE marketplace_products
            SET status = 'active',
                deleted_at = NULL,
                deleted_by = NULL,
                updated_at = :now,
                media_purge_scheduled_at = NULL,
                media_purge_notified_at = NULL,
                reactivated_at = :now
            WHERE product_id = :pid
        """, Map.of("pid", productId, "now", now));
    }

    /** Worker scan + UPDATE batch */
    public List<String> findDueForMediaPurge(OffsetDateTime now) {
        return jdbc.queryForList("""
            SELECT product_id
            FROM marketplace_products
            WHERE media_purge_scheduled_at <= :now
              AND media_purged = FALSE
              AND deleted_at IS NOT NULL AND status = 'deleted'
              AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
        """, Map.of("now", now), String.class);
    }

    public void markMediaPurged(List<String> ids, OffsetDateTime now) {
        if (ids.isEmpty()) return;
        jdbc.update("""
            UPDATE marketplace_products
            SET media_purged = TRUE, media_purged_at = :now
            WHERE product_id = ANY(:ids)
        """, new MapSqlParameterSource()
            .addValue("now", now)
            .addValue("ids", ids.toArray(new String[0])));
    }
}
```

### `PendingFileDeletionRepository`

```java
@Repository
@RequiredArgsConstructor
public class PendingFileDeletionRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public void scheduleDeletion(String fileUrl, String entityType, String entityId, OffsetDateTime scheduledAt) {
        jdbc.update("""
            INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at)
            VALUES (:url, :type, :id, :sched)
            ON CONFLICT DO NOTHING
        """, Map.of("url", fileUrl, "type", entityType, "id", entityId, "sched", scheduledAt));
    }

    public int cancelPendingForEntity(String entityId, String entityType) {
        return jdbc.update("""
            DELETE FROM pending_file_deletions
            WHERE entity_id = :id AND entity_type = :type AND status = 'pending'
        """, Map.of("id", entityId, "type", entityType));
        // Note: AND entity_type ajouté par défense en profondeur (PIÈGE-DB-07)
    }
}
```

> ⚠️ **`image_urls` mapping** : si la colonne est `text[]`, utiliser `(String[]) rs.getArray("image_urls").getArray()`. Si `jsonb`, lire en `String` puis parser. **Auditer DDL Supabase EXACTE** avant.

---

## 5. Worker `MediaPurgeWorker` — Spring `@Scheduled`

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class MediaPurgeWorker {

    private final MarketplaceProductLifecycleRepository productRepo;
    // À étendre : tagPointRepo, serviceRepo, userRepo (slices futures S42+)
    private final FilePurgeService filePurgeService;

    @Scheduled(fixedDelayString = "${app.media-purge.interval-ms:3600000}",
               initialDelayString = "${app.media-purge.initial-delay-ms:0}")
    public void cycle() {
        try {
            OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
            int totalPurged = 0;

            // S40 : marketplace_products uniquement (extension future autres entités)
            List<String> productIds = productRepo.findDueForMediaPurge(now);
            if (!productIds.isEmpty()) {
                productRepo.markMediaPurged(productIds, now);
                totalPurged += productIds.size();
                log.info("[PURGE-MEDIA] {} produit(s) marqué(s) media_purged=TRUE", productIds.size());
            }

            // Trigger purge physique (BR-40.14, try/catch silencieux)
            if (totalPurged > 0) {
                try {
                    filePurgeService.runPhysicalPurge(0);
                } catch (Exception e) {
                    log.warn("[PURGE-MEDIA] runPhysicalPurge() a échoué : {}", e.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("[PURGE-MEDIA] cycle failed", e);
        }
    }
}
```

### Activation `@Scheduled`

```java
@SpringBootApplication
@EnableScheduling
public class SpotyouApplication { ... }
```

### `FilePurgeService` STUB

```java
@Service
@Slf4j
public class FilePurgeService {

    public void runPhysicalPurge(int retentionDays) {
        log.info("[PURGE-PHYSICAL] STUB — TODO slice infra dédiée (retention_days={})", retentionDays);
        // TODO slice future :
        // 1. SELECT pending_file_deletions WHERE status='pending' AND scheduled_at <= now()
        //    ORDER BY scheduled_at LIMIT 500
        // 2. UPDATE status='processing' avec lock optimiste (ou advisory lock PostgreSQL)
        // 3. Pour chaque url : appel Cloudflare R2 DELETE
        // 4. UPDATE status='deleted' (succès) ou status='failed' + error_message + attempt_count++ (échec)
    }
}
```

> 🟢 **Le stub ne casse rien** : le worker fait son travail (marker `media_purged=TRUE`), seules les images R2 ne sont pas physiquement effacées. Coût stockage qui dérive jusqu'à la slice de purge physique. **Acceptable** pour S40 (pas un bloquant fonctionnel).

---

## 6. Configuration

### `application.yml`

```yaml
app:
  media-purge:
    interval-ms: 3600000        # 1h (compat Python INTERVAL_SECS=3600)
    initial-delay-ms: 0         # démarrage immédiat (compat Python)
    soft-delete-retention-days: 90
```

### Spring Security

```java
.requestMatchers(HttpMethod.DELETE, "/api/products/**").authenticated()
.requestMatchers(HttpMethod.POST, "/api/products/*/reactivate").authenticated()
```

(Réutilise `JwtAuthFilter` de S23.)

---

## 7. Sérialisation JSON

### Snake_case (cohérent avec slices précédentes)

```yaml
spring.jackson.property-naming-strategy: SNAKE_CASE
spring.jackson.serialization.write-dates-as-timestamps: false
```

### DTOs

```java
public record DeleteProductResponse(
        boolean ok,
        OffsetDateTime mediaPurgeScheduledAt
) {}

public record ReactivateProductResponse(
        boolean ok,
        boolean reactivated,
        String productId,
        boolean mediaPurged,
        boolean requiresMediaReupload
) {}
```

> ⚠️ Avec `SNAKE_CASE` global, `mediaPurgeScheduledAt` → `media_purge_scheduled_at` (✅), `requiresMediaReupload` → `requires_media_reupload` (✅).

---

## 8. Pièges identifiés (récap)

### PIÈGE-01 — Format JSON erreur asymétrique
- DELETE → `{"error": "..."}` (`JSONResponse` Python)
- Reactivate → `{"detail": "..."}` (`HTTPException` Python)

Java DOIT préserver. Utiliser 2 mécanismes distincts (exception custom pour DELETE, `ResponseStatusException` pour Reactivate).

### PIÈGE-02 — Worker partagé multi-entités
S40 ne couvre que `marketplace_products`, mais le worker Python traite 4 entités. Java doit prévoir l'extensibilité (ne pas hardcoder marketplace_products dans le scheduler — préparer un design `EntitySpec`).

### PIÈGE-03 — Try/catch silencieux purge physique
Le worker NE DOIT PAS faire échouer le UPDATE `media_purged=TRUE` si `run_purge` lève. Sinon le worker bouclerait à l'infini sur les mêmes rows.

### PIÈGE-04 — `image_urls` parsing dual
Stocké en `text[]` OU string JSON (legacy). Préserver le fallback try/except. Auditer DDL pour décider du type strict.

### PIÈGE-05 — `cover_image_url` non purgée si hors `image_urls[]`
Anomalie compat. Préserver. Documenter comme dette technique.

### PIÈGE-06 — `ON CONFLICT DO NOTHING` sans UNIQUE
Probablement no-op. Auditer DDL ; si pas d'UNIQUE, `ON CONFLICT` est inutile mais sans danger.

### PIÈGE-07 — Reactivate ne reset PAS `media_purged`
Délibéré : c'est ce qui dicte `requires_media_reupload`. NE PAS ajouter `media_purged=FALSE` dans le UPDATE Reactivate.

### PIÈGE-08 — Reactivate ne restaure PAS le statut antérieur
`status=active` toujours, peu importe (draft → active, pending_review → active). Anomalie compat préservée.

### PIÈGE-09 — Format datetime ISO avec offset
`2026-07-29T12:34:56.789012+00:00` (Python). Java : `OffsetDateTime` + `WRITE_DATES_AS_TIMESTAMPS=false`.

### PIÈGE-10 — `ResponseStatusException` body format Spring 6
Selon version/config Spring, `ResponseStatusException` peut générer `{"detail": ...}` (compat front) OU `{"timestamp", "status", "error", "message", "path"}` (Spring Boot default error). **Tester explicitement** et ajuster avec `@ControllerAdvice` si besoin.

### PIÈGE-11 — `BigDecimal` non utilisé ici (rappel)
S40 ne touche pas aux prix. Pas de souci `BigDecimal` cette slice.

### PIÈGE-12 — Worker démarrage immédiat
Python `_run_loop` exécute le 1er cycle dès `start()`. Spring `@Scheduled(fixedDelay)` exécute aussi immédiatement (le delay est ENTRE deux cycles, pas avant le premier). ✅ compat.

### PIÈGE-13 — Lock concurrence
Aucun lock Python. Java DOIT préserver (compat). Pas de `SELECT ... FOR UPDATE` ni d'advisory lock pour S40.

### PIÈGE-14 — Worker SQL dynamique
Le Python interpole `table` et `id_col` (`f"""SELECT {id_col} FROM {table}"""`). Java doit utiliser **string concatenation contrôlée + whitelist** des tables/colonnes. Pas de `?` paramétré sur noms de table (PostgreSQL ne le permet pas).

---

## 9. Tests Spring Boot

### Tests unitaires service (`@MockBean` repos)

```java
@Test
void softDelete_nonOwner_then404Json() {
    when(repo.findActiveByIdAndSeller("p1", "u1")).thenReturn(Optional.empty());
    assertThrows(NotFoundJsonResponseException.class, () -> service.softDelete("p1", "u1"));
}

@Test
void reactivate_alreadyActive_then409() {
    var row = new ProductLifecycleRow(...statusActive...);
    when(repo.findById("p1")).thenReturn(Optional.of(row));
    var ex = assertThrows(ResponseStatusException.class, () -> service.reactivate("p1", "u1", false));
    assertEquals(HttpStatus.CONFLICT, ex.getStatusCode());
    assertEquals("Ce produit n'est pas supprimé", ex.getReason());
}

@Test
void reactivate_byAdminOnOtherUserProduct_then200() {
    var row = new ProductLifecycleRow(/*seller=other, status=deleted, media_purged=true*/);
    when(repo.findById("p1")).thenReturn(Optional.of(row));
    var resp = service.reactivate("p1", "admin1", true);
    assertTrue(resp.requiresMediaReupload());
}
```

### Tests d'intégration controller (`@SpringBootTest` + `MockMvc`)
- Reproduire chaque ID `T40-DEL-XX`, `T40-REA-XX` du fichier TEST_CASES.

### Tests repository (`@DataJdbcTest` + Testcontainers PostgreSQL)
- Vérifier `text[]` vs `jsonb` pour `image_urls`.
- Vérifier `ON CONFLICT DO NOTHING` (selon DDL).

### Tests worker
- Mocker le `Clock` pour avancer/reculer dans le temps.
- Vérifier idempotence triple (rows déjà `media_purged=TRUE`, rows `reactivated_at >= deleted_at`).
- Vérifier batch UPDATE `WHERE product_id = ANY(?)`.

---

## 10. Critères de Done

- [ ] **Path correct** : `DELETE /api/products/{id}` + `POST /api/products/{id}/reactivate` (PAS `/api/marketplace/...`)
- [ ] DELETE owner-only (404 anti-énumération sur 3 cas distincts) — pas de bypass admin
- [ ] DELETE soft : status='deleted', deleted_at, deleted_by, media_purge_scheduled_at = now+90j
- [ ] DELETE planifie 1 INSERT pending_file_deletions par image (avec entity_type='product')
- [ ] DELETE format réponse `{ok, media_purge_scheduled_at}`
- [ ] DELETE format erreur 404 `{"error": "..."}` (PAS `detail`)
- [ ] Reactivate owner OU admin (403 si ni l'un ni l'autre)
- [ ] Reactivate ordre validation : 404 → 409 → 403
- [ ] Reactivate annule pending_file_deletions `status='pending'` uniquement (filtrage `entity_type='product'` ajouté par défense)
- [ ] Reactivate force `status='active'` (peu importe statut antérieur — anomalie compat préservée)
- [ ] Reactivate **ne reset PAS** `media_purged`
- [ ] Reactivate format réponse `{ok, reactivated, product_id, media_purged, requires_media_reupload}` avec `requires_media_reupload == media_purged`
- [ ] Reactivate format erreur `{"detail": "..."}` (PAS `error`)
- [ ] `MediaPurgeWorker` `@Scheduled(fixedDelay=3600000)` actif
- [ ] Worker idempotence triple (`media_purged=FALSE`, `status='deleted'`, `reactivated_at < deleted_at OR NULL`)
- [ ] Worker batch UPDATE `= ANY(?)` (pas de boucle)
- [ ] Worker délègue à `FilePurgeService.runPhysicalPurge(0)` (STUB pour S40)
- [ ] Worker try/catch silencieux sur erreur purge physique (log warn, pas crash)
- [ ] Worker structuré pour extension multi-entités (S42+)
- [ ] Tests T40-DEL/REA/WRK/INT/EDGE passent (~68 cas)
- [ ] Régressions S38 (catalogue exclut deleted) + S39 (mine exclut deleted) vertes
- [ ] DDL Supabase auditée pour `image_urls` (`text[]` vs `jsonb`)
- [ ] DDL Supabase auditée pour `pending_file_deletions` UNIQUE constraint
- [ ] Anomalies compat documentées : status auto-active à reactivate, cover non purgée hors image_urls, image_urls orphelines après purge

---

## 11. Hors scope (rappel)

Ne PAS implémenter dans S40 :
- **`admin_purge_worker.run_purge`** (suppression physique R2 + state machine `pending_file_deletions`) → slice infra dédiée
- `media_notif_worker.py` (notification seller à T+83j avant purge) → slice notif différée
- Routes admin produits (`/admin/products/*` validation/rejet) → S41
- Lifecycle `tag_points`, `services`, `users` (mêmes patterns mais entités distinctes) → S42+
- Achat/checkout produit (n'existe pas en Python — confirmé audit)
- Restauration intelligente du statut antérieur (slice future qualité)

---

## 12. Roadmap suggérée post-S40

| Slice | Périmètre |
|---|---|
| **S40-bis** ou **S-Infra-1** | Purge physique R2 (`admin_purge_worker.run_purge`) + state machine `pending_file_deletions` (`pending → processing → deleted/failed`) |
| **S41** | Admin produits (validation `pending_review → active/rejected`, CRUD admin) |
| **S42** | Lifecycle SpotYou (`tag_points` soft-delete + reactivate, mêmes patterns S40 réutilisés) |
| **S43** | Lifecycle services coach (`services` soft-delete, mêmes patterns) |
| **S44** | Lifecycle utilisateurs (`users` deletion + RGPD) |

Le pattern S40 est réutilisable à 80% pour S42/S43 — créer une `LifecycleService<T>` abstraite après S42.
