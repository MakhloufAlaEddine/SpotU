# SLICE_24_TEST_CASES.md — Cas de tests
> Basé sur `user_routes.py`, `upload_routes.py`, `push_routes.py`.
> Généré le 2026-04-15.

---

## A. PUT /users/profile

### TC-PRO-01 — Update nominal (name + bio)

```
GIVEN : user connecté
WHEN  : PUT /api/users/profile { name: "Nouveau nom", bio: "Ma bio" }
THEN  : 200 + user avec name="Nouveau nom", bio="Ma bio", updated_at mis à jour
```

### TC-PRO-02 — Clear bio (null explicite)

```
WHEN  : PUT /profile { bio: null }
THEN  : 200 + user.bio = null (bio est CLEARABLE)
```

### TC-PRO-03 — Name vide → 400

```
WHEN  : PUT /profile { name: "" }
THEN  : 400 "Le nom est obligatoire"
```

### TC-PRO-04 — Body vide → retourne user sans UPDATE

```
WHEN  : PUT /profile {}
THEN  : 200 + user actuel (pas d'UPDATE exécuté)
```

### TC-PRO-05 — JSONB coach_tags

```
WHEN  : PUT /profile { coach_tags: ["tag_001", "tag_002"] }
THEN  : 200 + user.coach_tags = ["tag_001", "tag_002"]
AND   : SQL contient "coach_tags = $N::jsonb"
```

### TC-PRO-06 — Picture change → delete ancienne

```
GIVEN : user.picture = "https://images.winek.app/profiles/old.jpg"
WHEN  : PUT /profile { picture: "https://images.winek.app/profiles/new.jpg" }
THEN  : 200 + delete_upload_file("...old.jpg") appelé
```

### TC-PRO-07 — Picture clear (null)

```
GIVEN : user.picture = "https://..."
WHEN  : PUT /profile { picture: null }
THEN  : 200 + user.picture = null + ancienne photo supprimée
```

### TC-PRO-08 — IBAN clearable

```
WHEN  : PUT /profile { iban: null }
THEN  : 200 + user.iban = null (iban est CLEARABLE)
```

### TC-PRO-09 — Auth absente → 401

```
WHEN  : PUT /profile (pas de token)
THEN  : 401
```

### TC-PRO-10 — Multiple champs (name + language + onboarding_done)

```
WHEN  : PUT /profile { name: "X", language: "en", onboarding_done: true }
THEN  : 200 + les 3 champs mis à jour
```

---

## B. POST /users/become-coach

### TC-COA-01 — Transition user → coach

```
GIVEN : user.role = "user"
WHEN  : POST /api/users/become-coach
THEN  : 200 + user.role = "coach", is_coach_verified = false
```

### TC-COA-02 — Déjà coach → 400

```
GIVEN : user.role = "coach"
WHEN  : POST /become-coach
THEN  : 400 "Already a coach or admin"
```

### TC-COA-03 — Admin → 400

```
GIVEN : user.role = "admin"
WHEN  : POST /become-coach
THEN  : 400 "Already a coach or admin"
```

### TC-COA-04 — Auth absente → 401

```
WHEN  : POST /become-coach (pas de token)
THEN  : 401
```

---

## C. PATCH /users/{uid}/cover

### TC-COV-01 — Update cover nominal

```
GIVEN : user connecté user_001
WHEN  : PATCH /api/users/user_001/cover { cover_picture: "https://...", cover_offset_y: 0.3, cover_scale: 1.2 }
THEN  : 200 + { cover_picture, cover_offset_y: 0.3, cover_scale: 1.2 }
```

### TC-COV-02 — Ownership mismatch → 403

```
GIVEN : user connecté user_001
WHEN  : PATCH /users/user_002/cover { cover_picture: "..." }
THEN  : 403 "Accès refusé."
```

### TC-COV-03 — Cover sans offset/scale → défauts

```
WHEN  : PATCH /users/{uid}/cover { cover_picture: "https://..." }
THEN  : 200 + SQL UPDATE cover_picture=$1, updated_at=NOW() (pas d'offset/scale)
```

### TC-COV-04 — Clear cover (vide)

```
WHEN  : PATCH /cover { cover_picture: "" }
THEN  : 200 + cover_picture=NULL en DB + ancienne cover supprimée
```

### TC-COV-05 — Auth absente → 401

```
WHEN  : PATCH /cover (pas de token)
THEN  : 401
```

---

## D. POST /upload-image

### TC-UPL-01 — Upload JPEG nominal

```
GIVEN : fichier JPEG 500 Ko
WHEN  : POST /api/upload-image?category=profiles (multipart)
THEN  : 200 + { url: "https://images.winek.app/profiles/...", filename: "..." }
```

### TC-UPL-02 — Upload PNG

```
GIVEN : fichier PNG
WHEN  : POST /upload-image?category=services
THEN  : 200 + url contient "/services/"
```

### TC-UPL-03 — Upload HEIC → converti en JPEG

```
GIVEN : fichier HEIC (iPhone)
WHEN  : POST /upload-image
THEN  : 200 + url se termine par .jpg (converti par Pillow)
```

### TC-UPL-04 — Fichier trop gros → 413

```
GIVEN : fichier 20 Mo
WHEN  : POST /upload-image
THEN  : 413 "Fichier trop volumineux (max 15 Mo)"
```

### TC-UPL-05 — Fichier non-image → 415

```
GIVEN : fichier PDF (magic bytes %PDF)
WHEN  : POST /upload-image
THEN  : 415 "Type de fichier non supporté..."
```

### TC-UPL-06 — Catégorie inconnue → fallback "other"

```
WHEN  : POST /upload-image?category=xxx
THEN  : 200 + URL contient "/other/" (pas xxx)
```

### TC-UPL-07 — Catégorie absente → "other"

```
WHEN  : POST /upload-image (pas de param category)
THEN  : 200 + URL contient "/other/"
```

### TC-UPL-08 — R2 down → fallback local

```
GIVEN : R2 retourne une erreur
WHEN  : POST /upload-image
THEN  : 200 + URL contient "/api/uploads/" (filesystem local)
```

### TC-UPL-09 — Auth absente → 401

```
WHEN  : POST /upload-image (pas de token)
THEN  : 401
```

### TC-UPL-10 — Upload WebP

```
GIVEN : fichier WebP
WHEN  : POST /upload-image
THEN  : 200 (magic bytes RIFF+WEBP reconnus)
```

---

## E. POST /push-token

### TC-PTK-01 — Enregistrement nominal

```
GIVEN : token "ExponentPushToken[abc]" n'existe pas
WHEN  : POST /api/push-token { token: "ExponentPushToken[abc]", platform: "expo" }
THEN  : 200 + { status: "registered" }
AND   : push_tokens contient l'entrée avec is_active=true
```

### TC-PTK-02 — Token existant même user → updated

```
GIVEN : token "ExponentPushToken[abc]" déjà en DB pour cet user
WHEN  : POST /push-token { token: "ExponentPushToken[abc]" }
THEN  : 200 + { status: "updated" }
AND   : is_active=true, last_used_at mis à jour
```

### TC-PTK-03 — Token existant autre user → transfert

```
GIVEN : token "ExponentPushToken[abc]" en DB pour user_other
WHEN  : POST /push-token { token: "ExponentPushToken[abc]" } (connecté en user_mine)
THEN  : 200 + { status: "registered" }
AND   : ancienne entrée is_active=false, nouvelle entrée user_id=user_mine is_active=true
```

### TC-PTK-04 — Format invalide → 400

```
WHEN  : POST /push-token { token: "not_expo_format" }
THEN  : 400 "Token Expo invalide"
```

### TC-PTK-05 — Auth absente → 401

```
WHEN  : POST /push-token (pas de token JWT)
THEN  : 401
```

---

## F. DELETE /push-token

### TC-PTD-01 — Désactivation nominale

```
GIVEN : token actif pour cet user
WHEN  : DELETE /api/push-token { token: "ExponentPushToken[abc]" }
THEN  : 200 + { status: "unregistered" }
AND   : push_tokens.is_active = false
```

### TC-PTD-02 — Token non trouvé → success (pas d'erreur)

```
GIVEN : token n'existe pas en DB
WHEN  : DELETE /push-token { token: "ExponentPushToken[xxx]" }
THEN  : 200 + { status: "unregistered" } (UPDATE 0 rows, pas d'erreur)
```

### TC-PTD-03 — Auth absente → 401

```
WHEN  : DELETE /push-token (pas de token JWT)
THEN  : 401
```

---

## Résumé

| Catégorie | Nombre | Couverture |
|---|---|---|
| A. PUT /profile | 10 | Nominal, clear, vide, JSONB, picture delete, multi-champs |
| B. POST /become-coach | 4 | Nominal, déjà coach, admin, auth |
| C. PATCH /cover | 5 | Nominal, ownership, sans offset, clear, auth |
| D. POST /upload-image | 10 | 5 formats, 413, 415, catégorie, fallback, auth |
| E. POST /push-token | 5 | Nominal, update, transfert, format, auth |
| F. DELETE /push-token | 3 | Nominal, absent, auth |
| **TOTAL** | **37** | |
