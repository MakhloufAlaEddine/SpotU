# SLICE_25_API_CONTRACTS.md — Contrats API Home
> Basé sur `home_routes.py`.
> Généré le 2026-04-15.

---

## Endpoint 1 — `GET /api/home/nearest-sector`

### Auth : **OPTIONNELLE** (fonctionne sans auth, exclut le user connecté si auth présente)

### Requête

```
GET /api/home/nearest-sector?lat=48.8566&lng=2.3522
```

| Param | Type | Requis | Source |
|---|---|---|---|
| `lat` | float | **OUI** | Query param |
| `lng` | float | **OUI** | Query param |

### Réponse 200

```json
{
  "lat": 48.8612,
  "lng": 2.3388,
  "distance_km": 0.8,
  "spot_count": 12
}
```

### Réponse `null`

Si aucun SpotYou actif n'existe → retourne `null` (pas `{}`, pas 404).

### SQL (PostGIS)

```sql
-- 1. Trouver le SpotYou actif le plus proche
SELECT
    ST_Y(tp.location::geometry) AS near_lat,
    ST_X(tp.location::geometry) AS near_lng,
    ST_Distance(
        tp.location::geography,
        ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography
    ) AS distance_m
FROM tag_points tp
WHERE tp.active = TRUE
  [AND tp.user_id != $3]  -- si user connecté
ORDER BY distance_m ASC
LIMIT 1

-- 2. Compter les SpotYou à 50 km du point trouvé
SELECT COUNT(*) FROM tag_points
WHERE active = TRUE
  AND ST_DWithin(
    location::geography,
    ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography,
    50000
  )
```

**Note** : `$1` = lng, `$2` = lat (ordre inversé : longitude d'abord pour `ST_MakePoint`).

---

## Endpoint 2 — `GET /api/home/feed`

### Auth : **OPTIONNELLE** (personnalise le scoring si connecté)

### Requête

```
GET /api/home/feed?lat=48.8566&lng=2.3522
```

| Param | Type | Requis | Défaut | Rôle |
|---|---|---|---|---|
| `lat` | float | NON | `null` | Latitude (si absent → pas de filtre distance) |
| `lng` | float | NON | `null` | Longitude |

### Réponse 200

```json
{
  "spotyou": [
    {
      "point_id": "sp_abc123",
      "user_id": "user_001",
      "title": "Course à pied au parc",
      "description": "...",
      "precision": "100m",
      "tag_ids": ["tag_001", "tag_002"],
      "domain_id": "dom_001",
      "active": true,
      "cancelled": false,
      "image_url": "https://...",
      "images": ["https://..."],
      "visibility_type": "public",
      "schedule": {...},
      "event_date": "2026-05-01T10:00:00+00:00",
      "event_end_date": null,
      "minimum_participants": 3,
      "maximum_participants": 20,
      "latitude": 48.8612,
      "longitude": 2.3388,
      "owner_name": "Jean",
      "owner_picture": "https://...",
      "owner_role": "coach",
      "participants_count": 8,
      "going_count": 3,
      "is_full": false,
      "distance": 850.5,
      "is_going": true
    }
  ],
  "services": [
    {
      "service_id": "svc_abc",
      "coach_id": "user_002",
      "title": "Coaching personnalisé",
      "description": "...",
      "address": "Paris 8e",
      "price": 45.00,
      "duration_min": 60,
      "tag_ids": ["tag_003"],
      "domain_id": "dom_002",
      "images": ["https://..."],
      "location_description": "Salle de sport",
      "max_participants": 1,
      "distance": 1200.0,
      "booking_count": 15,
      "coach": {
        "user_id": "user_002",
        "name": "Marie",
        "picture": "https://..."
      }
    }
  ],
  "actual_radius_km": 50,
  "is_expanded": false,
  "has_personalization": true,
  "total_count": 42
}
```

### Flow détaillé

```
1. Auth optionnelle → current_user_id (ou null)
2. Si connecté → charger coach_tags + spot_you_members du user
3. Auto-expansion rayon (50→100→200→500 km):
   Pour chaque rayon:
     a. Requête SpotYou (PostGIS + participants_count + going_count + is_full)
     b. Batch is_going (si connecté)
     c. Requête Services (PostGIS via service_locations + booking_count)
     d. Si total >= 3 → break
4. Scoring :
   - SpotYou : tags communs (0-40) + popularité (0-30) + distance (0-30) + bonus membre (+20)
   - Services : tags communs (0-40) + popularité (0-30) + distance (0-30)
5. Trier par score DESC
6. Enrober coach_name/coach_picture dans un objet `coach` pour les services
7. Retourner { spotyou[:30], services[:20], metadata }
```

### Erreurs

Aucune erreur HTTP spécifique. Retourne `{ spotyou: [], services: [], total_count: 0 }` si aucun résultat même après expansion maximale.

### Effets de bord

Aucun (lecture seule).

### Points critiques PostGIS

| Fonction | Rôle | Paramètres |
|---|---|---|
| `ST_MakePoint(lng, lat)` | Crée un point géo | **lng AVANT lat** |
| `ST_SetSRID(..., 4326)` | Définit le système de coordonnées (WGS84) | SRID 4326 |
| `ST_DWithin(a::geography, b::geography, radius)` | Filtre distance | radius en **mètres** |
| `ST_Distance(a::geography, b::geography)` | Calcule distance | retourne en **mètres** |
| `ST_X(point::geometry)` | Extrait longitude | — |
| `ST_Y(point::geometry)` | Extrait latitude | — |

### Score algorithm (détail)

```
_score_spot(spot, user_tags, member_ids, max_dist, max_pop):
  tags_score    = min(common_tags_count * 20, 40)   # 0-40 pts
  pop_score     = (going + participants) / max_pop * 30  # 0-30 pts
  dist_score    = (max_dist - distance) / max_dist * 30  # 0-30 pts
  member_bonus  = 20 if spot_id in member_ids           # +20 pts
  TOTAL = tags_score + pop_score + dist_score + member_bonus  # 0-120 pts

_score_service(svc, user_tags, max_dist, max_pop):
  tags_score    = min(common_tags_count * 20, 40)
  pop_score     = booking_count / max_pop * 30
  dist_score    = (max_dist - distance) / max_dist * 30
  TOTAL = tags_score + pop_score + dist_score  # 0-100 pts (pas de bonus membre)
```

### Service_locations JOIN pattern

```sql
-- Les services n'ont PAS de colonne location directe.
-- La distance est calculée via la table service_locations :
EXISTS (SELECT 1 FROM service_locations sl
        WHERE sl.service_id = s.service_id
        AND ST_DWithin(sl.location::geography, ..., radius))

-- Distance minimale parmi toutes les locations :
(SELECT MIN(ST_Distance(sl.location::geography, ...))
 FROM service_locations sl WHERE sl.service_id = s.service_id)
```
