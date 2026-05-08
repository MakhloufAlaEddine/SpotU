# SLICE 48 — Business Rules (Chat & WebSockets)

> **Source** : `chat_routes.py:1–715`, `chat_manager.py:1–89`, `deletion_routes.py:436–517`
> Convention : `BR-48.NN` — règles à reproduire **iso Python** côté Java.

---

## §1. Création / accès aux conversations (POST /conversations)

### BR-48.01 — Validation du `type`
- L'unique whitelist est `{service, tagpoint_group, tagpoint_private}`.
- Toute autre valeur → 400 `{"detail":"Invalid conversation type"}`.

### BR-48.02 — Permission membership pour `tagpoint_group`
- Avant tout, vérifier que le caller est :
  - membre du SpotYou (`spot_you_members.spot_you_id = context_id AND user_id = caller`), **OU**
  - créateur du tag_point (`tag_points.point_id = context_id AND user_id = caller`)
- Si aucun des deux → 403 `{"detail":"Vous devez être membre de ce SpotYou pour accéder au groupe"}`.
- Pas de relaxation pour admin (l'admin n'a pas de bypass ici — iso Python).

### BR-48.03 — Pas de check membership pour `tagpoint_private` ni `service`
- Tout user authentifié peut OUVRIR ou rejoindre une conv `tagpoint_private` ou `service` pour n'importe quel `context_id` existant. La permission est gérée implicitement par l'unicité (1 conv par `(context_id, user)`).

### BR-48.04 — Idempotence par `(type, context_id, user)` pour private/service
- 1 conv `tagpoint_private` par `(context_id, current_user)` : si une conv existe déjà avec une participation du caller → la renvoyer telle quelle.
- 1 conv `service` par `(context_id, current_user)` : idem.
- L'uniqueness côté DB n'est PAS contrainte par index — c'est le code qui la garantit via le `SELECT … LIMIT 1`.

### BR-48.05 — Idempotence par `context_id` seul pour groups
- 1 conv `tagpoint_group` par `context_id` (pas par user) : tous les membres partagent la même conv.
- Si elle existe déjà → ré-active le caller en `status='active'` (`ON CONFLICT DO UPDATE`).
- Cela permet de **revivre une conv après leave** (status='left' → 'active').

### BR-48.06 — Title resolution
- Pour `service` : `SELECT title FROM services WHERE service_id = context_id` ; fallback `context_id` si introuvable.
- Pour `tagpoint_*` : `SELECT title FROM tag_points WHERE point_id = context_id` ; fallback `context_id`.
- Le `context_title` est figé à la création (jamais mis à jour ensuite). En lecture (GET /conversations), le COALESCE `tp.title / svc.title / c.context_title` permet de récupérer le title à jour.

### BR-48.07 — `created_by` pour groups vs private
- Pour `tagpoint_group` : `created_by = creator_id` (créateur du tag_point).
- Pour `tagpoint_private` : `created_by = uid` (le caller — pas le créateur du tag_point).
- Pour `service` : `created_by = uid` (le caller — pas le coach).
- À reproduire **iso** car la sémantique change (un private = "moi qui veux contacter le créateur", un group = "le SpotYou comme entité").

### BR-48.08 — Insertion participants : différence groups vs private/service
- Groups (l. 277–282) : INSERT explicite avec `status = 'active'` ON CONFLICT DO NOTHING.
- Private (l. 306–311) : INSERT **sans** `status` — utilise le DEFAULT `'active'` du DDL. Iso à préserver.
- Service (l. 335–340) : idem private.

> ⚠️ Sémantiquement équivalent (default = 'active'), mais Java DOIT NE PAS écrire `status` pour private/service afin de matcher exactement le SQL Python (utile pour comparer les query plans).

### BR-48.09 — Doublons dans `set([creator_id, uid])`
- Si `creator_id == uid` (le caller EST le coach/créateur), `set([creator_id, uid])` produit 1 seul élément → 1 INSERT. Iso.

---

## §2. Listing conversations (GET /conversations)

### BR-48.10 — Filtre `c.deleted_at IS NULL`
- Les conversations soft-deleted (PATCH /leave avec `remaining=0`) sont **invisibles** dans la liste.
- Pas de mode "archive" exposé en HTTP. Iso.

### BR-48.11 — Filtre par participant ANY status
- `JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id WHERE cp.user_id = uid`.
- Le user voit ses conversations même s'il a `status='blocked'` ou `status='left'` — Iso.
- L'enrichissement `is_blocked = (status == 'blocked')` permet au front de désactiver l'UI d'envoi.

### BR-48.12 — Tri stable
- `ORDER BY c.last_message_at DESC NULLS LAST` : les conversations sans message viennent à la fin (DEFAULT `last_message_at = NOW()` lors de la création — donc en pratique elles ont toutes une valeur).

### BR-48.13 — Détection dynamique `context_deleted` (3 niveaux)
1. Colonne authoritative `c.context_deleted = TRUE` ⇒ TRUE (set par les routes deletion lors d'un soft-delete service / tag_point / user).
2. Pour `tagpoint_*`, fallback dynamique : `tp` introuvable OR `tp.active = FALSE` OR `tp.deleted_at IS NOT NULL` ⇒ TRUE.
3. Pour `service`, fallback dynamique : `svc` introuvable OR `svc.active = FALSE` OR `svc.deleted_at IS NOT NULL` ⇒ TRUE.
4. Sinon FALSE.

> ⚠️ **Reproduire les 3 niveaux** : il existe en DB des conversations dont `c.context_deleted = FALSE` mais dont le tag_point/service est devenu inactif (anciens cas non backfillés). Le fallback dynamique gère cela.

### BR-48.14 — Enrichissement `last_message`
- 1 row par conversation (`DISTINCT ON (m.conversation_id)`).
- `content = '[Message supprimé]'` si `m.deleted_at IS NOT NULL`.
- `sender_name = COALESCE(u.name, 'Utilisateur supprimé')` pour gérer FK SET NULL.
- Le champ `conversation_id` du résultat est **retiré** par le code Python (`msg.pop("conversation_id", None)` l. 208) — iso Java.

### BR-48.15 — Enrichissement `unread_count`
- `WHERE m.created_at > cp.last_read_at AND m.sender_id != caller`.
- Inclut les messages dont le sender a été anonymisé (`sender_id IS NULL`) car `NULL != caller` est `NULL`/`UNKNOWN` dans `WHERE` (donc filtré, mais c'est conservatif). En pratique, les messages anonymisés sont rares.
- 0 si pas de match (`COUNT(*)` filtré).

### BR-48.16 — Enrichissement `is_blocked`
- `is_blocked = TRUE` si `cp.status = 'blocked'` pour le caller dans cette conv.
- `is_blocked = FALSE` sinon (incluant `status='left'`).

### BR-48.17 — Enrichissement `other_participant` (private/service uniquement)
- 1 ligne par conv non-group (le 1er user trouvé `!= caller`).
- Si plusieurs autres participants (cas anormal pour une private), **prendre le premier rencontré** (l. 215). Iso.

### BR-48.18 — Enrichissement `participant_count` + `context_image` (groups uniquement)
- `participant_count` = COUNT(*) **all status** (incluant `'left'` et `'blocked'`). Iso.
- `context_image` = `tag_points.images[0]` (premier élément du JSONB array) ou `null`.
- Le premier élément peut être un objet ou une string selon la version DDL ; côté Java, parser comme `JsonNode` puis `.get(0).asText(null)` ou similaire.

### BR-48.19 — Champ `other_participant: null` toujours présent pour groups
- Iso : le code Python set explicitement `c["other_participant"] = None` pour les groups (l. 218).
- Le front teste `if (conv.type === 'tagpoint_group') ... else other_participant.name`.

---

## §3. Lecture des messages (GET /conversations/{id}/messages)

### BR-48.20 — Permission "any status"
- `SELECT 1 FROM conversation_participants WHERE conversation_id=? AND user_id=?` (sans filtre status).
- Un user `'left'` ou `'blocked'` peut **continuer à lire l'historique**. Iso.
- Si non-participant → 403 `"Not a participant"`.

### BR-48.21 — Ordre chronologique ASC après LIMIT DESC
- SQL `ORDER BY m.created_at DESC LIMIT N` puis **`reverse()`** côté code → ASC chronologique.
- Le front affiche du plus ancien au plus récent dans la fenêtre récupérée.

### BR-48.22 — Pagination `before` (cursor implicite)
- `before` est un timestamp ISO 8601 (string).
- SQL : `m.created_at < $before::timestamptz`.
- Pas de support `after` (chargement uniquement ascendant dans le passé).
- Pas de header `X-Has-More` — le front teste `if results.length < limit then no_more`.

### BR-48.23 — Side-effect : mark-read au GET
- Toute lecture `GET /messages` met à jour `cp.last_read_at = NOW()` pour le caller.
- Cela peut RAZ le badge unread sans action explicite — comportement voulu (le simple fait d'afficher = lu).

### BR-48.24 — Side-effect : push unread_total
- Après mark-read, recalcule `unread_total` (toutes convs) et diffuse via `notifRegistry.notify(uid, {type:"unread_total", count:N})`.
- Le calcul est global (pas par conv) — iso `_get_unread_total`.

---

## §4. Mark-read explicite (PUT /conversations/{id}/read)

### BR-48.25 — Pas de validation participant
- L'UPDATE filtre `WHERE conversation_id=? AND user_id=?`. Si non-participant, 0 ligne updated.
- **AUCUN 403** retourné. Réponse 200 `{success:true}`.
- Le `_push_unread` est exécuté quand même.

### BR-48.26 — Idempotence
- Multiple appels = même résultat (`last_read_at` set à NOW à chaque fois, ce qui est sémantiquement idempotent même si pratiquement le timestamp change).

---

## §5. Soft-delete message (DELETE /messages/{id})

### BR-48.27 — Ordre des gardes
1. `SELECT message FROM messages WHERE message_id=?` → si `None` → 404 `"Message introuvable"`.
2. Si `deleted_at IS NOT NULL` → **200** `{success:True, already_deleted:True}` (idempotent **avant** le check ownership).
3. Si `sender_id != caller AND not is_admin` → 403 `"Non autorisé à supprimer ce message"`.
4. UPDATE + broadcast.

### BR-48.28 — Bypass admin
- `caller.role == 'admin'` → autorisé à supprimer n'importe quel message. Iso.

### BR-48.29 — Pas de check participation
- Un admin (ou l'auteur, qui est implicitement participant) peut supprimer. Aucune autre vérification.
- Edge case : si le sender a été retiré (`status='left'`) il peut quand même supprimer ses anciens messages. Iso.

### BR-48.30 — Broadcast `message_deleted`
- Émis APRÈS commit DB.
- Payload : `{type:"message_deleted", message_id, conversation_id}`.
- Diffusé à TOUTES les sessions WS de la conv (pas filtré par sender).

### BR-48.31 — Pas de hard-delete
- L'enregistrement `messages` reste en base avec `deleted_at` set. Le contenu est masqué uniquement au SELECT (CASE).
- Pas de purge automatique (pas de worker scheduled). Iso.

---

## §6. Quitter une conversation (PATCH /conversations/{id}/leave)

### BR-48.32 — Ordre des gardes
1. `SELECT status FROM conversation_participants WHERE conversation_id=? AND user_id=?` → si `None` → 404 `"Vous n'êtes pas participant de cette conversation"`.
2. Si `status == 'left'` → **200** `{success:True, already_left:True}` (idempotent).
3. UPDATE `status='left'`.
4. COUNT actifs → si 0 → UPDATE `conversations.deleted_at=NOW() WHERE deleted_at IS NULL`.

### BR-48.33 — Auto-archivage
- Une conv n'a plus aucun `'active'` → soft-delete. Devient invisible dans `GET /conversations` (filtre `c.deleted_at IS NULL`).
- Mais reste lisible via `GET /messages` si on connaît le `conv_id` (pas de filtre `deleted_at` sur cette route — testé).

### BR-48.34 — Pas de broadcast WS
- Aucun `chatRegistry.broadcast(conv_id, {type:"participant_left"})` ni `conversation_archived`. Iso (NE PAS inventer côté Java).

### BR-48.35 — Pas de bypass admin
- Un admin ne peut pas leave la conv d'un autre user (l'auth.uid filtre).

---

## §7. WebSocket — handshake commun

### BR-48.36 — Accept AVANT auth
- `await websocket.accept()` est exécuté **avant** la lecture du token. Iso.
- Cela permet d'envoyer les codes de close `4xxx` (impossible avant accept).

### BR-48.37 — Premier frame = JSON `{token}` dans 5 s
- Le serveur fait `await asyncio.wait_for(websocket.receive_json(), timeout=5.0)`.
- Le client DOIT envoyer le premier frame en JSON contenant la clé `token`.
- Si timeout → `close(4001)`.
- Si parsing JSON échoue (frame texte non-JSON, frame binaire) → `close(4001)` (try/except large).
- Si la clé `token` est absente → `decode_jwt("")` lève → `close(4001)`.

### BR-48.38 — `decode_jwt(token)` — pas de partage avec require_auth HTTP
- WS utilise `decode_jwt(token)` directement (pas `require_auth`).
- Différences :
  - WS ne vérifie pas que l'utilisateur existe en DB.
  - WS ne charge pas le profil complet (USER_FIELDS).
  - WS extrait juste `payload.user_id`.
- Si `decode_jwt` lève (`HTTPException 401`) → catché et `close(4001)`.

### BR-48.39 — `payload.user_id` obligatoire
- Si la claim `user_id` est absente du JWT → `close(4001)`. Iso.

### BR-48.40 — Codes de close exhaustifs
| Code | Sens | Slice 48 émet |
|------|------|--------------|
| `4001` | Authentication failure | Tous les WS |
| `4003` | Permission denied (not active member) | WS chat uniquement |
| `4009` | Message too large | WS chat uniquement |
| `1000` (close normal) | Disconnect propre | Tous (via `WebSocketDisconnect`) |

---

## §8. WS chat (`/api/ws/chat/{conv_id}`) — règles métier

### BR-48.41 — Vérification membre **ACTIF**
- `SELECT 1 FROM conversation_participants WHERE conversation_id=? AND user_id=? AND status='active'`.
- Status `'left'`, `'blocked'`, `'invited'` → **refusé** (`close(4003)`). Iso.

### BR-48.42 — Cache local `_context_deleted`
- Lu une seule fois au handshake.
- Si la conversation devient context_deleted PENDANT la session WS, la session **continue à autoriser** l'envoi (cache stale). Iso — limitation acceptée.
- Pour forcer la fermeture, le client devra reconnecter.

### BR-48.43 — Frame d'envoi : trim + skip vide
- `content = (data.get("content") or "").strip()`.
- Si vide après trim → `continue` (silent — ne renvoie rien, ne consomme pas le rate-limit).

### BR-48.44 — Bloquer l'envoi si context_deleted (sans close)
- Renvoie au sender uniquement : `{type:"error", code:"CONTEXT_DELETED", message:"..."}`.
- **Continue d'écouter**. Pas de close. Iso.

### BR-48.45 — Limite taille 8192 octets UTF-8
- `len(content.encode("utf-8")) > 8192` → log warn + `close(4009)` + `break`.
- Mesurer en **octets UTF-8**, pas en caractères. Java : `content.getBytes(StandardCharsets.UTF_8).length`.

### BR-48.46 — Anti-spam 500 ms par session
- `if time.monotonic() - _last_msg_time < 0.5: continue`.
- Rejet **silencieux** (pas de close, pas de réponse). Le sender peut retry après 500 ms.
- État `_last_msg_time` est local à la session WS (pas global).
- Le compteur est mis à jour SEULEMENT si le message passe → un message rejeté ne décale pas la fenêtre.

### BR-48.47 — Génération ID + INSERT atomique
- `msg_id = "msg_" + 12 hex` ; `ts = NOW UTC`.
- INSERT messages (5 colonnes) + UPDATE conversations.last_message_at — **2 statements DISTINCTS** (pas en transaction explicite côté Python). Iso (Java pourrait wrapper en `@Transactional` — recommandé pour atomicité).

### BR-48.48 — Broadcast à TOUTES les sessions de la conv (incluant le sender)
- `chatRegistry.broadcast(conv_id, payload)` envoie à toutes les sessions, y compris celle du sender.
- Le client doit dédupliquer côté UI (par `message_id`) si nécessaire.

### BR-48.49 — Payload broadcast (champs exacts)
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
> ⚠️ **PAS de champ `type`** dans ce payload (contrairement à `message_deleted`). Le front distingue par la **présence de `message_id` SANS `type`** vs `type:"message_deleted"`.

### BR-48.50 — Push `unread_total` aux autres participants ACTIFS
- Après broadcast, SELECT participants `status='active' AND user_id != sender`.
- Pour chacun : recalcule `unread_total` (SQL COUNT) + `notifRegistry.notify(p.user_id, {type:"unread_total", count:N})`.
- N peut différer entre participants (selon leur `last_read_at`).

### BR-48.51 — Push notification fire-and-forget
- `asyncio.create_task(send_push_to_user(...))` pour chaque autre participant `active`.
- Paramètres :
  - `title = sender_name`
  - `body = content[:100]` (truncation à 100 chars **caractères**, pas octets)
  - `data = {"type":"chat_message", "conversationId": conv_id}`
  - `store = False` ⇒ **NE crée PAS de row dans `notifications`**. Iso.
- Java : `CompletableFuture.runAsync(() -> pushService.sendToUser(...))` ou `@Async`.

### BR-48.52 — Cleanup garanti dans `finally`
- `finally: chatRegistry.disconnect(conv_id, ws)` — exécuté quel que soit l'exit (normal, exception, close).
- Si `disconnect` n'est PAS appelé, leak mémoire (la session reste référencée dans `manager.active`).

---

## §9. WS notifications (`/api/ws/notifications`)

### BR-48.53 — Pas de check membership / permission
- Tout user authentifié peut écouter ses propres notifs.
- Le filtrage est par `user_id` extrait du JWT (pas de room par user à hardcoder).

### BR-48.54 — Frames d'init
- À la connexion, envoyer immédiatement (dans cet ordre) :
  1. `{type:"unread_total", count: N_messages}`
  2. `{type:"unread_notif", count: N_notifs}`

### BR-48.55 — Boucle keep-alive `receive_text` (frames client ignorées)
- `while True: await websocket.receive_text()` — le payload du client est consommé mais ignoré.
- Le client peut envoyer des pings pour maintenir la connexion (notamment derrière un proxy avec timeout).

### BR-48.56 — Émissions externes possibles (référence — hors scope S48)
- D'autres slices émettent vers ce canal :
  - S47 (notifications inbox) : `{type:"unread_notif", count:N}` après mark-read.
  - Slice push (future) : `{type:"new_notification", notification:{...}}` après création d'une notif.
- S48 expose la **route consommatrice** + helper `_push_unread` qui émet `{type:"unread_total"}`. Le reste vient d'ailleurs.

---

## §10. WS spot-you (`/api/ws/spot-you/{point_id}`)

### BR-48.57 — Pas de check membership
- N'importe quel user authentifié peut écouter n'importe quel `point_id`. Iso (volontaire — c'est un canal de mises à jour publique).

### BR-48.58 — Pas d'envoi initial
- Contrairement à `/ws/notifications`, AUCUN frame n'est envoyé à la connexion. Le client doit avoir déjà obtenu l'état initial via HTTP (`GET /api/spot-you/{id}/detail` ou similaire).

### BR-48.59 — Boucle `receive_text` (frames client ignorées)
- `while True: await websocket.receive_text()` — keep-alive.

### BR-48.60 — Émissions externes (référence — hors scope S48)
- 4 callsites dans `routes/spot_you_routes.py` :
  - join (l. 181) : `{type:"spotyou_update", point_id, participants_count}`
  - leave (l. 278) : + `going_count, is_full`
  - going (l. 380) : + `going_count, participants_count, is_full, session_date`
  - not_going (l. 443) : idem going
- S48 expose la route consommatrice + façade publique `spotyouRegistry.broadcast(point_id, payload)` réutilisable par les slices SpotYou déjà migrées.

---

## §11. ConnectionManager (chat_manager.py)

### BR-48.61 — Process-local in-memory
- `Dict[str, List[WebSocket]]` non thread-safe → en Java, utiliser `ConcurrentHashMap<String, CopyOnWriteArrayList<WebSocketSession>>` ou un `Map` synchronisé.

### BR-48.62 — `add` n'accept PAS — l'accept est dans la route
- Convention : la route fait `ws.accept()` puis appelle `registry.add(key, ws)`. Le registry n'a aucune logique d'accept.
- Java : pareil (le `WebSocketHandler.afterConnectionEstablished` a déjà la session active).

### BR-48.63 — `disconnect` filtre par identité d'objet
- Implémentation Python : `[w for w in active[key] if w is not ws]` (`is not`, pas `!=`).
- Java : utiliser `removeIf(w -> w == ws)` (référence d'identité).
- Ne JAMAIS comparer les sessions par contenu (équivalent dans Spring `WebSocketSession.getId()`).

### BR-48.64 — `broadcast` / `notify` nettoient les sessions mortes silencieusement
- Implémentation Python : pour chaque `ws` dans la liste, `try: send_json(payload) except: dead.append(ws)` puis `disconnect(key, ws)` pour chaque dead.
- Logue WARN avec `conv_id` ou `user_id` + exception. Pas de levée vers l'appelant.
- Java : équivalent avec catch sur `IOException` ou `IllegalStateException` lors de `session.sendMessage(...)`.

### BR-48.65 — Pas de garantie de delivery
- Si une session est temporairement gelée (mais pas marquée morte), le `send_json` peut bloquer (ou succéder mais le client ne reçoit pas).
- Pas de retry, pas d'ack, pas de queue de messages persistante. Iso (le client doit re-fetcher l'état via HTTP en cas de doute).

### BR-48.66 — Pas de pub/sub multi-instance
- Si plusieurs nodes Java tournent en parallèle, un broadcast d'un node N1 ne sera PAS visible des sessions sur N2. Iso Python actuel (single-instance).
- Mitigation future : Redis pub/sub. Hors scope S48.

---

## §12. Helpers internes

### BR-48.67 — `_get_unread_notif(conn, user_id)` — utilisé par WS notifications init
```sql
SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = FALSE
```
- Retourne `int(row.cnt)` ou `0` si pas de row.

### BR-48.68 — `_get_unread_total(conn, user_id)` — utilisé partout
```sql
SELECT COUNT(*) FROM messages m
  JOIN conversation_participants cp
    ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
 WHERE m.created_at > cp.last_read_at AND m.sender_id != $1
```
- Pas de filtre `c.deleted_at IS NULL` — les messages des conversations soft-deleted comptent quand même. Iso (à conserver tel quel ; à noter comme anomalie potentielle pour une slice future).

### BR-48.69 — `_push_unread(conn, user_id)` — wrapper standardisé
- Recalcule `_get_unread_total` puis `notifRegistry.notify(user_id, {type:"unread_total", count:N})`.
- Appelé depuis 3 endroits : GET messages, PUT read, WS chat (envoi message à chaque autre participant actif).

### BR-48.70 — `_resolve_title(conn, conv_type, context_id)` — fallback chain
- Pour `service` : `services.title` ; sinon `context_id`.
- Pour autres : `tag_points.title` ; sinon `context_id`.

---

## §13. Sécurité (récapitulatif)

| Préoccupation | Implementation |
|---------------|----------------|
| Token jamais dans l'URL | Premier frame JSON `{token}` après accept (BR-48.37) |
| Auth obligatoire sur tous les WS | `decode_jwt` + close 4001 sinon (BR-48.38) |
| Permission strict sur WS chat | `status='active'` + close 4003 (BR-48.41) |
| Anti-spam | 500 ms / msg + close 4009 si > 8 KB (BR-48.45, BR-48.46) |
| Cleanup ressource | `disconnect` dans `finally` (BR-48.52) |
| Anonymisation RGPD | FK SET NULL + COALESCE name 'Utilisateur supprimé' (BR-48.14) |
| Pas de fuite d'info | 403 pour non-participant (GET messages) ; **PAS** 404 (BR-48.20) ; les autres routes silent (PUT read) |

---

## §14. Limites connues / dette technique acceptée

1. **Cache `_context_deleted` stale** (BR-48.42) : si le contexte devient deleted pendant la session WS, l'envoi reste autorisé jusqu'au reconnect. À documenter pour QA.
2. **`_get_unread_total` inclut messages des convs soft-deleted** (BR-48.68) : anomalie mineure. À fixer dans une slice future si l'UX en pâtit.
3. **Pas de pagination GET conversations** : risque pour utilisateurs très actifs (>100 convs). Slice perf future.
4. **Pas de retry / ack côté WS broadcast** (BR-48.65) : les messages "perdus" en transit ne sont pas redelivrés. Le client doit re-fetcher.
5. **Pas de pub/sub multi-instance** (BR-48.66) : limitation infra à documenter pour le déploiement Java prod.
6. **Process-local registry** : si Java crash → toutes les sessions sont fermées brutalement (RST). Le client doit gérer un retry exponentiel.
