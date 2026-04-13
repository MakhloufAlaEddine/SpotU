# SLICE_06_DB_MAPPING.md — Mapping base de données
> Basé sur `user_routes.py:568–613`, `migrations/001_initial_schema.sql`.
> Généré le 2026-02-XX.

---

## Tables utilisées

| Table | Rôle | Endpoints |
|---|---|---|
| `user_follows` | Source JOIN — relations de suivi | Les deux |
| `users` | JOIN cible — données du profil listé | Les deux |
| `user_blocks` | Subquery EXISTS — `is_blocked` | Les deux |

---

## Schéma `user_blocks` (rappel)

```sql
CREATE TABLE public.user_blocks (
    blocker_id  text NOT NULL,
    blocked_id  text NOT NULL,
    created_at  timestamp with time zone DEFAULT now()
);
ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id);
CREATE INDEX idx_blocks_blocker ON public.user_blocks USING btree (blocker_id);
CREATE INDEX idx_blocks_blocked ON public.user_blocks USING btree (blocked_id);
```

---

## Requête SQL — GET /followers

```sql
-- user_routes.py:575–588
SELECT
    u.user_id,
    u.name,
    u.picture,
    u.role,
    CASE WHEN $1::TEXT IS NOT NULL THEN
        EXISTS(SELECT 1 FROM user_follows
               WHERE follower_id = $1 AND following_id = u.user_id)
    ELSE FALSE END AS is_following_back,
    CASE WHEN $1::TEXT IS NOT NULL THEN
        EXISTS(SELECT 1 FROM user_blocks
               WHERE blocker_id = $1 AND blocked_id = u.user_id)
    ELSE FALSE END AS is_blocked
FROM user_follows uf
JOIN users u ON u.user_id = uf.follower_id
WHERE uf.following_id = $2
ORDER BY u.name ASC
```

| Paramètre | Valeur | Source |
|---|---|---|
| `$1` | `me_id` (caller) — peut être `NULL` | `get_optional_auth` |
| `$2` | `user_id` (profil consulté) | Path param |

### Lecture du SQL — GET /followers

| Étape | Détail |
|---|---|
| `FROM user_follows uf` | Table des relations de suivi |
| `JOIN users u ON u.user_id = uf.follower_id` | On récupère les données des **followers** de `user_id` |
| `WHERE uf.following_id = $2` | Filtre : uniquement les gens qui suivent `user_id` ($2) |
| `ORDER BY u.name ASC` | Tri alphabétique par nom |
| `CASE WHEN $1 IS NOT NULL ... is_following_back` | Si authentifié : est-ce que le caller suit CE follower ? |
| `CASE WHEN $1 IS NOT NULL ... is_blocked` | Si authentifié : est-ce que le caller a bloqué CE follower ? |

---

## Requête SQL — GET /following

```sql
-- user_routes.py:599–612
SELECT
    u.user_id,
    u.name,
    u.picture,
    u.role,
    CASE WHEN $1::TEXT IS NOT NULL THEN
        EXISTS(SELECT 1 FROM user_follows
               WHERE follower_id = u.user_id AND following_id = $1)
    ELSE FALSE END AS follows_back,
    CASE WHEN $1::TEXT IS NOT NULL THEN
        EXISTS(SELECT 1 FROM user_blocks
               WHERE blocker_id = $1 AND blocked_id = u.user_id)
    ELSE FALSE END AS is_blocked
FROM user_follows uf
JOIN users u ON u.user_id = uf.following_id
WHERE uf.follower_id = $2
ORDER BY u.name ASC
```

| Paramètre | Valeur | Source |
|---|---|---|
| `$1` | `me_id` (caller) — peut être `NULL` | `get_optional_auth` |
| `$2` | `user_id` (profil consulté) | Path param |

### Lecture du SQL — GET /following

| Étape | Détail |
|---|---|
| `FROM user_follows uf` | Table des relations |
| `JOIN users u ON u.user_id = uf.following_id` | On récupère les données des **abonnements** de `user_id` |
| `WHERE uf.follower_id = $2` | Filtre : uniquement les gens que `user_id` ($2) suit |
| `ORDER BY u.name ASC` | Tri alphabétique par nom |
| `CASE WHEN $1 IS NOT NULL ... follows_back` | Si authentifié : est-ce que CE following suit le caller en retour ? |
| `CASE WHEN $1 IS NOT NULL ... is_blocked` | Si authentifié : est-ce que le caller a bloqué CE following ? |

---

## Différence de sémantique des subqueries CASE WHEN

| Endpoint | Champ | Subquery EXISTS | Signification |
|---|---|---|---|
| `/followers` | `is_following_back` | `follower_id=$1 AND following_id=u.user_id` | caller → follower listé |
| `/following` | `follows_back` | `follower_id=u.user_id AND following_id=$1` | following listé → caller |

La direction est **inversée** entre les deux endpoints. C'est logique :
- Dans `/followers` : "est-ce que je suis CE follower en retour ?"
- Dans `/following` : "est-ce que CET abonnement me suit en retour ?"

---

## Mapping colonnes → réponse JSON

| Colonne SQL | Alias | Champ JSON | Note |
|---|---|---|---|
| `u.user_id` | — | `user_id` | |
| `u.name` | — | `name` | |
| `u.picture` | — | `picture` | null possible |
| `u.role` | — | `role` | |
| EXISTS followers | `is_following_back` | `is_following_back` | `/followers` uniquement |
| EXISTS following | `follows_back` | `follows_back` | `/following` uniquement |
| EXISTS blocks | `is_blocked` | `is_blocked` | les deux |

**Résultat Python :** `return [dict(r) for r in rows]`
asyncpg retourne des `Record` — `dict(r)` les convertit en dict Python simple. Pas de `row_to_dict` ici (pas de TIMESTAMPTZ → pas de sérialisation ISO requise).

---

## Comportement si user_id inexistant

Si `user_id` n'existe pas en DB :
- La JOIN retourne 0 rows (aucune ligne dans `user_follows` avec ce `following_id` ou `follower_id`)
- Résultat : `[]`
- HTTP 200

**Pas de requête préalable** `SELECT 1 FROM users WHERE user_id=$1` — aucune vérification d'existence.

---

## Indexes DB utilisés

| Index | Table | Colonne | Utilisé pour |
|---|---|---|---|
| `idx_follows_following` | `user_follows` | `following_id` | WHERE clause `/followers` |
| `idx_follows_follower` | `user_follows` | `follower_id` | WHERE clause `/following` |
| `idx_blocks_blocker` | `user_blocks` | `blocker_id` | EXISTS subquery (`blocker_id=$1`) |
