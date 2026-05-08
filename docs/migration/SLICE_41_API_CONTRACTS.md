# SLICE_41_API_CONTRACTS.md — Contrats API Marketplace admin moderation
> Basé sur `routes/admin_product_routes.py:1–207`.
> Généré le 2026-04-30.

---

## Conventions communes

- **Auth** : `_require_admin` sur les 4 endpoints
  - 401 si JWT absent/invalide (via `require_auth` S23)
  - **403** si `user.role != 'admin'` avec body `{"detail": "Admin only"}`
- **Path** : `/api/admin/products/...` (router monté sans prefix dans server.py — préfixe `/api/admin/` vient du décorateur `@router.get("/admin/products/...")`)
- **Format datetime** : ISO 8601 avec offset (`isoformat()` Python)

---

## Endpoint 1 — `GET /api/admin/products/pending`

### Headers
- `Authorization: Bearer <jwt>` (admin)

### Path / Query / Body
Aucun.

### Réponse 200

```json
{
  "products": [
    {
      "product_id": "prod_a1b2c3d4e5f6",
      "title": "Vélo de route Trek",
      "short_description": "...",
      "price": 25.0,
      "pricing_type": "day",
      "category": "sport",
      "subcategory": "cyclisme",
      "cover_image_url": "https://...",
      "image_url": "https://...",
      "image_urls": ["https://...", "..."],
      "condition_label": "good",
      "available_quantity": 1,
      "deposit_required": true,
      "deposit_amount": 200.0,
      "pickup_type": "local_pickup",
      "city": "Paris",
      "lat": 48.8566,
      "lng": 2.3522,
      "return_rules": "...",
      "cancellation_rules": "...",
      "pickup_notes": "...",
      "availability_note": "...",
      "related_spotyou_ids": [],
      "seller_id": "user_xxx",
      "status": "pending_review",
      "created_at": "2026-04-29T10:00:00+00:00",
      "updated_at": "2026-04-29T10:00:00+00:00",
      "admin_reminder_sent_at": null,
      "seller_name": "Jean Dupont",
      "seller_picture": "https://...",
      "quality_score": 80
    }
  ],
  "count": 1
}
```

### Filtre + tri SQL
```sql
WHERE p.status = 'pending_review'
ORDER BY p.created_at ASC
```

> ⚠️ **FIFO strict** : `ASC` (PAS `DESC`). Les plus anciens en attente apparaissent en premier — alimente naturellement le worker reminder.

### `quality_score` — formule SQL exacte (l. 63–73)

```sql
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
```

| Critère | Points |
|---|---|
| `cover_image_url IS NOT NULL` | +20 |
| `image_urls` ≥ 3 entrées | +10 |
| `title.length ≥ 10` | +15 |
| `title.length ≥ 25` | +5 |
| `description.length ≥ 50` | +10 |
| `description.length ≥ 150` | +10 |
| `price > 0` | +10 |
| `pickup_type IS NOT NULL` | +10 |
| `lat IS NOT NULL` | +10 |
| **Maximum théorique** | **100** |

### Champs JOIN users
- `u.name AS seller_name`
- `u.picture AS seller_picture`

### Erreurs

| HTTP | Quand | Body |
|---|---|---|
| 401 | JWT KO | (S23 default) |
| **403** | `user.role != 'admin'` | `{"detail": "Admin only"}` |

### Effets de bord
Aucun (lecture pure).

---

## Endpoint 2 — `GET /api/admin/products/{product_id}`

### Headers
- `Authorization: Bearer <jwt>` (admin)

### Path params
- `product_id`

### Réponse 200 — `SELECT p.*` + JOIN users

```json
{
  "product_id": "prod_...",
  "title": "...",
  "...": "TOUS les champs de marketplace_products (SELECT p.*)",
  "seller_name": "Jean Dupont",
  "seller_picture": "https://...",
  "seller_email": "jean@example.com",
  "quality_score": 80
}
```

> ⚠️ **`SELECT p.*`** — toutes les colonnes de `marketplace_products` remontent (incluant `stripe_*`, `admin_*`, `deleted_*`, `media_*`, etc.). **Drift schéma** : si on ajoute une colonne en DB, elle apparaît automatiquement en réponse. Java DOIT préserver ce comportement (ne PAS lister les colonnes manuellement) ou documenter explicitement comme rupture compat.

> ⚠️ **`seller_email` SUPPLÉMENTAIRE vs endpoint #1** — endpoint #1 expose `name` + `picture` ; endpoint #2 ajoute `email`. Asymétrie volontaire (admin a besoin de l'email pour contacter, listing pour navigation rapide).

### Filtre SQL
```sql
WHERE p.product_id = $1
```

> ⚠️ **PAS de filtre `status != 'deleted'`** ni de filtre seller. L'admin peut consulter le détail d'un produit même supprimé (audit).

### Erreurs

| HTTP | Quand | Body |
|---|---|---|
| 401 | JWT KO | — |
| 403 | non-admin | `{"detail": "Admin only"}` |
| **404** | row absente | `{"error": "Produit introuvable."}` |

> ⚠️ **Format 404** : clé `error` (`JSONResponse`), PAS `detail`. **Asymétrie format** vs 403 (`detail`) — voir PIÈGE-API-01.

### Effets de bord
Aucun.

---

## Endpoint 3 — `POST /api/admin/products/{product_id}/approve`

### Headers
- `Authorization: Bearer <jwt>` (admin)
- `Content-Type: application/json`

### Path params
- `product_id`

### Body

```json
{
  "comment": "string?"
}
```

| Champ | Type | Obligatoire | Notes |
|---|---|---|---|
| `comment` | string | non | `.strip()`, vide → stocké `null` (l. 140 `comment or None`) |

### Réponse 200

```json
{"ok": true, "status": "active"}
```

### Erreurs

| HTTP | Quand | Body |
|---|---|---|
| 401 | JWT KO | — |
| 403 | non-admin | `{"detail": "Admin only"}` |
| **404** | row absente | `{"error": "Produit introuvable."}` |

> ⚠️ **PAS de 409 si `status != 'pending_review'`**. L'admin peut approve un produit déjà active (idempotent), draft (skip review), rejected (revert decision), deleted (zombie active). **Compat permissive — Java DOIT préserver.**

### Effets de bord

| Effet | Détail |
|---|---|
| UPDATE `marketplace_products` | `status='active'`, `in_stock=TRUE`, `admin_validated_by=user_id`, `admin_validated_at=now()`, `admin_comment=comment_or_null`, `updated_at=now()` |
| Push notif au seller | `title="Produit publié !"` ; `body="Ton annonce « {title} » a été validée et est maintenant visible dans la boutique."` ; `data={type:"product_approved", product_id, action:"/products/my-products"}` ; `notif_type="product_approved"` |
| Visibilité immédiate | Le produit apparaît dans `GET /marketplace/products` (S38) |

> ⚠️ **Push synchrone (l. 144)** : `await send_push_to_user(...)` BLOQUE la réponse HTTP. Si Expo Push API est lente, l'admin attend. **Java RECOMMANDÉ** : passer en `@Async` (rupture compat mineure — gain UX significatif). À documenter explicitement.

---

## Endpoint 4 — `POST /api/admin/products/{product_id}/reject`

### Headers
Identiques à approve.

### Path params
- `product_id`

### Body

```json
{
  "comment": "string?"
}
```

> ⚠️ Comment "optionnel mais recommandé" (commentaire Python l. 168). Java NE DOIT PAS imposer de validation `comment.length > 0` — compat permissive.

### Réponse 200

```json
{"ok": true, "status": "rejected"}
```

### Erreurs
Identiques à approve (404 si introuvable, 403 non-admin, 401 JWT KO).

### Effets de bord

| Effet | Détail |
|---|---|
| UPDATE `marketplace_products` | `status='rejected'`, `in_stock=FALSE`, `admin_validated_by=user_id`, `admin_validated_at=now()`, **`rejection_reason=comment_or_null` ET `admin_comment=comment_or_null`** (DUPLIQUÉ), `updated_at=now()` |
| Push notif au seller | `title="Annonce refusée"` ; `body="Ton annonce « {title} » n'a pas été validée. Clique pour voir les corrections à apporter."` ; `data={type:"product_rejected", product_id, admin_comment:comment, action:"/products/create?productId={id}&mode=edit"}` ; `notif_type="product_rejected"` |
| Visibilité | Le produit n'apparaît PAS dans `GET /marketplace/products` (filtre `status='active'`). Apparaît toujours dans `GET /products/mine` (S39) avec `status='rejected'` + `rejection_reason` lisible. |

> ⚠️ **Anomalie compat documentée** : `rejection_reason` ET `admin_comment` reçoivent **la même valeur** (l. 185). Java DOIT préserver. Une slice future pourrait les disjoindre (ex: `admin_comment` = note interne ; `rejection_reason` = message public au seller).

> ⚠️ **`data.admin_comment` empty string** : si `body.comment` est absent, `comment = ""`, et `data.admin_comment = ""` (string vide, PAS `null`) car `comment` est définitivement assigné `(body.get("comment") or "").strip()` ligne 167. La DB stocke `null` (`comment or None`), mais le push payload contient `""`. Java doit reproduire cette divergence subtile.

---

## Récap formats erreur — asymétrie multiple

| Endpoint | 401 | 403 | 404 |
|---|---|---|---|
| GET pending | (S23) | `{"detail":"Admin only"}` | (jamais — liste vide en 200) |
| GET detail | (S23) | `{"detail":"Admin only"}` | `{"error":"Produit introuvable."}` |
| approve | (S23) | `{"detail":"Admin only"}` | `{"error":"Produit introuvable."}` |
| reject | (S23) | `{"detail":"Admin only"}` | `{"error":"Produit introuvable."}` |

> 🔴 **PIÈGE-API-01** : 403 utilise `detail` (HTTPException), 404 utilise `error` (JSONResponse). Java DOIT préserver les 2 schémas distincts.

---

## Wrappers de réponse — asymétrie

| Endpoint | Format succès |
|---|---|
| GET pending | `{"products": [...], "count": N}` (wrapper) |
| GET detail | `{...}` (objet direct, pas de wrapper) |
| approve | `{"ok": true, "status": "active"}` |
| reject | `{"ok": true, "status": "rejected"}` |

---

## Cas non gérés (compat permissive Python)

| Cas | Comportement Python |
|---|---|
| Approve un produit `status='active'` | 200 OK, UPDATE re-écrase `admin_validated_at`, push renvoyé |
| Approve un produit `status='deleted'` | 200 OK, **status passe à `active`** (zombie ressuscité). UPDATE NE filtre PAS `status != 'deleted'`. **Anomalie majeure compat — Java DOIT préserver mais SIGNALER pour future correction.** |
| Reject un produit `status='draft'` | 200 OK, UPDATE force `status='rejected'` |
| Reject un produit déjà `status='rejected'` | 200 OK, UPDATE re-écrase `rejection_reason`, push renvoyé |
| Body `comment` non-string (number/bool) | `(body.get("comment") or "").strip()` peut échouer si `comment=123` (int n'a pas `.strip()`) — TypeError → 500 Python. Java doit reproduire ou normaliser. |
| Body absent (pas de JSON) | `await request.json()` lève `json.JSONDecodeError` → 422 FastAPI default. Compat = traduire en 400/422 Java. |

---

## Effets de bord cross-slice

| Endpoint S41 | Impact S38 (catalogue) | Impact S39 (`/mine`, `/detail`) | Impact S40 (DELETE/Reactivate) |
|---|---|---|---|
| approve | Le produit apparaît | `/mine` montre status='active' ; `/detail` retourne `admin_validated_by`/`admin_validated_at`/`admin_comment` | DELETE possible (owner-only inchangé) |
| reject | Pas de changement (toujours invisible) | `/mine` montre status='rejected' avec `rejection_reason` | DELETE possible — `rejection_reason` perdu si DELETE puis REACTIVATE (status forcé à `active`, voir BR-40.07 anomalie) |
