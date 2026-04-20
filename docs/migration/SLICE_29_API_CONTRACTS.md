# SLICE_29_API_CONTRACTS.md — Contrats API SpotYou Soft-Delete + Reactivate
> Basé sur `deletion_routes.py:260–431`.
> Généré le 2026-04-20.

---

## Endpoint 1 — `DELETE /api/tag-points/{point_id}` (Soft-delete SpotYou)

### Auth : **STRICTE** (owner OU admin)

### Paramètres

| Type | Nom | Source | Obligatoire | Notes |
|---|---|---|---|---|
| Path | `point_id` | URL | oui | `point_id` (UUID v4 ou code métier stocké en TEXT) |
| Header | `Authorization: Bearer <token>` | Header | oui | Session Supabase JWT |

### Body : **aucun**

### Flow backend (90 lignes)

```
1. require_auth(request) → caller (user_id, role, name, picture)
2. Ouvrir pool.acquire()
3. SELECT user_id, images, title, deleted_at
     FROM tag_points WHERE point_id=$1
   → 404 "SpotYou introuvable" si absent
   → 409 "Ce SpotYou est déjà supprimé" si deleted_at IS NOT NULL
   → 403 "Non autorisé" si user_id != caller AND role != 'admin'
4. now = NOW()
5. media_purge_at = now + INTERVAL '90 days'
6. UPDATE tag_points SET
     active=FALSE,
     deleted_at=now,
     deleted_by=caller.user_id,
     updated_at=now,
     media_purge_scheduled_at=media_purge_at
   WHERE point_id=$1
7. _mark_conversations_context_deleted([point_id]) :
   UPDATE conversations SET context_deleted=TRUE
   WHERE context_id = ANY($1::text[]) AND context_deleted=FALSE
   RETURNING conversation_id
   → n_convs
8. _schedule_file_deletions(conn, "tag_point", point_id, tp.images, scheduled_at=media_purge_at) :
   pour chaque url dans tp.images :
     INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at)
     VALUES($1,'tag_point',$3,$4) ON CONFLICT DO NOTHING
   → n_imgs
9. SELECT user_id FROM spot_you_members
   WHERE spot_you_id=$1 AND user_id != tp.user_id
   → members (list)
10. (fermeture du pool)
11. Pour chaque membre : asyncio.create_task(send_push_to_user(
       title="SpotYou désactivé",
       body=f'"{title_str}" a été désactivé. Vous pouvez encore quitter cette communauté depuis votre onglet Communautés.',
       data={
         "type": "spotyu_deactivated", "point_id": point_id,
         "sender_id": caller.user_id,
         "sender_name": caller.name,
         "sender_picture": caller.picture or "",
         "action_text": "a désactivé le SpotYou",
         "content_title": title_str,
         "image_url": _first_image(tp.images)
       },
       notif_type="spotyu_deactivated"
    ))
12. logger.info("[SOFTDEL] ...")
13. Retour 200
```

### Réponse 200

```json
{
  "success":               true,
  "deleted":               true,
  "point_id":              "5f2e1b3c-...",
  "conversations_marked":  2,
  "images_queued":         5,
  "members_notified":      12,
  "media_purge_scheduled_at": "2026-07-19T14:22:35.812000+00:00"
}
```

### Erreurs

| Code | Condition | Message |
|---|---|---|
| 401 | `require_auth` échoue (pas de token / token invalide) | `"Unauthorized"` (standard auth middleware) |
| 404 | `point_id` inexistant | `"SpotYou introuvable"` |
| 409 | `deleted_at IS NOT NULL` (déjà soft-deleted) | `"Ce SpotYou est déjà supprimé"` |
| 403 | Caller != owner ET caller.role != 'admin' | `"Non autorisé"` |

> **Ordre impératif** : le `SELECT` est fait AVANT toute vérification. L'auth est faite AVANT le SELECT. Ordre des `HTTPException` dans le code : 404 → 409 → 403. **Java doit produire exactement le même ordre** pour compat stricte (sinon un appelant non-autorisé sur un point_id inexistant verrait 403 au lieu de 404).

### Effets de bord

| Effet | Transactionnel ? | Réversible ? |
|---|---|---|
| `tag_points` UPDATE (active=FALSE, deleted_at, deleted_by, media_purge_scheduled_at) | OUI (conn courant) | OUI (reactivate) |
| `conversations` UPDATE `context_deleted=TRUE` | OUI | OUI (reactivate) |
| `pending_file_deletions` INSERT (1 ligne par image) | OUI | OUI via `_cancel_file_deletions` (status='pending') |
| Push notification aux membres | NON (fire-and-forget, post-pool-close) | N/A (déjà envoyé) |
| Log `[SOFTDEL] ...` | NON | N/A |
| **Purge physique des fichiers** | **NON, différée de 90j** | OUI tant que worker n'est pas passé |

### Notes

- `tp.images` est stocké en **JSONB** — `_parse_images` gère 3 formats : `list` Python, `str` JSON-encodé, `None`/falsy.
- `title_str = tp["title"] or "SpotYou"` (fallback string).
- `caller.get("picture") or ""` — `None` forcé en string vide pour payload push (cohérence avec push_service).
- `_first_image(tp.images)` est importé depuis `tagpoint_routes.py` — **doit être la même logique** que celle utilisée dans `build_point_response` de S26/S27.

---

## Endpoint 2 — `POST /api/tag-points/{point_id}/reactivate` (Réactivation SpotYou)

### Auth : **STRICTE** (owner OU admin)

### Paramètres

| Type | Nom | Source | Obligatoire | Notes |
|---|---|---|---|---|
| Path | `point_id` | URL | oui | Identifiant SpotYou |
| Header | `Authorization: Bearer <token>` | Header | oui | Session Supabase JWT |

### Body : **aucun**

### Flow backend (80 lignes)

```
1. require_auth(request) → caller
2. Ouvrir pool.acquire()
3. SELECT user_id, deleted_at, active, media_purged, title
     FROM tag_points WHERE point_id=$1
   → 404 "SpotYou introuvable" si absent
   → 409 "Ce SpotYou est déjà actif" si active=TRUE AND deleted_at IS NULL
   → 403 "Non autorisé" si user_id != caller AND role != 'admin'
4. cancelled = _cancel_file_deletions(conn, point_id) :
   DELETE FROM pending_file_deletions
   WHERE entity_id=$1 AND status='pending'
   → nombre de lignes supprimées (parse "DELETE N")
5. UPDATE tag_points SET
     active=TRUE,
     deleted_at=NULL,
     deleted_by=NULL,
     updated_at=now,
     media_purge_scheduled_at=NULL,
     media_purge_notified_at=NULL,
     reactivated_at=now
   WHERE point_id=$2
6. UPDATE conversations SET context_deleted=FALSE
   WHERE context_id=$1 AND context_deleted=TRUE
   (pas de RETURNING, pas de count dans la réponse)
7. SELECT user_id FROM spot_you_members
   WHERE spot_you_id=$1 AND user_id != caller.user_id
   → members
8. (fermeture du pool)
9. title_str = (tp.title or "SpotYou")[:50]   ← tronqué à 50 chars
10. Pour chaque membre : asyncio.create_task(send_push_to_user(
       title="SpotYou réactivé 🎉",
       body=f'«{title_str}» est de retour ! Rejoignez les prochaines séances.',
       data={"type": "spotyu_reactivated", "point_id": point_id},
       notif_type="spotyu_reactivated"
    ))
11. media_purged = tp["media_purged"]
12. logger.info("[REACTIVATE] ...")
13. Retour 200
```

### Réponse 200

```json
{
  "success":                     true,
  "reactivated":                 true,
  "point_id":                    "5f2e1b3c-...",
  "media_purged":                false,
  "requires_media_reupload":     false,
  "pending_deletions_cancelled": 5
}
```

### Cas où `media_purged=TRUE` (réactivation tardive > 90j ou worker passé)

```json
{
  "success":                     true,
  "reactivated":                 true,
  "point_id":                    "5f2e1b3c-...",
  "media_purged":                true,
  "requires_media_reupload":     true,
  "pending_deletions_cancelled": 0
}
```

> **Flag `requires_media_reupload` = `media_purged`** — le front doit intercepter ce cas et rediriger vers un écran d'upload de nouvelles images.

### Erreurs

| Code | Condition | Message |
|---|---|---|
| 401 | `require_auth` échoue | `"Unauthorized"` |
| 404 | `point_id` inexistant | `"SpotYou introuvable"` |
| 409 | `active=TRUE AND deleted_at IS NULL` (déjà actif) | `"Ce SpotYou est déjà actif"` |
| 403 | Caller != owner ET caller.role != 'admin' | `"Non autorisé"` |

### Effets de bord

| Effet | Transactionnel ? | Réversible ? |
|---|---|---|
| `pending_file_deletions` DELETE WHERE status='pending' | OUI | Non-destructif (les entrées déjà `completed` restent) |
| `tag_points` UPDATE (5 colonnes NULL-out + `reactivated_at=now`) | OUI | OUI (re-delete) |
| `conversations` UPDATE `context_deleted=FALSE` | OUI | OUI (re-delete) |
| Push notification aux membres | NON (fire-and-forget) | N/A |
| **Les images déjà purgées (`media_purged=TRUE`) NE reviennent PAS** | N/A | NON (le worker a supprimé les fichiers physiquement) |

### Notes

- **`title_str[:50]` uniquement à la réactivation** (pas au delete). Incohérence assumée du code Python.
- **Aucun `conversations_marked` dans la réponse** de reactivate (contrairement à delete). Le code ne fait pas de RETURNING.
- **Pas de cascade** depuis la réactivation d'un utilisateur : `POST /users/{id}/reactivate` NE réactive PAS automatiquement ses SpotYou (cf. docstring lignes 360–361). Chaque SpotYou doit être réactivé manuellement.

---

## Codes de statut communs

| Code | Contexte |
|---|---|
| 200 | Succès |
| 401 | Auth manquante/invalide |
| 403 | Pas autorisé (ownership) |
| 404 | SpotYou introuvable |
| 409 | État incompatible (déjà supprimé / déjà actif) |
| 500 | Erreur serveur inattendue (DB down, etc.) |

---

## Headers requis

| Header | Valeur | Obligatoire |
|---|---|---|
| `Authorization` | `Bearer <access_token>` | oui |
| `Content-Type` | `application/json` | recommandé (même sans body) |

---

## Ce qui n'est PAS dans le périmètre de cette slice

| Endpoint | Raison |
|---|---|
| `GET /users/me/reactivatable` (`deletion_routes.py:681`) | Lecture cross-entités (SpotYou + services + products). Slice de lecture dédiée à venir. |
| `DELETE /users/{user_id}` (`deletion_routes.py:97`) | Anonymisation RGPD. Cascade sur SpotYou mais périmètre utilisateur, à migrer dans la slice User delete. |
| `PATCH /users/{user_id}/deactivate` / `POST /users/{user_id}/reactivate` | Slice User lifecycle. |
| `DELETE /messages/{message_id}` / `PATCH /conversations/{conv_id}/leave` | Slice Chat. |
| Workers `media_purge_worker` / `media_notif_worker` | Ne sont PAS des endpoints REST. Migrer dans une slice "Background jobs" dédiée. |
