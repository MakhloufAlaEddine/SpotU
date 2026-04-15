# SLICE_26_API_CONTRACTS.md — Contrats API SpotYou lectures
> Basé sur `tagpoint_routes.py:146–651,1303–1347`.
> Généré le 2026-04-15.

---

## Endpoint 1 — `GET /api/tag-points` (Search)

### Auth : **OPTIONNELLE** | Pas de rate limit

### Requête

```
GET /api/tag-points?lat=48.8566&lng=2.3522&radius=10000&domain_id=dom_001&tag_ids=tag_001,tag_002
```

| Param | Type | Requis | Défaut | Rôle |
|---|---|---|---|---|
| `lat` | float | NON | null | Latitude centre recherche |
| `lng` | float | NON | null | Longitude |
| `radius` | int | NON | 5000 | Rayon en mètres |
| `domain_id` | string | NON | null | Filtre domaine |
| `tag_ids` | string | NON | null | IDs séparés par virgules |

### Réponse 200

```json
[
  {
    "point_id": "sp_abc",
    "title": "...",
    "location": { "type": "Point", "coordinates": [2.3388, 48.8612] },
    "latitude": 48.8612,
    "longitude": 2.3388,
    "owner": { "user_id": "...", "name": "...", "picture": "...", "role": "..." },
    "rating": 4.2,
    "vote_count": 15,
    "participants_count": 8,
    "distance": 850.5,
    "is_owner": false,
    ...
  }
]
```

### SQL dynamique (6 conditions optionnelles)

```sql
SELECT {TP_FIELDS}, ST_Distance(...) as distance
FROM tag_points tp LEFT JOIN users u ON ...
WHERE active = TRUE
  [AND tp.user_id != $N]                    -- si connecté
  [AND ST_DWithin(..., $radius)]             -- si lat/lng
  [AND domain_id = $N]                       -- si domain_id
  [AND tag_ids ?| ARRAY[$N, $N+1, ...]]     -- si tag_ids
ORDER BY location <-> point                   -- si lat/lng (nearest neighbor)
LIMIT 200
```

### Precision masking (privacy)

Pour les SpotYou non-owner avec `precision` = "100m" ou "1000m" : les coordonnées sont **décalées** via `apply_precision_offset()` avec seed = hash(point_id) pour un décalage consistant.

---

## Endpoint 2 — `GET /api/tag-points/mine`

### Auth : **STRICTE**

### Réponse 200

Array de SpotYou de l'utilisateur connecté, enrichis avec :
- `participants_count` (batch)
- `next_session_date` (calculé CPU via `get_next_session_date`)
- `going_count` (batch par session_date)
- `is_going` (batch pour l'utilisateur)
- `is_full` (computed `going_count >= maximum_participants`)
- `can_participate: true` (toujours pour le propriétaire)

### SQL : 1 principale + 3 batch queries

```sql
-- Principale
SELECT {TP_FIELDS} FROM tag_points ... WHERE tp.user_id = $1 AND tp.active = TRUE ORDER BY created_at DESC

-- Batch 1 : participants count
SELECT spot_you_id, COUNT(*) FROM spot_you_members WHERE spot_you_id = ANY($1) GROUP BY spot_you_id

-- Batch 2 : going count par (spot_you_id, session_date)
SELECT spot_you_id, session_date, COUNT(*) FROM spot_you_attendance WHERE ... AND status='going' GROUP BY ...

-- Batch 3 : is_going pour le user
SELECT spot_you_id, session_date FROM spot_you_attendance WHERE ... AND user_id=$2 AND status='going'
```

---

## Endpoint 3 — `GET /api/tag-points/saved`

### Auth : **STRICTE**

Identique à `/mine` mais avec JOIN `tag_point_saves` et `saved_at`. Même enrichissement batch.

---

## Endpoint 4 — `GET /api/tag-points/{point_id}` (Détail)

### Auth : **OPTIONNELLE**

### Réponse 200

SpotYou complet avec enrichissements :

```json
{
  "point_id": "sp_abc",
  "title": "...",
  "description": "...",
  "tags": [{ "tag_id": "...", "name": "...", "label_fr": "...", "category_id": "..." }],
  "rating": 4.2,
  "votes": 15,
  "rating_distribution": { "1": 0, "2": 1, "3": 3, "4": 6, "5": 5 },
  "participants_count": 8,
  "next_session_date": "2026-05-01",
  "going_count": 3,
  "is_full": false,
  "is_participant": true,
  "is_member": true,
  "can_participate": true,
  "join_status": "accepted",
  "is_going": true,
  "is_saved": false,
  "is_owner": false,
  "owner": { "user_id": "...", "name": "...", "picture": "...", "role": "..." },
  "location": { "type": "Point", "coordinates": [2.3388, 48.8612] },
  ...
}
```

### Flow : 3 phases

```
Phase 1 : Requête principale (1 query)
  → fetchrow tag_points JOIN users WHERE point_id=$1
  → 404 si absent
  → 404 si inactive ET pas owner

Phase 2 : Batch 1 — 4 queries PARALLÈLES (asyncio.gather)
  → tags (tag labels)
  → vote_stats (AVG, COUNT)
  → vote_distribution (GROUP BY rating)
  → member_count

Phase 3 : Batch 2 — 3 queries PARALLÈLES (si connecté)
  → is_participant (status from spot_you_members)
  → is_going (attendance check)
  → is_saved (tag_point_saves check)

Phase 3b : going_count (1 query conditionnelle si member + next_date)
```

**Total : 8-9 queries** (1 + 4 parallèles + 3 parallèles + 0-1 conditionnelle).

### Erreurs

| Code | Condition |
|---|---|
| 404 | `point_id` inexistant → "TagPoint not found" |
| 404 | SpotYou inactif + pas owner → "SpotYou non disponible" |

---

## Endpoint 5 — `GET /api/tag-points/{point_id}/similar`

### Auth : **OPTIONNELLE**

### Réponse 200 : Array (max 10 items)

Critères : tags communs (JSONB intersect) OU distance < 10km. Trié : tags match d'abord, puis distance.

### SQL (JSONB avancé)

```sql
-- Utilise jsonb_typeof + jsonb_array_elements_text pour gérer le double-encodage
CASE jsonb_typeof(tp.tag_ids)
  WHEN 'array' THEN tp.tag_ids
  ELSE (tp.tag_ids #>> '{}')::jsonb
END
```

---

## Endpoint 6 — `GET /api/tag-points/{point_id}/participants`

### Auth : **AUCUNE** (public)

### Réponse 200

```json
[
  { "user_id": "...", "name": "...", "picture": "...", "role": "...", "is_creator": true },
  { "user_id": "...", "name": "...", "picture": "...", "role": "...", "is_creator": false }
]
```

Trié : créateur en premier, puis par `joined_at ASC`.

---

## Endpoint 7 — `GET /api/users/me/pending-requests`

### Auth : **STRICTE**

### Réponse 200

Array de SpotYou où l'utilisateur a un membership `status='pending'`. Chaque item enrichi avec `join_status: "pending"` et `requested_at`.

---

## Helpers partagés

### `TP_FIELDS` (projection SQL — 26+ colonnes)

```sql
tp.point_id, tp.user_id, tp.title, tp.description, tp.precision, tp.tag_ids,
tp.domain_id, tp.active, tp.cancelled, tp.expires_at, tp.created_at, tp.updated_at,
tp.image_url, tp.images, tp.schedule, tp.event_date, tp.event_end_date,
tp.event_schedule, tp.new_date_coming, tp.minimum_participants, tp.maximum_participants,
tp.address, tp.media_purge_scheduled_at, tp.visibility_type, tp.join_mode,
tp.invite_permissions, tp.max_community_members,
ST_Y(tp.location::geometry) as latitude,
ST_X(tp.location::geometry) as longitude,
u.name as owner_name, u.picture as owner_picture, u.role as owner_role,
COALESCE((avg rating), 0) as rating,
COALESCE((count votes), 0) as vote_count,
COALESCE((count accepted members), 0) as participants_count
```

### `build_point_response(row_dict, is_owner)` → dict enrichi

- Construit l'objet `owner: {user_id, name, picture, role}` à partir des champs plats
- Construit `location: {type: "Point", coordinates: [lng, lat]}`
- Applique `_mask_address(address, precision)` si precision != "exact" et pas owner
- Ajoute `original_address` si owner (pour qu'il voie l'adresse complète)
- Set `is_owner`

### `apply_precision_offset(lat, lng, precision, seed)` → (lat', lng')

- exact → pas de décalage
- 100m → décalage aléatoire uniforme dans un cercle de 100m
- 1000m → décalage dans un cercle de 1000m
- **Seed déterministe** : `random.seed(hash(point_id))` → MÊME décalage à chaque appel pour le même SpotYou
