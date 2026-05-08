# SLICE 44 — API Contracts (Slots / Disponibilités)

> **Source** :
> - `/app/backend/routes/service_routes.py` l. 826–842 (POST), 949–977 (PUT)
> - `/app/backend/models.py` l. 233–242 (`ServiceSlotItem`)
> **Aucun nouvel endpoint** : extension du contrat de S43 sur le sous-arbre `slots[]`.

---

## 1. Modèle `ServiceSlotItem` (input)

```jsonc
{
  "slot_type": "recurring | single | availability",  // default "recurring"
  "location_id": "string|null",          // legacy / direct DB id (IGNORÉ en write — voir §3)
  "location_index": "integer|null",      // index dans data.locations[] (utilisé en write)
  "raw_schedule": { /* objet libre */ } | null,  // source de vérité du planning complet
  "days_of_week": [0,1,2,3,4,5,6] | null,        // jours actifs (recurring/availability)
  "day_of_week": 0..6 | null,                    // legacy compat (1 seul jour)
  "start_time": "HH:MM",                          // default "00:00"
  "end_time":   "HH:MM",                          // default "00:00"
  "slot_date":  "YYYY-MM-DD" | null               // requis pour slot_type == "single"
}
```

> ⚠️ **`slot_type='specific'` apparaît dans `booking_routes.py` mais n'est jamais utilisé en write côté Python.** Côté Java, accepter en lecture mais ne pas créer de slots `specific` via le contrat actuel.

---

## 2. Endpoint 1 — `POST /api/services` (sous-payload `slots[]`)

### Body partiel
```jsonc
{
  ...,
  "slots": [
    {
      "slot_type": "single",
      "location_index": 0,
      "slot_date": "2026-05-15",
      "start_time": "09:00",
      "end_time": "10:00"
    },
    {
      "slot_type": "recurring",
      "location_index": 0,
      "days_of_week": [1, 3, 5],
      "start_time": "18:00",
      "end_time": "19:00"
    }
  ]
}
```

### Comportement Python (à reproduire en Java)
Pour chaque `slot` dans `data.slots` :
1. **Resolve days** :
   ```pseudo
   days = slot.days_of_week if slot.days_of_week is not None
          else ([slot.day_of_week] if slot.day_of_week is not None else [])
   ```
2. **Resolve location_id** (depuis l'array de `location_id` retournés par les INSERT précédents `data.locations[]` — cf. §3 ci-dessous) :
   ```pseudo
   if slot.location_index is not None and 0 <= slot.location_index < len(loc_ids):
       resolved_loc_id = loc_ids[slot.location_index]
   else:
       resolved_loc_id = loc_ids[0] if loc_ids else None
   ```
3. **INSERT** :
   ```sql
   INSERT INTO service_slots
     (slot_id, service_id, location_id, slot_type,
      days_of_week, day_of_week, start_time, end_time, slot_date)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
   ```
   - `slot_id = new_id("slot")`
   - `days_of_week` est passé tel quel (liste Python → JSONB côté asyncpg ; côté Java : cast `::jsonb`).
   - `day_of_week = days[0] if days else None`.
   - `slot_status` n'est pas spécifié → utilise le DEFAULT `'available'` de la colonne.

### Réponse
- Identique à S43 (objet service enrichi).
- Le champ `slots[]` de la réponse est calculé via `_get_service_slots` (S42), qui filtre :
  - Slots futurs (cast string `(slot_date || ' ' || start_time)::timestamp > NOW()::timestamp` ou `slot_date IS NULL`).
  - Sans booking actif (`NOT EXISTS bookings WHERE status IN ('pending','accepted','awaiting_payment','confirmed')`).

### Erreurs
Aucune erreur spécifique aux slots côté Python. Toute erreur SQL (FK invalide, JSONB malformé) remonte en 500.

> ⚠️ Pas de validation `start_time < end_time`, pas de validation `slot_date` futur, pas de check chevauchement. À NE PAS ajouter côté Java.

### Effets de bord
1. INSERT × N dans `service_slots`.
2. `slot_status` initialisé à `'available'` (default DB).
3. `created_at` = `NOW()` (default DB).
4. `package_id` = `NULL` (legacy slots, deferred S45 pour les slots de packages).

---

## 3. Endpoint 2 — `PUT/PATCH /api/services/{service_id}` (sous-payload `slots[]`)

### Sémantique tri-état (`null` / `[]` / liste)

| `data.slots` | Comportement |
|--------------|--------------|
| `null` (champ absent ou explicit null) | **Aucune touche** à `service_slots`. Les slots existants restent intacts. |
| `[]` (tableau vide) | `DELETE FROM service_slots WHERE service_id = $1` puis aucun INSERT. **Tous les slots supprimés**. |
| `[slot1, slot2, ...]` | `DELETE FROM service_slots WHERE service_id = $1` puis `INSERT × N` avec la nouvelle liste. **REPLACE complet**. |

> ⚠️ **Sémantique strictement identique** à `data.locations` (cf. S43). Ne jamais convertir `null → []` au binding Java.

### Resolution `location_id` (différence avec POST)
Si `data.locations` était fourni dans la même requête, utiliser les **nouvelles** `location_id` insérées :
```pseudo
loc_id_list = new_loc_ids   # = liste retournée par INSERT × N de data.locations
if not loc_id_list:
    # Si data.locations == null OU [], récupérer les locations EXISTANTES
    rows = SELECT location_id FROM service_locations
           WHERE service_id = $1 ORDER BY created_at
    loc_id_list = [r.location_id for r in rows]
```

> ⚠️ **Edge case** : si `data.locations = []` (toutes supprimées) et `data.slots = [...]` (créés), alors `loc_id_list = []`, donc `resolved_loc_id = None` ⇒ tous les slots créés auront `location_id = NULL`.

### Body partiel d'exemple
```jsonc
{
  "slots": [
    {
      "slot_type": "recurring",
      "location_index": 0,
      "days_of_week": [1, 3, 5],
      "start_time": "18:00",
      "end_time": "19:00"
    }
  ]
}
```

### Effets de bord
1. `DELETE FROM service_slots WHERE service_id = $1` (1 requête).
2. `INSERT × N` (séquentiel).
3. Aucun appel à un service de notification.
4. Aucun appel au stockage R2/FS.

### Erreurs
- Auth/permission (cf. S43).
- Aucune erreur spécifique aux slots.

---

## 4. Lecture des slots (`_get_service_slots`)

> **Migré en S42** (référence uniquement, ne pas réimplémenter).

```sql
SELECT slot_id, slot_type, slot_status, location_id, package_id,
       day_of_week, days_of_week, start_time, end_time, slot_date
  FROM service_slots ss
 WHERE ss.service_id = $1
   AND (
     ss.slot_date IS NULL
     OR (ss.slot_date || ' ' || ss.start_time)::timestamp > NOW()::timestamp
   )
   AND NOT EXISTS (
     SELECT 1 FROM bookings b
      WHERE b.slot_id = ss.slot_id
        AND b.status IN ('pending','accepted','awaiting_payment','confirmed')
   )
 ORDER BY ss.slot_date NULLS LAST, ss.start_time
```

Résultat injecté dans `_enrich_service` → réponse JSON `service.slots[]`.

---

## 5. Référence — State machine `slot_status` (déjà migrée S30)

Documenté ici **uniquement** pour comprendre comment les slots créés en S44 sont consommés. **Aucune ligne à écrire dans S44** pour cette logique.

| Transition | Trigger | Source |
|------------|---------|--------|
| `available → pending` | `POST /bookings/request` (mode `manual_approval`, slot `single`/`specific`) | `booking_routes.py:303,353` |
| `available → reserved` | `POST /bookings/request` (mode `instant_booking`, slot `single`/`specific`) | `booking_routes.py:297,353` |
| `pending → reserved` | `POST /bookings/{id}/accept` | `booking_routes.py:519` |
| `reserved → booked` | Paiement confirmé (`POST /bookings/{id}/pay` succès) | `booking_routes.py:495` |
| `pending|reserved → available` | `POST /bookings/{id}/cancel`, `POST /bookings/{id}/refuse`, refund | `booking_routes.py:720,872` |
| `pending|reserved → available` | Worker d'expiry (booking expiré) | `expiry_worker.py:116` |
| `booked → completed` | Marquage manuel par coach après prestation | `booking_routes.py:1016` |

> **Slots `recurring` / `availability`** ne sont **jamais** mutés (`slot_status` reste `available`). Seuls les slots `single`/`specific` voient leur statut modifié.

### Concurrence
- `SELECT ... FOR UPDATE NOWAIT` lors du booking (`booking_routes.py:259`).
- En cas de conflit (`asyncpg.LockNotAvailableError`) → `409 Ce créneau est en cours de réservation — réessayez`.

---

## 6. Récapitulatif HTTP

| Endpoint | Sous-payload | 200 | 401 | 403 | 404 | 422 |
|----------|--------------|:---:|:---:|:---:|:---:|:---:|
| POST /services | `slots[]` | ✅ | ✅ (S43) | ✅ (S43) | — | ✅ types |
| PUT/PATCH /services/{id} | `slots` (null/[]/list) | ✅ | ✅ (S43) | ✅ (S43) | ✅ (S43) | ✅ types |

> Pas de nouveau code HTTP introduit par S44.
