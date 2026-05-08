# SLICE 46 — Business Rules (Save / Unsave Services)

> **Source** : `/app/backend/routes/service_routes.py` l. 1107–1132

---

## 1. Auth

| Action | Auth requise | Rôle requis |
|--------|:------------:|:-----------:|
| POST /save | ✅ JWT | aucun (tout authentifié) |
| DELETE /unsave | ✅ JWT | aucun |

> Aucune restriction de rôle. Un user, coach ou admin peuvent tous sauvegarder/désauvegarder.

### Lecture du `user_id`
- Extrait du JWT via `auth_utils.require_auth(request, pool)`.
- Champ utilisé : `user["user_id"]`.

---

## 2. Service actif / inactif

### Sur POST /save
- ✅ Filtre strict `active = TRUE`.
- Si `services.active = FALSE` (désactivation manuelle ou soft delete S43) → **404**.
- Si `services.deleted_at IS NOT NULL` (soft-deleted) ⇒ implicitement `active=FALSE` ⇒ 404.

### Sur DELETE /unsave
- ❌ **Aucun** filtre `active`.
- Permet de retirer un favori même si le service a été désactivé/supprimé.

> ⚠️ Asymétrie volontaire à conserver. C'est un chemin de cleanup pour le user.

---

## 3. Idempotence

### POST /save — Idempotence côté insertion
- `INSERT … ON CONFLICT DO NOTHING` ⇒ doubles POST silencieux.
- Le `saved_at` n'est **PAS** mis à jour en cas de conflit (timestamp original conservé).
- La réponse reste **200 OK** identique : `{success: true, is_saved: true}`.

### DELETE /unsave — Idempotence côté suppression
- DELETE sans garde ⇒ doubles DELETE silencieux.
- Si la ligne n'existe pas : 0 ligne affectée, réponse 200 quand même.
- La réponse reste **200 OK** identique : `{success: true, is_saved: false}`.

### Cas combiné
- POST puis POST → 1 ligne en DB, `is_saved=true` retourné 2 fois.
- POST puis DELETE → 0 ligne, `is_saved=false`.
- DELETE puis DELETE → 0 ligne, `is_saved=false` retourné 2 fois.
- DELETE puis POST → 1 ligne avec **nouveau** `saved_at` (ligne précédente supprimée).

> ⚠️ Subtilité : si l'utilisateur fait DELETE puis POST, le `saved_at` est mis à jour (nouvelle ligne, nouveau `save_id`).

---

## 4. Contrainte UNIQUE `(service_id, user_id)`

- Garantit qu'un utilisateur a au maximum **1 ligne** par service.
- Active l'idempotence du `ON CONFLICT DO NOTHING`.
- ⚠️ Reproduire **strictement** la contrainte côté Java (migration JDBC).

---

## 5. FK CASCADE

| Cascade | Effet |
|---------|-------|
| `services` hard delete | Tous les favoris du service supprimés. |
| `services` soft delete (S43) | Favoris **conservés**. Comportement Python : la ligne reste en DB mais ne peut plus être affichée via `/services/saved` (filtre `active=TRUE`). |
| `users` hard delete | Tous les favoris de l'utilisateur supprimés. |

> Iso Python à conserver.

---

## 6. Validation d'entrée

- Aucune validation Pydantic côté handlers (pas de body, pas de query params).
- Le `service_id` du path n'est pas validé en format ; le SELECT trouvera 0 ligne s'il est invalide → 404 sur POST, no-op sur DELETE.

---

## 7. Asymétries Python à conserver

| # | Asymétrie | Détail |
|---|-----------|--------|
| 1 | **Path DELETE = `/unsave`**, pas `/save` | URL non-symétrique. À reproduire strictement. |
| 2 | POST 404 si `active=FALSE`, DELETE silent | Cohérent : on ne sauvegarde que de l'actif, mais on peut purger n'importe quoi. |
| 3 | `ON CONFLICT DO NOTHING` sans target | Repose sur la contrainte UNIQUE existante. |
| 4 | `saved_at` non mis à jour en cas de re-save | Première date de save préservée. |
| 5 | `save_id` perdu en cas de conflict | La ligne existante garde son `save_id` original. |
| 6 | DELETE silent même si service introuvable | Pas de 404 sur DELETE. |
| 7 | Pas de transaction explicite | Iso. |
| 8 | Pas de notification, pas d'audit | Iso. |
| 9 | Réponse `is_saved` est logique, pas un re-read | POST renvoie `true` même si conflict ; DELETE renvoie `false` même si rien à supprimer. |
| 10 | Aucun rate-limit | À ne pas ajouter côté Java sans demande explicite. |

---

## 8. Permissions

- **Aucune** permission supplémentaire au-delà de l'auth JWT.
- Un coach peut sauvegarder son **propre** service (pas de restriction owner).
- Un admin peut sauvegarder n'importe quoi.
- Un user lambda idem.

---

## 9. Compatibilité front

- Réponse JSON `{success, is_saved}` consommée par le bouton « favoris » du front.
- Le front peut faire confiance à `is_saved` sans re-fetcher.
- `GET /services/saved` (S42) doit refléter immédiatement les changements.

---

## 10. Hors scope (à NE PAS faire dans S46)

- Endpoint `GET /services/{id}/saved-status` standalone → n'existe pas en Python.
- Notification au coach lors d'un save (ex: "X personnes ont sauvegardé votre service") → pas implémenté.
- Compteur public de saves sur fiche service → pas exposé.
- Validation `service_id` format (préfixe `svc_`) → ne pas ajouter.
- Limitation du nombre de favoris par user → ne pas ajouter.
- Mutualisation save/unsave avec SpotYou/Marketplace → hors slice (PRD).

---

## 11. Synthèse des règles

| Règle | Source |
|-------|--------|
| BR-46.01 | JWT requis sur POST et DELETE. Aucune restriction de rôle. |
| BR-46.02 | POST 404 si service inexistant ou `active=FALSE`. |
| BR-46.03 | DELETE silent : 200 OK même si aucune ligne supprimée. |
| BR-46.04 | Path DELETE = `/unsave` (asymétrie URL). |
| BR-46.05 | Contrainte UNIQUE `(service_id, user_id)` → idempotence ON CONFLICT. |
| BR-46.06 | `saved_at` jamais mis à jour en cas de re-save. |
| BR-46.07 | `user_id` extrait du JWT, jamais du body/path. |
| BR-46.08 | FK CASCADE `services → service_saves` et `users → service_saves`. |
| BR-46.09 | Soft delete service S43 ne supprime pas les favoris. |
| BR-46.10 | Réponse `is_saved` logique (POST=true, DELETE=false), pas un re-read. |
| BR-46.11 | DELETE /unsave ne filtre pas sur `active=TRUE`. |
| BR-46.12 | Pas de transaction explicite, pas de notification, pas d'audit. |
