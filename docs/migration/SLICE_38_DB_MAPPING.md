# SLICE_38_DB_MAPPING.md — Mapping DB Marketplace Products
> Basé sur `routes/marketplace_routes.py:1–267`.
> Généré le 2026-04-28.

---

## Tables impliquées (5 — toutes lecture seule)

| Table | Rôle | Endpoint |
|---|---|---|
| `marketplace_products` | Produits marketplace (source principale) | SELECT WHERE status='active' |
| `services` | Services coach (uniquement si tags) | SELECT WHERE active=TRUE |
| `users` | Seller/coach name+picture | LEFT JOIN |
| `tag_points` | Resolve spotyou_id → GPS + tag_ids + owner_id | SELECT (PostGIS) |
| `reviews` | Ratings sellers | SELECT GROUP BY (parallèle) |

> Aucune écriture. Aucun lock.

---

## Table `marketplace_products` — colonnes lues

```sql
PRODUCT_LIST_COLS:
  product_id, product_type, status, title, description, short_description,
  price, currency, pricing_type, pricing_modes,
  price_per_hour, price_per_day, price_per_week, price_per_month, price_per_session,
  image_url, image_urls, cover_image_url,
  tag_ids,                                    -- TEXT[]
  seller_id, seller_type,
  condition_label, category, subcategory, skill_level,
  lat, lng, city, location_privacy,
  related_spotyou_ids,                        -- TEXT[]
  delivery_modes, pickup_type, pickup_notes,
  deposit_required, deposit_amount,
  available_quantity, in_stock,
  included_items, availability_note,
  cancellation_rules, return_rules,
  admin_comment,
  created_at, updated_at
```

> ⚠️ **44 colonnes** retournées. Reproduire **toutes**. Ne pas filtrer.

### Filtre

```sql
WHERE p.tag_ids && $1::text[]    -- array overlap (au moins 1 tag commun)
  AND p.status = 'active'
```

OU sans filtre tags :
```sql
WHERE p.status = 'active'
ORDER BY p.created_at DESC LIMIT 20
```

### Tri

```sql
ORDER BY CASE WHEN p.seller_id = $2 THEN 0 ELSE 1 END,    -- owner-first
         p.created_at DESC
```

> ⚠️ Le 2e param `$2` est `owner_id` qui peut être `null`. PostgreSQL traite `seller_id = null` comme `null` (jamais vrai), donc tous tombent dans `ELSE 1`. Comportement OK.

---

## Table `services` — colonnes lues

```sql
service_id, coach_id, title, description, price, duration_min,
images,                                       -- JSONB ou TEXT JSON
tag_ids,                                      -- JSONB
location_description, address
```

### Filtre

```sql
WHERE s.active = TRUE
  AND s.tag_ids ?| $1::text[]                -- JSONB any-key (au moins 1 tag commun)
```

> ⚠️ **Opérateur différent** : `?|` est JSONB-specific (vs `&&` qui est array). **Ne pas confondre.**

---

## Table `users` — JOIN seller/coach

```sql
LEFT JOIN users u ON p.seller_id = u.user_id   -- products
LEFT JOIN users u ON s.coach_id  = u.user_id   -- services
```

Champs : `u.name AS seller_name|coach_name`, `u.picture AS seller_picture|coach_picture`, et le doublon `u.picture AS seller_picture_url`.

---

## Table `tag_points` — resolve spotyou_id

```sql
SELECT tag_ids, user_id,
       ST_Y(location::geometry) AS slat,
       ST_X(location::geometry) AS slng
  FROM tag_points
 WHERE point_id = $1
```

> ⚠️ **PostGIS** : `location` est probablement de type `geography` ou `geometry`. `ST_Y` extrait latitude, `ST_X` extrait longitude. **Native query obligatoire** côté Java (Hibernate-spatial possible mais lourd).

### `tag_points.tag_ids` type

Variable selon row : peut être TEXT JSON string OU déjà array. Code Python :
```python
raw = row["tag_ids"]
if isinstance(raw, str):
    tags = json.loads(raw)
else:
    tags = list(raw or [])
```

Java : `Object raw = row.get("tag_ids"); if (raw instanceof String s) ...`.

---

## Table `reviews` — seller_stats ratings

```sql
SELECT reviewee_id,
       ROUND(AVG(rating)::numeric, 1) AS avg_r,
       COUNT(*) AS cnt_r
  FROM reviews
 WHERE reviewee_id = ANY($1::text[])
 GROUP BY reviewee_id
```

> ⚠️ `ROUND(numeric, 1)` → arrondi 1 décimale (ex: 4.8). Java : `BigDecimal.setScale(1, HALF_UP)` ou `ROUND` SQL native.

---

## Counts seller_stats (3 SELECT additionnels)

### Products count

```sql
SELECT seller_id, COUNT(*) AS cnt
  FROM marketplace_products
 WHERE seller_id = ANY($1::text[])
 GROUP BY seller_id
```

> ⚠️ **Pas de filtre `status='active'`** ici. Compte **TOUS** les produits du seller (même drafts/inactifs). Reproduire.

### Services count

```sql
SELECT coach_id, COUNT(*) AS cnt
  FROM services
 WHERE coach_id = ANY($1::text[])
   AND active = TRUE
 GROUP BY coach_id
```

> ⚠️ **Avec** filtre `active=TRUE` (asymétrie vs products count).

### SpotYou count

```sql
SELECT user_id, COUNT(*) AS cnt
  FROM tag_points
 WHERE user_id = ANY($1::text[])
 GROUP BY user_id
```

---

## Parallélisme des 4 SELECT seller_stats

**Python** :
```python
rating_rows, prod_cnt_rows, svc_cnt_rows, spot_cnt_rows = await asyncio.gather(
    _q(_ratings), _q(_prod_cnt), _q(_svc_cnt), _q(_spot_cnt)
)
```

Chaque `_q(...)` ouvre une **connexion séparée** du pool (`async with pool.acquire() as c`). Donc 4 connexions concurrentes.

**Java** :
```java
CompletableFuture<List<RatingRow>>  fRatings  = CompletableFuture.supplyAsync(() -> repo.findRatings(sids));
CompletableFuture<List<CountRow>>   fProdCnt  = CompletableFuture.supplyAsync(() -> repo.countProducts(sids));
CompletableFuture<List<CountRow>>   fSvcCnt   = CompletableFuture.supplyAsync(() -> repo.countServices(sids));
CompletableFuture<List<CountRow>>   fSpotCnt  = CompletableFuture.supplyAsync(() -> repo.countSpotyou(sids));
CompletableFuture.allOf(fRatings, fProdCnt, fSvcCnt, fSpotCnt).join();
```

> ⚠️ Configurer un `Executor` dédié (cached threadpool ou WebFlux) pour éviter de bloquer le tomcat thread pool.

---

## Index recommandés

```sql
-- Filtre tags products (array overlap)
CREATE INDEX IF NOT EXISTS idx_mp_tag_ids ON marketplace_products USING GIN (tag_ids);
CREATE INDEX IF NOT EXISTS idx_mp_status ON marketplace_products(status);
CREATE INDEX IF NOT EXISTS idx_mp_status_created ON marketplace_products(status, created_at DESC) WHERE status='active';

-- Filtre tags services (JSONB)
CREATE INDEX IF NOT EXISTS idx_svc_tag_ids ON services USING GIN (tag_ids);
CREATE INDEX IF NOT EXISTS idx_svc_active ON services(active);

-- Lookup spotyou_id
CREATE INDEX IF NOT EXISTS idx_tp_point_id ON tag_points(point_id);

-- Reviews stats
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id);

-- Counts
CREATE INDEX IF NOT EXISTS idx_mp_seller ON marketplace_products(seller_id);
CREATE INDEX IF NOT EXISTS idx_svc_coach ON services(coach_id);
CREATE INDEX IF NOT EXISTS idx_tp_user ON tag_points(user_id);
```

> **À VALIDER** côté schéma existant. Pas de migration créée par S38.

---

## Sérialisation

### `tag_ids` côté products
PostgreSQL TEXT[] → asyncpg `list[str]` → JSON array. Java : `String[]` ou `List<String>` mappé via Hibernate `@JdbcTypeCode(SqlTypes.ARRAY)`.

### `tag_ids` côté services (JSONB string-or-array)
Logique applicative `_deserialize` : `json.loads if isinstance(str)`. Java :
```java
Object raw = svc.get("tag_ids");
List<String> tags = raw instanceof String s
    ? objectMapper.readValue(s, new TypeReference<List<String>>(){})
    : (List<String>) raw;
```

### `images` côté services
Idem `tag_ids` services (JSONB string-or-array).

### `Decimal price` → `float`
Compat S34 : `BigDecimal` → number JSON.

---

## Concurrence

Pas de problème : lectures pures, MVCC standard.

Si un produit passe `status='active'` → `'sold'` pendant le SELECT, MVCC montre l'état au snapshot.

---

## Incertitudes / zones grises

| Zone | Question | Action |
|---|---|---|
| Type `tag_points.location` | `geography(Point, 4326)` ? | À vérifier ; native query `ST_Y::geometry` fonctionne dans les deux cas |
| `marketplace_products.tag_ids` type | TEXT[] confirmé via opérateur `&&` | OK |
| `services.tag_ids` type | JSONB confirmé via opérateur `?|` | OK |
| `services.images` type | JSONB ou TEXT ? | Code Python gère les 2 cas |
| Index GIN existants | Performance critique sur filtre tags | À EXPLAIN ANALYZE |
| `reviews.reviewee_id` schéma | TEXT FK users ? | Probable |
| Précision `lat`, `lng` types | DOUBLE PRECISION ou NUMERIC ? | Probablement DOUBLE |
| `image_urls` type | TEXT[] ou JSONB ? | À vérifier — code Python ne fait pas de désérialisation explicite ; probablement TEXT[] |
