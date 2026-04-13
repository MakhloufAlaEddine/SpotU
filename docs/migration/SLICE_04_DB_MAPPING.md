# SLICE_04_DB_MAPPING.md — Mapping base de données
> Basé sur `user_routes.py:99–235`.
> Généré le 2026-02-XX.

---

## Vue d'ensemble : 11 requêtes sur 8 tables

| # | Requête | Table | Type | Lignes Python |
|---|---|---|---|---|
| Q1 | SELECT 13 cols profil public | `users` | fetchrow | 110–115 |
| Q2 | COUNT followers | `user_follows` | fetchval | 125–127 |
| Q3 | COUNT following | `user_follows` | fetchval | 128–130 |
| Q4 | EXISTS is_following (conditionnel) | `user_follows` | fetchval | 136–139 |
| Q5 | SELECT tag details (conditionnel) | `tags` | fetch | 153–156 |
| Q6 | SELECT ratings (conditionnel show_reviews) | `reviews` | fetch | 163–165 |
| Q7 | SELECT services (conditionnel role=coach) | `services` | fetch | 178–181 |
| Q8 | SELECT tag_points actifs (max 20) | `tag_points` | fetch | 185–192 |
| Q9 | Batch COUNT participants | `spot_you_members` | fetch | 199–203 |
| Q10 | Batch COUNT going | `spot_you_attendance` | fetch | 206–210 |
| Q11 | Batch AVG+COUNT votes | `tag_point_votes` | fetch | 213–217 |

**Q2–Q11 sont toutes exécutées dans le même `async with pool.acquire() as conn`** (même connexion).
**Q4, Q5, Q6, Q7 sont conditionnelles** — peuvent ne pas s'exécuter.
**Q9, Q10, Q11 ne s'exécutent que si Q8 retourne au moins 1 tag_point.**

---

## Détail des requêtes SQL

### Q1 — Profil public (toujours exécutée)

```sql
SELECT user_id, name, picture, cover_picture, cover_offset_y, cover_scale,
       role, bio, is_coach_verified, coach_tags,
       show_phone, show_reviews, phone
FROM users
WHERE user_id = $1
```

*Source : `user_routes.py:110–115`*

| Colonne | Type SQL | Type Java | Nullable | Note |
|---|---|---|---|---|
| `user_id` | TEXT | `String` | NON | PK logique |
| `name` | TEXT | `String` | NON | |
| `picture` | TEXT | `String` | OUI | URL |
| `cover_picture` | TEXT | `String` | OUI | URL ou null |
| `cover_offset_y` | FLOAT8 | `Double` | OUI | Positionnement Y cover |
| `cover_scale` | FLOAT8 | `Double` | OUI | Zoom cover |
| `role` | TEXT | `String` | OUI | enum: user/coach/admin |
| `bio` | TEXT | `String` | OUI | |
| `is_coach_verified` | BOOLEAN | `Boolean` | OUI | |
| `coach_tags` | JSONB | `List<String>` | OUI | Peut arriver en string (voir P3) |
| `show_phone` | BOOLEAN | `boolean` | NON | Flag de contrôle ET exposé |
| `show_reviews` | BOOLEAN | `boolean` | NON | Flag de contrôle ET exposé |
| `phone` | TEXT | `String` | OUI | Masqué applicativement si show_phone=false |

**Différence importante vs USER_FIELDS (Slice 02/03) :**
- Absent ici : `email`, `language`, `sports_level`, `goals`, `user_roles`, `onboarding_done`, `updated_at`, `created_at`
- Présent ici (absent de USER_FIELDS) : `cover_picture`, `cover_offset_y`, `cover_scale`, `show_phone` (inclus ici)

---

### Q2 — Nombre d'abonnés (toujours exécutée)

```sql
SELECT COUNT(*) FROM user_follows WHERE following_id = $1
```
*Paramètre : `user_id` cible | Source : `user_routes.py:125–127`*

Résultat → `user["followers_count"] = int(followers_count or 0)`

---

### Q3 — Nombre d'abonnements (toujours exécutée)

```sql
SELECT COUNT(*) FROM user_follows WHERE follower_id = $1
```
*Paramètre : `user_id` cible | Source : `user_routes.py:128–130`*

Résultat → `user["following_count"] = int(following_count or 0)`

---

### Q4 — is_following (conditionnel)

```python
# user_routes.py:135–142
if me_id and me_id != user_id:
    is_following = await conn.fetchval(
        "SELECT EXISTS(SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=$2)",
        me_id, user_id
    )
    user["is_following"] = bool(is_following)
else:
    user["is_following"] = False
```

**Condition d'exécution :** `me_id IS NOT NULL` ET `me_id != user_id` (l'utilisateur consulte un profil différent du sien).

| Cas | is_following |
|---|---|
| Non authentifié (me_id=null) | `false` |
| Consulte son propre profil (me_id == user_id) | `false` |
| Authentifié, consulte un autre profil | `EXISTS(...)` — `true` ou `false` |

---

### Q5 — Détails des tags (conditionnel)

```sql
SELECT tag_id, label_fr, label_en, icon
FROM tags
WHERE tag_id = ANY($1::text[])
```
*Paramètre : tableau de tag_ids extrait de `coach_tags` | Source : `user_routes.py:153–156`*

**Condition :** `tag_ids` est non vide (après JSONB double-parse protection).

**JSONB double-parse protection (pattern Python spécifique) :**
```python
# user_routes.py:145–151
tag_ids = user.get("coach_tags") or []
if isinstance(tag_ids, str):
    try:
        tag_ids = _j.loads(tag_ids)
    except Exception:
        tag_ids = []
```

En DB legacy, `coach_tags` peut arriver déjà sérialisé en string JSON (`"[\"tag_id1\"]"`) au lieu de liste Python directement. Hypersistence Utils en Java gère normalement ce cas, mais vérifier.

---

### Q6 — Notes (conditionnel show_reviews)

```sql
SELECT rating FROM reviews WHERE reviewee_id = $1
```
*Paramètre : `user_id` cible | Source : `user_routes.py:163–165`*

**Condition :** `user.get("show_reviews") == True`

**Si show_reviews = False :** Q6 non exécutée. `avg_rating = null`, `review_count = 0`.

Calcul Python :
```python
if all_reviews:
    user["avg_rating"] = round(sum(r["rating"] for r in all_reviews) / len(all_reviews), 1)
    user["review_count"] = len(all_reviews)
else:
    user["avg_rating"] = None
    user["review_count"] = 0
```

---

### Q7 — Services actifs (conditionnel role=coach)

```sql
SELECT service_id, title, description, price, duration_min, location_description,
       max_participants, tag_ids, domain_id, images
FROM services
WHERE coach_id = $1 AND active = TRUE
```
*Paramètre : `user_id` cible | Source : `user_routes.py:178–181`*

**Condition :** `user.get("role") == "coach"`
**Pas de filtre sur `deleted_at`** (colonne non dans le SELECT et non filtrée).

---

### Q8 — Tag points actifs, max 20 (toujours exécutée)

```sql
SELECT point_id, title, images, event_date, event_schedule, domain_id, tag_ids,
       minimum_participants, maximum_participants
FROM tag_points
WHERE user_id = $1 AND active = TRUE
ORDER BY created_at DESC
LIMIT 20
```
*Paramètre : `user_id` cible | Source : `user_routes.py:185–192`*

Retourne les 20 derniers SpotYou actifs créés par le profil cible.

---

### Q9 — Participants par SpotYou (batch, conditionnel si Q8 non vide)

```sql
SELECT spot_you_id, COUNT(*) as cnt
FROM spot_you_members
WHERE spot_you_id = ANY($1::text[])
GROUP BY spot_you_id
```
*Paramètre : tableau des `point_id` de Q8 | Source : `user_routes.py:199–203`*

**Pas de filtre sur le statut** (tous les membres sont comptés, pas seulement 'accepted').
Résultat → map `spot_you_id → participants_count`, default `0`.

---

### Q10 — Participants "going" par SpotYou (batch)

```sql
SELECT spot_you_id, COUNT(*) as cnt
FROM spot_you_attendance
WHERE spot_you_id = ANY($1::text[]) AND status = 'going'
GROUP BY spot_you_id
```
*Source : `user_routes.py:206–210`*

Résultat → map `spot_you_id → going_count`, default `0`.

---

### Q11 — Votes/ratings par SpotYou (batch)

```sql
SELECT point_id,
       ROUND(AVG(rating)::numeric, 1) AS avg_r,
       COUNT(*) AS vcnt
FROM tag_point_votes
WHERE point_id = ANY($1::text[])
GROUP BY point_id
```
*Source : `user_routes.py:213–217`*

Résultat → map `point_id → (avg_rating: float, vote_count: int)`, default `(0, 0)` si absent.

**Note :** L'arrondi `ROUND(AVG(rating)::numeric, 1)` est fait **en SQL** (PostgreSQL), contrairement aux reviews du profil privé (arrondi Python). En Java, cette requête suffit — pas d'arrondi applicatif.

---

## Schéma de flux complet

```
[Request GET /api/users/{user_id}/public]
    │
    ├── [Optional Auth] try require_auth → me_id ou null
    │
    └── [Connexion DB unique]
            │
            ├── Q1: SELECT 13 cols FROM users WHERE user_id=$1
            │     └─ 404 si absent
            │
            ├── Q2: COUNT followers  → followers_count
            ├── Q3: COUNT following  → following_count
            │
            ├── Q4 [si me_id ET me_id≠user_id]: EXISTS(user_follows) → is_following
            │    └── sinon: is_following = false
            │
            ├── Q5 [si coach_tags non vide]: SELECT tags → interests[]
            │    └── sinon: interests = []
            │
            ├── Q6 [si show_reviews=true]: SELECT rating FROM reviews
            │    ├── si reviews: avg_rating calculé, review_count > 0
            │    └── si vide: avg_rating=null, review_count=0
            │    [si show_reviews=false]: avg_rating=null, review_count=0 (Q6 non exécutée)
            │
            ├── Q7 [si role='coach']: SELECT services → services[]
            │    └── sinon: clé 'services' ABSENTE de la réponse
            │
            └── Q8: SELECT tag_points LIMIT 20 → tag_points[]
                     │
                     └─ [si au moins 1 tag_point]
                             ├── Q9: batch COUNT spot_you_members → participants_count
                             ├── Q10: batch COUNT going attendance → going_count
                             ├── Q11: batch AVG+COUNT votes → rating, vote_count
                             └── get_next_session_date(tp) → next_session_date (tz Paris)
                                 is_full = max_participants != null AND going_count >= max_participants
```
