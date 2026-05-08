# SLICE_42_DB_MAPPING.md — Mapping DB Services Coach (lectures)
> Basé sur `routes/service_routes.py:1–754`.
> Généré le 2026-04-30.

---

## Tables touchées (lecture seule)

| Table | Op | Endpoints | Notes |
|---|---|---|---|
| `services` | SELECT (SVC_FIELDS) | tous | source principale |
| `service_locations` | SELECT + ST_X/ST_Y | search + enrich | PostGIS extract coordinates |
| `service_slots` | SELECT + sub-NOT EXISTS | mine + detail + saved (count) | filtre futurs + non-bookés |
| `service_packages` | SELECT | mine + detail | formules tarif |
| `service_saves` | SELECT (JOIN) | saved | timestamps |
| `users` | SELECT `= ANY($1::text[])` | tous (coach JOIN batch) | snapshot coach |
| `reviews` | SELECT GROUP BY | tous (rating agrégé) | AVG + COUNT |
| `tags` | SELECT `= ANY(...)` | tous | lookup labels |
| `bookings` | NOT EXISTS sub-query | mine + detail | filtrage slots non-bookés |

---

## Schéma `services` — colonnes lues par S42

| Colonne | Type SQL inféré | Source |
|---|---|---|
| `service_id` | text PK | INSERT S43 (`new_id()`) |
| `coach_id` | text FK users | — |
| `title` | text | — |
| `description` | text? | — |
| `address` | text? | masked selon precision |
| `price` | numeric | — |
| `duration_min` | int | — |
| `tag_ids` | **jsonb OR text[]** | parsing dual fallback `json.loads` |
| `domain_id` | text? FK domains | filtre search |
| `location_description` | text? | — |
| `max_participants` | int? | — |
| `active` | bool | filtre search/mine |
| `images` | **jsonb OR text** | parsing dual `json.loads` |
| `created_at` | timestamptz | ORDER BY mine |
| `updated_at` | timestamptz | — |
| `booking_approval_mode` | text | `'instant_booking'` ou `'manual_approval'` |
| `allow_pay_later` | bool | normalize via flags |
| `pay_later_expiration_minutes` | int? | normalize via flags |
| `deleted_at` | timestamptz? | filtre deactivated |
| `media_purge_scheduled_at` | timestamptz? | calcul days |
| `media_purged` | bool | deactivated |
| `reactivated_at` | timestamptz? | filtre deactivated |

> ⚠️ **Type `tag_ids` et `images`** : le code Python fait `json.loads` fallback. **À auditer DDL** — possiblement `jsonb` (cohérent avec marketplace S41 confirmé) ou `text` storing JSON string. Java doit reproduire le parsing dual ou trancher après audit `\d services`.

---

## SQL — Endpoint 1 (search)

### Query principale (lignes 405)

```sql
SELECT {SVC_FIELDS}
FROM services
WHERE active = TRUE
  [AND coach_id != $X]            -- si current_user_id présent
  [AND EXISTS (
       SELECT 1 FROM service_locations sl
       WHERE sl.service_id = service_id          -- ⚠️ AMBIGUÏTÉ ! cf. piège DB-01
       AND ST_DWithin(sl.location::geography,
           ST_SetSRID(ST_MakePoint($X,$Y),4326)::geography, $RADIUS)
  )]
  [AND coach_id = $X]              -- si coach_id query param
  [AND domain_id = $X]             -- si domain_id query param
LIMIT 100
```

> 🔴 **PIÈGE-DB-01 — AMBIGUÏTÉ NOM COLONNE** : `WHERE sl.service_id = service_id` (ligne 385) — le `service_id` non préfixé est interprété par PostgreSQL comme la colonne **outer query** `services.service_id`. Java DOIT préserver cette ambiguïté OU renommer explicitement (`s.service_id`) avec un alias. **Vérifier le plan d'exécution** PostgreSQL pour valider que la corrélation est correcte.

> ⚠️ `ST_MakePoint($X, $Y)` = **(lng, lat)** — PAS (lat, lng). Piège classique. Cf. S25/S26/S28.

---

## SQL — Batch enrich SEARCH (4 queries `asyncio.gather`)

### `_fetch_coaches`
```sql
SELECT user_id, name, picture, is_coach_verified
FROM users WHERE user_id = ANY($1::text[])
```

### `_fetch_locations` (search version — masked uniquement)
```sql
SELECT service_id, location_id, precision, description,
       ST_Y(location::geometry) AS latitude,
       ST_X(location::geometry) AS longitude
FROM service_locations
WHERE service_id = ANY($1::text[])
```

### `_fetch_reviews`
```sql
SELECT reviewee_id,
       ROUND(AVG(rating)::numeric, 1) AS avg_rating,
       COUNT(*) AS review_count
FROM reviews
WHERE reviewee_id = ANY($1::text[])
GROUP BY reviewee_id
```

### `_fetch_tags`
```sql
SELECT tag_id, label_fr, label_en, category_id
FROM tags WHERE tag_id = ANY($1::text[])
```

---

## SQL — Batch enrich OWNER (7 queries `asyncio.gather`)

Identique aux 4 queries search **+ 3 supplémentaires** :

### `_fetch_slots` (avec filtre futurs + non-bookés)

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

> 🔴 **PIÈGE-DB-02 — Concaténation date+time string cast** : `(ss.slot_date || ' ' || ss.start_time)::timestamp > NOW()::timestamp`. Suppose que `slot_date` est `text` ou `date` et `start_time` est `text` ou `time`. Si types réels diffèrent, le cast peut échouer. Java doit utiliser **EXACTEMENT cette syntaxe** (pas `slot_date + start_time` ni autre fantaisie).

> ⚠️ **`NULLS LAST`** dans ORDER BY — récurrents (slot_date=NULL) en fin. Préserver.

### `_fetch_packages`
```sql
SELECT service_id, package_id, type_id, type_label, duration_min, max_participants, price
FROM service_packages WHERE service_id = ANY($1::text[])
ORDER BY created_at
```

### `_fetch_pkg_slots` (DÉPENDANT — exécuté après packages)
```sql
SELECT package_id, slot_id, slot_date, start_time, end_time
FROM service_slots ss
WHERE ss.package_id = ANY($1::text[])
  AND ( ss.slot_date IS NULL OR (ss.slot_date || ' ' || ss.start_time)::timestamp > NOW()::timestamp )
  AND NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.slot_id = ss.slot_id
      AND b.status IN ('pending','accepted','awaiting_payment','confirmed')
  )
ORDER BY ss.slot_date, ss.start_time
```

> ⚠️ **DÉPENDANCE séquentielle** : `_fetch_pkg_slots` ne peut s'exécuter qu'**après** `_fetch_packages` (besoin de `pkg_ids`). Java : 6 queries en `CompletableFuture.allOf`, puis 1 query séquentielle après.

---

## SQL — Endpoint 3 (saved)

```sql
SELECT s.service_id, s.title, s.price, s.images, s.address, s.location_description,
       s.duration_min,
       ss.saved_at,
       json_build_object('user_id', u.user_id, 'name', u.name, 'picture', u.picture) as coach,
       (SELECT json_agg(json_build_object('latitude', ST_Y(sl.location), 'longitude', ST_X(sl.location)))
        FROM service_locations sl WHERE sl.service_id = s.service_id) as locations,
       (SELECT COUNT(*) FROM service_slots slt
        WHERE slt.service_id = s.service_id
          AND slt.slot_status = 'available'
          AND slt.slot_date >= TO_CHAR(NOW(), 'YYYY-MM-DD')) as available_slots
FROM service_saves ss
JOIN services s ON ss.service_id = s.service_id
JOIN users u ON s.coach_id = u.user_id
WHERE ss.user_id = $1
ORDER BY ss.saved_at DESC
```

> 🔴 **PIÈGE-DB-03 — `slot_date >= TO_CHAR(NOW(), 'YYYY-MM-DD')`** : compare `slot_date` (DATE ou string ?) avec une string. Si `slot_date` est de type `DATE`, PostgreSQL fait un cast implicite (peut être lent). Java doit reproduire **exactement** OU optimiser via `slot_date >= CURRENT_DATE`. Préserver compat strict.

> ⚠️ **`json_build_object` + `json_agg`** dans sous-requêtes : Java doit utiliser `JdbcTemplate.queryForList` puis Jackson `readValue` sur les colonnes string (PostgreSQL retourne du JSON sérialisé). OU mapper manuellement via row handler.

---

## SQL — Endpoint 4 (deactivated)

```sql
SELECT {SVC_FIELDS}, deleted_at, media_purge_scheduled_at, media_purged, reactivated_at
FROM services
WHERE coach_id = $1 AND deleted_at IS NOT NULL
  AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
ORDER BY deleted_at DESC
```

> ⚠️ Filtre identique à S40 marketplace lifecycle (cohérence pattern). Java peut factoriser un `LifecycleQueryBuilder` partagé.

---

## SQL — Endpoint 5 (detail)

```sql
SELECT {SVC_FIELDS} FROM services WHERE service_id = $1
```

> ⚠️ **PAS de filtre** `active` ni `deleted_at` — détail consultable pour TOUS les services. 404 uniquement si row absente.

---

## Helper `_mask_address` (lignes 68–112)

### Logique
| Précision | Comportement |
|---|---|
| `exact` (ou null) | Retourne `description` brut |
| `100m` | Retire le numéro de rue (regex `^\d+\s*` au début de la 1ère partie). Si match → on commence à partir du nom de rue. |
| `1000m` | Retourne `city, country` ou juste `city` (skip `_COUNTRY_NAMES = {'france','francia','frankreich','fr'}` côté droit) |

### Java port
```java
public static String maskAddress(String description, String precision) {
    if (description == null || description.isEmpty() || "exact".equals(precision)) return description;
    if ("1000m".equals(precision)) { /* split + iterate from end skipping countries */ }
    if ("100m".equals(precision)) { /* regex remove leading number */ }
    return description;
}
```

> ⚠️ Lire le code Python complet (lignes 68–112) pour copier exactement la logique de masking.

---

## Helper `build_service` (lignes 50–60)

```python
def build_service(row_dict: dict) -> dict:
    raw_images = row_dict.get("images")
    if isinstance(raw_images, str):
        try: row_dict["images"] = json.loads(raw_images)
        except: row_dict["images"] = []
    elif raw_images is None:
        row_dict["images"] = []
    return row_dict
```

### Java
```java
public static List<String> parseImages(Object raw) {
    if (raw == null) return List.of();
    if (raw instanceof List<?> list) return list.stream().map(String::valueOf).toList();
    if (raw instanceof String s) {
        try { return mapper.readValue(s, new TypeReference<List<String>>() {}); }
        catch (Exception e) { return List.of(); }
    }
    return List.of();
}
```

---

## Pièges DB principaux

| ID | Piège | Action Java |
|---|---|---|
| DB-01 | `WHERE sl.service_id = service_id` ambiguïté outer/inner | Renommer outer en `s.service_id` ou alias |
| DB-02 | `(slot_date \|\| ' ' \|\| start_time)::timestamp` cast string | Préserver SQL exact |
| DB-03 | `slot_date >= TO_CHAR(NOW(), 'YYYY-MM-DD')` cast implicite | Préserver SQL exact (ou optimiser `CURRENT_DATE`) |
| DB-04 | Sous-requêtes `json_build_object` + `json_agg` (saved) | Mapper string → Jackson |
| DB-05 | `tag_ids` parsing dual jsonb/text | Parser fallback try/except |
| DB-06 | `images` parsing dual jsonb/text | Idem |
| DB-07 | `ST_MakePoint(lng, lat)` ordre | Toujours (lng, lat) |
| DB-08 | `_fetch_pkg_slots` dépend de `_fetch_packages` | 6 queries // puis 1 séq |
| DB-09 | Auto-exclusion services personnels search | `coach_id != $current_user_id` si JWT présent |
| DB-10 | `is_owner` détecté par `viewer.role='admin' OR viewer.user_id == coach_id` | Pas de filtre SQL — applicatif post-SELECT |

---

## Index recommandés

Existants probables :
- `idx_services_coach_id`
- `idx_services_active` ou `(coach_id, active)`
- `idx_service_locations_service_id`
- `idx_service_slots_service_id`
- `idx_service_locations_location_gist` (PostGIS, **CRITIQUE**)
- `idx_reviews_reviewee_id`
- `idx_service_saves_user_id_saved_at`

Suggestions Java :
- `(coach_id, deleted_at) WHERE deleted_at IS NOT NULL` pour deactivated
- GiST `ST_DWithin` covering — déjà attendu pour search PostGIS
