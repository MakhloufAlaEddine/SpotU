# SLICE 47 — API Contracts (Notifications inbox)

> **Source** : `/app/backend/routes/tagpoint_routes.py` l. 1350–1425

---

## 1. `GET /api/users/me/notifications` — Liste inbox

### Permissions
- JWT requis (`require_auth`) — sinon 401.

### Query params
| Nom | Type | Défaut | Contraintes | Notes |
|-----|------|--------|-------------|-------|
| `limit` | integer | `50` | `1 <= limit <= 200` (Query Pydantic `ge=1, le=200`) | Hors range → 422 |

### Réponse `200 OK`
**Tableau** (note : pas d'enveloppe `{notifications: [...]}` — réponse JSON directe).

```jsonc
[
  {
    "id": "ntf_xxxx",
    "type": "string",          // ex: "booking_request", "spot_you_invite", "payment_received", ...
    "title": "string",
    "body": "string",
    "data": { /* jsonb arbitraire ; toujours objet, jamais null */ },
    "read": true|false,
    "created_at": "ISO8601 | null"
  },
  ...
]
```

### Comportement Python (à reproduire)
```pseudo
SELECT n.notif_id, n.type, n.title, n.body, n.data, n.read, n.created_at,
       u.picture as sender_current_picture
  FROM notifications n
  LEFT JOIN users u ON u.user_id = (n.data->>'sender_id')
 WHERE n.user_id = $1
 ORDER BY n.created_at DESC
 LIMIT $2

For each row:
   raw = row.data
   if not raw:           data = {}
   elif isinstance(raw, str):
       try:    data = json.loads(raw)
       except: data = {}
   else:                 data = dict(raw)
   if row.sender_current_picture is not None:
       data["sender_picture"] = row.sender_current_picture
   yield {
     "id": row.notif_id, "type": row.type,
     "title": row.title, "body": row.body, "data": data,
     "read": row.read,
     "created_at": row.created_at.isoformat() if row.created_at else None
   }
```

> ⚠️ **Override sender_picture** : la photo **actuelle** du sender (jointure live) **écrase** la photo stockée historiquement dans `data.sender_picture`. À reproduire **strictement**.

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant ou invalide |
| 422 | `limit` hors range |

### Effets de bord
- Aucun (lecture pure).

---

## 2. `PATCH /api/users/me/notifications/{notif_id}/read` — Marquer une notification lue

### Permissions
- JWT requis.

### Path parameter
- `notif_id` : ID de la notification.

### Body
- **Aucun**.

### Comportement Python (à reproduire)
```pseudo
UPDATE notifications
   SET read = TRUE
 WHERE notif_id = $1 AND user_id = $2          # filtre owner

unread = SELECT COUNT(*) FROM notifications
          WHERE user_id = $1 AND read = FALSE

await notif_manager.notify(user_id, {"type": "unread_notif", "count": int(unread)})

return {"success": True, "unread_notif": int(unread)}
```

### Réponse `200 OK`
```json
{ "success": true, "unread_notif": 5 }
```
- `unread_notif` est le **nouveau** compteur unread après l'UPDATE.

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant/invalide |

> ⚠️ **Aucun 404** : si `notif_id` n'existe pas OU appartient à un autre user, l'UPDATE ne touche aucune ligne (silent). Le compteur unread est recalculé et renvoyé. Réponse 200 toujours.

### Effets de bord
1. UPDATE 1 ou 0 ligne.
2. SELECT COUNT unread.
3. **WebSocket broadcast** `notif_manager.notify(user_id, {type:"unread_notif", count:N})` (deferred slice WS — stub côté Java).

---

## 3. `PATCH /api/users/me/notifications/read-all` — Tout marquer lu

### Permissions
- JWT requis.

### Path/Query/Body
- **Aucun**.

### Comportement Python (à reproduire)
```pseudo
UPDATE notifications
   SET read = TRUE
 WHERE user_id = $1 AND read = FALSE

await notif_manager.notify(user_id, {"type": "unread_notif", "count": 0})

return {"success": True}
```

### Réponse `200 OK`
```json
{ "success": true }
```

> ⚠️ **Asymétrie** : contrairement au mark-single-read, **pas de champ `unread_notif`** dans la réponse (pourtant on sait que c'est `0`). Iso Python à conserver.

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant/invalide |

### Effets de bord
1. UPDATE N lignes (0 si déjà tout lu).
2. **WebSocket broadcast** `{type:"unread_notif", count:0}` hardcodé (pas de SELECT COUNT).

---

## 4. Récapitulatif HTTP

| Endpoint | 200 | 401 | 422 |
|----------|:---:|:---:|:---:|
| GET /users/me/notifications | ✅ | ✅ | ✅ (limit) |
| PATCH /users/me/notifications/{id}/read | ✅ (silent si pas owner) | ✅ | — |
| PATCH /users/me/notifications/read-all | ✅ | ✅ | — |

> Aucun 404 sur les PATCH (silent).

---

## 5. Format de réponse JSON spécifique

### `data` jsonb
- Toujours **objet** (jamais null/undefined dans le JSON de réponse).
- Si DB stocke `NULL` ou string vide → `{}` côté réponse.
- Si DB stocke string JSON parseable → objet.
- Si DB stocke string JSON malformée → `{}` (fallback silencieux).

### `created_at`
- ISO 8601 (`yyyy-MM-ddTHH:mm:ss.SSSSSSXXX`) ou `null` si la colonne est NULL (improbable car DEFAULT now).

### `id`
- Champ JSON `id` mappé sur la colonne DB `notif_id`. **Renommé volontairement**.

### `read`
- Boolean strict.

---

## 6. Champ `data.sender_picture` (override)

Si la notification contient `data.sender_id` (référence un utilisateur), la jointure :
```sql
LEFT JOIN users u ON u.user_id = (n.data->>'sender_id')
```
remplace `data.sender_picture` par la **photo actuelle** de l'utilisateur (`users.picture`).

> ⚠️ Si `users.picture IS NULL` → on **garde** la valeur historique stockée dans `data.sender_picture` (pas de retour à null). Iso Python (`if r["sender_current_picture"] is not None`).

> Si `data.sender_id` n'existe pas dans `users` (compte supprimé), la jointure renvoie `NULL` ⇒ `data.sender_picture` historique conservé.
