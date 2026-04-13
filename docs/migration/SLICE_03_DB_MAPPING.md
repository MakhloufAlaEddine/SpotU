# SLICE_03_DB_MAPPING.md — Mapping base de données
> Basé sur `user_routes.py:11–30`, `auth_utils.py:68`, `database.py`.
> Généré le 2026-02-XX.

---

## Vue d'ensemble

Le handler `get_profile()` exécute **3 requêtes SQL** sur **2 tables** :

| # | Requête | Table | Type | Objectif |
|---|---|---|---|---|
| Q1 | `SELECT {USER_FIELDS} FROM users WHERE user_id = $1` | `users` | SELECT 1 row | 18 colonnes du profil (via `require_auth`) |
| Q2 | `SELECT rating FROM reviews WHERE reviewee_id = $1` | `reviews` | SELECT N rows | Calcul avg_rating + review_count |
| Q3 | `SELECT iban, bic, iban_name FROM users WHERE user_id = $1` | `users` | SELECT 1 row | Données bancaires |

**Note :** Q1 est exécutée implicitement par `require_auth()` (`auth_utils.py:76–83`).
Q2 et Q3 sont exécutées explicitement dans le handler (`user_routes.py:16–29`).

---

## Table : `users`

### Requête Q1 — USER_FIELDS (via `require_auth`)

```python
# auth_utils.py:68
USER_FIELDS = "user_id, email, name, role, language, picture, bio, phone, is_coach_verified, coach_tags, show_phone, show_reviews, created_at, updated_at, sports_level, goals, user_roles, onboarding_done"

# auth_utils.py:77–79
row = await conn.fetchrow(
    f"SELECT {USER_FIELDS} FROM users WHERE user_id = $1",
    payload["user_id"]
)
```

| Colonne SQL | Type SQL | Type Java | Nullable | Note |
|---|---|---|---|---|
| `user_id` | TEXT | `String` | NON | PK logique, format `"user_<hex12>"` |
| `email` | TEXT | `String` | OUI | Unique en DB |
| `name` | TEXT | `String` | NON | Jamais vide (contrainte applicative) |
| `role` | TEXT | `String` | OUI | Enum : `user`, `coach`, `admin` |
| `language` | TEXT | `String` | NON | Default `fr` |
| `picture` | TEXT | `String` | OUI | URL ou null |
| `bio` | TEXT | `String` | OUI | |
| `phone` | TEXT | `String` | OUI | |
| `is_coach_verified` | BOOLEAN | `Boolean` | OUI | Default `false` |
| `coach_tags` | JSONB | `List<String>` | OUI | Array de tag IDs, default `[]` |
| `show_phone` | BOOLEAN | `boolean` | NON | Default `false` |
| `show_reviews` | BOOLEAN | `boolean` | NON | Default `true` |
| `created_at` | TIMESTAMPTZ | `String` (ISO) | OUI | Serialize en ISO 8601 via `row_to_dict` |
| `updated_at` | TIMESTAMPTZ | `String` (ISO) | OUI | Serialize en ISO 8601 via `row_to_dict` |
| `sports_level` | TEXT | `String` | OUI | |
| `goals` | JSONB | `List<Object>` | OUI | Default `[]` |
| `user_roles` | JSONB | `List<Object>` | OUI | Default `[]` |
| `onboarding_done` | BOOLEAN | `Boolean` | OUI | Default `false` |

### Requête Q3 — Données bancaires (requête séparée)

```python
# user_routes.py:17–18
banking = await conn.fetchrow(
    "SELECT iban, bic, iban_name FROM users WHERE user_id = $1", user["user_id"]
)
```

| Colonne SQL | Type SQL | Type Java | Nullable | Note |
|---|---|---|---|---|
| `iban` | TEXT | `String` | **OUI** | Null si non renseigné |
| `bic` | TEXT | `String` | **OUI** | Null si non renseigné |
| `iban_name` | TEXT | `String` | **OUI** | Null si non renseigné |

**Pourquoi une 2ème requête sur `users` ?**
Ces colonnes sont intentionnellement **absentes de `USER_FIELDS`** (pour ne pas les exposer dans `/api/auth/me`). Le handler les fetch séparément. En Java, optimiser en une seule requête enrichie est possible, mais respecter le comportement Python est plus sûr.

---

## Table : `reviews`

### Requête Q2 — Notes

```python
# user_routes.py:16
reviews = await conn.fetch(
    "SELECT rating FROM reviews WHERE reviewee_id = $1", user["user_id"]
)
```

| Colonne SQL | Type SQL | Usage | Note |
|---|---|---|---|
| `rating` | NUMERIC (ou INT) | Calcul avg + count | Seule colonne lue |
| `reviewee_id` | TEXT | Filtre WHERE | FK vers `users.user_id` |

**Pas de filtre supplémentaire** : toutes les reviews de l'utilisateur sont récupérées, sans filtre sur `booking_id`, date ou statut.

---

## Calculs applicatifs (Python → Java)

### avg_rating

```python
# user_routes.py:20–25
if reviews:
    user["avg_rating"] = round(sum(r["rating"] for r in reviews) / len(reviews), 1)
    user["review_count"] = len(reviews)
else:
    user["avg_rating"] = None
    user["review_count"] = 0
```

| Cas | `avg_rating` | `review_count` |
|---|---|---|
| Aucune review | `null` | `0` |
| 1 review ou plus | `round(sum/count, 1)` — float | `count` — int |

**En Java :**
```java
if (reviews.isEmpty()) {
    dto.setAvgRating(null);
    dto.setReviewCount(0);
} else {
    double avg = reviews.stream()
        .mapToInt(Review::getRating)
        .average()
        .orElse(0.0);
    dto.setAvgRating(Math.round(avg * 10.0) / 10.0);
    dto.setReviewCount(reviews.size());
}
```

### Données bancaires

```python
# user_routes.py:26–29
if banking:
    user["iban"] = banking["iban"]
    user["bic"] = banking["bic"]
    user["iban_name"] = banking["iban_name"]
```

**Note :** Le code Python n'ajoute les champs IBAN que si `banking` n'est pas null (user trouvé en DB). En pratique, si Q1 a réussi, Q3 réussira toujours (même `user_id`). En Java, les 3 champs sont donc toujours présents dans la réponse, mais peuvent être `null`.

---

## Connexion et pool

| Aspect | Python | Java |
|---|---|---|
| Pool | `asyncpg.Pool` (`database.py:130`) | HikariCP (JDBC) |
| Transactions | Aucune transaction explicite dans ce handler | Pas de `@Transactional` requis (lecture seule) |
| Même connexion pour Q2+Q3 | OUI (`async with pool.acquire() as conn`) | Une seule connexion depuis le pool suffit |
| SSL | CA cert Supabase (voir `database.py:86–108`) | Truststore JDBC avec même CA cert |

---

## Schéma de mapping complet

```
[Request]
    │
    ▼
require_auth(request, pool)
    │  ► Décode JWT → user_id
    │  ► SELECT USER_FIELDS FROM users WHERE user_id = $1  (Q1)
    │  ► Retourne dict de 18 champs
    ▼
user = {18 champs USER_FIELDS}
    │
    ├── Q2: SELECT rating FROM reviews WHERE reviewee_id = $1
    │       → avg_rating (null ou float arrondi à 1 décimale)
    │       → review_count (int, jamais null)
    │
    └── Q3: SELECT iban, bic, iban_name FROM users WHERE user_id = $1
            → iban (null ou string)
            → bic  (null ou string)
            → iban_name (null ou string)
    │
    ▼
return user (23 champs)
```
