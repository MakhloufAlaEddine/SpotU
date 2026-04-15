# SLICE_26_DB_MAPPING.md — Mapping base de données
> Généré le 2026-04-15.

---

## Tables impliquées (7 tables, lecture seule)

### `tag_points` — Table principale

| Colonne clé | Type | Rôle |
|---|---|---|
| `point_id` | text PK | ID SpotYou |
| `user_id` | text FK | Owner |
| `location` | geography(Point,4326) | PostGIS — search, similar, distance |
| `active` | boolean | Filtre principal |
| `tag_ids` | jsonb | Tags (array string IDs) — search filter, similar match |
| `precision` | text | "exact", "100m", "1000m" — masquage coordonnées |
| `visibility_type` | text | "public", "private", "members_only" |
| `join_mode` | text | "open", "admin_approval", "members_approval" |
| `schedule` | jsonb | Horaires récurrents (pour next_session_date) |
| `event_date`, `event_end_date` | timestamptz | Événement ponctuel |

### `spot_you_members`

| Colonne | Rôle |
|---|---|
| `spot_you_id`, `user_id`, `status`, `joined_at` | Membership (accepted/pending/invited/rejected) |

### `spot_you_attendance`

| Colonne | Rôle |
|---|---|
| `spot_you_id`, `user_id`, `session_date`, `status` | Going/not going par session |

### `tag_point_saves`

| Colonne | Rôle |
|---|---|
| `point_id`, `user_id`, `saved_at` | Sauvegarde SpotYou (JOIN pour /saved) |

### `tag_point_votes`

| Colonne | Rôle |
|---|---|
| `point_id`, `rating` | AVG, COUNT, distribution (détail) |

### `tags`

| Colonne | Rôle |
|---|---|
| `tag_id`, `name`, `label_fr`, `label_en`, `category_id` | Labels des tags (détail) |

### `users`

| Colonne | Rôle |
|---|---|
| `name`, `picture`, `role` | Owner info (JOIN) |

---

## Requêtes par endpoint (résumé)

| Endpoint | Queries | Parallèles |
|---|---|---|
| search | 1 | — |
| mine | 1 + 3 batch | — |
| saved | 1 + 3 batch | — |
| detail | 1 + 4 + 3 + 0-1 | 4 gather + 3 gather |
| similar | 2 (1 read point + 1 search) | — |
| participants | 1 | — |
| pending-requests | 1 | — |

---

## PostGIS operators utilisés

| Operator | Endpoints | Rôle |
|---|---|---|
| `ST_DWithin(a, b, radius)` | search, similar | Filtre rayon |
| `ST_Distance(a, b)` | search, similar | Calcul distance |
| `location <-> point` | search | Nearest neighbor index sort |
| `ST_MakePoint(lng, lat)` | search | Construction point |
| `ST_X(geom)`, `ST_Y(geom)` | tous (TP_FIELDS) | Extraction lon/lat |

## JSONB operators

| Operator | Endpoint | Rôle |
|---|---|---|
| `tag_ids ?| ARRAY[...]` | search | Contains any (filtre tags) |
| `jsonb_typeof(tag_ids)` | similar | Détecte array vs string |
| `jsonb_array_elements_text(tag_ids)` | similar | Unnest pour comparaison |
| `tag_ids #>> '{}'` | similar | Unwrap double-encodage |
