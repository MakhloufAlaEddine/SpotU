# SLICE_40_DB_MAPPING.md — Mapping DB Marketplace lifecycle seller
> Basé sur `routes/product_creation_routes.py:459–556`, `media_purge_worker.py:69–126`, `migrations/009_pending_file_deletions.sql`, `migrations/011_pending_file_deletions_status.sql`.
> Généré le 2026-04-30.

---

## Tables touchées

| Table | Op | Endpoint(s) / Composant |
|---|---|---|
| `marketplace_products` | UPDATE (soft-delete) | DELETE |
| `marketplace_products` | UPDATE (restauration) | Reactivate |
| `marketplace_products` | UPDATE (purge marquage) | `MediaPurgeWorker` |
| `marketplace_products` | SELECT | DELETE + Reactivate + Worker |
| `pending_file_deletions` | INSERT (`ON CONFLICT DO NOTHING`) | DELETE |
| `pending_file_deletions` | DELETE | Reactivate |

---

## Schéma `pending_file_deletions` (DDL exacte)

> Source : `migrations/009_pending_file_deletions.sql` + `011_pending_file_deletions_status.sql`.

```sql
CREATE TABLE pending_file_deletions (
    id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    file_url        TEXT        NOT NULL,
    entity_type     TEXT        NOT NULL,   -- 'tag_point' | 'service' | 'product' | 'user'
    entity_id       TEXT        NOT NULL,
    scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ NULL,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','deleted','failed','skipped')),
    error_message   TEXT        NULL,
    attempt_count   INT         NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_pending_deletions_unprocessed
    ON pending_file_deletions(scheduled_at) WHERE processed_at IS NULL;

CREATE INDEX idx_pfd_status_scheduled
    ON pending_file_deletions(status, scheduled_at) WHERE status = 'pending';

CREATE INDEX idx_pfd_failed
    ON pending_file_deletions(status, last_attempt_at) WHERE status = 'failed';
```

> ⚠️ **PIÈGE-DB-01 — Pas de contrainte UNIQUE explicite** : le code Python utilise `ON CONFLICT DO NOTHING` mais la DDL n'a **PAS** de `UNIQUE (file_url, entity_id)` ou similaire. Soit il existe une `UNIQUE` cachée dans une migration ultérieure, soit le `ON CONFLICT` se rabat sur la PK `id`. Vu que `id` est généré via `gen_random_uuid()`, **aucune collision n'est possible** sur la PK → le `ON CONFLICT DO NOTHING` est en pratique **un no-op**. **Java DOIT auditer la DDL Supabase EXACTE** (`\d pending_file_deletions`) pour confirmer. Si pas d'UNIQUE, on peut implémenter sans `ON CONFLICT` côté Java sans changer le comportement.

---

## Colonnes `marketplace_products` modifiées par S40

| Colonne | Type SQL inféré | DELETE | Reactivate | Worker | Lecture S38/S39 |
|---|---|---|---|---|---|
| `status` | `text` | → `'deleted'` | → `'active'` | (lu) | filtré `!='deleted'` / `='active'` |
| `deleted_at` | `timestamptz?` | → `now()` | → `NULL` | (lu) | non remonté |
| `deleted_by` | `text?` (FK users.user_id) | → `user_id` | → `NULL` | — | non remonté |
| `media_purge_scheduled_at` | `timestamptz?` | → `now() + 90j` | → `NULL` | (lu, condition) | non remonté |
| `media_purge_notified_at` | `timestamptz?` | (non touché — voir note) | → `NULL` | — | non remonté |
| `media_purged` | `bool` (default `FALSE`) | (non touché) | **(non touché)** | → `TRUE` | non remonté |
| `media_purged_at` | `timestamptz?` | (non touché) | (non touché) | → `now()` | non remonté |
| `reactivated_at` | `timestamptz?` | (non touché) | → `now()` | (lu, idempotence) | non remonté |
| `updated_at` | `timestamptz` | → `now()` | → `now()` | — | remonté |

> ⚠️ `media_purge_notified_at` est peuplé par un autre worker (`media_notif_worker.py`) HORS scope S40 (probablement à T+83j pour notifier le seller que la purge approche). DELETE ne le touche pas (laissé NULL). Reactivate le remet à NULL (cohérent : annule toute notif planifiée).

---

## DELETE — UPDATE exact (l. 476–482)

```sql
UPDATE marketplace_products
SET status = 'deleted',
    deleted_at = $1,
    deleted_by = $2,
    media_purge_scheduled_at = $3,
    updated_at = $1
WHERE product_id = $4
```

| Param | Source |
|---|---|
| `$1` | `now()` Python `_now()` (`datetime.now(timezone.utc)`) |
| `$2` | `user["user_id"]` (JWT) |
| `$3` | `now() + timedelta(days=90)` |
| `$4` | path param `product_id` |

> ⚠️ **PIÈGE-DB-02 — Pas de `seller_id` dans le WHERE de l'UPDATE**. Le SELECT initial (l. 469–472) a bien le `seller_id = $2` filter, mais l'UPDATE ne le re-vérifie PAS. **Race condition théorique** : si quelqu'un transfère le produit entre le SELECT et l'UPDATE, l'UPDATE écraserait. **Java DOIT ajouter `AND seller_id = ?`** par défense en profondeur.

> ⚠️ **PIÈGE-DB-03 — Pas de garde anti-2e-DELETE au niveau UPDATE**. Le filtre `status != 'deleted'` est uniquement dans le SELECT. Si race condition double-DELETE, le 2e UPDATE ré-écrirait `deleted_at` (perte d'info originelle). Java peut ajouter `AND status != 'deleted'` au UPDATE pour fermer.

### SELECT existence (l. 469–472)

```sql
SELECT product_id, image_urls, cover_image_url
FROM marketplace_products
WHERE product_id = $1 AND seller_id = $2 AND status != 'deleted'
```

---

## DELETE — INSERT planification purge fichiers (boucle l. 492–498)

Pour chaque URL `url` non-vide dans `image_urls[]` :

```sql
INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at)
VALUES ($1, 'product', $2, $3)
ON CONFLICT DO NOTHING
```

| Param | Source |
|---|---|
| `$1` | URL image (string) |
| `$2` | path param `product_id` |
| `$3` | `now() + timedelta(days=90)` |

> ⚠️ **PIÈGE-DB-04 — Boucle N+1**. Python fait 1 INSERT par image (pas de batch). Pour un produit avec 20 images = 20 round-trips DB. **Java RECOMMANDÉ** : utiliser `INSERT ... VALUES (...), (...), (...)` ou `JdbcTemplate.batchUpdate`. Performance négligeable en pratique (UI limite à ~10 images), mais l'optimisation est gratuite.

> ⚠️ **PIÈGE-DB-05 — `cover_image_url` peut être hors `image_urls[]`**. Le code Python NE traite QUE `image_urls[]` (l. 485). Si `cover_image_url` est une URL distincte (ex: cropped version stockée séparément), elle ne sera **jamais purgée**. Ce comportement n'est **pas documenté** comme intentionnel ni comme bug. Java DOIT préserver (compat stricte) — possible amélioration future.

> ⚠️ **PIÈGE-DB-06 — Parsing fallback `image_urls`** :
> ```python
> imgs = row["image_urls"] or []
> if isinstance(imgs, str):
>     try: imgs = json.loads(imgs)
>     except: imgs = []
> ```
> Le code accepte `image_urls` stocké soit comme `text[]` soit comme string JSON sérialisé. **Cela révèle l'incertitude DDL** (cf. PIÈGE-DB-01 de S39). Java doit préserver ce dual parsing OU décider du type strict après audit Supabase.

---

## Reactivate — SELECT existence (l. 522–526)

```sql
SELECT seller_id, status, deleted_at, media_purged, title
FROM marketplace_products
WHERE product_id = $1
```

> ⚠️ **PAS de filtre `seller_id`** ici (intentionnel — admin peut restaurer un produit non possédé). La permission est vérifiée applicativement après le SELECT (l. 531–532).

> ⚠️ `title` est sélectionné mais **JAMAIS utilisé** dans la suite du code. Java peut le retirer (mais 0 gain réel). Compat stricte = préserver.

## Reactivate — DELETE pending purges (l. 535–538)

```sql
DELETE FROM pending_file_deletions
WHERE entity_id = $1 AND status = 'pending'
```

> ⚠️ **PIÈGE-DB-07 — Pas de filtre `entity_type='product'`**. Si un attaquant connaît un `product_id` qui collisionne avec un autre `entity_id` (`tag_point`, `service`...), il pourrait théoriquement annuler ces purges. En pratique **collision improbable** (préfixes `prod_`, `tp_`, `srv_` distincts). Java DOIT ajouter `AND entity_type='product'` par défense en profondeur.

> ⚠️ Filtrage `status='pending'` uniquement → les rows déjà `processing/deleted/failed/skipped` ne sont PAS retouchées. **Cohérent** : si la purge a déjà commencé/réussi, on ne peut pas l'annuler (les fichiers sont déjà supprimés ou en cours).

## Reactivate — UPDATE restauration (l. 540–547)

```sql
UPDATE marketplace_products
SET status = 'active',
    deleted_at = NULL,
    deleted_by = NULL,
    updated_at = $1,
    media_purge_scheduled_at = NULL,
    media_purge_notified_at = NULL,
    reactivated_at = $1
WHERE product_id = $2
```

| Param | Source |
|---|---|
| `$1` | `now()` |
| `$2` | path param `product_id` |

> ⚠️ **PIÈGE-DB-08 — `media_purged` PAS reset**. Si la purge a déjà eu lieu (`media_purged=TRUE`), reactivate laisse `TRUE`. C'est **délibéré** — c'est ce qui permet au front d'afficher "vous devez re-uploader vos images". Si le seller re-upload puis reactivate à nouveau → `media_purged` reste `TRUE` (zombie state). Java DOIT préserver, OU ajouter une logique : "lors d'un re-upload réussi, reset `media_purged=FALSE`". **HORS scope S40**.

> ⚠️ **PIÈGE-DB-09 — Pas de `seller_id` dans le WHERE**. Mêmes remarques que PIÈGE-DB-02 : Java doit ajouter pour défense en profondeur — sauf si admin (qui par définition n'a pas le `seller_id` du produit). **Solution Java** : `WHERE product_id = ? AND (seller_id = ? OR :is_admin)` paramétré.

---

## MediaPurgeWorker — SELECT scan (l. 96–104)

Pour `marketplace_products` (entity_specs[2]) :

```sql
SELECT product_id
FROM marketplace_products
WHERE media_purge_scheduled_at <= $1
  AND media_purged = FALSE
  AND deleted_at IS NOT NULL AND status = 'deleted'
  AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
```

| Param | Source |
|---|---|
| `$1` | `now()` |

### Idempotence triple

| Garde | Pourquoi |
|---|---|
| `media_purged = FALSE` | Skip ce qui est déjà purgé (cycle précédent) |
| `deleted_at IS NOT NULL AND status='deleted'` | Skip ce qui n'est pas/plus supprimé |
| `reactivated_at IS NULL OR reactivated_at < deleted_at` | Skip ce qui a été réactivé plus récemment que la dernière suppression (gestion delete→reactivate→delete cycle) |

> ⚠️ **PIÈGE-DB-10 — Comparaison `reactivated_at < deleted_at`**. Si on fait DELETE → REACTIVATE → DELETE (re-suppression), le `reactivated_at` reste à la 1ère reactivation (pas reset par DELETE l. 476). Donc `reactivated_at < deleted_at` est `TRUE` (la nouvelle deleted_at est plus récente) → le worker traitera correctement. **MAIS** si le DELETE est rapide, `reactivated_at == deleted_at` exactement (timestamp identique à la microseconde près) → la condition `<` strict exclurait → faux négatif. Très improbable mais possible. Java DOIT préserver (`<` strict, compat).

## MediaPurgeWorker — UPDATE marquage (l. 109–114)

```sql
UPDATE marketplace_products
SET media_purged = TRUE,
    media_purged_at = $1
WHERE product_id = ANY($2::text[])
```

> Batch UPDATE — pas de boucle. Java peut utiliser `IN (...)` avec une liste paramétrée OU `WHERE product_id = ANY(?)` PostgreSQL natif.

---

## Relations / FK

| Champ | Référence | Type relation |
|---|---|---|
| `marketplace_products.deleted_by` | `users.user_id` | FK applicative (pas de check explicite) |
| `pending_file_deletions.entity_id` | `marketplace_products.product_id` (si `entity_type='product'`) | FK polymorphe — pas de FK SQL stricte |

> ⚠️ Le polymorphisme `entity_type` empêche une FK SQL native. Java doit accepter ce design (compat stricte). Pas de `@ManyToOne` JPA possible.

---

## Index recommandés (DDL existante + Java)

Existants (à préserver) :
- `idx_pending_deletions_unprocessed (scheduled_at) WHERE processed_at IS NULL`
- `idx_pfd_status_scheduled (status, scheduled_at) WHERE status='pending'`
- `idx_pfd_failed (status, last_attempt_at) WHERE status='failed'`

Suggestions Java pour S40 (à créer si pas déjà présents) :
- `idx_marketplace_products_purge_scan (media_purge_scheduled_at) WHERE media_purged=FALSE AND status='deleted'` — accélère le scan worker
- `idx_marketplace_products_seller_status (seller_id, status)` — accélère `/products/mine` (S39 + filtre)

---

## Récap pièges DB

| ID | Piège | Action Java |
|---|---|---|
| DB-01 | `ON CONFLICT DO NOTHING` sans UNIQUE explicite | Auditer DDL ; supprimer le `ON CONFLICT` si pas d'UNIQUE |
| DB-02 | UPDATE DELETE sans `seller_id` | Ajouter `AND seller_id = ?` |
| DB-03 | UPDATE DELETE sans `status != 'deleted'` | Ajouter au WHERE par défense |
| DB-04 | Boucle N+1 INSERT pending_file_deletions | Batch insert (gain perf marginal) |
| DB-05 | `cover_image_url` non purgée si hors `image_urls[]` | Préserver compat (anomalie) |
| DB-06 | `image_urls` parsing dual `text[]` / JSON string | Auditer DDL strict ; sinon préserver fallback |
| DB-07 | DELETE pending sans `entity_type='product'` | Ajouter au WHERE |
| DB-08 | Reactivate ne reset pas `media_purged` | Préserver compat (intentionnel) |
| DB-09 | UPDATE Reactivate sans `seller_id` (admin override) | Paramétrer `(seller_id=? OR is_admin=true)` |
| DB-10 | Worker idempotence `reactivated_at < deleted_at` strict | Préserver compat |
