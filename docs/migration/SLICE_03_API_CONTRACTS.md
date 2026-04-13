# SLICE_03_API_CONTRACTS.md — Contrat d'API exact
> Basé sur `user_routes.py:11–30` + `auth_utils.py:68–83`.
> Généré le 2026-02-XX.

---

## ENDPOINT — GET /api/users/profile (Java cible : GET /api/users/me)

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin Python (prod) | `/api/users/profile` |
| Chemin Java recommandé | `/api/users/me` |
| Tag FastAPI | `users` |
| Auth requise | **OUI** — JWT Bearer obligatoire |
| Rate limiting | **NON** |
| Idempotent | OUI (lecture seule) |
| Handler Python | `get_profile()` — `user_routes.py:11–30` |
| Implémentation auth | `require_auth(request, pool)` — `auth_utils.py:71–83` (identique Slice 02) |

---

### Token — lecture exacte

Identique à Slice 02. Le token est lu dans cet ordre (`auth_utils.py:61–65`) :

1. **Header `Authorization: Bearer <token>`** (priorité 1)
2. **Cookie `winek_token`** (priorité 2, fallback)

```python
def get_token_from_request(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return request.cookies.get("winek_token")
```

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
  "picture": "https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg",
  "bio": "Passionné de sport et de running.",
  "phone": "+33 6 12 34 56 78",
  "is_coach_verified": true,
  "coach_tags": ["tag_hatha", "tag_prise_masse", "tag_endurance"],
  "show_phone": true,
  "show_reviews": true,
  "created_at": "2026-04-01T12:51:14.682000+00:00",
  "updated_at": "2026-04-02T13:36:04.382240+00:00",
  "sports_level": null,
  "goals": [],
  "user_roles": [],
  "onboarding_done": false,
  "avg_rating": 4.3,
  "review_count": 7,
  "iban": "FR76 3000 6000 0112 3456 7890 189",
  "bic": "BNPAFRPPXXX",
  "iban_name": "Thomas Dupont"
}
```

---

### Schéma de réponse détaillé

#### Bloc 1 — Champs USER_FIELDS (hérités de Slice 02, identiques)

| Champ | Type JSON | Type Java | Nullable | Source DB | Note |
|---|---|---|---|---|---|
| `user_id` | `string` | `String` | NON | `users.user_id` TEXT | Format `"user_<hex12>"` |
| `email` | `string` | `String` | OUI | `users.email` TEXT | Minuscules |
| `name` | `string` | `String` | NON | `users.name` TEXT | |
| `role` | `string` | `String` | OUI | `users.role` TEXT | `"user"`, `"coach"`, `"admin"` |
| `language` | `string` | `String` | NON | `users.language` TEXT | Default `"fr"` |
| `picture` | `string\|null` | `String` | OUI | `users.picture` TEXT | URL ou null |
| `bio` | `string\|null` | `String` | OUI | `users.bio` TEXT | |
| `phone` | `string\|null` | `String` | OUI | `users.phone` TEXT | |
| `is_coach_verified` | `boolean\|null` | `Boolean` | OUI | `users.is_coach_verified` BOOLEAN | |
| `coach_tags` | `array` | `List<String>` | OUI | `users.coach_tags` JSONB | Default `[]` |
| `show_phone` | `boolean` | `boolean` | NON | `users.show_phone` BOOLEAN | Default `false` |
| `show_reviews` | `boolean` | `boolean` | NON | `users.show_reviews` BOOLEAN | Default `true` |
| `created_at` | `string` | `String` | OUI | `users.created_at` TIMESTAMPTZ | ISO 8601 avec tz |
| `updated_at` | `string` | `String` | OUI | `users.updated_at` TIMESTAMPTZ | ISO 8601 avec tz |
| `sports_level` | `string\|null` | `String` | OUI | `users.sports_level` TEXT | |
| `goals` | `array` | `List<Object>` | OUI | `users.goals` JSONB | Default `[]` |
| `user_roles` | `array` | `List<Object>` | OUI | `users.user_roles` JSONB | Default `[]` |
| `onboarding_done` | `boolean\|null` | `Boolean` | OUI | `users.onboarding_done` BOOLEAN | Default `false` |

**Sous-total : 18 champs** (identiques à `GET /api/auth/me`)

#### Bloc 2 — Champs supplémentaires (NOUVEAUX par rapport à Slice 02)

| Champ | Type JSON | Type Java | Nullable | Source DB | Calcul |
|---|---|---|---|---|---|
| `avg_rating` | `number\|null` | `Double` | **OUI** | `reviews.rating` NUMERIC | `null` si 0 avis ; `round(sum / count, 1)` sinon |
| `review_count` | `number` | `int` | NON | `reviews` (COUNT) | `0` si aucun avis (jamais null) |
| `iban` | `string\|null` | `String` | OUI | `users.iban` TEXT | Null si non renseigné |
| `bic` | `string\|null` | `String` | OUI | `users.bic` TEXT | Null si non renseigné |
| `iban_name` | `string\|null` | `String` | OUI | `users.iban_name` TEXT | Null si non renseigné |

**Sous-total : 5 champs supplémentaires**

**TOTAL : 23 champs** dans la réponse.

---

### Différences clés avec `GET /api/auth/me` (Slice 02)

| Dimension | Slice 02 `/api/auth/me` | Slice 03 `/api/users/profile` |
|---|---|---|
| Nombre de champs | 18 | 23 (+5) |
| Requêtes DB | 1 | 3 |
| Données bancaires | Absentes | `iban`, `bic`, `iban_name` exposés |
| Données de réputation | Absentes | `avg_rating`, `review_count` calculés |
| Idempotence | OUI | OUI |
| Auth | Identique | Identique |

---

### Codes d'erreur

| Code HTTP | Condition | Corps de réponse | Source Python |
|---|---|---|---|
| `401` | Aucun token | `{"detail": "Not authenticated"}` | `auth_utils.py:74` |
| `401` | Token malformé / signature invalide | `{"detail": "Invalid token"}` | `auth_utils.py:57` |
| `401` | Token expiré | `{"detail": "Token expired"}` | `auth_utils.py:52` |
| `401` | `user_id` absent en DB | `{"detail": "User not found"}` | `auth_utils.py:82` |
| `500` | DB inaccessible | Erreur FastAPI générique | Non géré explicitement |

---

### Champs ABSENTS de la réponse (présents en DB mais exclus)

Identiques à Slice 02 :

```
password_hash, encrypted_password
id (UUID Supabase)
stripe_customer_id, stripe_account_id
cover_picture, cover_offset_y, cover_scale
deleted_at, deleted_by, anonymized_at
media_purge_scheduled_at, media_purged, media_purged_at, media_purge_notified_at
instance_id, aud, raw_app_meta_data, raw_user_meta_data, is_super_admin
banned_until, reactivated_at, last_sign_in_at
```

**Note :** `iban`, `bic`, `iban_name` sont dans cette liste pour `GET /api/auth/me`,
mais ils SONT exposés dans `GET /api/users/profile`. C'est intentionnel.
