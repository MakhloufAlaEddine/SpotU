# SLICE_41_CURSOR_IMPLEMENTATION_NOTES.md — Notes implémentation Cursor (Java/Spring)
> Basé sur `routes/admin_product_routes.py:1–207` + `admin_product_reminder_worker.py:1–104`.
> Généré le 2026-04-30.

---

## 1. Squelette Spring Boot

### Package
```
com.spotyou.product.admin
├── controller/AdminProductController.java
├── service/AdminProductService.java
├── service/AdminProductReminderWorker.java
├── repository/AdminProductRepository.java
├── repository/AdminUserRepository.java                 # SELECT user_id WHERE role='admin'
├── dto/PendingProductRow.java                          # listing pending
├── dto/AdminProductDetailResponse.java                 # SELECT p.* + extras
├── dto/ApproveOrRejectBody.java                        # {comment?}
├── dto/ModerationActionResponse.java                   # {ok, status}
├── exception/NotFoundJsonResponseException.java        # 404 → {"error":"..."}
└── security/AdminAccessDeniedHandler.java              # 403 → {"detail":"Admin only"}
```

### Controller mappings

```java
@RestController
@RequestMapping("/api/admin/products")
@RequiredArgsConstructor
public class AdminProductController {

    private final AdminProductService service;

    @GetMapping("/pending")
    public PendingProductsResponse listPending() {
        return service.listPending();
    }

    @GetMapping("/{productId}")
    public Map<String, Object> detail(@PathVariable String productId) {
        return service.detail(productId);
    }

    @PostMapping("/{productId}/approve")
    public ModerationActionResponse approve(
            @PathVariable String productId,
            @RequestBody(required = false) ApproveOrRejectBody body,
            @AuthenticationPrincipal AuthUser admin) {
        return service.approve(productId, admin, body);
    }

    @PostMapping("/{productId}/reject")
    public ModerationActionResponse reject(
            @PathVariable String productId,
            @RequestBody(required = false) ApproveOrRejectBody body,
            @AuthenticationPrincipal AuthUser admin) {
        return service.reject(productId, admin, body);
    }
}
```

> ⚠️ Path correct : `/api/admin/products/...` (cohérent avec Python).

---

## 2. Spring Security — Auth admin

### Config

```java
.requestMatchers("/api/admin/**").hasAuthority("ROLE_ADMIN")
```

Le claim JWT `role` doit être mappé vers une `GrantedAuthority` `ROLE_ADMIN` lors de la construction du `AuthUser` (cf. S23).

### Custom 403 handler — body `{"detail": "Admin only"}`

```java
@Component
public class AdminAccessDeniedHandler implements AccessDeniedHandler {
    @Override
    public void handle(HttpServletRequest req, HttpServletResponse res, AccessDeniedException ex)
            throws IOException {
        res.setStatus(403);
        res.setContentType("application/json");
        res.getWriter().write("{\"detail\":\"Admin only\"}");
    }
}

@Configuration
public class SecurityConfig {
    @Bean SecurityFilterChain chain(HttpSecurity http, AdminAccessDeniedHandler h) throws Exception {
        return http
            .exceptionHandling(ex -> ex.accessDeniedHandler(h))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/admin/**").hasAuthority("ROLE_ADMIN")
                .anyRequest().authenticated())
            .build();
    }
}
```

### Custom 404 handler — body `{"error": "..."}`

```java
@ResponseStatus(HttpStatus.NOT_FOUND)
public class NotFoundJsonResponseException extends RuntimeException {
    public NotFoundJsonResponseException(String msg) { super(msg); }
}

@ControllerAdvice
public class GlobalErrorHandler {
    @ExceptionHandler(NotFoundJsonResponseException.class)
    public ResponseEntity<Map<String,String>> handle(NotFoundJsonResponseException ex) {
        return ResponseEntity.status(404).body(Map.of("error", ex.getMessage()));
    }
}
```

> ⚠️ Réutiliser le handler de S40 (même pattern). 

---

## 3. Service — `listPending`

```java
@Transactional(readOnly = true)
public PendingProductsResponse listPending() {
    List<Map<String,Object>> rows = jdbc.queryForList(SQL_PENDING, Map.of());
    List<Map<String,Object>> cleaned = rows.stream().map(this::cleanRow).toList();
    return new PendingProductsResponse(cleaned, cleaned.size());
}

private static final String SQL_PENDING = """
    SELECT
        p.product_id, p.title, p.short_description, p.price, p.pricing_type,
        p.category, p.subcategory, p.cover_image_url, p.image_url, p.image_urls,
        p.condition_label, p.available_quantity,
        p.deposit_required, p.deposit_amount,
        p.pickup_type, p.city, p.lat, p.lng,
        p.return_rules, p.cancellation_rules, p.pickup_notes,
        p.availability_note, p.related_spotyou_ids,
        p.seller_id, p.status, p.created_at, p.updated_at,
        p.admin_reminder_sent_at,
        u.name AS seller_name, u.picture AS seller_picture,
        (
            CASE WHEN p.cover_image_url IS NOT NULL THEN 20 ELSE 0 END +
            CASE WHEN jsonb_array_length(COALESCE(p.image_urls, '[]'::jsonb)) >= 3 THEN 10 ELSE 0 END +
            CASE WHEN length(p.title) >= 10 THEN 15 ELSE 0 END +
            CASE WHEN length(p.title) >= 25 THEN 5 ELSE 0 END +
            CASE WHEN length(COALESCE(p.description,'')) >= 50 THEN 10 ELSE 0 END +
            CASE WHEN length(COALESCE(p.description,'')) >= 150 THEN 10 ELSE 0 END +
            CASE WHEN p.price > 0 THEN 10 ELSE 0 END +
            CASE WHEN p.pickup_type IS NOT NULL THEN 10 ELSE 0 END +
            CASE WHEN p.lat IS NOT NULL THEN 10 ELSE 0 END
        ) AS quality_score
    FROM marketplace_products p
    JOIN users u ON u.user_id = p.seller_id
    WHERE p.status = 'pending_review'
    ORDER BY p.created_at ASC
""";
```

> ⚠️ JOIN strict préservé. `quality_score` 100% SQL. Pas de paramètre — query constante.

### `cleanRow` — datetime ISO

```java
private Map<String,Object> cleanRow(Map<String,Object> row) {
    Map<String,Object> out = new LinkedHashMap<>();
    for (var e : row.entrySet()) {
        Object v = e.getValue();
        if (v instanceof Temporal t) {
            out.put(e.getKey(), t.toString());  // ISO 8601 default
        } else {
            out.put(e.getKey(), v);
        }
    }
    return out;
}
```

> ⚠️ `OffsetDateTime.toString()` → `"2026-04-29T10:00:00+00:00"` (compat Python `isoformat()`).

---

## 4. Service — `detail`

```java
@Transactional(readOnly = true)
public Map<String,Object> detail(String productId) {
    List<Map<String,Object>> rows = jdbc.queryForList(SQL_DETAIL, Map.of("pid", productId));
    if (rows.isEmpty()) {
        throw new NotFoundJsonResponseException("Produit introuvable.");
    }
    return cleanRow(rows.get(0));
}

private static final String SQL_DETAIL = """
    SELECT p.*,
           u.name AS seller_name,
           u.picture AS seller_picture,
           u.email AS seller_email,
           ( /* same quality_score expression */ ) AS quality_score
    FROM marketplace_products p
    JOIN users u ON u.user_id = p.seller_id
    WHERE p.product_id = :pid
""";
```

> ⚠️ `SELECT p.*` préservé — drift schéma compatible. Java DOIT utiliser `Map<String,Object>` (PAS DTO strict).

---

## 5. Service — `approve`

```java
@Transactional
public ModerationActionResponse approve(String productId, AuthUser admin, ApproveOrRejectBody body) {
    String comment = parseComment(body);  // null si vide

    SellerInfo info = repo.findSellerAndTitle(productId)
        .orElseThrow(() -> new NotFoundJsonResponseException("Produit introuvable."));

    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    repo.approve(productId, admin.userId(), now, comment);

    // Push hors transaction (post-commit)
    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override public void afterCommit() {
            pushService.send(
                info.sellerId(),
                "Produit publié !",
                "Ton annonce « " + info.title() + " » a été validée et est maintenant visible dans la boutique.",
                Map.of("type", "product_approved", "product_id", productId, "action", "/products/my-products"),
                "product_approved"
            );
        }
    });

    return new ModerationActionResponse(true, "active");
}
```

### Repo

```java
public void approve(String productId, String adminId, OffsetDateTime now, String comment) {
    jdbc.update("""
        UPDATE marketplace_products
        SET status = 'active', in_stock = TRUE,
            admin_validated_by = :admin, admin_validated_at = :now,
            admin_comment = :comment, updated_at = :now
        WHERE product_id = :pid
    """, Map.of("admin", adminId, "now", now, "comment", Optional.ofNullable(comment),
                "pid", productId));
}
```

> ⚠️ `Optional.ofNullable(comment)` ne fonctionne pas pour `NamedParameterJdbcTemplate` — utiliser `MapSqlParameterSource` qui supporte `null` :
> ```java
> new MapSqlParameterSource()
>     .addValue("admin", adminId)
>     .addValue("now", now)
>     .addValue("comment", comment)  // null OK
>     .addValue("pid", productId)
> ```

---

## 6. Service — `reject`

```java
@Transactional
public ModerationActionResponse reject(String productId, AuthUser admin, ApproveOrRejectBody body) {
    String commentDb = parseComment(body);                          // null si vide → DB
    String commentForPushData = commentDb != null ? commentDb : ""; // STRING VIDE pour push (BR-41.13)

    SellerInfo info = repo.findSellerAndTitle(productId)
        .orElseThrow(() -> new NotFoundJsonResponseException("Produit introuvable."));

    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    repo.reject(productId, admin.userId(), now, commentDb);

    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override public void afterCommit() {
            pushService.send(
                info.sellerId(),
                "Annonce refusée",
                "Ton annonce « " + info.title() + " » n'a pas été validée. Clique pour voir les corrections à apporter.",
                Map.of(
                    "type", "product_rejected",
                    "product_id", productId,
                    "admin_comment", commentForPushData,  // peut être ""
                    "action", "/products/create?productId=" + productId + "&mode=edit"
                ),
                "product_rejected"
            );
        }
    });

    return new ModerationActionResponse(true, "rejected");
}
```

### Repo reject — `:comment` réutilisé 2 fois

```java
public void reject(String productId, String adminId, OffsetDateTime now, String comment) {
    jdbc.update("""
        UPDATE marketplace_products
        SET status = 'rejected', in_stock = FALSE,
            admin_validated_by = :admin, admin_validated_at = :now,
            rejection_reason = :comment, admin_comment = :comment, updated_at = :now
        WHERE product_id = :pid
    """, new MapSqlParameterSource()
        .addValue("admin", adminId)
        .addValue("now", now)
        .addValue("comment", comment)  // 1 param, 2 placements SQL — BR-41.09
        .addValue("pid", productId));
}
```

---

## 7. Helper `parseComment`

```java
public static String parseComment(ApproveOrRejectBody body) {
    if (body == null || body.comment() == null) return null;
    String s = body.comment().strip();
    return s.isEmpty() ? null : s;
}
```

> Compat Python `(body.get("comment") or "").strip()` puis `comment or None`.

---

## 8. Worker `AdminProductReminderWorker`

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class AdminProductReminderWorker {

    private final AdminProductRepository productRepo;
    private final AdminUserRepository userRepo;
    private final PushService pushService;

    @Scheduled(fixedDelayString = "${app.admin-reminder.interval-ms:600000}")
    public void cycle() {
        try {
            int count = sendPendingReminders();
            if (count > 0) log.info("AdminProductReminderWorker: {} rappel(s) envoyé(s).", count);
        } catch (Exception e) {
            log.error("AdminProductReminderWorker erreur: {}", e.getMessage(), e);
        }
    }

    @Transactional
    public int sendPendingReminders() {
        List<PendingTitleRow> products = productRepo.findPendingNeedingReminder();
        if (products.isEmpty()) return 0;

        List<String> adminIds = userRepo.findAllAdminUserIds();
        if (adminIds.isEmpty()) return 0;

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        List<String> productIds = products.stream().map(PendingTitleRow::productId).toList();
        productRepo.markRemindersSent(productIds, now);

        // push hors transaction recommandé — ici simplifié séquentiel
        for (PendingTitleRow p : products) {
            for (String adminId : adminIds) {
                try {
                    pushService.send(
                        adminId,
                        "Rappel : annonce en attente",
                        "L'annonce « " + p.title() + " » attend votre validation depuis 2h.",
                        Map.of("type", "admin_product_reminder", "product_id", p.productId(), "action", "/admin?tab=products"),
                        "admin_product_reminder"
                    );
                } catch (Exception ignored) {}
            }
        }
        return products.size();
    }
}
```

### Repo méthode

```java
private static final String SQL_PENDING_REMINDER = """
    SELECT product_id, title
    FROM marketplace_products
    WHERE status = 'pending_review'
      AND created_at < NOW() - INTERVAL '2 hours'
      AND (
            admin_reminder_sent_at IS NULL
         OR admin_reminder_sent_at < NOW() - INTERVAL '2 hours'
      )
    ORDER BY created_at ASC
    LIMIT 50
""";

public List<PendingTitleRow> findPendingNeedingReminder() {
    return jdbc.query(SQL_PENDING_REMINDER, (rs, n) ->
        new PendingTitleRow(rs.getString("product_id"), rs.getString("title")));
}

public void markRemindersSent(List<String> productIds, OffsetDateTime now) {
    if (productIds.isEmpty()) return;
    jdbc.update("""
        UPDATE marketplace_products
        SET admin_reminder_sent_at = :now
        WHERE product_id = ANY(:ids)
    """, new MapSqlParameterSource()
        .addValue("now", now)
        .addValue("ids", productIds.toArray(new String[0])));
}
```

> ⚠️ **`INTERVAL '2 hours'` hardcodé** — si on veut paramétrer, utiliser `make_interval(hours => :hours)` (cf. PIÈGE-DB-06). Pour S40, hardcode acceptable (constante stable).

---

## 9. Configuration

### `application.yml`

```yaml
app:
  admin-reminder:
    interval-ms: 600000              # 10 min
    delay-hours: 2                    # informatif (utilisé dans body push)
spring:
  jackson:
    property-naming-strategy: SNAKE_CASE
    serialization.write-dates-as-timestamps: false
```

### Activation `@Scheduled`

```java
@SpringBootApplication
@EnableScheduling
@EnableAsync
public class SpotyouApplication { ... }
```

---

## 10. DTOs

```java
public record PendingProductsResponse(
    List<Map<String,Object>> products,
    int count
) {}

public record ApproveOrRejectBody(String comment) {}

public record ModerationActionResponse(boolean ok, String status) {}

public record SellerInfo(String sellerId, String title) {}

public record PendingTitleRow(String productId, String title) {}
```

---

## 11. Pièges identifiés (récap)

### PIÈGE-01 — Format JSON erreur asymétrique 403/404
- 403 → `{"detail": "Admin only"}` (custom AccessDeniedHandler)
- 404 → `{"error": "Produit introuvable."}` (custom exception handler)

Préserver les **2 schémas distincts**.

### PIÈGE-02 — `image_urls` est `jsonb` (CONFIRMÉ par S41)
L'expression `jsonb_array_length(COALESCE(p.image_urls, '[]'::jsonb))` prouve `jsonb`. **Reporter dans S39/S40** lors de la consolidation.

### PIÈGE-03 — `quality_score` SQL exact
9 critères. NE PAS porter en Java. Préserver formule SQL telle quelle.

### PIÈGE-04 — JOIN strict masque sellers orphelins
Compat = JOIN. Recommandation = LEFT JOIN (rupture mineure).

### PIÈGE-05 — `SELECT p.*` drift volontaire (GET detail)
Map<String,Object> recommandé vs DTO strict.

### PIÈGE-06 — Pas de guard statut courant approve/reject
Préserver compat permissive. Log WARN si transition inattendue.

### PIÈGE-07 — `rejection_reason` = `admin_comment` dupliqué (reject)
SQL utilise `:comment` 2 fois. Java doit reproduire avec `MapSqlParameterSource` réutilisant la valeur.

### PIÈGE-08 — `data.admin_comment` peut être `""` côté push (reject)
DB stocke null si comment vide ; mais le push payload passe `""` (string vide). Reproduire la divergence subtile :
```java
String dbComment = comment.isEmpty() ? null : comment;
String pushComment = comment;  // peut être ""
```

### PIÈGE-09 — Push synchrone Python → @Async post-commit recommandé
Recommandation : `TransactionSynchronization.afterCommit` pour lancer le push HORS transaction. Compat stricte = sync (acceptable mais lent).

### PIÈGE-10 — Worker UPDATE BEFORE push
Si push échoue, `admin_reminder_sent_at` est déjà committed. Préserver compat (rappels manqués acceptés).

### PIÈGE-11 — Worker matrice push M×N
Volume faible en pratique (1-5 produits × 1-3 admins). Séquentiel acceptable. `@Async` recommandé pour > 10×10.

### PIÈGE-12 — Worker `INTERVAL '2 hours'` hardcodé
Compat = hardcode. Si paramétrage souhaité : `make_interval(hours => :hours)` (PostgreSQL).

### PIÈGE-13 — Body comment non-string
Python : 500 (TypeError). Java doit décider : reproduire 500 OU normaliser via `String.valueOf()`. Recommandation : normaliser (+0 risque, +UX).

### PIÈGE-14 — Guillemets typographiques `«` et `»`
Body push : `"Ton annonce « X » a été validée..."`. Préserver octet-pour-octet (UTF-8 conservé).

### PIÈGE-15 — `users.name` vs `users.full_name`
Audit DDL pour confirmer le nom de colonne réel. S41 utilise `u.name`, S39 utilise `u.full_name`. Probable alias OU incohérence schéma à investiguer.

---

## 12. Tests Spring Boot

### Tests unitaires service (`@MockBean` repos + push)

```java
@Test
void approve_404_thenJsonResponseError() {
    when(repo.findSellerAndTitle("p1")).thenReturn(Optional.empty());
    var ex = assertThrows(NotFoundJsonResponseException.class,
        () -> service.approve("p1", admin, new ApproveOrRejectBody(null)));
    assertEquals("Produit introuvable.", ex.getMessage());
}

@Test
void reject_emptyComment_dbNullPushEmptyString() {
    when(repo.findSellerAndTitle("p1")).thenReturn(Optional.of(new SellerInfo("u1", "X")));
    service.reject("p1", admin, new ApproveOrRejectBody(""));
    verify(repo).reject(eq("p1"), any(), any(), eq(null));  // DB null
    // post-commit hook pas testable directement — utiliser test d'intégration pour push
}

@Test
void approve_zombieDeleted_thenStatusActive() {
    // état : status=deleted
    when(repo.findSellerAndTitle("p1")).thenReturn(Optional.of(new SellerInfo("u1", "X")));
    var resp = service.approve("p1", admin, new ApproveOrRejectBody(null));
    assertEquals("active", resp.status());
    // Le repo UPDATE force status='active' sans guard — anomalie compat préservée
}
```

### Tests d'intégration (`@SpringBootTest` + `MockMvc`)
- Reproduire chaque ID `T41-PND/DET/APP/REJ/WRK/INT/EDGE-NN`.
- Tester `quality_score` SQL avec différentes combinaisons de produits.

### Tests Worker (`@SpringBootTest` + Testcontainers + Clock mockable)
- Avancer le clock pour simuler le délai 2h.
- Mocker `pushService` et vérifier l'ordre UPDATE → push.

---

## 13. Critères de Done

- [ ] **Path correct** : `GET /api/admin/products/pending`, `GET /api/admin/products/{id}`, `POST /api/admin/products/{id}/approve`, `POST /api/admin/products/{id}/reject`
- [ ] Auth : 401 si JWT KO ; **403 avec `{"detail":"Admin only"}`** si non-admin (custom handler)
- [ ] **`quality_score` calculé en SQL** (formule exacte 9 critères, max 100)
- [ ] GET pending : JOIN strict users, `WHERE status='pending_review'`, `ORDER BY created_at ASC`, sans LIMIT, format `{products[], count}`
- [ ] GET detail : `SELECT p.*` + JOIN users avec `seller_email`, `Map<String,Object>` pour drift schéma, **404 avec `{"error":"Produit introuvable."}`**
- [ ] approve UPDATE 5 colonnes ; status='active' ; in_stock=TRUE ; admin_validated_by ; admin_validated_at = updated_at = now ; admin_comment (null si vide)
- [ ] approve : pas de guard sur statut courant (compat permissive)
- [ ] approve : push title="Produit publié !", body avec `«` `»`, data action=/products/my-products, notif_type="product_approved"
- [ ] reject UPDATE 6 colonnes ; **`rejection_reason = admin_comment = :comment`** (1 paramètre, 2 placements)
- [ ] reject : push data.admin_comment peut être `""` (string vide), data.action avec deeplink edit, notif_type="product_rejected"
- [ ] Format réponse `{"ok": true, "status": "active"|"rejected"}`
- [ ] Worker `@Scheduled(fixedDelay=600000)` actif
- [ ] Worker filtre `status='pending_review'` AND `created_at < now()-2h` AND (`admin_reminder_sent_at IS NULL OR < now()-2h`), LIMIT 50
- [ ] Worker UPDATE batch puis push M×N
- [ ] Worker push title="Rappel : annonce en attente", body "depuis 2h", notif_type="admin_product_reminder"
- [ ] Push hors transaction (post-commit recommandé via TransactionSynchronization)
- [ ] Régressions S38 (catalogue post-approve) + S39 (`/mine` post-reject) + S40 (zombie post-DELETE+approve) vertes
- [ ] DDL Supabase auditée pour `users.name` vs `users.full_name`
- [ ] **Découverte rétroactive `image_urls=jsonb`** reportée dans les notes S39/S40 lors de la consolidation
- [ ] Anomalies compat documentées : zombie status, dual rejection_reason/admin_comment, JOIN strict, push synchrone, push.data.admin_comment vide vs DB null

---

## 14. Hors scope (rappel)

Ne PAS implémenter dans S41 :
- Edition admin d'un produit (n'existe pas en Python)
- Suppression admin d'un produit (n'existe pas — admin doit utiliser DELETE owner-only)
- Bulk approve / bulk reject (n'existe pas)
- Historique modérations (pas de table)
- Routes `/admin/*` génériques non-marketplace → S-Admin
- Achat / checkout produit (n'existe pas en Python)

---

## 15. Roadmap suggérée post-S41

| Slice | Périmètre |
|---|---|
| **S40-bis** | Purge physique R2 (`admin_purge_worker.run_purge`) + state machine `pending_file_deletions` |
| **S42** | Lifecycle SpotYou (`tag_points` soft-delete, mêmes patterns S40 réutilisés) |
| **S43** | Lifecycle services coach |
| **S44** | Lifecycle utilisateurs (RGPD) |
| **S-Admin** | Routes admin génériques (`admin_routes.py`, ~500+ lignes — config, stats, audit) |
| **S-Index-Marketplace** | Document de consolidation S38+S39+S40+S41 (cycle complet seller marketplace) |

---

## 16. Réflexions architecturales

### Bloc Marketplace seller complet après S41

S38 lecture publique
+ S39 authoring (create/edit)
+ S40 lifecycle (delete/reactivate/purge T+90j)
+ S41 admin moderation (pending/approve/reject + reminder worker)

= **Cycle de vie complet d'un produit côté seller + admin**. Le seul gap est l'**achat côté buyer** (n'existe pas en Python — entièrement à concevoir, pas une migration).

### Pattern réutilisable

Les 4 slices marketplace utilisent le **même squelette** (router monté direct + `_require_*` helper applicatif + `_clean()` datetime + push fire-and-forget). Java peut factoriser une `BaseAdminController` ou un `BaseModeratedResource<T>` après S41 — **MAIS** seulement après avoir confirmé que les patterns identiques se retrouvent dans S42+ (lifecycle SpotYou) pour éviter la sur-abstraction prématurée.

### Anomalies à corriger en slice qualité (post-cutover)

| Anomalie | Slice corrective |
|---|---|
| Zombie status (DELETE → admin approve) | Quality-1 |
| `rejection_reason` = `admin_comment` dupliqué | Quality-2 |
| Reactivate force status='active' (perte historique) | Quality-3 |
| `cover_image_url` non purgée si hors `image_urls[]` | Quality-4 |
| `data.admin_comment` `""` vs DB null divergence | Quality-5 |
| Push synchrone bloque réponse HTTP | Quality-6 (ou direct via @Async lors implémentation Java) |

Ces slices "Quality" peuvent être planifiées **après** le cutover Java complet (S38→S44) — elles sont des améliorations, pas des bloquants.
