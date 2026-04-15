# SLICE_25_DB_MAPPING.md — Mapping base de données
> Basé sur `home_routes.py`.
> Généré le 2026-04-15.

---

## Tables impliquées (6 tables, lecture seule)

### `tag_points` — SpotYou

| Colonne | Type | Rôle feed |
|---|---|---|
| `point_id` | text PK | ID SpotYou |
| `user_id` | text FK | Owner (exclu si c'est le user connecté) |
| `title`, `description` | text | Affichage |
| `location` | geography(Point,4326) | **PostGIS** — filtre distance + tri |
| `active` | boolean | Filtre `WHERE active = TRUE` |
| `cancelled` | boolean | Affiché dans la réponse |
| `tag_ids` | jsonb | Scoring tags communs |
| `domain_id` | text | Catégorisation |
| `image_url`, `images` | text, jsonb | Médias |
| `visibility_type` | text | public/private/members_only |
| `schedule` | jsonb | Horaires récurrents |
| `event_date`, `event_end_date` | timestamptz | Événement ponctuel |
| `precision` | text | exact/100m/1000m |
| `minimum_participants`, `maximum_participants` | int | Calcul is_full |

### `services`

| Colonne | Type | Rôle feed |
|---|---|---|
| `service_id` | text PK | ID service |
| `coach_id` | text FK | Owner coach |
| `title`, `description`, `address` | text | Affichage |
| `price` | numeric | Affiché |
| `duration_min` | int | Affiché |
| `tag_ids` | jsonb | Scoring tags communs |
| `domain_id` | text | Catégorisation |
| `images` | jsonb | Médias |
| `active` | boolean | Filtre |
| `max_participants` | int | Affiché |

### `service_locations`

| Colonne | Type | Rôle feed |
|---|---|---|
| `service_id` | text FK | JOIN avec services |
| `location` | geography(Point,4326) | **PostGIS** — filtre distance + distance minimale |

### `users` (JOIN)

| Colonne | Rôle |
|---|---|
| `name`, `picture`, `role` | Owner/coach info affichée |
| `coach_tags` | Tags du user connecté pour scoring |

### `spot_you_members`

| Colonne | Rôle |
|---|---|
| `spot_you_id`, `user_id` | Member IDs pour scoring bonus + `is_going` batch |

### `spot_you_attendance`

| Colonne | Rôle |
|---|---|
| `spot_you_id`, `user_id`, `status`, `session_date` | going_count + is_going |

### `bookings` (COUNT)

| Rôle |
|---|
| booking_count par service (status NOT IN cancelled/expired) |

---

## Requêtes par endpoint

### `GET /home/nearest-sector` — 2 requêtes

1. `SELECT ... FROM tag_points ... ORDER BY ST_Distance(...) LIMIT 1`
2. `SELECT COUNT(*) FROM tag_points WHERE ST_DWithin(..., 50000)`

### `GET /home/feed` — 3-4 requêtes × 1-4 itérations

Par itération (auto-expansion) :
1. SpotYou query (60+ lignes SQL) — `SELECT ... FROM tag_points ... WHERE ST_DWithin(..., radius) ... LIMIT 60`
2. Batch is_going (si connecté) — `SELECT DISTINCT spot_you_id FROM spot_you_attendance WHERE ... AND user_id=$1`
3. Services query — `SELECT ... FROM services ... WHERE EXISTS(service_locations ST_DWithin...) ... LIMIT 40`

Pré-feed (1 fois) :
4. User tags — `SELECT coach_tags FROM users WHERE user_id=$1`
5. Member spots — `SELECT spot_you_id FROM spot_you_members WHERE user_id=$1`

**Total worst case** : 2 + 4×3 = 14 requêtes (4 itérations d'expansion).
**Total nominal** : 2 + 1×3 = 5 requêtes (1 seule itération suffit).

---

## PostGIS — Fonctions utilisées (résumé Java)

| Fonction PostGIS | Usage Java (native query) |
|---|---|
| `ST_MakePoint(lng, lat)` | Identique — native query passthrough |
| `ST_SetSRID(geom, 4326)` | Identique |
| `ST_DWithin(a::geography, b::geography, meters)` | Identique — **metres pas km** |
| `ST_Distance(a::geography, b::geography)` | Identique — retourne **metres** |
| `ST_X(point::geometry)` | Identique — extrait **longitude** |
| `ST_Y(point::geometry)` | Identique — extrait **latitude** |
| `location::geography` | Cast geography — la colonne est déjà geography(Point,4326) |
| `location::geometry` | Cast geometry pour ST_X/ST_Y |

---

## Aucune migration de schéma requise

PostGIS doit être installé (`CREATE EXTENSION IF NOT EXISTS postgis;`) mais est déjà présent dans le schéma de production. Les tables et colonnes existent.
