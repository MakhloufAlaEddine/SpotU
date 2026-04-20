# SLICE_29_BUSINESS_RULES.md — Règles métier SpotYou Soft-Delete + Reactivate
> Basé sur `deletion_routes.py:260–431`, `migrations/012_media_purge_retention.sql`, `media_purge_worker.py`, `media_notif_worker.py`.
> Généré le 2026-04-20.

---

## BR-29.01 — Permissions d'exécution

### Règle
Seul le propriétaire (`tag_points.user_id == caller.user_id`) OU un administrateur plateforme (`users.role == 'admin'`) peut soft-delete ou réactiver un SpotYou.

### Détails
- La valeur de `role` provient du JWT validé par `require_auth` (clé `role` du dict `caller`).
- `is_admin = caller.get("role") == "admin"` — comparaison stricte `==`, pas de `IN` de plusieurs rôles (il n'y a qu'un rôle admin).
- Pas de notion de "membre qui peut supprimer" — même les admins de communauté (`spot_you_members.role='admin'` interne) ne peuvent pas.

### Asymétrie (reactivate)
- **Delete** : exclut `tp.user_id` (owner) des push → cohérent, l'owner est celui qui déclenche.
- **Reactivate** : exclut `caller.user_id` → si un admin plateforme réactive le SpotYou d'un autre owner, **l'owner d'origine reçoit la notification de réactivation** (comportement attesté par le code Python).

---

## BR-29.02 — Pré-condition pour DELETE (guards 404/409/403)

### Ordre strict des vérifications (compat stricte Python)

```
1. Le SpotYou existe-t-il ?                        Non → 404 "SpotYou introuvable"
2. Le SpotYou est-il déjà soft-deleted ?           Oui → 409 "Ce SpotYou est déjà supprimé"
3. Le caller est-il owner OU admin ?               Non → 403 "Non autorisé"
```

> **Ne pas swap 409 et 403** : un caller non-autorisé qui cible un SpotYou déjà supprimé reçoit **409**, pas 403. Motif : sécurité — pas d'info leak (Python a fait ce choix historique, on le préserve).

### Condition "déjà soft-deleted"
`tp.deleted_at IS NOT NULL`. Le flag `active=FALSE` seul ne compte pas (un SpotYou peut être `active=FALSE` sans être soft-deleted dans des cas de désactivation legacy — mais en pratique les deux vont ensemble).

---

## BR-29.03 — Pré-condition pour REACTIVATE (guards 404/409/403)

```
1. Le SpotYou existe-t-il ?                                Non → 404 "SpotYou introuvable"
2. Le SpotYou est-il déjà actif ET non-deleted ?           Oui → 409 "Ce SpotYou est déjà actif"
3. Le caller est-il owner OU admin ?                       Non → 403 "Non autorisé"
```

### Condition "déjà actif"
`tp.active == TRUE AND tp.deleted_at IS NULL` — il faut les **deux** conditions. Un SpotYou partiellement restauré (inconsistant) passe donc la garde 409.

> ⚠️ Cas limite : `active=TRUE` + `deleted_at IS NOT NULL` (état corrompu) → passe les guards, lance la reactivate → écrit les NULL-out + `reactivated_at=now` → effectivement rétablit la cohérence. C'est un comportement de "repair" implicite, à conserver.

---

## BR-29.04 — Rétention média 90 jours

### Règle
À la soft-delete, tous les fichiers (images) du SpotYou sont **planifiés** pour suppression physique à J+90.

### Implémentation
- `MEDIA_RETENTION_DAYS = 90` (constante Python). Java : `@Value("${app.media.retention.days:90}")`.
- `media_purge_scheduled_at = NOW() + 90 days` (timestamp absolu, pas de delta relatif).
- Chaque URL de `tag_points.images` devient 1 ligne `pending_file_deletions(status='pending')`.

### Effets après J+90
Le worker `media_purge_worker` (hors périmètre REST) scan toutes les entités où `media_purge_scheduled_at <= NOW() AND media_purged = FALSE` et :
1. Traite chaque `pending_file_deletions` → appel R2 pour suppression physique.
2. Flip `tag_points.media_purged = TRUE`, `media_purged_at = NOW()`.

### Ce que cela implique pour REACTIVATE
- Si le worker N'A PAS encore passé → `media_purged=FALSE` → le DELETE sur `pending_file_deletions WHERE status='pending'` retire les entries avant purge → les fichiers sont conservés → **réactivation complète**.
- Si le worker A passé → `media_purged=TRUE` → `pending_file_deletions.status` est `'completed'` → le DELETE n'en retire aucune (filtre `status='pending'`) → les fichiers sont perdus → **réactivation "nue"** → réponse contient `requires_media_reupload=true`.

### Conséquence front
Le front doit **obligatoirement** gérer le flag `requires_media_reupload` :
- Afficher un écran d'upload pour que l'owner fournisse de nouvelles images.
- NE PAS afficher le SpotYou dans le feed tant que `images` est vide (règle existante hors périmètre).

---

## BR-29.05 — Notifications push (asynchrones, hors transaction)

### DELETE — Notification "SpotYou désactivé"

Envoyée à **tous les membres** de `spot_you_members` sauf `tp.user_id` (owner).

| Champ | Valeur |
|---|---|
| `title` | `"SpotYou désactivé"` |
| `body` | `f'"{title_str}" a été désactivé. Vous pouvez encore quitter cette communauté depuis votre onglet Communautés.'` |
| `data.type` | `"spotyu_deactivated"` |
| `data.point_id` | `point_id` |
| `data.sender_id` | `caller.user_id` |
| `data.sender_name` | `caller.name` |
| `data.sender_picture` | `caller.picture or ""` |
| `data.action_text` | `"a désactivé le SpotYou"` |
| `data.content_title` | `title_str` (= `tp.title or "SpotYou"`) |
| `data.image_url` | `_first_image(tp.images)` (peut être `None`) |
| `notif_type` | `"spotyu_deactivated"` |

### REACTIVATE — Notification "SpotYou réactivé 🎉"

Envoyée à **tous les membres** sauf `caller.user_id`.

| Champ | Valeur |
|---|---|
| `title` | `"SpotYou réactivé 🎉"` |
| `body` | `f'«{title_str}» est de retour ! Rejoignez les prochaines séances.'` (guillemets français `«»`) |
| `data.type` | `"spotyu_reactivated"` |
| `data.point_id` | `point_id` |
| `notif_type` | `"spotyu_reactivated"` |
| ⚠️ `title_str` tronqué à **50 chars** uniquement ici |

### Règles communes
- **Fire-and-forget** : `asyncio.create_task(...)` hors `async with pool.acquire()` → aucune erreur de push ne fait échouer la requête REST.
- **Après fermeture du pool** : la transaction DB est déjà commitée quand les push partent. Si un push échoue, le soft-delete/reactivate reste effectif.
- **Pas de retry côté endpoint** : les retries push sont gérés par `push_service` (FCM/APN internal) si implémentés.
- **Aucun filtre sur `spot_you_members.status`** : pending, invited, rejected reçoivent tous la notif (cf. DB_MAPPING). Compat stricte = garder cette "imprécision".

### Pour Java
- Utiliser `ApplicationEventPublisher.publishEvent(new SpotYouDeletedEvent(...))` **APRÈS commit** via `@TransactionalEventListener(phase=AFTER_COMMIT)`.
- Le listener fait l'envoi push en async (`@Async` ou queue). Si l'envoi échoue → log mais pas d'exception propagée.

---

## BR-29.06 — Contexte des conversations (archivage / restauration)

### Règle
Une conversation liée au SpotYou via `conversations.context_id = point_id` est automatiquement :
- **Marquée `context_deleted=TRUE`** à la soft-delete.
- **Dé-marquée `context_deleted=FALSE`** à la réactivation.

### But métier
Afficher une bannière "contexte supprimé" dans l'interface chat sans supprimer physiquement les conversations (préservation des historiques).

### Garde de performance
- DELETE : `WHERE context_deleted = FALSE` évite de ré-écrire les conversations déjà marquées (idempotence si retry).
- REACTIVATE : `WHERE context_deleted = TRUE` symétrique.

### RETURN count (asymétrie)
- DELETE : renvoie `conversations_marked` (via `RETURNING conversation_id`).
- REACTIVATE : **ne renvoie PAS** de count. Asymétrie volontaire du code Python. À reproduire.

---

## BR-29.07 — Cascade interdit : réactivation user ≠ réactivation SpotYou

### Règle (cf. docstring `deletion_routes.py:360–361`)
Lorsqu'un utilisateur est réactivé via `POST /users/{user_id}/reactivate` (hors périmètre de cette slice), ses SpotYou désactivés **ne sont PAS automatiquement réactivés**. Chaque SpotYou doit être réactivé **manuellement** via `POST /tag-points/{point_id}/reactivate`.

### Motivation métier
Un utilisateur peut vouloir réactiver son compte sans restaurer publiquement d'anciens SpotYou abandonnés.

### Implication pour le front
L'onglet "Désactivés" de `spot-me.tsx` doit lister les SpotYou soft-deleted (via `GET /users/me/reactivatable`) avec un bouton "Réactiver" par entité.

---

## BR-29.08 — Idempotence

### DELETE
- Appel sur un SpotYou déjà soft-deleted → **409** (pas 200 idempotent). Justifié car les side-effects (push, scheduled purge) ne doivent pas être rejoués.

### REACTIVATE
- Appel sur un SpotYou déjà actif → **409**.
- Appel sur un SpotYou qui a été supprimé puis réactivé puis re-supprimé : OK, reactivate fonctionne car `deleted_at IS NOT NULL`.

### Répétition de l'INSERT `pending_file_deletions`
- Protégé par `ON CONFLICT DO NOTHING` → si le même endpoint est rejoué (ce qui NE DEVRAIT PAS arriver grâce au 409), les inserts sont silencieusement ignorés.

### Répétition du DELETE `pending_file_deletions`
- Pas de protection explicite, mais : après un `DELETE WHERE status='pending'`, un second DELETE sur le même `entity_id` supprimera 0 ligne (retourne `"DELETE 0"`). Safe.

---

## BR-29.09 — Asymétries à préserver (ne PAS harmoniser en Java)

| Aspect | Comportement Python | Java doit répéter |
|---|---|---|
| `title_str` troncature 50 chars | Uniquement à la REACTIVATE | ✅ OUI |
| `conversations_marked` dans la réponse | Uniquement au DELETE | ✅ OUI |
| Guillemets push | `"..."` au DELETE, `«...»` à la REACTIVATE | ✅ OUI (copy-paste du texte) |
| Exclusion push | Owner au DELETE, Caller à la REACTIVATE | ✅ OUI |
| Emoji titre push | `🎉` à la REACTIVATE uniquement | ✅ OUI |
| Array vs scalaire context_id | ANY(array) au DELETE, scalaire à la REACTIVATE | ✅ OUI |

---

## BR-29.10 — Interactions avec slices déjà migrées

| Slice | Couplage | Risque de régression |
|---|---|---|
| **S23 Auth** | `require_auth(request)` utilisé à l'entrée de chaque endpoint | Si `caller.user_id`, `caller.role`, `caller.name`, `caller.picture` ne sont pas exposés dans le token/session Java → push payload incomplet. **Vérifier** : S23 doit exposer ces 4 champs. |
| **S26 Home feed** | `active=FALSE` exclut les SpotYou soft-deleted du feed | Aucun changement : la condition WHERE est déjà documentée S26. |
| **S27 TagPoints reads** | `GET /tag-points/{id}` : comportement sur SpotYou soft-deleted ? | Vérifier S27 : soit 404 si `active=FALSE`, soit renvoyé avec flag — à ne PAS modifier. |
| **S28 TagPoints CRUD** | `PUT /tag-points/{id}` / `PATCH new-date` : refusent-ils les SpotYou soft-deleted ? | À vérifier — si S28 ne filtre pas, un owner pourrait UPDATE un SpotYou soft-deleted. Logique actuelle **probablement** tolérante. Préserver tel quel. |

---

## BR-29.11 — Dépendances externes

### Cloudflare R2 (pas impact direct Slice 29)
La purge physique des fichiers R2 est **faite par le worker**, pas par ces endpoints. Les endpoints n'appellent jamais l'API R2. Java : idem, pas de dépendance R2 dans le controller/service de Slice 29.

### Push service (FCM/APN)
Via `push_service.send_push_to_user(pool, user_id, title, body, data, notif_type)`. Le service prend le pool pour résoudre les tokens de l'utilisateur en DB.

### Workers background
`media_purge_worker.py` et `media_notif_worker.py` consomment les colonnes écrites par cette slice. Les workers ne sont PAS dans le périmètre de Slice 29 mais leur contrat avec la DB doit être préservé :
- `media_purge_scheduled_at IS NOT NULL AND media_purged = FALSE AND deleted_at IS NOT NULL AND active = FALSE` → éligible purge.
- `media_purge_scheduled_at BETWEEN NOW() AND NOW()+7d AND media_purge_notified_at IS NULL AND media_purged = FALSE` → éligible notif J+83.

**Cela explique pourquoi REACTIVATE NULL-out BOTH `media_purge_scheduled_at` ET `media_purge_notified_at`** : pour sortir le SpotYou des deux fenêtres de workers.

---

## BR-29.12 — Validation des entrées

| Champ | Type | Validation |
|---|---|---|
| `point_id` (path) | string | Non vide. Format libre (TEXT en DB). Pas de regex explicite côté endpoint. |
| Body | — | Aucun body requis. Un body fourni est silencieusement ignoré. |

---

## BR-29.13 — Timezone

Tous les `NOW()` sont en **UTC** via `datetime.now(timezone.utc)`. En Java : `Instant.now()` ou `OffsetDateTime.now(ZoneOffset.UTC)`. Les colonnes DB sont `TIMESTAMPTZ`. Le front reçoit des ISO-8601 avec offset (ex. `2026-07-19T14:22:35.812000+00:00`).
