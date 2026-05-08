# SLICE 43 — DB Mapping (Services Coach CRUD)

> **Source** : `/app/backend/routes/service_routes.py` l. 756–1104
> SGBD : PostgreSQL + extension PostGIS

---

## 1. Tables impactées (vue d'ensemble)

| Table | POST | PUT/PATCH | DELETE | REACTIVATE |
|-------|:----:|:---------:|:------:|:----------:|
| `services` | INSERT | UPDATE | UPDATE | UPDATE |
| `service_locations` (PostGIS) | INSERT × N | DELETE + INSERT × N | — | — |
| `service_slots` *(deferred S44)* | INSERT × M | DELETE + INSERT × M | — | — |
| `service_packages` *(deferred S45)* | INSERT × P | — | — | — |
| `pending_file_deletions` | — | — | INSERT × img | DELETE × img |
| `conversations` | — | — | UPDATE | UPDATE |
| `app_config` | SELECT | SELECT (conditionnel) | — | — |
| `bookings` | — | — | SELECT (garde) | — |

---

## 2. Table `services`

### Colonnes lues / écrites par les endpoints S43

| Colonne | Type | POST | PUT | DELETE | REACTIVATE |
|---------|------|:----:|:---:|:------:|:----------:|
| `service_id` | text PK | INSERT (`new_id("svc")`) | WHERE | WHERE | WHERE |
| `coach_id` | text FK users | INSERT (= `user.user_id`) | SELECT (auth) | SELECT (auth) | SELECT (auth) |
| `title` | text | INSERT | UPDATE (whitelist) | — | — |
| `description` | text | INSERT | UPDATE | — | — |
| `address` | text | INSERT | — *(non listé scalar)* | — | — |
| `price` | numeric | INSERT (calcul) | UPDATE | — | — |
| `duration_min` | int | INSERT | UPDATE | — | — |
| `tag_ids` | jsonb | INSERT | UPDATE (cast `::jsonb`) | — | — |
| `domain_id` | text | INSERT | UPDATE | — | — |
| `location_description` | text | — | UPDATE | — | — |
| `max_participants` | int | INSERT | UPDATE | — | — |
| `images` | jsonb | INSERT | UPDATE (cast `::jsonb`) + diff | SELECT (pour purge) | — |
| `active` | bool | INSERT (`TRUE`) | UPDATE | UPDATE (`FALSE`) | UPDATE (`TRUE`) |
| `created_at` | timestamptz | DEFAULT | — | — | — |
| `updated_at` | timestamptz | DEFAULT | UPDATE (`NOW()`) | UPDATE (`NOW()`) | UPDATE (`NOW()`) |
| `booking_approval_mode` | text | INSERT (normalisé) | UPDATE (normalisé) | — | — |
| `allow_pay_later` | bool | INSERT (normalisé) | UPDATE (normalisé) | — | — |
| `pay_later_expiration_minutes` | int | INSERT (normalisé `or 1440`) | UPDATE (normalisé `or 1440`) | — | — |
| `deleted_at` | timestamptz | — | — | UPDATE (`NOW()`) | UPDATE (`NULL`) |
| `deleted_by` | text | — | — | UPDATE (`user_id`) | UPDATE (`NULL`) |
| `media_purge_scheduled_at` | timestamptz | — | — | UPDATE (`NOW()+90j`) | UPDATE (`NULL`) |
| `media_purge_notified_at` | timestamptz | — | — | — | UPDATE (`NULL`) |
| `media_purged` | bool | — | — | — | SELECT (lecture) |
| `reactivated_at` | timestamptz | — | — | — | UPDATE (`NOW()`) |

### Requêtes textuelles précises

#### POST /services
```sql
INSERT INTO services
  (service_id, coach_id, title, description, address, price, duration_min,
   tag_ids, domain_id, max_participants, images, active,
   booking_approval_mode, allow_pay_later, pay_later_expiration_minutes)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$13,$14)
```

> ⚠️ `tag_ids` et `images` sont passés comme **listes Python** ; asyncpg gère le cast jsonb. Côté Java/JDBC : sérialiser en JSON et passer comme `::jsonb`.

#### PUT/PATCH /services/{id}
- Whitelist scalaires :
  ```
  {title, description, price, duration_min, active,
   location_description, max_participants, domain_id,
   booking_approval_mode, allow_pay_later, pay_later_expiration_minutes}
  ```
  → `update_dict = { k:v for k,v in payload if v is not None }`

- JSONB (séparés, cast explicite) : `tag_ids`, `images`.

- SQL dynamique :
  ```sql
  UPDATE services
     SET <champs scalaires> = $i, ...,
         tag_ids = $j::jsonb,
         images  = $k::jsonb,
         updated_at = NOW()
   WHERE service_id = $last
  ```

#### DELETE /services/{id}
```sql
UPDATE services
   SET active=FALSE,
       deleted_at=$1,
       deleted_by=$2,
       updated_at=$1,
       media_purge_scheduled_at=$3
 WHERE service_id=$4
```

#### REACTIVATE
```sql
UPDATE services
   SET active=TRUE,
       deleted_at=NULL,
       deleted_by=NULL,
       updated_at=$1,
       media_purge_scheduled_at=NULL,
       media_purge_notified_at=NULL,
       reactivated_at=$1
 WHERE service_id=$2
```

---

## 3. Table `service_locations` (PostGIS)

### Colonnes
| Colonne | Type | Notes |
|---------|------|-------|
| `location_id` | text PK | `new_id("sloc")` |
| `service_id` | text FK | |
| `location` | `geometry(Point, 4326)` | **PostGIS write** |
| `precision` | text | `exact | district | city` |
| `description` | text | adresse texte |
| `created_at` | timestamptz | DEFAULT |

### POST/PUT — INSERT (PostGIS)
```sql
INSERT INTO service_locations
  (location_id, service_id, location, precision, description)
VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6)
```
> Ordre des paramètres : `lid, service_id, **longitude**, **latitude**, precision, description`.
> ⚠️ Java/Spring : utiliser `ST_SetSRID(ST_MakePoint(?, ?), 4326)` via JDBC paramétré (pas de concaténation).

### PUT — Replace strategy (si `data.locations is not None`)
```sql
DELETE FROM service_locations WHERE service_id = $1;
-- puis INSERT × N (cf. ci-dessus)
```

> ⚠️ La sémantique « replace » est **destructive** : aucun update partiel par `location_id`. C'est un wipe & re-insert.

---

## 4. Tables `service_slots` & `service_packages` (deferred S44/S45)

> ⚠️ **À ne pas implémenter dans S43**. Documentées ici uniquement pour cadrage.

### service_slots
- INSERT en POST/PUT (création/replace).
- Resolve `location_id` depuis `location_index` du payload.
- Slot types : `recurring | single | availability`.

### service_packages
- INSERT en POST seulement. UPDATE non géré aujourd'hui en Python.
- Chaque package contient des slots `single` (DaySlotPayload).

→ Cf. `SLICE_44_*` et `SLICE_45_*` (à venir).

---

## 5. Table `pending_file_deletions`

### Colonnes lues / écrites
| Colonne | Type | Notes |
|---------|------|-------|
| `file_url` | text | URL R2 ou locale |
| `entity_type` | text | Ici : `'service'` |
| `entity_id` | text FK service | |
| `scheduled_at` | timestamptz | `now() + 90 days` lors du DELETE |
| `status` | text | `'pending'` par défaut |

### DELETE /services/{id} — INSERT
```sql
INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at)
VALUES ($1, 'service', $2, $3)
ON CONFLICT DO NOTHING
```

### REACTIVATE — DELETE
```sql
DELETE FROM pending_file_deletions
 WHERE entity_id = $1 AND status = 'pending'
```

---

## 6. Table `conversations`

### DELETE /services/{id}
```sql
UPDATE conversations
   SET context_deleted=TRUE
 WHERE context_id=$1 AND context_deleted=FALSE
```

### REACTIVATE
```sql
UPDATE conversations
   SET context_deleted=FALSE
 WHERE context_id=$1 AND context_deleted=TRUE
```

> Critère de matching : `conversations.context_id = services.service_id` (1 service ⇄ N conversations).

---

## 7. Table `app_config` (lecture seule)

### POST + PUT/PATCH (conditionnel)
```sql
SELECT config_key, config_value
  FROM app_config
 WHERE config_key IN ('enable_manual_approval_for_services',
                      'enable_pay_later_for_services')
```
- Convention : `config_value == 'true'` → flag activé (string).

> Sur PUT, la lecture n'est faite que si `booking_approval_mode` OU `allow_pay_later` est présent dans le payload (cf. handler `update_service`).

---

## 8. Table `bookings` (garde lecture seule, DELETE)

```sql
SELECT COUNT(*) FROM bookings
 WHERE service_id = $1
   AND status IN ('pending','accepted','awaiting_payment','confirmed')
```
> Active la garde 409 (sauf admin).

---

## 9. PostGIS

### Écritures (S43)
- `service_locations.location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)`
- SRID **4326** (WGS-84) ; ne JAMAIS changer.

### Pas de PostGIS read côté S43 — la lecture est gérée par S42.

---

## 10. Transactions

### Comportement Python actuel
| Endpoint | Wrapping transaction |
|----------|----------------------|
| POST /services | ❌ **Aucun** `async with conn.transaction():` ; multiples INSERTs séquentiels. |
| PUT/PATCH | ❌ Idem. |
| DELETE | ❌ Idem. |
| REACTIVATE | ❌ Idem. |

> ⚠️ **Asymétrie / Risque** : aucun de ces handlers Python n'utilise `conn.transaction()`. Si un INSERT échoue après un autre, l'état partiel persiste.

### Recommandation Java
- **Imposer `@Transactional`** sur les 5 endpoints (PROPAGATION_REQUIRED, ROLLBACK_FOR Exception).
- Garder le comportement Python actuel comme « legacy » mais **corriger** côté Java sans changer la sémantique métier.
- Documenter clairement le diff dans le code Java (commentaire de classe).

---

## 11. Index utiles (existants à confirmer côté Java pour perfs)

- `services(service_id)` PK — déjà présent.
- `services(coach_id)` — utilisé par `services/mine` (S42).
- `service_locations(service_id)` — utilisé par REPLACE (S43).
- `service_slots(service_id)` — utilisé par REPLACE (S44).
- `pending_file_deletions(entity_id, status)` — utilisé par REACTIVATE.
- `bookings(service_id, status)` — utilisé par garde DELETE.

---

## 12. Récapitulatif effets de bord SQL ordonnés

### POST /services
```
1. SELECT app_config (flags)
2. INSERT services
3. INSERT service_packages × N        [deferred S45]
4.   INSERT service_slots × M         [deferred S44]
5. INSERT service_locations × P       (PostGIS)
6. INSERT service_slots × M           (legacy slots — deferred S44)
7. SELECT services WHERE service_id   (rebuild + enrich)
```

### PUT/PATCH /services/{id}
```
1. SELECT services WHERE service_id (auth + check existence)
2. SELECT app_config (si config booking touchée)
3. SELECT services.images (si images dans payload)
4. delete_upload_files(removed)       (R2/FS — sync)
5. UPDATE services (whitelist + jsonb)
6. DELETE service_locations + INSERT × N   (si locations non null)
7. DELETE service_slots + INSERT × M       (si slots non null — deferred S44)
8. SELECT services WHERE service_id (rebuild + enrich)
```

### DELETE /services/{id}
```
1. SELECT services (auth + check existence + images)
2. SELECT COUNT(bookings actifs)      (sauf admin)
3. UPDATE services (soft delete + media_purge_scheduled_at)
4. UPDATE conversations SET context_deleted=TRUE
5. INSERT pending_file_deletions × img (ON CONFLICT DO NOTHING)
```

### REACTIVATE
```
1. SELECT services (auth + check + media_purged)
2. DELETE pending_file_deletions WHERE entity_id=$1 AND status='pending'
3. UPDATE services (active + reactivated_at)
4. UPDATE conversations SET context_deleted=FALSE
```
