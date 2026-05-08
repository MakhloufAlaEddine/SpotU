# SLICE 44 — DB Mapping (Slots / Disponibilités)

> **Source** :
> - `/app/backend/routes/service_routes.py` l. 826–842, 949–977
> - `/app/backend/migrations/001_initial_schema.sql` l. 313–331

---

## 1. Tables impactées

| Table | POST /services | PUT/PATCH /services |
|-------|:--------------:|:-------------------:|
| `service_slots` | INSERT × N | DELETE + INSERT × N (replace) |
| `service_locations` | (déjà géré S43) | — |
| `bookings` | — | — (lecture indirecte par `_get_service_slots` S42) |

---

## 2. Schéma `service_slots`

```sql
CREATE TABLE public.service_slots (
    slot_id      text NOT NULL,
    service_id   text,                                   -- FK services ON DELETE CASCADE
    day_of_week  integer,                                -- 0-6 legacy (single value)
    start_time   text NOT NULL,                          -- 'HH:MM'
    end_time     text NOT NULL,                          -- 'HH:MM'
    created_at   timestamptz DEFAULT now(),
    slot_type    text DEFAULT 'recurring'::text,         -- recurring | single | availability | specific
    slot_date    text,                                   -- 'YYYY-MM-DD' (requis si slot_type='single')
    days_of_week jsonb DEFAULT '[]'::jsonb,              -- liste d'entiers 0-6
    raw_schedule jsonb,                                  -- objet libre (source de vérité)
    location_id  text,                                   -- FK service_locations ON DELETE SET NULL
    package_id   text,                                   -- FK service_packages ON DELETE SET NULL
    slot_status  text DEFAULT 'available'::text NOT NULL,
    CONSTRAINT service_slots_day_of_week_check CHECK ((day_of_week >= 0 AND day_of_week <= 6))
);

ALTER TABLE service_slots ADD CONSTRAINT service_slots_pkey PRIMARY KEY (slot_id);
CREATE INDEX idx_service_slots_service_id ON service_slots USING btree (service_id);

-- FKs
service_id  → services(service_id)            ON DELETE CASCADE
location_id → service_locations(location_id)  ON DELETE SET NULL
package_id  → service_packages(package_id)    ON DELETE SET NULL
```

### Colonnes — usage S44

| Colonne | POST | PUT (replace) | DELETE service (S43) | Notes |
|---------|:----:|:-------------:|:--------------------:|-------|
| `slot_id` | INSERT (`new_id("slot")`) | INSERT | — | PK |
| `service_id` | INSERT (FK) | INSERT (FK) | — (CASCADE indirecte) | |
| `location_id` | INSERT (résolu via index) | INSERT | — | nullable |
| `package_id` | **NULL** (legacy slots) | NULL | — | non-null en S45 (packages) |
| `slot_type` | INSERT | INSERT | — | `recurring | single | availability` |
| `slot_status` | DEFAULT `'available'` | DEFAULT | — | **jamais** spécifié à l'INSERT |
| `slot_date` | INSERT (string ou NULL) | INSERT | — | `'YYYY-MM-DD'` |
| `start_time` | INSERT | INSERT | — | `'HH:MM'` |
| `end_time` | INSERT | INSERT | — | `'HH:MM'` |
| `day_of_week` | INSERT (`days[0]` ou NULL) | INSERT | — | legacy |
| `days_of_week` | INSERT (jsonb cast) | INSERT (jsonb cast) | — | source nouvelle |
| `raw_schedule` | **non écrit** par S44 | **non écrit** par S44 | — | colonne existe mais ignorée (asymétrie) |
| `created_at` | DEFAULT NOW() | DEFAULT NOW() | — | |

> ⚠️ **`raw_schedule`** : la colonne existe et le DTO Pydantic l'accepte (`ServiceSlotItem.raw_schedule`), mais le code Python **ne l'écrit jamais** dans la DB. Asymétrie à conserver.

---

## 3. Requêtes SQL textuelles

### POST /services — INSERT × N
```sql
INSERT INTO service_slots
  (slot_id, service_id, location_id, slot_type,
   days_of_week, day_of_week, start_time, end_time, slot_date)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
```
- `$1` : `slot_id` = `new_id("slot")`.
- `$2` : `service_id` (le sid fraîchement créé).
- `$3` : `location_id` résolu (cf. §4 ci-dessous).
- `$4` : `slot.slot_type` (default `'recurring'` côté model).
- `$5` : `days[]` (liste Python d'entiers ; côté Java : JSONB cast `::jsonb`).
- `$6` : `days[0]` ou `NULL`.
- `$7`, `$8` : `start_time`, `end_time` (string `HH:MM`).
- `$9` : `slot_date` (`'YYYY-MM-DD'` ou `NULL`).

### PUT /services/{id} — DELETE + INSERT × N (si `data.slots is not None`)
```sql
-- Wipe
DELETE FROM service_slots WHERE service_id = $1;

-- Replace
INSERT INTO service_slots
  (slot_id, service_id, location_id, slot_type,
   days_of_week, day_of_week, start_time, end_time, slot_date)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
-- (× N)
```

> Cette requête `DELETE` supprime **tous** les slots du service, **y compris ceux liés à des packages** (`package_id NOT NULL`). C'est une asymétrie potentiellement dangereuse en S45 — à mémoriser.

### Lecture (S42 — référence)
Cf. `SLICE_44_API_CONTRACTS.md` §4. Aucune écriture à faire ici.

---

## 4. Résolution `location_id`

### POST /services
```pseudo
loc_ids = []  # Liste des location_id insérés (dans l'ordre de data.locations[])
for loc in data.locations:
    lid = new_id("sloc")
    INSERT INTO service_locations (location_id=lid, service_id=sid, location=POINT(lng,lat), ...)
    loc_ids.append(lid)

for slot in data.slots:
    if slot.location_index is not None and 0 <= slot.location_index < len(loc_ids):
        resolved_loc_id = loc_ids[slot.location_index]
    else:
        resolved_loc_id = loc_ids[0] if loc_ids else None
    INSERT INTO service_slots (location_id=resolved_loc_id, ...)
```

### PUT /services/{id}
```pseudo
new_loc_ids = []  # populé SEULEMENT si data.locations is not None
if data.locations is not None:
    DELETE FROM service_locations WHERE service_id = $1
    for loc in data.locations:
        lid = new_id("sloc")
        INSERT INTO service_locations ...
        new_loc_ids.append(lid)

if data.slots is not None:
    DELETE FROM service_slots WHERE service_id = $1
    loc_id_list = new_loc_ids
    if not loc_id_list:
        # Pas de nouvelles locations OU data.locations était None — fallback existantes
        rows = SELECT location_id FROM service_locations
               WHERE service_id = $1 ORDER BY created_at
        loc_id_list = [r.location_id for r in rows]

    for slot in data.slots:
        if slot.location_index is not None and 0 <= slot.location_index < len(loc_id_list):
            resolved_loc_id = loc_id_list[slot.location_index]
        else:
            resolved_loc_id = loc_id_list[0] if loc_id_list else None
        INSERT INTO service_slots (location_id=resolved_loc_id, ...)
```

> ⚠️ **Ordre des locations** : sur PUT, si `data.locations` est fourni, l'ordre est celui du payload (index dans `data.locations`). Sinon, ordre `created_at ASC` des locations existantes.

---

## 5. Transactions

### Comportement Python actuel
- **Aucun** `async with conn.transaction():` autour des INSERT slots dans POST ou PUT.
- Le DELETE + INSERT du replace n'est **pas atomique** : un crash entre DELETE et INSERT laisse le service sans slots.

### Recommandation Java
- **Imposer `@Transactional`** sur `create` et `update` du service (déjà recommandé en S43).
- L'atomicité couvre automatiquement le DELETE + INSERT.

---

## 6. Concurrency / Locks

### POST /services
- Pas de lock. Risque race condition si deux appels concurrents tentent de créer le même service (improbable car `service_id` est généré par appel).

### PUT /services/{id}
- Pas de lock sur `service_slots`.
- Pas de protection contre :
  - Deux PUT concurrents qui se chevauchent (le dernier écrit gagne).
  - Un booking créé pendant un PUT (`POST /bookings/request` prend `FOR UPDATE NOWAIT` sur le slot, mais le PUT ne lock rien).

> ⚠️ **Edge case de course** : un PUT replace en parallèle d'un booking peut laisser un booking pointant vers un `slot_id` supprimé. La FK `bookings.slot_id` n'est PAS contrainte (vérifier le schéma — c'est un text libre, pas de FK stricte). À ne PAS corriger côté Java (préserver le comportement).

### Référence (S30 — booking_routes)
- `SELECT ... FOR UPDATE NOWAIT` sur `service_slots` lors du booking (`booking_routes.py:259`).
- C'est dans la slice `Booking create + pay` (S30), déjà migrée. Aucune duplication dans S44.

---

## 7. Index utiles

- `service_slots(service_id)` — index existant. Utilisé par DELETE FROM ... WHERE service_id et par `_get_service_slots`.
- Recommandation Java : ne pas ajouter d'autre index sans mesure de perf (préserver l'iso-Python).

---

## 8. Cascades / FKs

- `service_slots.service_id → services.service_id ON DELETE CASCADE` : si le service est hard-deleted (jamais le cas en S43, qui fait du soft-delete), les slots disparaissent.
- `service_slots.location_id → service_locations.location_id ON DELETE SET NULL` : si la location est supprimée (par le replace S43), `service_slots.location_id` passe à NULL. **Effet de bord notable** sur replace de locations sans replace de slots.
- `service_slots.package_id → service_packages.package_id ON DELETE SET NULL` : (S45).

> ⚠️ **Effet de bord cascade** : un PUT `/services/{id}` avec `data.locations = [...]` et `data.slots = null` :
> 1. DELETE FROM service_locations (cascade ON DELETE SET NULL → tous les slots existants ont `location_id = NULL`).
> 2. INSERT nouvelles locations.
> 3. Slots existants conservés mais avec `location_id = NULL` orphelin.
>
> Comportement Python actuel ; à reproduire tel quel.

---

## 9. JSONB

### `days_of_week`
- Stockage : tableau d'entiers `[0..6]` en JSONB.
- Default DB : `'[]'::jsonb`.
- INSERT côté Python : asyncpg sérialise la liste Python directement.
- INSERT côté Java : `ObjectMapper.writeValueAsString(daysList)` puis paramètre `::jsonb`.

### `raw_schedule`
- Type `jsonb` nullable.
- Le DTO Pydantic l'accepte mais le handler Python **ne l'utilise pas** sur INSERT (ni POST, ni PUT). Asymétrie à conserver.

---

## 10. Récapitulatif effets de bord SQL

### POST /services — bloc slots
```
[Effets locations S43 d'abord]
1. INSERT INTO service_slots × len(data.slots)
   - location_id résolu via location_index sur loc_ids fraîchement créés.
   - slot_status = DEFAULT 'available'.
   - day_of_week = days[0] ou NULL.
   - days_of_week = JSONB cast.
```

### PUT /services/{id} — bloc slots (si `data.slots is not None`)
```
1. DELETE FROM service_slots WHERE service_id = $1
2. Resolve loc_id_list:
   - new_loc_ids si data.locations is not None
   - SELECT location_id FROM service_locations WHERE service_id = $1 ORDER BY created_at sinon
3. INSERT INTO service_slots × len(data.slots)
```

### PUT /services/{id} — bloc slots (si `data.slots is None`)
```
[Aucune touche à service_slots]
```
