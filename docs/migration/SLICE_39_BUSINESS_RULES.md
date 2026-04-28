# SLICE_39_BUSINESS_RULES.md — Règles métier Marketplace création produit
> Basé sur `routes/product_creation_routes.py:1–568`.
> Généré le 2026-04-29.

---

## BR-39.01 — Auth obligatoire (tous endpoints)

### Règle
`require_auth` middleware (S23) appliqué sur les 3 endpoints. **Aucune exception, aucun mode public**.

### Java
```java
.requestMatchers("/api/products/**").authenticated()
```

### Test
- 401 si JWT absent
- 401 si JWT invalide/expiré
- 200 si JWT valide (any role)

> ⚠️ **AUCUN check de rôle.** Tout user authentifié peut créer un produit. Ne pas ajouter `hasRole(...)` en Java.

---

## BR-39.02 — UPSERT applicatif (pas SQL ON CONFLICT)

### Règle
- Si `body.product_id` est fourni :
  - SELECT existence avec ownership (`product_id=? AND seller_id=?`)
  - Si trouvé → branche UPDATE
  - Si absent → branche INSERT (avec le `product_id` fourni — Java doit accepter)
- Si `body.product_id` absent → INSERT avec id auto-généré `prod_<12 hex>`

### Java
```java
String pid = body.getProductId() != null ? body.getProductId() : generateNewId();
boolean exists = repo.existsByProductIdAndSellerId(pid, userId);
if (exists) update(...);
else insert(...);
```

> ⚠️ **NE PAS** utiliser `INSERT ... ON CONFLICT DO UPDATE` — cela contournerait l'ownership check. Si attaquant envoie `product_id` d'un autre user, ON CONFLICT écraserait sans vérification.

---

## BR-39.03 — Génération ID produit

### Règle
```python
"prod_" + uuid.uuid4().hex[:12]
```
→ Préfixe `prod_` + 12 caractères hex (sous-string d'un UUID4).

### Java
```java
"prod_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12)
```

> ⚠️ Format strict — préfixe `prod_` obligatoire (le front filtre/parse sur ce préfixe).

---

## BR-39.04 — Statuts valides

### Règle
Statuts pilotables par body : `"draft"` (défaut), `"pending_review"`.
Statuts internes (non settables par le user) : `"active"` (admin auto), `"rejected"`, `"sold"`, `"archived"`, `"deleted"`.

### Mapping body → DB

| `body.status` | User normal | User admin |
|---|---|---|
| (absent) | `"draft"` (défaut) | `"draft"` |
| `"draft"` | `"draft"` | `"draft"` |
| `"pending_review"` | `"pending_review"` (notif admins) | **`"active"`** (auto-publie, pas de notif) |
| autre valeur | inscrite tel quelle (anomalie compat) | inscrite tel quelle |

> ⚠️ Le code Python n'a **AUCUN whitelist** sur `status`. Java doit décider : préserver (compat) ou ajouter validation. Recommandation : whitelist `{draft, pending_review}` + 400 sinon (rupture compat mineure mais sécurise).

---

## BR-39.05 — Bypass admin = publication directe

### Règle (lignes 131–133)
```python
is_admin = user.get("role") == "admin"
if is_admin and status == "pending_review":
    status = "active"
```

### Java
```java
if ("admin".equals(user.role()) && "pending_review".equals(requestedStatus)) {
    statusToWrite = "active";
}
```

### Effets
- Pas de notif admins (`if requested_status == "pending_review" and not is_admin` → false)
- Produit visible immédiatement dans `/api/marketplace/products` (S38)

---

## BR-39.06 — Validations `pending_review` (commun + branchement product_type)

### Règle (lignes 184–229)

**Validations COMMUNES** (rental + sale) :
- `category` non-vide (strip) — sinon "La catégorie du matériel est obligatoire."
- `tag_ids` non-vide — sinon "Sélectionne au moins un tag pour publier le produit."
- `condition_label` non-vide — sinon "L'état du matériel est obligatoire."
- `description.strip().length >= 30` — sinon "La description doit faire au moins 30 caractères."
- `image_urls` non-vide — sinon "Au moins une photo est requise."

**Validations spécifiques `product_type == "sale"`** :
- `price > 0` — sinon "Le prix de vente doit être supérieur à 0."
- `available_quantity >= 1` — sinon "La quantité disponible doit être au minimum 1."
- `pickup_type` non-vide — sinon "Le mode de remise est obligatoire."

**Validations spécifiques `product_type == "rental"`** :
- `price > 0` — sinon "Le prix doit être supérieur à 0." (libellé différent de sale)
- `pickup_type` non-vide — sinon "Le mode de remise du matériel est obligatoire." (libellé différent)
- `"session" IN pricing_modes` AND `related_spotyou_ids` vide → "La tarification par séance nécessite de sélectionner au moins un SpotYou."
- `deposit_required == true` AND (`!deposit_amount` OR `deposit_amount <= 0`) → "Le montant de la caution est obligatoire si une caution est requise."

### Réponse 422

```json
{
  "error": "<errors[0]>",
  "details": ["<err1>", "<err2>", ...]
}
```

> ⚠️ **`error` = première erreur uniquement** ; `details[]` = toutes les erreurs. Java doit reproduire cet ordre exact (front affiche probablement `error` en toast et `details` en liste). Ordre des push dans `errors[]` = ordre du code Python (à préserver pour idempotence des tests front).

---

## BR-39.07 — Validation minimale (toujours, même draft)

### Règle (lignes 136–152)
Même en `draft`, ces validations s'appliquent et retournent **400** (PAS 422) :
- `title.strip()` non-vide
- `product_type` ∈ {rental, sale}
- `description.strip().length >= 30`

### Java
```java
if (title == null || title.strip().isEmpty())
    throw new BadRequest("Le titre est obligatoire.");
```

> ⚠️ **Anomalie UX documentée** : un brouillon sans description ≥30 caractères est rejeté en 400. Le front contourne en envoyant des descriptions placeholder. Compat stricte = préserver.

---

## BR-39.08 — Anti-downgrade status (UPDATE seulement)

### Règle (lignes 244–248)
Si le produit existe déjà ET `current.status NOT IN ('draft', NULL)` ET `body.status == 'draft'` → **403**.

### Java
```java
if (current.getStatus() != null
    && !"draft".equals(current.getStatus())
    && "draft".equals(requestedStatus)) {
    throw new ForbiddenException("Impossible de repasser en brouillon : ce produit a déjà été soumis ou validé.");
}
```

### Effets
- Empêche un seller de "rétrograder" son produit publié à brouillon (perdrait visibilité marketplace).
- **N'empêche PAS** : passer `pending_review → draft` (autorisé car `pending_review NOT IN ('draft', None)` mais... **l'admin a probablement déjà commencé la review**). Anomalie potentielle. Compat stricte = préserver.

---

## BR-39.09 — Snapshot dénormalisé (INSERT seulement)

### Règle (lignes 317–318, 359–360)
À l'INSERT, capture :
- `seller_name = user.full_name OR user.username OR "Utilisateur"`
- `seller_picture_url = user.picture_url`

Ces champs ne sont **JAMAIS** mis à jour à l'UPDATE (intentionnel : snapshot figé).

### Java
```java
String sellerName = Optional.ofNullable(user.fullName())
    .or(() -> Optional.ofNullable(user.username()))
    .orElse("Utilisateur");
String sellerPictureUrl = user.pictureUrl();
```

> ⚠️ **Conséquence métier** : si l'utilisateur change son nom, les anciens produits gardent l'ancien nom. Compat stricte = préserver. Une slice future pourrait ajouter un sync (hors scope).

---

## BR-39.10 — Helper `_delivery_modes` (fallback)

### Règle (lignes 560–567)
Si `body.delivery_modes` absent OU vide, dérive de `pickup_type` :
- `pickup_type == "local_pickup"` → `["local_pickup"]`
- `pickup_type == "creator_handoff"` → `["creator_handoff"]`
- autre/null → `["local_pickup"]`

### Java
```java
public static List<String> deliveryModes(ProductBody body) {
    if (body.deliveryModes() != null && !body.deliveryModes().isEmpty()) {
        return body.deliveryModes();
    }
    String pickup = Optional.ofNullable(body.pickupType()).orElse("");
    if ("local_pickup".equals(pickup)) return List.of("local_pickup");
    if ("creator_handoff".equals(pickup)) return List.of("creator_handoff");
    return List.of("local_pickup");
}
```

---

## BR-39.11 — Parse robuste `price` / `deposit_amount` / `price_per_session`

### Règle (lignes 154–164, 394–398)
```python
float(str(price_raw).replace(",", "."))  # accepte "12,50" ou "12.50"
```
Erreur de parse → fallback `0.0` (price) ou `null` (deposit, session).

### Java
```java
public static double parsePrice(Object raw) {
    if (raw == null) return 0.0;
    try { return Double.parseDouble(String.valueOf(raw).replace(",", ".")); }
    catch (NumberFormatException e) { return 0.0; }
}
```

> ⚠️ Format virgule **obligatoire** (UI mobile FR). Java DOIT accepter `"12,50"`.

---

## BR-39.12 — Parse robuste `available_quantity`

### Règle (lignes 168–172)
```python
max(1, int(qty_raw)) if qty_raw else 1
```
- Falsy (0, "", None) → 1
- Sinon `max(1, int(...))` (jamais < 1)
- Erreur de parse → fallback 1

> ⚠️ Anomalie : `int("12.5")` lève ValueError → fallback 1. Java reproduit ce comportement (n'accepter que des entiers stricts).

---

## BR-39.13 — Cover image fallback

### Règle (lignes 174–177)
```python
image_urls = body.get("image_urls") or []
cover_image_url = body.get("cover_image_url") or (image_urls[0] if image_urls else None)
image_url = cover_image_url  # rétro-compat champ legacy
```

### Java
```java
List<String> images = Optional.ofNullable(body.imageUrls()).orElse(List.of());
String cover = Optional.ofNullable(body.coverImageUrl())
    .or(() -> images.stream().findFirst())
    .orElse(null);
String legacyImageUrl = cover; // rétro-compat
```

---

## BR-39.14 — Notification admins (push fire-and-forget)

### Règle (lignes 428–429, 434–455)
SI `requested_status == "pending_review"` AND `not is_admin` → après commit :
1. SELECT `user_id FROM users WHERE role = 'admin'`
2. Pour chaque admin → `send_push_to_user(...)` avec :
   - title: "Nouvelle annonce à valider"
   - body: `« {title} » est en attente de publication.`
   - data: `{type: "admin_product_pending", product_id, action: "/admin?tab=products"}`
   - notif_type: `"admin_product_pending"`

### Java
- **Hors transaction** (à exécuter APRÈS commit du produit)
- Async / fire-and-forget — JAMAIS bloquant pour la réponse HTTP
- Pas de retry, pas de DLQ — silence en cas d'échec (compat)

```java
@Async
public void notifyAdmins(String productId, String title) {
    List<String> adminIds = userRepo.findAdminUserIds();
    for (String aid : adminIds) {
        try { pushService.sendToUser(aid, "Nouvelle annonce à valider",
            "« " + title + " » est en attente de publication.",
            Map.of("type", "admin_product_pending",
                   "product_id", productId,
                   "action", "/admin?tab=products"),
            "admin_product_pending");
        } catch (Exception ignored) {}
    }
}
```

---

## BR-39.15 — Atomicité fragmentée (anomalie préservable OU corrigeable)

### Règle observée
4 écritures dans 4 connexions distinctes :
1. INSERT/UPDATE principal (46 ou 41 colonnes)
2. UPDATE `price_per_session`
3. UPDATE `brand, model, weight, stripe_*`
4. UPDATE `location_address_raw`

### Décision Java requise

| Option | Pro | Con |
|---|---|---|
| Préserver 4 transactions | Compat stricte 100% | Risque de produit partiel |
| Fusionner en 1 `@Transactional` | Robustesse | **Différence comportementale en cas d'erreur** (rollback total vs partiel) |

> Recommandation : **fusionner** (option 2) et documenter explicitement comme amélioration intentionnelle dans CURSOR_NOTES.

---

## BR-39.16 — Ownership obligatoire (UPDATE + GET detail)

### Règle
- UPDATE : `WHERE product_id = $1 AND seller_id = $2` (Python ligne 271)
- GET detail : `WHERE product_id = $1 AND seller_id = $2 AND status != 'deleted'` (ligne 103)
- GET mine : `WHERE seller_id = $1 AND status != 'deleted' AND product_type IN ('rental','sale')` (l. 64)

### Comportements

| Cas | Code |
|---|---|
| GET detail / un autre user | **404** (pas 403) — anti-énumération |
| UPDATE non-owner | UPDATE 0 ligne (silencieux) — Java DOIT vérifier `affectedRows == 1` |
| GET mine d'un autre user | **Impossible** (pas de path param userId) |

### Java
```java
int n = jdbc.update(SQL_UPDATE, ...);
if (n == 0) throw new NotFoundException(); // ou 403 si on veut être plus explicite
```

> ⚠️ Compat : retourner 200 même si UPDATE 0 ligne ? Le Python NE vérifie PAS `affectedRows`. Donc Java doit accepter ce silence. **MAIS** il y a déjà eu un SELECT existence en amont, donc le cas n'arrive pas en pratique (sauf race). Préserver le comportement.

---

## BR-39.17 — Filtre `product_type IN ('rental', 'sale')` sur `/mine`

### Règle (ligne 66)
`/products/mine` n'affiche QUE les produits `rental` ou `sale`. Les autres types éventuels (legacy) n'apparaissent pas.

### Java
```java
@Query("... WHERE seller_id = :uid AND status <> 'deleted' AND product_type IN ('rental','sale')")
```

---

## BR-39.18 — Wrapping réponse asymétrique

### Règle observée
- `GET /products/mine` → `{"products": [...], "count": N}` (wrapper)
- `GET /products/{id}/detail` → `{...}` direct (pas de wrapper)
- `POST /products` → `{"product_id": "...", "status": "..."}` (minimal)

### Java
Préserver les 3 formats DIVERGENTS — le front s'appuie dessus.

---

## Récapitulatif des règles

| ID | Règle | Niveau |
|---|---|---|
| BR-39.01 | Auth obligatoire | 🔴 Critique |
| BR-39.02 | UPSERT applicatif | 🔴 Critique |
| BR-39.03 | Génération ID `prod_` + 12 hex | 🟡 Important |
| BR-39.04 | Statuts valides | 🟡 Important |
| BR-39.05 | Bypass admin auto-publish | 🔴 Critique |
| BR-39.06 | Validations `pending_review` | 🔴 Critique |
| BR-39.07 | Validation minimale (400) | 🔴 Critique |
| BR-39.08 | Anti-downgrade status | 🔴 Critique |
| BR-39.09 | Snapshot seller dénormalisé | 🟡 Important |
| BR-39.10 | Helper `_delivery_modes` fallback | 🟢 Mineur |
| BR-39.11 | Parse robuste virgule décimale | 🔴 Critique |
| BR-39.12 | Parse `available_quantity` | 🟡 Important |
| BR-39.13 | Cover image fallback | 🟢 Mineur |
| BR-39.14 | Notif admins push F&F | 🟡 Important |
| BR-39.15 | Atomicité fragmentée | 🟡 Important |
| BR-39.16 | Ownership UPDATE/detail | 🔴 Critique |
| BR-39.17 | Filtre `/mine` rental+sale | 🟢 Mineur |
| BR-39.18 | Wrapping réponse asymétrique | 🟡 Important |
