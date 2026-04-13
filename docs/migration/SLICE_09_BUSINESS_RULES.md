# SLICE_09_BUSINESS_RULES.md — Règles métier
> Basé sur `service_routes.py:1–753`.
> Généré le 2026-02-XX.

---

## RG-01 — Filtre `active=TRUE` toujours appliqué

**Source :** `service_routes.py:373` — `conditions = ["active = TRUE"]`

Seuls les services actifs sont retournés, quel que soit l'appelant, même authentifié.
Les services inactifs ne sont jamais exposés via ces deux endpoints publics.

---

## RG-02 — Exclusion des propres services (GET /api/services, si authentifié)

**Source :** `service_routes.py:376–379`

```python
if current_user_id:
    conditions.append(f"coach_id != ${param_idx}")
    params.append(current_user_id)
```

Un coach authentifié ne voit pas ses propres services dans les résultats de recherche.
Cette règle n'affecte pas `GET /api/services/{id}` (vue détail).

**Raison business :** Éviter qu'un coach voit ses propres services dans les suggestions/recherche.

---

## RG-03 — LIMIT 100 hardcodé (GET /api/services)

**Source :** `service_routes.py:405` — `LIMIT 100`

Pas de pagination. Les 100 premiers services actifs correspondant aux filtres sont retournés.
Aucun paramètre de pagination exposé.

---

## RG-04 — Slots et packages vides dans la liste (performance intentionnelle)

**Source :** `service_routes.py:343–344`

```python
svc["slots"]    = []
svc["packages"] = []
```

Dans `GET /api/services`, les slots et packages ne sont **jamais** chargés, même si des créneaux existent.
Ce sont des données lourdes chargées uniquement dans `GET /api/services/{id}`.
`is_owner = False` toujours dans la liste (même si le coach consulte).

**En Java :** Toujours retourner `slots = []` et `packages = []` pour `GET /api/services`.

---

## RG-05 — Slots filtrés : futurs + sans réservation active (vue détail)

**Source :** `service_routes.py:122–141` (logique SQL)

Un slot est retourné si :
1. `slot_date IS NULL` (créneau récurrent) OU `slot_date + start_time > NOW()` (ponctuel futur)
2. `NOT EXISTS booking actif` (`status IN (pending, accepted, awaiting_payment, confirmed)`)

Un slot passé est masqué. Un slot futur mais réservé est masqué.
**En Java :** Reproduire les deux conditions du WHERE dans la requête SQL native.

---

## RG-06 — Masquage d'adresse selon precision (service_locations)

**Source :** `service_routes.py:68–97` (`_mask_address`)

| precision | Comportement |
|---|---|
| `exact` | Adresse complète retournée |
| `100m` | Numéro de rue retiré (regex) |
| `1000m` | Ville ou arrondissement uniquement |

Le même masquage est appliqué à :
- `svc["address"]` (top-level) — basé sur la precision de la 1ère location
- `loc["description"]` dans chaque objet de `locations[]`

**En Java :** Pour v1, si la reproduction exacte de `_mask_address` est trop complexe,
documenter l'écart et retourner la description masquée approximativement.

---

## RG-07 — is_owner : coach propriétaire ou admin

**Source :** `service_routes.py:735`

```python
is_owner = viewer is not None and (viewer["user_id"] == svc["coach_id"] or viewer.get("role") == "admin")
```

- `viewer.user_id == svc.coach_id` → propriétaire
- `viewer.role == "admin"` → admin (voit tout comme propriétaire)
- Sinon → `is_owner = False`

Si `is_owner = True` :
- `original_address` exposé dans `svc`
- `original_description` exposé dans chaque `loc` de `locations[]`

Si `is_owner = False` :
- `original_address` supprimé (`result.pop("original_address", None)`)
- `original_description` supprimé de chaque location

---

## RG-08 — avg_rating par coach (pas par service)

**Source :** `service_routes.py:267–276`

`avg_rating` et `review_count` sont calculés depuis `reviews WHERE reviewee_id = coach_id`.
Un coach avec plusieurs services actifs affiche le même `avg_rating` sur tous.
`avg_rating = null` si le coach n'a aucune review.

---

## RG-09 — booking_approval_mode NON normalisé en GET

**Source :** Absence de `_normalize_booking_config` dans les GET handlers

La normalisation des flags globaux (`enable_manual_approval_for_services`, `enable_pay_later_for_services`) est appliquée uniquement lors des opérations d'écriture (create/update).

Pour les GET, la valeur brute stockée en DB est retournée telle quelle.

---

## RG-10 — images : JSONB parsé en liste Python

**Source :** `service_routes.py:50–60` (`build_service`)

`images` JSONB peut arriver depuis asyncpg en string JSON (cas legacy) ou en liste Python.
`build_service` normalise en liste Python. Si null → `[]`. Si parse error → `[]`.

Même pattern pour `tag_ids`.

---

## Cohérence avec Slice 04 (profil public)

Dans `GET /api/users/{user_id}/public` (Slice 04), les services d'un coach étaient déjà
listés dans le champ `services[]` — mais avec une requête distincte et sans enrichissement complet :

```sql
-- Slice 04 (user_routes.py:178)
SELECT service_id, title, description, price, duration_min, location_description,
       max_participants, tag_ids, domain_id, images
FROM services WHERE coach_id=$1 AND active=TRUE
```

**Différences Slice 04 vs Slice 09 :**

| Aspect | Slice 04 `/public` services[] | Slice 09 `GET /api/services?coach_id=X` |
|---|---|---|
| Champs retournés | 10 colonnes | 18 (SVC_FIELDS) + enrichissements |
| coach object | Non | **OUI** |
| avg_rating | Non | **OUI** |
| locations[] | Non | **OUI** |
| tags[] | Non | **OUI** |
| slots | Non | `[]` |
| packages | Non | `[]` |
| Limit | Aucun | 100 |
| Tri | Non | Non |

---

## Niveau de confiance

| Règle | Confiance | Source |
|---|---|---|
| RG-01 active=TRUE | HAUTE | Code explicite |
| RG-02 Exclusion propres services | HAUTE | Code lignes 376–379 |
| RG-03 LIMIT 100 | HAUTE | SQL ligne 405 |
| RG-04 slots/packages vides liste | HAUTE | Code lignes 343–344 |
| RG-05 Slots filtrés | HAUTE | SQL complet lignes 500–516 |
| RG-06 Masquage adresse | HAUTE | `_mask_address` lue complète |
| RG-07 is_owner admin aussi | HAUTE | Code ligne 735 |
| RG-08 avg_rating par coach | HAUTE | SQL confirmé |
| RG-09 booking_mode non normalisé en GET | HAUTE | Appels à normalisation absents des GET |
| RG-10 images JSONB parsé | HAUTE | `build_service` lu complet |
