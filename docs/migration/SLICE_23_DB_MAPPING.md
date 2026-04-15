# SLICE_23_DB_MAPPING.md — Mapping base de données
> Basé sur `auth_routes.py`, `auth_utils.py`, `migrations/001_initial_schema.sql:570–598`.
> Généré le 2026-04-13.

---

## Table unique — `users`

### Schéma (28 colonnes)

```sql
CREATE TABLE public.users (
    user_id              text NOT NULL PRIMARY KEY,
    email                text,                          -- UNIQUE (index)
    password_hash        text,                          -- NULL pour Google users
    name                 text NOT NULL,
    role                 text DEFAULT 'user' NOT NULL,  -- user, coach, admin
    language             text DEFAULT 'fr' NOT NULL,    -- fr, en
    picture              text,
    bio                  text,
    phone                text,
    is_coach_verified    boolean DEFAULT false,
    coach_tags           jsonb DEFAULT '[]'::jsonb,
    created_at           timestamptz DEFAULT now(),
    updated_at           timestamptz DEFAULT now(),
    show_phone           boolean DEFAULT false NOT NULL,
    show_reviews         boolean DEFAULT true NOT NULL,
    iban                 text,                          -- hors USER_FIELDS
    bic                  text,                          -- hors USER_FIELDS
    iban_name            text,                          -- hors USER_FIELDS
    stripe_customer_id   text,                          -- hors USER_FIELDS (S21)
    stripe_account_id    text,                          -- hors USER_FIELDS
    cover_picture        text,                          -- hors USER_FIELDS
    cover_offset_y       double precision DEFAULT 0.5,  -- hors USER_FIELDS
    cover_scale          double precision DEFAULT 1.0,  -- hors USER_FIELDS
    sports_level         text,
    goals                jsonb DEFAULT '[]'::jsonb,
    user_roles           jsonb DEFAULT '[]'::jsonb,
    onboarding_done      boolean DEFAULT false
);
```

### Index pertinents

```sql
CREATE UNIQUE INDEX users_email_unique ON users (email);
-- Pas d'index explicite trouvé, mais la contrainte UNIQUE email est implicite
```

---

## Opérations par endpoint

### `POST /auth/register`

| # | Op | SQL | Colonnes |
|---|---|---|---|
| 1 | SELECT | `SELECT user_id FROM users WHERE email = $1` | email (lowercase) |
| 2 | INSERT | `INSERT INTO users (user_id, email, password_hash, name, role, language, coach_tags) VALUES (...)` | 7 colonnes |
| 3 | SELECT | `SELECT {USER_FIELDS} FROM users WHERE user_id = $1` | 18 colonnes |

**Colonnes insérées** :

| Colonne | Valeur | Source |
|---|---|---|
| `user_id` | `new_id("user")` = `"user_" + 12 hex` | Généré |
| `email` | `data.email.lower()` | Body (lowercase) |
| `password_hash` | `bcrypt.hashpw(password, gensalt())` | Calculé |
| `name` | `data.name` (stripped) | Body |
| `role` | `'user'` | Hardcodé |
| `language` | `data.language` ou `'fr'` | Body ou défaut |
| `coach_tags` | `'[]'::jsonb` | Hardcodé |

**Colonnes NON insérées** (défauts DB) :
- `picture` → NULL
- `bio` → NULL
- `phone` → NULL
- `is_coach_verified` → false
- `show_phone` → false
- `show_reviews` → true
- `created_at` → now()
- `updated_at` → now()
- `sports_level` → NULL
- `goals` → `[]`
- `user_roles` → `[]`
- `onboarding_done` → false

### `POST /auth/login`

| # | Op | SQL | Colonnes |
|---|---|---|---|
| 1 | SELECT | `SELECT user_id, password_hash, role FROM users WHERE email = $1` | 3 colonnes |
| 2 | SELECT | `SELECT {USER_FIELDS} FROM users WHERE user_id = $1` | 18 colonnes |

**Pas d'écriture.** Login est en lecture seule.

### `POST /auth/google`

**Cas 1 — User existant (login)** :

| # | Op | SQL |
|---|---|---|
| 1 | SELECT | `SELECT {USER_FIELDS} FROM users WHERE email = $1` |
| 2 | UPDATE | `UPDATE users SET name = $1, picture = $2, updated_at = NOW() WHERE email = $3` |
| 3 | SELECT | `SELECT {USER_FIELDS} FROM users WHERE email = $1` (re-read post-update) |

**Cas 2 — Nouveau user (register)** :

| # | Op | SQL |
|---|---|---|
| 1 | SELECT | `SELECT {USER_FIELDS} FROM users WHERE email = $1` → NULL |
| 2 | INSERT | `INSERT INTO users (user_id, email, name, picture, role, language, coach_tags) VALUES (...)` |
| 3 | SELECT | `SELECT {USER_FIELDS} FROM users WHERE user_id = $1` |

**Différences avec register classique** :
- `picture` est insérée (provient de Google)
- `password_hash` est **NULL** (pas de password)
- `language` est hardcodé `'fr'` (pas configurable via Google)

### `GET /auth/me`

| # | Op | SQL |
|---|---|---|
| 1 | SELECT | `SELECT {USER_FIELDS} FROM users WHERE user_id = $1` |

Lecture seule. `user_id` provient du JWT décodé.

### `POST /auth/logout`

| # | Op | SQL |
|---|---|---|
| 1 | SELECT | `SELECT {USER_FIELDS} FROM users WHERE user_id = $1` (via require_auth) |

Lecture seule. Pas d'écriture DB.

### `PUT /auth/change-password`

| # | Op | SQL |
|---|---|---|
| 1 | SELECT | (require_auth) `SELECT {USER_FIELDS} FROM users WHERE user_id = $1` |
| 2 | SELECT | `SELECT password_hash FROM users WHERE user_id = $1` |
| 3 | UPDATE | `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2` |

---

## Aucune migration de schéma requise

La table `users` existe déjà avec toutes les colonnes nécessaires. Aucune DDL.
