# SLICE 45 — API Contracts (Packages)

> **Source** : `/app/backend/routes/service_routes.py` l. 794–811 (POST), `/app/backend/models.py` l. 219–230
> **Aucun nouvel endpoint** : extension du contrat de S43 sur le sous-arbre `packages[]`.

---

## 1. Modèles `ServicePackageItem` & `DaySlotPayload` (input)

```jsonc
// ServicePackageItem
{
  "type_id": "string (required)",
  "type_label": "string (required)",
  "duration_min": "integer (default 60)",
  "max_participants": "integer (default 1)",
  "price": "number (default 0.0)",
  "slots": [DaySlotPayload]   // default []
}

// DaySlotPayload
{
  "slot_date":  "string (required) — 'YYYY-MM-DD'",
  "start_time": "string (required) — 'HH:MM'",
  "end_time":   "string (required) — 'HH:MM'"
}
```

> ⚠️ `ServicePackageItem.slots` est **exclusivement** une liste de `DaySlotPayload` — toujours type `'single'` une fois persisté. Pas de récurrence, pas de `days_of_week`, pas de `location_index` au niveau package.

---

## 2. Endpoint 1 — `POST /api/services` (sous-payload `packages[]`)

### Body partiel
```jsonc
{
  ...,
  "packages": [
    {
      "type_id": "type_basic",
      "type_label": "Cours Basic",
      "duration_min": 60,
      "max_participants": 1,
      "price": 30.0,
      "slots": [
        { "slot_date": "2099-05-15", "start_time": "09:00", "end_time": "10:00" },
        { "slot_date": "2099-05-22", "start_time": "09:00", "end_time": "10:00" }
      ]
    },
    {
      "type_id": "type_pro",
      "type_label": "Cours Pro 6 séances",
      "duration_min": 90,
      "max_participants": 1,
      "price": 150.0,
      "slots": []
    }
  ]
}
```

### Comportement Python (à reproduire en Java)
Pour chaque `pkg` dans `data.packages` :
1. `pkg_id = new_id("pkg")`
2. INSERT package :
   ```sql
   INSERT INTO service_packages
     (package_id, service_id, type_id, type_label, duration_min, max_participants, price)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   ```
3. Pour chaque `slot` dans `pkg.slots` :
   - `slot_id = new_id("slot")`
   - INSERT slot (note : `slot_type='single'` **hardcodé**) :
     ```sql
     INSERT INTO service_slots
       (slot_id, service_id, package_id, slot_type, slot_date, start_time, end_time)
     VALUES ($1, $2, $3, 'single', $4, $5, $6)
     ```

### Calcul `service_price`
```pseudo
service_price = data.price
if service_price is None:
    service_price = min((p.price for p in data.packages), default=0.0)
```
- `data.price` fourni (même 0) → utilisé.
- `data.price=null` ET `data.packages` vide → `0.0`.
- `data.price=null` ET `data.packages` non vide → `min(price)` parmi tous les packages.

> ⚠️ **Une fois persisté, `services.price` n'est JAMAIS recalculé** depuis les packages, même si on edit le service plus tard via PUT.

### Réponse `200 OK`
- Identique à S43.
- Le champ `packages[]` de la réponse est calculé via `_get_service_packages` (S42 helper), qui pour chaque package retourne ses `slots[]` filtrés (futurs + sans booking actif).

### Erreurs
- Aucune erreur spécifique aux packages côté Python.
- `pkg.type_id`, `pkg.type_label` sont **requis** Pydantic (string sans default) → 422 si manquants.
- `DaySlotPayload.slot_date`, `start_time`, `end_time` sont requis → 422 si manquants.
- Aucune validation format date/time (strings libres, comme S44).
- Aucune validation `start_time < end_time`.
- Aucune validation `slot_date` futur.
- Aucune validation `price >= 0` au niveau package (vs validation présente sur `service.price`).

### Effets de bord
1. INSERT × N dans `service_packages`.
2. INSERT × M dans `service_slots` avec `package_id` set et `slot_type='single'`.
3. `services.price` (calculé) inséré dans la requête principale (S43).

---

## 3. Endpoint 2 — `PUT/PATCH /api/services/{service_id}` (sous-payload `packages`)

### Comportement Python (factuel)
- `ServiceUpdate` Pydantic **n'expose PAS** le champ `packages`.
- Si le client envoie `{"packages": [...]}` au PUT/PATCH, **Pydantic l'ignore silencieusement** (aucune erreur, aucune persistance).
- ⇒ **Aucune** modification de packages possible via cet endpoint.

### À reproduire côté Java
- Le DTO `ServiceUpdateDto` Java **NE DOIT PAS** exposer le champ `packages`.
- Si le binding Java est strict (`@JsonIgnoreProperties(ignoreUnknown=false)`), il faut le mettre en `ignoreUnknown=true` ou gérer une whitelist explicite. Le comportement Python = silencieux.

### Effet de bord
- Aucun.

---

## 4. Side effect critique — Replace global slots (héritage S44)

> ⚠️ **Comportement non-évident à conserver tel quel**

Si le client appelle `PUT /api/services/{id}` avec `{"slots": [...]}` ou `{"slots": []}`, le code Python (S44) exécute :
```sql
DELETE FROM service_slots WHERE service_id = $1
```
**Sans filtre** sur `package_id`. Donc tous les slots du service sont supprimés, **y compris ceux liés à des packages** (`package_id NOT NULL`).

### Conséquence
- Les `service_packages` subsistent en DB.
- Mais ils n'ont **plus aucun slot** ⇒ `_get_service_packages` retourne `slots: []` pour chaque package.
- Front : packages affichés sans créneaux disponibles.

### Iso Python à conserver
- **NE PAS** filtrer par `package_id IS NULL` lors du DELETE Java.
- **NE PAS** ajouter de garde « si packages existants, refuser le replace ».
- **NE PAS** réinsérer automatiquement les slots de packages.

> Le coach doit recréer le service intégralement pour repeupler les slots de packages. C'est l'asymétrie produit voulue.

---

## 5. Lecture des packages (`_get_service_packages`, `_fetch_packages` batch)

> **Migré en S42** (référence uniquement, ne pas réimplémenter).

### Helper non-batché (used by `/services/{id}` detail, `/services/saved`)
```sql
SELECT package_id, type_id, type_label, duration_min, max_participants, price
  FROM service_packages
 WHERE service_id = $1
 ORDER BY created_at
```
Pour chaque package, fetch ses slots :
```sql
SELECT slot_id, slot_date, start_time, end_time
  FROM service_slots ss
 WHERE ss.package_id = $1
   AND (
     ss.slot_date IS NULL
     OR (ss.slot_date || ' ' || ss.start_time)::timestamp > NOW()::timestamp
   )
   AND NOT EXISTS (
     SELECT 1 FROM bookings b
      WHERE b.slot_id = ss.slot_id
        AND b.status IN ('pending','accepted','awaiting_payment','confirmed')
   )
 ORDER BY ss.slot_date, ss.start_time
```
> ⚠️ Pattern N+1 (1 SELECT par package). Optimisé en batch dans `_batch_enrich_services_for_owner` (S42).

### Helper batché (used by `/services/mine`)
- Voir `service_routes.py` l. 519–545.
- Fetch global packages WHERE service_id = ANY($1::text[]).
- Fetch global package slots WHERE package_id = ANY($1::text[]).
- Map packages → slots via dict.

---

## 6. Récapitulatif HTTP

| Endpoint | Sous-payload | 200 | 401 | 403 | 422 |
|----------|--------------|:---:|:---:|:---:|:---:|
| POST /services | `packages[]` | ✅ | ✅ (S43) | ✅ (S43) | ✅ champs requis manquants |
| PUT/PATCH /services/{id} | `packages` (ignoré silencieusement) | ✅ (sans effet) | ✅ (S43) | ✅ (S43) | — |

> Pas de nouveau code HTTP introduit par S45.
