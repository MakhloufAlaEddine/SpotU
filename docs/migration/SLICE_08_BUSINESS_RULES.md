# SLICE_08_BUSINESS_RULES.md — Règles métier
> Basé sur `user_routes.py:238–259`, `database.py:53–65`.
> Généré le 2026-02-XX.

---

## RG-01 — Aucune authentification

**Source :** Absence totale de `require_auth` ou `get_optional_auth` dans le handler

Le handler `get_user_reviews` ne lit aucun token, n'inspecte pas les headers, ne lit pas les cookies.
L'endpoint est entièrement public.

**En Java :** `.requestMatchers(HttpMethod.GET, "/api/users/*/reviews").permitAll()`

---

## RG-02 — 404 si user_id inexistant

**Source :** `user_routes.py:244–246`

```python
row = await conn.fetchrow("SELECT show_reviews FROM users WHERE user_id = $1", user_id)
if not row:
    raise HTTPException(status_code=404, detail="User not found")
```

- La première requête vérifie l'existence du user
- Si absent → HTTP 404, `{"detail": "User not found"}`

---

## RG-03 — Privacy gate : show_reviews=false → [] (pas 403)

**Source :** `user_routes.py:247–249`

```python
if not row["show_reviews"]:
    return []
```

- Si `show_reviews=false` → HTTP 200 + `[]`
- **Pas de 403**, pas de 404, pas de message d'erreur
- Le frontend ne peut pas distinguer "reviews cachées" de "aucune review"

**Cohérence avec Slice 04 :** Dans le profil public, `avg_rating=null` et `review_count=0`
quand `show_reviews=false`. Dans ce endpoint, retour `[]`. Comportement cohérent.

**Ne PAS ajouter de 403.** Le Python choisit délibérément de retourner une liste vide.

---

## RG-04 — Toutes les reviews retournées (pas de filtre booking_id)

**Source :** `user_routes.py:250–258`

La requête SQL ne filtre pas sur `booking_id`. Toutes les reviews sont retournées :
- Reviews directes (`booking_id IS NULL`)
- Reviews liées à une réservation (`booking_id NOT NULL`)

**En Java :** Ne pas ajouter de filtre `WHERE booking_id IS NULL` — inclure toutes les reviews.

---

## RG-05 — Tri par date décroissante (plus récent en premier)

**Source :** `ORDER BY r.created_at DESC` — `user_routes.py:256`

Toujours triées par `r.created_at DESC`. Tri imposé par SQL, pas applicativement.

---

## RG-06 — Pas de pagination

**Source :** Absence de `LIMIT` / `OFFSET` dans la requête SQL

Toute la liste est retournée sans limit. Même comportement que Slice 06 (followers/following).

---

## RG-07 — Sérialisation datetime : ISO 8601 avec timezone

**Source :** `database.py:61–62` (`row_to_dict`)

`created_at` TIMESTAMPTZ est converti via `.isoformat()`.
Format résultant : `"2026-04-10T14:30:00.000000+00:00"` (précision microseconde + timezone UTC).

**En Java :** `OffsetDateTime` sérialisé avec Jackson `ISO_OFFSET_DATE_TIME`.
Si Java retourne `"2026-04-10T14:30:00Z"` au lieu de `"2026-04-10T14:30:00+00:00"`,
noter l'écart — les deux sont ISO 8601 valides mais le format Python utilise `+00:00`.

---

## Cohérence avec Slices 03 et 04

| Endpoint | Données reviews | Condition |
|---|---|---|
| Slice 03 `GET /api/users/me` | `avg_rating` + `review_count` | **Toujours** calculés |
| Slice 04 `GET /api/users/{id}/public` | `avg_rating` + `review_count` | **Conditionnel** `show_reviews` |
| Slice 08 `GET /api/users/{id}/reviews` | Liste détaillée 7 champs | **Conditionnel** `show_reviews` → `[]` |

**Cohérence attendue :**
- Si `show_reviews=true` et N reviews → Slice 04 `review_count=N`, Slice 08 retourne N objets
- Si `show_reviews=false` → Slice 04 `review_count=0`, Slice 08 retourne `[]`
- Si `show_reviews=true` et 0 reviews → Slice 04 `avg_rating=null`, `review_count=0`, Slice 08 retourne `[]`

---

## RG-08 — `comment` nullable

**Source :** `reviews.comment TEXT` (pas de NOT NULL) + sérialisation `row_to_dict`

`comment` peut être `null` en DB. `row_to_dict` retourne `null` directement (pas de conversion).
Le frontend doit gérer `comment = null`.

---

## Niveau de confiance

| Règle | Confiance | Source |
|---|---|---|
| RG-01 Aucune auth | HAUTE | Absence totale dans le handler |
| RG-02 404 user inexistant | HAUTE | Code explicite lignes 244–246 |
| RG-03 show_reviews=false → [] | HAUTE | Code explicite lignes 247–249 |
| RG-04 Pas de filtre booking_id | HAUTE | SELECT complet vérifié |
| RG-05 Tri DESC | HAUTE | ORDER BY explicite ligne 256 |
| RG-06 Pas de pagination | HAUTE | Absence de LIMIT/OFFSET |
| RG-07 ISO 8601 tz | HAUTE | `row_to_dict` lu ligne par ligne |
