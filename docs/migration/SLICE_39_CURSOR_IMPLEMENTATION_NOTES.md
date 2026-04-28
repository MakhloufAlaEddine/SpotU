# SLICE_39_CURSOR_IMPLEMENTATION_NOTES.md — Notes implémentation Cursor (Java/Spring)
> Basé sur `routes/product_creation_routes.py:1–568` + slices précédentes (S23 auth, S24 upload, S38 marketplace read).
> Généré le 2026-04-29.

---

## 1. Squelette Spring Boot

### Package
```
com.spotyou.product.creation
├── controller/ProductCreationController.java
├── service/ProductCreationService.java
├── repository/MarketplaceProductRepository.java
├── repository/UserAdminRepository.java          # SELECT user_id WHERE role='admin'
├── dto/ProductBody.java                         # body POST (Map<String,Object> permissif OU DTO Optional<>)
├── dto/ProductDetailResponse.java
├── dto/ProductMineResponse.java                 # wrapper {products, count}
├── dto/ProductCreatedResponse.java              # {product_id, status}
└── helper/DeliveryModesHelper.java              # _delivery_modes
```

### Controller mappings

```java
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class ProductCreationController {

    private final ProductCreationService service;

    @PostMapping("/products")
    public ProductCreatedResponse createOrUpdate(
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal AuthUser user) {
        return service.upsert(body, user);
    }

    @GetMapping("/products/mine")
    public ProductMineResponse listMine(@AuthenticationPrincipal AuthUser user) {
        return service.listMine(user.userId());
    }

    @GetMapping("/products/{productId}/detail")
    public ProductDetailResponse detail(
            @PathVariable String productId,
            @AuthenticationPrincipal AuthUser user) {
        return service.detail(productId, user.userId());
    }
}
```

> ⚠️ **PAS de `/marketplace` prefix.** Le path Python est `/api/products` (cf. SCOPE).

---

## 2. Body permissif vs DTO strict

### Choix recommandé : **`Map<String, Object>` au controller, DTO interne au service**

**Pourquoi** : le body Python est lu via `body.get(...)` partout, sans Pydantic strict. Si on impose un DTO Jackson strict côté Java, on **rejette des bodies que Python accepterait**. Compat stricte = body permissif.

```java
public class ProductBodyParser {
    public static String getString(Map<String,Object> body, String key) {
        Object v = body.get(key);
        return v == null ? null : String.valueOf(v);
    }

    public static Double parsePrice(Map<String,Object> body, String key, double fallback) {
        Object v = body.get(key);
        if (v == null) return fallback;
        try { return Double.parseDouble(String.valueOf(v).replace(",", ".")); }
        catch (NumberFormatException e) { return fallback; }
    }

    public static List<String> getStringList(Map<String,Object> body, String key) {
        Object v = body.get(key);
        if (v instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        return List.of();
    }
}
```

---

## 3. Service — flow complet `upsert`

```java
@Transactional
public ProductCreatedResponse upsert(Map<String,Object> body, AuthUser user) {
    String userId = user.userId();
    boolean isAdmin = "admin".equals(user.role());

    // 1. Determine product_id
    String productId = Optional.ofNullable(getString(body, "product_id"))
        .orElseGet(this::newId);

    // 2. Determine status
    String requestedStatus = Optional.ofNullable(getString(body, "status")).orElse("draft");
    String statusToWrite = requestedStatus;
    if (isAdmin && "pending_review".equals(requestedStatus)) {
        statusToWrite = "active";  // BR-39.05
    }

    // 3. Validation minimale (BR-39.07)
    String title = trimOrEmpty(getString(body, "title"));
    if (title.isEmpty())
        throw new BadRequestException("Le titre est obligatoire.");

    String productType = Optional.ofNullable(getString(body, "product_type")).orElse("rental");
    if (!Set.of("rental", "sale").contains(productType))
        throw new BadRequestException("Type de produit invalide. Types supportés : rental, sale.");

    String description = trimOrEmpty(getString(body, "description"));
    if (description.length() < 30)
        throw new BadRequestException("La description est obligatoire (minimum 30 caractères).");

    // 4. Parse champs numériques (BR-39.11, BR-39.12)
    double price = parsePrice(body, "price", 0.0);
    Double depositAmount = parsePriceOrNull(body, "deposit_amount");
    int availableQuantity = parseQuantity(body, "available_quantity");

    // 5. Image fallback (BR-39.13)
    List<String> imageUrls = getStringList(body, "image_urls");
    String coverImageUrl = Optional.ofNullable(getString(body, "cover_image_url"))
        .or(() -> imageUrls.stream().findFirst())
        .orElse(null);

    // 6. Validation pending_review (BR-39.06)
    if ("pending_review".equals(requestedStatus)) {
        List<String> errors = validatePendingReview(body, productType, price, availableQuantity, depositAmount, imageUrls);
        if (!errors.isEmpty()) {
            throw new UnprocessableEntityException(errors);
        }
    }

    // 7. UPSERT (BR-39.02)
    Optional<Product> existing = repo.findByProductIdAndSellerId(productId, userId);
    if (existing.isPresent()) {
        // Anti-downgrade (BR-39.08)
        String currentStatus = existing.get().getStatus();
        if (currentStatus != null && !"draft".equals(currentStatus) && "draft".equals(requestedStatus)) {
            throw new ForbiddenException("Impossible de repasser en brouillon : ce produit a déjà été soumis ou validé.");
        }
        // UPDATE
        repo.updateMain(productId, userId, /* ... 39 colonnes ... */, statusToWrite, now);
    } else {
        // INSERT
        String sellerName = Optional.ofNullable(user.fullName())
            .filter(s -> !s.isEmpty())
            .or(() -> Optional.ofNullable(user.username()).filter(s -> !s.isEmpty()))
            .orElse("Utilisateur");
        String sellerPicture = user.pictureUrl();
        repo.insertMain(productId, userId, sellerName, sellerPicture, /* ... 46 colonnes ... */);
    }

    // 8. UPDATEs annexes (atomicité — voir § 4)
    repo.updatePricePerSession(productId, parsePriceOrNull(body, "price_per_session"));
    repo.updateBrandModelStripe(productId,
        getString(body, "brand"), getString(body, "model"), getString(body, "weight"),
        getString(body, "stripe_product_id"), getString(body, "stripe_price_id"));
    String rawAddr = Optional.ofNullable(getString(body, "location_address_raw"))
        .map(String::strip).filter(s -> !s.isEmpty()).orElse(null);
    repo.updateLocationAddressRaw(productId, rawAddr);

    // 9. Notif admins (BR-39.14, hors transaction — @Async)
    if ("pending_review".equals(requestedStatus) && !isAdmin) {
        notifService.notifyAdminsAsync(productId, title);
    }

    return new ProductCreatedResponse(productId, statusToWrite);
}
```

---

## 4. Atomicité — décision recommandée : **fusionner**

> Voir BR-39.15. Recommandation = **1 seule `@Transactional`** (au lieu de 4 connexions distinctes Python).

Pour préserver la compatibilité au niveau succès, **rien ne change** : si tout réussit, le résultat final est identique. Si l'INSERT principal réussit mais qu'un UPDATE annexe échoue → en Python, produit partiel persiste ; en Java, rollback total. **Documenter cette différence comme amélioration intentionnelle.**

Alternative (compat 100%) : 4 transactions distinctes via `TransactionTemplate.execute(...)` x4. Plus risqué.

---

## 5. Génération ID (BR-39.03)

```java
private String newId() {
    return "prod_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
}
```

---

## 6. Validation `pending_review` (BR-39.06)

```java
private List<String> validatePendingReview(
        Map<String,Object> body, String productType,
        double price, int qty, Double depositAmount, List<String> imageUrls) {
    List<String> errors = new ArrayList<>();
    String category = trimOrEmpty(getString(body, "category"));
    String condLabel = trimOrEmpty(getString(body, "condition_label"));
    String pickupType = trimOrEmpty(getString(body, "pickup_type"));
    List<String> tagIds = getStringList(body, "tag_ids");
    String description = trimOrEmpty(getString(body, "description"));

    // ORDRE EXACT (compat front)
    if (category.isEmpty()) errors.add("La catégorie du matériel est obligatoire.");
    if (tagIds.isEmpty()) errors.add("Sélectionne au moins un tag pour publier le produit.");
    if (condLabel.isEmpty()) errors.add("L'état du matériel est obligatoire.");
    if (description.length() < 30) errors.add("La description doit faire au moins 30 caractères.");
    if (imageUrls.isEmpty()) errors.add("Au moins une photo est requise.");

    if ("sale".equals(productType)) {
        if (price <= 0) errors.add("Le prix de vente doit être supérieur à 0.");
        if (qty < 1) errors.add("La quantité disponible doit être au minimum 1.");
        if (pickupType.isEmpty()) errors.add("Le mode de remise est obligatoire.");
    } else { // rental
        List<String> pricingModes = getStringList(body, "pricing_modes");
        if (pricingModes.isEmpty()) {
            String pricingType = Optional.ofNullable(getString(body, "pricing_type")).orElse("day");
            pricingModes = List.of(pricingType);
        }
        boolean depositRequired = Optional.ofNullable(body.get("deposit_required"))
            .map(v -> Boolean.parseBoolean(String.valueOf(v))).orElse(false);
        List<String> spotyouIds = getStringList(body, "related_spotyou_ids");

        if (price <= 0) errors.add("Le prix doit être supérieur à 0.");
        if (pickupType.isEmpty()) errors.add("Le mode de remise du matériel est obligatoire.");
        if (pricingModes.contains("session") && spotyouIds.isEmpty())
            errors.add("La tarification par séance nécessite de sélectionner au moins un SpotYou.");
        if (depositRequired && (depositAmount == null || depositAmount <= 0))
            errors.add("Le montant de la caution est obligatoire si une caution est requise.");
    }
    return errors;
}
```

### Exception 422 personnalisée

```java
@ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
public class UnprocessableEntityException extends RuntimeException {
    private final List<String> details;
    public UnprocessableEntityException(List<String> details) {
        super(details.get(0));
        this.details = details;
    }
}

@ExceptionHandler(UnprocessableEntityException.class)
public ResponseEntity<Map<String,Object>> handle422(UnprocessableEntityException ex) {
    return ResponseEntity.status(422).body(Map.of(
        "error", ex.getMessage(),
        "details", ex.getDetails()
    ));
}
```

---

## 7. Repository — gestion arrays PostgreSQL

### Si colonnes = `text[]`

```java
@Repository
public class MarketplaceProductRepository {
    private final NamedParameterJdbcTemplate jdbc;

    public void insertMain(String productId, String userId, String sellerName, /*...*/) {
        MapSqlParameterSource p = new MapSqlParameterSource();
        p.addValue("productId", productId);
        p.addValue("imageUrls", imageUrls.toArray(new String[0]));  // text[]
        p.addValue("tagIds", tagIds.toArray(new String[0]));
        p.addValue("pricingModes", pricingModes.toArray(new String[0]));
        p.addValue("relatedSpotyouIds", relatedSpotyouIds.toArray(new String[0]));
        p.addValue("deliveryModes", deliveryModes.toArray(new String[0]));
        // ... 46 paramètres total
        jdbc.update(SQL_INSERT, p);
    }
}
```

### Si colonnes = `jsonb`

```java
PGobject jsonb = new PGobject();
jsonb.setType("jsonb");
jsonb.setValue(objectMapper.writeValueAsString(imageUrls));
p.addValue("imageUrls", jsonb);
```

> 🔴 **Auditer la DDL Supabase EXACTE** (`\d marketplace_products`) AVANT d'écrire le repo.

---

## 8. Helper `_delivery_modes` (BR-39.10)

```java
public class DeliveryModesHelper {
    public static List<String> resolve(Map<String,Object> body) {
        Object provided = body.get("delivery_modes");
        if (provided instanceof List<?> list && !list.isEmpty()) {
            return list.stream().map(String::valueOf).toList();
        }
        String pickup = Optional.ofNullable((String) body.get("pickup_type")).orElse("");
        return switch (pickup) {
            case "local_pickup" -> List.of("local_pickup");
            case "creator_handoff" -> List.of("creator_handoff");
            default -> List.of("local_pickup");
        };
    }
}
```

---

## 9. Notification admins (BR-39.14)

```java
@Service
@RequiredArgsConstructor
public class AdminNotifService {
    private final UserAdminRepository userRepo;
    private final PushService pushService;

    @Async("notifExecutor")
    public void notifyAdminsAsync(String productId, String title) {
        try {
            List<String> adminIds = userRepo.findAdminUserIds();
            String body = String.format("« %s » est en attente de publication.", title);
            for (String aid : adminIds) {
                try {
                    pushService.sendToUser(aid,
                        "Nouvelle annonce à valider",
                        body,
                        Map.of("type", "admin_product_pending",
                               "product_id", productId,
                               "action", "/admin?tab=products"),
                        "admin_product_pending");
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
    }
}
```

> Configurer `notifExecutor` thread pool. **Ne jamais bloquer** la réponse HTTP.

---

## 10. Sérialisation réponses

### `_clean()` Python → Jackson Java

```java
@JsonFormat(shape = JsonFormat.Shape.STRING)
private OffsetDateTime createdAt;

@JsonFormat(shape = JsonFormat.Shape.STRING)
private OffsetDateTime updatedAt;
```

OU via `Jackson2ObjectMapperBuilder.modulesToInstall(JavaTimeModule.class)`.

### Format wrapper diff (BR-39.18)

| Endpoint | Format |
|---|---|
| `POST` | `{"product_id": "...", "status": "..."}` (DTO `ProductCreatedResponse`) |
| `GET /mine` | `{"products": [...], "count": N}` (DTO `ProductMineResponse`) |
| `GET /detail` | `{...}` direct (DTO `ProductDetailResponse` racine) |

---

## 11. Snake_case vs camelCase

> ⚠️ Le front consomme du **snake_case** (`product_id`, `seller_name`, `image_urls`...). Spring sérialise par défaut en camelCase.

**Solution** : `@JsonProperty("product_id")` champ par champ OU configurer globalement :
```yaml
spring.jackson.property-naming-strategy: SNAKE_CASE
```

**Recommandation** : config globale `SNAKE_CASE` (cohérent avec toutes slices précédentes — vérifier l'application existante n'a pas déjà choisi).

---

## 12. Pièges identifiés

### PIÈGE-01 — Format `400` vs `403` vs `422`
- 400 → `{"error": "..."}`
- 403 → `{"detail": "..."}` (FastAPI HTTPException default)
- 422 → `{"error": "...", "details": [...]}`

Java DOIT préserver les **3 formats divergents** (cf. SCOPE et BUSINESS_RULES).

### PIÈGE-02 — Ordre des erreurs `pending_review`
L'ordre dans `errors[]` est exact (cf. BR-39.06). Le front affiche `error` (premier) en toast. Changer l'ordre = changer l'UX.

### PIÈGE-03 — Push admins HORS transaction
Si on appelle `notifyAdmins` dans la transaction, et qu'elle échoue, le produit n'est pas créé mais admins ont reçu push. Compat = `@Async` strict, exécuté APRÈS commit.

### PIÈGE-04 — `int(qty_raw)` Python lève sur `"12.5"`
Java `Integer.parseInt("12.5")` lève aussi → fallback 1. OK.

### PIÈGE-05 — Float parse virgule
`"12,50"` doit donner `12.50` (BR-39.11). `Double.parseDouble` natif **NE supporte PAS** la virgule → toujours `.replace(",", ".")` avant.

### PIÈGE-06 — Snapshot `seller_name` à l'INSERT seulement
NE PAS inclure dans l'UPDATE — sinon on écrase. Comparer schéma INSERT (46 colonnes inc. seller_*) vs UPDATE (41 colonnes excl. seller_*).

### PIÈGE-07 — `body.product_id` sur INSERT autorisé
Si user envoie un `product_id` qui n'existe pas pour lui mais existe pour un autre user, Python tente INSERT → échec UNIQUE constraint PostgreSQL. Java doit retourner **409 Conflict** (au lieu de 500).

### PIÈGE-08 — Statut sans whitelist
Python accepte n'importe quel string en `status`. Java DOIT décider : préserver ou whitelist. Recommandation = whitelist `{draft, pending_review}` côté Java.

### PIÈGE-09 — Atomicité 4 transactions Python
Décision Java : fusionner en 1 `@Transactional` (BR-39.15). Documenter explicitement.

### PIÈGE-10 — `delivery_modes` fallback (BR-39.10)
Le helper `_delivery_modes` est appelé DEUX FOIS dans le code Python (UPDATE l. 309, INSERT l. 385). Java doit appeler une seule fois et réutiliser la valeur.

### PIÈGE-11 — UPDATE annexes sans `seller_id`
Les 3 UPDATEs annexes Python n'ont QUE `WHERE product_id = $X`. Java DOIT ajouter `AND seller_id = $Y` par défense en profondeur (pas une rupture compat — un attaquant ne peut de toute façon pas atteindre ce code via l'API normale).

### PIÈGE-12 — Datetime `now()`
Python utilise `datetime.now(timezone.utc)`. Java : `OffsetDateTime.now(ZoneOffset.UTC)` (ou `Instant.now()` selon préférence). Critical pour cohérence cross-slice.

### PIÈGE-13 — Body permissif vs Pydantic
Aucun DTO Pydantic ici. Java DOIT utiliser `Map<String,Object>` au controller pour ne PAS rejeter des bodies que Python accepterait (champ inconnu, type laxiste).

### PIÈGE-14 — `current_row["status"]` peut être NULL
La garde anti-downgrade utilise `not in ('draft', None)`. En pratique `status` est toujours `'draft'` à l'INSERT, mais la NULL-safety est explicite. Java : `current.getStatus() == null || "draft".equals(current.getStatus()) || ...`.

---

## 13. Tests Spring Boot

### Tests unitaires service
```java
@Test
void upsert_titleVide_thenBadRequest() {
    var body = Map.<String,Object>of("title", "  ", "description", "x".repeat(30), "product_type", "rental");
    assertThrows(BadRequestException.class, () -> service.upsert(body, user));
}

@Test
void upsert_pendingReviewSale_5erreurs_thenOrderPreserved() {
    var body = pendingReviewSaleWith5Errors();
    var ex = assertThrows(UnprocessableEntityException.class, () -> service.upsert(body, user));
    assertEquals("La catégorie du matériel est obligatoire.", ex.getMessage()); // 1ère
    assertEquals(5, ex.getDetails().size());
}
```

### Tests d'intégration controller (`@SpringBootTest` + `MockMvc`)
- Reproduire chaque ID `T39-POS-XX` du fichier TEST_CASES.

### Tests repository (`@DataJdbcTest` + Testcontainers PostgreSQL)
- Vérifier sérialisation `text[]` vs `jsonb` selon DDL réelle.

---

## 14. Configuration Spring Security

```java
.requestMatchers("/api/products", "/api/products/**").authenticated()
.requestMatchers(HttpMethod.GET, "/api/marketplace/products").permitAll()  // S38
```

> Réutilise le `JwtAuthFilter` de S23.

---

## 15. Critères de Done

- [ ] **Tous les paths corrects** : `POST /api/products`, `GET /api/products/mine`, `GET /api/products/{id}/detail` (PAS `/api/marketplace/products/...`)
- [ ] Body permissif (Map<String,Object>) — accepte tous les bodies que Python accepte
- [ ] Génération ID `prod_` + 12 hex
- [ ] UPSERT applicatif avec ownership check
- [ ] Garde anti-downgrade (403 + clé `detail`)
- [ ] Validation minimale draft (400 + clé `error`)
- [ ] Validation pending_review (422 + clés `error`+`details`, ordre exact)
- [ ] Bypass admin auto-publish (status="active", pas de notif)
- [ ] Snapshot seller_name/seller_picture à l'INSERT (figé en UPDATE)
- [ ] Helper `_delivery_modes` fallback
- [ ] Parse `price` virgule décimale
- [ ] Parse `available_quantity` int strict + max(1, ...)
- [ ] Cover image fallback `image_urls[0]`
- [ ] Notif admins push fire-and-forget HORS transaction
- [ ] Atomicité fusionnée en 1 `@Transactional` (documenté comme amélioration)
- [ ] `_clean()` datetime ISO 8601
- [ ] Wrapper différent selon endpoint (POST/mine/detail)
- [ ] 65+ tests T39-XX-NN passent
- [ ] Régressions S23 (auth) + S24 (URLs uploadées) + S38 (visibilité marketplace) vertes
- [ ] DDL Supabase auditée pour `text[]` vs `jsonb` sur 5 colonnes critiques
- [ ] Snake_case sérialisation activée
- [ ] Anomalies documentées : 4 transactions Python, status sans whitelist, ownership absent UPDATEs annexes

---

## 16. Hors scope (rappel)

Ne PAS implémenter dans S39 :
- `DELETE /api/products/{id}` → S40
- `POST /api/products/{id}/reactivate` → S40
- Routes admin produits (`/admin/products/*`, validation/rejet) → S41
- Workers (`MediaPurgeWorker`, `AdminProductReminderWorker`) → slice worker dédiée
- Stripe Product/Price API (champs `stripe_product_id`/`stripe_price_id` peuplés ailleurs) → S42+

---

## 17. Roadmap suggérée post-S39

| Slice | Périmètre |
|---|---|
| **S40** | Lifecycle produit : DELETE soft + POST reactivate + worker `MediaPurgeWorker` + table `pending_file_deletions` |
| **S41** | Admin produits : validation/rejet (`pending_review → active/rejected`), CRUD admin |
| **S42** | Stripe Product/Price sync (création produit Stripe sur `pending_review` accepté) |
| **S43** | Reservations / achats produits (booking marketplace) |
