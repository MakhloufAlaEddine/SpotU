# SLICE_24_DB_MAPPING.md — Mapping base de données
> Basé sur `user_routes.py`, `upload_routes.py`, `push_routes.py`.
> Généré le 2026-04-15.

---

## Table `users` — UPDATE dynamique

### PUT /profile — Colonnes modifiables (16)

| Colonne | Type DB | JSONB ? | Clearable (→NULL) ? |
|---|---|---|---|
| `name` | text NOT NULL | NON | NON (validation non-vide) |
| `bio` | text | NON | OUI |
| `phone` | text | NON | OUI |
| `language` | text | NON | NON |
| `picture` | text | NON | OUI |
| `coach_tags` | jsonb | **OUI** `::jsonb` | NON |
| `show_phone` | boolean | NON | NON |
| `show_reviews` | boolean | NON | NON |
| `iban` | text | NON | OUI |
| `bic` | text | NON | OUI |
| `iban_name` | text | NON | OUI |
| `sports_level` | text | NON | NON |
| `goals` | jsonb | **OUI** `::jsonb` | NON |
| `user_roles` | jsonb | **OUI** `::jsonb` | NON |
| `onboarding_done` | boolean | NON | NON |
| `updated_at` | timestamptz | NON | — (toujours NOW()) |

### POST /become-coach

```sql
UPDATE users SET role = 'coach', updated_at = NOW() WHERE user_id = $1
```

### PATCH /{uid}/cover

| Colonne | Type DB |
|---|---|
| `cover_picture` | text |
| `cover_offset_y` | double precision (défaut 0.5) |
| `cover_scale` | double precision (défaut 1.0) |
| `updated_at` | timestamptz |

---

## Table `push_tokens`

```sql
CREATE TABLE push_tokens (
    token_id     text NOT NULL PRIMARY KEY,
    user_id      text REFERENCES users(user_id) ON DELETE CASCADE,
    token        text NOT NULL UNIQUE,
    platform     text DEFAULT 'expo',
    is_active    boolean DEFAULT true,
    created_at   timestamptz DEFAULT now(),
    last_used_at timestamptz DEFAULT now()
);
```

### Opérations

| Endpoint | Op | SQL |
|---|---|---|
| POST /push-token | SELECT | `SELECT token_id, user_id FROM push_tokens WHERE token = $1` |
| POST /push-token | UPDATE (réactiver) | `UPDATE ... SET is_active=TRUE, last_used_at=NOW() WHERE token=$1` |
| POST /push-token | UPDATE (désactiver autre) | `UPDATE ... SET is_active=FALSE WHERE token=$1` |
| POST /push-token | INSERT | `INSERT ... ON CONFLICT (token) DO UPDATE SET user_id=$2, is_active=TRUE, last_used_at=NOW()` |
| DELETE /push-token | UPDATE | `UPDATE ... SET is_active=FALSE WHERE token=$1 AND user_id=$2` |

---

## Aucune migration de schéma requise

Tables `users` et `push_tokens` existent déjà.
