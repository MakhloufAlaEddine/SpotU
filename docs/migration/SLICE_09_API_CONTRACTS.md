# SLICE_09_API_CONTRACTS.md — Contrat d'API exact
> Basé sur `service_routes.py:352–413`, `service_routes.py:718–753`.
> Généré le 2026-02-XX.

---

## ENDPOINT 1 — GET /api/services (liste / recherche)

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin Python | `/api/services` |
| Chemin Java | `/api/services` |
| Auth | **SOFT** — token optionnel lu inline (pas de 401) |
| Pagination | **NON** — `LIMIT 100` hardcodé |
| Tri | Aucun tri explicite (ordre naturel PostgreSQL) |
| Handler | `search_services()` — `service_routes.py:352–413` |

### Query Parameters

| Param | Type | Obligatoire | Défaut | Description |
|---|---|---|---|---|
| `lat` | `float` | NON | `null` | Latitude GPS pour filtre géo |
| `lng` | `float` | NON | `null` | Longitude GPS pour filtre géo |
| `radius` | `int` | NON | `10000` | Rayon en mètres (utilisé seulement si lat+lng présents) |
| `coach_id` | `string` | NON | `null` | Filtre par coach (public — affiche les services d'un coach spécifique) |
| `domain_id` | `string` | NON | `null` | Filtre par domaine |

**Note :** Si `lat` et `lng` sont tous les deux fournis, le filtre géo s'applique via `ST_DWithin`. Si l'un est manquant, le filtre est ignoré.

### Réponse — HTTP 200

```json
[
  {
    "service_id": "svc_abc123",
    "coach_id": "user_coach001",
    "title": "Cours Hatha Yoga",
    "description": "Séance d'1h en groupe...",
    "address": "Rue de la Paix, Paris",
    "price": 40.00,
    "duration_min": 60,
    "tag_ids": ["tag_hatha"],
    "domain_id": "dom_sport",
    "location_description": "Paris 8e",
    "max_participants": 10,
    "active": true,
    "images": ["https://..."],
    "created_at": "2026-03-01T10:00:00.000000+00:00",
    "updated_at": "2026-04-01T12:00:00.000000+00:00",
    "booking_approval_mode": "instant_booking",
    "allow_pay_later": false,
    "pay_later_expiration_minutes": null,
    "coach": {
      "user_id": "user_coach001",
      "name": "Thomas Dupont",
      "picture": "https://...",
      "is_coach_verified": true
    },
    "avg_rating": 4.3,
    "review_count": 7,
    "locations": [
      {
        "location_id": "loc_xyz",
        "precision": "100m",
        "description": "Rue de la Paix",
        "latitude": 48.8698,
        "longitude": 2.3309
      }
    ],
    "tags": [
      {"tag_id": "tag_hatha", "label_fr": "Hatha Yoga", "label_en": "Hatha Yoga", "category_id": "cat_yoga"}
    ],
    "slots": [],
    "packages": [],
    "is_owner": false
  }
]
```

### Schéma d'un service (liste)

#### Champs raw SVC_FIELDS (18)

| Champ | Type JSON | Java | Nullable |
|---|---|---|---|
| `service_id` | string | String | NON |
| `coach_id` | string | String | OUI |
| `title` | string | String | NON |
| `description` | string\|null | String | OUI |
| `address` | string\|null | String | OUI — masqué selon precision |
| `price` | number | `BigDecimal` | NON |
| `duration_min` | number | int | OUI (default 60) |
| `tag_ids` | array | List<String> | OUI |
| `domain_id` | string\|null | String | OUI |
| `location_description` | string\|null | String | OUI |
| `max_participants` | number | int | OUI (default 1) |
| `active` | boolean | boolean | OUI |
| `images` | array | List<String> | OUI |
| `created_at` | string ISO | String | OUI |
| `updated_at` | string ISO | String | OUI |
| `booking_approval_mode` | string | String | NON |
| `allow_pay_later` | boolean | boolean | NON |
| `pay_later_expiration_minutes` | number\|null | Integer | OUI |

#### Champs enrichis (ajoutés par `_batch_enrich_services_for_search`)

| Champ | Type JSON | Java | Note |
|---|---|---|---|
| `coach` | object | `CoachSummaryDto` | 4 champs : user_id, name, picture, is_coach_verified |
| `avg_rating` | number\|null | Double | Par coach_id — null si 0 reviews |
| `review_count` | number | int | 0 si aucun |
| `locations` | array | List<LocationDto> | Adresses masquées selon precision |
| `tags` | array | List<TagDto> | Détail des tags — label_fr, label_en, category_id |
| `slots` | array | List | **Toujours `[]`** dans la vue liste |
| `packages` | array | List | **Toujours `[]`** dans la vue liste |
| `is_owner` | boolean | boolean | **Toujours `false`** dans la vue liste |

---

## ENDPOINT 2 — GET /api/services/{service_id} (détail)

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin Python | `/api/services/{service_id}` |
| Chemin Java | `/api/services/{serviceId}` |
| Auth | **OPTIONNELLE** (`get_optional_auth`) — pas de 401 |
| Handler | `get_service()` — `service_routes.py:718–736` |

### Path Parameters

| Paramètre | Type | Obligatoire |
|---|---|---|
| `service_id` | string | OUI |

### Réponse — HTTP 200 (non-propriétaire)

Identique au schéma liste MAIS avec les différences suivantes :

| Champ | Vue liste | Vue détail |
|---|---|---|
| `slots` | `[]` | Liste réelle des créneaux futurs sans réservation active |
| `packages` | `[]` | Liste réelle des formules avec leurs créneaux |
| `is_owner` | `false` | `true` si viewer = coach ou admin |
| `original_address` | Absent | Présent si is_owner=true ET precision ≠ exact |
| `locations[].original_description` | Absent | Présent si is_owner=true ET precision ≠ exact |

### Schéma `slots[]` (dans vue détail uniquement)

| Champ | Type | Note |
|---|---|---|
| `slot_id` | string | |
| `slot_type` | string | ex: `"individual"`, `"group"` |
| `slot_status` | string | ex: `"available"` |
| `location_id` | string\|null | FK service_locations |
| `package_id` | string\|null | FK service_packages |
| `day_of_week` | number\|null | 0=Lun (legacy single-day) |
| `days_of_week` | array\|null | JSONB — jours multiples |
| `start_time` | string | ex: `"09:00:00"` |
| `end_time` | string\|null | |
| `slot_date` | string\|null | ISO date ponctuelle |

### Schéma `packages[]` (dans vue détail uniquement)

| Champ | Type | Note |
|---|---|---|
| `package_id` | string | |
| `type_id` | string\|null | |
| `type_label` | string\|null | |
| `duration_min` | number | |
| `max_participants` | number\|null | |
| `price` | number | |
| `slots` | array | Créneaux du package (même filtrage que slots) |

### Codes d'erreur

| Endpoint | Code | Condition | Corps |
|---|---|---|---|
| GET /services | Aucun | Filtre vide → `[]` | `[]` |
| GET /services/{id} | 404 | `service_id` inexistant | `{"detail": "Service not found"}` |
| Les deux | 500 | DB inaccessible | Non géré |
