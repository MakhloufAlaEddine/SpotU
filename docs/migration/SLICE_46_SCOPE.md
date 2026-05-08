# SLICE 46 — Services Coach : Save / Unsave (favoris)

> **Statut** : À implémenter en Java/Spring Boot
> **Source unique de vérité** :
> - `/app/backend/routes/service_routes.py` l. 1107–1132 (write)
> - `/app/backend/migrations/001_initial_schema.sql` (table `service_saves`)
> **Domaine** : Services Coach — sous-domaine favoris utilisateur
> **Précédentes slices** : S42 (reads, dont `/services/saved`) ✅, S43–S45 (writes) ✅

---

## 1. Constat factuel

⚠️ **Asymétrie d'URL importante à reproduire telle quelle**

| Action | Méthode | Path Python (réel) |
|--------|---------|---------------------|
| Sauvegarder | `POST` | `/api/services/{service_id}/save` |
| Désauvegarder | `DELETE` | `/api/services/{service_id}/unsave` |

> **Le chemin DELETE est `/unsave`** (pas `/save` symétrique). C'est une particularité du backend Python à conserver à l'identique côté Java pour parité front.

---

## 2. Objectif

Migrer la couche **favoris services** (action utilisateur générique) côté Java, pour permettre au front de :
- Ajouter un service aux favoris d'un utilisateur connecté.
- Retirer un service des favoris.
- Afficher la liste des services sauvegardés (déjà migré en S42 — `GET /api/services/saved`).

---

## 3. Endpoints choisis

| # | Méthode | Path | Handler Python |
|---|---------|------|----------------|
| 1 | `POST`   | `/api/services/{service_id}/save` | `save_service` (l. 1107–1120) |
| 2 | `DELETE` | `/api/services/{service_id}/unsave` | `unsave_service` (l. 1123–1132) |

---

## 4. Endpoints **EXCLUS**

| Endpoint | Raison | Slice cible |
|----------|--------|-------------|
| `GET /api/services/saved` | Lecture, déjà migré | **S42 ✅** |
| `POST /api/tag-points/{id}/save` | SpotYou favoris (autre domaine) | **S27 ✅** (membership SpotYou) |
| `POST /api/products/{id}/save` | Marketplace (à confirmer) | **Hors scope S46** |

> ⚠️ S46 reste **strictement** sur les favoris services. Pas de mutualisation cross-domaines.

---

## 5. Fichiers Python concernés

| Fichier | Lignes | Rôle |
|---------|--------|------|
| `/app/backend/routes/service_routes.py` | 1107–1120 | `save_service` (POST) |
| `/app/backend/routes/service_routes.py` | 1123–1132 | `unsave_service` (DELETE) |
| `/app/backend/migrations/001_initial_schema.sql` | (table `service_saves`) | Schéma + contraintes |
| `/app/backend/auth_utils.py` | — | `require_auth` (déjà migré) |
| `/app/backend/database.py` | — | `get_pool` (déjà migré) |

> **Aucune modification** ne doit être apportée à ces fichiers.

---

## 6. Auth & Permissions

| Action | Auth | Permission |
|--------|------|------------|
| `POST /save` | JWT requis (`require_auth`) | Tout utilisateur authentifié (rôle quelconque : user, coach, admin). |
| `DELETE /unsave` | JWT requis | Idem. |

> ⚠️ Aucune vérification de rôle. Aucune restriction owner/non-owner. Un coach peut sauvegarder son propre service. Asymétrie permissive à conserver.

---

## 7. Dépendances

### Côté Java (déjà en place)
- Middleware JWT (S1+).
- Pool PostgreSQL.
- Repository générique pour la table `services` (lecture).
- **S42 doit être mergée** : la lecture `GET /services/saved` consomme la table `service_saves` peuplée par cette slice.

### Côté front (déjà existant)
- Bouton « Enregistrer » sur fiche service → POST.
- Action « Retirer des favoris » → DELETE.
- Écran « Mes favoris » → consume `GET /services/saved` (S42).

---

## 8. Niveau de risque

🟢 **FAIBLE**

| Risque | Impact |
|--------|--------|
| 🟢 URL asymétrique POST vs DELETE | Confusion développeur Java possible. À documenter dans le code. |
| 🟢 ON CONFLICT DO NOTHING (POST) | Idempotence côté insertion : double-save silencieux. |
| 🟢 DELETE sans check existence | Silent no-op si rien à supprimer. Idempotence côté suppression. |
| 🟢 FK CASCADE | Hard delete service ⇒ favoris supprimés. Soft delete S43 ⇒ favoris **conservés**. |
| 🟢 POST 404 si service inactif | `WHERE service_id=$1 AND active=TRUE` ⇒ on ne peut pas saver un service désactivé. Asymétrie vs DELETE qui ne check pas l'existence. |

---

## 9. Justification du choix

1. **Petite slice ciblée** : 2 endpoints, 1 table, ~25 lignes de code Python. Idéal avant de passer aux gros blocs (Chat, Agenda).
2. **Complète proprement** le domaine Services Coach (S42 → S46).
3. **Aucune dépendance bloquante** : tout repose sur S42 et l'auth JWT, déjà mergées.
4. **Risque minimal** : pas de transactions complexes, pas de PostGIS, pas de paiements.

---

## 10. Critères de Done

- [ ] `POST /api/services/{id}/save` retourne 200 si service actif, 404 sinon, 401 sans JWT.
- [ ] `DELETE /api/services/{id}/unsave` retourne 200 toujours (idempotent, silent).
- [ ] Double `POST /save` ne crée pas de doublon (ON CONFLICT DO NOTHING).
- [ ] Double `DELETE /unsave` ne lève pas d'erreur (silent no-op).
- [ ] `service_saves.user_id == user.user_id` lié au JWT.
- [ ] `GET /services/saved` (S42) reflète immédiatement les insertions/suppressions.
- [ ] FK CASCADE `services → service_saves` et `users → service_saves` préservées via migration JDBC.
- [ ] Tous les TC `SLICE_46_TEST_CASES.md` passent.
- [ ] Aucune régression sur les écrans front (favoris, fiche service).
