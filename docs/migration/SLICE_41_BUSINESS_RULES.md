# SLICE_41_BUSINESS_RULES.md — Règles métier Marketplace admin moderation
> Basé sur `routes/admin_product_routes.py:1–207` + `admin_product_reminder_worker.py:1–104`.
> Généré le 2026-04-30.

---

## BR-41.01 — Auth admin (4 endpoints)

### Règle (helper `_require_admin` l. 30–34)
```python
async def _require_admin(request, pool):
    user = await require_auth(request, pool)  # 401 si JWT KO
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user
```

### Java
```java
.requestMatchers("/api/admin/**").hasRole("ADMIN")
```
+ Custom `AccessDeniedHandler` qui retourne `{"detail": "Admin only"}` (PAS le default Spring `{"timestamp", "status", ...}`).

> ⚠️ Body 403 strict — front teste `data.detail === "Admin only"`. Compat absolue.

---

## BR-41.02 — Format JSON erreurs asymétrique

### Règle observée

| Code | Mécanisme Python | Body |
|---|---|---|
| 401 | `require_auth` (S23) | (S23 default) |
| 403 | `HTTPException` | `{"detail": "Admin only"}` |
| 404 | `JSONResponse` | `{"error": "Produit introuvable."}` |

### Java
- 403 → custom AccessDeniedHandler avec `Map.of("detail", "Admin only")`
- 404 → custom exception + handler retournant `Map.of("error", msg)`

> ⚠️ Préserver les **2 schémas distincts** (clé `detail` vs `error`).

---

## BR-41.03 — `quality_score` calculé en SQL

### Règle (l. 63–73)
9 critères pondérés, total 0–100, calculés en SQL (`CASE WHEN`).

| Critère | Points |
|---|---|
| `cover_image_url IS NOT NULL` | +20 |
| `jsonb_array_length(image_urls) >= 3` | +10 |
| `length(title) >= 10` | +15 |
| `length(title) >= 25` | +5 |
| `length(description) >= 50` | +10 |
| `length(description) >= 150` | +10 |
| `price > 0` | +10 |
| `pickup_type IS NOT NULL` | +10 |
| `lat IS NOT NULL` | +10 |

### Java
**Préserver le calcul en SQL** (pas en Java). Avantage : 0 transfert de données + précision PostgreSQL native.

> ⚠️ **Cumul implicite** : `length(title) >= 25` ajoute 5 EN PLUS des 15 de `>= 10` (pas un OR exclusif). Java doit reproduire la logique cumulative.

---

## BR-41.04 — `_clean()` datetime ISO

### Règle (l. 20–27)
```python
def _clean(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if hasattr(v, 'isoformat'):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out
```

### Java
Jackson `JavaTimeModule` + `WRITE_DATES_AS_TIMESTAMPS=false` + format `OffsetDateTime`. Sortie : `"2026-04-29T10:00:00+00:00"`.

---

## BR-41.05 — GET pending — FIFO strict + JOIN strict

### Règle (l. 76–77)
- `WHERE p.status = 'pending_review'`
- `ORDER BY p.created_at ASC` — **plus anciens d'abord** (FIFO)
- `JOIN users` (PAS LEFT JOIN) — produit avec seller orphelin invisible

### Java
```java
@Query("""
    SELECT ... FROM marketplace_products p
    JOIN users u ON u.user_id = p.seller_id
    WHERE p.status = 'pending_review'
    ORDER BY p.created_at ASC
""")
```

> ⚠️ JOIN strict = compat. Java peut basculer vers LEFT JOIN (fix mineur) — documenter explicitement comme amélioration.

---

## BR-41.06 — GET detail — `SELECT p.*` (drift volontaire)

### Règle (l. 92)
`SELECT p.*` retourne TOUTES les colonnes de `marketplace_products` (~40+).

### Java
**Préserver le drift** : utiliser `Map<String, Object>` ou DTO open-ended. Si nouvelle colonne ajoutée à `marketplace_products`, elle apparaît automatiquement en réponse.

> ⚠️ **Avantage admin** : pas besoin de redéployer Java pour exposer un nouveau champ debug. **Rupture compat mineure** si DTO strict choisi.

---

## BR-41.07 — Approve / Reject : aucun guard sur statut courant

### Règle (l. 125–141, l. 173–189)
SELECT pré-UPDATE ne filtre QUE sur `product_id = $1`. Aucune vérification que `status == 'pending_review'`.

### Conséquences (compat permissive)

| Action | Statut courant | Comportement Python |
|---|---|---|
| approve | `pending_review` | ✅ Flow nominal |
| approve | `active` | ✅ Idempotent — UPDATE re-écrase `admin_validated_at`, push renvoyé |
| approve | `rejected` | ✅ Override — produit publié |
| approve | `draft` | ✅ Skip review — non documenté |
| approve | `deleted` | 🔴 ZOMBIE — produit ressuscité en `active` |
| reject | tout statut | ✅ Force `rejected` |

### Java
**Préserver compat permissive**. Recommandation : log WARN si transition inattendue (`active → *`, `deleted → *`) pour audit post-cutover.

```java
if (!"pending_review".equals(currentStatus)) {
    log.warn("Admin {} approves product {} from unexpected status {}", adminId, productId, currentStatus);
}
```

---

## BR-41.08 — UPDATE approve : 5 colonnes

### Règle (l. 132–141)
- `status='active'`, `in_stock=TRUE`
- `admin_validated_by=user_id`, `admin_validated_at=now()`
- `admin_comment=comment_or_null`
- `updated_at=now()` (même valeur que `admin_validated_at`)

### Java
```java
repo.approve(productId, adminId, now, comment);
```

> ⚠️ **NE PAS toucher** `rejection_reason` — laissé tel quel (pourrait contenir un précédent rejet ; comportement compat).

---

## BR-41.09 — UPDATE reject : 6 colonnes (avec duplication `comment`)

### Règle (l. 180–189)
- `status='rejected'`, `in_stock=FALSE`
- `admin_validated_by=user_id`, `admin_validated_at=now()`
- **`rejection_reason=comment_or_null` ET `admin_comment=comment_or_null`** (même valeur, 2 colonnes)
- `updated_at=now()`

### Java
```java
String comment = parseComment(body);  // null si vide
repo.reject(productId, adminId, now, comment);  // Le SQL utilise :comment 2 fois
```

> ⚠️ **Anomalie compat préservée** : `rejection_reason` ET `admin_comment` reçoivent la même valeur. Une slice future pourrait les disjoindre (ex: rejection_reason public au seller, admin_comment note interne).

---

## BR-41.10 — Body comment : optionnel, strip(), vide → null DB

### Règle (l. 121, 167)
```python
comment = (body.get("comment") or "").strip()
# Plus tard:
comment or None  # vide → None pour DB
```

### Java
```java
public static String parseComment(Map<String,Object> body) {
    Object v = body.get("comment");
    if (v == null) return null;
    String s = String.valueOf(v).strip();
    return s.isEmpty() ? null : s;
}
```

> ⚠️ Body vide `{}` ou body sans `comment` → DB `null`. Body `{"comment": "  "}` → DB `null` (après strip). Compat strict.

---

## BR-41.11 — Push notif synchrone (vs `@Async` recommandé)

### Règle (l. 144–155, l. 192–204)
```python
await send_push_to_user(...)  # SYNC, bloque la réponse HTTP
```

### Java — décision
- **Compat stricte** : appel synchrone côté service.
- **Recommandation** : `@Async` + retourner réponse HTTP avant push (gain UX 200–500ms typiquement).

```java
@Async("pushExecutor")
public void notifySellerApproved(String sellerId, String productId, String title) { ... }
```

> ⚠️ Si `@Async`, attention au order : le push doit être appelé APRÈS commit (sinon notif sur transaction rollbackée). Utiliser `TransactionSynchronizationManager.registerSynchronization(...)` pour exécuter post-commit.

---

## BR-41.12 — Push approve : payload exact

### Règle (l. 144–155)
```python
title = "Produit publié !"
body = f"Ton annonce « {row['title']} » a été validée et est maintenant visible dans la boutique."
data = {
    "type": "product_approved",
    "product_id": product_id,
    "action": "/products/my-products",
}
notif_type = "product_approved"
```

### Java
```java
pushService.send(sellerId,
    "Produit publié !",
    "Ton annonce « " + title + " » a été validée et est maintenant visible dans la boutique.",
    Map.of("type", "product_approved", "product_id", productId, "action", "/products/my-products"),
    "product_approved"
);
```

> ⚠️ **Guillemets typographiques `«` et `»`** (FR), pas `"..."`. Préserver octet-pour-octet.

> ⚠️ `product_id` dans `data` — clé snake_case (Python `data` est un dict). Le push payload final côté Expo conservera ce snake_case (pas de conversion auto). Java doit transmettre tel quel.

---

## BR-41.13 — Push reject : payload exact + deeplink édition

### Règle (l. 192–204)
```python
title = "Annonce refusée"
body = f"Ton annonce « {row['title']} » n'a pas été validée. Clique pour voir les corrections à apporter."
data = {
    "type": "product_rejected",
    "product_id": product_id,
    "admin_comment": comment,  # peut être "" string vide ! cf. BR-41.10 : DB stocke null mais data passe ""
    "action": f"/products/create?productId={product_id}&mode=edit",
}
notif_type = "product_rejected"
```

> ⚠️ **`data.admin_comment` peut être `""` (string vide)** ! Le code utilise `comment` (string sans `or None`), donc si body absent → `comment = ""`. La DB stocke `null` mais le push payload passe `""`. **Java DOIT reproduire cette divergence subtile** :
> ```java
> // Pour la DB :
> String dbComment = comment.isEmpty() ? null : comment;
> // Pour le push data :
> String pushComment = comment;  // peut être ""
> ```

> ⚠️ **Deeplink dynamique** avec `f"/products/create?productId={product_id}&mode=edit"`. Java :
> ```java
> "/products/create?productId=" + productId + "&mode=edit"
> ```

---

## BR-41.14 — Worker `AdminProductReminderWorker` — Cadence + idempotence

### Règle
- Cadence : `REMINDER_INTERVAL_SECS=600` (10 min)
- Délai avant rappel : `REMINDER_DELAY_HOURS=2`
- Filtre : produits `pending_review` ET `created_at < now() - 2h` ET (`admin_reminder_sent_at IS NULL OR admin_reminder_sent_at < now() - 2h`)
- LIMIT 50 par cycle
- UPDATE batch `admin_reminder_sent_at = now()` puis push à TOUS les admins par produit

### Java
```java
@Scheduled(fixedDelayString = "${app.admin-reminder.interval-ms:600000}")
public void cycle() {
    try {
        List<PendingProduct> products = repo.findPendingNeedingReminder(2);
        if (products.isEmpty()) return;
        List<String> adminIds = userRepo.findAdminUserIds();
        if (adminIds.isEmpty()) return;
        repo.markRemindersSent(products.stream().map(PendingProduct::id).toList(), now());
        for (var p : products) {
            for (var aid : adminIds) {
                pushService.sendAdminReminder(aid, p.title(), p.id());
            }
        }
    } catch (Exception e) {
        log.error("AdminProductReminderWorker erreur: {}", e.getMessage());
    }
}
```

> ⚠️ **Push notif worker** :
> - title : "Rappel : annonce en attente"
> - body : `"L'annonce « {title} » attend votre validation depuis 2h."`
> - data : `{type: "admin_product_reminder", product_id, action: "/admin?tab=products"}`
> - notif_type : `"admin_product_reminder"`

---

## BR-41.15 — Worker : ordre UPDATE puis push (anomalie acceptée)

### Règle (l. 53–73)
```python
await conn.execute("UPDATE admin_reminder_sent_at = $1 WHERE product_id = ANY($2)")
# UPDATE COMMITTED ICI

for product in rows:
    for admin_id in admin_ids:
        await send_push_to_user(...)  # peut échouer
```

### Conséquence
Si push échoue → `admin_reminder_sent_at` est déjà mis à jour → admins ne recevront pas de re-rappel avant le prochain cycle (10 min) MAIS le délai 2h s'applique aussi (donc pas de re-rappel avant 2h). **Les admins peuvent rater une notif** en cas de panne push.

### Java
**Préserver compat** (fire-and-forget tolérant). Recommandation : log WARN sur échec push, mais ne PAS retry.

---

## BR-41.16 — Worker : matrice push M×N

### Règle
Pour 5 produits × 3 admins → 15 push synchrones séquentiels.

### Java
**Recommandation** : `CompletableFuture.allOf` ou `@Async` (gain perf). Compat stricte = séquentiel (acceptable car worker en arrière-plan).

---

## BR-41.17 — Push worker payload — placeholder `2h`

### Règle (l. 66)
```python
body=f"L'annonce « {product['title']} » attend votre validation depuis {REMINDER_DELAY_HOURS}h."
```

### Java
**Soit** hardcoder "2h" (compat exacte si la constante ne change jamais) :
```java
body = "L'annonce « " + title + " » attend votre validation depuis 2h.";
```
**Soit** paramétrer via `application.yml` (cohérent avec scheduling).

---

## BR-41.18 — Pas de notification au seller en cas de timeout admin

### Règle observée
Le worker notifie UNIQUEMENT les admins, pas le seller. Le seller reste dans le noir si sa demande tarde (sauf consultation manuelle de `/products/mine`).

### Java
Préserver compat. Une slice future pourrait ajouter une notif seller à T+24h ("ton annonce est encore en review").

---

## BR-41.19 — Pas de transaction multi-table

### Règle
Approve et Reject font 1 SELECT puis 1 UPDATE puis 1 push. **Pas de `BEGIN/COMMIT`**, juste 2 connexions distinctes du pool (`async with pool.acquire()`).

### Java
Une seule `@Transactional` sur le service (UPDATE) + push hors transaction (`@Async` ou post-commit hook).

```java
@Transactional
public void approve(String productId, AuthUser admin, String comment) {
    var row = repo.findSellerAndTitle(productId)
        .orElseThrow(() -> new NotFoundException("Produit introuvable."));
    repo.approve(productId, admin.userId(), OffsetDateTime.now(ZoneOffset.UTC), comment);
    // Post-commit hook pour push
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
            @Override public void afterCommit() {
                pushService.notifyApproved(row.sellerId(), productId, row.title());
            }
        }
    );
}
```

---

## BR-41.20 — Pas de pagination

### Règle
GET pending sans LIMIT/OFFSET. Volume admin reste faible (typiquement <100 pending).

### Java
Préserver compat ; OPT : ajouter `LIMIT 200` par sécurité.

---

## BR-41.21 — `quality_score` exposé tel quel (pas de filtre admin)

### Règle
`quality_score` est calculé pour TOUS les produits pending (et detail). L'admin voit le score brut sans filtre/seuil.

### Java
Préserver. Une slice future pourrait ajouter un filtre `?min_quality=50` pour prioriser les bonnes annonces.

---

## Récapitulatif des règles

| ID | Règle | Niveau |
|---|---|---|
| BR-41.01 | Auth admin (4 endpoints) | 🔴 Critique |
| BR-41.02 | Format erreur asymétrique 403/404 | 🔴 Critique |
| BR-41.03 | `quality_score` SQL (9 critères, 100 max) | 🟡 Important |
| BR-41.04 | `_clean()` datetime ISO | 🟢 Mineur |
| BR-41.05 | GET pending FIFO + JOIN strict | 🟡 Important |
| BR-41.06 | GET detail `SELECT p.*` drift | 🟡 Important |
| BR-41.07 | Pas de guard statut courant approve/reject | 🔴 Critique |
| BR-41.08 | UPDATE approve 5 colonnes | 🔴 Critique |
| BR-41.09 | UPDATE reject 6 colonnes (`comment` x2) | 🔴 Critique |
| BR-41.10 | Comment optionnel, vide → null DB | 🟡 Important |
| BR-41.11 | Push synchrone (recommandation @Async) | 🟡 Important |
| BR-41.12 | Push approve payload exact | 🔴 Critique |
| BR-41.13 | Push reject payload + `data.admin_comment` peut être `""` | 🔴 Critique |
| BR-41.14 | Worker reminder cadence 600s + idempotence 2h | 🔴 Critique |
| BR-41.15 | Worker ordre UPDATE puis push | 🟢 Mineur |
| BR-41.16 | Worker push M×N | 🟢 Mineur |
| BR-41.17 | Worker payload "2h" hardcodé | 🟢 Mineur |
| BR-41.18 | Pas de notif seller timeout | 🟢 Mineur |
| BR-41.19 | Pas de transaction multi-table | 🟡 Important |
| BR-41.20 | Pas de pagination GET pending | 🟢 Mineur |
| BR-41.21 | `quality_score` exposé brut | 🟢 Mineur |
