# SLICE_39_DB_MAPPING.md — Mapping DB Marketplace création produit
> Basé sur `routes/product_creation_routes.py:1–568` + `routes/marketplace_routes.py` (S38) pour cohérence schéma.
> Généré le 2026-04-29.

---

## Tables touchées

| Table | Op | Endpoints | Ligne(s) |
|---|---|---|---|
| `marketplace_products` | INSERT | POST (création) | 320–390 |
| `marketplace_products` | UPDATE x4 | POST (édition + champs annexes) | 251–314, 399–402, 405–417, 422–425 |
| `marketplace_products` | SELECT | POST (existence + status), GET /mine, GET /detail | 49–69, 85–106, 233–243 |
| `users` | SELECT | POST (notif admins) | 442 |

> **Aucune** écriture sur `tags`, `pending_file_deletions`, `notifications`, `service_locations` ou autre table de référentiel.

---

## Schéma `marketplace_products` (colonnes touchées)

> Inférence depuis le code Python — la DDL exacte n'est pas dans ce fichier mais dans `/app/scripts/migration_supabase/*.sql`. Java doit auditer la DDL Supabase avant cutover.

| Colonne | Type SQL inféré | Source Python |
|---|---|---|
| `product_id` | `text` (PK) | `_new_id()` → `prod_<12 hex>` |
| `seller_id` | `text` (FK users.user_id) | `user["user_id"]` JWT |
| `seller_type` | `text` | hardcodé `"user"` (l. 358) |
| `seller_name` | `text` | snapshot `user.full_name`/`user.username`/`"Utilisateur"` (l. 317) |
| `seller_picture_url` | `text?` | snapshot `user.picture_url` (l. 318) |
| `title` | `text` | `body.title.strip()` |
| `short_description` | `text?` | `body.short_description` |
| `description` | `text` | `body.description` (≥30 caractères) |
| `price` | `numeric` | `body.price` (parse float, fallback 0.0) |
| `currency` | `text` | défaut `"EUR"` |
| `product_type` | `text` (enum applicatif) | `"rental"` ou `"sale"` |
| `pricing_type` | `text` | défaut `"day"` |
| `pricing_modes` | **`text[]`** | défaut `["day"]` |
| `price_per_hour` | `numeric?` | brut (pas de cast) |
| `price_per_day` | `numeric?` | brut |
| `price_per_week` | `numeric?` | brut |
| `price_per_month` | `numeric?` | brut |
| `price_per_session` | `numeric?` | parsé float (UPDATE séparé) |
| `category` | `text?` | brut |
| `subcategory` | `text?` | brut |
| `cover_image_url` | `text?` | fallback `image_urls[0]` |
| `image_url` | `text?` | rétro-compat, = cover_image_url |
| `image_urls` | **`text[]`** ou **`jsonb`** | array passé directement à asyncpg → cast natif `text[]` (cf. PIÈGE-DB-01) |
| `condition_label` | `text` | défaut `"good"` |
| `included_items` | `text?` | brut |
| `size_dimensions` | `text?` | brut |
| `available_quantity` | `int` | `max(1, int(x))` |
| `in_stock` | `bool` | calculé `available_quantity > 0` |
| `deposit_required` | `bool` | défaut `false` |
| `deposit_amount` | `numeric?` | parsé float, `null` si absent |
| `pickup_type` | `text?` | brut |
| `pickup_notes` | `text?` | brut |
| `availability_note` | `text?` | brut |
| `return_rules` | `text?` | brut |
| `cancellation_rules` | `text?` | brut |
| `city` | `text?` | brut |
| `lat` | `numeric?` | brut |
| `lng` | `numeric?` | brut |
| `location_address_raw` | `text?` | UPDATE séparé (l. 422–425) |
| `location_privacy` | `text` | défaut `"100m"` |
| `radius_km` | `numeric` | défaut `0.1` |
| `related_spotyou_ids` | **`text[]`** | brut |
| `tag_ids` | **`text[]`** | brut |
| `delivery_modes` | **`text[]`** | défaut helper `_delivery_modes(body)` |
| `status` | `text` | `"draft"` / `"pending_review"` / `"active"` |
| `skill_level` | `text` | hardcodé `"tous"` à l'INSERT (l. 387) |
| `created_at` | `timestamptz` | `now()` UTC (Python `_now()`) |
| `updated_at` | `timestamptz` | `now()` UTC à chaque écriture |
| `brand` | `text?` | UPDATE séparé |
| `model` | `text?` | UPDATE séparé |
| `weight` | `text?` ou `numeric?` | UPDATE séparé (cast inconnu — Python ne caste pas) |
| `stripe_product_id` | `text?` | UPDATE séparé, `null` à création |
| `stripe_price_id` | `text?` | UPDATE séparé, `null` à création |
| `rejection_reason` | `text?` | **NON écrit ici** (rempli par admin S41+) |
| `admin_comment` | `text?` | **NON écrit ici** |
| `deleted_at` | `timestamptz?` | NON écrit ici |
| `deleted_by` | `text?` | NON écrit ici |
| `media_purged` | `bool` | NON écrit ici |
| `media_purge_scheduled_at` | `timestamptz?` | NON écrit ici |
| `reactivated_at` | `timestamptz?` | NON écrit ici |

---

## INSERT exact (lignes 320–390)

```sql
INSERT INTO marketplace_products (
    product_id, title, short_description, description,
    price, currency, product_type, pricing_type,
    pricing_modes, price_per_hour, price_per_day, price_per_week, price_per_month,
    seller_id, seller_type, seller_name, seller_picture_url,
    category, subcategory,
    cover_image_url, image_url, image_urls,
    condition_label, included_items,
    size_dimensions,
    available_quantity, in_stock,
    deposit_required, deposit_amount,
    pickup_type, pickup_notes, availability_note,
    return_rules, cancellation_rules,
    city, lat, lng, location_privacy, radius_km,
    related_spotyou_ids, tag_ids, delivery_modes,
    status, skill_level, created_at, updated_at
) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
    $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
    $32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46
)
```

**46 colonnes**, 46 placeholders. **Pas de `RETURNING`** — l'API renvoie `body.product_id` (ou le `_new_id()` généré).

---

## UPDATE principal (édition — lignes 251–314)

```sql
UPDATE marketplace_products SET
    title = $1, short_description = $2, description = $3,
    price = $4, currency = $5, product_type = $6, pricing_type = $7,
    pricing_modes = $8, price_per_hour = $9, price_per_day = $10,
    price_per_week = $11, price_per_month = $12,
    category = $13, subcategory = $14,
    cover_image_url = $15, image_url = $16, image_urls = $17,
    condition_label = $18, included_items = $19,
    size_dimensions = $20, available_quantity = $21, in_stock = $22,
    deposit_required = $23, deposit_amount = $24,
    pickup_type = $25, pickup_notes = $26, availability_note = $27,
    return_rules = $28, cancellation_rules = $29,
    city = $30, lat = $31, lng = $32,
    location_privacy = $33, radius_km = $34,
    related_spotyou_ids = $35,
    tag_ids = $36,
    delivery_modes = $37,
    status = $38, updated_at = $39
WHERE product_id = $40 AND seller_id = $41
```

**41 colonnes** mises à jour. **WHERE clause à 2 conditions** — ownership reverifiée à chaque UPDATE (defense in depth).

> ⚠️ Les colonnes `seller_id`, `seller_type`, `seller_name`, `seller_picture_url`, `skill_level`, `created_at` ne sont **JAMAIS** mises à jour (intentionnel — snapshot figé à la création).

---

## UPDATEs annexes (lignes 393–425) — anomalie atomicité

### UPDATE #2 — `price_per_session`

```sql
UPDATE marketplace_products SET price_per_session = $1 WHERE product_id = $2
```

> ⚠️ **PAS de filtre `seller_id`**. N'importe qui pourrait théoriquement écraser le `price_per_session` s'il connaît le `product_id`. **MAIS** ce code n'est appelable que par l'owner (vérifié ligne 234) ou crée un nouveau produit (donc owner par construction). Java DOIT rajouter le `AND seller_id = $X` par défense en profondeur.

### UPDATE #3 — `brand, model, weight, stripe_*`

```sql
UPDATE marketplace_products
SET brand = $1, model = $2, weight = $3,
    stripe_product_id = $4, stripe_price_id = $5
WHERE product_id = $6
```

> Même anomalie : pas de `seller_id`. Même remarque (à corriger en Java).

### UPDATE #4 — `location_address_raw`

```sql
UPDATE marketplace_products SET location_address_raw = $1 WHERE product_id = $2
```

> Même anomalie.

---

## SELECT existence (UPSERT — ligne 233)

```sql
SELECT product_id FROM marketplace_products
WHERE product_id = $1 AND seller_id = $2
```

→ Si `null` → INSERT. Si non-null → UPDATE branche.

## SELECT status courant (anti-downgrade — ligne 240)

```sql
SELECT status FROM marketplace_products
WHERE product_id = $1 AND seller_id = $2
```

> ⚠️ **Doublonné** avec le SELECT précédent (existence). Java peut fusionner en une seule requête `SELECT product_id, status` (optimisation safe car même WHERE).

---

## SELECT `/products/mine` (lignes 49–69)

```sql
SELECT
    product_id, title, short_description, description,
    price, currency, product_type, pricing_type,
    pricing_modes, price_per_hour, price_per_day, price_per_week, price_per_month, price_per_session,
    status, category, subcategory,
    cover_image_url, image_url, image_urls,
    condition_label, available_quantity,
    deposit_required, deposit_amount,
    pickup_type, city, location_privacy,
    related_spotyou_ids, created_at, updated_at,
    rejection_reason, admin_comment,
    brand, model, weight
FROM marketplace_products
WHERE seller_id = $1
  AND status != 'deleted'
  AND product_type IN ('rental', 'sale')
ORDER BY created_at DESC
```

**33 colonnes** (subset volontaire — pas de `lat`/`lng`/`size_dimensions`/`included_items`/`return_rules`/`cancellation_rules`/`location_address_raw` car écran liste, pas édition).

---

## SELECT `/products/{id}/detail` (lignes 86–106)

```sql
SELECT product_id, title, short_description, description,
       price, currency, product_type, pricing_type,
       status, category, subcategory,
       cover_image_url, image_url, image_urls,
       condition_label, available_quantity,
       deposit_required, deposit_amount,
       pickup_type, pickup_notes, city, location_address_raw, location_privacy, lat, lng,
       return_rules, cancellation_rules, availability_note,
       included_items, size_dimensions,
       tag_ids,
       pricing_modes, price_per_hour, price_per_day, price_per_week, price_per_month, price_per_session,
       related_spotyou_ids,
       rejection_reason, admin_comment,
       brand, model, weight,
       created_at, updated_at
FROM marketplace_products
WHERE product_id = $1 AND seller_id = $2 AND status != 'deleted'
```

**44 colonnes** (superset de `/mine` + champs édition — `lat`/`lng`/`pickup_notes`/`included_items`/`size_dimensions`/`return_rules`/`cancellation_rules`/`availability_note`/`location_address_raw`/`tag_ids`).

---

## SELECT admins pour notif (ligne 442)

```sql
SELECT user_id FROM users WHERE role = 'admin'
```

> ⚠️ **Pas de filtre `is_active`/`deleted_at`** — peut envoyer à des admins archivés. Compat stricte côté Java = ne pas filtrer non plus (sauf si explicite).

---

## Relations / FK

| Champ | Référence | Type relation |
|---|---|---|
| `seller_id` | `users.user_id` | FK applicative (pas de check côté code S39) |
| `tag_ids[]` | `tags.tag_id` | FK applicative — **AUCUNE vérification d'existence backend** (front filtre les tags valides) |
| `related_spotyou_ids[]` | `tag_points.point_id` | FK applicative — pas vérifié |

> Java DOIT décider : préserver l'absence de vérification (compat stricte) OU ajouter une validation d'existence (rupture compat). Recommandation : préserver, et signaler comme dette technique.

---

## Pièges DB principaux

### PIÈGE-DB-01 — `text[]` vs `jsonb`

Les colonnes `pricing_modes`, `image_urls`, `tag_ids`, `related_spotyou_ids`, `delivery_modes` sont passées en Python comme **listes Python natives**. asyncpg les convertit en `text[]` PostgreSQL automatiquement.

**Impact Java** :
- Si la colonne est **`text[]`** (cas le plus probable) → `Connection.createArrayOf("text", strings)` puis `setArray(...)`
- Si la colonne est **`jsonb`** → `setObject(..., new PGobject() { type = "jsonb"; value = "[\"a\",\"b\"]" })`

> 🔴 **Auditer la DDL Supabase EXACTE** avant l'implémentation (`\d marketplace_products`). Les deux types existent dans le projet (S26 SpotYou utilise jsonb, S25 home utilise array). **Ne pas deviner.**

### PIÈGE-DB-02 — Atomicité éclatée

L'écriture d'un produit utilise **4 connexions distinctes** (`async with pool.acquire() as conn` x4). En cas d'erreur sur l'UPDATE #2, #3 ou #4, le produit est créé/modifié partiellement.

**Recommandation Java** : encapsuler les 4 écritures dans une **seule** `@Transactional` Spring (correction safe — comportement final identique en cas de succès, plus robuste en cas d'échec). À documenter explicitement comme amélioration intentionnelle.

### PIÈGE-DB-03 — UPSERT applicatif (pas `ON CONFLICT`)

Le code Python ne fait PAS `INSERT ... ON CONFLICT DO UPDATE`. Il fait :
1. SELECT existence (avec ownership)
2. Branchement INSERT ou UPDATE

**En Java** : préserver ce pattern (compat stricte) — sinon, le contrôle ownership disparaît si on utilise `ON CONFLICT (product_id) DO UPDATE` (un attaquant connaissant un product_id pourrait écraser via `body.product_id`).

### PIÈGE-DB-04 — Status enum non contraint en base

Aucun `CHECK CONSTRAINT` Python observable. Les valeurs valides observées : `draft`, `pending_review`, `active`, `rejected`, `sold`, `archived`, `deleted`. **Java DOIT valider applicativement** (DTO + `@Pattern`).

### PIÈGE-DB-05 — Garde anti-downgrade fragile

```python
if current_row and current_row["status"] not in ("draft", None) and status == "draft":
    raise HTTPException(403, ...)
```

> ⚠️ Le test `not in ("draft", None)` accepte un produit dont `status IS NULL` (legacy/incohérent) à être repassé en draft. Java doit reproduire ce comportement (compat stricte) — `status IS NULL` n'apparaît pas naturellement (INSERT défaut `"draft"`).

---

## Règles GIN/Index (suggestion Java)

Pour les performances `/mine` :
- Index `(seller_id, created_at DESC) WHERE status != 'deleted'` (composite + condition)

Pas d'index requis pour S39 — déjà couvert par S38 (lecture publique).
