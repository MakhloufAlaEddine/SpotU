# SLICE 43 — Test Cases (Services Coach CRUD)

> Tests d'intégration end-to-end. Chaque cas doit passer **identiquement** sur Python (référence) et Java (cible).

---

## Pré-requis communs

- Pool PostgreSQL + PostGIS UP.
- Table `app_config` initialisée :
  - `enable_manual_approval_for_services = 'true'`
  - `enable_pay_later_for_services = 'true'`
- Utilisateurs de test :
  - **`U_COACH_A`** (role=coach, owner du service)
  - **`U_COACH_B`** (role=coach, NON owner)
  - **`U_USER`** (role=user)
  - **`U_ADMIN`** (role=admin)

---

# 1. POST /api/services

## TC-1.1 — Nominal create (coach, payload minimal)
**Pré** : auth `U_COACH_A`.
**Body** :
```json
{ "title": "Cours de yoga matinal" }
```
**Attendu** :
- HTTP 200.
- `service_id` préfixé `svc_`.
- `coach_id == U_COACH_A.user_id`, `active=true`, `images=[]`, `price=0.0`, `duration_min=60`, `max_participants=1`.
- `booking_approval_mode='manual_approval'` (default POST), `allow_pay_later=true`, `pay_later_expiration_minutes=1440`.
- DB : 1 ligne dans `services`, 0 dans `service_locations`/`service_slots`/`service_packages`.

## TC-1.2 — Nominal create avec locations
**Body** :
```json
{
  "title": "Cours de yoga complet",
  "description": "Vinyasa flow",
  "address": "12 rue Test, 75001 Paris",
  "price": 35.5,
  "duration_min": 90,
  "tag_ids": ["tag_yoga","tag_morning"],
  "max_participants": 8,
  "images": ["https://r2/img1.jpg","https://r2/img2.jpg"],
  "locations": [
    { "latitude": 48.8566, "longitude": 2.3522, "precision": "exact", "description": "Studio Paris 1" }
  ]
}
```
**Attendu** :
- HTTP 200.
- `service_locations` : 1 ligne PostGIS avec POINT(2.3522 48.8566), SRID 4326.
- Réponse enrichie inclut `locations` avec géocodage et masquage selon `precision` (cf. S42).

## TC-1.3 — Coach crée pour autre coach
- N/A : pas d'endpoint d'attribution.

## TC-1.4 — Refus rôle user
**Pré** : auth `U_USER`.
**Body** : `{ "title": "tentative" }`.
**Attendu** :
- HTTP **403**.
- Body : `{"detail":"Coach role required"}`.

## TC-1.5 — Refus admin OK
**Pré** : auth `U_ADMIN`.
**Body** : `{ "title": "Service admin" }`.
**Attendu** :
- HTTP 200 (admin a le droit, role ∈ {coach, admin}).
- `coach_id == U_ADMIN.user_id`.

## TC-1.6 — Validation `title < 5`
**Body** : `{ "title": "abc" }`.
**Attendu** :
- HTTP **422**, message `Le titre doit avoir au moins 5 caractères`.

## TC-1.7 — Validation `title` blanc
**Body** : `{ "title": "    " }`.
**Attendu** : HTTP 422 (longueur après trim < 5).

## TC-1.8 — Validation `images > 5`
**Body** : `{ "title":"valide", "images": ["a","b","c","d","e","f"] }`.
**Attendu** : HTTP 422, message `Maximum 5 images autorisées pour un service`.

## TC-1.9 — Validation `price < 0`
**Body** : `{ "title":"valide", "price": -1 }`.
**Attendu** : HTTP 422, message `Le prix ne peut pas être négatif`.

## TC-1.10 — Auth absente
**Pré** : pas de header.
**Attendu** : HTTP **401** (par middleware).

## TC-1.11 — Flag `enable_manual_approval` désactivé
**Pré** : `app_config.enable_manual_approval_for_services = 'false'`.
**Body** : `{ "title":"valide" }`.
**Attendu** :
- HTTP 200.
- `services.booking_approval_mode = 'instant_booking'` (forcé par normalisation).

## TC-1.12 — Flag `enable_pay_later` désactivé
**Pré** : `app_config.enable_pay_later_for_services = 'false'`.
**Body** : `{ "title":"valide" }`.
**Attendu** :
- HTTP 200.
- `services.allow_pay_later = false`, `pay_later_expiration_minutes = 1440` (forcé par fallback `or 1440`).

## TC-1.13 — Calcul price depuis packages (deferred S45 mais comportement à valider)
**Body** :
```json
{
  "title":"package only",
  "price": null,
  "packages": [
    {"type_id":"t1","type_label":"Basic","price":20},
    {"type_id":"t2","type_label":"Pro","price":50}
  ]
}
```
**Attendu** :
- HTTP 200.
- `services.price = 20.0` (min des packages).

> ⚠️ Si packages non implémentés en S43, ce test passe mais `service_packages` reste vide. À adapter en S45.

## TC-1.14 — Price `null` sans packages
**Body** : `{ "title":"valide" }` (pas de price, pas de packages).
**Attendu** : `services.price = 0.0`.

---

# 2. PUT/PATCH /api/services/{id}

## TC-2.1 — Nominal update partiel (PATCH)
**Pré** : service S1 owned by `U_COACH_A`, `title="Old"`, `price=10`.
**Body** : `{ "title": "New title" }` (PATCH).
**Attendu** :
- HTTP 200.
- `services.title = 'New title'`, `price` inchangé à 10, `updated_at` mis à jour.

## TC-2.2 — PUT et PATCH iso-comportement
- Test que `PUT /services/{id}` body `{title:"X"}` produit le même résultat que `PATCH` avec le même body.

## TC-2.3 — Refus non-owner
**Pré** : auth `U_COACH_B`, service owned by `U_COACH_A`.
**Body** : `{ "title": "Hijack" }`.
**Attendu** :
- HTTP **403**, `{"detail":"Not authorized"}`.

## TC-2.4 — Admin bypass owner
**Pré** : auth `U_ADMIN`, service owned by `U_COACH_A`.
**Body** : `{ "title": "Admin edit" }`.
**Attendu** : HTTP 200, title mis à jour.

## TC-2.5 — Service introuvable
**URL** : `/api/services/svc_doesnotexist`.
**Body** : `{ "title": "X" }`.
**Attendu** : HTTP **404**, `{"detail":"Service not found"}`.

## TC-2.6 — `null` ignoré (None = keep)
**Pré** : service S1 `description="ABC"`, `price=10`.
**Body** : `{ "title":"updated", "description": null, "price": null }`.
**Attendu** :
- `title = 'updated'`.
- `description = 'ABC'` (inchangé).
- `price = 10` (inchangé).

## TC-2.7 — `images=[]` supprime tout sync
**Pré** : service S1 `images=["urlA","urlB"]`.
**Body** : `{ "images": [] }`.
**Attendu** :
- `services.images = []`.
- Appel à `delete_upload_files(["urlA","urlB"])` ⇒ R2/FS effectivement supprimés (test mock du service de stockage).

## TC-2.8 — `images=[A,C]` supprime B sync
**Pré** : `images=[A,B,C]`.
**Body** : `{ "images":["A","C"] }`.
**Attendu** :
- `services.images = ["A","C"]`.
- `delete_upload_files(["B"])` appelé.

## TC-2.9 — `images=null` n'affecte rien
**Pré** : `images=[A,B]`.
**Body** : `{ "title": "X" }` (pas de champ images).
**Attendu** :
- `services.images = ["A","B"]` (inchangé).
- Aucun appel à `delete_upload_files`.

## TC-2.10 — `locations=null` n'affecte rien
**Pré** : 2 locations existantes.
**Body** : `{ "title": "X" }`.
**Attendu** : 2 locations toujours présentes.

## TC-2.11 — `locations=[]` supprime toutes
**Pré** : 2 locations.
**Body** : `{ "locations": [] }`.
**Attendu** : `service_locations` vide pour ce service.

## TC-2.12 — `locations=[L1,L2,L3]` replace complet
**Pré** : 2 locations.
**Body** : `{ "locations": [<L1>,<L2>,<L3>] }`.
**Attendu** : `service_locations` contient exactement les 3 nouvelles, anciennes supprimées.

## TC-2.13 — Champ hors whitelist ignoré
**Body** : `{ "coach_id": "usr_other" }`.
**Attendu** :
- HTTP 200.
- `services.coach_id` inchangé (whitelist scalar n'inclut pas coach_id).

## TC-2.14 — Validation Pydantic types
**Body** : `{ "price": "not a number" }`.
**Attendu** : HTTP **422**.

## TC-2.15 — Booking config normalisée
**Pré** : `app_config.enable_manual_approval_for_services='false'`.
**Body** : `{ "booking_approval_mode": "manual_approval" }`.
**Attendu** :
- HTTP 200.
- `services.booking_approval_mode = 'instant_booking'` (forcé).

## TC-2.16 — `tag_ids=[]` vide la liste
**Pré** : `tag_ids=["a","b"]`.
**Body** : `{ "tag_ids": [] }`.
**Attendu** : `tag_ids = []` (jsonb cast).

## TC-2.17 — Auth absente
**Attendu** : HTTP 401.

---

# 3. DELETE /api/services/{id}

## TC-3.1 — Nominal coach owner sans booking
**Pré** : service S1 owned by `U_COACH_A`, aucun booking actif, `images=["url1","url2"]`.
**Auth** : `U_COACH_A`.
**Attendu** :
- HTTP 200.
- Body : `{ "success": true, "media_purge_scheduled_at": "<ISO ~ now+90j>" }`.
- `services.active=false`, `deleted_at != null`, `deleted_by=U_COACH_A`, `media_purge_scheduled_at` ≈ now+90j.
- 2 lignes dans `pending_file_deletions` (`entity_type='service'`, `entity_id=S1`, `scheduled_at` ≈ now+90j).
- Aucun appel **immédiat** à R2/FS pour les images.

## TC-3.2 — Refus non-owner
**Pré** : auth `U_COACH_B`.
**Attendu** : HTTP 403, `{"detail":"Not authorized"}`.

## TC-3.3 — Admin bypass owner
**Pré** : auth `U_ADMIN`, service owned by `U_COACH_A`.
**Attendu** : HTTP 200, soft delete effectif.

## TC-3.4 — Service introuvable
**URL** : `/api/services/svc_xxx_404`.
**Attendu** : HTTP 404, `{"detail":"Service not found"}`.

## TC-3.5 — Garde booking actif (coach) → 409
**Pré** : `bookings` avec status `pending`.
**Attendu** :
- HTTP **409**.
- Body : `{"detail":"Impossible de supprimer : 1 réservation(s) active(s) sur ce service. Annulez-les d'abord."}`.

## TC-3.6 — Garde bookings multiples
**Pré** : 3 bookings (`accepted`, `awaiting_payment`, `confirmed`).
**Attendu** : HTTP 409, message avec « 3 réservation(s) ».

## TC-3.7 — Statuts non actifs ne bloquent pas
**Pré** : bookings tous en `cancelled`/`rejected`/`completed`.
**Attendu** : HTTP 200 (delete OK).

## TC-3.8 — Admin bypass garde
**Pré** : auth `U_ADMIN`, 1 booking `pending`.
**Attendu** : HTTP 200 (admin contourne la garde).

## TC-3.9 — Conversations archivées
**Pré** : 2 conversations avec `context_id=service_id, context_deleted=false`.
**Attendu** : après DELETE, les 2 ont `context_deleted=true`.

## TC-3.10 — Service sans images
**Pré** : `images=[]` ou null.
**Attendu** : HTTP 200, `pending_file_deletions` non altérée (0 INSERT).

## TC-3.11 — `ON CONFLICT DO NOTHING`
**Pré** : `pending_file_deletions` contient déjà `(url1, service, S1)`.
**Attendu** : INSERT ne crée pas de doublon, pas d'erreur.

## TC-3.12 — Auth absente
**Attendu** : HTTP 401.

---

# 4. POST /api/services/{id}/reactivate

## TC-4.1 — Nominal réactivation < 90j
**Pré** : service S1 soft-deleted hier (`deleted_at`, `media_purge_scheduled_at`, `media_purged=false`), 2 lignes pending_file_deletions.
**Attendu** :
- HTTP 200.
- Body : `{ "success":true, "reactivated":true, "service_id":"svc_S1", "media_purged":false, "requires_media_reupload":false }`.
- DB : `services.active=true, deleted_at=null, deleted_by=null, media_purge_scheduled_at=null, media_purge_notified_at=null, reactivated_at=NOW()`.
- `pending_file_deletions` pour S1 supprimées.

## TC-4.2 — Réactivation ≥ 90j (média purgé)
**Pré** : `media_purged=true`, `images=null` ou `[]`.
**Attendu** :
- HTTP 200.
- Body : `requires_media_reupload: true`, `media_purged: true`.
- `services.media_purged` reste `true` après réactivation.

## TC-4.3 — Service déjà actif → 409
**Pré** : `active=true, deleted_at=null`.
**Attendu** : HTTP **409**, `{"detail":"Ce service est déjà actif"}`.

## TC-4.4 — Service introuvable → 404
**URL** : `/api/services/svc_404/reactivate`.
**Attendu** : HTTP 404, `{"detail":"Service introuvable"}`.

## TC-4.5 — Refus non-owner
**Pré** : auth `U_COACH_B`, service owned by `U_COACH_A` (soft-deleted).
**Attendu** : HTTP **403**, `{"detail":"Non autorisé"}`.

## TC-4.6 — Admin bypass owner
**Pré** : auth `U_ADMIN`.
**Attendu** : HTTP 200.

## TC-4.7 — Conversations désarchivées
**Pré** : 2 conversations avec `context_deleted=true`.
**Attendu** : après reactivate, `context_deleted=false`.

## TC-4.8 — `pending_file_deletions` filtrées par `status='pending'`
**Pré** : 1 ligne `status='pending'`, 1 ligne `status='completed'`.
**Attendu** : seule la `pending` est supprimée ; la `completed` reste.

## TC-4.9 — Auth absente
**Attendu** : HTTP 401.

## TC-4.10 — Désactivation manuelle vs soft delete
**Pré** : service `active=false, deleted_at=null` (désactivation manuelle).
**Attendu** : HTTP 200, `services.active=true`. Pas d'erreur 409 (la condition est `active AND not deleted_at`).

---

# 5. Tests transverses

## TC-5.1 — Round-trip POST → PUT → DELETE → REACTIVATE
- Crée un service.
- Update title.
- Delete (sans bookings).
- Reactivate < 90j.
- Vérifie cohérence finale (service actif, title à jour, images préservées).

## TC-5.2 — `updated_at` toujours mis à jour
- POST → updated_at = created_at ≈ now.
- PUT → updated_at change.
- DELETE → updated_at = deleted_at.
- REACTIVATE → updated_at = reactivated_at = now.

## TC-5.3 — Race condition delete + booking créé
- Hors scope test unitaire (transaction Java). Documenter comme test manuel.

---

# 6. Tests de format de réponse (smoke)

## TC-6.1 — Response shape `POST /services`
- JSON contient toutes les clés listées dans `SLICE_43_API_CONTRACTS.md` §1.
- Pas de `_id` MongoDB (paranoïa) — ici PostgreSQL donc N/A mais valider Aucune clé inattendue.

## TC-6.2 — Response shape `DELETE`
- Strictement `{success, media_purge_scheduled_at}`.

## TC-6.3 — Response shape `REACTIVATE`
- Strictement `{success, reactivated, service_id, media_purged, requires_media_reupload}`.

---

# 7. Couverture exigée

| Endpoint | TCs minimum |
|----------|-------------|
| POST | 1.1, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 1.11, 1.12, 1.14 |
| PUT/PATCH | 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.11, 2.12, 2.13, 2.15, 2.17 |
| DELETE | 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9, 3.10, 3.12 |
| REACTIVATE | 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.10 |

> Tous ces tests doivent passer côté Java avant cutover front sur S43.
