# Slice 45 — Services Packages

## Statut
Implémentée dans `backend-java` **sans nouvel endpoint HTTP**.

La slice enrichit uniquement `POST /api/services` avec la persistance de `packages[]` et des slots imbriqués de package.

## Endpoints impactés

- `POST /api/services` : enrichi (packages write actif)
- `PUT /api/services/{id}` : packages ignorés (no-op)
- `PATCH /api/services/{id}` : packages ignorés (no-op)

## Comportements alignés Python

- Packages persistés uniquement à la création.
- `services.price` :
  - valeur explicite `price` conservée
  - sinon `min(packages.price)` ; fallback `0.0`
- Slots de package insérés dans `service_slots` avec :
  - `slot_type='single'` (literal)
  - `package_id` renseigné
  - `location_id=NULL`
  - `days_of_week/day_of_week/slot_status` non forcés (defaults DB)
- Pas d’update packages via PUT/PATCH (asymétrie Python conservée).
- Remplacement global slots S44 conservé : peut vider aussi les slots de package.

## Implémentation technique

- `ServicesWriteService` :
  - ajout `persistPackages(...)` dans le flux `create(...)`
  - validation 422 des champs requis package/slot (`type_id`, `type_label`, `slot_date`, `start_time`, `end_time`)
  - aucun traitement de `packages` dans `update(...)`
- `ServicesRepository` :
  - ajout `insertPackage(...)`
  - ajout `insertPackageSlot(...)`

## Tables touchées

- `service_packages` (insert)
- `service_slots` (insert slots de package)
- `services` (price calculé au create si `price` absent)

## Tests

`ServicesIntegrationTest` complété avec cas S45 :

- create service avec packages
- min price dérivé des packages
- slots de package créés
- `location_id=null` sur slots de package
- PUT ignore `packages`
- replace global slots efface les package slots (parité Python)

Exécution :

- `mvn -Dtest=ServicesIntegrationTest test` ✅
- 27 tests, 0 échec

## Hors scope conservé

- Aucun endpoint packages dédié
- Aucun update/delete packages via PUT/PATCH
- Aucun refactor cross-slice
