# SLICE_42_TEST_CASES.md — Cas de test Services Coach (lectures)
> Basé sur `routes/service_routes.py:1–754` + BUSINESS_RULES.
> Généré le 2026-04-30.

---

## Convention IDs
- `T42-SRC-NN` = search
- `T42-MIN-NN` = mine
- `T42-SAV-NN` = saved
- `T42-DEA-NN` = deactivated
- `T42-DET-NN` = detail
- `T42-INT-NN` = intégration cross-slice
- `T42-EDGE-NN` = cas limites

---

## Endpoint 1 — `GET /api/services` (search)

### Nominal
| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T42-SRC-01** | Search vide (anonyme) | 0 service active=TRUE | 200 ; `[]` |
| **T42-SRC-02** | 3 services actifs anonyme | 3 rows active=TRUE | 200 ; 3 services enrichis ; `is_owner:false` ; `slots:[]` ; `packages:[]` |
| **T42-SRC-03** | Search avec JWT — auto-exclusion | 5 actifs dont 2 du user courant | 200 ; 3 services (les 2 personnels exclus) |
| **T42-SRC-04** | Search avec JWT invalide | 5 actifs | 200 ; 5 services (try/except silencieux — pas d'auto-exclusion) |
| **T42-SRC-05** | Filtre lat/lng/radius | service A à 5km, B à 50km, radius=10000 | 200 ; A présent, B absent (PostGIS ST_DWithin) |
| **T42-SRC-06** | Filtre coach_id | services de coach1+coach2 ; param `coach_id=coach1` | 200 ; uniquement services coach1 |
| **T42-SRC-07** | Filtre domain_id | services domain1+domain2 ; param `domain_id=domain1` | 200 ; uniquement domain1 |
| **T42-SRC-08** | Cumul filtres (lat+coach+domain) | composé | 200 ; intersection des 3 |
| **T42-SRC-09** | Inactifs exclus | 1 service active=FALSE | 200 ; absent du listing |
| **T42-SRC-10** | LIMIT 100 | 150 services actifs | 200 ; 100 retournés (le reste invisible) |

### Enrichment
| ID | Cas | Vérification |
|---|---|---|
| **T42-SRC-20** | Coach embarqué | `service.coach = {user_id, name, picture, is_coach_verified}` |
| **T42-SRC-21** | avg_rating + review_count | si reviews du coach existent → moyenne arrondie 1 décimale |
| **T42-SRC-22** | Tags lookup | `service.tags = [{tag_id, label_fr, label_en, category_id}]` |
| **T42-SRC-23** | Locations PostGIS | `latitude` et `longitude` extraits via ST_Y/ST_X |
| **T42-SRC-24** | Mask address `100m` | `address` sans numéro + `original_address` ABSENT (non-owner) |
| **T42-SRC-25** | Mask address `1000m` | `address` = ville/quartier ; pays FR retiré |

### Cas limites
| ID | Cas | Attendu |
|---|---|---|
| **T42-SRC-30** | lat sans lng | filtre PostGIS skipé (compat) ; LIMIT 100 retourné |
| **T42-SRC-31** | radius=0 | 0 résultat (PostGIS strict) |
| **T42-SRC-32** | radius énorme (1e8) | tous les services dans le rayon |
| **T42-SRC-33** | service avec 0 image | `images: []` |
| **T42-SRC-34** | service avec images jsonb | `images: [...]` correct |
| **T42-SRC-35** | service avec images legacy text JSON | parse fallback OK |
| **T42-SRC-36** | tag_ids string JSON | parse fallback OK |
| **T42-SRC-37** | service sans location | service présent mais `locations:[]` |

---

## Endpoint 2 — `GET /api/services/mine`

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T42-MIN-01** | Coach sans service | aucun service `coach_id=ME` | 200 ; `[]` |
| **T42-MIN-02** | Coach avec 3 services actifs | 3 actifs + 1 inactif + 1 deleted | 200 ; **3 services** (filtre `active=TRUE` exclut 2) |
| **T42-MIN-03** | ORDER created_at DESC | 3 services t1<t2<t3 | 200 ; ordre [t3, t2, t1] |
| **T42-MIN-04** | is_owner true | tous services | tous `is_owner:true` |
| **T42-MIN-05** | Slots chargés (filtre futurs + non-bookés) | 1 slot futur libre + 1 slot futur booké pending + 1 slot passé | service.slots = [le futur libre uniquement] |
| **T42-MIN-06** | Packages chargés | 2 packages avec leurs slots | service.packages = 2 entrées avec slots[] embarqués |
| **T42-MIN-07** | Original address visible | precision='100m' | `address` masqué + `original_address` présent |
| **T42-MIN-08** | Locations original_description | precision='1000m' | location avec `original_description` |
| **T42-MIN-09** | Sans Authorization | — | 401 |
| **T42-MIN-10** | JWT expiré | — | 401 |

---

## Endpoint 3 — `GET /api/services/saved`

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T42-SAV-01** | User sans sauvegarde | 0 row service_saves | 200 ; `[]` |
| **T42-SAV-02** | User avec 3 sauvegardes | 3 rows | 200 ; 3 services format plat |
| **T42-SAV-03** | ORDER saved_at DESC | t1<t2<t3 | 200 ; [t3, t2, t1] |
| **T42-SAV-04** | available_slots count | 5 slots `available` futurs + 2 passés + 1 booked | 200 ; `available_slots:5` (filtre `slot_status='available' AND slot_date>=today`) |
| **T42-SAV-05** | Format plat (pas tag_ids/tags) | — | service N'A PAS `tag_ids`, `tags`, `coach.is_coach_verified`, `slots`, `packages` |
| **T42-SAV-06** | Latitude/longitude première location | service avec 2 locations | `latitude`/`longitude` = 1ère location |
| **T42-SAV-07** | Service sans location | row `locations` JSON = NULL | `latitude`/`longitude` ABSENTS du payload |
| **T42-SAV-08** | Coach JSON inline | service.coach = `{user_id, name, picture}` | parsé correctement (pas as string) |
| **T42-SAV-09** | Sans Authorization | — | 401 |

---

## Endpoint 4 — `GET /api/services/deactivated`

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T42-DEA-01** | Coach sans service deleted | — | 200 ; `[]` |
| **T42-DEA-02** | 1 service deleted | row deleted_at=now-30j, media_purge_scheduled_at=now+60j | 200 ; 1 entry avec `days_until_media_purge:60` |
| **T42-DEA-03** | Service deleted puis reactivated | row reactivated_at>deleted_at | 200 ; **`[]`** (filtre exclut) |
| **T42-DEA-04** | Service deleted puis reactivated puis re-deleted | row reactivated_at<deleted_at | 200 ; 1 entry (filtre OK) |
| **T42-DEA-05** | Service avec media_purge_scheduled_at NULL | — | 200 ; `days_until_media_purge:null` |
| **T42-DEA-06** | Service media_purged=true | — | 200 ; `media_purged:true` ; `days_until_media_purge:0` |
| **T42-DEA-07** | days_left négatif théorique | scheduled passé | 200 ; `days_until_media_purge:0` (max(0, ...)) |
| **T42-DEA-08** | ORDER deleted_at DESC | 3 services | ordre récents d'abord |
| **T42-DEA-09** | Sans Authorization | — | 401 |

---

## Endpoint 5 — `GET /api/services/{id}`

### Nominal
| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T42-DET-01** | Anonyme — service public actif | id valide | 200 ; service enrichi ; `is_owner:false` ; `original_address` ABSENT |
| **T42-DET-02** | Owner | viewer.user_id = service.coach_id | 200 ; `is_owner:true` ; `original_address` PRÉSENT |
| **T42-DET-03** | Admin | viewer.role = 'admin' | 200 ; `is_owner:true` (admin = owner pour le detail) |
| **T42-DET-04** | Service inactif consultable | active=FALSE | 200 ; détail retourné |
| **T42-DET-05** | Service deleted consultable | deleted_at NOT NULL | 200 ; détail retourné (compat permissive) |
| **T42-DET-06** | Slots et packages chargés | tous types | 200 ; `slots:[...]` `packages:[...]` |

### Erreurs
| ID | Cas | Attendu |
|---|---|---|
| **T42-DET-20** | Service inexistant | 404 ; `{"detail":"Service not found"}` (clé `detail`) |
| **T42-DET-21** | JWT invalide | 200 (try/except optional auth) avec `is_owner:false` |
| **T42-DET-22** | JWT absent | 200 ; `is_owner:false` ; champs sensibles retirés |

---

## Cross-slice integration

| ID | Cas | Vérification |
|---|---|---|
| **T42-INT-01** | S11 booking detail consomme S42 | `GET /bookings/{id}` (S11) inclut `service` enrichi via S42 |
| **T42-INT-02** | S25 home feed cohérent | feed retourne services avec mêmes shapes |
| **T42-INT-03** | S38 marketplace catalogue cohérent | mélange products+services renvoie services format compatible |
| **T42-INT-04** | S37 price-preview après lookup S42 | `GET /services/{id}` → packages → price-preview booking utilise prix `package.price` |
| **T42-INT-05** | S15 cancel booking lookup service info | cancel renvoie `service` info enrichie |
| **T42-INT-06** | S40 marketplace lifecycle vs services lifecycle | deactivated services suivent même pattern (cohérence DDL) |
| **T42-INT-07** | S10 tags lookup | Tags `label_fr/label_en/category_id` de S42 doivent matcher S10 GET tags |

---

## Cas limites

| ID | Cas | Attendu |
|---|---|---|
| **T42-EDGE-01** | Search avec lat=null lng=10 | filtre PostGIS skipé, autres filtres OK |
| **T42-EDGE-02** | Service avec 100 slots | tous chargés en mine/detail (pas de LIMIT) |
| **T42-EDGE-03** | Service avec 50 packages | tous chargés |
| **T42-EDGE-04** | Coach avec 200 services actifs | mine retourne les 200 (pas de LIMIT) — ⚠️ perf |
| **T42-EDGE-05** | tag_ids référence un tag inexistant | `tags[]` skip silencieusement (`if t in tags_lookup`) |
| **T42-EDGE-06** | Service avec coach orphelin | `coach: {}` (vide, pas de FK SQL stricte) |
| **T42-EDGE-07** | Slot avec start_time format malformé | cast `::timestamp` lève → 500 ; Java doit reproduire ou gracefully fallback |
| **T42-EDGE-08** | Service avec address vide string | `_mask_address` retourne `''` (compat) |
| **T42-EDGE-09** | Service deleted_at sans media_purge_scheduled_at | deactivated retourne entry avec `days_until_media_purge:null` |
| **T42-EDGE-10** | Concurrent modification (race) | search/mine peuvent voir des données légèrement obsolètes (acceptable, lecture seule) |

---

## Couverture totale

- **~67 cas** : SRC 17, MIN 10, SAV 9, DEA 9, DET 9, INT 7, EDGE 10
- **Régressions S23** : T42-MIN-09/10, T42-DET-22 (auth)
- **Régressions S11** : T42-INT-01, T42-INT-05 (booking lookup service)
- **Régressions S25** : T42-INT-02 (home feed cohérence)
- **Régressions S37** : T42-INT-04 (price-preview package lookup)
- **Régressions S38/S40** : T42-INT-03, T42-INT-06 (marketplace cohérence)
- **PostGIS** : T42-SRC-05, T42-SRC-23, T42-SAV-06 (ST_DWithin + ST_X/ST_Y)
