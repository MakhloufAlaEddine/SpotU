# SLICE_07_DB_MAPPING.md — Mapping base de données
> Basé sur `user_routes.py:632–664`, `migrations/001_initial_schema.sql`.
> Généré le 2026-02-XX.

---

## Tables utilisées

| Table | Opération | Endpoint |
|---|---|---|
| `user_blocks` | INSERT ON CONFLICT DO NOTHING | POST /block |
| `user_blocks` | DELETE WHERE blocker_id+blocked_id | DELETE /block |
| `user_follows` | DELETE bidirectionnel (OR) | POST /block uniquement |

---

## Schéma `user_blocks`

```sql
-- migrations/001_initial_schema.sql:519–527
CREATE TABLE public.user_blocks (
    blocker_id  text NOT NULL,
    blocked_id  text NOT NULL,
    created_at  timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id);

CREATE INDEX idx_blocks_blocker ON public.user_blocks USING btree (blocker_id);
CREATE INDEX idx_blocks_blocked ON public.user_blocks USING btree (blocked_id);

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey
    FOREIGN KEY (blocker_id) REFERENCES public.users(user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocked_id_fkey
    FOREIGN KEY (blocked_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
```

### Colonnes

| Colonne | Type SQL | Type Java | Nullable | Rôle |
|---|---|---|---|---|
| `blocker_id` | TEXT NOT NULL | `String` | NON | PK partielle — celui qui bloque (me) |
| `blocked_id` | TEXT NOT NULL | `String` | NON | PK partielle — celui qui est bloqué (cible) |
| `created_at` | TIMESTAMPTZ DEFAULT now() | `OffsetDateTime` | OUI | Non lu par les handlers |

### Contraintes

| Contrainte | Type | Colonnes | Impact |
|---|---|---|---|
| `user_blocks_pkey` | PRIMARY KEY | `(blocker_id, blocked_id)` | `ON CONFLICT DO NOTHING` cible cette PK |
| FK blocker → users | CASCADE DELETE | `blocker_id → users.user_id` | Si user supprimé → ses blocs supprimés |
| FK blocked → users | CASCADE DELETE | `blocked_id → users.user_id` | Si user supprimé → il est retiré des blocs |

---

## Requêtes SQL — POST /block

### R1 — DELETE follows bidirectionnel

```sql
-- user_routes.py:642–645
DELETE FROM user_follows
WHERE (follower_id = $1 AND following_id = $2)
   OR (follower_id = $2 AND following_id = $1)
```

| Paramètre | Valeur |
|---|---|
| `$1` | `blocker_id` = `me["user_id"]` |
| `$2` | `user_id` cible |

**Supprime 0, 1 ou 2 lignes** selon les relations existantes :
- `blocker → cible` (si le bloqueur suivait la cible)
- `cible → blocker` (si la cible suivait le bloqueur)
- Les deux simultanément

### R2 — INSERT block

```sql
-- user_routes.py:647–650
INSERT INTO user_blocks(blocker_id, blocked_id)
VALUES($1, $2)
ON CONFLICT DO NOTHING
```

| Paramètre | Valeur |
|---|---|
| `$1` | `blocker_id` |
| `$2` | `user_id` cible |

`created_at` rempli automatiquement par `DEFAULT now()`.

---

## Requête SQL — DELETE /block

### R3 — DELETE block

```sql
-- user_routes.py:660–663
DELETE FROM user_blocks
WHERE blocker_id = $1 AND blocked_id = $2
```

| Paramètre | Valeur |
|---|---|
| `$1` | `me["user_id"]` |
| `$2` | `user_id` cible |

- Supprime 0 ou 1 ligne (silencieux si 0)
- **Aucune modification de `user_follows`**

---

## Ordre d'exécution et connexion

```
POST /block :
    [même connexion]
        R1 : DELETE FROM user_follows (bidirectionnel)
        R2 : INSERT INTO user_blocks ON CONFLICT DO NOTHING
    → {"blocked": true}

DELETE /block :
    [même connexion]
        R3 : DELETE FROM user_blocks
    → {"blocked": false}
```

**Pas de transaction explicite** en Python. Les deux opérations de POST /block sont exécutées
séquentiellement dans la même connexion mais sans `BEGIN`/`COMMIT` explicite.

---

## Flux complet

### POST /block

```
[Request]
    │
    ├── require_auth → me["user_id"] = blocker_id
    │
    ├── self-block check: blocker_id == user_id → 400
    │
    └── [Connexion DB]
            ├── R1: DELETE FROM user_follows (bidirectionnel) — 0, 1 ou 2 rows
            └── R2: INSERT INTO user_blocks ON CONFLICT DO NOTHING
                      → {"blocked": true}
```

### DELETE /block

```
[Request]
    │
    ├── require_auth → me["user_id"]
    │
    └── [Connexion DB]
            └── R3: DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2
                      → {"blocked": false}
```
