# SLICE 45 — Test Cases (Packages)

> Tests d'intégration ciblant la persistance des packages via `POST /api/services` (S43).

---

## Pré-requis

- S43, S44 mergées.
- Schéma `service_packages`, `service_slots` initialisé.
- Helper `_get_service_packages` (S42) opérationnel.
- Utilisateurs : `U_COACH_A` (owner), `U_COACH_B` (autre coach), `U_ADMIN`.

---

# 1. POST /api/services — packages

## TC-S45-1.1 — Service avec 1 package sans slots
**Body** :
```json
{
  "title": "Cours yoga",
  "packages": [
    {"type_id":"basic","type_label":"Basic","duration_min":60,"max_participants":1,"price":30.0,"slots":[]}
  ]
}
```
**Attendu** :
- HTTP 200.
- DB `service_packages` : 1 ligne (`type_id='basic'`, `price=30.00`).
- DB `service_slots` : 0 ligne.
- `services.price = 30.0` (= min des packages, car `data.price` non fourni).
- Réponse JSON : `service.packages[0]` présent avec `slots:[]`.

## TC-S45-1.2 — Service avec 1 package + 2 slots
**Body** :
```json
{
  "title":"Yoga avec créneaux",
  "packages":[{
    "type_id":"basic","type_label":"Basic","price":30.0,
    "slots":[
      {"slot_date":"2099-05-15","start_time":"09:00","end_time":"10:00"},
      {"slot_date":"2099-05-22","start_time":"09:00","end_time":"10:00"}
    ]
  }]
}
```
**Attendu** :
- HTTP 200.
- DB : 1 package, 2 slots avec `package_id` set, `slot_type='single'`, `location_id=NULL`, `slot_status='available'`.
- Réponse JSON : `packages[0].slots` contient 2 entrées.

## TC-S45-1.3 — Service avec plusieurs packages
**Body** : 3 packages (`basic 30€`, `standard 50€`, `pro 100€`) dont 1 avec slots.
**Attendu** :
- DB : 3 packages, slots de l'unique package avec slots créés.
- `services.price = 30.0` (min).
- Réponse `packages[]` contient 3 packages dans l'ordre `created_at`.

## TC-S45-1.4 — `data.price` fourni override min
**Body** : `{title:"X", price:99, packages:[{type_id:"a", type_label:"A", price:10}]}`.
**Attendu** : `services.price = 99.0`.

## TC-S45-1.5 — `data.price=0` respecté
**Body** : `{title:"X", price:0, packages:[{type_id:"a", type_label:"A", price:50}]}`.
**Attendu** : `services.price = 0.0` (le 0 explicite respecté, pas de fallback min).

## TC-S45-1.6 — `data.price=null` sans packages
**Body** : `{title:"X"}` (price non fourni, packages non fourni → default `[]`).
**Attendu** : `services.price = 0.0`.

## TC-S45-1.7 — Champ `type_id` manquant
**Body** : `packages:[{type_label:"A", price:10}]`.
**Attendu** : HTTP **422** Pydantic.

## TC-S45-1.8 — Champ `type_label` manquant
**Body** : `packages:[{type_id:"a", price:10}]`.
**Attendu** : HTTP 422.

## TC-S45-1.9 — `slot_date` manquant dans `DaySlotPayload`
**Body** : `packages:[{...,"slots":[{start_time:"09:00",end_time:"10:00"}]}]`.
**Attendu** : HTTP 422.

## TC-S45-1.10 — `price` négatif (asymétrie : pas de validation)
**Body** : `packages:[{type_id:"a", type_label:"A", price:-50}]`.
**Attendu** : HTTP 200, DB stocke `price=-50.00`. Asymétrie BR-45.04 conservée.

## TC-S45-1.11 — `duration_min=0` accepté
**Body** : `packages:[{type_id:"a", type_label:"A", duration_min:0}]`.
**Attendu** : HTTP 200, DB stocke `duration_min=0`. Asymétrie BR-45.07.

## TC-S45-1.12 — `max_participants=0` accepté
**Attendu** : idem, accepté sans validation.

## TC-S45-1.13 — Format `slot_date` libre
**Body** : `slot_date:"31/12/2099"`.
**Attendu** : HTTP 200, DB stocke string telle quelle. Le filtre lecture peut la masquer.

## TC-S45-1.14 — `start_time > end_time`
**Body** : `start_time:"15:00", end_time:"10:00"`.
**Attendu** : HTTP 200. Iso Python.

## TC-S45-1.15 — Plusieurs packages avec même `type_id`
**Body** : 2 packages avec `type_id="basic"`.
**Attendu** : HTTP 200, 2 lignes en DB. Pas d'unicité (BR-45.17).

## TC-S45-1.16 — `precision NUMERIC(10,2)` sur price
**Body** : `price:30.99`.
**Attendu** : DB stocke `30.99` (2 décimales). `price:30.999` → DB stocke `31.00` ou `30.99` selon arrondi PG.

## TC-S45-1.17 — Auth absente → 401 (S43)
## TC-S45-1.18 — Rôle user → 403 (S43)

## TC-S45-1.19 — Slots de package n'ont pas de location_id
**Pré** : `locations:[L0,L1], packages:[{...,slots:[{...}]}]`.
**Attendu** : DB slot de package `location_id=NULL` (jamais set par le code).

## TC-S45-1.20 — Slots de package vs slots legacy coexistent
**Body** :
```json
{
  ...,
  "packages":[{type_id:"a", type_label:"A", slots:[{slot_date:"2099-01-01",start_time:"09:00",end_time:"10:00"}]}],
  "slots":[{slot_type:"recurring", days_of_week:[1], start_time:"18:00", end_time:"19:00"}]
}
```
**Attendu** :
- DB `service_slots` : 2 lignes, l'une avec `package_id` set + `slot_type='single'`, l'autre avec `package_id=NULL` + `slot_type='recurring'`.
- Réponse : `service.slots[]` contient le slot legacy uniquement (filtre via `_get_service_slots` qui inclut tous les slots du service indépendamment du package_id), `service.packages[0].slots[]` contient le slot de package.

> ⚠️ **Note de comportement** : `_get_service_slots` (S42) ne filtre PAS par `package_id IS NULL`. Donc le slot de package apparaît AUSSI dans `service.slots[]` ET dans `service.packages[0].slots[]`. À vérifier en test : duplication possible côté front.

---

# 2. PUT /api/services/{id} — packages (asymétrie)

## TC-S45-2.1 — `packages` ignoré silencieusement
**Pré** : service avec 1 package.
**Body** : `{"packages":[{type_id:"new", type_label:"New", price:99}]}`.
**Attendu** :
- HTTP 200.
- DB `service_packages` : **inchangé** (ancien package toujours là, pas de nouveau).
- Réponse JSON `service.packages[]` = ancien package.
- Asymétrie BR-45.12 confirmée.

## TC-S45-2.2 — `packages` + `title` mixte
**Body** : `{"title":"Updated", "packages":[...]}`.
**Attendu** : `title` mis à jour, packages inchangés. Iso.

## TC-S45-2.3 — DTO Java strict (error case)
- Si le DTO Java est strict (`ignoreUnknown=false`), l'envoi de `packages` provoquerait une erreur. **NE PAS** être strict — Python est `extra='ignore'` par défaut.
- Configurer `@JsonIgnoreProperties(ignoreUnknown=true)` ou ne simplement pas exposer `packages` au DTO update.

---

# 3. Replace global slots et slots de packages

## TC-S45-3.1 — `PUT slots:[]` efface aussi slots de packages
**Pré** :
- 1 package avec 3 slots (`package_id=PKG1`).
- 2 slots legacy (`package_id=NULL`).

**Body** : `{"slots":[]}` (PUT).
**Attendu** :
- DB `service_slots` : 0 ligne (TOUS supprimés, y compris ceux de packages).
- DB `service_packages` : 1 ligne (intact).
- Réponse JSON : `service.packages[0].slots[]=[]`, `service.slots[]=[]`.
- Asymétrie BR-44.09 + BR-45.13 confirmée. Iso Python.

## TC-S45-3.2 — `PUT slots:[...]` replace efface slots de packages
**Pré** : 1 package avec 2 slots, 1 slot legacy.
**Body** : `{"slots":[{slot_type:"recurring", days_of_week:[1]}]}`.
**Attendu** :
- DB : 1 slot legacy uniquement (les 3 anciens supprimés y compris les 2 de packages).
- Package subsiste vide de slots.

## TC-S45-3.3 — `PUT slots:null` keep slots de packages
**Pré** : 1 package avec 2 slots.
**Body** : `{"title":"X"}` (slots non fourni).
**Attendu** : 2 slots de package intacts.

---

# 4. Lifecycle service vs packages

## TC-S45-4.1 — DELETE soft service ne supprime PAS packages
**Pré** : service avec 2 packages, 5 slots de packages.
**Action** : `DELETE /services/{id}` (S43 soft delete).
**Attendu** :
- `services.active=false`.
- DB `service_packages` : 2 lignes intactes.
- DB `service_slots` : 5 lignes intactes.
- Iso S43 (soft delete = pas de cascade).

## TC-S45-4.2 — REACTIVATE service garde packages
**Pré** : service soft-deleted avec packages.
**Action** : `POST /services/{id}/reactivate`.
**Attendu** : packages et slots inchangés.

## TC-S45-4.3 — Hard delete service (admin DB) déclenche CASCADE
**Pré** : service avec packages et slots.
**Action** : `DELETE FROM services WHERE service_id=$1` (DB direct, hors HTTP).
**Attendu** :
- 0 ligne `service_packages` (CASCADE).
- 0 ligne `service_slots` (CASCADE indirect via service_id).
- Test admin DB.

---

# 5. Lecture après écriture

## TC-S45-5.1 — POST → GET cohérent
1. POST avec 2 packages, dont 1 avec slots.
2. GET `/services/{id}`.
3. Vérifier `packages[]` ordre `created_at ASC`.
4. Vérifier `packages[0].slots[]` reflète les slots créés.

## TC-S45-5.2 — Filtrage slots futurs
**Pré** : 1 package avec 1 slot passé (`slot_date="2020-01-01"`) et 1 slot futur.
**Action** : GET service.
**Attendu** : `packages[0].slots[]` contient uniquement le futur (filtre cast `::timestamp > NOW()`).

## TC-S45-5.3 — Masquage slot avec booking actif
**Pré** : 1 package avec 1 slot, booking actif `status='accepted'` sur ce slot.
**Action** : GET service.
**Attendu** : `packages[0].slots[]=[]` (NOT EXISTS bookings).

## TC-S45-5.4 — Round-trip /services/mine batch
**Pré** : coach avec 5 services, chacun avec packages + slots.
**Action** : GET `/services/mine`.
**Attendu** :
- 5 services retournés avec `packages[]` enrichi via batch (`_batch_enrich_services_for_owner`).
- Mêmes données que GET individuels.

## TC-S45-5.5 — Round-trip pricing engine
**Pré** : service créé avec packages.
**Action** : `POST /api/bookings/price-preview` avec `package_id` du package créé.
**Attendu** : pricing calculé sur `package.price` (pas `service.price`). Iso S30/S37.

---

# 6. Edge cases

## TC-S45-6.1 — Package sans slots, service price=null, packages=[]
**Body** : `{title:"X"}`.
**Attendu** : `services.price=0.0`, 0 package, 0 slot.

## TC-S45-6.2 — Package avec un seul `slot.slot_date` au format ISO étrange
**Body** : `slot_date:"2099-05-15T00:00:00Z"`.
**Attendu** : DB stocke string telle quelle. Filtre lecture peut échouer silencieusement (cast timestamp KO → slot pas retourné).

## TC-S45-6.3 — `numeric(10,2)` overflow
**Body** : `price:99999999.99` (8 chiffres avant + 2 = 10).
**Attendu** : DB OK.
**Body** : `price:999999999.99` (9 chiffres + 2 = 11).
**Attendu** : Erreur PostgreSQL → HTTP 500. Iso.

---

# 7. Couverture exigée

| Catégorie | TCs minimum |
|-----------|-------------|
| POST création packages | 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.19, 1.20 |
| Asymétrie PUT | 2.1, 2.2 |
| Replace slots impacte packages | 3.1, 3.2, 3.3 |
| Lifecycle | 4.1, 4.2 |
| Lecture après écriture | 5.1, 5.2, 5.3, 5.5 |
| Edge | 6.1, 6.3 |

> Tous ces tests doivent passer côté Java avant cutover front sur S45.
