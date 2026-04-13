# SLICE_03_BUSINESS_RULES.md — Règles métier
> Basé sur `user_routes.py:11–30`, `auth_utils.py:71–83`.
> Généré le 2026-02-XX.

---

## Règles métier de `GET /api/users/profile`

### RG-01 — Authentification obligatoire

**Source :** `user_routes.py:14` → `require_auth(request, pool)` → `auth_utils.py:71–83`

- Le token JWT est lu depuis `Authorization: Bearer <token>` en priorité,
  puis depuis le cookie `winek_token` en fallback.
- Si aucun token n'est présent → **401 Not authenticated**
- Si le token est invalide / expiré → **401 Invalid token / Token expired**
- Si le `user_id` du payload n'existe pas en DB → **401 User not found**

**En Java :** Le filtre `JwtAuthFilter` (Slice 02) gère cette règle en amont.
Ne pas redupliquer la logique dans le controller.

---

### RG-02 — Retourner UNIQUEMENT les données de l'utilisateur connecté

**Source :** `user_routes.py:14` — `user = await require_auth(request, pool)`

L'utilisateur retourné est **toujours** celui dont le `user_id` est encodé dans le JWT.
Il n'y a pas de paramètre `user_id` dans la route — c'est volontairement le "me".

**Ne PAS permettre** de fetcher le profil d'un autre utilisateur via cet endpoint
(c'est le rôle de `GET /api/users/{user_id}/public`).

---

### RG-03 — Calcul de avg_rating

**Source :** `user_routes.py:20–25`

```python
if reviews:
    user["avg_rating"] = round(sum(r["rating"] for r in reviews) / len(reviews), 1)
    user["review_count"] = len(reviews)
else:
    user["avg_rating"] = None
    user["review_count"] = 0
```

| Cas | avg_rating | review_count |
|---|---|---|
| 0 review | `null` (pas `0.0`) | `0` |
| ≥ 1 review | float arrondi à **1 décimale** | nombre entier de reviews |

**Exemples :**
- Ratings [5, 4, 4, 3] → `avg_rating = 4.0`, `review_count = 4`
- Ratings [5] → `avg_rating = 5.0`, `review_count = 1`
- Ratings [] → `avg_rating = null`, `review_count = 0`

**Règle critique :** `avg_rating = null` ≠ `avg_rating = 0`. Le frontend fait la différence
(affiche "Pas encore noté" vs "0/5"). Ne pas remplacer `null` par `0` côté Java.

**Arrondi :** Python `round(x, 1)` = arrondi classique à 1 décimale (0.5 → vers le haut).
Java : `Math.round(avg * 10.0) / 10.0` ou `BigDecimal.valueOf(avg).setScale(1, RoundingMode.HALF_UP)`.

---

### RG-04 — Données bancaires toujours exposées (pas de filtre de rôle)

**Source :** `user_routes.py:26–29`

```python
if banking:
    user["iban"] = banking["iban"]
    user["bic"] = banking["bic"]
    user["iban_name"] = banking["iban_name"]
```

- `iban`, `bic`, `iban_name` sont exposés **quel que soit le rôle** (`user`, `coach`, `admin`).
- Ces champs sont confidentiels : ils ne doivent apparaître que dans ce endpoint "privé" (profil personnel).
- Ils sont **absents** de `GET /api/auth/me` et de `GET /api/users/{user_id}/public`.
- En Java : les inclure dans `UserProfileDto` mais PAS dans `AuthMeDto`.

**Valeurs possibles :** null (si non renseigné) ou string (pas de validation de format).

---

### RG-05 — Aucun filtre sur `deleted_at` / `disabled` / `banned`

**Source :** `auth_utils.py:76–83` (code complet de `require_auth`)

```python
row = await conn.fetchrow(
    f"SELECT {USER_FIELDS} FROM users WHERE user_id = $1",
    payload["user_id"]
)
if not row:
    raise HTTPException(status_code=401, detail="User not found")
return row_to_dict(row)
```

Il n'y a **aucune vérification** de `deleted_at`, `banned_until`, `deactivated_at`, etc.
Si le `user_id` existe en DB → l'utilisateur est authentifié et son profil est retourné.

**En Java v1 :** Ne PAS ajouter cette vérification. Reproduire exactement le comportement Python.
La cohérence avec les tokens en circulation l'exige.

---

### RG-06 — Sérialisation datetime

**Source :** `database.py:53–65` (`row_to_dict`)

```python
def row_to_dict(row) -> dict:
    result = {}
    for key, val in dict(row).items():
        if isinstance(val, Decimal):
            result[key] = float(val)
        elif hasattr(val, 'isoformat'):
            result[key] = val.isoformat()
        else:
            result[key] = val
    return result
```

- `created_at` et `updated_at` (TIMESTAMPTZ) sont convertis via `.isoformat()`.
- Format résultant : `"2026-04-01T12:51:14.682000+00:00"` (timezone UTC incluse).
- En Java : utiliser `OffsetDateTime` ou `ZonedDateTime`, serialiser en ISO 8601 avec timezone.
  **Ne pas utiliser `LocalDateTime`** (perte du fuseau horaire).

---

### RG-07 — JSONB : coach_tags, goals, user_roles

**Source :** `database.py:74–81` (codec asyncpg) + `auth_utils.py:68`

- `coach_tags` : JSONB → décodé automatiquement en liste Python `["tag_id1", "tag_id2"]`
- `goals` : JSONB → décodé automatiquement en liste d'objets (ou `[]`)
- `user_roles` : JSONB → décodé automatiquement en liste d'objets (ou `[]`)

**En Java :** utiliser Hypersistence Utils (`io.hypersistence:hypersistence-utils-hibernate-63`)
avec `@Type(JsonType.class)` sur les colonnes JSONB. Voir SLICE_02_CURSOR_IMPLEMENTATION_NOTES.md.

---

## Différences vs Slice 02 (`GET /api/auth/me`)

| Règle | Slice 02 | Slice 03 |
|---|---|---|
| Auth | Identique (`require_auth`) | Identique (`require_auth`) |
| Champs retournés | 18 (USER_FIELDS) | 23 (USER_FIELDS + 5) |
| avg_rating | Absent | Calculé depuis `reviews` |
| Données bancaires | Absentes | Exposées (iban/bic/iban_name) |
| Requêtes DB | 1 | 3 |
| Filtre deleted_at | NON | NON (identique) |
| Sérialisation datetime | row_to_dict | row_to_dict (identique) |

---

## Niveau de confiance

| Règle | Confiance | Source de vérification |
|---|---|---|
| RG-01 Auth | **HAUTE** | Code source `require_auth` lu directement |
| RG-02 User courant uniquement | **HAUTE** | Pas de paramètre dans la route |
| RG-03 avg_rating calcul | **HAUTE** | Code Python explicite, lignes 20–25 |
| RG-04 IBAN exposé sans filtre rôle | **HAUTE** | Code Python explicite, lignes 26–29 |
| RG-05 Pas de filtre deleted_at | **HAUTE** | Code `require_auth` vérifié |
| RG-06 Format datetime ISO | **HAUTE** | `row_to_dict` vérifié |
| RG-07 JSONB auto-décodé | **HAUTE** | Codec asyncpg dans `database.py` |
