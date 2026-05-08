# SLICE 43 — Services Coach : CRUD principal (Writes)

> **Statut** : À implémenter en Java/Spring Boot
> **Source unique de vérité** : `/app/backend/routes/service_routes.py` (lignes 756 → 1105) + `/app/backend/models.py` (lignes 211 → 297)
> **Domaine** : Services Coach
> **Type** : Writes (création / mise à jour / soft delete / réactivation)
> **Précédente slice** : S42 (Services Coach Reads) ✅ migrée

---

## 1. Objectif

Migrer le **CRUD principal** du domaine Services Coach pour permettre au front d'effectuer les opérations de gestion d'un service par un coach, sans dépendre du backend Python.

Cette slice **débloque** :
- Création d'un service par un coach.
- Édition de ses champs scalaires + images + adresses (locations).
- Désactivation/suppression douce (soft delete) d'un service.
- Réactivation d'un service désactivé (avec ou sans médias selon TTL 90j).

---

## 2. Endpoints inclus

| # | Méthode | Path | Handler Python |
|---|---------|------|----------------|
| 1 | `POST` | `/api/services` | `create_service` (l. 756–849) |
| 2 | `PUT`  | `/api/services/{service_id}` | `update_service` (l. 852–983) |
| 3 | `PATCH`| `/api/services/{service_id}` | `update_service` (même handler) |
| 4 | `DELETE`| `/api/services/{service_id}` | `delete_service` (l. 986–1047) |
| 5 | `POST` | `/api/services/{service_id}/reactivate` | `reactivate_service` (l. 1051–1104) |

---

## 3. Endpoints **EXCLUS** de cette slice

| Endpoint | Raison | Slice cible |
|----------|--------|-------------|
| `POST /api/services/{id}/save` | Action utilisateur générique (favoris), pas du CRUD coach. Table `service_saves`. | **Slice favoris (à planifier)** |
| `DELETE /api/services/{id}/unsave` | Idem. | **Slice favoris (à planifier)** |
| Endpoints liés aux **slots récurrents / single** détaillés | Logique nested complexe (jours, tranches, location_index). | **S44 — Services Slots** |
| Endpoints liés aux **packages** | Modèle imbriqué (package + slots) et calcul de prix dérivé. | **S45 — Services Packages** |
| `GET /api/services*` | Lectures déjà migrées. | **S42 — Services Reads** ✅ |

> ⚠️ **Choix de découpage stratégique**
> Les payloads `POST/PUT/PATCH /services` acceptent en Python des tableaux imbriqués `locations`, `slots`, `packages`. Pour respecter la consigne « slots/packages dans S44/S45 si possible », **S43 implémente** :
> - Le CRUD complet du **service principal** (champs scalaires + images + booking_approval_mode + locations).
> - Les locations (`service_locations` + PostGIS) car **indissociables** du masquage d'adresse, déjà utilisé en lecture (S42).
>
> **S43 ne traite PAS** la persistance de `slots[]` et `packages[]` sur ces endpoints. Le contrat d'API documenté ci-dessous accepte ces tableaux pour parité, mais leur **traitement** est délégué à S44/S45. Tant que S44/S45 ne sont pas livrées, le front **ne doit pas** envoyer `slots` ni `packages` vers Java sur ces endpoints (cf. `SLICE_43_BUSINESS_RULES.md` §6).

---

## 4. Auth & Permissions

| Endpoint | Auth | Permission |
|----------|------|------------|
| `POST /services` | JWT requis (`require_auth`) | Rôle ∈ {`coach`, `admin`} (sinon 403 « Coach role required ») |
| `PUT/PATCH /services/{id}` | JWT requis | `services.coach_id == user.user_id` **OU** `role == 'admin'` (sinon 403 « Not authorized ») |
| `DELETE /services/{id}` | JWT requis | Idem update + garde réservations actives bloquante (sauf admin) |
| `POST /services/{id}/reactivate` | JWT requis | Owner OU admin (sinon 403 « Non autorisé ») |

> Lecture du JWT : header `Authorization: Bearer <token>` → `auth_utils.require_auth(request, pool)` retourne `{user_id, role, ...}`.

---

## 5. Fichiers Python concernés (à NE PAS modifier)

- `/app/backend/routes/service_routes.py` (logique HTTP + SQL)
- `/app/backend/models.py` (lignes 211–297) : `ServiceLocationItem`, `DaySlotPayload`, `ServicePackageItem`, `ServiceSlotItem`, `ServiceCreate`, `ServiceUpdate`
- `/app/backend/auth_utils.py` : `require_auth`
- `/app/backend/database.py` : `get_pool`, `row_to_dict`
- `/app/backend/routes/upload_routes.py` : `delete_upload_files` (suppression **immédiate** des images retirées sur UPDATE)

---

## 6. Dépendances

### Côté Java/Spring (déjà migré)
- **Auth JWT** : middleware déjà en place (S1+).
- **Pool PostgreSQL + PostGIS** : déjà en place (S42 lit `service_locations`).
- **Service de stockage R2 / local** : pour l'**immédiate** suppression d'images retirées sur UPDATE (équivalent `delete_upload_files`).
- **Worker `pending_file_deletions`** : déjà migré (S40 — Marketplace lifecycle) ; cette slice y INSÈRE des lignes lors du DELETE.
- **Table `app_config`** : lecture flags `enable_manual_approval_for_services`, `enable_pay_later_for_services`.
- **Table `conversations`** : UPDATE `context_deleted` lors du delete/reactivate.

### Côté front (déjà existant)
- Écran « Créer un service » → utilise `POST /services`.
- Écran « Mes services » → édition (`PUT/PATCH`), désactivation (`DELETE`), réactivation (`POST /reactivate`).

---

## 7. Niveau de risque

🟠 **MOYEN-ÉLEVÉ**

| Risque | Détail |
|--------|--------|
| 🔴 Suppression immédiate d'images sur UPDATE | `delete_upload_files()` est appelé **synchronement** : si le front renvoie un payload partiel (`images` absent vs `images=[]`), risque de perte. Le contrat distingue explicitement ces deux cas. |
| 🔴 Lifecycle DELETE non transactionnel | Le code Python actuel **n'enveloppe pas** le DELETE dans une transaction explicite. La connexion de pool est utilisée mais sans `BEGIN/COMMIT`. **À corriger côté Java** : utiliser `@Transactional`. |
| 🟠 Garde « bookings actifs » | Le DELETE doit bloquer (409) si des bookings ∈ `{pending, accepted, awaiting_payment, confirmed}` existent **sauf** pour admin. |
| 🟠 Normalisation `booking_approval_mode` | Dépend des flags globaux `app_config`. Asymétrie : `ServiceCreate` n'expose pas ces champs (utilise `getattr(data, …)` avec defaults `manual_approval` / `True` / `1440`), alors que `ServiceUpdate` les expose explicitement. |
| 🟢 Reactivate `requires_media_reupload` | Si `media_purged=TRUE` (≥ 90j), répondre `requires_media_reupload: true` pour que le front demande un nouvel upload. |

---

## 8. Justification du choix de scope

1. **Maximiser le déblocage front** : les coachs doivent pouvoir créer / éditer / supprimer / réactiver leurs services **sans Python**. C'est la première slice « write » Services Coach et sans elle, l'admin coach reste bloqué côté legacy.
2. **Découpe propre** : slots & packages, structurellement complexes (sub-entités, location_index, days_of_week, raw_schedule, recurring/single/availability), ont leurs propres slices S44/S45.
3. **Locations incluses** : indispensables au masquage d'adresse de la lecture (S42) et à la persistance PostGIS, donc indissociables du CRUD principal.
4. **Save/Unsave exclus** : volonté explicite utilisateur. Action utilisateur générique (favoris), n'appartient pas au CRUD coach.

---

## 9. Critères de Done

- [ ] Les 5 endpoints retournent les mêmes statuts HTTP que Python pour les cas listés (201/200/404/403/409/422).
- [ ] Le payload de réponse de `POST/PUT/PATCH` est **bit-à-bit identique** au format renvoyé par `_enrich_service` (cf. S42).
- [ ] Les images retirées sur UPDATE sont effectivement supprimées (R2 / local) immédiatement.
- [ ] Le DELETE crée des lignes `pending_file_deletions` pour chaque image, programmées à `now + 90 jours`.
- [ ] Le REACTIVATE supprime les `pending_file_deletions` en `status='pending'` du service.
- [ ] La réactivation ≥ 90j (`media_purged=TRUE`) renvoie `requires_media_reupload: true`.
- [ ] La normalisation `booking_approval_mode` consulte bien `app_config` à chaque create/update.
- [ ] Tests d'intégration (cf. `SLICE_43_TEST_CASES.md`) tous verts.
