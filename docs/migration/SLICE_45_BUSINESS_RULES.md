# SLICE 45 — Business Rules (Packages)

> **Source** : `/app/backend/routes/service_routes.py` (write) + `/app/backend/models.py` (validation)

---

## 1. Validations d'entrée

### `ServicePackageItem` (Pydantic)
```python
class ServicePackageItem(BaseModel):
    type_id: str                # required
    type_label: str             # required
    duration_min: int = 60
    max_participants: int = 1
    price: float = 0.0
    slots: List[DaySlotPayload] = []
```

| Champ | Règle | Erreur |
|-------|-------|--------|
| `type_id` | string requis non null | 422 type_error |
| `type_label` | string requis non null | 422 type_error |
| `duration_min` | int (default 60) | 422 si non-int |
| `max_participants` | int (default 1) | 422 si non-int |
| `price` | float (default 0.0) | 422 si non-numérique |
| `slots` | liste (default []) | 422 si non-liste |

> ⚠️ **Aucune** validation `price >= 0` (alors que `service.price >= 0` est validé sur ServiceCreate). Asymétrie à conserver.
> **Aucune** validation `duration_min > 0`, `max_participants > 0`. Iso Python.

### `DaySlotPayload` (Pydantic)
```python
class DaySlotPayload(BaseModel):
    slot_date: str   # 'YYYY-MM-DD'
    start_time: str  # 'HH:MM'
    end_time: str    # 'HH:MM'
```

| Champ | Règle | Erreur |
|-------|-------|--------|
| `slot_date` | string requis | 422 si manquant |
| `start_time` | string requis | 422 si manquant |
| `end_time` | string requis | 422 si manquant |

> ⚠️ **Aucune** validation format `YYYY-MM-DD` ni `HH:MM`. Strings libres.
> **Aucune** validation `start_time < end_time` ni `slot_date` futur.

---

## 2. Permissions

### Création packages (sous POST /services)
- Auth requise + rôle ∈ {coach, admin} (cf. S43).
- Aucun contrôle propre aux packages.

### Update packages
- **N/A** : aucun chemin disponible côté Python. `ServiceUpdate` n'expose pas le champ.

### Delete packages
- **N/A** : pas d'endpoint dédié.
- Cascade implicite : `DELETE FROM services` → CASCADE → `service_packages` supprimés. Mais le DELETE Python est soft (S43), donc cette cascade ne se déclenche **jamais** en pratique.

---

## 3. Replace / keep / wipe

### Sur POST /services
- **Replace global** : tout `data.packages` est inséré.
- Pas de notion de keep/wipe (création ex nihilo).

### Sur PUT /services/{id}
- **Aucune sémantique** packages.
- Si le client envoie `{packages: [...]}`, Pydantic ignore silencieusement (`extra='ignore'` par défaut).
- ⇒ Pas de keep, pas de wipe, pas de replace.

> ⚠️ **À NE PAS implémenter côté Java** : tentation forte d'ajouter `packages: Optional<List<>>` au DTO Update et de le traiter, mais ce serait une **régression de parité**.

---

## 4. Relation packages ↔ slots

### À la création (POST /services)
- Chaque package dans `data.packages` peut contenir `slots: List[DaySlotPayload]`.
- Chaque slot est inséré avec :
  - `package_id = pkg_id` (FK).
  - `service_id = sid` (FK service).
  - `slot_type = 'single'` (literal, hardcodé).
  - `slot_date`, `start_time`, `end_time` du payload.
  - `location_id = NULL` (jamais set côté package).
  - `days_of_week = []` (default).
  - `slot_status = 'available'` (default).

### À la lecture (S42)
- `_get_service_packages` joint `service_slots ss WHERE ss.package_id = $1`.
- Filtres :
  - `slot_date IS NULL OR (slot_date || ' ' || start_time)::timestamp > NOW()::timestamp`.
  - `NOT EXISTS bookings WHERE status IN ('pending','accepted','awaiting_payment','confirmed')`.

### Booking sur slot de package
- Identique à un slot legacy : transitions `slot_status` gérées par `booking_routes.py` (S30).

---

## 5. Calcul `service_price`

```python
service_price = data.price
if service_price is None:
    service_price = min((p.price for p in data.packages), default=0.0)
```

| Cas | `data.price` | `data.packages` | `services.price` final |
|-----|--------------|------------------|------------------------|
| 1 | `30.0` | n'importe quoi | `30.0` |
| 2 | `0` (zéro) | n'importe quoi | `0.0` (le 0 est respecté) |
| 3 | `null` | `[{price:20}, {price:50}]` | `20.0` |
| 4 | `null` | `[]` | `0.0` (default min) |
| 5 | `null` | non fourni (Pydantic default `[]`) | `0.0` |

> ⚠️ **Une fois persisté, `services.price` n'est jamais recalculé** depuis les packages. Si on edit le service, le prix reste figé sauf si `data.price` est explicitement fourni.

---

## 6. Asymétries Python à conserver

| # | Asymétrie | Détail |
|---|-----------|--------|
| 1 | **Pas de packages dans ServiceUpdate** | Le DTO Pydantic n'expose pas le champ. Java doit faire pareil (DTO sans `packages`). |
| 2 | **Replace global slots efface slots de packages** | `PUT /services {slots:[...]}` → DELETE FROM service_slots WHERE service_id (sans filtre package_id). Iso BR-44.09. |
| 3 | **`slot_type='single'` literal** | Slots de packages sont **toujours** type `'single'`. Hardcodé. |
| 4 | **Slots de packages sans `location_id`** | Toujours NULL en DB. Le front associe à la première location du service à l'affichage. |
| 5 | **Pas de `updated_at` sur `service_packages`** | Pas de tracking. |
| 6 | **Pas de validation `price >= 0` au niveau package** | Vs validation présente sur `service.price`. |
| 7 | **Pas de validation `duration_min > 0` ni `max_participants > 0`** | DB defaults seulement. |
| 8 | **Pas de validation format date/time** | Strings libres. |
| 9 | **`type_id` et `type_label` libres** | Pas de référence à une table de types. Strings arbitraires. |
| 10 | **Pas d'unicité `(service_id, type_id)`** | Le coach peut créer 2 packages avec le même `type_id`. |

---

## 7. Compatibilité front

- Réponse `service.packages[]` exposée via `_get_service_packages` (S42) reste inchangée.
- Le front continue d'envoyer `packages[]` au POST. S45 active simplement la persistance côté Java.
- Le front **ne doit pas** envoyer `packages` au PUT (sinon ignoré silencieusement). À documenter dans le contrat front.

---

## 8. Hors scope (à NE PAS faire dans S45)

- Endpoint standalone `POST /api/services/{id}/packages` → n'existe pas en Python, ne pas créer.
- Endpoint standalone `PUT /packages/{pkg_id}` → idem.
- Endpoint standalone `DELETE /packages/{pkg_id}` → idem.
- Ajouter `packages` à `ServiceUpdateDto` Java → **régression de parité**, ne pas faire.
- Filtrer le DELETE truncate slots par `package_id IS NULL` → ne pas faire (iso BR-44.09).
- Recalcul automatique de `services.price` lors de modifications futures → ne pas faire.
- Validation format date/time → ne pas ajouter.
- Unicité `(service_id, type_id)` → ne pas ajouter.

---

## 9. Synthèse des règles

| Règle | Source |
|-------|--------|
| BR-45.01 | `ServicePackageItem.type_id` et `type_label` sont required strings. |
| BR-45.02 | `duration_min`, `max_participants`, `price` ont des defaults Pydantic (60, 1, 0.0). |
| BR-45.03 | `slots` defaultent à `[]`. |
| BR-45.04 | Pas de validation `price >= 0` package-level (asymétrie vs service.price). |
| BR-45.05 | `DaySlotPayload` requiert `slot_date`, `start_time`, `end_time` strings non null. |
| BR-45.06 | Aucune validation format date/time/temps logique. |
| BR-45.07 | INSERT package avant INSERT slots de package (FK). |
| BR-45.08 | Slots de packages : `slot_type='single'` literal hardcodé. |
| BR-45.09 | Slots de packages : `location_id=NULL` toujours. |
| BR-45.10 | `service_price` calculé : `data.price` sinon `min(packages.price)` sinon `0.0`. |
| BR-45.11 | `service_price` jamais recalculé après création (figé). |
| BR-45.12 | `ServiceUpdate` n'expose pas `packages` ⇒ aucun update possible. |
| BR-45.13 | Replace global slots S44 efface aussi slots de packages (BR-44.09). |
| BR-45.14 | FK `service_packages.service_id → services` `ON DELETE CASCADE`. |
| BR-45.15 | FK `service_slots.package_id → service_packages` `ON DELETE SET NULL`. |
| BR-45.16 | Pas de colonne `updated_at` sur `service_packages`. |
| BR-45.17 | Pas d'unicité `(service_id, type_id)`. |
| BR-45.18 | Permissions héritées S43 (POST = coach/admin). |
