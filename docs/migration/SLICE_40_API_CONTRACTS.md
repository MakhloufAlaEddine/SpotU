# SLICE_40_API_CONTRACTS.md — Contrats API Marketplace lifecycle seller
> Basé sur `routes/product_creation_routes.py:459–556`.
> Généré le 2026-04-30.

---

## Endpoint 1 — `DELETE /api/products/{product_id}`

> ⚠️ Path réel : **`/api/products/{product_id}`**, pas `/api/marketplace/products/{...}`. (Cf. SCOPE § ALERTE PATH).

### Headers
- `Authorization: Bearer <jwt>` **obligatoire**
- Pas de `Content-Type` (pas de body)

### Path params
- `product_id` : string (ex: `prod_a1b2c3d4e5f6`)

### Query params
Aucun.

### Body
Aucun (DELETE).

### Réponse 200 — succès

```json
{
  "ok": true,
  "media_purge_scheduled_at": "2026-07-29T12:34:56.789012+00:00"
}
```

| Champ | Type | Sens |
|---|---|---|
| `ok` | bool | Toujours `true` en cas de succès |
| `media_purge_scheduled_at` | ISO 8601 string | `now() + 90 jours` (UTC) — informatif pour le front (peut afficher "Médias supprimés définitivement le ...") |

### Erreurs

| HTTP | Quand | Body |
|---|---|---|
| **401** | JWT absent / invalide | (via `require_auth` — voir S23) |
| **404** | Produit inexistant **OU** appartient à un autre user **OU** déjà `status='deleted'` | `{"error": "Produit introuvable ou non autorisé."}` |

> ⚠️ **Anti-énumération** : 404 dans les 3 cas (pas de 403). Java DOIT préserver — message volontairement opaque.

> ⚠️ Format `{"error": ...}` (clé `error`, PAS `detail` — le code utilise `JSONResponse`, pas `HTTPException`).

### Effets de bord

| Effet | Détail |
|---|---|
| UPDATE `marketplace_products` | `status='deleted'`, `deleted_at=now()`, `deleted_by=user_id`, `media_purge_scheduled_at=now()+90j`, `updated_at=now()` |
| INSERT N rows `pending_file_deletions` | 1 INSERT par image dans `image_urls[]` (cover incluse uniquement si elle figure dans `image_urls[]` — sinon NON ; cf. PIÈGE-API-01). `entity_type='product'`, `entity_id=product_id`, `scheduled_at=now()+90j`, `ON CONFLICT DO NOTHING`. |
| **Visibilité immédiate** | `GET /marketplace/products` (S38) et `GET /products/mine` (S39) cessent de retourner ce produit (filtres `status='active'` et `status != 'deleted'`) |

### Cas non gérés explicitement (compat à préserver)

- DELETE **idempotent** : un 2e DELETE sur un produit déjà supprimé → **404** (pas 200) car le filtre `AND status != 'deleted'` exclut le produit du SELECT initial. Java doit reproduire ce comportement.
- DELETE d'un produit `status='active'` ou `status='pending_review'` ou `status='draft'` → 200 (autorisé sans guard métier — un seller peut supprimer même un produit publié).

---

## Endpoint 2 — `POST /api/products/{product_id}/reactivate`

### Headers
- `Authorization: Bearer <jwt>` **obligatoire**
- `Content-Type: application/json` (body vide accepté)

### Path params
- `product_id` : string

### Query params
Aucun.

### Body
Aucun (le code ne lit pas `request.json()`). Java doit accepter body vide OU body JSON ignoré.

### Réponse 200 — succès

```json
{
  "ok": true,
  "reactivated": true,
  "product_id": "prod_a1b2c3d4e5f6",
  "media_purged": false,
  "requires_media_reupload": false
}
```

| Champ | Type | Sens |
|---|---|---|
| `ok` | bool | Toujours `true` |
| `reactivated` | bool | Toujours `true` (l. 552) — redondance compat |
| `product_id` | string | Echo du path param |
| `media_purged` | bool | Valeur DB de `media_purged` AVANT le UPDATE (lignes 549) — indique si la purge T+90 a déjà eu lieu |
| `requires_media_reupload` | bool | **Égal à `media_purged`** (l. 555) — alias front-friendly |

### 2 modes implicites de réponse

| Mode | Quand | Réponse |
|---|---|---|
| **Restauration totale** | Reactivate < 90j (médias intacts) | `media_purged=false`, `requires_media_reupload=false` |
| **Restauration partielle** | Reactivate ≥ 90j (worker a déjà purgé) | `media_purged=true`, `requires_media_reupload=true` — front DOIT proposer un re-upload |

### Erreurs

| HTTP | Quand | Body |
|---|---|---|
| **401** | JWT absent / invalide | — |
| **404** | Produit inexistant en DB (peu importe son status) | `{"detail": "Produit introuvable"}` |
| **409** | Produit existe MAIS `status != 'deleted'` OU `deleted_at IS NULL` | `{"detail": "Ce produit n'est pas supprimé"}` |
| **403** | Produit existe et est supprimé MAIS `seller_id != user_id` ET `user.role != 'admin'` | `{"detail": "Non autorisé"}` |

> ⚠️ **Format `{"detail": ...}`** (clé `detail`) — le code utilise `HTTPException`, pas `JSONResponse`. **Asymétrie volontaire vs DELETE** (qui utilise `{"error": ...}`).

### Effets de bord

| Effet | Détail |
|---|---|
| DELETE rows `pending_file_deletions` | `WHERE entity_id=$X AND status='pending'` — annule TOUTES les entrées encore en attente (peu importe l'`entity_type`, mais en pratique seules les `entity_type='product'` matchent). **NE TOUCHE PAS** les rows déjà `processing/deleted/failed/skipped`. |
| UPDATE `marketplace_products` | `status='active'`, `deleted_at=NULL`, `deleted_by=NULL`, `media_purge_scheduled_at=NULL`, `media_purge_notified_at=NULL`, `reactivated_at=now()`, `updated_at=now()` |
| **`media_purged` NON modifié** | Reste `TRUE` ou `FALSE` selon l'état pré-existant. **C'est ce qui dicte `requires_media_reupload`**. |
| **Visibilité immédiate** | Le produit revient dans `GET /marketplace/products` et `GET /products/mine` (status redevient `active`). |

> ⚠️ **`status` repasse à `'active'` directement, PAS à `'draft'`**. Anomalie compat documentée — un produit qui n'avait jamais été publié (était en `draft` avant DELETE) devient `active` à la reactivate. Java doit préserver.

> ⚠️ **`pending_review` perdu** : si le produit était en `pending_review` avant DELETE, reactivate force `status='active'` — la modération est court-circuitée. Anomalie. Java DOIT préserver (compat stricte) — peut être corrigé dans une slice ultérieure.

---

## Récapitulatif erreurs HTTP — asymétrie format

| Code | Endpoint | Format JSON |
|---|---|---|
| 200 | DELETE | `{"ok": true, "media_purge_scheduled_at": "..."}` |
| 200 | Reactivate | `{"ok": true, "reactivated": true, ...}` |
| 401 | les deux | (handler global S23) |
| **404** | DELETE | `{"error": "..."}` (`JSONResponse`) |
| **404** | Reactivate | `{"detail": "..."}` (`HTTPException`) |
| **409** | Reactivate | `{"detail": "..."}` |
| **403** | Reactivate | `{"detail": "..."}` |

> 🔴 **PIÈGE-API-01 (clé `error` vs `detail`)** : DELETE et Reactivate utilisent des **mécanismes FastAPI différents** pour les erreurs. Java DOIT préserver les 2 formats divergents — le front teste sur `error` pour DELETE et `detail` pour Reactivate.

---

## Cas limites

| Cas | DELETE | Reactivate |
|---|---|---|
| Produit avec 0 image | 200 OK (boucle INSERT vide, aucune entry pending_file_deletions) | 200 OK |
| Produit avec 50 images | 200 OK (50 INSERTs séquentiels — pas de batch) | 200 OK |
| `image_urls` est NULL en DB | Boucle `imgs = row["image_urls"] or []` → boucle vide | — |
| `image_urls` stocké en string JSON (legacy) | Parse `json.loads(imgs)` (l. 487–491) → liste OK | — |
| `image_urls` stocké en string non-JSON | Fallback `imgs = []` (try/except l. 488–491) | — |
| URL avec préfixe vide `""` | `if url:` exclut (l. 493) | — |
| 2e DELETE consécutif | 404 (filtre `status != 'deleted'`) | — |
| 2e Reactivate consécutif | — | 409 (`status != 'deleted'`) |
| Reactivate par admin sur produit d'un autre seller | — | 200 OK (bypass `is_admin`) |
| Reactivate par owner d'un produit jamais supprimé | — | 409 |
| Reactivate après purge worker (≥90j, `media_purged=TRUE`) | — | 200 OK avec `requires_media_reupload=true` ; les images N'EXISTENT PLUS sur R2 mais leurs URLs restent dans `image_urls[]` DB (ANOMALIE compat — front doit gérer 404 image) |
