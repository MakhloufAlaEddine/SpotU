# SLICE 48 — Chat & WebSockets (REST + temps réel)

> **Statut** : À implémenter en Java/Spring Boot
> **Source unique de vérité** :
> - `/app/backend/routes/chat_routes.py` (715 lignes — intégralité)
> - `/app/backend/chat_manager.py` (89 lignes — intégralité)
> - `/app/backend/routes/deletion_routes.py` l. 434–517 (DELETE message + PATCH leave conv)
> - `/app/backend/migrations/001_initial_schema.sql` (tables `conversations`, `conversation_participants`, `messages`)
> - `/app/backend/migrations/008_soft_delete_columns.sql` (colonnes `deleted_at` + `context_deleted`)
> - `/app/backend/migrations/010_fk_set_null_anonymization.sql` (FK `messages.sender_id ON DELETE SET NULL`)
> - `/app/backend/server.py` l. 93, 103, 112 (montage routers, prefix `/api`)
> - `/app/backend/auth_utils.py` l. 41–58 (`decode_jwt`)
> - `/app/backend/push_service.py` l. 80–95 (`send_push_to_user` invocation)
> **Domaine** : Chat (REST conversations/messages + WebSockets temps réel)
> **Précédentes slices** : S1 (auth JWT), S23 (`require_auth`), S29 (soft-delete SpotYou), S40 (soft-delete produits), S42–S46 (Services Coach), S47 (Notifications inbox HTTP)

---

## 1. Constat factuel

Le backend Python expose **6 endpoints HTTP** + **3 endpoints WebSocket** pour le domaine Chat.

### 1.1. HTTP — `chat_routes.py`

| # | Méthode | Path | Handler | Lignes |
|---|---------|------|---------|--------|
| 1 | `POST`  | `/api/conversations` | `create_or_get_conversation` | 227–346 |
| 2 | `GET`   | `/api/conversations` | `list_conversations` | 349–386 |
| 3 | `GET`   | `/api/conversations/{conv_id}/messages` | `get_messages` | 389–435 |
| 4 | `PUT`   | `/api/conversations/{conv_id}/read` | `mark_read` | 438–448 |

### 1.2. HTTP — `deletion_routes.py` (rattachés au domaine Chat)

| # | Méthode | Path | Handler | Lignes |
|---|---------|------|---------|--------|
| 5 | `DELETE` | `/api/messages/{message_id}` | `delete_message` (soft-delete) | 436–476 |
| 6 | `PATCH`  | `/api/conversations/{conv_id}/leave` | `leave_conversation` | 481–517 |

### 1.3. WebSocket — `chat_routes.py`

| # | Path | Handler | Lignes | Direction |
|---|------|---------|--------|-----------|
| 7 | `/api/ws/chat/{conv_id}` | `ws_chat` | 459–601 | Bi-directionnel (envoi messages + réception broadcasts) |
| 8 | `/api/ws/notifications` | `ws_notifications` | 606–660 | Lecture seule serveur → client (compteurs + nouvelles notifs) |
| 9 | `/api/ws/spot-you/{point_id}` | `ws_spot_you` | 666–714 | Lecture seule serveur → client (mises à jour participants/going/is_full) |

> ⚠️ **Tous les chemins WS sont sous le même prefix `/api`** que le HTTP (`api_router = APIRouter(prefix="/api")` dans `server.py:93`). Le router chat n'a **pas de sous-prefix** (`include_router(chat_router, tags=["chat"])` — `server.py:103`). Les chemins absolus côté client sont donc :
> - `wss://<host>/api/ws/chat/{conv_id}`
> - `wss://<host>/api/ws/notifications`
> - `wss://<host>/api/ws/spot-you/{point_id}`

---

## 2. Endpoints choisis pour S48

✅ Les **6 endpoints HTTP** ci-dessus.
✅ Les **3 endpoints WebSocket** ci-dessus.
✅ Le **process-local connection registry** `chat_manager.py` (les 3 instances `manager` / `notif_manager` / `spotyou_manager`).

> Cette slice ferme **intégralement** le domaine Chat / WebSockets. Aucun découpage interne (ce serait inutile : les 3 WS partagent le même fichier `chat_manager.py` et les 6 HTTP partagent les mêmes 3 tables et invariants `unread_count` / `last_read_at` / `context_deleted`). Découper séparerait artificiellement un bloc déjà cohérent.

---

## 3. Endpoints **EXCLUS** de S48

| Endpoint / Module | Slice cible / N/A | Justification |
|-------------------|-------------------|---------------|
| `POST /api/push-token`, `DELETE /api/push-token` | Slice « Push tokens » dédiée | Gestion des tokens FCM/APNS, indépendante du WS in-app. |
| `send_push_to_user` (intégralité du module `push_service.py`) | Slice « Push notifications » | Invoqué depuis S48 (nouveau message → push), mais sa logique d'expédition (FCM, retries, dedup) reste hors scope. **À stub** côté Java pendant S48 (no-op safe). |
| `notif_manager.notify(user_id, {type:"new_notification"|"unread_notif"})` côté **producteurs** | S47 (notifs inbox) + diverses slices futures (workers webhooks etc.) | S48 n'expose que la **route consommatrice** (`WS /api/ws/notifications`). Les producteurs sont déjà documentés/stubés en S47. |
| `spotyou_manager.broadcast` côté **producteurs** (rejoindre/going/...) | Slices SpotYou (S5/S6/S28) déjà migrées | S48 n'expose que la **route consommatrice** (`WS /api/ws/spot-you/{point_id}`). Les broadcasts (4 callsites dans `spot_you_routes.py`) sont émis depuis des slices déjà migrées — **les writes ont juste à appeler `spotyouManager.broadcast(...)` côté Java en plus de leur logique** (cf. §6 Dépendances). |
| `manager.broadcast` côté **producteur** depuis `delete_message` (`deletion_routes.py:469–474`) | **Inclus dans S48** | Le DELETE message HTTP fait partie de S48 (endpoint #5). Le broadcast `{type:"message_deleted"}` est inclus de fait. |
| Suppression hard d'une conversation | **N/A** | N'existe pas en Python (uniquement `leave` qui auto-archive si plus aucun actif). |
| Édition d'un message (`PUT /messages/{id}`) | **N/A** | N'existe pas en Python. |
| Réactions sur messages | **N/A** | N'existe pas en Python. |
| Pièces jointes (`media`) dans messages | **N/A** | N'existe pas en Python. La table `messages` ne contient que `content text NOT NULL`. |
| Indicateurs de présence / typing | **N/A** | **AUCUNE** logique de présence ou de typing dans le code. Les WS chat ne gèrent que `{content: "..."}` à l'aller et `{message_id, sender_id, content, ...}` au retour. À ne PAS inventer côté Java. |
| Lecture par autre user (read receipts par message) | **N/A** | Le modèle de lecture est **par conversation** (`conversation_participants.last_read_at`), pas par message individuel. Aucun champ `delivered_at` ou `read_by`. |
| WS dédié SpotYou (`/api/ws/spot-you/{point_id}`) côté **émission de messages chat** | **Hors scope WS spotyou** | Ce WS est en lecture seule (`while True: await websocket.receive_text()` ignore le payload — keep-alive uniquement). Aucun message chat ne transite par ce canal. |

---

## 4. Fichiers Python concernés

| Fichier | Lignes | Rôle |
|---------|--------|------|
| `/app/backend/routes/chat_routes.py` | 1–715 | Tout le domaine HTTP + WS chat + WS notifications + WS spot-you |
| `/app/backend/chat_manager.py` | 1–89 | Process-local connection registry (3 managers in-memory) |
| `/app/backend/routes/deletion_routes.py` | 434–476 | `DELETE /messages/{id}` (soft-delete + broadcast `message_deleted`) |
| `/app/backend/routes/deletion_routes.py` | 481–517 | `PATCH /conversations/{id}/leave` (status participant → `left` + auto-archive) |
| `/app/backend/server.py` | 93, 103, 112 | Montage routers (prefix `/api`, chat_router sans sous-prefix, deletion_router sans sous-prefix) |
| `/app/backend/auth_utils.py` | 41–58 | `decode_jwt` — utilisé par les 3 WS |
| `/app/backend/migrations/001_initial_schema.sql` | 69–92, 175–184 | DDL `conversation_participants`, `conversations`, `messages` |
| `/app/backend/migrations/001_initial_schema.sql` | 612–622, 636–640, 893–918, 1113–1147 | PK / FK / index |
| `/app/backend/migrations/008_soft_delete_columns.sql` | 22–34 | Colonnes `deleted_at` + `context_deleted` + index partiels |
| `/app/backend/migrations/010_fk_set_null_anonymization.sql` | 10–13 | FK `messages.sender_id ON DELETE SET NULL` |
| `/app/backend/push_service.py` | 80–95 | Référence — appelé depuis `ws_chat` lignes 587–593 (fire-and-forget) |

> **Aucune modification** ne doit être apportée à ces fichiers — strict mode documentation-only.

---

## 5. Auth & Permissions

### 5.1. HTTP

| Action | Auth | Permission supplémentaire |
|--------|------|---------------------------|
| POST `/conversations` (`tagpoint_group`) | JWT requis | Doit être **membre** du SpotYou OU créateur du tag_point — sinon 403 (l. 241–248) |
| POST `/conversations` (`tagpoint_private`) | JWT requis | Aucune — ouverte à tout user authentifié pour le tag_point cible |
| POST `/conversations` (`service`) | JWT requis | Aucune — ouverte à tout user authentifié pour le service cible |
| GET `/conversations` | JWT requis | Liste filtrée par `cp.user_id = JWT.user_id` |
| GET `/conversations/{id}/messages` | JWT requis | Doit être **participant** (`conversation_participants` avec n'importe quel `status`) — sinon 403 (l. 395–400) |
| PUT `/conversations/{id}/read` | JWT requis | Aucun check explicite — UPDATE filtre `WHERE conversation_id=? AND user_id=?` (silent si non-participant) |
| DELETE `/messages/{id}` | JWT requis | **Auteur OU admin** (l. 459–460) — sinon 403 |
| PATCH `/conversations/{id}/leave` | JWT requis | Doit être participant — sinon 404 (l. 496–497) |

### 5.2. WebSocket

| Endpoint | Auth | Vérification membre |
|----------|------|---------------------|
| `WS /ws/chat/{conv_id}` | **Premier message JSON `{token}`** dans 5 s sinon close `4001` | OUI — `conversation_participants` avec `status='active'` (l. 499–507). Sinon close `4003`. |
| `WS /ws/notifications` | **Premier message JSON `{token}`** dans 5 s sinon close `4001` | NON — tout user authentifié peut écouter ses propres notifs (filtrage par `user_id` côté serveur uniquement). |
| `WS /ws/spot-you/{point_id}` | **Premier message JSON `{token}`** dans 5 s sinon close `4001` | **NON** — n'importe quel user authentifié peut écouter les broadcasts de n'importe quel `point_id` (canal de lecture publique). À reproduire **strictement**. |

> ⚠️ **[SEC-14] strict** : le token transite **JAMAIS** dans l'URL. Toujours `accept()` AVANT auth, puis `receive_json()` avec timeout 5 s, puis `decode_jwt()`. Tout échec ⇒ `close(4001)`.

---

## 6. Dépendances

### 6.1. Côté Java (déjà en place)
- Middleware JWT HTTP (S1+) avec `winek_token` cookie ou `Authorization: Bearer` (auth_utils.py:61–65).
- Méthode `decodeJwt(token) -> Claims` réutilisable depuis WS (NE PAS dupliquer la signature JWT).
- Pool PostgreSQL (asyncpg → HikariCP / R2DBC selon stack Java retenue).
- Repositories ou JdbcTemplate pour `tag_points`, `services`, `users`, `spot_you_members`.

### 6.2. À introduire en S48
- **Process-local registry WS** (équivalent `ConnectionManager`) — `Map<String, List<WebSocketSession>>` thread-safe. **Pas de Redis pub/sub** côté Python, donc **pas en S48** non plus (multi-instance support = slice future si scale-out — voir §11 « Limitations connues »).
- **Spring WebSocket** ou **JSR-356** (`@ServerEndpoint`) — au choix de Cursor. Préférer Spring `@MessageMapping` + `WebSocketHandler` low-level (le protocole STOMP haut niveau **ne convient pas** car Python utilise des frames JSON brutes avec un handshake custom).
- **Push fire-and-forget** : déléguer à un service `PushService.sendToUser(userId, ...)` stub no-op pendant S48 (la vraie slice push est dédiée).

### 6.3. Référence (ne pas implémenter en S48)
- `notif_manager.notify(user_id, payload)` est invoqué depuis :
  - `routes/chat_routes.py:53` (helper `_push_unread` — **EN scope S48**)
  - `routes/tagpoint_routes.py:1409, 1424` (S47 — déjà documentée)
  - `push_service.py:87–88` (slice push — hors scope)
- `spotyou_manager.broadcast(point_id, payload)` est invoqué depuis :
  - `routes/spot_you_routes.py:181, 278, 380, 443` (4 callsites — slices SpotYou déjà migrées)
- `manager.broadcast(conv_id, payload)` est invoqué depuis :
  - `routes/chat_routes.py:567` (envoi message dans WS chat — **EN scope S48**)
  - `routes/deletion_routes.py:470` (DELETE message — **EN scope S48**)
- **Action côté Cursor** : exposer 3 façades publiques `chatRegistry.broadcast(convId, payload)`, `notifRegistry.notify(userId, payload)`, `spotyouRegistry.broadcast(pointId, payload)` — utilisables par les autres slices déjà mergées sans coupling.

---

## 7. Niveau de risque

🟠 **MOYEN-ÉLEVÉ**

| Risque | Impact |
|--------|--------|
| 🔴 WebSocket protocol custom (handshake JSON `{token}` en premier frame) | Spring/JSR-356 par défaut attendent l'auth dans le handshake HTTP UPGRADE — il faut **désactiver** ce comportement et accepter avant auth. Critère de Done #6. |
| 🔴 Codes de close personnalisés (`4001` auth, `4003` permission, `4009` rate-limit) | Java DOIT envoyer ces codes exacts — le front les utilise pour distinguer les erreurs. |
| 🟠 Process-local registry sans Redis | Le déploiement Java multi-instance NE diffusera PAS les broadcasts entre nœuds. **Iso Python actuel.** À documenter comme « Limitation connue » (§11). |
| 🟠 Anti-spam 1 msg / 500 ms par session | État `_last_msg_time` à conserver **par session WS**, pas global. Implémentation dans le handler. |
| 🟠 Limite 8 Ko / message → close `4009` | DOIT mesurer `content.getBytes(UTF_8).length`, **pas** `content.length()` (caractères). |
| 🟠 Anti-N+1 : enrichissement batch des conversations | 5 requêtes parallèles `asyncio.gather` → `CompletableFuture.allOf` ou 5 connexions parallèles HikariCP. **Critique pour la perf** (sans batch : 4 queries × N convs ≈ 849ms/conv documenté en commentaire l. 73). |
| 🟠 `last_message` enrichi : `CASE WHEN deleted_at IS NOT NULL THEN '[Message supprimé]'` | Reproduire **strictement** ce remplacement côté lecture. |
| 🟠 Soft-delete contexte (service / tag_point) → `context_deleted=TRUE` → conversation read-only | Le WS chat **bloque l'envoi** mais ne ferme pas la connexion. `error` JSON `{code:"CONTEXT_DELETED"}` envoyé au client. |
| 🟠 `unread_count` SQL : `WHERE m.created_at > cp.last_read_at AND m.sender_id != $1` | Conditions cumulatives strictes. Reproduire **exactement**. |
| 🟢 FK `messages.sender_id ON DELETE SET NULL` | Anonymisation RGPD : `sender_name` doit fallback `'Utilisateur supprimé'` (l. 102, 407, 419). |
| 🟢 Idempotence `POST /conversations` | Renvoie l'existante si déjà créée pour le tuple `(type, context_id, user)`. À reproduire. |
| 🟢 Idempotence `PATCH /leave` (déjà parti → 200 `{already_left:true}`) | Pattern 200 silent (pas 409). |

---

## 8. Justification du choix

1. **Bloc le plus utile au front non encore migré** : l'écran « Chat » est un onglet principal du navigateur d'app. Toute la logique conversation (Services / SpotYou groupes / SpotYou private) en dépend. Sans S48, le front reste captif Python pour cet onglet.
2. **Ferme la couverture des notifications** : la cloche notif (S47) ne se met à jour en temps réel que via `WS /api/ws/notifications`. Sans S48, S47 fonctionne mais l'UX est dégradée (refresh manuel).
3. **Ferme la couverture SpotYou** : les compteurs `participants_count` / `going_count` / `is_full` ne se mettent à jour en temps réel que via `WS /api/ws/spot-you/{point_id}`. Sans S48, les écrans SpotYou détail nécessitent du polling (HTTP fallback).
4. **Bloc cohérent indivisible** : les 3 WS partagent `chat_manager.py`. Découper (par ex. WS chat seul, WS notif plus tard) introduirait de la dette : l'instance `notif_manager.notify` est appelée depuis `chat_routes._push_unread` (ligne 53). Migrer le WS chat sans le WS notif laisserait des notifs unread non diffusées.
5. **Ferme entièrement le domaine** : 6 HTTP + 3 WS + 1 manager. Aucun reliquat. Tout ce qui reste (push tokens, push expedition FCM/APNS, agenda) est hors domaine Chat strict.

---

## 9. Critères de Done

- [ ] `POST /api/conversations` retourne la conv (créée ou existante) avec les 7 colonnes `conversation_id, type, context_id, context_title, created_by, last_message_at, created_at`. Idempotence par `(type, context_id, user)` validée pour les 3 types.
- [ ] Type `tagpoint_group` rejette 403 si user n'est ni membre `spot_you_members` ni créateur `tag_points` (l. 241–248).
- [ ] Type `tagpoint_group` ré-active un participant `status='blocked'` en `'active'` (`ON CONFLICT DO UPDATE`).
- [ ] `GET /api/conversations` retourne le tableau enrichi (`last_message`, `unread_count`, `is_blocked`, `other_participant`/`participant_count`+`context_image`, `context_deleted`) ordonné `last_message_at DESC NULLS LAST`.
- [ ] Enrichissement BATCH (5 requêtes parallèles) pour éviter N+1.
- [ ] `GET /api/conversations/{id}/messages` retourne les messages **chronologiques** (`reverse()` après LIMIT DESC), avec `sender_name='Utilisateur supprimé'` fallback et `content='[Message supprimé]'` si `deleted_at NOT NULL`. Met à jour `last_read_at=NOW()` + diffuse `unread_total` via `notifRegistry.notify`.
- [ ] Pagination `before` (timestamp ISO) et `limit` (1..100, default 50) supportés.
- [ ] `PUT /api/conversations/{id}/read` : UPDATE `last_read_at=NOW()` + diffusion `unread_total`.
- [ ] `DELETE /api/messages/{id}` : auteur OR admin → soft-delete + broadcast `{type:"message_deleted", message_id, conversation_id}` à tous les WS de la conv. Idempotent (200 `{already_deleted:true}` si déjà supprimé).
- [ ] `PATCH /api/conversations/{id}/leave` : status → `'left'`. Si plus aucun `'active'` → conv `deleted_at=NOW()`. Idempotent.
- [ ] `WS /api/ws/chat/{conv_id}` : handshake JSON `{token}` dans 5 s ; close `4001` si timeout ou JWT invalide ; close `4003` si non-participant `'active'`.
- [ ] `WS /api/ws/chat` : anti-spam 1 msg/500 ms (rejet **silencieux** = `continue`, pas close), max 8 Ko (close `4009`).
- [ ] `WS /api/ws/chat` : si `context_deleted=TRUE` → renvoie `{type:"error", code:"CONTEXT_DELETED"}` et **continue d'écouter** (pas close).
- [ ] `WS /api/ws/chat` : INSERT message + UPDATE `conversations.last_message_at` + broadcast à tous les WS de la conv + push `unread_total` aux autres participants `'active'` + push notif fire-and-forget `data.type="chat_message"` `store=False`.
- [ ] `WS /api/ws/notifications` : handshake JSON `{token}` ; envoie immédiatement `{type:"unread_total", count}` + `{type:"unread_notif", count}` à la connexion ; reste en `receive_text()` (keep-alive).
- [ ] `WS /api/ws/spot-you/{point_id}` : handshake JSON `{token}` ; AUCUNE vérification de membership (lecture publique) ; reste en `receive_text()` (keep-alive).
- [ ] Cleanup garanti : `disconnect` dans `finally` pour les 3 WS (pas de leak après `WebSocketDisconnect` ou autre exception).
- [ ] Façades `chatRegistry.broadcast / notifRegistry.notify / spotyouRegistry.broadcast` exposées publiquement pour les autres slices.
- [ ] Tests d'intégration TC-S48-* tous verts (cf. `SLICE_48_TEST_CASES.md`).
- [ ] Aucun nouvel endpoint ou comportement inventé.

---

## 10. Résumé ultra court (obligatoire)

| Item | Valeur |
|------|--------|
| **Endpoints REST choisis** | `POST /api/conversations`, `GET /api/conversations`, `GET /api/conversations/{id}/messages`, `PUT /api/conversations/{id}/read`, `DELETE /api/messages/{id}`, `PATCH /api/conversations/{id}/leave` |
| **Endpoints WebSocket choisis** | `WS /api/ws/chat/{conv_id}`, `WS /api/ws/notifications`, `WS /api/ws/spot-you/{point_id}` |
| **Tables touchées** | `conversations` (R/W), `conversation_participants` (R/W), `messages` (R/W). Lectures jointes : `tag_points`, `services`, `users`, `spot_you_members`, `notifications`. |
| **Top 3 pièges** | (1) **Handshake WS custom** : `accept()` AVANT auth, premier frame JSON `{token}` dans 5 s sinon close `4001`. Spring/JSR-356 par défaut authentifient au handshake HTTP — désactiver. (2) **Anti-N+1 enrichissement** : 5 queries parallèles BATCH `asyncio.gather` → 5 `CompletableFuture` (sinon perf catastrophique, 849 ms/conv documenté en commentaire). (3) **Codes de close exacts** `4001`/`4003`/`4009` + **anti-spam silencieux** (rejet par `continue`, pas close, pour fréquence ; close `4009` uniquement pour taille). |
| **Raison du choix** | Domaine Chat = dernier gros bloc front non migré (onglet principal). 3 WS partagent le même `chat_manager.py` → indivisible sans dette. Ferme la couverture S47 (notifs) et SpotYou (compteurs temps réel) du même coup. 6 HTTP + 3 WS + 1 manager = bloc cohérent fermé en une slice. |

---

## 11. Limitations connues (à documenter pour Cursor)

1. **Process-local registry** : si l'app Java est déployée en multi-instance (≥2 nodes) sans Redis pub/sub, les broadcasts ne traverseront pas les nœuds. **Iso Python actuel** (Python tourne en single-instance). Mitigation future : Redis pub/sub ou Spring's `RelayMessageBrokerRegistration`. **Pas en S48.**
2. **Pas de retry automatique côté serveur** : si une `send_json` échoue, la connexion est marquée morte et nettoyée (`chat_manager.broadcast` lignes 38–48). Le client doit gérer la reconnexion (retry exponentiel côté front).
3. **Pas de pagination ni archivage** sur `conversations` : le `GET /conversations` retourne **toutes** les conversations actives de l'utilisateur, sans `LIMIT`. Pour des users très actifs, à surveiller (slice perf future si besoin).
4. **`store_notification` = False pour les messages chat** (l. 592) : les nouveaux messages chat n'apparaissent **PAS** dans la table `notifications`. Ils déclenchent uniquement un push transient. Iso Python.
5. **WS spot-you ouvert à tout authentifié** (pas de check membership) : choix volontaire — à reproduire strictement.
