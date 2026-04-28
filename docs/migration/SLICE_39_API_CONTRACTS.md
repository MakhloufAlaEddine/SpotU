# SLICE_39_API_CONTRACTS.md — Contrats API Marketplace création produit
> Basé sur `routes/product_creation_routes.py:1–568`.
> Généré le 2026-04-29.

---

## Endpoint 1 — `POST /api/products`

> ⚠️ Path réel : **`/api/products`** (pas `/api/marketplace/products`). Voir `SLICE_39_SCOPE.md` § ALERTE PATH.

### Headers
- `Authorization: Bearer <jwt>` **obligatoire** (sinon 401 via `require_auth`)
- `Content-Type: application/json`

### Path params
Aucun.

### Query params
Aucun.

### Body (JSON) — tous les champs

> Aucun champ n'est typé strictement par Pydantic ici (le code lit `body = await request.json()` puis `body.get(...)`). **Java doit accepter un body permissif** (ex: `Map<String, Object>` ou DTO `Optional<T>` partout).

| Champ | Type Python | Défaut | Obligatoire | Notes |
|---|---|---|---|---|
| `product_id` | `str` | _(auto)_ | non | Si fourni → UPSERT sur ce id (+ ownership). Si absent → INSERT avec `prod_<12 hex>` généré. |
| `status` | `"draft"` \| `"pending_review"` | `"draft"` | non | `pending_review` → validations strictes (BR-39.06). Admin + `pending_review` → auto-bumpé à `"active"`. |
| `title` | `str` | — | **oui (toujours)** | `.strip()` ; vide → 400. |
| `description` | `str` | — | **oui (toujours)** | `.strip()` ; longueur < 30 → 400. |
| `short_description` | `str?` | `null` | non | Aucune validation. |
| `product_type` | `"rental"` \| `"sale"` | `"rental"` | non | Hors enum → 400. |
| `pricing_type` | `str` | `"day"` | non | Pas validé. |
| `pricing_modes` | `list[str]` | `["day"]` | non | Tableau libre, ex: `["hour","day","week","month","session"]`. |
| `price` | `number\|str` | `0.0` | conditionnel | Parsé via `float(str(x).replace(",","."))`. Erreur → fallback `0.0`. **Obligatoire si `pending_review`** (price > 0). |
| `price_per_hour` / `price_per_day` / `price_per_week` / `price_per_month` | `number?` | `null` | non | Stockés tels quels (pas de cast supplémentaire). |
| `price_per_session` | `number?` | `null` | non | **Sauvegardé via UPDATE séparé** post-INSERT (l. 393–402). |
| `currency` | `str` | `"EUR"` | non | Pas validé. |
| `category` | `str` | — | conditionnel | **Obligatoire si `pending_review`**. |
| `subcategory` | `str?` | `null` | non | — |
| `cover_image_url` | `str?` | `image_urls[0]` ou `null` | non | Fallback automatique sur premier image. |
| `image_url` | `str?` | _(= cover)_ | non | Rétro-compat — toujours = cover. |
| `image_urls` | `list[str]` | `[]` | conditionnel | **Obligatoire (≥1) si `pending_review`**. |
| `condition_label` | `str` | `"good"` | conditionnel | **Obligatoire si `pending_review`** (non-vide). |
| `included_items` | `str?` | `null` | non | Texte libre. |
| `size_dimensions` | `str?` | `null` | non | Texte libre. |
| `available_quantity` | `int\|str` | `1` | conditionnel | `max(1, int(x))`. **≥1 si `pending_review`+sale**. |
| `deposit_required` | `bool` | `false` | non | Si `true` + rental → `deposit_amount` requis (BR-39.06.B). |
| `deposit_amount` | `number?` | `null` | conditionnel | **>0 si `deposit_required=true` AND rental + `pending_review`**. |
| `pickup_type` | `str` | `null` | conditionnel | **Obligatoire si `pending_review`**. Valeurs observées : `"local_pickup"`, `"creator_handoff"`. |
| `pickup_notes` | `str?` | `null` | non | — |
| `availability_note` | `str?` | `null` | non | — |
| `return_rules` | `str?` | `null` | non | — |
| `cancellation_rules` | `str?` | `null` | non | — |
| `city` | `str?` | `null` | non | — |
| `lat` | `float?` | `null` | non | — |
| `lng` | `float?` | `null` | non | — |
| `location_privacy` | `str` | `"100m"` | non | — |
| `radius_km` | `float` | `0.1` | non | — |
| `location_address_raw` | `str?` | `null` | non | **Sauvegardé via UPDATE séparé** post-INSERT (l. 420–425). `.strip()`, vide → `null`. |
| `tag_ids` | `list[str]` | `[]` | conditionnel | **≥1 obligatoire si `pending_review`**. |
| `related_spotyou_ids` | `list[str]` | `[]` | conditionnel | **≥1 si `pending_review`+rental+`pricing_modes contains "session"`**. |
| `delivery_modes` | `list[str]` | _(fallback `_delivery_modes()`)_ | non | Fallback : si vide → `["local_pickup"]` ou dérivé de `pickup_type`. |
| `brand` | `str?` | `null` | non | **UPDATE séparé** post-INSERT. |
| `model` | `str?` | `null` | non | **UPDATE séparé**. |
| `weight` | `str?\|number?` | `null` | non | **UPDATE séparé**. Stocké tel quel. |
| `stripe_product_id` | `str?` | `null` | non | **UPDATE séparé**. Pas peuplé à la création (rempli plus tard par admin). |
| `stripe_price_id` | `str?` | `null` | non | **UPDATE séparé**. |

### Réponse 200 (succès — création **OU** édition)

```json
{
  "product_id": "prod_a1b2c3d4e5f6",
  "status": "draft"
}
```

> **Statut renvoyé = statut effectivement écrit en base** (donc `"active"` si admin + `pending_review`).

### Erreurs

| HTTP | Quand | Body |
|---|---|---|
| **401** | JWT absent/invalide | (via `require_auth` — voir S23) |
| **400** | `title.strip() == ""` | `{"error": "Le titre est obligatoire."}` |
| **400** | `product_type ∉ {rental, sale}` | `{"error": "Type de produit invalide. Types supportés : rental, sale."}` |
| **400** | `description.strip().length < 30` | `{"error": "La description est obligatoire (minimum 30 caractères)."}` |
| **403** | UPDATE d'un produit dont `status NOT IN ('draft', NULL)` avec `body.status == 'draft'` | `{"detail": "Impossible de repasser en brouillon : ce produit a déjà été soumis ou validé."}` (HTTPException → wrapper FastAPI) |
| **422** | `pending_review` validation échouée (1+ erreurs) | `{"error": "<errors[0]>", "details": ["<err1>","<err2>",...]}` |

> ⚠️ Format `400` vs `403` vs `422` **distinct** :
> - `400` retourné via `JSONResponse({"error": ...})` (PAS `detail`)
> - `403` retourné via `raise HTTPException(status_code=403, detail=...)` (FastAPI génère `{"detail": ...}`)
> - `422` retourné via `JSONResponse({"error": ..., "details": [...]})`
>
> Java DOIT préserver ces formats DIVERGENTS (clé `error` vs `detail`) — compat front stricte.

### Effets de bord

| Effet | Quand | Détail |
|---|---|---|
| INSERT/UPDATE `marketplace_products` | toujours | 46 colonnes à l'INSERT, 41 colonnes à l'UPDATE principal |
| 3 UPDATEs additionnels | toujours | `price_per_session` / `brand+model+weight+stripe_*` / `location_address_raw` (cf. SCOPE § anomalie atomicité) |
| Auto-bump `pending_review → active` | si `is_admin == true` AND `status == "pending_review"` | Pas de notif admins |
| Push fire-and-forget admins | si `requested_status == "pending_review"` AND `not is_admin` | `_notify_admins_new_product` — boucle SELECT users role=admin + push. **Hors transaction**, exécuté APRÈS le commit. |

---

## Endpoint 2 — `GET /api/products/mine`

### Headers
- `Authorization: Bearer <jwt>` **obligatoire**

### Réponse 200

```json
{
  "products": [
    {
      "product_id": "prod_a1b2c3d4e5f6",
      "title": "Vélo de route Trek",
      "short_description": "...",
      "description": "...",
      "price": 25.0,
      "currency": "EUR",
      "product_type": "rental",
      "pricing_type": "day",
      "pricing_modes": ["day", "week"],
      "price_per_hour": null,
      "price_per_day": 25.0,
      "price_per_week": 140.0,
      "price_per_month": null,
      "price_per_session": null,
      "status": "active",
      "category": "sport",
      "subcategory": "cyclisme",
      "cover_image_url": "https://...",
      "image_url": "https://...",
      "image_urls": ["https://...", "https://..."],
      "condition_label": "good",
      "available_quantity": 1,
      "deposit_required": true,
      "deposit_amount": 200.0,
      "pickup_type": "local_pickup",
      "city": "Paris",
      "location_privacy": "100m",
      "related_spotyou_ids": [],
      "created_at": "2026-04-29T10:00:00+00:00",
      "updated_at": "2026-04-29T10:00:00+00:00",
      "rejection_reason": null,
      "admin_comment": null,
      "brand": "Trek",
      "model": "Domane SL5",
      "weight": "9.2"
    }
  ],
  "count": 1
}
```

### Filtre SQL

```sql
WHERE seller_id = $1
  AND status != 'deleted'
  AND product_type IN ('rental', 'sale')
ORDER BY created_at DESC
```

> ⚠️ **Filtre `product_type IN ('rental', 'sale')`** — les autres types éventuels (ex: legacy) ne remontent PAS. À préserver en Java.

### Erreurs
- **401** — JWT absent/invalide
- (Liste vide → 200 avec `products: [], count: 0`)

### Effets de bord
Aucun (lecture pure).

### Sérialisation `_clean()` (lignes 29–37)

Convertit les `datetime` en ISO strings, garde tout le reste tel quel. Java : `@JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ssXXX")` ou `OffsetDateTime` natif Jackson.

---

## Endpoint 3 — `GET /api/products/{product_id}/detail`

### Headers
- `Authorization: Bearer <jwt>` **obligatoire**

### Path params
- `product_id` (string)

### Réponse 200 — superset de `/mine`

Champs retournés (44 au total — TOUS les champs du formulaire édition) :
```
product_id, title, short_description, description,
price, currency, product_type, pricing_type,
status, category, subcategory,
cover_image_url, image_url, image_urls,
condition_label, available_quantity,
deposit_required, deposit_amount,
pickup_type, pickup_notes, city,
location_address_raw, location_privacy, lat, lng,
return_rules, cancellation_rules, availability_note,
included_items, size_dimensions,
tag_ids,
pricing_modes, price_per_hour, price_per_day,
price_per_week, price_per_month, price_per_session,
related_spotyou_ids,
rejection_reason, admin_comment,
brand, model, weight,
created_at, updated_at
```

### Filtre SQL

```sql
WHERE product_id = $1 AND seller_id = $2 AND status != 'deleted'
```

### Erreurs

| HTTP | Quand | Body |
|---|---|---|
| **401** | JWT absent/invalide | — |
| **404** | row absente OU appartient à un autre user OU status='deleted' | `{"error": "Produit introuvable ou accès refusé."}` |

> ⚠️ Le code retourne `404` pour ownership KO **PAS 403** — message volontairement opaque (anti-énumération produits). Compat stricte = Java retourne 404 aussi.

### Effets de bord
Aucun (lecture pure).

### Format de réponse

> ⚠️ **Différence avec `/mine`** : retourne **directement le dict**, PAS un wrapper `{products: [...], count: N}`. Pas de pluralisation.

---

## Récapitulatif erreurs HTTP

| Code | Endpoint(s) | Sens |
|---|---|---|
| 200 | tous | Succès |
| 400 | POST | Validation minimale (titre/description/product_type) |
| 401 | tous | JWT KO |
| 403 | POST | Anti-downgrade status |
| 404 | GET detail | Introuvable / non autorisé |
| 422 | POST | Validation `pending_review` détaillée |
