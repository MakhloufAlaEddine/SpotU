# SLICE_23_API_CONTRACTS.md — Contrats API Auth
> Basé sur `auth_routes.py:1–119`, `auth_utils.py:1–133`.
> Généré le 2026-04-13.

---

## Endpoint 1 — `POST /api/auth/register`

### Auth : **AUCUNE** (public) | Rate limit : 5/min

### Requête

```json
{
  "email": "user@example.com",
  "password": "secret123",
  "name": "Jean Dupont",
  "language": "fr"
}
```

| Champ | Type | Requis | Validation | Défaut |
|---|---|---|---|---|
| `email` | string | OUI | Pas de validation format (Pydantic BaseModel sans EmailStr) | — |
| `password` | string | OUI | `len >= 6` (Pydantic validator) | — |
| `name` | string | OUI | Non vide après `.strip()` (Pydantic validator) | — |
| `language` | enum | NON | `"fr"` ou `"en"` uniquement | `"fr"` |

### Réponse 200

```json
{
  "user": {
    "user_id": "user_abc123def456",
    "email": "user@example.com",
    "name": "Jean Dupont",
    "role": "user",
    "language": "fr",
    "picture": null,
    "bio": null,
    "phone": null,
    "is_coach_verified": false,
    "coach_tags": [],
    "show_phone": false,
    "show_reviews": true,
    "created_at": "2026-04-13T12:00:00+00:00",
    "updated_at": "2026-04-13T12:00:00+00:00",
    "sports_level": null,
    "goals": [],
    "user_roles": [],
    "onboarding_done": false
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### Erreurs

| Code | Condition | Detail |
|---|---|---|
| 400 | Email déjà enregistré | `"Email already registered"` |
| 422 | Password < 6 chars | Pydantic validation error |
| 422 | Name vide | Pydantic validation error |
| 422 | Language invalide | Pydantic validation error |
| 429 | Rate limit dépassé | SlowAPI |

### SQL

```sql
-- Vérifier unicité
SELECT user_id FROM users WHERE email = $1

-- Insérer
INSERT INTO users (user_id, email, password_hash, name, role, language, coach_tags)
VALUES ($1, $2, $3, $4, 'user', $5, '[]'::jsonb)

-- Relire pour réponse
SELECT {USER_FIELDS} FROM users WHERE user_id = $1
```

### Effets de bord

- `email` est converti en **lowercase** (`data.email.lower()`)
- `password_hash` généré par `bcrypt.hashpw(password, bcrypt.gensalt())` — salt rounds par défaut (12)
- `role` est toujours `'user'` à l'inscription (hardcodé)
- `coach_tags` initialisé à `'[]'::jsonb`

---

## Endpoint 2 — `POST /api/auth/login`

### Auth : **AUCUNE** | Rate limit : 5/min

### Requête

```json
{
  "email": "user@example.com",
  "password": "secret123"
}
```

### Réponse 200

```json
{
  "user": { ...USER_FIELDS... },
  "token": "eyJhbG..."
}
```

Identique à register (mêmes champs user).

### Erreurs

| Code | Condition | Detail |
|---|---|---|
| 401 | Email introuvable OU password invalide | `"Invalid credentials"` (message identique — pas de leak) |
| 429 | Rate limit | SlowAPI |

### SQL

```sql
-- Étape 1 : chercher le hash
SELECT user_id, password_hash, role FROM users WHERE email = $1

-- Étape 2 (si bcrypt OK) : charger le user complet
SELECT {USER_FIELDS} FROM users WHERE user_id = $1
```

### Points

- Email lowercase (`data.email.lower()`)
- Le message `"Invalid credentials"` est identique pour email inexistant ET password faux (anti-enumeration)
- `password_hash` peut être `NULL` (user Google sans password) → `verify_password("x", "")` retourne `false`
- 2 connexions DB distinctes (pas une seule `async with`)

---

## Endpoint 3 — `POST /api/auth/google`

### Auth : **AUCUNE** | Rate limit : 10/min

### Requête

```json
{
  "session_id": "emergent_session_abc123"
}
```

### Flow

```
1. Appel HTTP externe → Emergent OAuth API
   GET https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data
   Headers: { X-Session-ID: session_id }
   → retourne { email, name, picture }

2. Si email existe en DB → UPDATE name + picture + updated_at → login
3. Si email n'existe pas → INSERT nouveau user (role='user', language='fr') → register
4. Retourner { user, token }
```

### Réponse 200

```json
{
  "user": { ...USER_FIELDS... },
  "token": "eyJhbG..."
}
```

### Erreurs

| Code | Condition | Detail |
|---|---|---|
| 401 | Session Emergent invalide (HTTP != 200) | Body Emergent ou `"Invalid Google session"` |
| 401 | Emergent retourne `{ "error": "..." }` | Body complet Emergent |
| 401 | Pas d'email dans la session | `"Could not retrieve user email from Google"` |
| 429 | Rate limit | SlowAPI |

### SQL (upsert-like)

```sql
-- Si user existe (login)
SELECT {USER_FIELDS} FROM users WHERE email = $1
UPDATE users SET name = $1, picture = $2, updated_at = NOW() WHERE email = $3
SELECT {USER_FIELDS} FROM users WHERE email = $1  -- re-read après update

-- Si nouveau user (register)
INSERT INTO users (user_id, email, name, picture, role, language, coach_tags)
VALUES ($1, $2, $3, $4, 'user', 'fr', '[]'::jsonb)
SELECT {USER_FIELDS} FROM users WHERE user_id = $1
```

### Points critiques

- **PAS d'idToken Google** : le flow utilise Emergent comme intermédiaire (session_id, pas un id_token classique)
- Pas de `password_hash` pour les users Google (colonne NULL)
- Si l'user existait avec un password, il peut maintenant se connecter via Google aussi (multimodal)
- Le `name` et `picture` sont **écrasés** à chaque connexion Google (pas de merge)
- `language` est hardcodé `'fr'` pour les nouveaux Google users

---

## Endpoint 4 — `GET /api/auth/me`

### Auth : **STRICTE** (`require_auth`)

Déjà documenté en S02 pour la RÉPONSE. Rappel : retourne le user complet (18 champs `USER_FIELDS`).

### Infrastructure `require_auth()`

```python
def require_auth(request, pool):
    token = get_token_from_request(request)   # Header Bearer OU cookie
    if not token: raise 401 "Not authenticated"
    payload = decode_jwt(token)               # HS256, vérifie exp + user_id
    row = SELECT {USER_FIELDS} WHERE user_id = payload["user_id"]
    if not row: raise 401 "User not found"
    return row_to_dict(row)
```

---

## Endpoint 5 — `POST /api/auth/logout`

### Auth : **STRICTE**

### Réponse 200

```json
{ "success": true }
```

### Comportement

Appelle `require_auth` pour vérifier le token, puis retourne `success: true`.
**PAS de suppression de push token** (contrairement à ce qu'indique le handoff — le code actuel ne supprime rien).
Le front supprime le token côté client.

---

## Endpoint 6 — `PUT /api/auth/change-password`

### Auth : **STRICTE**

### Requête

```json
{
  "current_password": "oldpass123",
  "new_password": "newpass456"
}
```

| Champ | Type | Requis | Validation |
|---|---|---|---|
| `current_password` | string | OUI | Vérifié contre le hash en DB |
| `new_password` | string | OUI | `len >= 6` (Pydantic PasswordChange) |

### Réponse 200

```json
{ "success": true }
```

### Erreurs

| Code | Condition | Detail |
|---|---|---|
| 401 | Mot de passe actuel incorrect | `"Mot de passe actuel incorrect"` (français) |
| 401 | Pas de token | `"Not authenticated"` |
| 422 | new_password < 6 chars | Pydantic |

### SQL

```sql
SELECT password_hash FROM users WHERE user_id = $1
UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2
```

### Point : user Google sans password_hash

Un user Google qui n'a jamais défini de password aura `password_hash = NULL`.
`verify_password("any", "")` retourne `false` → **impossible de changer le password sans en avoir un**.
Ce cas n'est PAS géré explicitement (401 "Mot de passe actuel incorrect").

---

## Infrastructure — JWT

### Structure du token

```json
{
  "user_id": "user_abc123def456",
  "role": "user",
  "exp": 1681430400
}
```

| Claim | Type | Obligatoire | Description |
|---|---|---|---|
| `user_id` | string | OUI (require) | ID utilisateur |
| `role` | string | OUI | `user`, `coach`, ou `admin` |
| `exp` | int (timestamp) | OUI (require) | Expiration = now + 7 jours |

### Configuration

| Paramètre | Valeur | Source |
|---|---|---|
| Algorithm | HS256 | `auth_utils.py:16` |
| Secret | `JWT_SECRET` env var | `auth_utils.py:10` |
| Expiry | 7 jours | `auth_utils.py:17` |
| Required claims | `exp`, `user_id` | `auth_utils.py:47` |

---

## Infrastructure — Token extraction

```python
def get_token_from_request(request):
    # 1. Header Authorization: Bearer {token}
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    # 2. Fallback : cookie "winek_token"
    return request.cookies.get("winek_token")
```

**Ordre de priorité** : Header > Cookie.

---

## Infrastructure — `USER_FIELDS`

```
user_id, email, name, role, language, picture, bio, phone,
is_coach_verified, coach_tags, show_phone, show_reviews,
created_at, updated_at, sports_level, goals, user_roles, onboarding_done
```

18 champs. Utilisé dans TOUS les `SELECT` qui retournent un user. C'est la **projection standard** du domaine User.
Colonnes EXCLUES : `password_hash`, `iban`, `bic`, `iban_name`, `stripe_customer_id`, `stripe_account_id`, `cover_picture`, `cover_offset_y`, `cover_scale`.
