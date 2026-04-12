# SLICE_02_DB_MAPPING.md — Mapping DB exact
> Basé sur `auth_utils.py:68, 76-82` + `database.py:53-65` + schéma DB live Supabase.  
> Généré le 2026-04-12.

---

## Table lue : `users`

### Requête exacte exécutée (`auth_utils.py:77-79`)

```sql
SELECT user_id, email, name, role, language, picture, bio, phone,
       is_coach_verified, coach_tags, show_phone, show_reviews,
       created_at, updated_at, sports_level, goals, user_roles, onboarding_done
FROM users
WHERE user_id = $1
```

**Paramètre** : `user_id` issu du claim JWT (`payload["user_id"]`).  
**Résultat attendu** : 0 ou 1 ligne.

---

### Colonnes sélectionnées (USER_FIELDS) — 18 colonnes exactes

| # | Nom colonne | Type PostgreSQL | Nullable | Default DB | Retourné JSON |
|---|---|---|---|---|---|
| 1 | `user_id` | TEXT | NO | — | `"user_id"` string |
| 2 | `email` | TEXT | YES | — | `"email"` string ou null |
| 3 | `name` | TEXT | NO | — | `"name"` string |
| 4 | `role` | TEXT | NO | `'user'` | `"role"` string |
| 5 | `language` | TEXT | NO | `'fr'` | `"language"` string |
| 6 | `picture` | TEXT | YES | — | `"picture"` string ou null |
| 7 | `bio` | TEXT | YES | — | `"bio"` string ou null |
| 8 | `phone` | TEXT | YES | NULL | `"phone"` string ou null |
| 9 | `is_coach_verified` | BOOLEAN | YES | `false` | `"is_coach_verified"` boolean ou null |
| 10 | `coach_tags` | JSONB | YES | `'[]'::jsonb` | `"coach_tags"` array |
| 11 | `show_phone` | BOOLEAN | NO | `false` | `"show_phone"` boolean |
| 12 | `show_reviews` | BOOLEAN | NO | `true` | `"show_reviews"` boolean |
| 13 | `created_at` | TIMESTAMPTZ | YES | `now()` | `"created_at"` ISO string |
| 14 | `updated_at` | TIMESTAMPTZ | YES | `now()` | `"updated_at"` ISO string |
| 15 | `sports_level` | TEXT | YES | — | `"sports_level"` string ou null |
| 16 | `goals` | JSONB | YES | `'[]'::jsonb` | `"goals"` array |
| 17 | `user_roles` | JSONB | YES | `'[]'::jsonb` | `"user_roles"` array |
| 18 | `onboarding_done` | BOOLEAN | YES | `false` | `"onboarding_done"` boolean ou null |

---

### Colonnes présentes en DB mais EXCLUES de USER_FIELDS

> Ces colonnes ne doivent JAMAIS apparaître dans la réponse Java.

```
password_hash              -- sécurité : jamais retourné
encrypted_password         -- Supabase Auth legacy
id                         -- UUID Supabase Auth (différent de user_id TEXT)
instance_id                -- Supabase interne
aud                        -- Supabase Auth interne
iban, bic, iban_name       -- données financières sensibles
stripe_customer_id         -- Stripe
stripe_account_id          -- Stripe
cover_picture              -- non inclus dans USER_FIELDS (surprenant mais confirmé)
cover_offset_y             -- non inclus
cover_scale                -- non inclus
deleted_at, deleted_by     -- lifecycle
anonymized_at              -- RGPD
media_purge_*              -- workers
banned_until               -- modération
raw_app_meta_data          -- Supabase internal
raw_user_meta_data         -- Supabase internal
is_super_admin             -- Supabase internal
reactivated_at             -- lifecycle
```

---

### Transformations `row_to_dict` appliquées sur chaque colonne

| Colonne | Type asyncpg retourné | Transformation Python | Format JSON final |
|---|---|---|---|
| `user_id` | str | aucune | `"user_demo001"` |
| `email` | str | aucune | `"user@winek.app"` |
| `name` | str | aucune | `"Thomas Dupont"` |
| `role` | str | aucune | `"coach"` |
| `language` | str | aucune | `"fr"` |
| `picture` | str ou None | aucune | URL string ou null |
| `bio` | str ou None | aucune | string ou null |
| `phone` | str ou None | aucune | string ou null |
| `is_coach_verified` | bool ou None | aucune | `true` / `false` / null |
| `coach_tags` | list (décodé JSONB) | aucune | `["tag_hatha", ...]` |
| `show_phone` | bool | aucune | `true` / `false` |
| `show_reviews` | bool | aucune | `true` / `false` |
| `created_at` | datetime (aware, UTC) | `.isoformat()` | `"2026-04-01T12:51:14.682000+00:00"` |
| `updated_at` | datetime (aware, UTC) | `.isoformat()` | `"2026-04-02T13:36:04.382240+00:00"` |
| `sports_level` | str ou None | aucune | string ou null |
| `goals` | list (décodé JSONB) | aucune | `[]` ou `[...]` |
| `user_roles` | list (décodé JSONB) | aucune | `[]` ou `[...]` |
| `onboarding_done` | bool ou None | aucune | `true` / `false` / null |

---

### Format des timestamps (critique)

Python `datetime.isoformat()` sur un `datetime` avec timezone UTC produit :

```
"2026-04-01T12:51:14.682000+00:00"
```

- Séparateur : `T`
- Microsecondes incluses si non nulles (6 chiffres)
- Offset timezone : `+00:00` (et NON `Z`)

**Java** : utiliser `OffsetDateTime.toString()` ou `DateTimeFormatter.ISO_OFFSET_DATE_TIME`.  
Attention : Java produit par défaut `Z` pour UTC. Il faut forcer `+00:00` pour correspondre à Python.

**Option Java recommandée** :
```java
// Pour sérialiser en "2026-04-01T12:51:14.682000+00:00"
@JsonSerialize(using = OffsetDateTimeSerializer.class)
// avec formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXX")
```
Ou simplement stocker comme `String` (retourner la valeur brute de la DB via `rs.getString("created_at")`).

---

### Jointures

**Aucune jointure.** `SELECT ... FROM users WHERE user_id = $1` — table unique.

---

### Fallback

**Aucun fallback.** Si `user_id` n'est pas trouvé → `row = None` → `401 "User not found"`.  
Pas de valeur par défaut pour un utilisateur introuvable.

---

### Index utilisé

La colonne `user_id` (TEXT) est la clé applicative principale.  
**Index à vérifier** : s'assurer que `users.user_id` a un index (PRIMARY KEY ou UNIQUE INDEX) pour que le lookup soit O(1).

```sql
-- Vérifier depuis Supabase/psql :
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'users' AND indexdef LIKE '%user_id%';
```

---

### Note sur la colonne `email` dupliquée

Le schéma `users` a deux colonnes `email` (héritage Supabase Auth + colonnes applicatives).  
**USER_FIELDS sélectionne la première** rencontrée dans l'ordre `SELECT` — sans ambiguïté dans PostgreSQL car les deux ont le même nom et asyncpg prend la dernière en cas de dupliqué. En pratique, `users.email` TEXT (colonne applicative) retourne la bonne valeur.

**Java** : utiliser `rs.getString("email")` — JDBC retourne la première occurrence. Vérifier que la valeur est bien l'email applicatif et non null.
