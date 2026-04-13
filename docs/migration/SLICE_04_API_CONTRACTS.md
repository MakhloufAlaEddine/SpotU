# SLICE_04_API_CONTRACTS.md — Contrat d'API exact
> Basé sur `user_routes.py:99–235` + `spot_you_routes.py:27–109`.
> Généré le 2026-02-XX.

---

## ENDPOINT — GET /api/users/{user_id}/public

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin Python (prod) | `/api/users/{user_id}/public` |
| Chemin Java recommandé | `/api/users/{userId}/public` (identique) |
| Tag FastAPI | `users` |
| Auth requise | **NON — optionnelle** (comporte token ou non) |
| Rate limiting | **NON** |
| Idempotent | OUI (lecture seule) |
| Handler Python | `get_public_profile()` — `user_routes.py:99–235` |
| Auth optionnelle via | try/except sur `require_auth` — `user_routes.py:103–107` |

---

### Authentification — comportement exact

```python
# user_routes.py:103–107
try:
    me = await require_auth(request, pool)
    me_id = me["user_id"]
except Exception:
    me_id = None
```

**Règle critique :**
- Token valide → `me_id` = user_id de l'appelant (string)
- Token absent, invalide, expiré, ou user inexistant → `me_id = None` (pas d'erreur 401)
- L'endpoint fonctionne donc **sans token** (réponse complète mais sans `is_following`)

**Java :** Ne PAS injecter `@AuthenticationPrincipal` avec `required=true`.
Utiliser une auth optionnelle : `@AuthenticationPrincipal(required=false) JwtAuthPrincipal principal`.

---

### Path Parameters

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `user_id` | `string` | OUI | ID de l'utilisateur cible, format `"user_<hex12>"` |

---

### Query Params / Body

**Aucun.**

---

### Réponse — HTTP 200 : utilisateur NON-COACH, sans reviews publiques

```json
{
  "user_id": "user_abc123",
  "name": "Marie Martin",
  "picture": "https://example.com/photo.jpg",
  "cover_picture": null,
  "cover_offset_y": 0.5,
  "cover_scale": 1.0,
  "role": "user",
  "bio": "Passionnée de randonnée.",
  "is_coach_verified": false,
  "coach_tags": [],
  "show_phone": false,
  "show_reviews": false,
  "phone": null,
  "followers_count": 12,
  "following_count": 5,
  "is_following": false,
  "interests": [],
  "avg_rating": null,
  "review_count": 0,
  "tag_points": []
}
```
*(Pas de champ `services` — utilisateur non-coach)*

---

### Réponse — HTTP 200 : utilisateur COACH, avec reviews et tag_points

```json
{
  "user_id": "user_demo001",
  "name": "Thomas Dupont",
  "picture": "https://example.com/photo.jpg",
  "cover_picture": "https://example.com/cover.jpg",
  "cover_offset_y": 0.3,
  "cover_scale": 1.2,
  "role": "coach",
  "bio": "Coach fitness certifié.",
  "is_coach_verified": true,
  "coach_tags": ["tag_hatha", "tag_endurance"],
  "show_phone": true,
  "show_reviews": true,
  "phone": "+33 6 12 34 56 78",
  "followers_count": 148,
  "following_count": 23,
  "is_following": true,
  "interests": [
    { "tag_id": "tag_hatha", "label_fr": "Hatha Yoga", "label_en": "Hatha Yoga", "icon": "🧘" },
    { "tag_id": "tag_endurance", "label_fr": "Endurance", "label_en": "Endurance", "icon": "🏃" }
  ],
  "avg_rating": 4.7,
  "review_count": 23,
  "services": [
    {
      "service_id": "svc_abc123",
      "title": "Cours Hatha Yoga",
      "description": "Séance d'1h...",
      "price": 40.0,
      "duration_min": 60,
      "location_description": "Paris 11e",
      "max_participants": 10,
      "tag_ids": ["tag_hatha"],
      "domain_id": "dom_sport",
      "images": ["https://..."]
    }
  ],
  "tag_points": [
    {
      "point_id": "tp_xyz789",
      "title": "Running matinal",
      "images": ["https://..."],
      "event_date": null,
      "event_schedule": { "type": "weekly", "schedule": { "1": [{"start": "07:00"}] } },
      "domain_id": "dom_sport",
      "tag_ids": ["tag_endurance"],
      "minimum_participants": 2,
      "maximum_participants": 10,
      "participants_count": 7,
      "going_count": 5,
      "rating": 4.5,
      "vote_count": 12,
      "next_session_date": "2026-02-11",
      "is_full": false
    }
  ]
}
```

---

### Schéma de réponse détaillé — Champs fixes

#### Bloc 1 — Champs du profil public (toujours présents)

| Champ | Type JSON | Type Java | Nullable | Source DB | Note |
|---|---|---|---|---|---|
| `user_id` | `string` | `String` | NON | `users.user_id` | |
| `name` | `string` | `String` | NON | `users.name` | |
| `picture` | `string\|null` | `String` | OUI | `users.picture` | URL ou null |
| `cover_picture` | `string\|null` | `String` | OUI | `users.cover_picture` | |
| `cover_offset_y` | `number\|null` | `Double` | OUI | `users.cover_offset_y` FLOAT | Positionnement vertical cover |
| `cover_scale` | `number\|null` | `Double` | OUI | `users.cover_scale` FLOAT | Zoom cover |
| `role` | `string` | `String` | OUI | `users.role` | `"user"`, `"coach"`, `"admin"` |
| `bio` | `string\|null` | `String` | OUI | `users.bio` | |
| `is_coach_verified` | `boolean\|null` | `Boolean` | OUI | `users.is_coach_verified` | |
| `coach_tags` | `array` | `List<String>` | OUI | `users.coach_tags` JSONB | IDs bruts, voir aussi `interests` |
| `show_phone` | `boolean` | `boolean` | NON | `users.show_phone` | Flag utilisé + exposé |
| `show_reviews` | `boolean` | `boolean` | NON | `users.show_reviews` | Flag utilisé + exposé |
| `phone` | `string\|null` | `String` | OUI | `users.phone` | **Masqué** si `show_phone=false` |

#### Bloc 2 — Champs calculés (toujours présents)

| Champ | Type JSON | Type Java | Nullable | Source | Note |
|---|---|---|---|---|---|
| `followers_count` | `number` | `int` | NON | COUNT `user_follows` | Jamais null |
| `following_count` | `number` | `int` | NON | COUNT `user_follows` | Jamais null |
| `is_following` | `boolean` | `boolean` | NON | `user_follows` EXISTS | `false` si non auth ou me==target |
| `interests` | `array` | `List<TagDto>` | NON | `tags` JOIN | `[]` si pas de coach_tags |
| `avg_rating` | `number\|null` | `Double` | OUI | `reviews` | `null` si no reviews OU show_reviews=false |
| `review_count` | `number` | `int` | NON | `reviews` COUNT | `0` si no reviews OU show_reviews=false |
| `tag_points` | `array` | `List<TagPointPublicDto>` | NON | `tag_points` | `[]` si aucun |

#### Bloc 3 — Champ conditionnel (présent SEULEMENT si role=coach)

| Champ | Type JSON | Type Java | Condition | Source |
|---|---|---|---|---|
| `services` | `array` | `List<ServiceSummaryDto>` | `role == "coach"` uniquement | `services WHERE coach_id=X AND active=TRUE` |

**Attention :** Si `role != "coach"`, la clé `services` est **absente** de la réponse (pas `null`).

---

### Schéma `interests[]` (objet tag enrichi)

| Champ | Type | Source DB |
|---|---|---|
| `tag_id` | `string` | `tags.tag_id` |
| `label_fr` | `string` | `tags.label_fr` |
| `label_en` | `string` | `tags.label_en` |
| `icon` | `string\|null` | `tags.icon` |

---

### Schéma `services[]` (résumé service coach)

| Champ | Type | Source DB |
|---|---|---|
| `service_id` | `string` | `services.service_id` |
| `title` | `string` | `services.title` |
| `description` | `string\|null` | `services.description` |
| `price` | `number` | `services.price` NUMERIC |
| `duration_min` | `number` | `services.duration_min` INT |
| `location_description` | `string\|null` | `services.location_description` |
| `max_participants` | `number\|null` | `services.max_participants` INT |
| `tag_ids` | `array` | `services.tag_ids` JSONB |
| `domain_id` | `string\|null` | `services.domain_id` |
| `images` | `array` | `services.images` JSONB |

---

### Schéma `tag_points[]` (SpotYou enrichi)

#### Champs raw (SELECT tag_points)

| Champ | Type | Source DB |
|---|---|---|
| `point_id` | `string` | `tag_points.point_id` |
| `title` | `string` | `tag_points.title` |
| `images` | `array` | `tag_points.images` JSONB |
| `event_date` | `string\|null` | `tag_points.event_date` DATE |
| `event_schedule` | `object\|null` | `tag_points.event_schedule` JSONB |
| `domain_id` | `string\|null` | `tag_points.domain_id` |
| `tag_ids` | `array` | `tag_points.tag_ids` JSONB |
| `minimum_participants` | `number\|null` | `tag_points.minimum_participants` INT |
| `maximum_participants` | `number\|null` | `tag_points.maximum_participants` INT |

#### Champs enrichis (calculés en batch)

| Champ | Type | Nullable | Calcul |
|---|---|---|---|
| `participants_count` | `int` | NON | COUNT `spot_you_members` (tous statuts) |
| `going_count` | `int` | NON | COUNT `spot_you_attendance` WHERE status=`'going'` |
| `rating` | `float` | NON | AVG `tag_point_votes.rating` arrondi à 1 décimale, `0` si aucun vote |
| `vote_count` | `int` | NON | COUNT `tag_point_votes`, `0` si aucun |
| `next_session_date` | `string\|null` | OUI | `get_next_session_date()` — ISO date `"2026-02-11"` ou null |
| `is_full` | `boolean` | NON | `maximum_participants != null AND going_count >= maximum_participants` |

---

### Codes d'erreur

| Code HTTP | Condition | Corps | Source Python |
|---|---|---|---|
| `404` | `user_id` inexistant en DB | `{"detail": "User not found"}` | `user_routes.py:117` |
| `500` | DB inaccessible | Erreur FastAPI générique | Non géré explicitement |

**Note :** Contrairement aux slices précédentes, il n'y a **pas de 401** pour token absent.
Token invalide → `me_id = null` → `is_following = false`. Pas d'erreur.
