# SLICE_42_API_CONTRACTS.md — Contrats API Services Coach (lectures)
> Basé sur `routes/service_routes.py:1–754`.
> Généré le 2026-04-30.

---

## SVC_FIELDS — colonnes communes
```
service_id, coach_id, title, description, address, price, duration_min,
tag_ids, domain_id, location_description, max_participants, active, images, created_at, updated_at,
booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
```

---

## Endpoint 1 — `GET /api/services` (Search)

### Query params (tous optionnels)
| Param | Type | Défaut | Notes |
|---|---|---|---|
| `lat` | float? | null | Combiné avec `lng` → filtre PostGIS |
| `lng` | float? | null | — |
| `radius` | int | **10000** | Mètres. Défaut **10 km** (NB : default Python = `10000` mètres). |
| `coach_id` | string? | null | Filtre exact |
| `domain_id` | string? | null | Filtre exact |

### Auth
`get_optional_auth` (token JWT lu si présent, ignoré sinon — try/except silencieux). Si `current_user_id` détecté → ajoute `coach_id != $current_user_id` (auto-exclusion services personnels).

### Réponse 200 — array de services enrichis (vue light)

```json
[
  {
    "service_id": "...", "coach_id": "...", "title": "...", "description": "...",
    "address": "Rue Y, Paris" /* masqué selon precision */, "price": 50.0,
    "duration_min": 60, "tag_ids": ["t1","t2"], "domain_id": "d1",
    "location_description": "...", "max_participants": 1, "active": true,
    "images": ["url1","url2"], "created_at": "2026-...", "updated_at": "2026-...",
    "booking_approval_mode": "instant_booking", "allow_pay_later": false,
    "pay_later_expiration_minutes": null,
    "coach": {"user_id":"...","name":"Jean","picture":"...","is_coach_verified":true},
    "avg_rating": 4.7, "review_count": 12,
    "tags": [{"tag_id":"t1","label_fr":"...","label_en":"..."}],
    "locations": [{"location_id":"...","precision":"100m","description":"masked","latitude":48.85,"longitude":2.35}],
    "original_address": "Rue Y 12, Paris" /* uniquement si is_owner */,
    "slots": [],          /* TOUJOURS [] en search (vue light) */
    "packages": [],       /* TOUJOURS [] en search */
    "is_owner": false     /* TOUJOURS false en search */
  }
]
```

### LIMIT
`100` hardcodé (ligne 405). Pas de pagination, pas d'ORDER BY explicite (ordre indéfini).

### Erreurs
- 200 toujours (auth optionnelle, no-row → `[]`).

### Effets de bord
Aucun.

---

## Endpoint 2 — `GET /api/services/mine`

### Auth
`require_auth` obligatoire (401 si JWT KO).

### Réponse 200 — array enrichi (vue owner)
Identique à search mais :
- Filtre `coach_id = $1 AND active = TRUE`
- ORDER BY `created_at DESC`
- **`slots` chargés** (filtre futurs + non-bookés — voir BR-42.05)
- **`packages` chargés** (avec leurs slots intégrés)
- `is_owner = true`
- `original_address` exposé (vs masqué pour search)
- locations avec `original_description` si `precision != 'exact'`

### Format slot
```json
{
  "slot_id": "...", "slot_type": "single|recurring|specific",
  "slot_status": "available|...",
  "location_id": "...", "package_id": "..." /* nullable */,
  "day_of_week": 1, "days_of_week": [1,3], /* recurring */
  "start_time": "10:00:00", "end_time": "11:00:00",
  "slot_date": "2026-05-01" /* nullable pour recurring */
}
```

### Format package
```json
{
  "package_id": "...", "type_id": "...", "type_label": "...",
  "duration_min": 60, "max_participants": 1, "price": 50.0,
  "slots": [/* idem format slot */]
}
```

### Erreurs
- 401 si JWT KO

---

## Endpoint 3 — `GET /api/services/saved`

### Auth
`require_auth` obligatoire.

### Réponse 200 — format **DISTINCT** (plat, pas enrichi)
```json
[
  {
    "service_id": "...", "title": "...", "price": 50.0,
    "images": ["..."], "address": "...", "location_description": "...",
    "duration_min": 60,
    "saved_at": "2026-04-29T10:00:00+00:00",
    "coach": {"user_id":"...","name":"Jean","picture":"..."},
    "latitude": 48.85, "longitude": 2.35,    /* première location seulement, plat */
    "available_slots": 5                       /* int, count slots disponibles >= today */
  }
]
```

> ⚠️ **Format différent** des search/mine : pas de `tag_ids`, pas de `coach.is_coach_verified`, pas de `tags[]`, pas de `slots[]`, pas de `packages[]`. **Compat stricte = Java DOIT préserver ce format plat divergent.**

### `available_slots` count
```sql
SELECT COUNT(*) FROM service_slots slt
WHERE slt.service_id = s.service_id
  AND slt.slot_status = 'available'
  AND slt.slot_date >= TO_CHAR(NOW(), 'YYYY-MM-DD')
```

> ⚠️ Compare `slot_date` (string ?) avec `TO_CHAR(NOW(), 'YYYY-MM-DD')` (string). Java doit reproduire en utilisant `DATE` natif PostgreSQL OU `to_char(current_date, 'YYYY-MM-DD')`.

### Erreurs
- 401 si JWT KO

---

## Endpoint 4 — `GET /api/services/deactivated`

### Auth
`require_auth` obligatoire.

### Réponse 200 — array enrichi minimal + lifecycle fields
Structure proche de l'INSERT brut + champs lifecycle :
```json
[
  {
    /* SVC_FIELDS standards */
    ...,
    "deleted_at": "2026-04-15T...",
    "media_purge_scheduled_at": "2026-07-14T...",
    "media_purged": false,
    "reactivated_at": null,
    "days_until_media_purge": 75,    /* int, calcul applicatif */
    "images": [...]                   /* parsé via build_service */
  }
]
```

### Filtre SQL
```sql
WHERE coach_id = $1 AND deleted_at IS NOT NULL
  AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
ORDER BY deleted_at DESC
```

> ⚠️ **PAS de `_batch_enrich_*`** ici. Pas de `coach`/`tags`/`locations` retournés. Juste les SVC_FIELDS + 4 colonnes lifecycle + `days_until_media_purge`.

### Calcul `days_until_media_purge`
```python
mpsa = row["media_purge_scheduled_at"]
if mpsa:
    delta = (mpsa.replace(tzinfo=utc) if mpsa.tzinfo is None else mpsa) - now_utc
    days_left = max(0, delta.days)
```

### Erreurs
- 401 si JWT KO

---

## Endpoint 5 — `GET /api/services/{service_id}`

### Auth
`get_optional_auth` (parallélisé avec SELECT row via `asyncio.gather`).

### Réponse 200 — service enrichi complet (réutilise enrich owner)
Structure identique à `/services/mine` mais avec :
- `is_owner` = `true` SI `viewer.user_id == svc.coach_id` OU `viewer.role == 'admin'` SINON `false`
- Si `not is_owner` → suppression de `original_address` du root + `original_description` de chaque location

### Filtre SQL initial
```sql
SELECT {SVC_FIELDS} FROM services WHERE service_id = $1
```

> ⚠️ **PAS de filtre `active = TRUE`** ni `deleted_at IS NULL`. Le détail est consultable pour TOUS les services (incluant désactivés). 404 uniquement si row absente.

### Erreurs

| HTTP | Quand | Body |
|---|---|---|
| **404** | row absente | `{"detail": "Service not found"}` (HTTPException → clé `detail`) |

> ⚠️ Format 404 **différent** de S40/S41 marketplace (qui utilise `{"error": ...}`). Java DOIT préserver `{"detail": "Service not found"}` ici.

### Effets de bord
Aucun (lecture pure).

---

## Récap formats erreur

| Code | Endpoint | Format |
|---|---|---|
| 401 | mine, saved, deactivated | (S23 default) |
| 404 | `{id}` | `{"detail": "Service not found"}` (HTTPException) |
| (autres) | search | jamais d'erreur (200 toujours) |

---

## Cas non gérés explicitement

| Cas | Comportement |
|---|---|
| Search `lat` sans `lng` | `if lat is not None and lng is not None:` — branche skipée (pas d'erreur) |
| Search avec radius=0 | PostGIS accepte (résultats vides probablement) |
| Mine avec 0 service actif | 200 ; `[]` |
| Saved avec 0 sauvegarde | 200 ; `[]` |
| Deactivated avec 0 service supprimé | 200 ; `[]` |
| Detail d'un service supprimé (deleted_at NOT NULL) | 200 ; détail retourné (compat) |
| Detail d'un service inactif (active=FALSE) | 200 ; détail retourné |

---

## Effets de bord cross-slice

| Endpoint S42 | Impact S11/S25/S38 |
|---|---|
| `GET /services/{id}` | Booking detail (S11) consomme — sans S42, l'écran de réservation est aveugle |
| `GET /services` | Home feed (S25) JOIN service_locations ; cohérence catalogue |
| `GET /services` (filtre domain_id) | Marketplace (S38) mélange products + services — cohérence référentiel domains/tags |
