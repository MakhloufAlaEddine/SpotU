# SLICE_05_DB_MAPPING.md — Mapping base de données
> Basé sur `user_routes.py:494–522`, `migrations/001_initial_schema.sql:525–540`.
> Généré le 2026-02-XX.

---

## Table principale : `user_follows`

### DDL exact

```sql
-- migrations/001_initial_schema.sql:528–535
CREATE TABLE public.user_follows (
    follower_id  text NOT NULL,
    following_id text NOT NULL,
    created_at   timestamp with time zone DEFAULT now()
);

-- Clé primaire composite (joue le rôle de contrainte UNIQUE)
ALTER TABLE ONLY public.user_follows
    ADD CONSTRAINT user_follows_pkey PRIMARY KEY (follower_id, following_id);

-- Index pour les requêtes de lecture (COUNT, EXISTS, JOIN)
CREATE INDEX idx_follows_follower  ON public.user_follows USING btree (follower_id);
CREATE INDEX idx_follows_following ON public.user_follows USING btree (following_id);

-- Contraintes de FK avec CASCADE DELETE
ALTER TABLE ONLY public.user_follows
    ADD CONSTRAINT user_follows_follower_id_fkey
    FOREIGN KEY (follower_id) REFERENCES public.users(user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_follows
    ADD CONSTRAINT user_follows_following_id_fkey
    FOREIGN KEY (following_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
```

### Colonnes

| Colonne | Type SQL | Type Java | Nullable | Rôle |
|---|---|---|---|---|
| `follower_id` | TEXT NOT NULL | `String` | NON | PK partielle — celui qui suit (me) |
| `following_id` | TEXT NOT NULL | `String` | NON | PK partielle — celui qui est suivi (cible) |
| `created_at` | TIMESTAMPTZ DEFAULT now() | `OffsetDateTime` | OUI | Non lu par les handlers Slice 05 |

### Contraintes importantes

| Contrainte | Type | Colonnes | Impact Slice 05 |
|---|---|---|---|
| `user_follows_pkey` | PRIMARY KEY | `(follower_id, following_id)` | `ON CONFLICT` cible cette PK — garantit l'unicité de la relation |
| `user_follows_follower_id_fkey` | FK CASCADE | `follower_id → users.user_id` | Si un user est supprimé → ses follows sont supprimés automatiquement |
| `user_follows_following_id_fkey` | FK CASCADE | `following_id → users.user_id` | Si un user est supprimé → il est retiré des listes de follows |

---

## Requêtes SQL exécutées

### R1 — Vérification existence cible (follow uniquement)

```sql
SELECT user_id FROM users WHERE user_id = $1
```
*Paramètre : `user_id` cible | Source : `user_routes.py:501`*

- `fetchval` → retourne la valeur scalaire ou `None` si absent
- Si `None` → HTTPException 404

**Absent dans unfollow** (voir P1 dans SCOPE).

---

### R2 — INSERT follow (idempotent)

```sql
INSERT INTO user_follows(follower_id, following_id)
VALUES($1, $2)
ON CONFLICT DO NOTHING
```
*Paramètres : `me["user_id"]`, `user_id` cible | Source : `user_routes.py:504–506`*

- `ON CONFLICT DO NOTHING` cible la PK `(follower_id, following_id)`
- 1 row inserted si nouvelle relation
- 0 rows inserted si relation déjà existante (pas d'erreur)
- `created_at` rempli automatiquement par `DEFAULT now()`

**En Java :**
```java
// Option 1 — JDBC natif (le plus fidèle)
@Modifying
@Query(value = """
    INSERT INTO user_follows(follower_id, following_id)
    VALUES(:followerId, :followingId)
    ON CONFLICT DO NOTHING
    """, nativeQuery = true)
void followUser(@Param("followerId") String followerId,
                @Param("followingId") String followingId);

// Option 2 — try/catch sur DataIntegrityViolationException (moins propre)
// À ÉVITER : ON CONFLICT DO NOTHING est plus propre et plus performant
```

---

### R3 — DELETE unfollow

```sql
DELETE FROM user_follows
WHERE follower_id = $1 AND following_id = $2
```
*Paramètres : `me["user_id"]`, `user_id` cible | Source : `user_routes.py:517–519`*

- Supprime 0 ou 1 ligne
- Pas d'erreur si 0 lignes supprimées
- Pas de vérification préalable d'existence

**En Java :**
```java
@Modifying
@Query(value = """
    DELETE FROM user_follows
    WHERE follower_id = :followerId AND following_id = :followingId
    """, nativeQuery = true)
int unfollowUser(@Param("followerId") String followerId,
                 @Param("followingId") String followingId);
// retourner int = nombre de lignes affectées (0 ou 1)
```

---

### R4 — COUNT followers (après mutation, les deux endpoints)

```sql
SELECT COUNT(*) FROM user_follows WHERE following_id = $1
```
*Paramètre : `user_id` cible | Source : `user_routes.py:508` et `user_routes.py:521`*

- `fetchval` → retourne un entier (jamais null — COUNT retourne 0 si vide)
- Exécuté dans la **même connexion** que R2 ou R3 (même `async with pool.acquire()`)
- Résultat → `followers_count` dans la réponse

---

## Table secondaire : `users` (lecture seule, follow uniquement)

```sql
SELECT user_id FROM users WHERE user_id = $1
```
Uniquement pour la vérification d'existence de la cible dans `follow_user`.
Aucune modification de la table `users` dans cette slice.

---

## Flux complet

### POST /follow

```
[Request]
    │
    ├── require_auth → me["user_id"]
    │
    ├── self-follow check: me["user_id"] == user_id → 400
    │
    └── [Connexion DB]
            ├── R1: SELECT user_id FROM users WHERE user_id=$1
            │     └── None → 404
            │
            ├── R2: INSERT INTO user_follows ON CONFLICT DO NOTHING
            │
            └── R4: SELECT COUNT(*) FROM user_follows WHERE following_id=$1
                      └── return {"is_following": true, "followers_count": N}
```

### DELETE /follow

```
[Request]
    │
    ├── require_auth → me["user_id"]
    │
    └── [Connexion DB]
            ├── R3: DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2
            │         (0 ou 1 ligne supprimée, pas d'erreur)
            │
            └── R4: SELECT COUNT(*) FROM user_follows WHERE following_id=$1
                      └── return {"is_following": false, "followers_count": N}
```
