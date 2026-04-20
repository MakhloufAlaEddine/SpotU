# SLICE_29_DB_MAPPING.md — Mapping DB SpotYou Soft-Delete + Reactivate
> Basé sur `deletion_routes.py:260–431`, `migrations/008_soft_delete_columns.sql`, `migrations/009_pending_file_deletions.sql`, `migrations/011_pending_file_deletions_status.sql`, `migrations/012_media_purge_retention.sql`.
> Généré le 2026-04-20.

---

## Tables impliquées (4)

| Table | Rôle | Opérations Slice 29 |
|---|---|---|
| `tag_points` | Entité principale SpotYou | SELECT (guards), UPDATE (flip soft-delete/reactivate) |
| `conversations` | Conversations de contexte SpotYou | UPDATE `context_deleted` bidirectionnel |
| `pending_file_deletions` | Queue de purge différée des fichiers | INSERT (delete) / DELETE WHERE status='pending' (reactivate) |
| `spot_you_members` | Membres acceptés d'un SpotYou | SELECT (récupérer les destinataires des push) |

---

## Table `tag_points` — colonnes utilisées

| Colonne | Type PG | Lecture | Écriture DELETE | Écriture REACTIVATE | Notes |
|---|---|---|---|---|---|
| `point_id` | TEXT (PK) | WHERE | WHERE | WHERE | Identifiant stable du SpotYou |
| `user_id` | TEXT (FK users) | ✅ guard ownership | — | — | Propriétaire |
| `title` | TEXT | ✅ (push payload) | — | — | Tronqué à 50 chars à la reactivate uniquement |
| `images` | JSONB | ✅ (_schedule_file_deletions) | — | — | Array d'URLs — parsing via `_parse_images` |
| `active` | BOOLEAN | — | `FALSE` | `TRUE` | Soft-delete flag primaire |
| `deleted_at` | TIMESTAMPTZ NULL | ✅ guard 409 | `NOW()` | `NULL` | Marker soft-delete |
| `deleted_by` | TEXT NULL | — | `caller.user_id` | `NULL` | Audit trail |
| `updated_at` | TIMESTAMPTZ | — | `NOW()` | `NOW()` | Toujours mis à jour |
| `media_purge_scheduled_at` | TIMESTAMPTZ NULL (012) | — | `NOW() + 90d` | `NULL` | Consommé par `media_purge_worker` |
| `media_purge_notified_at` | TIMESTAMPTZ NULL (012) | — | — (laissé NULL) | `NULL` | Consommé par `media_notif_worker` |
| `media_purged` | BOOLEAN (012, default FALSE) | ✅ (reactivate réponse) | — | — | Flip par le worker, pas par les endpoints REST |
| `reactivated_at` | TIMESTAMPTZ NULL (012) | — | — | `NOW()` | Utilisé par `GET /users/me/reactivatable` pour filtrer les "vraiment réactivés" |

### SQL DELETE (exact)

```sql
-- Guard read
SELECT user_id, images, title, deleted_at
  FROM tag_points
 WHERE point_id = $1;

-- Mutation
UPDATE tag_points
   SET active                    = FALSE,
       deleted_at                = $1,         -- now
       deleted_by                = $2,         -- caller.user_id
       updated_at                = $1,         -- now (même valeur que deleted_at)
       media_purge_scheduled_at  = $3          -- now + 90 days
 WHERE point_id = $4;
```

### SQL REACTIVATE (exact)

```sql
-- Guard read
SELECT user_id, deleted_at, active, media_purged, title
  FROM tag_points
 WHERE point_id = $1;

-- Mutation
UPDATE tag_points
   SET active                    = TRUE,
       deleted_at                = NULL,
       deleted_by                = NULL,
       updated_at                = $1,         -- now
       media_purge_scheduled_at  = NULL,
       media_purge_notified_at   = NULL,       -- reset pour permettre re-notif si re-delete
       reactivated_at            = $1          -- now (même valeur que updated_at)
 WHERE point_id = $2;
```

---

## Table `conversations` — colonnes utilisées

| Colonne | Type PG | Lecture | DELETE | REACTIVATE | Notes |
|---|---|---|---|---|---|
| `conversation_id` | TEXT (PK) | — | RETURNING (count) | — | |
| `context_id` | TEXT | WHERE | WHERE | WHERE | Lien souple vers `tag_points.point_id` |
| `context_deleted` | BOOLEAN | WHERE=FALSE (delete) / WHERE=TRUE (reactivate) | `TRUE` | `FALSE` | Flag affichage côté front |

### SQL DELETE

```sql
UPDATE conversations
   SET context_deleted = TRUE
 WHERE context_id = ANY($1::text[])
   AND context_deleted = FALSE
 RETURNING conversation_id;
```

- **`ANY($1::text[])`** : passe une liste de context_ids — ici toujours `[point_id]` unique mais le helper `_mark_conversations_context_deleted` est conçu pour accepter une liste (utilisé dans `DELETE /users/{id}` avec N SpotYou simultanés).
- **Garde `context_deleted = FALSE`** : ne re-UPDATE pas les conversations déjà marquées (cas d'un SpotYou partiellement supprimé puis re-supprimé).
- **`RETURNING`** : retourne le nombre de conversations effectivement marquées (pour la réponse JSON `conversations_marked`).

### SQL REACTIVATE

```sql
UPDATE conversations
   SET context_deleted = FALSE
 WHERE context_id = $1           -- point_id scalaire (pas ANY)
   AND context_deleted = TRUE;
```

- **Pas de RETURNING** : le count n'est pas exposé dans la réponse reactivate.
- **Scalaire, pas array** : le helper n'est pas réutilisé ici, c'est du SQL inline.
- **Asymétrie volontaire** avec le delete (array vs scalaire). Ne pas uniformiser en Java.

---

## Table `pending_file_deletions` — colonnes utilisées

### Schéma complet (migrations 009 + 011)

| Colonne | Type PG | Notes |
|---|---|---|
| `id` | SERIAL/UUID (PK) | Clé technique |
| `file_url` | TEXT | URL complète R2/CDN |
| `entity_type` | TEXT | Valeur : `'tag_point'` (ici), aussi `'service'`, `'product'`, `'user'`, `'message'` |
| `entity_id` | TEXT | `point_id` ici |
| `scheduled_at` | TIMESTAMPTZ | Date de purge prévue (= `deleted_at + 90d`) |
| `status` | TEXT | `'pending'` / `'completed'` / `'failed'` — ajouté en migration 011 |
| Contrainte unique | `(file_url, entity_id)` ou équivalent | Nécessaire pour `ON CONFLICT DO NOTHING` |

### SQL DELETE (via `_schedule_file_deletions`)

```sql
-- Pour CHAQUE url non-vide dans tp.images :
INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at)
VALUES ($1, 'tag_point', $2, $3)
ON CONFLICT DO NOTHING;
```

- **Idempotent** : si l'URL a déjà été schedulée (ex. retry du endpoint), `ON CONFLICT DO NOTHING`.
- **1 INSERT par image** — pas de bulk. Java : boucle ou `INSERT ... VALUES (...), (...), ... ON CONFLICT DO NOTHING`.

### SQL REACTIVATE (via `_cancel_file_deletions`)

```sql
DELETE FROM pending_file_deletions
 WHERE entity_id = $1
   AND status   = 'pending';
```

- **Garde `status='pending'`** : ne touche pas les entries `'completed'` (fichiers physiquement supprimés) ni `'failed'` (à logguer séparément).
- Compte extrait de la réponse asyncpg `"DELETE N"` → renvoyé dans `pending_deletions_cancelled`.

---

## Table `spot_you_members` — colonnes utilisées

| Colonne | Type PG | DELETE | REACTIVATE | Notes |
|---|---|---|---|---|
| `spot_you_id` | TEXT | WHERE | WHERE | = point_id |
| `user_id` | TEXT | WHERE `!=` owner | WHERE `!=` caller | Exclure le déclencheur |
| `status` | TEXT | Pas filtré (!) | Pas filtré (!) | **Pas de filtre sur `status='accepted'`** dans ce SQL |

### SQL DELETE

```sql
SELECT user_id
  FROM spot_you_members
 WHERE spot_you_id = $1         -- point_id
   AND user_id    != $2;        -- tp.user_id (owner)
```

### SQL REACTIVATE

```sql
SELECT user_id
  FROM spot_you_members
 WHERE spot_you_id = $1         -- point_id
   AND user_id    != $2;        -- caller.user_id
```

> ⚠️ **INCOHÉRENCE à ne pas corriger** : le DELETE exclut l'owner (`tp.user_id`), la REACTIVATE exclut le caller (`caller.user_id`). Pour un admin qui réactive un SpotYou d'un autre owner, cela signifie que **l'owner recevra une notification de réactivation** (comportement actuel du code Python, à reproduire à l'identique).
>
> Aucun filtre sur `status` → les membres `pending`, `invited` ou même `rejected` recevront la notification. **Compatibilité stricte = reproduire ce comportement en Java.**

---

## Diagramme des écritures (DELETE)

```
  [REST DELETE /tag-points/{id}]
            │
            ├── pool.acquire()  ────────────── début transaction implicite asyncpg
            │
            ├─► SELECT tag_points (guards)
            │     └─ 404/409/403 si échec
            │
            ├─► UPDATE tag_points (active=FALSE + 4 colonnes)
            │
            ├─► UPDATE conversations (context_deleted=TRUE)
            │
            ├─► INSERT pending_file_deletions × N images
            │     └─ ON CONFLICT DO NOTHING (idempotent)
            │
            ├─► SELECT spot_you_members (destinataires push)
            │
            └── pool.release()  ────────────── commit implicite
                     │
                     └─► asyncio.create_task(send_push_to_user) × N
                         (fire-and-forget, HORS TRANSACTION)
```

## Diagramme des écritures (REACTIVATE)

```
  [REST POST /tag-points/{id}/reactivate]
            │
            ├── pool.acquire()
            │
            ├─► SELECT tag_points (guards)
            │
            ├─► DELETE pending_file_deletions WHERE status='pending'
            │
            ├─► UPDATE tag_points (active=TRUE + 5 colonnes NULL-out + reactivated_at)
            │
            ├─► UPDATE conversations (context_deleted=FALSE)
            │
            ├─► SELECT spot_you_members
            │
            └── pool.release()
                     │
                     └─► asyncio.create_task(send_push_to_user) × N
```

---

## Transactionnalité

| Aspect | Comportement Python actuel | Ce que Java doit reproduire |
|---|---|---|
| Transaction explicite | **NON** — `pool.acquire()` utilise le mode auto-commit d'asyncpg sans `BEGIN/COMMIT` explicite | Utiliser `@Transactional` au niveau service Spring pour couvrir TOUTES les écritures DB. Une exception à mi-chemin doit rollback l'ensemble. |
| Push notifications | **APRÈS** la libération du pool (fire-and-forget) | Envoyer APRÈS `@TransactionalEventListener(phase=AFTER_COMMIT)` pour éviter d'envoyer des notifs sur un rollback |
| Ordre des écritures | UPDATE tag_points → UPDATE conversations → INSERT pending_file_deletions → SELECT members | À conserver (le SELECT members en dernier n'impacte pas, mais rester à l'identique) |
| Logging | `logger.info` APRÈS les DB writes, AVANT le return | Idem Java |

> **Note importante** : le Python n'a PAS de transaction explicite. Si la DB crash entre l'UPDATE tag_points et l'UPDATE conversations, on se retrouve avec un SpotYou soft-deleted mais des conversations encore "vivantes". **Java DOIT fix cette fragilité** en wrappant le tout dans `@Transactional` (amélioration mineure acceptable, ne change pas la compat API).

---

## Index & performance (référence)

Migration 012 crée les index suivants, utilisés par les workers (pas par les endpoints REST directement) :

```sql
CREATE INDEX IF NOT EXISTS idx_tag_points_media_purge_scheduled
  ON tag_points(media_purge_scheduled_at)
  WHERE media_purge_scheduled_at IS NOT NULL AND media_purged = FALSE;
-- (idem pour users, services, marketplace_products)
```

**Aucun index spécifique n'est requis pour Slice 29** (les endpoints accèdent par PK `point_id`).

---

## Incertitudes / zones grises

| Zone | Question | Action |
|---|---|---|
| Type `point_id` | TEXT ? UUID ? | Vérifier dans migration 001/002 du schéma initial. Actuellement pas dans cette slice. Assumer TEXT. |
| Contrainte unique `pending_file_deletions` | Sur `(file_url, entity_id)` ou `(file_url)` seul ? | Lire `migrations/009_pending_file_deletions.sql` au moment de l'implémentation Java. Le `ON CONFLICT DO NOTHING` implique *une* contrainte unique — mais laquelle ? **À confirmer.** |
| Valeurs `status` exactes | `'pending'`, `'completed'`, `'failed'` ? Autre ? | Cf. migration 011. Lire le fichier pour la liste exacte des valeurs possibles. |
| Encodage JSONB `images` | Le texte des URLs est-il toujours parsable en JSON array ? | Oui dans le cas normal. `_parse_images` gère les 3 formats fallback. |
| Push `title_str` troncature | Pourquoi 50 chars uniquement à la reactivate ? | Comportement Python. Garder tel quel. |
