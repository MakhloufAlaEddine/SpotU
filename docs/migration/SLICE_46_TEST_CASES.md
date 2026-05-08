# SLICE 46 — Test Cases (Save / Unsave Services)

> Tests d'intégration ciblant les 2 endpoints `POST /save` et `DELETE /unsave`.

---

## Pré-requis

- Auth JWT opérationnelle (S1+).
- S42 mergée (`GET /services/saved` pour vérification).
- Schéma `service_saves` initialisé (PK + UNIQUE + FKs).
- Utilisateurs de test :
  - `U_USER` (rôle user)
  - `U_COACH_A` (coach owner d'un service)
  - `U_COACH_B` (coach autre)
  - `U_ADMIN`

---

# 1. POST /api/services/{service_id}/save

## TC-S46-1.1 — Save nominal user
**Pré** : service `svc_S1` actif owned by `U_COACH_A`.
**Auth** : `U_USER`.
**Action** : `POST /api/services/svc_S1/save`.
**Attendu** :
- HTTP 200.
- Body : `{"success": true, "is_saved": true}`.
- DB : 1 ligne dans `service_saves` avec `service_id=svc_S1`, `user_id=U_USER.user_id`, `save_id` préfixé `svs_`, `saved_at` ≈ now.

## TC-S46-1.2 — Save coach owner sur son propre service
**Auth** : `U_COACH_A`.
**Action** : POST sur son service.
**Attendu** : HTTP 200, ligne créée. (Pas de restriction owner).

## TC-S46-1.3 — Save admin
**Auth** : `U_ADMIN`.
**Attendu** : HTTP 200, ligne créée.

## TC-S46-1.4 — Double save (idempotence)
**Pré** : ligne existante.
**Auth** : `U_USER`.
**Action** : second POST.
**Attendu** :
- HTTP 200.
- Body identique : `{"success": true, "is_saved": true}`.
- DB : **toujours 1 seule ligne**, `saved_at` **inchangé** (ON CONFLICT DO NOTHING).

## TC-S46-1.5 — Service inexistant
**URL** : `/api/services/svc_INEXISTANT/save`.
**Attendu** : HTTP **404**, body `{"detail":"Service not found"}`.

## TC-S46-1.6 — Service inactif (active=FALSE)
**Pré** : service `active=FALSE` (désactivation manuelle ou soft delete S43).
**Attendu** : HTTP **404**, `{"detail":"Service not found"}`.

## TC-S46-1.7 — Service soft-deleted (deleted_at NOT NULL)
**Pré** : service après `DELETE /services/{id}` S43.
**Attendu** : HTTP 404 (cohérent avec `active=FALSE` post-soft delete).

## TC-S46-1.8 — Service réactivé
**Pré** : service soft-deleted puis réactivé via S43 → `active=TRUE`.
**Attendu** : POST 200 OK (cohérent avec `active=TRUE`).

## TC-S46-1.9 — Auth absente
**Action** : POST sans header `Authorization`.
**Attendu** : HTTP **401**.

## TC-S46-1.10 — JWT invalide / expiré
**Attendu** : HTTP 401.

## TC-S46-1.11 — Concurrence : 2 POST simultanés
**Pré** : aucune ligne.
**Action** : 2 POST en parallèle même user/service.
**Attendu** :
- 2 réponses HTTP 200 identiques.
- DB : **1 seule ligne** (UNIQUE constraint + ON CONFLICT).
- Aucun 500.

---

# 2. DELETE /api/services/{service_id}/unsave

## TC-S46-2.1 — Unsave nominal après save
**Pré** : ligne `service_saves` existante.
**Auth** : `U_USER`.
**Action** : `DELETE /api/services/svc_S1/unsave`.
**Attendu** :
- HTTP 200.
- Body : `{"success": true, "is_saved": false}`.
- DB : ligne supprimée, 0 ligne pour ce couple `(service_id, user_id)`.

## TC-S46-2.2 — Unsave sans save préalable (idempotence silent)
**Pré** : aucune ligne pour ce couple.
**Attendu** :
- HTTP 200.
- Body : `{"success": true, "is_saved": false}`.
- DB : 0 ligne (no-op).

## TC-S46-2.3 — Double unsave
**Pré** : 1 ligne.
**Action** : DELETE puis DELETE.
**Attendu** : 1er = 200, 2e = 200 silent. DB 0 ligne après.

## TC-S46-2.4 — Unsave service inexistant
**URL** : `/api/services/svc_INEXISTANT/unsave`.
**Attendu** : HTTP **200** (silent, pas de 404 contrairement au POST).

## TC-S46-2.5 — Unsave service inactif
**Pré** : service `active=FALSE`, ligne `service_saves` toujours présente.
**Attendu** : HTTP 200, ligne supprimée. **Pas** de filtre `active=TRUE` côté DELETE.

## TC-S46-2.6 — Unsave service soft-deleted
**Pré** : service soft-deleted, ligne `service_saves` présente (pas de cascade soft).
**Attendu** : HTTP 200, ligne supprimée correctement (utile pour cleanup).

## TC-S46-2.7 — Unsave d'un favori d'un autre user
**Pré** : `service_saves` ligne `(svc_S1, U_USER_OTHER)`.
**Auth** : `U_USER`.
**Action** : DELETE sur `svc_S1`.
**Attendu** :
- HTTP 200.
- DB : ligne de `U_USER_OTHER` **inchangée** (filtre `WHERE user_id = $2`).
- Aucune fuite cross-user.

## TC-S46-2.8 — Auth absente
**Attendu** : HTTP 401.

## TC-S46-2.9 — JWT invalide / expiré
**Attendu** : HTTP 401.

---

# 3. Round-trip & cohérence avec S42

## TC-S46-3.1 — POST /save → GET /services/saved reflète
1. POST /services/svc_S1/save (U_USER).
2. GET /services/saved (U_USER).
3. **Attendu** : la liste contient `svc_S1`.

## TC-S46-3.2 — DELETE /unsave → GET /services/saved retire
1. POST puis DELETE.
2. GET /services/saved.
3. **Attendu** : `svc_S1` absent.

## TC-S46-3.3 — Service soft-deleted post-save → GET masque
1. POST /save sur service actif.
2. DELETE service (S43 soft delete).
3. GET /services/saved → **NE retourne PAS** ce service (filtre `active=TRUE` côté lecture S42).
4. DB : ligne `service_saves` toujours présente.
5. POST nouveau /save → 404 (active=FALSE).
6. DELETE /unsave → 200 silent (purge OK).

## TC-S46-3.4 — Service réactivé → GET re-affiche
1. Service avec favori existant, soft-deleted.
2. Réactivé (S43).
3. GET /services/saved → favori réapparaît automatiquement (ligne jamais supprimée).

## TC-S46-3.5 — Hard delete service → cascade
**Pré** : 3 favoris pour `svc_S1` (3 users distincts).
**Action** : `DELETE FROM services WHERE service_id='svc_S1'` (admin DB direct, hors HTTP).
**Attendu** : 0 ligne `service_saves` pour `svc_S1` (CASCADE).

## TC-S46-3.6 — Hard delete user → cascade
**Pré** : `U_USER` a 5 favoris.
**Action** : `DELETE FROM users WHERE user_id=U_USER.user_id`.
**Attendu** : 5 lignes `service_saves` supprimées (CASCADE).

---

# 4. Tests transverses

## TC-S46-4.1 — `is_saved` boolean format
- POST → réponse JSON contient `is_saved: true` (boolean strict, pas `"true"`).
- DELETE → `is_saved: false`.

## TC-S46-4.2 — Aucun champ supplémentaire dans la réponse
- Réponse strictement `{success, is_saved}`. Pas de `save_id`, pas de `saved_at`, pas de `service_id`.

## TC-S46-4.3 — `saved_at` non mis à jour en cas de re-save
1. POST /save → `saved_at = T0`.
2. POST /save (même user/service) → `saved_at` reste `T0`.

## TC-S46-4.4 — `saved_at` mis à jour si DELETE puis POST
1. POST → T0.
2. DELETE.
3. POST → T1 (nouvelle ligne, T1 > T0).

## TC-S46-4.5 — Multi-services, multi-users
- 3 users, chacun save 5 services différents → 15 lignes en DB.
- GET /services/saved par user → 5 lignes chacun, isolés.

---

# 5. Couverture exigée

| Catégorie | TCs minimum |
|-----------|-------------|
| POST nominal/idempotent | 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 1.11 |
| DELETE nominal/idempotent | 2.1, 2.2, 2.3, 2.4, 2.7, 2.8 |
| Round-trip S42 | 3.1, 3.2, 3.3, 3.4 |
| Cascades | 3.5, 3.6 |
| Format réponse | 4.1, 4.2, 4.3, 4.4 |

> Tous ces tests doivent passer côté Java avant cutover front sur S46.
