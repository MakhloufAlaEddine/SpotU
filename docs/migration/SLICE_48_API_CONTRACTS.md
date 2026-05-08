# SLICE 48 — API Contracts (Chat & WebSockets)

> **Source** :
> - HTTP : `/app/backend/routes/chat_routes.py` l. 227–448 + `/app/backend/routes/deletion_routes.py` l. 436–517
> - WS : `/app/backend/routes/chat_routes.py` l. 459–714
> - Manager : `/app/backend/chat_manager.py` l. 1–89

---

# Partie A — HTTP

## A.1. `POST /api/conversations` — Créer ou récupérer une conversation

### Permissions
- JWT requis (`require_auth`) — sinon 401.
- Type `tagpoint_group` : caller doit être membre du SpotYou OU créateur du tag_point — sinon 403.

### Body JSON
```json
{
  "type": "service" | "tagpoint_group" | "tagpoint_private",
  "context_id": "string"
}
```

### Comportement Python (à reproduire)

#### Type = `tagpoint_group`
```pseudo
# 1. Permission
is_member = SELECT 1
              FROM spot_you_members
             WHERE spot_you_id = :context_id AND user_id = :uid
            UNION
            SELECT 1
              FROM tag_points
             WHERE point_id = :context_id AND user_id = :uid
if not is_member: raise 403 "Vous devez être membre de ce SpotYou pour accéder au groupe"

# 2. Idempotence (1 group conv per tag_point)
existing = SELECT conversation_id FROM conversations WHERE type='tagpoint_group' AND context_id = :context_id
if existing:
    conv_id = existing.conversation_id
    INSERT INTO conversation_participants (conversation_id, user_id, status)
        VALUES (conv_id, :uid, 'active')
        ON CONFLICT (conversation_id, user_id) DO UPDATE SET status = 'active'
else:
    conv_id = "conv_" + 12hex
    creator_id = (SELECT user_id FROM tag_points WHERE point_id = :context_id) or :uid
    title      = (SELECT title    FROM tag_points WHERE point_id = :context_id) or :context_id
    INSERT INTO conversations (conversation_id, type, context_id, context_title, created_by)
        VALUES (conv_id, 'tagpoint_group', :context_id, title, creator_id)
    for pid in {creator_id, uid}:
        INSERT INTO conversation_participants (conversation_id, user_id, status)
            VALUES (conv_id, pid, 'active') ON CONFLICT DO NOTHING
```

#### Type = `tagpoint_private`
```pseudo
# 1 conv per (context_id, current_user)
existing = SELECT c.conversation_id
             FROM conversations c
             JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
            WHERE c.type='tagpoint_private' AND c.context_id = :context_id AND cp.user_id = :uid
            LIMIT 1
if existing:
    conv_id = existing.conversation_id
else:
    conv_id    = "conv_" + 12hex
    creator_id = (SELECT user_id FROM tag_points WHERE point_id = :context_id) or :uid
    title      = (SELECT title    FROM tag_points WHERE point_id = :context_id) or :context_id
    INSERT INTO conversations (conversation_id, type='tagpoint_private', context_id, context_title=title, created_by=:uid)
    for pid in {creator_id, uid}:
        INSERT INTO conversation_participants (conversation_id, user_id) VALUES (conv_id, pid) ON CONFLICT DO NOTHING
```

> ⚠️ **Asymétrie volontaire** vs `tagpoint_group` : le `tagpoint_private` n'écrit PAS le `status` à l'INSERT participant — il s'appuie sur le `DEFAULT 'active'` côté DDL (l. 77 `001_initial_schema.sql`). **Préserver iso Python.**

#### Type = `service`
```pseudo
# 1 conv per (context_id, user)
existing = SELECT c.conversation_id
             FROM conversations c
             JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
            WHERE c.type='service' AND c.context_id = :context_id AND cp.user_id = :uid
            LIMIT 1
if existing:
    conv_id = existing.conversation_id
else:
    conv_id  = "conv_" + 12hex
    coach_id = (SELECT coach_id FROM services WHERE service_id = :context_id) or :uid
    title    = (SELECT title    FROM services WHERE service_id = :context_id) or :context_id
    INSERT INTO conversations (conversation_id, type='service', context_id, context_title=title, created_by=:uid)
    for pid in {coach_id, uid}:
        INSERT INTO conversation_participants (conversation_id, user_id) VALUES (conv_id, pid) ON CONFLICT DO NOTHING
```

### Réponse `200 OK`
```json
{
  "conversation_id": "conv_xxxxxxxxxxxx",
  "type": "service",
  "context_id": "...",
  "context_title": "...",
  "created_by": "u_...",
  "last_message_at": "2026-..." | null,
  "created_at": "2026-..."
}
```

### Erreurs
| Code | Cas |
|------|-----|
| 400 | `type` ∉ {service, tagpoint_group, tagpoint_private} → `{"detail":"Invalid conversation type"}` |
| 401 | JWT manquant/invalide |
| 403 | Type tagpoint_group ET non-membre/créateur → `{"detail":"Vous devez être membre de ce SpotYou pour accéder au groupe"}` |

### Effets de bord
- `INSERT INTO conversations` (création) OU lookup.
- `INSERT INTO conversation_participants` (1 ou 2 lignes).
- **Aucun broadcast WS** (la création seule ne produit pas d'événement).

---

## A.2. `GET /api/conversations` — Liste des conversations

### Permissions
- JWT requis.

### Query params
- Aucun.

### Comportement Python (à reproduire)
```pseudo
# 1. Liste brute
rows = SELECT c.conversation_id, c.type, c.context_id,
              COALESCE(
                  CASE WHEN c.type IN ('tagpoint_private','tagpoint_group') THEN tp.title ELSE NULL END,
                  CASE WHEN c.type = 'service' THEN svc.title ELSE NULL END,
                  c.context_title
              ) AS context_title,
              c.created_by, c.last_message_at, c.created_at,
              CASE
                  WHEN c.context_deleted = TRUE THEN TRUE
                  WHEN c.type IN ('tagpoint_private','tagpoint_group')
                       AND (tp.point_id IS NULL OR tp.active = FALSE OR tp.deleted_at IS NOT NULL)
                       THEN TRUE
                  WHEN c.type = 'service'
                       AND (svc.service_id IS NULL OR svc.active = FALSE OR svc.deleted_at IS NOT NULL)
                       THEN TRUE
                  ELSE FALSE
              END AS context_deleted
         FROM conversations c
         LEFT JOIN tag_points tp ON c.type IN ('tagpoint_private','tagpoint_group') AND tp.point_id = c.context_id
         LEFT JOIN services   svc ON c.type = 'service' AND svc.service_id = c.context_id
         JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
        WHERE cp.user_id = :uid AND c.deleted_at IS NULL
        ORDER BY c.last_message_at DESC NULLS LAST

# 2. Enrichissement batch (5 queries en parallèle)
return _batch_enrich_conversations(pool, conn=None, convs=rows, current_user_id=:uid)
```

### `_batch_enrich_conversations` (cf. SLICE_48_BUSINESS_RULES.md §3 et §4)

5 requêtes batch en parallèle (`asyncio.gather`) :

#### Q1 — `last_message`
```sql
SELECT DISTINCT ON (m.conversation_id)
       m.conversation_id, m.message_id,
       CASE WHEN m.deleted_at IS NOT NULL THEN '[Message supprimé]' ELSE m.content END AS content,
       m.created_at, m.sender_id,
       COALESCE(u.name, 'Utilisateur supprimé') AS sender_name
  FROM messages m
  LEFT JOIN users u ON u.user_id = m.sender_id
 WHERE m.conversation_id = ANY($1::text[])
 ORDER BY m.conversation_id, m.created_at DESC
```

#### Q2 — `unread_count`
```sql
SELECT m.conversation_id,
       COUNT(*) FILTER (
           WHERE m.created_at > cp.last_read_at
             AND m.sender_id != $1
       ) AS unread_count
  FROM messages m
  JOIN conversation_participants cp
    ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
 WHERE m.conversation_id = ANY($2::text[])
 GROUP BY m.conversation_id
```

#### Q3 — `is_blocked` (status du caller)
```sql
SELECT conversation_id, status
  FROM conversation_participants
 WHERE conversation_id = ANY($1::text[]) AND user_id = $2
```
→ `is_blocked = (status == 'blocked')`

#### Q4 — `other_participant` (uniquement pour `tagpoint_private` / `service`)
```sql
SELECT cp.conversation_id, u.user_id, u.name, u.picture
  FROM conversation_participants cp
  JOIN users u ON u.user_id = cp.user_id
 WHERE cp.conversation_id = ANY($1::text[]) AND cp.user_id != $2
```
→ pour chaque conv non-group, prendre le premier `other_participant` (s'il y en a plusieurs, ne prendre que le 1er — iso Python l. 215).

#### Q5 — `participant_count` + `context_image` (uniquement `tagpoint_group`)
```sql
SELECT conversation_id, COUNT(*) AS cnt
  FROM conversation_participants
 WHERE conversation_id = ANY($1::text[])
 GROUP BY conversation_id;

SELECT point_id, images
  FROM tag_points
 WHERE point_id = ANY($1::text[])
```
→ `context_image = images[0]` (avec parse JSON si `images` est string ; fallback `null`)

### Réponse `200 OK` (tableau)
```jsonc
[
  {
    "conversation_id": "conv_...",
    "type": "service" | "tagpoint_private" | "tagpoint_group",
    "context_id": "...",
    "context_title": "...",
    "created_by": "u_...",
    "last_message_at": "2026-..." | null,
    "created_at": "2026-...",
    "context_deleted": false,

    // Champs enrichis :
    "last_message": {
      "message_id": "msg_...",
      "content": "Bonjour" | "[Message supprimé]",
      "created_at": "2026-...",
      "sender_id": "u_..." | null,
      "sender_name": "Alice" | "Utilisateur supprimé"
    } | null,
    "unread_count": 3,
    "is_blocked": false,

    // Si type ∈ {service, tagpoint_private} :
    "other_participant": {
      "user_id": "u_...",
      "name": "Bob",
      "picture": "https://..." | null
    } | null,

    // Si type = tagpoint_group :
    "participant_count": 12,
    "other_participant": null,            // toujours null pour groups
    "context_image": "https://..." | null
  },
  ...
]
```

> ⚠️ **Asymétrie clé** : pour `tagpoint_group`, `other_participant=null`. Pour `service` / `tagpoint_private`, **PAS** de champ `participant_count` ni `context_image`. À reproduire **strictement** (le front teste sur la présence).

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant/invalide |

### Effets de bord
- Aucun (lecture pure).

---

## A.3. `GET /api/conversations/{conv_id}/messages` — Messages d'une conversation

### Permissions
- JWT requis.
- Doit être participant (n'importe quel `status`) — sinon 403.

### Path & Query params
| Nom | Type | Défaut | Contraintes |
|-----|------|--------|-------------|
| `conv_id` (path) | string | — | — |
| `limit` (query) | integer | `50` | `1 ≤ limit ≤ 100` (Pydantic `Query(50, ge=1, le=100)`) |
| `before` (query, optionnel) | ISO8601 timestamp | `null` | Cast `::timestamptz` côté DB |

### Comportement Python (à reproduire)
```pseudo
# 1. Permission (n'importe quel status)
is_part = SELECT 1 FROM conversation_participants
                  WHERE conversation_id = :conv_id AND user_id = :uid
if not is_part: raise 403 "Not a participant"

# 2. Lecture des messages
if before:
    rows = SELECT m.message_id, m.conversation_id, m.sender_id,
                  CASE WHEN m.deleted_at IS NOT NULL THEN '[Message supprimé]' ELSE m.content END AS content,
                  m.created_at, m.deleted_at,
                  COALESCE(u.name, 'Utilisateur supprimé') AS sender_name,
                  u.picture AS sender_picture
             FROM messages m
             LEFT JOIN users u ON m.sender_id = u.user_id
            WHERE m.conversation_id = :conv_id AND m.created_at < :before::timestamptz
            ORDER BY m.created_at DESC
            LIMIT :limit
else:
    # idem sans le filtre `created_at < :before`

# 3. Inverser pour ordre chronologique
messages = list(rows).reverse()

# 4. Marquer lu + push unread_total
UPDATE conversation_participants
   SET last_read_at = NOW()
 WHERE conversation_id = :conv_id AND user_id = :uid
await _push_unread(conn, :uid)

return messages
```

### Réponse `200 OK` (tableau, ordre chronologique ASC)
```jsonc
[
  {
    "message_id": "msg_...",
    "conversation_id": "conv_...",
    "sender_id": "u_..." | null,                     // null si sender supprimé (FK SET NULL)
    "content": "Bonjour" | "[Message supprimé]",
    "created_at": "2026-...",
    "deleted_at": "2026-..." | null,
    "sender_name": "Alice" | "Utilisateur supprimé",
    "sender_picture": "https://..." | null
  },
  ...
]
```

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant/invalide |
| 403 | Non-participant → `{"detail":"Not a participant"}` |
| 422 | `limit` hors range (1..100) |

### Effets de bord
1. UPDATE `conversation_participants.last_read_at = NOW()` pour le caller (1 ligne).
2. **WebSocket broadcast** `notifRegistry.notify(uid, {type:"unread_total", count:N})` où `N = SELECT COUNT(*) FROM messages m JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = :uid WHERE m.created_at > cp.last_read_at AND m.sender_id != :uid` (toutes conversations confondues).

---

## A.4. `PUT /api/conversations/{conv_id}/read` — Marquer toute la conv lue

### Permissions
- JWT requis.

### Path & Body
- `conv_id` (path).
- Body : aucun.

### Comportement Python (à reproduire)
```pseudo
UPDATE conversation_participants
   SET last_read_at = NOW()
 WHERE conversation_id = :conv_id AND user_id = :uid

await _push_unread(conn, :uid)

return { "success": True }
```

### Réponse `200 OK`
```json
{ "success": true }
```

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant/invalide |

> ⚠️ **Aucun 403 / 404** : si le user n'est pas participant, l'UPDATE ne touche aucune ligne mais **renvoie 200**. Iso Python (silent). Le `_push_unread` recalcule quand même le total.

### Effets de bord
1. UPDATE 0 ou 1 ligne.
2. WS broadcast `unread_total`.

---

## A.5. `DELETE /api/messages/{message_id}` — Soft-delete d'un message

> **Fichier source** : `/app/backend/routes/deletion_routes.py:436–476`

### Permissions
- JWT requis.
- Caller DOIT être l'auteur du message OU `role='admin'` — sinon 403.

### Comportement Python (à reproduire)
```pseudo
msg = SELECT message_id, sender_id, conversation_id, deleted_at
        FROM messages WHERE message_id = :message_id
if msg is None: raise 404 "Message introuvable"
if msg.deleted_at is not None: return { success:True, already_deleted:True }
if msg.sender_id != :uid AND not is_admin: raise 403 "Non autorisé à supprimer ce message"

UPDATE messages SET deleted_at = NOW() WHERE message_id = :message_id

# Broadcast temps réel
chatRegistry.broadcast(msg.conversation_id, {
    "type": "message_deleted",
    "message_id": :message_id,
    "conversation_id": msg.conversation_id
})

return { success:True, deleted:True, message_id: :message_id }
```

### Réponse `200 OK`
```json
{ "success": true, "deleted": true, "message_id": "msg_..." }
```
ou (idempotent)
```json
{ "success": true, "already_deleted": true }
```

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant/invalide |
| 403 | Non-auteur ET non-admin → `{"detail":"Non autorisé à supprimer ce message"}` |
| 404 | `message_id` inexistant → `{"detail":"Message introuvable"}` |

### Effets de bord
1. UPDATE 1 ligne dans `messages` (`deleted_at` set).
2. **WebSocket broadcast** `chatRegistry.broadcast(conv_id, {type:"message_deleted", ...})` à tous les WS connectés sur `conv_id`.

---

## A.6. `PATCH /api/conversations/{conv_id}/leave` — Quitter une conversation

> **Fichier source** : `/app/backend/routes/deletion_routes.py:481–517`

### Permissions
- JWT requis.

### Comportement Python (à reproduire)
```pseudo
part = SELECT status FROM conversation_participants
                    WHERE conversation_id = :conv_id AND user_id = :uid
if part is None: raise 404 "Vous n'êtes pas participant de cette conversation"
if part.status == 'left': return { success:True, already_left:True }

UPDATE conversation_participants SET status='left'
 WHERE conversation_id = :conv_id AND user_id = :uid

remaining = SELECT COUNT(*) FROM conversation_participants
                    WHERE conversation_id = :conv_id AND status='active'
if remaining == 0:
    UPDATE conversations SET deleted_at = NOW()
     WHERE conversation_id = :conv_id AND deleted_at IS NULL

return { success:True, left:True, conversation_id: :conv_id }
```

### Réponse `200 OK`
```json
{ "success": true, "left": true, "conversation_id": "conv_..." }
```
ou (idempotent)
```json
{ "success": true, "already_left": true }
```

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant/invalide |
| 404 | Non-participant → `{"detail":"Vous n'êtes pas participant de cette conversation"}` |

### Effets de bord
1. UPDATE participant `status='left'`.
2. Si plus aucun `'active'` : UPDATE `conversations.deleted_at = NOW()`.
3. **Aucun broadcast WS** (aucun broadcast `conversation_archived` n'est émis côté Python). À NE PAS inventer.

---

# Partie B — WebSockets

> **Préambule commun aux 3 WS** :
> - Path préfixé `/api` (côté `api_router` de `server.py`).
> - **Frame Format** : JSON exclusivement.
> - **Handshake [SEC-14]** : le serveur `accept()` AVANT auth, puis attend dans 5 s un premier frame JSON `{"token": "..."}`. Sur timeout / parsing error / JWT invalide → `close(4001)`.
> - **Codes de close personnalisés** :
>   - `4001` = AUTH_FAIL (timeout handshake / token absent / JWT invalide / `user_id` manquant dans claims)
>   - `4003` = PERMISSION_DENIED (utilisateur non-membre actif de la conversation — WS chat uniquement)
>   - `4009` = MESSAGE_TOO_LARGE (>8 Ko — WS chat uniquement)
> - **Cleanup [SEC-16]** : `disconnect` du registry **garanti** dans un `finally`, indépendamment de l'exit (déconnexion propre, exception, anomalie).

---

## B.1. `WS /api/ws/chat/{conv_id}` — Conversation temps réel

### Handshake
1. Client ouvre `wss://<host>/api/ws/chat/{conv_id}` (sans token dans URL).
2. Serveur `accept()`.
3. Client envoie : `{"token": "<JWT>"}` dans 5 s.
4. Serveur `decode_jwt(token)` → extrait `user_id`.
5. Serveur vérifie `SELECT 1 FROM conversation_participants WHERE conversation_id=:conv_id AND user_id=:uid AND status='active'`.
6. Serveur charge `user_info = SELECT user_id, name, picture FROM users WHERE user_id=:uid`.
7. Serveur charge `_context_deleted = SELECT context_deleted FROM conversations WHERE conversation_id=:conv_id` (cache local pour la session).
8. Serveur enregistre la session dans `chatRegistry` (clé = `conv_id`).

### Échange en steady state

#### Frames CLIENT → SERVEUR
```json
{ "content": "Bonjour" }
```
- `content` : string, **trimmed côté serveur**. Si vide après trim → `continue` (ignoré silencieusement, pas de réponse, pas de close).

#### Validation côté serveur (sur chaque frame reçu)

**Étape A — context_deleted** : si `_context_deleted == True` → renvoie `{type:"error", code:"CONTEXT_DELETED", message:"Ce contexte a été supprimé. La conversation est en lecture seule."}` au sender uniquement (pas de broadcast). **Pas de close.** Continue d'écouter.

**Étape B — taille** : `len(content.encode("utf-8")) > 8192` → log warning, **`close(4009)`**, break.

**Étape C — fréquence** : si `time.monotonic() - _last_msg_time < 0.5` → `continue` (rejet **silencieux**, **pas de close**, pas de réponse).

**Étape D — INSERT + broadcast** :
```pseudo
msg_id = "msg_" + 12hex
ts     = NOW UTC

INSERT INTO messages (message_id, conversation_id, sender_id, content, created_at)
VALUES (msg_id, :conv_id, :user_id, content, ts)

UPDATE conversations SET last_message_at = ts WHERE conversation_id = :conv_id

chatRegistry.broadcast(:conv_id, {
    "message_id": msg_id,
    "conversation_id": :conv_id,
    "sender_id": :user_id,
    "sender_name": user_info.name,
    "sender_picture": user_info.picture,        // peut être null
    "content": content,
    "created_at": ts.toIso8601()
})

# Push unread_total à tous les autres participants ACTIFS
participants = SELECT user_id FROM conversation_participants
                  WHERE conversation_id = :conv_id
                    AND user_id != :user_id
                    AND status = 'active'
for p in participants:
    await _push_unread(p.user_id)            # = notifRegistry.notify(p.user_id, {type:"unread_total", count:N})

# Push notif fire-and-forget (NE bloque PAS la réponse)
for p in participants:
    asyncio.create_task(send_push_to_user(
        pool, p.user_id,
        title=user_info.name,
        body=content[:100],
        data={"type":"chat_message", "conversationId": :conv_id},
        store=False                             # ⚠️ NE PAS écrire dans la table notifications
    ))
```

#### Frames SERVEUR → CLIENT (broadcasts diffusés à tous les WS de la conv)

**Nouveau message** :
```json
{
  "message_id": "msg_xxx",
  "conversation_id": "conv_xxx",
  "sender_id": "u_xxx",
  "sender_name": "Alice",
  "sender_picture": "https://..." | null,
  "content": "Bonjour",
  "created_at": "2026-..."
}
```

**Message supprimé** (émis par `DELETE /api/messages/{id}` côté HTTP) :
```json
{
  "type": "message_deleted",
  "message_id": "msg_xxx",
  "conversation_id": "conv_xxx"
}
```

**Erreur context_deleted** (frame envoyée **uniquement** au sender qui tente d'écrire dans une conv read-only) :
```json
{
  "type": "error",
  "code": "CONTEXT_DELETED",
  "message": "Ce contexte a été supprimé. La conversation est en lecture seule."
}
```

### Codes de close
| Code | Cas |
|------|-----|
| `4001` | Timeout handshake (>5 s) / token absent / JWT invalide / `user_id` manquant |
| `4003` | Caller pas membre `status='active'` de `conv_id` |
| `4009` | Message > 8 Ko (UTF-8 bytes) |
| `1000` (close normal) | Disconnect propre côté client (`WebSocketDisconnect`) |

### Effets de bord par message envoyé
1. INSERT `messages` (1 ligne).
2. UPDATE `conversations.last_message_at` (1 ligne).
3. WS broadcast `chatRegistry.broadcast(conv_id, payload)` à toutes les sessions ouvertes sur la conv.
4. Pour chaque autre participant `active` : WS notification `notifRegistry.notify(user_id, {type:"unread_total", count:N})` (recalcul SQL).
5. Pour chaque autre participant `active` : push fire-and-forget `send_push_to_user` `store=False`.

---

## B.2. `WS /api/ws/notifications` — Canal personnel (lecture seule)

### Handshake
1. Client ouvre `wss://<host>/api/ws/notifications` (sans token dans URL).
2. Serveur `accept()`.
3. Client envoie `{"token": "<JWT>"}` dans 5 s.
4. Serveur `decode_jwt` → `user_id`.
5. **AUCUN check de membership** (le canal est filtré par `user_id` extrait du JWT).
6. Serveur enregistre la session dans `notifRegistry` (clé = `user_id`).
7. Serveur calcule `total = unread_total_messages` ET `notif_unread = unread_notifications_count`.
8. Serveur envoie immédiatement 2 frames :
   ```json
   {"type": "unread_total", "count": <total>}
   {"type": "unread_notif", "count": <notif_unread>}
   ```
9. Serveur entre en boucle `await websocket.receive_text()` (keep-alive — les frames du client sont **ignorées**, le canal est **lecture seule** côté server-to-client).

### Frames SERVEUR → CLIENT (broadcasts diffusés)

| Type | Payload | Émis depuis |
|------|---------|-------------|
| `unread_total` | `{"type":"unread_total", "count": <int>}` | Helper `_push_unread` (chat_routes.py l. 50–53) — appelé par `GET /messages`, `PUT /read`, `WS /ws/chat` (envoi message à autres) |
| `unread_notif` | `{"type":"unread_notif", "count": <int>}` | Slice S47 (`PATCH /notifications/{id}/read`, `PATCH /notifications/read-all`) + push_service.py:88 (slice push, hors scope) |
| `new_notification` | `{"type":"new_notification", "notification": <notification_payload>}` | push_service.py:87 (slice push, hors scope) |

### Codes de close
| Code | Cas |
|------|-----|
| `4001` | Timeout handshake / token absent / JWT invalide / `user_id` manquant |
| `1000` | Disconnect propre |

### Effets de bord
- À la connexion : 2 SELECT (`unread_total` + `unread_notif`) + 2 frames `send_json`.
- En steady state : aucun. Les frames sont émises par d'autres slices (chat envoi, notif read).

### Calcul `unread_total`
```sql
SELECT COUNT(*) FROM messages m
  JOIN conversation_participants cp
    ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
 WHERE m.created_at > cp.last_read_at
   AND m.sender_id != $1
```

### Calcul `unread_notif`
```sql
SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = FALSE
```

---

## B.3. `WS /api/ws/spot-you/{point_id}` — Mises à jour SpotYou (lecture seule)

### Handshake
1. Client ouvre `wss://<host>/api/ws/spot-you/{point_id}`.
2. Serveur `accept()`.
3. Client envoie `{"token": "<JWT>"}` dans 5 s.
4. Serveur `decode_jwt` → `user_id`.
5. **AUCUN check de membership** (canal de lecture publique — n'importe quel user authentifié peut écouter n'importe quel `point_id`).
6. Serveur enregistre dans `spotyouRegistry` (clé = `point_id`).
7. Serveur entre en `while True: await websocket.receive_text()` (keep-alive — frames client ignorées).

### Frames SERVEUR → CLIENT

```jsonc
{
  "type": "spotyou_update",
  "point_id": "tp_...",
  "participants_count": 12,        // optionnel selon callsite
  "going_count": 5,                 // optionnel
  "is_full": false,                 // optionnel
  "session_date": "2026-..." | null // optionnel
}
```

Émis depuis 4 callsites de `routes/spot_you_routes.py` (déjà migrés en slices SpotYou) :
- `POST /api/spot-you/{point_id}/join` (l. 181) → `participants_count`
- `DELETE /api/spot-you/{point_id}/leave` (l. 278) → `participants_count`, `going_count`, `is_full`
- `POST /api/spot-you/{point_id}/going` (l. 380) → `going_count`, `participants_count`, `is_full`, `session_date`
- `DELETE /api/spot-you/{point_id}/going` (l. 443) → `going_count`, `participants_count`, `is_full`, `session_date`

### Codes de close
| Code | Cas |
|------|-----|
| `4001` | Timeout handshake / token absent / JWT invalide / `user_id` manquant |
| `1000` | Disconnect propre |

### Effets de bord
- Aucun à la connexion (pas d'envoi initial, contrairement à `/ws/notifications`).
- En steady state : pure réception de broadcasts émis par les slices SpotYou.

---

# Partie C — Récapitulatif HTTP

| Endpoint | 200 | 400 | 401 | 403 | 404 | 422 |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|
| POST `/conversations` | ✅ | ✅ (type) | ✅ | ✅ (group seulement) | — | — |
| GET `/conversations` | ✅ | — | ✅ | — | — | — |
| GET `/conversations/{id}/messages` | ✅ | — | ✅ | ✅ (non-part) | — | ✅ (limit) |
| PUT `/conversations/{id}/read` | ✅ (silent si non-part) | — | ✅ | — | — | — |
| DELETE `/messages/{id}` | ✅ + idempotent | — | ✅ | ✅ | ✅ | — |
| PATCH `/conversations/{id}/leave` | ✅ + idempotent | — | ✅ | — | ✅ | — |

> ⚠️ Ordres de gardes critiques :
> - DELETE message : 404 (message inexistant) **AVANT** 200-already_deleted **AVANT** 403 (auteur).
> - PATCH leave : 404 (non-participant) **AVANT** 200-already_left.

---

# Partie D — Récapitulatif WebSocket

| Endpoint | Auth check | Membership check | Direction | Codes close |
|----------|:----------:|:----------------:|:---------:|:-----------:|
| `WS /ws/chat/{conv_id}` | ✅ JSON `{token}` 5s | ✅ `status='active'` | Bi-dir | 4001/4003/4009 |
| `WS /ws/notifications` | ✅ JSON `{token}` 5s | ❌ (filtre par user_id JWT) | Server→Client | 4001 |
| `WS /ws/spot-you/{point_id}` | ✅ JSON `{token}` 5s | ❌ (lecture publique) | Server→Client | 4001 |
