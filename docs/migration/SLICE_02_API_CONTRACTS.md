# SLICE_02_API_CONTRACTS.md — Contrat d'API exact
> Basé sur `auth_routes.py:92–95` + `auth_utils.py` + réponse API live (user_demo001).  
> Généré le 2026-04-12.

---

## ENDPOINT — GET /api/auth/me

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin complet | `/api/auth/me` |
| Tag FastAPI | (aucun tag explicite) |
| Auth requise | **OUI** — JWT Bearer obligatoire |
| Rate limiting | **NON** |
| Idempotent | OUI (lecture seule) |
| Handler Python | `get_me()` — `auth_routes.py:92-95` |
| Implémentation réelle | `require_auth(request, pool)` — `auth_utils.py:71-83` |

---

### Token — lecture exacte

Le token est lu dans cet ordre de priorité (`auth_utils.py:61-65`) :

1. **Header `Authorization: Bearer <token>`** (priorité 1)
2. **Cookie `winek_token`** (priorité 2, fallback)

```python
def get_token_from_request(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]       # strip "Bearer "
    return request.cookies.get("winek_token")
```

**Java** : lire `Authorization` header en premier, fallback sur cookie `winek_token`.

---

### Headers requis

| Header | Obligatoire | Valeur | Note |
|---|---|---|---|
| `Authorization` | OUI (si pas de cookie) | `Bearer <jwt_token>` | Case-sensitive : `Bearer ` avec espace |
| `Cookie: winek_token=<jwt>` | OUI (si pas de header) | JWT brut | Fallback si Authorization absent |

---

### Query params / Body

**Aucun.**

---

### Réponse — HTTP 200 (token valide, user trouvé)

```json
{
  "user_id": "user_demo001",
  "email": "user@winek.app",
  "name": "Thomas Dupont",
  "role": "coach",
  "language": "fr",
  "picture": "https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=150&w=150",
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

---

### Schéma de réponse détaillé

| Champ | Type JSON | Type Java | Nullable | Source DB | Note |
|---|---|---|---|---|---|
| `user_id` | `string` | `String` | NON | `users.user_id` TEXT | Format `"user_<hex12>"` |
| `email` | `string` | `String` | OUI | `users.email` TEXT | Email en minuscules |
| `name` | `string` | `String` | NON | `users.name` TEXT | |
| `role` | `string` | `String` | OUI | `users.role` TEXT | Valeurs : `"user"`, `"admin"`, `"coach"` |
| `language` | `string` | `String` | NON | `users.language` TEXT | Default `"fr"` |
| `picture` | `string\|null` | `String` | OUI | `users.picture` TEXT | URL ou null |
| `bio` | `string\|null` | `String` | OUI | `users.bio` TEXT | |
| `phone` | `string\|null` | `String` | OUI | `users.phone` TEXT | |
| `is_coach_verified` | `boolean\|null` | `Boolean` | OUI | `users.is_coach_verified` BOOLEAN | Default `false` en DB |
| `coach_tags` | `array` | `List<String>` | OUI | `users.coach_tags` JSONB | Tableau JSON de strings, default `[]` |
| `show_phone` | `boolean` | `boolean` | NON | `users.show_phone` BOOLEAN | Default `false` |
| `show_reviews` | `boolean` | `boolean` | NON | `users.show_reviews` BOOLEAN | Default `true` |
| `created_at` | `string` | `String` | OUI | `users.created_at` TIMESTAMPTZ | ISO 8601 avec tz : `"2026-04-01T12:51:14.682000+00:00"` |
| `updated_at` | `string` | `String` | OUI | `users.updated_at` TIMESTAMPTZ | ISO 8601 avec tz |
| `sports_level` | `string\|null` | `String` | OUI | `users.sports_level` TEXT | |
| `goals` | `array` | `List<Object>` | OUI | `users.goals` JSONB | Tableau JSON, default `[]` |
| `user_roles` | `array` | `List<Object>` | OUI | `users.user_roles` JSONB | Tableau JSON, default `[]` |
| `onboarding_done` | `boolean\|null` | `Boolean` | OUI | `users.onboarding_done` BOOLEAN | Default `false` |

**Total : 18 champs** — correspondance exacte avec `USER_FIELDS` dans `auth_utils.py:68`.

---

### Codes d'erreur

| Code HTTP | Condition | Corps de réponse | Source Python |
|---|---|---|---|
| `401` | Aucun token (header + cookie absents) | `{"detail": "Not authenticated"}` | `auth_utils.py:74` |
| `401` | Token invalide (malformé, signature incorrecte) | `{"detail": "Invalid token"}` | `auth_utils.py:57` |
| `401` | Token expiré (`exp` dans le passé) | `{"detail": "Token expired"}` | `auth_utils.py:52` |
| `401` | `user_id` du token absent en DB | `{"detail": "User not found"}` | `auth_utils.py:82` |
| `500` | DB inaccessible | Erreur FastAPI générique | non géré explicitement |

---

### Champs ABSENTS de la réponse (présents en DB mais exclus de USER_FIELDS)

Ces champs ne doivent **jamais** apparaître dans la réponse Java :

```
password_hash, encrypted_password
id (UUID Supabase)
iban, bic, iban_name
stripe_customer_id, stripe_account_id
cover_picture, cover_offset_y, cover_scale
deleted_at, deleted_by, anonymized_at
media_purge_scheduled_at, media_purged, media_purged_at, media_purge_notified_at
instance_id, aud, raw_app_meta_data, raw_user_meta_data, is_super_admin
banned_until, reactivated_at, last_sign_in_at
```
