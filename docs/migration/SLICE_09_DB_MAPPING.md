# SLICE_09_DB_MAPPING.md — Mapping base de données
> Basé sur `service_routes.py:100–350`, `service_routes.py:430–642`, `migrations/001_initial_schema.sql`.
> Généré le 2026-02-XX.

---

## Vue d'ensemble des requêtes

### GET /api/services (liste) — 4+1 requêtes batch parallèles

| # | Requête | Table | Type | Note |
|---|---|---|---|---|
| R0 | SELECT SVC_FIELDS WHERE active=TRUE (+ filtres) | `services` | SELECT N | Séquentielle |
| R1 | SELECT users WHERE user_id ANY(coach_ids) | `users` | Batch | Parallèle (asyncio.gather) |
| R2 | SELECT service_locations WHERE service_id ANY(ids) | `service_locations` | Batch | Parallèle |
| R3 | AVG(rating)+COUNT(*) WHERE reviewee_id ANY(coach_ids) | `reviews` | Batch | Parallèle |
| R4 | SELECT tags WHERE tag_id ANY(tag_ids) | `tags` | Batch | Parallèle |

### GET /api/services/{service_id} (détail) — 7+ requêtes batch parallèles

| # | Requête | Table | Note |
|---|---|---|---|
| R0a | SELECT SVC_FIELDS WHERE service_id=$1 | `services` | Parallèle avec auth |
| R0b | get_optional_auth | `users` (JWT) | Parallèle avec R0a |
| R1 | SELECT users (coach) | `users` | batch owner |
| R2 | SELECT service_locations | `service_locations` | batch owner (avec original) |
| R3 | AVG+COUNT reviews | `reviews` | batch owner |
| R4 | SELECT tags | `tags` | batch owner |
| R5 | SELECT service_slots (futurs + disponibles) | `service_slots` + `bookings` | batch owner |
| R6 | SELECT service_packages | `service_packages` | batch owner |
| R7 | SELECT slots par package | `service_slots` | batch (si packages > 0) |

---

## Schéma `services` (SVC_FIELDS)

| Colonne | Type SQL | Exposé |
|---|---|---|
| `service_id` | TEXT PK | OUI |
| `coach_id` | TEXT FK users | OUI |
| `title` | TEXT NOT NULL | OUI |
| `description` | TEXT | OUI |
| `address` | TEXT | OUI (masqué si precision≠exact) |
| `price` | NUMERIC(10,2) NOT NULL | OUI |
| `duration_min` | INTEGER DEFAULT 60 | OUI |
| `tag_ids` | JSONB DEFAULT '[]' | OUI (parsé) |
| `domain_id` | TEXT | OUI |
| `location` | GEOMETRY(Point,4326) | NON — non dans SVC_FIELDS |
| `location_description` | TEXT | OUI |
| `max_participants` | INTEGER DEFAULT 1 | OUI |
| `active` | BOOLEAN DEFAULT true | OUI |
| `images` | JSONB DEFAULT '[]' | OUI (parsé) |
| `created_at` | TIMESTAMPTZ | OUI |
| `updated_at` | TIMESTAMPTZ | OUI |
| `booking_approval_mode` | TEXT NOT NULL DEFAULT 'manual_approval' | OUI |
| `allow_pay_later` | BOOLEAN NOT NULL DEFAULT true | OUI |
| `pay_later_expiration_minutes` | INTEGER DEFAULT 1440 | OUI |

**Note :** La colonne `location` GEOMETRY n'est PAS dans SVC_FIELDS — elle est utilisée uniquement pour la requête géo via `ST_DWithin` dans service_locations.

---

## Requête principale — GET /api/services

```sql
-- Construction dynamique (service_routes.py:373–413)
-- Minimum (aucun filtre, non auth) :
SELECT service_id, coach_id, title, description, address, price, duration_min,
       tag_ids, domain_id, location_description, max_participants, active, images, created_at, updated_at,
       booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
FROM services
WHERE active = TRUE
LIMIT 100

-- Avec token valide (exclude own services) :
WHERE active = TRUE AND coach_id != $1 LIMIT 100

-- Avec filtre géo :
WHERE active = TRUE AND EXISTS (
    SELECT 1 FROM service_locations sl
    WHERE sl.service_id = service_id
    AND ST_DWithin(sl.location::geography,
        ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography,
        $radius)
) LIMIT 100

-- Avec coach_id :
WHERE active = TRUE AND coach_id = $N LIMIT 100

-- Avec domain_id :
WHERE active = TRUE AND domain_id = $N LIMIT 100
```

**Note :** Les conditions sont combinées dynamiquement avec `AND`. L'ordre des paramètres correspond aux `param_idx` incrémentés.

---

## Requête `service_locations`

```sql
SELECT service_id, location_id, precision, description,
       ST_Y(location::geometry) AS latitude,
       ST_X(location::geometry) AS longitude
FROM service_locations
WHERE service_id = ANY($1::text[])
```

**Masquage `_mask_address` (service_routes.py:68–97) :**

| Precision | Masquage | Exemple |
|---|---|---|
| `exact` | Aucun — adresse complète | `"10 Rue de la Paix, 75008 Paris"` |
| `100m` | Numéro retiré (1ère partie avant virgule) | `"Rue de la Paix"` |
| `1000m` | Ville/arrondissement uniquement | `"Paris"` |

La même logique masque `svc["address"]` (top-level) selon la precision de la 1ère location.

---

## Requête `service_slots` (détail uniquement)

```sql
SELECT service_id, slot_id, slot_type, slot_status, location_id, package_id,
       day_of_week, days_of_week, start_time, end_time, slot_date
FROM service_slots ss
WHERE ss.service_id = ANY($1::text[])
AND (
    ss.slot_date IS NULL
    OR (ss.slot_date || ' ' || ss.start_time)::timestamp > NOW()::timestamp
)
AND NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.slot_id = ss.slot_id
    AND b.status IN ('pending', 'accepted', 'awaiting_payment', 'confirmed')
)
ORDER BY ss.slot_date NULLS LAST, ss.start_time
```

**Double filtre :**
1. `slot_date IS NULL OR slot_date+start_time > NOW()` → créneaux futurs ou récurrents (null=récurrent)
2. `NOT EXISTS bookings actifs` → créneau disponible à la réservation

---

## `build_service` — parsing JSONB images

```python
# service_routes.py:50–60
def build_service(row_dict: dict) -> dict:
    raw_images = row_dict.get("images")
    if isinstance(raw_images, str):
        try:
            row_dict["images"] = json.loads(raw_images)
        except (json.JSONDecodeError, TypeError):
            row_dict["images"] = []
    elif raw_images is None:
        row_dict["images"] = []
    return row_dict
```

`images` est un JSONB qui peut arriver en string → parser en liste. Si null → `[]`.
Identique pour `tag_ids` dans `_batch_enrich_services_for_search`.

---

## `_mask_address` — logique de masquage (à reproduire en Java)

```python
def _mask_address(description: str, precision: str) -> str:
    if not description or precision == 'exact':
        return description
    if precision == '1000m':
        parts = [p.strip() for p in description.split(',')]
        # Walk backwards, skip country names ('france', 'fr', etc.)
        for i in range(len(parts)-1, -1, -1):
            candidate = parts[i].strip()
            if candidate.lower() not in COUNTRY_NAMES and candidate:
                # Remove postal code prefix "75008 Paris" → "Paris"
                m = re.match(r'^\d{4,5}\s+(.+)$', candidate)
                return m.group(1).strip() if m else candidate
        return parts[-1]
    # 100m: remove street number from first part before comma
    street_part = description.split(',')[0].strip()
    return re.sub(r'^\d+\s*(bis|ter|quater)?\s*[,.]?\s*', '', street_part, flags=re.IGNORECASE).strip()
        or street_part or description
```

**En Java v1 :** Pour simplifier, reproduire les deux cas (1000m = dernier segment avant pays, 100m = supprimer le numéro). La regex exacte : `^\d+\s*(bis|ter|quater)?\s*[,.]?\s*`.

---

## `avg_rating` — calcul par coach_id (pas service_id)

```sql
SELECT reviewee_id,
       ROUND(AVG(rating)::numeric, 1) AS avg_rating,
       COUNT(*) AS review_count
FROM reviews
WHERE reviewee_id = ANY($1::text[])  -- coach_ids
GROUP BY reviewee_id
```

Les reviews sont **par coach**, pas par service. Un coach avec 3 services affiche le même `avg_rating` sur les 3.
