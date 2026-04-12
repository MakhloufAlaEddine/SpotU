# SLICE_02_TEST_CASES.md — Cas de tests pour Cursor
> Basé sur `auth_utils.py` + réponse API live + schéma DB Supabase.  
> Généré le 2026-04-12.

---

## Conventions

- **TOKEN_VALID** = JWT HS256 valide, émis avec `JWT_SECRET` correct, `user_id` existant en DB, non expiré
- **TOKEN_EXPIRED** = même structure mais `exp` dans le passé
- **TOKEN_BAD_SIG** = structure JWT valide (3 parties base64) mais signature incorrecte
- **TOKEN_MALFORMED** = chaîne aléatoire ou base64 invalide
- **TOKEN_WRONG_ALG** = JWT signé avec RS256 ou autre algorithme
- **TOKEN_NO_USER_ID** = JWT valide mais sans claim `user_id`
- **TOKEN_NO_EXP** = JWT valide mais sans claim `exp`

---

## TC-ME-01 — Cas nominal (token valide, utilisateur existant)

**Description** : flow complet happy path.

**Requête** :
```
GET /api/auth/me
Authorization: Bearer TOKEN_VALID
```

**EXPECTED** :
```json
HTTP 200
{
  "user_id": "user_demo001",
  "email": "user@winek.app",
  "name": "Thomas Dupont",
  "role": "coach",
  "language": "fr",
  "picture": "<url>",
  "bio": "Passionné de sport et de running.",
  "phone": "+33 6 12 34 56 78",
  "is_coach_verified": true,
  "coach_tags": ["tag_hatha", "tag_prise_masse", "tag_endurance", "tag_bivouac"],
  "show_phone": true,
  "show_reviews": true,
  "created_at": "2026-04-01T12:51:14.682000+00:00",
  "updated_at": "2026-04-02T13:36:04.382240+00:00",
  "sports_level": null,
  "goals": [],
  "user_roles": [],
  "onboarding_done": false
}
```

**Assertions** :
- Status 200
- Exactement 18 champs dans l'objet retourné (pas plus)
- `user_id` correspond à celui encodé dans le token
- Noms de champs en snake_case

**Priorité** : CRITIQUE

---

## TC-ME-02 — Token absent (ni header ni cookie)

**Requête** :
```
GET /api/auth/me
(aucun Authorization, aucun cookie)
```

**EXPECTED** :
```json
HTTP 401
{"detail": "Not authenticated"}
```

**Source Python** : `auth_utils.py:73-74`  
**Priorité** : CRITIQUE

---

## TC-ME-03 — Token invalide (mauvaise signature)

**Requête** :
```
GET /api/auth/me
Authorization: Bearer TOKEN_BAD_SIG
```

**EXPECTED** :
```json
HTTP 401
{"detail": "Invalid token"}
```

**Source Python** : `auth_utils.py:56-58`  
**Priorité** : CRITIQUE

---

## TC-ME-04 — Token malformé (pas un JWT)

**Requête** :
```
GET /api/auth/me
Authorization: Bearer badtoken
```

**EXPECTED** :
```json
HTTP 401
{"detail": "Invalid token"}
```

**Source Python** : `auth_utils.py:56-58` (`InvalidTokenError: Not enough segments`)  
**Priorité** : CRITIQUE

---

## TC-ME-05 — Token expiré

**Requête** :
```
GET /api/auth/me
Authorization: Bearer TOKEN_EXPIRED
```

**EXPECTED** :
```json
HTTP 401
{"detail": "Token expired"}
```

**Source Python** : `auth_utils.py:50-52` (distinct de "Invalid token")  
**Note** : la clé du message est différente de TC-ME-03/04 — les clients peuvent distinguer les deux cas.  
**Priorité** : CRITIQUE

---

## TC-ME-06 — Mauvais algorithme JWT

**Requête** :
```
GET /api/auth/me
Authorization: Bearer TOKEN_WRONG_ALG
```

**EXPECTED** :
```json
HTTP 401
{"detail": "Invalid token algorithm"}
```

**Source Python** : `auth_utils.py:53-55`  
**Priorité** : ÉLEVÉE (message distinct des autres 401)

---

## TC-ME-07 — Token sans claim `user_id`

**Requête** :
```
GET /api/auth/me
Authorization: Bearer TOKEN_NO_USER_ID
```

**EXPECTED** :
```json
HTTP 401
{"detail": "Invalid token"}
```

**Source Python** : `MissingRequiredClaimError` → `InvalidTokenError` → `auth_utils.py:56-58`  
**Priorité** : ÉLEVÉE

---

## TC-ME-08 — Token sans claim `exp`

**Requête** :
```
GET /api/auth/me
Authorization: Bearer TOKEN_NO_EXP
```

**EXPECTED** :
```json
HTTP 401
{"detail": "Invalid token"}
```

**Source Python** : `MissingRequiredClaimError` → `InvalidTokenError`  
**Priorité** : ÉLEVÉE

---

## TC-ME-09 — user_id présent dans le token mais absent en DB

**Description** : token valide (`user_id = "user_inexistant_xyz"`) mais cet ID n'existe pas dans `users`.

**Requête** :
```
GET /api/auth/me
Authorization: Bearer <token avec user_id="user_inexistant_xyz">
```

**EXPECTED** :
```json
HTTP 401
{"detail": "User not found"}
```

**Source Python** : `auth_utils.py:81-82`  
**Priorité** : CRITIQUE

---

## TC-ME-10 — Token via cookie (fallback)

**Description** : token transmis via cookie `winek_token` au lieu du header.

**Requête** :
```
GET /api/auth/me
Cookie: winek_token=TOKEN_VALID
(aucun header Authorization)
```

**EXPECTED** : HTTP 200 + même réponse que TC-ME-01  
**Source Python** : `auth_utils.py:65`  
**Priorité** : ÉLEVÉE (fallback documenté)

---

## TC-ME-11 — Header Authorization sans Bearer (autre schéma)

**Requête** :
```
GET /api/auth/me
Authorization: Basic dXNlcjpwYXNz
```

**EXPECTED** :
```json
HTTP 401
{"detail": "Not authenticated"}
```

**Raison** : `auth.startswith("Bearer ")` retourne False → fallback cookie → cookie absent → None → 401.  
**Priorité** : MOYENNE

---

## TC-ME-12 — Header Authorization: Bearer (avec espace, token vide)

**Requête** :
```
GET /api/auth/me
Authorization: Bearer 
```

**EXPECTED** :
```json
HTTP 401
{"detail": "Invalid token"}
```

**Raison** : `auth[7:]` retourne `""` → `decode_jwt("")` → `InvalidTokenError`.  
**Priorité** : MOYENNE

---

## TC-ME-13 — Réponse ne contient pas les champs sensibles

**Requête** : identique à TC-ME-01.

**Assertions spécifiques** :
- Réponse ne contient PAS : `password_hash`, `encrypted_password`, `id`, `iban`, `bic`, `stripe_customer_id`, `stripe_account_id`, `deleted_at`, `banned_until`
- Exactement **18 champs** dans l'objet JSON

**Priorité** : CRITIQUE (sécurité)

---

## TC-ME-14 — Compatibilité stricte Python : noms de champs snake_case

**Assertions** :
- `"user_id"` (pas `"userId"`)
- `"is_coach_verified"` (pas `"isCoachVerified"`)
- `"coach_tags"` (pas `"coachTags"`)
- `"show_phone"` (pas `"showPhone"`)
- `"show_reviews"` (pas `"showReviews"`)
- `"onboarding_done"` (pas `"onboardingDone"`)
- `"sports_level"` (pas `"sportsLevel"`)
- `"user_roles"` (pas `"userRoles"`)
- `"created_at"` (pas `"createdAt"`)
- `"updated_at"` (pas `"updatedAt"`)

**Priorité** : CRITIQUE (compatibilité frontend)

---

## TC-ME-15 — Format timestamp correct

**Assertions sur `created_at` et `updated_at`** :
- Format : `"YYYY-MM-DDThh:mm:ss.SSSSSS+00:00"` (ISO 8601 avec microsecondes et offset)
- Offset : `+00:00` (PAS `Z`)
- Séparateur : `T` (PAS espace)

**Exemple attendu** : `"2026-04-01T12:51:14.682000+00:00"`  
**Priorité** : ÉLEVÉE

---

## TC-ME-16 — Token admin : retourne role="admin"

**Requête** :
```
GET /api/auth/me
Authorization: Bearer <token de admin@winek.app>
```

**EXPECTED** : HTTP 200 avec `"role": "admin"`  
**Priorité** : ÉLEVÉE (valide que le role est bien retourné depuis la DB)

---

## TC-ME-17 — DB inaccessible

**Description** : mock JDBC qui lève une exception.

**EXPECTED** : HTTP 500  
**Priorité** : MOYENNE

---

## Matrice de couverture

| Test Case | Nominal | Auth manquante | Token invalide | Token expiré | User absent DB | Cookie fallback | Sécurité | Compat. |
|---|---|---|---|---|---|---|---|---|
| TC-ME-01 | ✓ | | | | | | | |
| TC-ME-02 | | ✓ | | | | | | |
| TC-ME-03 | | | ✓ | | | | | |
| TC-ME-04 | | | ✓ | | | | | |
| TC-ME-05 | | | | ✓ | | | | |
| TC-ME-06 | | | ✓ | | | | | |
| TC-ME-07 | | | ✓ | | | | | |
| TC-ME-08 | | | ✓ | | | | | |
| TC-ME-09 | | | | | ✓ | | | |
| TC-ME-10 | ✓ | | | | | ✓ | | |
| TC-ME-11 | | ✓ | | | | | | |
| TC-ME-12 | | | ✓ | | | | | |
| TC-ME-13 | | | | | | | ✓ | |
| TC-ME-14 | | | | | | | | ✓ |
| TC-ME-15 | | | | | | | | ✓ |
| TC-ME-16 | ✓ | | | | | | | |
| TC-ME-17 | | | | | | | | |
