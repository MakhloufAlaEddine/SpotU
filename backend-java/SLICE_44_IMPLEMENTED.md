# Slice 44 — Services Slots / Availability

## Statut
Implémentée dans le backend Java sans création de nouvel endpoint HTTP.

Cette slice enrichit les endpoints S43 existants :

- `POST /api/services`
- `PUT /api/services/{id}`
- `PATCH /api/services/{id}`

## Ce qui a été implémenté

- Persistance de `slots[]` sur `POST /api/services`.
- Replace de `slots[]` sur `PUT/PATCH /api/services/{id}` avec tri-état strict :
  - `slots` absent/null => keep
  - `slots=[]` => wipe (`DELETE FROM service_slots WHERE service_id=?`)
  - `slots=[...]` => replace total (delete puis insert N)
- Mapping `service_slots` aligné Python :
  - `slot_type` (`recurring|single|availability`)
  - `days_of_week` JSON
  - `day_of_week = days[0]` ou `null`
  - `start_time`, `end_time`, `slot_date`
  - `package_id` non écrit en S44 (hors scope)
  - `raw_schedule` accepté en payload mais non persisté
  - `location_id` résolu via `location_index` (fallback index 0 ou `null`)
- `slot_status` non passé à l’INSERT pour laisser le default DB (`available`).

## Parité comportementale conservée

- Pas de validation métier ajoutée :
  - pas de check `start_time < end_time`
  - pas de check date future
  - pas de check chevauchement
- Replace global volontairement destructif des slots sur PUT/PATCH.
- `location_id` direct dans payload ignoré (seul `location_index` est utilisé).
- Cohérence round-trip avec les lectures S42 (`GET /api/services`, `/mine`, `/{id}`) : les slots écrits sont retournés.

## Fichiers principaux modifiés

- `src/main/java/com/spotu/modules/services/service/ServicesWriteService.java`
- `src/main/java/com/spotu/modules/services/infra/ServicesRepository.java`
- `src/test/java/com/spotu/modules/services/api/ServicesIntegrationTest.java`
- `src/test/resources/test-schema-users.sql` (default `slot_status`)
- `src/main/resources/db/migration/V9__service_slots_defaults.sql`

## Tables touchées

- `service_slots` (write S44)
- `service_locations` (résolution d’index via locations nouvelles/existantes)
- `services` (indirect via endpoints S43, inchangé fonctionnellement S44)

## Tests

Exécution ciblée :

- `mvn -Dtest=ServicesIntegrationTest test` ✅
- 24 tests, 0 échec

Nouveaux scénarios S44 couverts :

- create avec slots `single/recurring/availability`
- keep slots quand `slots` absent
- wipe slots quand `slots=[]`
- replace slots quand `slots=[...]`
- fallback `location_index` hors borne
- `raw_schedule` accepté sans persistance
- `slot_status` default `available`

## Hors scope conservé

- Packages / slots de packages (`package_id`) => S45
- Endpoints dédiés slots => non existants côté Python
