# SLICE_28_SCOPE.md — Cadrage de la Slice 28
> Basé sur `tagpoint_routes.py:1808–2051`, `models.py` (TagPointCreate, TagPointUpdate).
> Généré le 2026-04-19.

---

## Flow choisi — SpotYou CRUD (create + update + new-date toggle) — 3 endpoints

| # | Méthode | Chemin API | Auth | Complexité | Lignes |
|---|---|---|---|---|---|
| 1 | POST | `/api/tag-points` | STRICTE | ÉLEVÉE | 1808–1863 |
| 2 | PUT | `/api/tag-points/{point_id}` | STRICTE (owner/admin) | **TRÈS ÉLEVÉE** | 1866–2030 |
| 3 | PATCH | `/api/tag-points/{point_id}/new-date` | STRICTE (owner/admin) | TRIVIALE | 2033–2051 |

---

## Justification

| Critère | Justification |
|---|---|
| **Acte fondateur** | Créer un SpotYou = acte fondateur de la plateforme. Sans ça, le contenu n'existe pas. |
| **PostGIS INSERT** | Seul endpoint qui fait `INSERT ... ST_SetSRID(ST_MakePoint())` — pattern nouveau pour Java |
| **JSONB INSERT multiples** | tag_ids, images, event_schedule — 3 champs JSONB dans un seul INSERT |
| **Randomize-for-storage** | Brouillage GPS AVANT stockage (pas au read comme S26) — pattern inversé |
| **Update = le plus complexe write** | 165 lignes, SQL dynamique, diff de valeurs, suppression images retirées, notification membres |
| **Couplé aux reads S26** | Retourne `build_point_response()` documenté en S26 |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `tagpoint_routes.py` | 1808–1863 | POST /tag-points (create) |
| `tagpoint_routes.py` | 1866–2030 | PUT /tag-points/{id} (update) |
| `tagpoint_routes.py` | 2033–2051 | PATCH /tag-points/{id}/new-date |
| `tagpoint_routes.py` | 118–137 | `randomize_for_storage()` helper |
| `models.py` | TagPointCreate, TagPointUpdate | DTOs Pydantic (20+ champs chacun) |
| `upload_routes.py` | `delete_upload_files()` | Suppression images retirées (update) |

---

## Dépendances

| Dépendance | Type | Endpoints |
|---|---|---|
| PostGIS | `ST_SetSRID(ST_MakePoint(lng,lat),4326)` | create, update (location) |
| Table `tag_points` | DB (INSERT/UPDATE/SELECT) | tous |
| Table `spot_you_members` | DB (INSERT) | create (auto-membership owner) |
| `build_point_response()` | Helper S26 | create, update (réponse) |
| `TP_FIELDS` | Projection S26 | create, update (re-read) |
| `delete_upload_files()` | Helper S24 | update (images retirées) |
| `randomize_for_storage()` | Helper local | create (brouillage GPS stockage) |
| `push_service.send_push_to_user` | Service | update (notif membres si changements) |

---

## Niveau de risque

**ÉLEVÉ.**

| Point | Risque |
|---|---|
| Update SQL dynamique (15+ champs conditionnels + JSONB + location) | ÉLEVÉ |
| Diff de valeurs `_vals_equal` (timestamps, floats, JSONB) | MOYEN |
| `randomize_for_storage` (brouillage GPS avant INSERT) | MOYEN |
| Validation capacité min/max croisée | FAIBLE |
| Suppression images retirées (update) | FAIBLE |

---

## Résumé ultra court

- **Flow choisi** : SpotYou CRUD — create (PostGIS INSERT + JSONB + auto-membership) + update (SQL dynamique 165 lignes + diff + suppression images + notification membres) + new-date toggle
- **Tables touchées** : `tag_points` (INSERT/UPDATE), `spot_you_members` (INSERT auto-membership)
- **Top 3 pièges** :
  1. **`randomize_for_storage()` vs `apply_precision_offset()`** : le create brouille GPS AVANT stockage (les coords en DB sont déjà décalées pour precision!=exact). Le read (S26) applique un DEUXIÈME offset pour affichage. Ce sont 2 offsets distincts.
  2. **Update `_vals_equal()` diff** : compare old/new en gérant timestamps (UTC), floats (tolerance 1e-7), et JSONB (json.dumps sort_keys) — notifications envoyées UNIQUEMENT si de vrais changements détectés
  3. **JSONB fields `::jsonb` cast** : tag_ids, images, event_schedule passés en `$N::jsonb` dans le SQL dynamique — asyncpg gère le codec Python list→JSONB, Java doit utiliser PgObject ou `::jsonb` cast explicite
- **Raison du choix** : acte fondateur de la plateforme — sans création de SpotYou, la plateforme n'a pas de contenu
