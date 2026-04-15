# SLICE_23_TEST_CASES.md — Cas de tests
> Basé sur `auth_routes.py`, `auth_utils.py`.
> Généré le 2026-04-13.

---

## A. POST /auth/register

### TC-REG-01 — Inscription nominale

```
GIVEN : email "new@test.com" n'existe pas en DB
WHEN  : POST /api/auth/register { email: "new@test.com", password: "pass123", name: "Jean" }
THEN  : 200 + { user: { user_id: "user_...", email: "new@test.com", name: "Jean", role: "user" }, token: "eyJ..." }
AND   : users table contient la nouvelle entrée
AND   : password_hash est un hash bcrypt valide
```

### TC-REG-02 — Email déjà existant → 400

```
GIVEN : email "existing@test.com" déjà en DB
WHEN  : POST /auth/register { email: "existing@test.com", ... }
THEN  : 400 "Email already registered"
```

### TC-REG-03 — Email uppercase → normalisé lowercase

```
GIVEN : email "NEW@TEST.COM" n'existe pas
WHEN  : POST /auth/register { email: "NEW@TEST.COM", ... }
THEN  : 200 + user.email = "new@test.com" (lowercase)
```

### TC-REG-04 — Password trop court → 422

```
WHEN  : POST /auth/register { email: "x@y.com", password: "abc", name: "X" }
THEN  : 422 (Pydantic validation: "au moins 6 caractères")
```

### TC-REG-05 — Name vide → 422

```
WHEN  : POST /auth/register { email: "x@y.com", password: "pass123", name: "" }
THEN  : 422 (Pydantic validation: "Le nom est obligatoire")
```

### TC-REG-06 — Language anglais

```
WHEN  : POST /auth/register { email: "x@y.com", password: "pass123", name: "John", language: "en" }
THEN  : 200 + user.language = "en"
```

### TC-REG-07 — Language invalide → 422

```
WHEN  : POST /auth/register { ..., language: "de" }
THEN  : 422 (enum validation)
```

### TC-REG-08 — Token JWT valide

```
GIVEN : register retourne token T
WHEN  : GET /api/auth/me avec Authorization: Bearer T
THEN  : 200 + retourne le même user
```

### TC-REG-09 — Rate limit (6e requête en 1 min) → 429

```
GIVEN : 5 register réussis en < 1 minute
WHEN  : 6e POST /auth/register
THEN  : 429 Too Many Requests
```

---

## B. POST /auth/login

### TC-LOG-01 — Login nominal

```
GIVEN : user "test@login.com" avec password "pass123" en DB
WHEN  : POST /api/auth/login { email: "test@login.com", password: "pass123" }
THEN  : 200 + { user: { ...18 champs... }, token: "eyJ..." }
```

### TC-LOG-02 — Email inconnu → 401

```
WHEN  : POST /auth/login { email: "unknown@test.com", password: "x" }
THEN  : 401 "Invalid credentials"
```

### TC-LOG-03 — Password faux → 401

```
GIVEN : user "test@login.com" existe
WHEN  : POST /auth/login { email: "test@login.com", password: "wrong" }
THEN  : 401 "Invalid credentials" (MÊME message que TC-LOG-02)
```

### TC-LOG-04 — Google user (password_hash NULL) → 401

```
GIVEN : user Google "goog@test.com" avec password_hash=NULL
WHEN  : POST /auth/login { email: "goog@test.com", password: "anything" }
THEN  : 401 "Invalid credentials" (verify_password("anything", "") = false)
```

### TC-LOG-05 — Email uppercase → normalisé

```
WHEN  : POST /auth/login { email: "TEST@LOGIN.COM", password: "pass123" }
THEN  : 200 (email lowercase match)
```

### TC-LOG-06 — Rate limit → 429

```
GIVEN : 5 login en < 1 minute
WHEN  : 6e login
THEN  : 429
```

---

## C. POST /auth/google

### TC-GOO-01 — Nouveau user Google

```
GIVEN : session_id valide avec email "google@test.com" (n'existe pas en DB)
WHEN  : POST /api/auth/google { session_id: "valid_session" }
THEN  : 200 + { user: { email: "google@test.com", role: "user", language: "fr", picture: "..." }, token: "..." }
AND   : users table contient l'entrée avec password_hash=NULL
```

### TC-GOO-02 — User Google existant → update name + picture

```
GIVEN : user "google@test.com" existe avec name="Old", picture=null
AND   : session_id retourne name="New", picture="https://photo.jpg"
WHEN  : POST /auth/google { session_id: "valid_session" }
THEN  : 200 + user.name = "New", user.picture = "https://photo.jpg"
AND   : DB updated_at mis à jour
```

### TC-GOO-03 — Session Emergent invalide → 401

```
GIVEN : session_id "invalid" → Emergent retourne HTTP 401
WHEN  : POST /auth/google { session_id: "invalid" }
THEN  : 401
```

### TC-GOO-04 — Session Emergent avec erreur → 401

```
GIVEN : Emergent retourne 200 + { "error": "session expired" }
WHEN  : POST /auth/google
THEN  : 401 { "error": "session expired" }
```

### TC-GOO-05 — Session sans email → 401

```
GIVEN : Emergent retourne 200 + { "name": "Jean" } (pas d'email)
WHEN  : POST /auth/google
THEN  : 401 "Could not retrieve user email from Google"
```

### TC-GOO-06 — Rate limit → 429

```
GIVEN : 10 requêtes en < 1 minute
WHEN  : 11e requête
THEN  : 429
```

---

## D. GET /auth/me

### TC-ME-01 — Token valide → user

```
GIVEN : token JWT valide pour user_001
WHEN  : GET /api/auth/me (Authorization: Bearer token)
THEN  : 200 + user complet (18 champs)
```

### TC-ME-02 — Token absent → 401

```
WHEN  : GET /auth/me (pas de header, pas de cookie)
THEN  : 401 "Not authenticated"
```

### TC-ME-03 — Token expiré → 401

```
GIVEN : token expiré (> 7 jours)
WHEN  : GET /auth/me
THEN  : 401 "Token expired"
```

### TC-ME-04 — Token invalide → 401

```
GIVEN : token = "garbage_string"
WHEN  : GET /auth/me
THEN  : 401 "Invalid token"
```

### TC-ME-05 — User supprimé → 401

```
GIVEN : token valide mais user supprimé de la DB
WHEN  : GET /auth/me
THEN  : 401 "User not found"
```

### TC-ME-06 — Cookie winek_token (fallback)

```
GIVEN : pas de header Authorization, mais cookie winek_token=valid_jwt
WHEN  : GET /auth/me
THEN  : 200 + user (cookie fallback fonctionne)
```

---

## E. POST /auth/logout

### TC-OUT-01 — Logout nominal

```
GIVEN : token valide
WHEN  : POST /api/auth/logout
THEN  : 200 + { success: true }
```

### TC-OUT-02 — Token absent → 401

```
WHEN  : POST /auth/logout (pas de token)
THEN  : 401 "Not authenticated"
```

---

## F. PUT /auth/change-password

### TC-PWD-01 — Changement nominal

```
GIVEN : user avec password "oldpass"
WHEN  : PUT /api/auth/change-password { current_password: "oldpass", new_password: "newpass" }
THEN  : 200 + { success: true }
AND   : login avec "newpass" fonctionne
AND   : login avec "oldpass" échoue
```

### TC-PWD-02 — Mot de passe actuel incorrect → 401

```
WHEN  : PUT /change-password { current_password: "wrong", new_password: "new123" }
THEN  : 401 "Mot de passe actuel incorrect"
```

### TC-PWD-03 — Nouveau password trop court → 422

```
WHEN  : PUT /change-password { current_password: "old123", new_password: "ab" }
THEN  : 422 (Pydantic validation)
```

### TC-PWD-04 — Google user (password_hash NULL) → 401

```
GIVEN : user Google sans password
WHEN  : PUT /change-password { current_password: "anything", new_password: "new123" }
THEN  : 401 "Mot de passe actuel incorrect"
```

### TC-PWD-05 — Token absent → 401

```
WHEN  : PUT /change-password (pas de token)
THEN  : 401 "Not authenticated"
```

---

## G. Infrastructure JWT

### TC-JWT-01 — Token encode/decode roundtrip

```
GIVEN : create_jwt("user_001", "user")
WHEN  : decode_jwt(token)
THEN  : payload.user_id = "user_001", payload.role = "user", payload.exp > now
```

### TC-JWT-02 — Token avec mauvais secret → 401

```
GIVEN : token signé avec secret_A
WHEN  : decode_jwt avec secret_B
THEN  : 401 "Invalid token"
```

### TC-JWT-03 — Token sans user_id claim → 401

```
GIVEN : JWT valide mais sans claim "user_id"
WHEN  : decode_jwt
THEN  : 401 "Invalid token" (require user_id)
```

---

## Résumé

| Catégorie | Nombre | Couverture |
|---|---|---|
| A. Register | 9 | Nominal, doublon, lowercase, validation, token, rate limit |
| B. Login | 6 | Nominal, inconnu, faux, Google null, lowercase, rate limit |
| C. Google | 6 | Nouveau, existant, session invalide/erreur/sans email, rate limit |
| D. Me | 6 | Valide, absent, expiré, invalide, supprimé, cookie |
| E. Logout | 2 | Nominal, absent |
| F. Change-password | 5 | Nominal, incorrect, court, Google null, absent |
| G. JWT infra | 3 | Roundtrip, mauvais secret, claim absent |
| **TOTAL** | **37** | |
