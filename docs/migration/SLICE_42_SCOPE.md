# SLICE_42_SCOPE.md — Cadrage de la Slice 42 (Services Coach — Lectures)
> Basé sur `routes/service_routes.py:1–754`.
> Généré le 2026-04-30.

---

## Endpoints choisis (5) — `routes/service_routes.py`

| # | Méthode | Chemin API | Auth | Lignes | Complexité |
|---|---|---|---|---|---|
| 1 | GET | `/api/services` (search) | `get_optional_auth` (exclusion auto-services si connecté) | 352–413 | ÉLEVÉE (PostGIS + batch enrich + filtres dynamiques) |
| 2 | GET | `/api/services/mine` | `require_auth` | 416–427 | ÉLEVÉE (batch enrich owner — 7 queries // dont slots+packages) |
| 3 | GET | `/api/services/saved` | `require_auth` | 645–684 | MOYENNE (1 query + JOIN avec sous-requêtes JSON agg) |
| 4 | GET | `/api/services/deactivated` | `require_auth` | 687–715 | MOYENNE (lifecycle SAV — calcul `days_until_media_purge`) |
| 5 | GET | `/api/services/{service_id}` | `get_optional_auth` (is_owner détecté) | 718–753 | ÉLEVÉE (`_enrich_service_detail` réutilise owner enrich) |

---

## Périmètre fonctionnel

### Endpoint 1 — `GET /services` (Search)
Catalogue public des services (filtre `active = TRUE`). Filtres optionnels : `lat/lng/radius` (PostGIS `ST_DWithin` via JOIN `service_locations`), `coach_id`, `domain_id`. **Auto-exclusion** des services du user courant (si connecté). LIMIT 100 hardcodé. Enrichissement 4 batch parallèles (`_batch_enrich_services_for_search`) : coaches, locations (description masquée selon `precision`), reviews agrégées, tags lookup. **Slots et packages NON chargés** (vue light search).

### Endpoint 2 — `GET /services/mine` (Coach dashboard)
Liste des services actifs du coach courant (`coach_id = user_id AND active = TRUE`). Triés `created_at DESC`. Enrichissement 7 batch parallèles (`_batch_enrich_services_for_owner`) avec **slots et packages disponibles** (filtre futurs + non bookés via NOT EXISTS bookings status pending/accepted/awaiting_payment/confirmed). `is_owner=true`, `original_address` exposé.

### Endpoint 3 — `GET /services/saved` (Liste sauvegardes utilisateur)
Services sauvegardés via `service_saves`. JOIN inline avec `users` + sous-requêtes `json_agg` PostgreSQL pour locations + COUNT pour `available_slots`. Triés `saved_at DESC`. Réponse plate (latitude/longitude première location, pas tableau complet).

### Endpoint 4 — `GET /services/deactivated` (Services soft-deleted du coach)
Services dont `deleted_at IS NOT NULL AND (reactivated_at IS NULL OR reactivated_at < deleted_at)` du coach courant. Calcul applicatif `days_until_media_purge` à partir de `media_purge_scheduled_at`. Préfigure le pattern lifecycle S40 (DELETE/Reactivate marketplace) pour services.

### Endpoint 5 — `GET /services/{service_id}` (Détail)
SELECT par id (peu importe `active` ou `deleted_at`). 404 si introuvable. Détection `is_owner` (coach lui-même OU `user.role='admin'`). Réutilise `_batch_enrich_services_for_owner` (1 service en liste) puis ajuste : `is_owner` flag + suppression `original_address` + `original_description` si non-owner.

---

## Auth & permissions

| Endpoint | Auth | Comportement |
|---|---|---|
| `/services` | **Optionnelle** (`get_optional_auth`) | 200 toujours ; si JWT présent → exclut les services du user |
| `/services/mine` | **Requise** | 401 si JWT KO |
| `/services/saved` | **Requise** | 401 si JWT KO |
| `/services/deactivated` | **Requise** | 401 si JWT KO |
| `/services/{id}` | **Optionnelle** | 200 toujours ; `is_owner` calculé selon JWT |

> ⚠️ Aucun endpoint S42 ne requiert `role='coach'`. Lectures publiques côté search/detail. Les écritures auront leur propre slice (S43).

---

## Dépendances (slices déjà documentées)

| Dépendance | Slice | Usage en S42 |
|---|---|---|
| `require_auth` / `get_optional_auth` | **S23** | Auth des 3 endpoints requis + JWT decoder pour search |
| `domains`, `tags` référentiels | **S10** | Filtre `domain_id` search + lookup `tags_lookup` enrichissement |
| `service_slots` (lecture) | partiel **S11/S25** | Slots disponibles dans enrich owner + `available_slots` count saved |
| `bookings` (NOT EXISTS) | **S11** | Filtre slots non-bookés (status pending/accepted/awaiting_payment/confirmed) |
| `service_locations` (PostGIS) | **S25** | Search + enrich locations |
| `users` (read coach info) | **S23/S24** | Snapshot coach `name`, `picture`, `is_coach_verified` |
| `service_saves` | nouveau S42 | Lecture seule — writes save/unsave en S43 |
| `service_packages` | nouveau S42 | Lecture seule — writes en S43 |

---

## Tables touchées (lecture seule)

| Table | Op | Endpoint(s) | Usage |
|---|---|---|---|
| `services` | SELECT | tous | source principale |
| `service_locations` | SELECT (`ST_X`/`ST_Y` extract) | search + enrich | PostGIS coordinates + precision masking |
| `service_slots` | SELECT (NOT EXISTS bookings) | mine + detail | slots disponibles |
| `service_packages` | SELECT | mine + detail | formules avec slots intégrés |
| `service_saves` | SELECT (JOIN) | saved | timestamps + listing |
| `users` | SELECT | tous (coach JOIN) | snapshot coach |
| `reviews` | SELECT (AVG, COUNT GROUP BY) | tous | rating coach agrégé |
| `tags` | SELECT (`= ANY(...)`) | tous | lookup labels FR/EN |
| `bookings` | NOT EXISTS sub-query | mine + detail | filtrage slots non-bookés |
| `app_config` | SELECT (helper `_get_booking_flags` — non utilisé en S42 reads) | — | feature flags (pour writes S43) |

---

## Niveau de risque : **ÉLEVÉ**

| Facteur | Note |
|---|---|
| PostGIS `ST_DWithin` + `ST_X`/`ST_Y` extract | 🔴 |
| `_batch_enrich_*` 7 queries en `asyncio.gather` parallèle | 🔴 |
| Filtre slots futurs `(slot_date \|\| ' ' \|\| start_time)::timestamp > NOW()` | 🟡 |
| `NOT EXISTS` sous-requête bookings | 🟡 |
| `_mask_address` (précision exact/100m/1000m + skip country names FR) | 🟡 |
| `images` parsing dual `json.loads` fallback | 🟡 |
| `tag_ids` parsing dual (parfois string JSON parfois liste) | 🟡 |
| `available_slots` PostgreSQL `TO_CHAR(NOW(), 'YYYY-MM-DD')` (saved) | 🟡 |
| Sous-requêtes `json_agg` + `json_build_object` (saved) | 🔴 |
| `days_until_media_purge` calcul applicatif Python timezone-aware | 🟡 |
| Réutilisation enrich owner pour detail + override is_owner/sensitive fields | 🟡 |
| LIMIT 100 hardcodé sans pagination | 🟢 |

---

## Justification du choix de slice

| Critère | Justification |
|---|---|
| **Maximum de déblocage front** | 5 lectures = 5 écrans débloqués : Search services / Mes services coach / Sauvegardés / Désactivés / Détail service (utilisé par Booking flow !) |
| **Dépendance booking critique** | `GET /services/{id}` est appelé par l'écran de réservation. **Sans S42, impossible de réserver côté Java** même avec S11–S15 migrés. |
| **Pattern enrichment réutilisable** | Les 3 helpers `_batch_enrich_services_for_search`, `_batch_enrich_services_for_owner`, `_enrich_service_detail` sont la **fondation des writes S43+** (création/édition retournent le service enrichi). |
| **Slice mono-fichier** | 754 lignes Python, ~30 % du fichier `service_routes.py`. Auto-suffisant. |
| **Lecture seule = risque maîtrisé** | Pas de Stripe (pas de sync product/price), pas d'upload R2, pas de PostGIS write. Idéal pour valider la stack Spring + PostGIS. |
| **Pré-requis du pricing-engine** | `GET /services/{id}` retourne les `packages` qui contiennent les `price` consultés par `POST /bookings/price-preview` (S37). |
| **Sans S42, S11/S25/S38 partiellement aveugles** | S25 (home feed) JOIN service_locations, S38 (marketplace) mélange products + services. Le détail service côté Java permet de fermer ces flows sans appel proxy Python. |

### Alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| Inclure les writes (POST/PUT/DELETE/reactivate) | Slice trop large (1133 lignes total). Writes nécessitent : R2 upload images (S24 lookalike), PostGIS write `ST_SetSRID(ST_MakePoint())`, Stripe sync product/price (n'existe pas pour services en Python — vérifier), validation pricing engine. → S43 dédiée. |
| Inclure save/unsave | Triviaux (2 endpoints `service_saves` INSERT/DELETE) mais sortent du périmètre lectures. → S43. |
| Migrer uniquement `GET /services/{id}` | Insuffisant — search reste KO, coach dashboard KO. |
| Migrer uniquement search | Ne débloque pas booking detail (qui passe par `/services/{id}`). |

---

## HORS scope (volontairement reporté)

| Composant | Raison | Slice future |
|---|---|---|
| `POST /services` (create) | R2 upload + PostGIS write + flag normalization | S43 |
| `PUT/PATCH /services/{id}` | UPDATE dynamique 30+ champs | S43 |
| `DELETE /services/{id}` | Soft-delete + `pending_file_deletions` (réutilise pattern S40) | S43 |
| `POST /services/{id}/reactivate` | Restauration (réutilise pattern S40) | S43 |
| `POST /services/{id}/save` + `DELETE /unsave` | INSERT/DELETE simples sur `service_saves` | S43 |
| `service_packages` writes | CRUD packages (sous-formules de tarifs) | S43 ou S44 |
| `service_slots` writes (création créneaux) | CRUD slots (récurrents/spécifiques/dates) | S44 dédiée |
| Helpers `_get_booking_flags` + `_normalize_booking_config` | Utilisés UNIQUEMENT par writes S43 | S43 |
| Webhooks Stripe pour services | N'existent pas en Python (services non syncés Stripe) | — |
| Achat / réservation côté buyer | Couvert par S11–S15 (booking lifecycle) | déjà migré |

---

## Critère de fin de slice

- [ ] 5 endpoints Java fonctionnels avec parité 100% comportementale
- [ ] PostGIS `ST_DWithin` + `ST_X`/`ST_Y` mappés en Java
- [ ] Helper `_mask_address` porté avec règles précision exact/100m/1000m + skip country names FR
- [ ] `_batch_enrich_for_search` (4 queries //) et `_batch_enrich_for_owner` (7 queries //) implémentés via `CompletableFuture.allOf`
- [ ] Filtre slots futurs + NOT EXISTS bookings status (4 statuts)
- [ ] `images` parsing dual (string JSON fallback + null)
- [ ] `tag_ids` parsing dual + lookup tags
- [ ] `available_slots` count via `TO_CHAR(NOW(), 'YYYY-MM-DD')` (saved)
- [ ] `days_until_media_purge` calcul Java `Duration.between` UTC-aware
- [ ] Auto-exclusion services du user dans search si JWT présent
- [ ] `is_owner` détection (coach OR admin) sur detail
- [ ] Suppression `original_address` / `original_description` si non-owner sur detail
- [ ] LIMIT 100 préservé sur search
- [ ] Régressions S11 (`/bookings/{id}` peut afficher service info), S25 (home feed cohérent), S38 (catalogue marketplace cohérent) vertes
