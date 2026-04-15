# SLICE_24_API_CONTRACTS.md — Contrats API
> Basé sur `user_routes.py:33–96,525–563`, `upload_routes.py`, `push_routes.py`.
> Généré le 2026-04-15.

---

## Endpoint 1 — `PUT /api/users/profile`

### Auth : **STRICTE** (`require_auth`)

### Requête (body partiel — tous les champs optionnels)

```json
{
  "name": "Jean Dupont",
  "bio": "Coach sportif à Paris",
  "phone": "+33612345678",
  "language": "fr",
  "picture": "https://images.winek.app/profiles/img_abc123.jpg",
  "coach_tags": ["tag_001", "tag_002"],
  "show_phone": true,
  "show_reviews": true,
  "iban": "FR76...",
  "bic": "BNPAFRPP",
  "iban_name": "Jean Dupont",
  "sports_level": "intermediate",
  "goals": ["perdre du poids", "gagner en muscle"],
  "user_roles": ["coach", "sportif"],
  "onboarding_done": true
}
```

| Champ | Type | Clearable (→NULL) | JSONB | Notes |
|---|---|---|---|---|
| `name` | string | NON | NON | Non vide après strip (400 sinon) |
| `bio` | string | OUI | NON | — |
| `phone` | string | OUI | NON | — |
| `language` | enum fr/en | NON | NON | — |
| `picture` | string | OUI | NON | URL image. Déclenche delete ancienne photo |
| `coach_tags` | string[] | NON | OUI `::jsonb` | Tags coach |
| `show_phone` | bool | NON | NON | — |
| `show_reviews` | bool | NON | NON | — |
| `iban` | string | OUI | NON | Coordonnées bancaires |
| `bic` | string | OUI | NON | — |
| `iban_name` | string | OUI | NON | — |
| `sports_level` | string | NON | NON | — |
| `goals` | string[] | NON | OUI `::jsonb` | — |
| `user_roles` | string[] | NON | OUI `::jsonb` | — |
| `onboarding_done` | bool | NON | NON | — |

### Réponse 200

Retourne le user complet mis à jour (18 champs `USER_FIELDS`).

### Erreurs

| Code | Condition | Detail |
|---|---|---|
| 400 | `name` présent mais vide | `"Le nom est obligatoire"` |
| 401 | Token invalide | `"Not authenticated"` |

### Effet de bord — Suppression ancienne photo

```python
if 'picture' in update_fields:
    old_picture = user.get("picture")
    if old_picture and old_picture != update_fields['picture']:
        delete_upload_file(old_picture)  # Supprime en R2 ou en local
```

### SQL dynamique

```python
# Construction SET dynamique avec JSONB cast
for key, val in update_fields.items():
    if key in {'coach_tags', 'goals', 'user_roles'} and isinstance(val, list):
        set_clauses.append(f"{key} = ${i}::jsonb")
    else:
        set_clauses.append(f"{key} = ${i}")
# UPDATE users SET name=$1, bio=$2, ..., updated_at=NOW() WHERE user_id=$N
```

### Comportement body vide

Si aucun champ n'est modifié (`update_fields` vide) → retourne le user actuel SANS UPDATE.

---

## Endpoint 2 — `POST /api/users/become-coach`

### Auth : **STRICTE**

### Requête : aucun body

### Réponse 200

Retourne le user complet avec `role: "coach"`.

### Erreurs

| Code | Condition | Detail |
|---|---|---|
| 400 | Déjà coach ou admin | `"Already a coach or admin"` |
| 401 | Token invalide | `"Not authenticated"` |

### SQL

```sql
UPDATE users SET role = 'coach', updated_at = NOW() WHERE user_id = $1
SELECT {USER_FIELDS} FROM users WHERE user_id = $1
```

### Points

- Transition `user → coach` uniquement (pas `admin → coach`)
- Pas de `is_coach_verified` changé (reste false — vérification admin séparée)

---

## Endpoint 3 — `PATCH /api/users/{user_id}/cover`

### Auth : **STRICTE** + ownership (`user_id == me.user_id`)

### Requête

```json
{
  "cover_picture": "https://images.winek.app/profiles/img_cover.jpg",
  "cover_offset_y": 0.3,
  "cover_scale": 1.2
}
```

| Champ | Type | Requis | Défaut |
|---|---|---|---|
| `cover_picture` | string | NON | `""` (si vide → NULL en DB) |
| `cover_offset_y` | float | NON | 0.5 (si cover_offset_y ou cover_scale présent) |
| `cover_scale` | float | NON | 1.0 |

### Réponse 200

```json
{
  "cover_picture": "https://...",
  "cover_offset_y": 0.3,
  "cover_scale": 1.2
}
```

### Erreurs

| Code | Condition | Detail |
|---|---|---|
| 403 | `user_id != me.user_id` | `"Accès refusé."` |
| 401 | Token invalide | `"Not authenticated"` |

### SQL conditionnel

```sql
-- Si cover_offset_y OU cover_scale présent dans le body :
UPDATE users SET cover_picture=$1, cover_offset_y=$2, cover_scale=$3, updated_at=NOW()
WHERE user_id=$4

-- Sinon :
UPDATE users SET cover_picture=$1, updated_at=NOW() WHERE user_id=$2
```

### Effet de bord — Suppression ancienne cover

```python
if old_cover and old_cover != (cover_url or None):
    delete_upload_file(old_cover)
```

---

## Endpoint 4 — `POST /api/upload-image`

### Auth : **STRICTE** | Content-Type : `multipart/form-data`

### Requête

```
POST /api/upload-image?category=profiles
Content-Type: multipart/form-data

file: <binary image data>
```

| Param | Type | Source | Requis | Défaut |
|---|---|---|---|---|
| `file` | UploadFile | multipart body | OUI | — |
| `category` | string | query param | NON | `"other"` |

### Catégories valides

`profiles`, `services`, `spotyou`, `chats`, `products`, `other`.
Toute valeur inconnue → fallback `"other"`.

### Réponse 200

```json
{
  "url": "https://images.winek.app/profiles/img_abc123.jpg",
  "filename": "img_abc123.jpg"
}
```

### Flow complet

```
1. Auth JWT
2. Valider catégorie (fallback "other")
3. Lire fichier (max 15 Mo)
   → 413 si dépassé
4. Détecter type via magic bytes (JPEG/PNG/GIF/WEBP/HEIC)
   → 415 si non reconnu
5. Comprimer via Pillow (r2_storage.compress_image)
   → Fallback : pas de compression si Pillow/r2_storage indisponible
6. Upload vers Cloudflare R2 (si configuré)
   → Fallback filesystem local si R2 échoue
7. Retourner {url, filename}
```

### Erreurs

| Code | Condition | Detail |
|---|---|---|
| 401 | Token invalide | `"Not authenticated"` |
| 413 | Fichier > 15 Mo | `"Fichier trop volumineux (max 15 Mo)"` |
| 415 | Magic bytes non reconnus | `"Type de fichier non supporté. Formats acceptés : JPEG, PNG, WebP, GIF, HEIC"` |

### Magic bytes détection

| Format | Signature |
|---|---|
| JPEG | `\xff\xd8\xff` (3 bytes) |
| PNG | `\x89PNG\r\n\x1a\n` (8 bytes) |
| GIF | `GIF87a` ou `GIF89a` (6 bytes) |
| WebP | `RIFF` + `WEBP` (bytes 0-3 + 8-11) |
| HEIC | `ftyp` (bytes 4-7) + brand `hei`/`hev`/`mif`/`msf`/`avi` |

### Stockage R2

```
URL publique : {R2_PUBLIC_URL}/{category}/{uuid_filename}.{ext}
Exemple : https://images.winek.app/profiles/abc123def456.jpg
```

### Fallback local

```
URL : {base_url}/api/uploads/{filename}
Fichier : /app/backend/uploads/{filename}
```

---

## Endpoint 5 — `POST /api/upload-image/debug-422`

Debug endpoint. Retourne les headers et les premiers bytes du body. **Pas d'auth.**

---

## Endpoint 6 — `POST /api/push-token`

### Auth : **STRICTE**

### Requête

```json
{
  "token": "ExponentPushToken[abc123...]",
  "platform": "expo"
}
```

| Champ | Type | Requis | Défaut | Validation |
|---|---|---|---|---|
| `token` | string | OUI | — | Doit commencer par `"ExponentPushToken["` |
| `platform` | string | NON | `"expo"` | — |

### Réponse 200

```json
{ "status": "registered" }
```
ou `{ "status": "updated" }` si le token existait déjà pour le même user.

### Flow

```
1. Auth
2. Valider format token (startswith "ExponentPushToken[")
   → 400 si invalide
3. SELECT push_tokens WHERE token = $1
4. Si existe + même user → UPDATE is_active=TRUE, last_used_at=NOW() → "updated"
5. Si existe + autre user → UPDATE is_active=FALSE (ancien), puis INSERT pour nouveau user
6. Si n'existe pas → INSERT avec ON CONFLICT DO UPDATE → "registered"
```

### SQL

```sql
-- Check existing
SELECT token_id, user_id FROM push_tokens WHERE token = $1

-- Update existing (same user)
UPDATE push_tokens SET is_active = TRUE, last_used_at = NOW() WHERE token = $1

-- Deactivate (other user)
UPDATE push_tokens SET is_active = FALSE WHERE token = $1

-- Insert new
INSERT INTO push_tokens (token_id, user_id, token, platform, is_active)
VALUES ($1, $2, $3, $4, TRUE)
ON CONFLICT (token) DO UPDATE SET user_id=$2, is_active=TRUE, last_used_at=NOW()
```

---

## Endpoint 7 — `DELETE /api/push-token`

### Auth : **STRICTE**

### Requête

```json
{
  "token": "ExponentPushToken[abc123...]",
  "platform": "expo"
}
```

### Réponse 200

```json
{ "status": "unregistered" }
```

### SQL

```sql
UPDATE push_tokens SET is_active = FALSE WHERE token = $1 AND user_id = $2
```

Pas de DELETE physique — soft-disable (`is_active=FALSE`).

---

## Helper partagé — `delete_upload_file(url)`

Utilisé par PUT /profile et PATCH /cover.

```python
def delete_upload_file(url):
    if not url: return
    # R2 URL → delete from R2
    if R2_PUBLIC_URL and url.startswith(R2_PUBLIC_URL):
        delete_from_r2(url)
        return
    # Local URL → delete from filesystem
    if "/api/uploads/" not in url: return  # URL externe (Pexels, etc.) → skip
    filename = url.split("/api/uploads/")[-1]
    filepath.unlink(missing_ok=True)
```
