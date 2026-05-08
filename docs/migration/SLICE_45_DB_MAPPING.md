# SLICE 45 — DB Mapping (Packages)

> **Source** :
> - `/app/backend/routes/service_routes.py` l. 794–811 (write)
> - `/app/backend/migrations/001_initial_schema.sql` (schéma `service_packages`)

---

## 1. Tables impactées

| Table | POST /services | PUT/PATCH /services |
|-------|:--------------:|:-------------------:|
| `service_packages` | INSERT × N | — (aucune logique) |
| `service_slots` | INSERT × M (avec `package_id` set, `slot_type='single'`) | DELETE total héritage S44 (efface AUSSI slots de packages) |
| `services` | INSERT (via S43) avec `price = min(packages.price)` si nécessaire | — |

---

## 2. Schéma `service_packages`

```sql
CREATE TABLE public.service_packages (
    package_id        text NOT NULL,                 -- PK
    service_id        text,                          -- FK services ON DELETE CASCADE
    type_id           text NOT NULL,
    type_label        text NOT NULL,
    duration_min      integer DEFAULT 60,
    max_participants  integer DEFAULT 1,
    price             numeric(10,2) DEFAULT 0,
    created_at        timestamptz DEFAULT now()
);

ALTER TABLE service_packages ADD CONSTRAINT service_packages_pkey PRIMARY KEY (package_id);
CREATE INDEX idx_service_packages_service_id ON service_packages USING btree (service_id);

-- FK
service_id → services(service_id) ON DELETE CASCADE
```

### Colonnes — usage S45

| Colonne | POST | PUT | DELETE service S43 | Notes |
|---------|:----:|:---:|:------------------:|-------|
| `package_id` | INSERT (`new_id("pkg")`) | — | — | PK |
| `service_id` | INSERT (FK) | — | — (CASCADE indirecte mais soft delete S43 NE déclenche PAS) | |
| `type_id` | INSERT (required) | — | — | string libre |
| `type_label` | INSERT (required) | — | — | string libre |
| `duration_min` | INSERT (default 60 model) | — | — | nombre entier |
| `max_participants` | INSERT (default 1 model) | — | — | nombre entier |
| `price` | INSERT (default 0.0 model) | — | — | NUMERIC(10,2) |
| `created_at` | DEFAULT NOW() | — | — | |

> ⚠️ **Aucune colonne `updated_at`** sur `service_packages`. Pas de tracking des modifications (cohérent avec l'absence de chemin update).

---

## 3. Requêtes SQL textuelles

### POST /services — INSERT packages × N
```sql
INSERT INTO service_packages
  (package_id, service_id, type_id, type_label, duration_min, max_participants, price)
VALUES ($1, $2, $3, $4, $5, $6, $7)
```
- `$1` : `package_id` = `new_id("pkg")`.
- `$2` : `service_id` (le sid fraîchement créé).
- `$3..$7` : champs du DTO.

### POST /services — INSERT slots de packages × M
```sql
INSERT INTO service_slots
  (slot_id, service_id, package_id, slot_type, slot_date, start_time, end_time)
VALUES ($1, $2, $3, 'single', $4, $5, $6)
```
- `slot_type='single'` est **literal** dans le code Python (l. 809). Hardcodé.
- `package_id` est set (vs slots legacy où `package_id=NULL`).
- `location_id`, `days_of_week`, `day_of_week`, `raw_schedule` ne sont **pas spécifiés** ⇒ valeurs par défaut DB :
  - `location_id` → `NULL`
  - `days_of_week` → `'[]'::jsonb`
  - `day_of_week` → `NULL`
  - `raw_schedule` → `NULL`
  - `slot_status` → `'available'`

> ⚠️ Asymétrie vs slots legacy (S44) : les slots de packages **n'ont pas** de `location_id`. Ils héritent virtuellement de la première location du service à l'usage front, mais en DB c'est `NULL`.

---

## 4. Lecture (S42 — référence)

### Non-batché (`_get_service_packages`)
Cf. `SLICE_45_API_CONTRACTS.md` §5. Aucune écriture à faire ici.

### Batché (`_fetch_packages` + package slots batch)
- `service_routes.py` l. 519–545.
- 2 requêtes : 1 sur `service_packages WHERE service_id = ANY($1::text[])`, 1 sur `service_slots WHERE package_id = ANY($1::text[])`.
- Map manuelle des slots aux packages.

---

## 5. Transactions

### Comportement Python actuel
- **Aucun** `async with conn.transaction():` autour des INSERT packages dans POST.
- En cas d'erreur entre l'INSERT du service et l'INSERT du package N, l'état partiel persiste (asymétrie héritée de S43).

### Recommandation Java (héritée S43)
- **`@Transactional`** sur la méthode `create()` du service (recommandé S43).
- L'atomicité couvre service + packages + slots de packages + locations + slots legacy.

### Ordre d'opérations imposé
1. INSERT `services` (cf. S43).
2. INSERT `service_packages` × N. ← S45
3. Pour chaque package : INSERT `service_slots` (avec `package_id`) × M. ← S45
4. INSERT `service_locations` × P (cf. S43).
5. INSERT `service_slots` legacy × Q (cf. S44).
6. SELECT + enrich → réponse.

> ⚠️ **Ordre strict** : packages **avant** slots de packages (FK). Locations **avant** slots legacy (résolution `location_index` cf. S44). Le code Python suit cet ordre exactement.

---

## 6. FKs & Cascades

### `service_packages`
| FK | Cible | Action |
|----|-------|--------|
| `service_id` | `services(service_id)` | `ON DELETE CASCADE` |

### `service_slots` (rappel S44)
| FK | Cible | Action |
|----|-------|--------|
| `package_id` | `service_packages(package_id)` | `ON DELETE SET NULL` |

### Conséquences
1. **Hard delete service** (`DELETE FROM services`) → cascade : `service_packages` supprimés → `service_slots.package_id` passe à `NULL` (puis CASCADE service_id eux-mêmes).
2. **Soft delete service S43** (`UPDATE services SET active=FALSE...`) → AUCUNE cascade. Packages et slots subsistent.
3. **PUT /services avec `slots=[]`** (héritage S44) → DELETE FROM service_slots WHERE service_id → supprime slots de packages aussi (FK SET NULL ne s'applique PAS car les slots eux-mêmes sont supprimés). Les packages restent sans slots.

> ⚠️ Asymétrie BR-44.09 confirmée et amplifiée en S45 : un PUT replace global laisse les packages **vides de slots** mais existants en DB.

---

## 7. Index utiles

- `service_packages(service_id)` — index existant. Utilisé par `_get_service_packages` et `_fetch_packages`.
- `service_slots(package_id)` — pas d'index dédié dans le schéma actuel (à confirmer côté Java perf).

---

## 8. Type `numeric(10,2)` pour `price`

- Précision : 10 chiffres total, 2 décimales.
- Côté Python : float utilisé.
- Côté Java : utiliser `BigDecimal` avec `setScale(2, RoundingMode.HALF_EVEN)` pour éviter les pertes de précision sur les centimes.
- ⚠️ JSON sérialisation : conserver le format `30.00` (2 décimales). Ne pas tronquer en `30`.

---

## 9. Récapitulatif effets de bord SQL ordonnés (POST /services bloc S45)

```
[S43 effets services + locations]
1. INSERT INTO service_packages × len(data.packages)
   For each package:
   2. INSERT INTO service_slots × len(pkg.slots)
      - slot_type = 'single' literal
      - package_id = pkg_id (FK)
      - location_id = NULL (par défaut)
      - days_of_week = '[]'::jsonb (par défaut)
      - slot_status = 'available' (par défaut)
[S44 effets slots legacy]
[S42 effets read enrichment pour la réponse]
```

### PUT /services bloc S45
```
(rien à faire — ServiceUpdate n'expose pas packages)
```
