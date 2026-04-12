# SLICE_02_AUTH_FLOW.md — Analyse précise du flux d'authentification
> Basé sur `auth_utils.py` (complet) + décodage JWT live + `auth_routes.py:92-95`.  
> Généré le 2026-04-12.

---

## Vue d'ensemble du flux

```
GET /api/auth/me
      │
      ▼
get_token_from_request(request)          ← auth_utils.py:61-65
      │  1. Authorization: Bearer <token>
      │  2. Cookie: winek_token=<token>   (fallback)
      │  None si absent → 401 "Not authenticated"
      ▼
decode_jwt(token)                        ← auth_utils.py:41-58
      │  - Vérifie signature HMAC-SHA256 avec JWT_SECRET
      │  - Vérifie exp (pas expiré)
      │  - Requiert les claims "exp" ET "user_id"
      │  ExpiredSignatureError → 401 "Token expired"
      │  InvalidAlgorithmError → 401 "Invalid token algorithm"
      │  InvalidTokenError     → 401 "Invalid token"
      ▼
payload = {"user_id": "...", "role": "...", "exp": ...}
      │
      ▼
SELECT USER_FIELDS FROM users WHERE user_id = $1  ← auth_utils.py:77-79
      │  payload["user_id"] → DB lookup
      │  row=None → 401 "User not found"
      ▼
row_to_dict(row)                         ← database.py:53-65
      │  Decimal → float
      │  datetime → ISO string
      ▼
return user_dict (18 champs)             ← réponse finale HTTP 200
```

---

## 1. Lecture du token

**Fichier** : `auth_utils.py:61-65`

```python
def get_token_from_request(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return request.cookies.get("winek_token")
```

| Priorité | Source | Exemple |
|---|---|---|
| 1 | Header `Authorization` | `Bearer eyJhbGci...` |
| 2 | Cookie `winek_token` | `winek_token=eyJhbGci...` |

**Important** : `auth.startswith("Bearer ")` est case-sensitive. `bearer token` ne fonctionnerait pas (non testé mais Python est strict ici).

---

## 2. Validation JWT

**Fichier** : `auth_utils.py:41-58`

### Paramètres du JWT

| Paramètre | Valeur | Source |
|---|---|---|
| Algorithme | `HS256` (HMAC-SHA256) | `JWT_ALGORITHM = "HS256"` (l.16) |
| Secret | Valeur de `JWT_SECRET` env | `JWT_SECRET = os.environ.get("JWT_SECRET")` (l.10) |
| TTL | 7 jours | `JWT_EXPIRE_DAYS = 7` (l.17) |
| Librairie Python | `PyJWT` | `import jwt` |

### Structure exacte du payload JWT (vérifiée sur token live)

```json
{
  "user_id": "user_demo001",
  "role": "coach",
  "exp": 1776629325
}
```

**Claim `user_id`** : clé custom (PAS `sub`). C'est le champ `users.user_id` (`"user_demo001"`).  
**Claim `role`** : inclus dans le token pour info, mais PAS vérifié dans `require_auth` (seul `user_id` est utilisé pour le lookup DB).  
**Claim `exp`** : timestamp Unix standard.  
**Claim `iat`** : **ABSENT** — Python ne l'inclut pas à la création.  
**Header** : `{"alg": "HS256", "typ": "JWT"}`

### Options de décodage Python

```python
jwt.decode(
    token,
    JWT_SECRET,
    algorithms=["HS256"],
    options={"require": ["exp", "user_id"]},
)
```

- **`require: ["exp", "user_id"]`** : le décodage échoue si l'un des deux claims est absent
- `iat` n'est pas requis
- `sub` n'est pas utilisé ni requis

### Mapping des erreurs JWT → HTTP

| Exception Python (PyJWT) | HTTP | Corps |
|---|---|---|
| `jwt.ExpiredSignatureError` | 401 | `{"detail": "Token expired"}` |
| `jwt.InvalidAlgorithmError` | 401 | `{"detail": "Invalid token algorithm"}` |
| `jwt.InvalidTokenError` (toute autre) | 401 | `{"detail": "Invalid token"}` |

> `jwt.MissingRequiredClaimError` (si `user_id` ou `exp` absent) est une sous-classe de `InvalidTokenError` → 401 "Invalid token".

---

## 3. Lookup en base de données

**Fichier** : `auth_utils.py:76-82`

```python
async with pool.acquire() as conn:
    row = await conn.fetchrow(
        f"SELECT {USER_FIELDS} FROM users WHERE user_id = $1",
        payload["user_id"]
    )
if not row:
    raise HTTPException(status_code=401, detail="User not found")
return row_to_dict(row)
```

**Requête exacte** :
```sql
SELECT user_id, email, name, role, language, picture, bio, phone,
       is_coach_verified, coach_tags, show_phone, show_reviews,
       created_at, updated_at, sports_level, goals, user_roles, onboarding_done
FROM users
WHERE user_id = $1
```

- **Paramètre** : `payload["user_id"]` (string, ex: `"user_demo001"`)
- **LIMIT implicite** : `fetchrow` retourne 1 seule ligne (la première)
- **Pas de filtre** sur `deleted_at`, `active`, `banned_until`, `anonymized_at`

---

## 4. Sérialisation de la réponse

**Fichier** : `database.py:53-65`

```python
def row_to_dict(row) -> dict:
    result = {}
    for key, val in dict(row).items():
        if isinstance(val, Decimal):
            result[key] = float(val)
        elif hasattr(val, 'isoformat'):   # datetime, date
            result[key] = val.isoformat()
        else:
            result[key] = val
    return result
```

| Type PostgreSQL | Type Python asyncpg | Transformation | Résultat JSON |
|---|---|---|---|
| TEXT | str | aucune | string |
| BOOLEAN | bool | aucune | boolean |
| TIMESTAMPTZ | datetime (avec tz) | `.isoformat()` | `"2026-04-01T12:51:14.682000+00:00"` |
| JSONB | dict / list | aucune (déjà décodé via codec) | object / array |
| NUMERIC | Decimal | `float()` | number |
| NULL | None | aucune | null |

> JSONB est décodé automatiquement par le codec installé sur chaque connexion du pool (`_init_connection` dans `database.py:74-81`).

---

## 5. Vérifications de statut utilisateur

**AUCUNE vérification de statut n'est effectuée dans `require_auth`.**

| Vérification | Effectuée ? | Source |
|---|---|---|
| `deleted_at IS NULL` | **NON** | Un utilisateur supprimé peut toujours s'authentifier si son `user_id` est en DB |
| `active = TRUE` | **NON** (colonne absente de la table `users`) | La colonne `active` n'existe pas sur la table `users` |
| `banned_until < NOW()` | **NON** | `banned_until` existe en DB mais n'est pas vérifié |
| `anonymized_at IS NULL` | **NON** | Non vérifié |
| Role / permission | **NON** dans `require_auth` | Vérifié uniquement dans `require_role()` |

> **Règle Java** : reproduire exactement ce comportement. Ne PAS ajouter de vérification `deleted_at` ou `banned_until` dans la Slice 02.

---

## 6. Ce qui doit être reproduit en Java

| Composant Java | Responsabilité | Priorité |
|---|---|---|
| `JwtService#decodeToken(String)` | Valide signature HS256 + exp + user_id présent | OBLIGATOIRE |
| `JwtAuthFilter extends OncePerRequestFilter` | Lit Bearer / cookie, appelle JwtService, stocke dans SecurityContext | OBLIGATOIRE |
| `UserRepository#findByUserId(String)` | `SELECT USER_FIELDS FROM users WHERE user_id = $1` | OBLIGATOIRE |
| `AuthController#getMe()` | Retourne l'utilisateur depuis le SecurityContext | OBLIGATOIRE |
| `CurrentUserDto` | 18 champs, nommage snake_case via Jackson | OBLIGATOIRE |

## 7. Ce qui peut être reporté à plus tard

| Composant | Pourquoi reporter |
|---|---|
| Vérification `banned_until` | Non implémentée en Python actuellement |
| Vérification `deleted_at` | Non implémentée en Python (comportement intentionnel) |
| Refresh token | Absent en Python — pas de mécanisme de refresh |
| Rate limiting sur `/auth/me` | Absent en Python pour cet endpoint |
| Cache utilisateur | Absent en Python — DB fresh à chaque call |
