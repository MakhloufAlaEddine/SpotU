# SLICE 44 — Business Rules (Slots / Disponibilités)

> **Source** : `/app/backend/routes/service_routes.py` (write) + `/app/backend/models.py` (validation)
> Aucun nouvel endpoint. Règles de persistance des slots dans le contexte des endpoints S43.

---

## 1. Validations d'entrée (`ServiceSlotItem`)

### Modèle Pydantic (l. 233–242)
```python
class ServiceSlotItem(BaseModel):
    slot_type: str = 'recurring'   # 'recurring' | 'single' | 'availability'
    location_id: Optional[str] = None      # IGNORÉ en write (legacy)
    location_index: Optional[int] = None
    raw_schedule: Optional[dict] = None    # accepté mais NON persisté
    days_of_week: Optional[List[int]] = None
    day_of_week: Optional[int] = None      # legacy
    start_time: str = '00:00'
    end_time: str = '00:00'
    slot_date: Optional[str] = None
```

### Règles Pydantic actives
- **Aucune** validation de format `start_time`/`end_time` (`HH:MM` non vérifié).
- **Aucune** validation de format `slot_date` (`YYYY-MM-DD` non vérifié).
- **Aucune** validation `start_time < end_time`.
- **Aucune** validation que `slot_date` est **future**.
- **Aucune** validation que `days_of_week` ⊆ `[0..6]` côté Pydantic (le check `day_of_week BETWEEN 0 AND 6` est une CONTRAINTE DB sur `day_of_week` legacy uniquement, pas sur `days_of_week`).
- **Aucune** validation de chevauchement entre slots du même service.

> ⚠️ **À NE PAS ajouter côté Java**. La parité Python est volontairement permissive.

### Erreurs
| Cas | Comportement Python | À reproduire Java |
|-----|---------------------|-------------------|
| `start_time = "25:00"` | Accepté (aucune validation) | Accepter (string libre) |
| `slot_date = "2020-01-01"` (passé) | Accepté ; le filtre lecture le masque (S42) | Idem |
| `days_of_week = [9, 99]` | Accepté ; pas de check | Accepter |
| `day_of_week = 7` | Refusé par CHECK CONSTRAINT DB → erreur SQL → **500** | Reproduire (laisser l'erreur DB remonter) |

---

## 2. Permissions

### Création (POST /services)
- Auth requise + rôle ∈ {coach, admin} (cf. S43).
- Aucun contrôle propre aux slots.

### Update (PUT/PATCH /services/{id})
- Auth requise + owner OR admin (cf. S43).
- Aucun contrôle propre aux slots.

### Pas d'endpoint slot dédié
- Donc pas de permissions « slot-level ». Tout passe par les permissions du service parent.

---

## 3. Statut slot (`slot_status`)

### Valeurs possibles (depuis `booking_routes.py` + DEFAULT colonne)
- `available` — créneau libre, réservable
- `pending` — réservation `manual_approval` en attente d'acceptation coach
- `reserved` — créneau bloqué (acceptée OR `instant_booking` en attente paiement)
- `booked` — paiement confirmé, créneau effectivement vendu
- `completed` — prestation effectuée
- (autres statuts éventuels en doublon — voir `expiry_worker.py`)

### Initialisation
- **Toujours** `'available'` à la création (default DB column).
- Le code Python **ne spécifie jamais** `slot_status` lors de l'INSERT. À reproduire à l'identique.

### Transitions (déjà migrées S30 — référence)
| Transition | Endpoint | Source |
|------------|----------|--------|
| `available → pending` | `POST /api/bookings/request` (mode `manual_approval`, slot `single`) | `booking_routes.py:303` |
| `available → reserved` | `POST /api/bookings/request` (mode `instant_booking`, slot `single`) | `booking_routes.py:297` |
| `pending → reserved` | accept booking | `booking_routes.py:519` |
| `reserved → booked` | paiement confirmé | `booking_routes.py:495` |
| `* → available` | cancel/refuse/refund | `booking_routes.py:720, 872` |
| `* → available` | expiry worker | `expiry_worker.py:116` |
| `booked → completed` | marquage manuel coach | `booking_routes.py:1016` |

> S44 ne touche **aucune** de ces transitions. Documentées en référence.

### Slot types et mutations
- Mutations `slot_status` ne s'appliquent **qu'aux slots `single` / `specific`** (`booking_routes.py:271, 351`).
- Slots `recurring` / `availability` restent **toujours** `'available'`.

---

## 4. Récurrence

### `slot_type='recurring'`
- Champs significatifs : `days_of_week`, `start_time`, `end_time`.
- `slot_date` doit être `null`.
- `day_of_week` (legacy) reflète `days_of_week[0]` ou null.
- Lecture : exposé tel quel par `_get_service_slots` ; le filtre `slot_date IS NULL` les laisse passer.
- **Jamais réservé directement** — la machine de booking exige un slot `single` ou `specific`.

### `slot_type='single'`
- Champs significatifs : `slot_date` (requis fonctionnellement, non vérifié Pydantic), `start_time`, `end_time`.
- `days_of_week` ignoré fonctionnellement (mais persisté tel quel si fourni).
- Lecture : filtré par cast string `(slot_date || ' ' || start_time)::timestamp > NOW()::timestamp`.

### `slot_type='availability'`
- Champs significatifs : `days_of_week`, `start_time`, `end_time` (créneau récurrent type "ouverture de plage").
- Comportement lecture identique à `recurring`.
- Aucune mutation `slot_status` (pas de booking direct).

### `slot_type='specific'`
- Apparaît dans `booking_routes.py` (mutation autorisée) mais **jamais créé** par le code de write actuel.
- À traiter comme `single` pour la lecture/mutation, mais ne PAS le créer via cette slice.

---

## 5. Conflit booking ↔ replace slots (asymétrie critique)

### Scénario
1. Slot `single` `slot_id=X` créé au temps T0, `slot_status='reserved'`.
2. Un booking actif pointe sur `slot_id=X`.
3. Le coach fait un PUT `/services/{id}` avec `slots = [...]`.
4. Le code Python exécute `DELETE FROM service_slots WHERE service_id = $1` (sans filtre slot_status).
5. Le slot X est supprimé. **Le booking pointe sur un slot_id orphelin.**

### Garde Python actuelle
- **Aucune**. Le replace est strictement destructif.
- Le booking continue d'exister et reste consultable, mais `_get_service_slots` ne le verra plus dans la liste.

> ⚠️ **À NE PAS corriger côté Java**. C'est un comportement métier explicite. Documenter clairement dans le code Java :
> ```java
> // [LEGACY-PARITY] Python truncates service_slots without booking guard.
> // Active bookings may end up with orphaned slot_id references.
> // Do NOT add a check — preserve behavior.
> ```

### Recommandation produit (à signaler au PO, pas à coder)
- Ajouter une garde 409 si le PUT supprime un slot avec booking actif.
- Out of scope S44.

---

## 6. Resolution `location_index` — cas limites

### Index hors borne
```python
if slot.location_index is not None and 0 <= slot.location_index < len(loc_ids):
    resolved_loc_id = loc_ids[slot.location_index]
else:
    resolved_loc_id = loc_ids[0] if loc_ids else None
```
- `location_index = -1` → fallback sur `loc_ids[0]`.
- `location_index = 99` (hors borne haute) → fallback sur `loc_ids[0]`.
- `location_index = null` → fallback sur `loc_ids[0]` ou `None`.

### Aucune location existante
- `loc_ids = []` → `resolved_loc_id = None` ⇒ INSERT avec `location_id = NULL`.
- Pas d'erreur. Slot orphelin de location.

> ⚠️ Iso-Python : ne pas valider que `location_index` est présent ou cohérent. Préserver le silent-fallback.

---

## 7. Asymétries Python à conserver

| # | Asymétrie | Détail |
|---|-----------|--------|
| 1 | `raw_schedule` accepté mais non persisté | DTO le déclare ; handler ignore. À NE PAS persister. |
| 2 | `location_id` direct (legacy) ignoré | DTO le déclare ; handler n'utilise que `location_index`. |
| 3 | Aucune validation format temps/date | `start_time`, `end_time`, `slot_date` strings libres. |
| 4 | Aucune garde booking actif sur replace | Le DELETE truncate est inconditionnel. |
| 5 | Pas de transaction explicite | Replace = DELETE puis INSERT séquentiels (cf. S43 reco @Transactional Java). |
| 6 | `slot_status` jamais initialisé explicitement | DEFAULT `'available'` toujours. |
| 7 | `day_of_week` legacy renseigné automatiquement | `days[0] if days else None`. |
| 8 | Slot orphelin de package vs legacy | S44 = legacy (`package_id NULL`) ; S45 = package (`package_id NOT NULL`). |
| 9 | Replace global même pour les slots de package | DELETE `WHERE service_id` supprime AUSSI les slots `package_id NOT NULL`. À NE PAS corriger en S44 (ce sera l'affaire de S45). |
| 10 | Cascade `location_id → SET NULL` orphelinise les slots | Si on replace les locations sans replace les slots, les anciens slots gardent `location_id` qui passe à NULL via cascade. |

---

## 8. Compatibilité front

- Réponse `service.slots[]` exposée via `_get_service_slots` (S42) reste inchangée.
- Le front continue d'envoyer `slots[]` comme avant. S44 active simplement la persistance côté Java.
- Aucun changement de contrat HTTP visible.

---

## 9. Hors scope (à NE PAS faire dans S44)

- Endpoint standalone `POST /api/services/{id}/slots` → n'existe pas en Python, ne pas créer.
- Endpoint standalone `DELETE /api/services/{id}/slots/{slot_id}` → n'existe pas, ne pas créer.
- Validation `start_time < end_time` → ne pas ajouter.
- Validation `slot_date` futur → ne pas ajouter (le filtre lecture s'en charge).
- Garde booking actif sur replace → ne pas ajouter.
- Logique `slot_status` → déjà en S30, ne pas dupliquer.
- Slots de packages → S45.

---

## 10. Synthèse des règles

| Règle | Source |
|-------|--------|
| BR-44.01 | `ServiceSlotItem` accepte tous les champs sans validation Pydantic stricte (types only). |
| BR-44.02 | `slot_status` toujours initialisé à `'available'` (DEFAULT DB, jamais explicite). |
| BR-44.03 | `day_of_week` legacy = `days[0]` ou `null` ; jamais demandé au client. |
| BR-44.04 | `days_of_week` persisté en JSONB (default `'[]'::jsonb`). |
| BR-44.05 | `raw_schedule` accepté mais non persisté (asymétrie). |
| BR-44.06 | `location_id` direct ignoré ; seul `location_index` compte en write. |
| BR-44.07 | `location_index` hors borne → fallback `loc_ids[0]` silencieux. |
| BR-44.08 | Aucune location → `location_id = NULL` (pas d'erreur). |
| BR-44.09 | POST insère séquentiellement après les locations (ordre déterminant). |
| BR-44.10 | PUT `slots = null` ⇒ aucune touche aux slots. |
| BR-44.11 | PUT `slots = []` ⇒ DELETE total, aucune INSERT. |
| BR-44.12 | PUT `slots = [...]` ⇒ DELETE total puis INSERT × N (replace). |
| BR-44.13 | Replace utilise `new_loc_ids` si `data.locations is not None`, sinon locations existantes triées `created_at ASC`. |
| BR-44.14 | Aucune garde booking actif sur replace ; les bookings deviennent orphelins. |
| BR-44.15 | Mutations `slot_status` exclusivement gérées par booking_routes/expiry_worker (S30). |
| BR-44.16 | Slots `recurring`/`availability` ne mutent jamais `slot_status`. |
| BR-44.17 | Cascade FK `service_locations → SET NULL` orphelinise les slots conservés. |
| BR-44.18 | Permissions héritées de S43 (POST=coach/admin, PUT=owner/admin). |
