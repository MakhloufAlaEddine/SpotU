# Slice 47 — Notifications inbox

## Statut
Implémentée côté Java avec les 3 endpoints Python:

- `GET /api/users/me/notifications`
- `PATCH /api/users/me/notifications/{notif_id}/read`
- `PATCH /api/users/me/notifications/read-all`

## Implémentation

- `NotificationsController` :
  - parse/validation `limit` (`default=50`, range `1..200`, sinon `422`)
  - auth obligatoire via `AuthMeService.requireCurrentUser`
- `NotificationsService` :
  - listing trié `created_at DESC` et limité
  - parsing `data` robuste (`null`/string JSON/string invalide/map => objet)
  - override `data.sender_picture` via photo actuelle du sender (si non null)
  - `mark read` silent owner-filter + recompute unread
  - `mark all` retourne seulement `{success:true}`
  - appel WS via `NotifBroadcaster` (stub no-op S47)
- `NotificationsRepository` :
  - SQL natif `notifications` + helper `users.picture`
  - PATCH single/pall idempotents (aucun 404)
- Migration index:
  - `V11__notifications_index.sql` (`idx_notifications_user`)

## Tables touchées

- `notifications` (SELECT/UPDATE)
- `users` (lecture picture sender pour enrichissement)

## Asymétries Python conservées

- PATCH single: réponse `{success, unread_notif}`
- PATCH read-all: réponse `{success}` sans `unread_notif`
- PATCH single silent si `notif_id` absent ou non owner (200)
- `data` toujours objet (`{}` fallback)
- override `sender_picture` seulement si photo courante non nulle

## Tests

Ajout `NotificationsIntegrationTest` couvrant:

- inbox nominale (ordre, limit, ownership)
- limit invalid (`0`, `abc`) => `422`
- auth absente => `401`
- parsing `data` + override `sender_picture`
- mark-read nominal + idempotence/silent not found/non-owner
- mark-all read + réponse sans `unread_notif`

Commande:

- `mvn -Dtest=NotificationsIntegrationTest test` ✅

## Hors scope S47 conservé

- Aucun endpoint delete notifications
- Aucun endpoint HTTP unread-count standalone
- Pas d’implémentation Chat/WebSocket réelle (stub no-op conservé)
