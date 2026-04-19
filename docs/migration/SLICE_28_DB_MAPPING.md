# SLICE_28_DB_MAPPING.md — Mapping base de données
> Généré le 2026-04-19.

---

## Table `tag_points` — INSERT (create) + UPDATE (update, new-date)

### Colonnes INSERT (create) — 21 champs

| Colonne | Type | Source | Notes |
|---|---|---|---|
| `point_id` | text PK | `new_id("pt")` | Généré |
| `user_id` | text FK | JWT user_id | Owner |
| `title` | text | body | — |
| `description` | text | body | — |
| `location` | geography(Point,4326) | `ST_SetSRID(ST_MakePoint(stored_lng, stored_lat), 4326)` | **PostGIS** — coords brouillées si precision != exact |
| `precision` | text | body | "exact", "100m", "1000m" |
| `tag_ids` | jsonb | body (list) | `$N::jsonb` — au moins 1 requis |
| `domain_id` | text | body | — |
| `active` | boolean | hardcodé TRUE | — |
| `expires_at` | timestamptz | calculé si expires_hours | `NOW() + expires_hours` |
| `event_date` | timestamptz | body | Événement ponctuel |
| `event_end_date` | timestamptz | body | Fin événement |
| `event_schedule` | jsonb | body | `{ type: "weekly", schedule: { "0": [...] } }` |
| `images` | jsonb | body (list) | Max 10 |
| `minimum_participants` | int | body | Auto-complété |
| `maximum_participants` | int | body | Auto-complété |
| `address` | text | body | — |
| `visibility_type` | text | body | Défaut "public" |
| `join_mode` | text | body | Défaut "open" |
| `invite_permissions` | text | body | Défaut "admin_only" |
| `max_community_members` | int | body | Nullable |

### Colonnes UPDATE (update) — dynamique, 15+ possibles

Mêmes champs que INSERT sauf `point_id`, `user_id`, `active`.
Plus : `location` via PostGIS si lat+lng fournis.
Plus : `updated_at = NOW()` toujours.

---

## Table `spot_you_members` — INSERT (auto-membership create)

```sql
INSERT INTO spot_you_members (id, spot_you_id, user_id, status)
VALUES ($1, $2, $3, 'accepted')
ON CONFLICT (spot_you_id, user_id) DO NOTHING
```

Le créateur est AUTOMATIQUEMENT membre accepted de son SpotYou.

---

## `randomize_for_storage()` — Brouillage GPS pré-INSERT

```python
def randomize_for_storage(lat, lng, precision):
    if precision == "exact":
        return lat, lng
    radius_m = 100 if precision == "100m" else 1000 if precision == "1000m" else 0
    # Offset aléatoire NON déterministe (random.random() sans seed)
    angle = random.random() * 2 * math.pi
    dist = radius_m * math.sqrt(random.random())
    lat_offset = dist / 111320
    lng_offset = dist / (111320 * math.cos(math.radians(lat)))
    return lat + lat_offset, lng + lng_offset
```

**Différence avec `apply_precision_offset()` (S26)** :
- `randomize_for_storage` : NON déterministe (random sans seed), appliqué au STOCKAGE
- `apply_precision_offset` : déterministe (seed=hash(point_id)), appliqué à la LECTURE
- Les deux sont des décalages DIFFÉRENTS → les coordonnées affichées ne correspondent pas aux coordonnées stockées (voulu pour privacy)
