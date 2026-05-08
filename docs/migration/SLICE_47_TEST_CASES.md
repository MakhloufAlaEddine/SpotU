# SLICE 47 — Test Cases (Notifications inbox)

> Tests d'intégration ciblant les 3 endpoints inbox.

---

## Pré-requis

- Auth JWT opérationnelle.
- Schéma `notifications` initialisé.
- Index `idx_notifications_user(user_id, created_at DESC)` présent.
- Utilisateurs : `U_A`, `U_B`, `U_ADMIN`.
- Helper de seed pour insérer des notifs en DB.

---

# 1. GET /api/users/me/notifications

## TC-S47-1.1 — Inbox nominale (multiples notifs)
**Pré** : 3 notifs pour `U_A` (`created_at` T0 < T1 < T2), 0 pour `U_B`.
**Auth** : `U_A`.
**Action** : `GET /api/users/me/notifications`.
**Attendu** :
- HTTP 200.
- Body : tableau de 3 objets, ordre DESC (T2, T1, T0).
- Chaque objet contient `id, type, title, body, data, read, created_at`.

## TC-S47-1.2 — Inbox vide
**Pré** : 0 notif pour `U_C`.
**Auth** : `U_C`.
**Attendu** : HTTP 200, body `[]`.

## TC-S47-1.3 — Limit default 50
**Pré** : 100 notifs pour `U_A`.
**Action** : GET sans query param.
**Attendu** : 50 items retournés (les 50 plus récentes).

## TC-S47-1.4 — Limit explicite
**Pré** : 100 notifs.
**Action** : `GET ?limit=10`.
**Attendu** : 10 items.

## TC-S47-1.5 — Limit max 200
**Pré** : 300 notifs.
**Action** : `GET ?limit=200`.
**Attendu** : 200 items.

## TC-S47-1.6 — Limit hors range bas
**Action** : `GET ?limit=0`.
**Attendu** : HTTP 422.

## TC-S47-1.7 — Limit hors range haut
**Action** : `GET ?limit=201`.
**Attendu** : HTTP 422.

## TC-S47-1.8 — Limit non-int
**Action** : `GET ?limit=abc`.
**Attendu** : HTTP 422.

## TC-S47-1.9 — Ownership : pas de fuite cross-user
**Pré** : 5 notifs `U_A`, 3 notifs `U_B`.
**Auth** : `U_A`.
**Attendu** : 5 items (les 3 de `U_B` jamais retournés).

## TC-S47-1.10 — Auth absente
**Attendu** : HTTP 401.

## TC-S47-1.11 — JWT invalide
**Attendu** : HTTP 401.

## TC-S47-1.12 — Champ `data` parsing dual
**Pré** : 3 notifs avec data différente :
- N1 : `data = NULL` en DB.
- N2 : `data = '{"foo":"bar"}'` (jsonb).
- N3 : `data = '{}'`.
**Attendu** :
- N1.data = `{}`.
- N2.data = `{"foo":"bar"}`.
- N3.data = `{}`.

## TC-S47-1.13 — `data.sender_picture` override
**Pré** :
- Notif N1 avec `data = {"sender_id":"usr_X","sender_picture":"OLD.jpg"}`.
- `users.picture` de `usr_X` = `"NEW.jpg"`.
**Attendu** : N1.data.sender_picture = `"NEW.jpg"` (pas OLD).

## TC-S47-1.14 — `data.sender_picture` conservé si JOIN NULL
**Pré** :
- Notif N1 avec `data = {"sender_id":"usr_DELETED","sender_picture":"OLD.jpg"}`.
- `usr_DELETED` n'existe pas dans `users` (compte supprimé).
**Attendu** : N1.data.sender_picture = `"OLD.jpg"` (LEFT JOIN ⇒ sender_current_picture NULL ⇒ pas d'override).

## TC-S47-1.15 — `data.sender_picture` conservé si users.picture NULL
**Pré** :
- Notif avec `data = {"sender_id":"usr_X","sender_picture":"OLD.jpg"}`.
- `usr_X.picture = NULL` en DB.
**Attendu** : N1.data.sender_picture = `"OLD.jpg"` (override conditionnel `IS NOT NULL`).

## TC-S47-1.16 — `created_at` ISO format
**Attendu** : tous les objets ont `created_at` en string ISO 8601.

## TC-S47-1.17 — `id` mappe `notif_id`
**Attendu** : champ JSON s'appelle `id`, pas `notif_id`.

## TC-S47-1.18 — Tri DESC strict
**Pré** : 5 notifs avec timestamps T1 < T2 < T3 < T4 < T5.
**Attendu** : ordre [T5, T4, T3, T2, T1].

## TC-S47-1.19 — Inbox grande volumétrie
**Pré** : 1000 notifs pour `U_A`.
**Action** : `GET ?limit=50`.
**Attendu** : 50 items, performance < 200ms (index `idx_notifications_user` exploité).

---

# 2. PATCH /api/users/me/notifications/{notif_id}/read

## TC-S47-2.1 — Mark single nominal
**Pré** : 3 notifs `U_A` (toutes read=false), 1 notif `U_B`.
**Action** : `PATCH /notifications/N1/read`.
**Attendu** :
- HTTP 200.
- Body : `{"success": true, "unread_notif": 2}`.
- DB : N1.read = true, N2/N3.read = false.

## TC-S47-2.2 — Mark single déjà lue (idempotent)
**Pré** : N1.read = true.
**Action** : PATCH read.
**Attendu** : HTTP 200, `unread_notif` recalculé (inchangé).

## TC-S47-2.3 — Notif inexistante (silent no-op)
**Action** : `PATCH /notifications/N_INEXISTANT/read`.
**Attendu** :
- HTTP 200.
- Body : `{"success": true, "unread_notif": <count actuel>}`.
- Aucune erreur, aucune modif DB.

## TC-S47-2.4 — Notif d'un autre user (silent no-op, pas de fuite)
**Pré** : N1 owned by `U_A`.
**Auth** : `U_B`.
**Action** : PATCH /notifications/N1/read.
**Attendu** :
- HTTP 200.
- Body : `{"success": true, "unread_notif": <count de U_B>}`.
- DB : N1.read **inchangé** (filtre `user_id` empêche).

## TC-S47-2.5 — Auth absente
**Attendu** : HTTP 401.

## TC-S47-2.6 — JWT invalide
**Attendu** : HTTP 401.

## TC-S47-2.7 — Compteur `unread_notif` recalculé après UPDATE
**Pré** : 5 unread, 0 read.
**Action** : PATCH single sur N1.
**Attendu** : `unread_notif=4` (5 - 1).

## TC-S47-2.8 — Cohérence GET après PATCH single
1. PATCH /N1/read.
2. GET inbox.
3. **Attendu** : N1.read = true dans la liste.

## TC-S47-2.9 — Format réponse strict
**Attendu** : `{success, unread_notif}` uniquement. Pas de `notif_id`, pas de `read`.

---

# 3. PATCH /api/users/me/notifications/read-all

## TC-S47-3.1 — Mark all nominal
**Pré** : 5 notifs `U_A` (3 unread, 2 read).
**Action** : `PATCH /notifications/read-all`.
**Attendu** :
- HTTP 200.
- Body : `{"success": true}`.
- DB : 5 notifs read = true.

## TC-S47-3.2 — Mark all idempotent (déjà tout lu)
**Pré** : 5 notifs toutes read=true.
**Action** : PATCH read-all.
**Attendu** : HTTP 200, body `{"success":true}`, 0 ligne updated.

## TC-S47-3.3 — Pas de `unread_notif` dans la réponse (asymétrie BR-47.10)
**Attendu** : body strictement `{"success":true}`. **Pas** de `unread_notif` (volontaire).

## TC-S47-3.4 — Ownership : pas de fuite
**Pré** : 3 unread `U_A`, 2 unread `U_B`.
**Auth** : `U_A`.
**Action** : PATCH read-all.
**Attendu** :
- DB `U_A` : 3 read=true.
- DB `U_B` : 2 unread=true (intactes).

## TC-S47-3.5 — Auth absente
**Attendu** : HTTP 401.

## TC-S47-3.6 — Cohérence GET après mark-all
1. 5 unread.
2. PATCH read-all.
3. GET inbox.
4. **Attendu** : tous les `read=true`.

---

# 4. WS broadcast (deferred — stubbed)

## TC-S47-4.1 — `notif_manager.notify` appelé après PATCH single
**Pré** : stub spy sur `NotifBroadcaster.notify`.
**Action** : PATCH single read.
**Attendu** : `notify` appelé 1 fois avec `(userId, {type:"unread_notif", count:N})`.
**Note** : si la slice WS n'est pas mergée, le stub no-op suffit (pas d'erreur).

## TC-S47-4.2 — `notif_manager.notify` appelé après PATCH read-all avec count=0
**Action** : PATCH read-all.
**Attendu** : `notify` appelé 1 fois avec `(userId, {type:"unread_notif", count:0})`.
**Note** : `count` hardcodé à 0, pas un re-SELECT.

## TC-S47-4.3 — Échec WS broadcast n'impacte pas HTTP
**Pré** : stub `notify` lève une exception.
**Action** : PATCH single.
**Attendu** : HTTP 200 avec body normal (l'exception WS est capturée silencieusement ou loggée).
> Iso : Python utilise `await notif_manager.notify(...)` sans try/except, mais en pratique `NotifManager` ne lève pas (gère les sessions absentes silencieusement).

---

# 5. Round-trip & cohérence

## TC-S47-5.1 — Cycle complet inbox
1. (Hors HTTP) Insérer 3 notifs `U_A` (DB direct ou via worker Python).
2. GET inbox → 3 items, tous `read=false`.
3. PATCH /N1/read → `unread_notif=2`.
4. GET inbox → N1.read=true, N2/N3.read=false.
5. PATCH /read-all → `{success:true}`.
6. GET inbox → tous `read=true`.

## TC-S47-5.2 — Cascade FK user CASCADE
**Pré** : 5 notifs pour `U_X`.
**Action** : `DELETE FROM users WHERE user_id='U_X'` (admin DB).
**Attendu** : 0 notif `U_X` (CASCADE).

## TC-S47-5.3 — Notif insérée par worker Python visible côté Java
**Pré** : worker Python insère une notif pour `U_A`.
**Action** : `U_A` GET inbox via Java.
**Attendu** : la notif apparaît immédiatement (pas de cache, lecture DB live).

---

# 6. Couverture exigée

| Catégorie | TCs minimum |
|-----------|-------------|
| GET inbox | 1.1, 1.2, 1.3, 1.5, 1.6, 1.9, 1.10, 1.12, 1.13, 1.14, 1.18 |
| PATCH single | 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8 |
| PATCH all | 3.1, 3.2, 3.3, 3.4, 3.5 |
| WS broadcast | 4.1, 4.2, 4.3 |
| Round-trip | 5.1, 5.2 |

> Tous ces tests doivent passer côté Java avant cutover front sur S47.
