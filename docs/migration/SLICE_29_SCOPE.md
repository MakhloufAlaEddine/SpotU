# SLICE_29_SCOPE.md — Cadrage de la Slice 29
> Basé sur `deletion_routes.py:258–431`, `migrations/012_media_purge_retention.sql`, `media_purge_worker.py`, `media_notif_worker.py`.
> Généré le 2026-04-20.

---

## Flow choisi — SpotYou Soft-Delete + Reactivate (cycle de vie désactivation/réactivation) — 2 endpoints

| # | Méthode | Chemin API | Auth | Complexité | Fichier : Lignes |
|---|---|---|---|---|---|
| 1 | DELETE | `/api/tag-points/{point_id}` | STRICTE (owner OU admin) | ÉLEVÉE | `deletion_routes.py` : 260–346 |
| 2 | POST   | `/api/tag-points/{point_id}/reactivate` | STRICTE (owner OU admin) | ÉLEVÉE | `deletion_routes.py` : 351–431 |

> ⚠️ **Important** : ces 2 endpoints vivent dans `deletion_routes.py` — **pas** dans `tagpoint_routes.py`. Les S26–S28 ne les couvrent pas.

---

## Pourquoi cette slice ? Justification du choix

| Critère | Justification |
|---|---|
| **Ferme le CRUD SpotYou côté front** | S28 a migré create + update + new-date. Sans DELETE + reactivate, l'owner ne peut pas désactiver/restaurer son SpotYou → le cycle de vie reste incomplet. **Le front Java ne peut pas encore sortir du domaine SpotYou sans ces 2 endpoints.** |
| **Permissions strictement identiques à S28** | `caller["user_id"] == owner OU caller.role == 'admin'` → pas de nouveau modèle de sécurité à introduire, réutilise directement la logique documentée en S28. |
| **Introduit le pattern "Retention 90 jours" central** | Soft-delete + `pending_file_deletions` + `media_purge_scheduled_at` + workers différés. Ce pattern sera réutilisé à l'identique pour Services (S??), Products (S??) et User deletion (S??). **Documenter ici = travail mutualisé pour les slices suivantes.** |
| **Effets de bord structurants** | `context_deleted` sur conversations, annulation de purges, push notifications aux membres, réouverture de conversations à la réactivation. Aucun de ces effets n'a été documenté dans les slices précédentes. |
| **Périmètre court et auto-contenu** | 2 endpoints, pas de dépendance sur les features d'interaction (vote/attendance/invite/join) qui viendront dans les slices suivantes. Slice testable indépendamment. |
| **Différentie clairement de vote/attendance** | Vote, attendance ("going"), join/leave sont des **interactions utilisateur** (membre), pas du cycle de vie owner. Les mettre dans la même slice que la CRUD confondrait deux domaines de permissions (owner vs membre). |

### Alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| **Vote SpotYou** (`/tag-points/{id}/my-vote`, `POST /vote`, `GET /votes`) | Interaction membre. N'appartient pas au cycle de vie owner initié en S28. Mérite sa propre slice (S30 ou S31 selon ordre). |
| **Attendance ("going")** (`POST/DELETE /spot-you/{id}/going`, `GET /activity`, `GET /my-completion-stats`) | Interaction membre + vit dans `spot_you_routes.py` (nouveau fichier). Périmètre distinct, pattern distinct (suivi participation + stats agrégées). |
| **Bundle soft-delete + vote** | Mélangerait deux domaines de permissions (owner vs membre), deux fichiers source (`deletion_routes.py` + `tagpoint_routes.py`). Contre le principe "slice cohérente". |
| **Bundle soft-delete + DELETE user** | `DELETE /users/{user_id}` (`deletion_routes.py:97`) fait 5× plus de travail (anonymisation RGPD, cascade services/produits, révocation tokens). Trop gros pour une slice. |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `deletion_routes.py` | 260–346 | `DELETE /tag-points/{point_id}` |
| `deletion_routes.py` | 351–431 | `POST /tag-points/{point_id}/reactivate` |
| `deletion_routes.py` | 28 | `MEDIA_RETENTION_DAYS = 90` (constante) |
| `deletion_routes.py` | 33–43 | `_parse_images(raw)` helper |
| `deletion_routes.py` | 46–66 | `_schedule_file_deletions(conn, entity_type, entity_id, images_raw, scheduled_at)` |
| `deletion_routes.py` | 69–79 | `_cancel_file_deletions(conn, entity_id)` |
| `deletion_routes.py` | 82–92 | `_mark_conversations_context_deleted(conn, context_ids)` |
| `routes/tagpoint_routes.py` | `_first_image` (importé) | Helper thumbnail pour payload push |
| `migrations/012_media_purge_retention.sql` | 13–58 | Schéma colonnes `media_purge_*`, `media_purged`, `reactivated_at`, index |
| `migrations/008_soft_delete_columns.sql` | — | Colonnes `active`, `deleted_at`, `deleted_by` (existantes) |
| `migrations/009_pending_file_deletions.sql` | — | Table `pending_file_deletions` |
| `migrations/011_pending_file_deletions_status.sql` | — | Colonne `status` sur `pending_file_deletions` |
| `media_purge_worker.py` | 69–130 | Worker J+90 — marque `media_purged=TRUE` |
| `media_notif_worker.py` | 75–140 | Worker J+83 — notif owner 7j avant purge |
| `push_service.py` | `send_push_to_user` | Notifications push (ré)utilisé |

---

## Dépendances

| Dépendance | Type | Endpoints |
|---|---|---|
| Table `tag_points` | DB (SELECT, UPDATE) | delete, reactivate |
| Table `conversations` | DB (UPDATE `context_deleted`) | delete, reactivate |
| Table `pending_file_deletions` | DB (INSERT `ON CONFLICT DO NOTHING`, DELETE WHERE status='pending') | delete, reactivate |
| Table `spot_you_members` | DB (SELECT members for push) | delete, reactivate |
| `push_service.send_push_to_user` | Service async | delete, reactivate |
| `_first_image` (depuis `tagpoint_routes.py`) | Helper | delete (payload push `image_url`) |
| `MEDIA_RETENTION_DAYS` | Constante = 90 | delete (calcul `media_purge_scheduled_at`) |
| Worker `media_purge_worker` | Job background indépendant | Consomme `media_purge_scheduled_at` → flip `media_purged=TRUE` (hors périmètre REST mais couplé au flow) |
| Worker `media_notif_worker` | Job background indépendant | Consomme `media_purge_scheduled_at BETWEEN NOW() AND NOW()+7j` pour notif owner |

### Dépendances frontend → Java

Le front Java doit pouvoir appeler ces 2 endpoints pour :
- Fermer la CRUD SpotYou complète (après S28)
- Permettre à l'écran `spot-me.tsx` (onglet "Désactivés") d'afficher les SpotYou soft-deleted → pour cela `GET /users/me/reactivatable` (`deletion_routes.py:681`) est aussi nécessaire **mais volontairement non inclus** dans cette slice (c'est une lecture, pas une mutation ; peut être bundlé avec les autres lectures "reactivatable" Services/Products dans une slice dédiée ultérieure). Cette slice couvre uniquement les mutations du cycle de vie SpotYou.

---

## Niveau de risque

**ÉLEVÉ.**

| Point | Risque | Commentaire |
|---|---|---|
| Ordre précis des guards (404 → 409 → 403) | ÉLEVÉ | Compatibilité stricte Python exige cet ordre exact. Java NE DOIT PAS swap 409/403. |
| `_cancel_file_deletions` filtre `status='pending'` | ÉLEVÉ | Un SpotYou réactivé après passage du worker peut avoir `media_purged=TRUE` → flag `requires_media_reupload=true` dans la réponse |
| Push notifications fire-and-forget hors transaction | MOYEN | `asyncio.create_task(...)` **après** `async with pool.acquire()` fermé. En Java : `@TransactionalEventListener(phase=AFTER_COMMIT)` ou envoi après `commit()` |
| Colonnes multiples mises à jour (NULL-out à la réactivation) | MOYEN | `deleted_at=NULL, deleted_by=NULL, media_purge_scheduled_at=NULL, media_purge_notified_at=NULL, reactivated_at=NOW()` — oublier un NULL-out casse la détection soft-deleted des workers |
| `ON CONFLICT DO NOTHING` sur `pending_file_deletions` | FAIBLE | Idempotence si retry. Java : `INSERT ... ON CONFLICT DO NOTHING` supporté en natif par PostgreSQL, ne pas remplacer par un MERGE |
| `context_deleted=TRUE` uniquement sur conversations déjà `context_deleted=FALSE` (delete) | FAIBLE | `WHERE context_id=$1 AND context_deleted = FALSE` → évite de rewrite inutile et de sur-compter |
| Notification delta membres (hors owner) | FAIBLE | `SELECT user_id FROM spot_you_members WHERE spot_you_id=$1 AND user_id != $2` |

---

## Résumé ultra court

- **Flow choisi** : `DELETE /api/tag-points/{point_id}` + `POST /api/tag-points/{point_id}/reactivate` (2 endpoints, `deletion_routes.py`)
- **Tables touchées** : `tag_points` (UPDATE soft-delete/reactivate), `conversations` (UPDATE context_deleted bidirectionnel), `pending_file_deletions` (INSERT 90j + DELETE cancel), `spot_you_members` (SELECT notif)
- **Top 3 pièges** :
  1. **`_cancel_file_deletions` ne cancel que `status='pending'`** → si le worker a déjà commencé, `media_purged=TRUE` reste, et la réponse de reactivate retourne `requires_media_reupload=true` — le front doit gérer ce cas
  2. **Ordre strict des guards : 404 → 409 → 403** (introuvable avant déjà-supprimé avant non-autorisé). Swap = bug de compat.
  3. **Push notifications fire-and-forget après fermeture du pool** (Python `asyncio.create_task` hors `async with`). Java doit envoyer APRES commit pour garantir cohérence (pas de notif envoyée si rollback).
- **Raison du choix** : ferme le CRUD owner SpotYou initié en S28 ; sans ça le front ne peut pas exposer un cycle de vie complet. Introduit le pattern "rétention 90 jours + workers différés" réutilisé dans toutes les slices soft-delete suivantes.
