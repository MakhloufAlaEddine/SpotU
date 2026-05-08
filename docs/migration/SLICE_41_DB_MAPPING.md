# SLICE_41_DB_MAPPING.md — Mapping DB Marketplace admin moderation
> Basé sur `routes/admin_product_routes.py:1–207` + `admin_product_reminder_worker.py:1–104`.
> Généré le 2026-04-30.

---

## Tables touchées

| Table | Op | Endpoint(s) / Composant |
|---|---|---|
| `marketplace_products` | SELECT | GET pending, GET detail, approve (pré-update), reject (pré-update), Worker reminder |
| `marketplace_products` | UPDATE 5 colonnes | approve |
| `marketplace_products` | UPDATE 6 colonnes | reject |
| `marketplace_products` | UPDATE 1 colonne (`admin_reminder_sent_at`) | Worker reminder (batch) |
| `users` | JOIN (read-only) | GET pending, GET detail |
| `users` | SELECT `role='admin'` | Worker reminder |

---

## Colonnes `marketplace_products` modifiées par S41

| Colonne | Type SQL inféré | approve | reject | Worker | Lecture |
|---|---|---|---|---|---|
| `status` | `text` | → `'active'` | → `'rejected'` | (lu, filtre) | filtre `status='pending_review'` |
| `in_stock` | `bool` | → `TRUE` | → `FALSE` | — | — |
| `admin_validated_by` | `text?` (FK users) | → `admin.user_id` | → `admin.user_id` | — | remonté detail |
| `admin_validated_at` | `timestamptz?` | → `now()` | → `now()` | — | remonté detail |
| `admin_comment` | `text?` | → `comment_or_null` | → `comment_or_null` | — | remonté detail |
| `rejection_reason` | `text?` | (non touché) | → `comment_or_null` (**= admin_comment !**) | — | remonté detail |
| `admin_reminder_sent_at` | `timestamptz?` | (non touché) | (non touché) | → `now()` (batch) | remonté pending listing |
| `updated_at` | `timestamptz` | → `now()` | → `now()` | — | — |

> ⚠️ **Anomalie compat** : `rejection_reason` ET `admin_comment` reçoivent **strictement la même valeur** côté reject (l. 185). Java DOIT préserver. Pas de désambiguation possible côté Python actuel.

> ⚠️ Les colonnes `seller_id`, `seller_name`, `seller_picture_url`, `created_at`, etc. ne sont **JAMAIS** modifiées par S41 (intentionnel).

---

## SELECT GET pending (l. 49–79) — 28 colonnes + JOIN

```sql
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
    -- quality_score expression (cf. API_CONTRACTS)
    (...) AS quality_score
FROM marketplace_products p
JOIN users u ON u.user_id = p.seller_id
WHERE p.status = 'pending_review'
ORDER BY p.created_at ASC
```

> ⚠️ **JOIN STRICT (`JOIN`, pas `LEFT JOIN`)** sur `users` — un produit avec `seller_id` orphelin (user supprimé) **n'apparaîtra PAS** dans le listing pending. Anomalie compat (le produit reste en `pending_review` pour toujours, invisible aux admins). Java doit préserver. Recommandation : utiliser `LEFT JOIN` côté Java pour fermer ce piège (rupture compat mineure mais sécurise).

> ⚠️ **`u.name` et `u.picture`** — colonnes `users.name`, `users.picture` (PAS `full_name`, PAS `picture_url`). À vérifier vs S23 (auth) et S24 (profile) pour cohérence DDL.

> ⚠️ **Pas de pagination** — pas de `LIMIT` ni `OFFSET`. Volume admin reste faible (en pratique <100 pending), mais Java RECOMMANDÉ : ajouter `LIMIT 200` par sécurité (rupture compat mineure).

---

## SELECT GET detail (l. 90–107) — `SELECT p.*` + JOIN

```sql
SELECT p.*,
       u.name AS seller_name,
       u.picture AS seller_picture,
       u.email AS seller_email,
       (...) AS quality_score
FROM marketplace_products p
JOIN users u ON u.user_id = p.seller_id
WHERE p.product_id = $1
```

> ⚠️ **`SELECT p.*`** — toutes les colonnes de `marketplace_products` (40+ colonnes incluant `stripe_*`, `deleted_*`, `media_*`, `reactivated_at`, ...). **Drift schéma volontaire**.

> ⚠️ **`u.email`** ajouté ici (vs endpoint pending qui n'expose que name+picture). Asymétrie volontaire — admin doit pouvoir contacter le seller.

### Java — gestion `SELECT p.*`

Option 1 (compat stricte, drift) : `Map<String, Object>` + Jackson.
```java
List<Map<String,Object>> rows = jdbc.queryForList("SELECT p.*, u.name as seller_name, ...", params);
```

Option 2 (rupture compat mineure mais clean) : DTO explicite avec toutes les colonnes connues.

> Recommandation : **Option 1** (préserver le drift — l'admin Frontend est tolérant aux nouveaux champs).

---

## SELECT pré-UPDATE approve (l. 125–127)

```sql
SELECT seller_id, title FROM marketplace_products WHERE product_id = $1
```

→ Si `null` → 404 `{"error": "Produit introuvable."}`.
→ Si non-null → utilise `seller_id` pour push, `title` pour body push.

> ⚠️ **PAS de check `status='pending_review'`**. Approve permis sur n'importe quel statut courant (compat permissive).

> ⚠️ **PAS de filtre `status != 'deleted'`**. Approve possible sur un produit deleted → résurrection zombie en `active` (anomalie compat).

## UPDATE approve (l. 132–141)

```sql
UPDATE marketplace_products
SET status = 'active', in_stock = TRUE,
    admin_validated_by = $1, admin_validated_at = $2,
    admin_comment = $3, updated_at = $2
WHERE product_id = $4
```

| Param | Source |
|---|---|
| `$1` | `admin["user_id"]` (JWT) |
| `$2` | `now()` Python `_now()` (UTC) |
| `$3` | `comment or None` (string vide → null) |
| `$4` | path param `product_id` |

> ⚠️ **`updated_at = $2`** — réutilise le param `$2` (timestamp now). Garantit que `admin_validated_at == updated_at` à l'approbation. Java doit préserver (utile pour audit timeline).

---

## SELECT pré-UPDATE reject (l. 173–175)

Identique à approve.

## UPDATE reject (l. 180–189)

```sql
UPDATE marketplace_products
SET status = 'rejected', in_stock = FALSE,
    admin_validated_by = $1, admin_validated_at = $2,
    rejection_reason = $3, admin_comment = $3, updated_at = $2
WHERE product_id = $4
```

| Param | Source |
|---|---|
| `$1` | `admin["user_id"]` |
| `$2` | `now()` |
| `$3` | `comment or None` — **réutilisé pour `rejection_reason` ET `admin_comment`** (l. 185) |
| `$4` | path param |

> ⚠️ **DUPLICATION `$3`** confirmée : la même valeur est écrite dans 2 colonnes distinctes. Java doit reproduire :
> ```java
> jdbc.update(SQL_REJECT, adminId, now, comment, productId);
> // Le SQL contient AND rejection_reason = ? AND admin_comment = ? — 2 placeholders mais 1 seul param Python car réutilisé via $3
> ```
> En Java avec `NamedParameterJdbcTemplate`, utiliser un seul named param `:comment` référencé 2 fois dans le SQL.

---

## Worker `AdminProductReminderWorker` — SQL

### SELECT scan (l. 27–40)

```sql
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
```

> ⚠️ **`INTERVAL '2 hours'`** est interpolé via f-string (`f"... NOW() - INTERVAL '{REMINDER_DELAY_HOURS} hours'"`) à partir de la constante `REMINDER_DELAY_HOURS = 2`. Java doit utiliser PostgreSQL natif :
> ```sql
> created_at < NOW() - make_interval(hours => :hours)
> ```
> ou string concat sécurisé (constant), PAS de paramètre `?` direct sur INTERVAL.

> ⚠️ **`LIMIT 50`** : batch size. Si plus de 50 produits en pending depuis >2h, le worker en traite 50 par cycle (10 min) — peut prendre du retard. Acceptable en pratique. Java doit préserver.

### SELECT admins (l. 44–47)

```sql
SELECT user_id FROM users WHERE role = 'admin'
```

> ⚠️ **PAS de filtre `is_active`/`deleted_at`** — peut envoyer à des admins archivés. Compat = préserver.

### UPDATE batch (l. 53–56)

```sql
UPDATE marketplace_products
SET admin_reminder_sent_at = $1
WHERE product_id = ANY($2::text[])
```

| Param | Source |
|---|---|
| `$1` | `now()` |
| `$2` | array Python `[product_id_1, product_id_2, ...]` |

### Push notif

Pour chaque `(product, admin)` paire (cartésien M×N) → `send_push_to_user(...)` séquentiel.

> ⚠️ **Push synchrone séquentiel** : si 5 produits × 3 admins = 15 push synchrones avant retour worker. Java RECOMMANDÉ : `CompletableFuture.allOf` ou `@Async` (rupture compat mineure — gain perf).

---

## Transitions de statut

```
                  ┌──── S39 POST /products avec status=pending_review ────┐
                  │                                                          ▼
                draft ◄── S39 update                                pending_review
                  │                                                          │
                  │                                                          │
                  │                          ┌────── approve S41 ──────────►│
                  │                          ▼                                │
                  │                       active ◄────── reject S41 ────────┤
                  │                          │             │                  │
                  │           S40 DELETE     ▼             ▼                  ▼
                  └─────────────────────► deleted     rejected            (resté pending)
                                            │             │
                                            │             └─ S39 UPDATE → pending_review (re-soumission)
                                            └─ S40 reactivate → active (perte historique status)
```

### Transitions DB attestées dans le code

| FROM | TO | Endpoint S41 | Compat permissive ? |
|---|---|---|---|
| `pending_review` | `active` | approve | ✅ flow nominal |
| `pending_review` | `rejected` | reject | ✅ flow nominal |
| `active` | `active` | approve (idempotent) | ⚠️ pas bloqué — UPDATE re-écrase |
| `active` | `rejected` | reject | ⚠️ permis — un admin peut "rétro-rejeter" un produit publié |
| `rejected` | `active` | approve | ⚠️ permis — overrule du rejet |
| `rejected` | `rejected` | reject | ⚠️ idempotent — re-écrase |
| `draft` | `active` | approve | ⚠️ skip review — non documenté côté product flow |
| `draft` | `rejected` | reject | ⚠️ permis — UI peut-elle déclencher ? |
| `deleted` | `active` | approve | 🔴 **ZOMBIE** — admin peut ressusciter un produit deleted (compat anomalie) |
| `deleted` | `rejected` | reject | 🔴 **ZOMBIE** également |

> 🔴 **Recommandation Java** : préserver compat (toutes les transitions OK), MAIS logguer au moins un WARN si la transition est inattendue (`active → rejected`, `deleted → *`). Cela facilitera l'investigation post-cutover.

---

## Pièges DB principaux

### PIÈGE-DB-01 — `image_urls` est `jsonb` (confirmé S41)

L'expression `jsonb_array_length(COALESCE(p.image_urls, '[]'::jsonb))` (l. 65, l. 95) **prouve** que `image_urls` est de type `jsonb`. **Important rétroactivement pour S39 / S40** :
- S39 INSERT/UPDATE : utiliser `PGobject(type="jsonb", value=mapper.writeValueAsString(list))`
- S40 lecture : `row.getString("image_urls")` puis `mapper.readValue(...)`

### PIÈGE-DB-02 — JOIN strict masque les sellers orphelins

`JOIN users` (PAS LEFT JOIN) sur GET pending : un produit avec `seller_id` orphelin (user deleted) n'apparaît jamais. Préserver compat ou utiliser `LEFT JOIN` (rupture mineure).

### PIÈGE-DB-03 — Pas de filtre `status != 'deleted'` côté approve/reject

Anomalie compat majeure : un produit deleted peut être ressuscité par approve. À préserver mais documenter.

### PIÈGE-DB-04 — `rejection_reason` = `admin_comment` (DUPLICATION)

Le UPDATE reject écrit la même valeur dans 2 colonnes. NamedParameterJdbcTemplate Java : utiliser `:comment` référencé 2 fois.

### PIÈGE-DB-05 — `admin_reminder_sent_at` UPDATE dehors transaction push

Worker fait UPDATE batch PUIS boucle push. Si push échoue, `admin_reminder_sent_at` est déjà committed → admins reçoivent moins de notifs que prévu (acceptable pour des rappels ; pas critique).

### PIÈGE-DB-06 — `INTERVAL '2 hours'` interpolation

Le worker Python interpole la constante via f-string. Java doit utiliser `make_interval(hours => :hours)` ou string concat contrôlée (PAS un paramètre `?` direct).

### PIÈGE-DB-07 — `comment or None` mapping

Python `(body.get("comment") or "").strip()` puis `comment or None` :
- `comment = ""` (string vide) → DB stocke `NULL`
- `comment = "x"` → DB stocke `"x"`
- `comment = None` → impossible (déjà passé par `or ""`)

Java :
```java
String comment = Optional.ofNullable(body.get("comment"))
    .map(String::valueOf).map(String::strip)
    .filter(s -> !s.isEmpty())
    .orElse(null);
```

### PIÈGE-DB-08 — `quality_score` retour SQL → Long Java

`SELECT (...) AS quality_score` retourne un entier (somme de `CASE WHEN ... THEN N ELSE 0`). Java DOIT mapper vers `Integer` ou `Long` (PAS `Double`).

### PIÈGE-DB-09 — Pas de pagination

GET pending sans LIMIT. Acceptable mais Java peut ajouter `LIMIT 200` par sécurité.

### PIÈGE-DB-10 — `users.name` vs `users.full_name`

Le code utilise `u.name` (l. 61, 92). Vérifier vs S23/S24 — possible alias DB. Si la colonne s'appelle vraiment `name`, garder ; si elle s'appelle `full_name` côté autre slice, signaler incohérence DB à investiguer.

---

## Index recommandés

Existants probables :
- `idx_marketplace_products_status` ou `idx_marketplace_products_status_created` (pour `WHERE status='pending_review' ORDER BY created_at ASC`)

Suggestions Java :
- `idx_marketplace_products_pending_review (status, created_at) WHERE status = 'pending_review'` (partiel, optimal)
- `idx_marketplace_products_admin_reminder (admin_reminder_sent_at) WHERE status = 'pending_review'` (partiel, optimal pour worker)

---

## Récap pièges DB

| ID | Piège | Action Java |
|---|---|---|
| DB-01 | `image_urls` = `jsonb` (confirmé) | PGobject jsonb partout |
| DB-02 | JOIN strict masque sellers orphelins | LEFT JOIN recommandé |
| DB-03 | Pas de filtre `status != 'deleted'` approve/reject | Préserver, log WARN |
| DB-04 | `rejection_reason` = `admin_comment` dupliqué | `:comment` référencé 2 fois |
| DB-05 | UPDATE worker hors transaction push | Préserver |
| DB-06 | INTERVAL interpolé worker | `make_interval` ou string constant |
| DB-07 | `comment or None` mapping | `filter(s -> !s.isEmpty()).orElse(null)` |
| DB-08 | `quality_score` Integer | Mapping JdbcTemplate strict |
| DB-09 | Pas de pagination GET pending | Ajouter LIMIT 200 |
| DB-10 | `users.name` vs `full_name` | Auditer DDL |
