# SLICE 44 — Test Cases (Slots / Disponibilités)

> Tests d'intégration ciblant la persistance des slots via les endpoints S43.

---

## Pré-requis

- Pool PostgreSQL UP, schéma `service_slots` initialisé.
- S43 mergée (POST/PUT/PATCH /services fonctionnels).
- Helper `_get_service_slots` (S42) opérationnel.
- Utilisateurs : `U_COACH_A` (owner), `U_COACH_B` (autre coach), `U_ADMIN`.

---

# 1. POST /api/services — slots

## TC-S44-1.1 — Service avec 1 slot single
**Body** :
```json
{
  "title": "Yoga matinal",
  "locations": [{"latitude": 48.85, "longitude": 2.35, "precision": "exact"}],
  "slots": [
    {"slot_type": "single", "location_index": 0,
     "slot_date": "2099-05-15", "start_time": "09:00", "end_time": "10:00"}
  ]
}
```
**Attendu** :
- HTTP 200.
- DB : 1 ligne dans `service_slots` avec `slot_type='single'`, `slot_status='available'`, `slot_date='2099-05-15'`, `location_id` = la location créée.
- Réponse JSON : `service.slots[0]` contient le slot (passe le filtre futur).

## TC-S44-1.2 — Service avec 1 slot recurring
**Body** :
```json
{
  "title": "Yoga récurrent",
  "locations": [{"latitude": 48.85, "longitude": 2.35}],
  "slots": [
    {"slot_type": "recurring", "location_index": 0,
     "days_of_week": [1,3,5], "start_time": "18:00", "end_time": "19:00"}
  ]
}
```
**Attendu** :
- DB : `slot_status='available'`, `slot_date=NULL`, `days_of_week=[1,3,5]`, `day_of_week=1` (= `days[0]`).
- Réponse JSON : slot listé (passe le filtre `slot_date IS NULL`).

## TC-S44-1.3 — Slot availability
**Body** : `slot_type='availability', days_of_week=[0,6]`.
**Attendu** : DB OK, `slot_status='available'`, lecture le retourne.

## TC-S44-1.4 — Multiple slots
**Body** : 5 slots mixés (2 single, 2 recurring, 1 availability).
**Attendu** : 5 lignes en DB, ordre d'insertion respecté.

## TC-S44-1.5 — Slot sans location_index avec locations
**Body** : `locations=[L0,L1]`, `slots=[{slot_type:"recurring", ...}]` (sans location_index).
**Attendu** : `location_id = L0` (fallback `loc_ids[0]`).

## TC-S44-1.6 — Slot location_index hors borne
**Body** : `locations=[L0]`, `slots=[{location_index: 5, ...}]`.
**Attendu** : `location_id = L0` (fallback silencieux).

## TC-S44-1.7 — Slot sans aucune location
**Body** : `locations=[]`, `slots=[{...}]`.
**Attendu** : `location_id = NULL`. Pas d'erreur.

## TC-S44-1.8 — `day_of_week` legacy seul
**Body** : `slots=[{slot_type:"recurring", day_of_week: 2, ...}]` (sans `days_of_week`).
**Attendu** : DB `days_of_week=[2]`, `day_of_week=2`.

## TC-S44-1.9 — `days_of_week` vide
**Body** : `slots=[{days_of_week: [], ...}]`.
**Attendu** : DB `days_of_week=[]`, `day_of_week=NULL`.

## TC-S44-1.10 — `raw_schedule` ignoré
**Body** : `slots=[{raw_schedule: {"foo":"bar"}, ...}]`.
**Attendu** : DB `raw_schedule=NULL` (non persisté). **Asymétrie volontaire**.

## TC-S44-1.11 — `location_id` direct ignoré
**Body** : `slots=[{location_id: "sloc_OTHER", location_index: 0, ...}]`, `locations=[L0]`.
**Attendu** : DB `location_id = L0` (location_index gagne, location_id direct ignoré).

## TC-S44-1.12 — `start_time` malformé accepté
**Body** : `slots=[{start_time: "ABC", end_time: "XYZ", ...}]`.
**Attendu** : HTTP 200, DB stocke les strings tels quels (pas de validation Pydantic).

## TC-S44-1.13 — `slot_date` au format étrange
**Body** : `slot_type:"single", slot_date: "31/12/2099"`.
**Attendu** : HTTP 200, stocké tel quel ; le filtre lecture peut le masquer (cast `::timestamp` peut échouer silencieusement → ce slot ne sera pas retourné).

## TC-S44-1.14 — `day_of_week=7` (out of range CHECK CONSTRAINT)
**Body** : `slots=[{slot_type:"recurring", day_of_week: 7, ...}]`.
**Attendu** : Erreur PostgreSQL CHECK → HTTP **500**. Reproduire ce comportement (ne PAS validater côté Java).

## TC-S44-1.15 — Aucun slot fourni
**Body** : `{title:"...", slots:[]}` ou `slots` absent.
**Attendu** : HTTP 200, 0 ligne dans `service_slots`.

## TC-S44-1.16 — Auth absente
**Attendu** : HTTP 401 (cf. S43).

## TC-S44-1.17 — Rôle user
**Attendu** : HTTP 403 (cf. S43).

---

# 2. PUT /api/services/{id} — slots

## TC-S44-2.1 — `slots = null` (champ absent) → keep
**Pré** : 3 slots existants.
**Body** : `{"title": "Updated"}` (pas de slots).
**Attendu** : 3 slots inchangés en DB. `updated_at` du service mis à jour.

## TC-S44-2.2 — `slots = []` → wipe
**Pré** : 3 slots existants.
**Body** : `{"slots": []}`.
**Attendu** : 0 slot en DB pour ce service.

## TC-S44-2.3 — `slots = [...]` → replace
**Pré** : 3 slots existants (S1, S2, S3).
**Body** : `{"slots": [{slot_type:"single", slot_date:"2099-12-31", start_time:"10:00", end_time:"11:00"}]}`.
**Attendu** :
- DB : 1 seul slot (les 3 anciens supprimés).
- Le slot a un nouveau `slot_id` (préfixé `slot_`).
- `slot_status='available'`.

## TC-S44-2.4 — Replace avec nouvelles locations
**Pré** : 1 location L0, 2 slots pointant L0.
**Body** : `{"locations":[NEW_L0], "slots":[{location_index:0, slot_type:"recurring", ...}]}`.
**Attendu** :
- L0 supprimée, NEW_L0 insérée.
- 2 anciens slots supprimés.
- 1 nouveau slot pointant NEW_L0.

## TC-S44-2.5 — Replace slots sans toucher locations
**Pré** : 2 locations L0, L1 (created_at L0 < L1), 1 slot pointant L1.
**Body** : `{"slots":[{location_index:1, slot_type:"recurring", ...}]}` (locations non fourni).
**Attendu** :
- DB : nouveau slot avec `location_id = L1` (résolu via locations existantes ORDER BY created_at).
- L0 et L1 inchangées.

## TC-S44-2.6 — Replace slots avec `data.locations = []`
**Pré** : 1 location, 1 slot.
**Body** : `{"locations":[], "slots":[{location_index:0, ...}]}`.
**Attendu** :
- 0 location.
- 1 nouveau slot avec `location_id = NULL` (loc_id_list vide → fallback null).

## TC-S44-2.7 — Replace `slots=[]` avec locations conservées
**Pré** : 2 locations, 3 slots.
**Body** : `{"slots": []}`.
**Attendu** : 2 locations intactes, 0 slot.

## TC-S44-2.8 — Replace n'efface PAS les slots de packages dans S44
**Pré** : 1 slot legacy (`package_id=NULL`), 1 slot package (`package_id NOT NULL`).
**Body** : `{"slots": []}`.
**Attendu côté Python** : DELETE truncate global → **0 slot** (y compris le slot package, asymétrie BR-44.09).
**Attendu côté Java S44** : reproduire ce comportement Python à l'identique (DELETE truncate sans filtre `package_id`). À S45, il faudra documenter une éventuelle évolution mais pas avant.

## TC-S44-2.9 — Cascade location → SET NULL
**Pré** : 1 location L0, 1 slot pointant L0, slot non-touché par le PUT.
**Body** : `{"locations":[NEW_L]}` (slots non fourni → keep).
**Attendu** :
- L0 deleted, cascade FK `ON DELETE SET NULL` → l'ancien slot a `location_id=NULL`.
- NEW_L insérée.
- Le slot reste mais orphelin de location.

## TC-S44-2.10 — Auth absente → 401 (S43)

## TC-S44-2.11 — Non owner → 403 (S43)

## TC-S44-2.12 — Service introuvable → 404 (S43)

## TC-S44-2.13 — PUT et PATCH iso-comportement
- Même body sur PUT et PATCH → DB état identique.

## TC-S44-2.14 — Replace avec slots invalides (start_time malformé)
**Body** : `{"slots":[{start_time:"NOPE", end_time:"X", ...}]}`.
**Attendu** : HTTP 200, slot stocké tel quel.

---

# 3. Conflits booking ↔ slots

## TC-S44-3.1 — Replace slots avec booking actif (asymétrie volontaire)
**Pré** :
- Slot S1 (`single`, `slot_status='reserved'`).
- Booking B1 actif (`status='accepted'`) pointant `slot_id=S1`.

**Body** : `PUT /services/{id}` avec `{"slots":[]}`.
**Attendu** :
- DB : slot S1 supprimé.
- Booking B1 reste actif mais `bookings.slot_id` pointe vers un slot inexistant.
- Lecture `_get_service_slots` ne le voit plus.
- **Aucune erreur HTTP** (pas de garde Python).
- ⚠️ **Iso-Python attendu** — ne pas ajouter de garde côté Java.

## TC-S44-3.2 — Lecture filtre slots avec booking actif
**Pré** : 2 slots S1 (booking actif), S2 (libre).
**Action** : `GET /services/{id}` (S42).
**Attendu** : `service.slots[]` contient uniquement S2 (S1 masqué par NOT EXISTS).

## TC-S44-3.3 — Lecture filtre slots passés
**Pré** : 1 slot single avec `slot_date` hier, 1 avec demain.
**Attendu** : seul le futur retourné.

## TC-S44-3.4 — Lecture inclut `slot_date IS NULL`
**Pré** : 1 slot recurring (`slot_date=NULL`).
**Attendu** : retourné par `_get_service_slots`.

---

# 4. Tests state machine slot_status (référence S30 — non dans S44)

> Ces tests existent déjà en S30 (booking flows). Listés ici pour rappel.

## TC-S44-4.x (référence)
- `available → reserved` lors de booking instant_booking.
- `available → pending` lors de booking manual_approval.
- `pending → reserved` lors d'accept.
- `reserved → booked` lors de paiement.
- `* → available` lors de cancel/refuse/refund.
- `* → available` lors d'expiry worker.
- `booked → completed` lors de marquage manuel.

> Ne PAS dupliquer ces tests dans S44.

---

# 5. Round-trip & cohérence

## TC-S44-5.1 — POST → GET → PUT → GET
1. POST avec 2 slots.
2. GET service → 2 slots dans la réponse.
3. PUT avec 1 nouveau slot.
4. GET → 1 slot (les 2 anciens supprimés).

## TC-S44-5.2 — DELETE service ne supprime pas immédiatement les slots
**Pré** : 3 slots.
**Action** : `DELETE /services/{id}` (S43 soft delete).
**Attendu** :
- `services.active=false`.
- `service_slots` : 3 lignes **inchangées** (le DELETE est soft, pas de CASCADE car le service n'est pas DELETED hard).

## TC-S44-5.3 — Hard delete service (CASCADE)
**Pré** : 3 slots, 1 service.
**Action** : Hors HTTP — direct `DELETE FROM services WHERE service_id=$1`.
**Attendu** : 0 slot (CASCADE FK).
> Test administrateur DB, pas un test API.

## TC-S44-5.4 — REACTIVATE service ne touche pas les slots
**Pré** : service soft-deleted, 3 slots.
**Action** : `POST /services/{id}/reactivate`.
**Attendu** : 3 slots inchangés.

---

# 6. Edge cases JSONB

## TC-S44-6.1 — `days_of_week` avec doublons
**Body** : `days_of_week=[1,1,1]`.
**Attendu** : DB stocke `[1,1,1]`. Python ne déduplique pas. Iso.

## TC-S44-6.2 — `days_of_week` valeur hors range
**Body** : `days_of_week=[99]`.
**Attendu** : DB stocke `[99]`. Pas de CHECK constraint sur `days_of_week`.

## TC-S44-6.3 — `days_of_week` empty array
**Body** : `days_of_week=[]`.
**Attendu** : DB `days_of_week=[]`, `day_of_week=NULL`.

---

# 7. Couverture exigée

| Catégorie | TCs minimum |
|-----------|-------------|
| POST création slots | 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.8, 1.10, 1.11, 1.15 |
| PUT replace slots | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9 |
| Conflits booking | 3.1, 3.2, 3.3, 3.4 |
| Round-trip | 5.1, 5.2, 5.4 |
| Edge JSONB | 6.1, 6.3 |

> Tous ces tests doivent passer côté Java avant cutover front sur S44.
