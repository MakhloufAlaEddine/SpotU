# SLICE_02_BUSINESS_RULES.md — Règles métier exactes
> Basé sur `auth_utils.py` (complet) + réponse API live.  
> Généré le 2026-04-12.

---

## Règles pour GET /api/auth/me

---

### BR-01 — Ordre de lecture du token

**Source** : `auth_utils.py:61-65`  
**Niveau de confiance** : CERTAIN  

```python
auth = request.headers.get("Authorization", "")
if auth.startswith("Bearer "):
    return auth[7:]
return request.cookies.get("winek_token")
```

**Règle** : Header `Authorization` est lu en premier. Le cookie `winek_token` n'est utilisé que si le header est absent ou ne commence pas par `"Bearer "`.

**Cas limites** :
- Header `Authorization: basic xyz` → non reconnu → fallback cookie
- Header `Authorization: bearer xyz` (minuscule) → non reconnu → fallback cookie (`startswith` case-sensitive)
- Header `Authorization: Bearer ` (espace final, token vide) → retourne `""` → `decode_jwt("")` → 401 "Invalid token"

---

### BR-02 — Validation JWT — algorithme et secret

**Source** : `auth_utils.py:41-58`  
**Niveau de confiance** : CERTAIN  

- Algorithme accepté : **HS256 uniquement** (`algorithms=["HS256"]`)
- Si algorithme différent dans le header JWT → `InvalidAlgorithmError` → 401 "Invalid token algorithm"
- Secret : variable d'env `JWT_SECRET` (chaîne hexadécimale 64 chars recommandée)
- Le JWT_SECRET est chargé **au démarrage** du serveur. Si absent → `RuntimeError` (crash du serveur)

---

### BR-03 — Claims JWT requis

**Source** : `auth_utils.py:47`, `options={"require": ["exp", "user_id"]}`  
**Niveau de confiance** : CERTAIN  

| Claim | Requis | Type | Usage |
|---|---|---|---|
| `user_id` | **OUI** | string | Clé de lookup en DB |
| `exp` | **OUI** | int (Unix timestamp) | Vérification expiration |
| `role` | NON | string | Présent dans le token mais ignoré par `require_auth` |
| `iat` | NON | absent | Python ne génère pas `iat` |
| `sub` | NON | absent | Pas utilisé |

Token sans `user_id` ou sans `exp` → `MissingRequiredClaimError` (sous-classe `InvalidTokenError`) → 401 "Invalid token".

---

### BR-04 — TTL et expiration

**Source** : `auth_utils.py:17`, `auth_utils.py:36`  
**Niveau de confiance** : CERTAIN  

```python
JWT_EXPIRE_DAYS = 7
"exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
```

- Durée de vie : **7 jours** à partir du moment de création
- Après expiration : `ExpiredSignatureError` → 401 "Token expired"
- **Pas de refresh token** : une fois expiré, l'utilisateur doit se reconnecter
- La vérification d'expiration est **automatique** dans PyJWT (et dans toutes les bibliothèques JWT standards)

---

### BR-05 — Lookup DB : user_id uniquement

**Source** : `auth_utils.py:77-79`  
**Niveau de confiance** : CERTAIN  

```sql
SELECT USER_FIELDS FROM users WHERE user_id = $1
```

Le `user_id` issu du JWT est utilisé directement comme paramètre. Pas de jointure, pas de filtre supplémentaire.

**Cas : user_id présent dans le JWT mais absent en DB** → `row = None` → 401 "User not found".  
**Ce cas peut arriver si** : un utilisateur a été supprimé physiquement de la DB mais son token n'a pas encore expiré.

---

### BR-06 — Pas de vérification de statut utilisateur

**Source** : `auth_utils.py:81-83`  
**Niveau de confiance** : CERTAIN  

```python
if not row:
    raise HTTPException(status_code=401, detail="User not found")
return row_to_dict(row)
```

Le code ne vérifie **pas** :
- `deleted_at` (peut être non null — utilisateur supprimé mais toujours en DB)
- `banned_until` (colonne présente en DB, jamais vérifiée dans `require_auth`)
- `anonymized_at` (utilisateur anonymisé mais toujours authentifiable)
- `media_purged` (non pertinent pour l'auth)

**Comportement** : un utilisateur "soft-deleted" (avec `deleted_at` non null) peut toujours s'authentifier si son token est valide et son `user_id` est en DB.

**Java** : reproduire ce comportement sans vérification de statut.

---

### BR-07 — La réponse reflète toujours l'état actuel de la DB

**Source** : `auth_utils.py:76-83`  
**Niveau de confiance** : CERTAIN  

Le lookup est effectué en DB à **chaque requête**. La réponse reflète l'état actuel des colonnes, pas l'état au moment de la création du token.

**Exemple** : si un utilisateur change son `name` entre deux appels, le deuxième appel retourne le nouveau nom même si le token est le même.

**Java** : pas de cache sur l'utilisateur. DB fresh à chaque appel.

---

### BR-08 — Valeurs par défaut en base de données

**Niveau de confiance** : CERTAIN (vérifié schéma DB)

Si un utilisateur a été créé sans valeur pour les champs optionnels :

| Champ | Valeur en DB | Retourné dans la réponse |
|---|---|---|
| `role` | `'user'` (default DB) | `"user"` |
| `language` | `'fr'` (default DB) | `"fr"` |
| `show_phone` | `false` (default DB) | `false` |
| `show_reviews` | `true` (default DB) | `true` |
| `is_coach_verified` | `false` (default DB) | `false` |
| `onboarding_done` | `false` (default DB) | `false` |
| `coach_tags` | `[]` (default DB) | `[]` |
| `goals` | `[]` (default DB) | `[]` |
| `user_roles` | `[]` (default DB) | `[]` |
| `picture`, `bio`, `phone`, `sports_level` | `NULL` | `null` |

---

### BR-09 — Format des timestamps

**Source** : `database.py:61-62`  
**Niveau de confiance** : CERTAIN  

```python
elif hasattr(val, 'isoformat'):
    result[key] = val.isoformat()
```

- `created_at` et `updated_at` sont des `datetime` avec timezone UTC
- Retournés via `.isoformat()` → `"2026-04-01T12:51:14.682000+00:00"`
- Format avec microsecondes si non nulles, offset `+00:00` (jamais `Z`)

---

### BR-10 — JSONB retourné tel quel

**Source** : `database.py:74-81` (codec JSONB installé au pool)  
**Niveau de confiance** : CERTAIN  

`coach_tags`, `goals`, `user_roles` sont des colonnes JSONB. Le codec asyncpg les décode automatiquement en Python `list` ou `dict`. `row_to_dict` les passe sans transformation.

**Valeurs possibles** :
- `coach_tags` : liste de strings (IDs de tags), ex: `["tag_hatha", "tag_endurance"]`
- `goals` : liste d'objets ou de strings (schéma non contraint), ex: `[]` ou `["prise_masse"]`
- `user_roles` : liste d'objets (schéma non contraint), ex: `[]`

**Java** : désérialiser en `List<String>` pour `coach_tags`, `List<Object>` pour `goals` et `user_roles`.

---

### Tableau récapitulatif

| # | Règle | Confiance | Ambiguïté |
|---|---|---|---|
| BR-01 | Header Bearer puis cookie `winek_token` | CERTAIN | Case-sensitive sur "Bearer " |
| BR-02 | HS256 uniquement, secret via env JWT_SECRET | CERTAIN | Aucune |
| BR-03 | Claims requis : `user_id` + `exp`. `iat` absent. `sub` absent. | CERTAIN | Aucune |
| BR-04 | TTL 7 jours, pas de refresh | CERTAIN | Aucune |
| BR-05 | Lookup par `user_id` TEXT uniquement | CERTAIN | Aucune |
| BR-06 | Pas de vérification de statut (deleted_at, banned_until) | CERTAIN | Choix intentionnel Python |
| BR-07 | DB fresh à chaque appel (pas de cache) | CERTAIN | Aucune |
| BR-08 | Valeurs par défaut DB pour les champs optionnels | CERTAIN | Aucune |
| BR-09 | Timestamps ISO 8601 avec microsecondes et +00:00 | CERTAIN | Java produit Z par défaut → forcer +00:00 |
| BR-10 | JSONB passé tel quel (list/dict) | CERTAIN | Aucune |
