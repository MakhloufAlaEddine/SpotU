# SLICE_08_DB_MAPPING.md — Mapping base de données
> Basé sur `user_routes.py:238–259`, `migrations/001_initial_schema.sql:263–276`, `database.py:53–69`.
> Généré le 2026-02-XX.

---

## Tables utilisées

| Table | Opération | Rôle |
|---|---|---|
| `users` | SELECT fetchrow | Vérification existence + flag `show_reviews` |
| `reviews` | SELECT fetch (JOIN) | Source des reviews |
| `users` | JOIN dans la requête reviews | Récupération auteur (reviewer) |

---

## Schéma `reviews`

```sql
-- migrations/001_initial_schema.sql:266–276
CREATE TABLE public.reviews (
    review_id    text NOT NULL,
    booking_id   text,                    -- nullable — FK bookings
    reviewer_id  text,                    -- FK users (auteur)
    reviewee_id  text,                    -- FK users (cible)
    rating       integer,                 -- CHECK (rating >= 1 AND rating <= 5)
    comment      text,                    -- nullable
    created_at   timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (review_id);

CREATE INDEX idx_reviews_reviewee_id ON public.reviews USING btree (reviewee_id);
CREATE INDEX idx_reviews_reviewer_id ON public.reviews USING btree (reviewer_id);

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_booking_id_fkey
    FOREIGN KEY (booking_id) REFERENCES public.bookings(booking_id);

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_reviewee_id_fkey
    FOREIGN KEY (reviewee_id) REFERENCES public.users(user_id);

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES public.users(user_id);
```

### Colonnes de `reviews`

| Colonne | Type SQL | Type Java | Nullable | Exposé dans ce endpoint |
|---|---|---|---|---|
| `review_id` | TEXT | `String` | NON | **OUI** |
| `booking_id` | TEXT | `String` | **OUI** | **NON** — absent du SELECT |
| `reviewer_id` | TEXT | `String` | OUI | **OUI** (alias dans réponse) |
| `reviewee_id` | TEXT | `String` | OUI | **NON** — condition WHERE uniquement |
| `rating` | INTEGER | `int` | OUI | **OUI** |
| `comment` | TEXT | `String` | **OUI** | **OUI** |
| `created_at` | TIMESTAMPTZ | `String` (ISO) | OUI | **OUI** |

**`booking_id` : présent en DB, intentionnellement absent du SELECT.**
Ne pas l'ajouter à la réponse — comportement Python volontaire.

---

## Requêtes SQL exactes

### R1 — Vérification existence + privacy flag

```sql
SELECT show_reviews FROM users WHERE user_id = $1
```
*`fetchrow` — Source : `user_routes.py:242–244`*

- Retourne `None` → HTTP 404
- Retourne ligne avec `show_reviews=false` → retourner `[]` immédiatement (R2 non exécutée)
- Retourne ligne avec `show_reviews=true` → continuer vers R2

---

### R2 — Liste des reviews (si show_reviews=true)

```sql
SELECT r.review_id,
       r.rating,
       r.comment,
       r.created_at,
       u.user_id  AS reviewer_id,
       u.name     AS reviewer_name,
       u.picture  AS reviewer_picture
FROM reviews r
JOIN users u ON u.user_id = r.reviewer_id
WHERE r.reviewee_id = $1
ORDER BY r.created_at DESC
```
*`fetch` (multi-row) — Source : `user_routes.py:250–258`*

| Paramètre | Valeur |
|---|---|
| `$1` | `user_id` (profil consulté) |

**Note :** `JOIN users u` est un INNER JOIN. Si un reviewer a été supprimé de la table `users`
(suppression applicative sans CASCADE ?), sa review disparaîtrait des résultats — comportement
lié à la FK + index `idx_reviews_reviewee_id`.

---

## Mapping colonnes → réponse JSON

| Colonne SQL | Alias SQL | Champ JSON | Type |
|---|---|---|---|
| `r.review_id` | — | `review_id` | string |
| `r.rating` | — | `rating` | int |
| `r.comment` | — | `comment` | string\|null |
| `r.created_at` | — | `created_at` | string ISO 8601 tz |
| `u.user_id` | `reviewer_id` | `reviewer_id` | string |
| `u.name` | `reviewer_name` | `reviewer_name` | string |
| `u.picture` | `reviewer_picture` | `reviewer_picture` | string\|null |

---

## Sérialisation `rows_to_list` (database.py:68)

```python
def rows_to_list(rows) -> list:
    return [row_to_dict(row) for row in rows]

def row_to_dict(row) -> dict:
    for key, val in dict(row).items():
        if isinstance(val, Decimal):   result[key] = float(val)
        elif hasattr(val, 'isoformat'): result[key] = val.isoformat()
        else:                           result[key] = val
```

- `created_at` TIMESTAMPTZ → `.isoformat()` → `"2026-04-10T14:30:00.000000+00:00"`
- `rating` INTEGER → pas de conversion (entier direct)
- `comment` TEXT → string Python ou `None`

**En Java :** `created_at` doit être sérialisé via Jackson avec timezone (`OffsetDateTime` ou `ZonedDateTime`).
Le format exact doit inclure le `+00:00` en fin de chaîne — utiliser `ISO_OFFSET_DATE_TIME`.

---

## Flux complet

```
[Request GET /api/users/{user_id}/reviews]
    │
    ├── [Connexion DB]
    │       │
    │       ├── R1: SELECT show_reviews FROM users WHERE user_id=$1
    │       │       ├── None → HTTP 404 "User not found"
    │       │       └── show_reviews=false → return []  (R2 non exécutée)
    │       │
    │       └── R2: SELECT r.review_id, r.rating, r.comment, r.created_at,
    │                      u.user_id AS reviewer_id, u.name AS reviewer_name,
    │                      u.picture AS reviewer_picture
    │               FROM reviews r
    │               JOIN users u ON u.user_id = r.reviewer_id
    │               WHERE r.reviewee_id = $1
    │               ORDER BY r.created_at DESC
    │
    └── return rows_to_list(reviews)  →  [{...}, {...}]  ou  []
```
