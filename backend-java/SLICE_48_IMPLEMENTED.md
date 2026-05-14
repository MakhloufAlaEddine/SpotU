# Slice 48 — Chat & WebSockets

## Statut
Implémentée côté Java/Spring Boot avec :

- REST :
  - `POST /api/conversations`
  - `GET /api/conversations`
  - `GET /api/conversations/{id}/messages`
  - `PUT /api/conversations/{id}/read`
  - `DELETE /api/messages/{id}`
  - `PATCH /api/conversations/{id}/leave`
- WebSocket :
  - `WS /api/ws/chat/{conv_id}`
  - `WS /api/ws/notifications`
  - `WS /api/ws/spot-you/{point_id}`

## Implémentation

### REST chat

- Nouveau module `com.spotu.modules.chat` :
  - `ChatController`
  - `ChatService`
  - `ChatRepository`
- Reproduction des règles Python :
  - création/idempotence des conversations par type (`service`, `tagpoint_group`, `tagpoint_private`)
  - permission stricte `tagpoint_group` (membre SpotYou ou créateur)
  - enrichissement batch anti-N+1 pour `GET /conversations`
  - `GET /messages` en ordre chronologique (DESC SQL puis reverse) + mark-read side effect
  - `PUT /read` silent (200 même non participant)
  - `DELETE /messages/{id}` : ordre des gardes 404 -> already_deleted -> 403
  - `PATCH /leave` : 404 non participant, idempotence `already_left`, archivage si plus aucun `active`

### WebSockets

- Nouveau registre central équivalent `chat_manager.py` :
  - `WsConnectionRegistry`
  - 3 beans distincts : `chatRegistry`, `notifRegistry`, `spotyouRegistry`
- Handshake custom (protocole Python) implémenté :
  - connexion acceptée d’abord
  - auth via premier frame JSON `{ "token": "..." }`
  - timeout 5s => close `4001`
- `WS /chat/{conv_id}` :
  - check participant `status='active'` => sinon close `4003`
  - limite > 8KB UTF-8 => close `4009`
  - anti-spam 500ms silent skip
  - blocage read-only `context_deleted` avec frame d’erreur dédiée
  - insert message + update `last_message_at`
  - broadcast message à toutes les sessions de la conv
  - push `unread_total` aux autres participants actifs
- `WS /notifications` :
  - envoi initial `{type:"unread_total"}` puis `{type:"unread_notif"}`
  - keep-alive (frames client ignorées)
- `WS /spot-you/{point_id}` :
  - auth uniquement, pas de check membership
  - keep-alive (frames client ignorées)

### Pont SpotYou temps réel

- Ajout `SpotYouWsBridge` et branchage dans `SpotYouMembershipService` pour diffuser `spotyou_update` sur join/leave (participants_count).

## Schéma / migrations

- `V12__chat_conversations_messages.sql` ajouté :
  - création/extension `conversations`
  - création `conversation_participants`
  - création `messages`
  - index chat nécessaires
- `test-schema-users.sql` aligné avec les tables/colonnes chat.

## Dépendances

- `spring-boot-starter-websocket` ajouté dans `pom.xml`.

## Tables touchées

- `conversations` (R/W)
- `conversation_participants` (R/W)
- `messages` (R/W)
- lectures jointes : `users`, `services`, `tag_points`, `spot_you_members`, `notifications`

## Tests

Ajouts :

- `ChatIntegrationTest` (REST)
- `ChatWebSocketIntegrationTest` (WS handshake + close codes)

Exécution validée :

- `mvn -Dtest=ChatIntegrationTest,ChatWebSocketIntegrationTest test` ✅
- `mvn -Dtest=ServicesIntegrationTest,NotificationsIntegrationTest,ChatIntegrationTest,ChatWebSocketIntegrationTest test` ✅

Résultat :

- 43 tests passés, 0 échec.

## Écarts/restes

- `send_push_to_user(..., store=false)` est implémenté via `ChatPushService` stub no-op (comportement fire-and-forget conservé, sans inventer la slice Push).
- Le registre WS reste process-local (comme Python) ; pas de pub/sub multi-instance ajouté dans S48.
