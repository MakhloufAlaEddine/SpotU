# SLICE_28_API_CONTRACTS.md — Contrats API SpotYou CRUD
> Basé sur `tagpoint_routes.py:1808–2051`.
> Généré le 2026-04-19.

---

## Endpoint 1 — `POST /api/tag-points` (Create)

### Auth : **STRICTE**

### Requête

```json
{
  "title": "Course matinale au parc",
  "description": "Rejoignez-nous pour une course...",
  "latitude": 48.8566,
  "longitude": 2.3522,
  "precision": "100m",
  "tag_ids": ["tag_001", "tag_002"],
  "domain_id": "dom_001",
  "images": ["https://images.winek.app/spotyou/img1.jpg"],
  "event_date": "2026-05-01T10:00:00Z",
  "event_end_date": "2026-05-01T12:00:00Z",
  "event_schedule": { "type": "weekly", "schedule": { "0": [{"start":"08:00","end":"09:00"}] } },
  "expires_hours": null,
  "minimum_participants": 3,
  "maximum_participants": 20,
  "address": "Parc Monceau, Paris 8e",
  "visibility_type": "public",
  "join_mode": "open",
  "invite_permissions": "admin_only",
  "max_community_members": null
}
```

### Validations

| Règle | Code |
|---|---|
| `tag_ids` vide ou absent → 400 | "Au moins un tag est requis." |
| `images` > 10 → 400 | "Maximum 10 images autorisées" |
| `minimum_participants > maximum_participants` → 400 | "Le nombre minimum... ne peut pas dépasser le maximum." |
| `minimum_participants < 1` → forcé à 1 | Pas d'erreur (correction silencieuse) |
| Si min fourni sans max → `max = min` | Auto-complétion silencieuse |
| Si max fourni sans min → `min = max` | Auto-complétion silencieuse |

### SQL (INSERT + auto-membership)

```sql
-- 1. INSERT tag_point avec PostGIS
INSERT INTO tag_points
  (point_id, user_id, title, description,
   location, precision, tag_ids, domain_id,
   active, expires_at, event_date, event_end_date, event_schedule,
   images, minimum_participants, maximum_participants, address,
   visibility_type, join_mode, invite_permissions, max_community_members)
VALUES ($1, $2, $3, $4,
        ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, $9,
        TRUE, $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20, $21)

-- 2. Auto-membership (owner = premier membre)
INSERT INTO spot_you_members (id, spot_you_id, user_id, status)
VALUES ($1, $2, $3, 'accepted')
ON CONFLICT (spot_you_id, user_id) DO NOTHING

-- 3. Re-read pour réponse
SELECT {TP_FIELDS} FROM tag_points tp LEFT JOIN users u ON ... WHERE tp.point_id = $1
```

### `randomize_for_storage(lat, lng, precision)`

```python
# Si precision != "exact" → décaler les coordonnées AVANT stockage
# Le décalage est DIFFÉRENT de apply_precision_offset (S26)
# Ici : random uniforme (pas déterministe par seed)
stored_lat, stored_lng = randomize_for_storage(data.latitude, data.longitude, data.precision)
```

### Réponse 200

SpotYou complet via `build_point_response(row, is_owner=True)`.

---

## Endpoint 2 — `PUT /api/tag-points/{point_id}` (Update)

### Auth : **STRICTE** (owner OU admin plateforme)

### Requête : body partiel (model_dump exclude_unset)

Identique à Create mais tous les champs optionnels. Seuls les champs présents sont mis à jour.

### Flow complet (165 lignes)

```
1. Auth + load existing (SELECT avec PostGIS ST_X/ST_Y pour lat/lng courant)
   → 404 si absent, 403 si pas owner et pas admin

2. Body vide → retour SpotYou actuel sans UPDATE

3. Validations :
   - images > 10 → 400
   - tag_ids vide (list len 0) → 400
   - min_participants > max_participants → 400
   - Auto-complétion min/max croisée

4. Diff de valeurs (_vals_equal) :
   - Timestamps : comparaison UTC
   - Floats : tolérance 1e-7
   - JSONB : json.dumps(sort_keys=True)
   → has_real_changes = True/False

5. Construction SQL dynamique :
   - Location : ST_SetSRID(ST_MakePoint($lng, $lat), 4326) si lat+lng fournis
   - JSONB fields (tag_ids, images, event_schedule) : $N::jsonb ou NULL
   - Autres champs : $N ou NULL
   - updated_at = NOW() toujours ajouté

6. Exécution UPDATE

7. Suppression images retirées (si 'images' dans raw) :
   - old_images - new_images → delete_upload_files(removed)

8. Re-read + retour build_point_response(is_owner=True)

9. Push notification aux membres (si has_real_changes ET !cancelled) :
   - Fire-and-forget à chaque membre (sauf owner)
```

### Erreurs

| Code | Condition |
|---|---|
| 400 | images > 10, tag_ids vide, min > max |
| 403 | Pas owner et pas admin |
| 404 | SpotYou inexistant |

---

## Endpoint 3 — `PATCH /api/tag-points/{point_id}/new-date` (Toggle)

### Auth : **STRICTE** (owner OU admin)

### Réponse 200

```json
{ "new_date_coming": true }
```

Toggle simple : `new_val = NOT existing["new_date_coming"]`.

### SQL

```sql
UPDATE tag_points SET new_date_coming = $1, updated_at = NOW() WHERE point_id = $2
```

### Erreurs

| Code | Condition |
|---|---|
| 403 | Pas owner et pas admin |
| 404 | SpotYou inexistant |
