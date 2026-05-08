# SLICE 48 — Test Cases (Chat & WebSockets)

> **Source** : `chat_routes.py:1–715`, `chat_manager.py:1–89`, `deletion_routes.py:436–517`
> Convention : `T48-XX-NN` où `XX` ∈ {POST, GET, MSG, READ, DEL, LEAVE, WS-CHAT, WS-NOTIF, WS-SPOTYOU, INT, EDGE} et `NN` un entier.

---

## §A — POST /api/conversations

### T48-POST-01 — Créer conv `service` (premier appel)
- **Setup** : un service existant `svc_a` (coach=`u_coach`).
- **Action** : `u_buyer` POST `/conversations` `{type:"service", context_id:"svc_a"}`.
- **Attendu** : 200, body avec `conversation_id="conv_..."`, `type=service`, `context_id=svc_a`, `created_by=u_buyer`. DB : 1 row `conversations`, 2 rows `conversation_participants` (u_buyer + u_coach), tous `status='active'` (DEFAULT DDL).

### T48-POST-02 — Idempotence service (deuxième appel)
- **Setup** : T48-POST-01 exécuté.
- **Action** : `u_buyer` POST identique.
- **Attendu** : 200, **même `conversation_id`** que T48-POST-01. DB inchangée (toujours 1 conv, 2 participants).

### T48-POST-03 — Créer conv `tagpoint_private` (premier appel)
- **Setup** : tag_point `tp_x` créé par `u_creator`.
- **Action** : `u_visitor` POST `{type:"tagpoint_private", context_id:"tp_x"}`.
- **Attendu** : 200, conv créée avec 2 participants (u_creator + u_visitor), `created_by=u_visitor`.

### T48-POST-04 — Idempotence tagpoint_private par caller
- **Action** : autre user `u_other` POST `{type:"tagpoint_private", context_id:"tp_x"}`.
- **Attendu** : 200, **nouvelle** conv (pas la même que T48-POST-03 car le filtre est `(context, user)`).

### T48-POST-05 — Créer conv `tagpoint_group` (caller = créateur du tag_point)
- **Setup** : tag_point `tp_y` créé par `u_creator`.
- **Action** : `u_creator` POST `{type:"tagpoint_group", context_id:"tp_y"}`.
- **Attendu** : 200, conv créée avec 1 participant (u_creator), `created_by=u_creator`.

### T48-POST-06 — Conv `tagpoint_group` rejoint par membre
- **Setup** : T48-POST-05 ; `u_member` est dans `spot_you_members` pour `tp_y`.
- **Action** : `u_member` POST `{type:"tagpoint_group", context_id:"tp_y"}`.
- **Attendu** : 200, **même `conversation_id`** que T48-POST-05. `u_member` ajouté avec `status='active'`. Total : 2 participants.

### T48-POST-07 — Conv `tagpoint_group` réactivation après leave
- **Setup** : T48-POST-06 puis `u_member` PATCH `/conversations/{id}/leave` (status='left').
- **Action** : `u_member` POST `{type:"tagpoint_group", context_id:"tp_y"}` (et est toujours dans `spot_you_members`).
- **Attendu** : 200. `u_member` repasse à `status='active'` (`ON CONFLICT DO UPDATE`).

### T48-POST-08 — Conv `tagpoint_group` refus (non-membre)
- **Setup** : `u_stranger` PAS dans `spot_you_members` ni créateur du tag_point.
- **Action** : POST `{type:"tagpoint_group", context_id:"tp_y"}`.
- **Attendu** : 403 `{"detail":"Vous devez être membre de ce SpotYou pour accéder au groupe"}`.

### T48-POST-09 — Type invalide
- **Action** : POST `{type:"foobar", context_id:"x"}`.
- **Attendu** : 400 `{"detail":"Invalid conversation type"}`.

### T48-POST-10 — Sans JWT
- **Action** : POST sans header `Authorization` ni cookie.
- **Attendu** : 401.

### T48-POST-11 — Title fallback (context inexistant)
- **Action** : POST `{type:"service", context_id:"svc_inexistant"}`.
- **Attendu** : 200, conv créée avec `context_title = "svc_inexistant"` (fallback Python l. 59 `return row["title"] if row else context_id`).
- **Note** : iso Python — ne pas refuser cet edge case.

### T48-POST-12 — `created_by` (group ≠ private)
- **Setup** : tag_point `tp_z` créé par `u_creator`.
- **Action 1** : `u_visitor` POST `{type:"tagpoint_group", context_id:"tp_z"}` → permission KO (non-membre). Skip.
- **Action 2** : `u_creator` POST `{type:"tagpoint_group", context_id:"tp_z"}` → conv group avec `created_by=u_creator`. ✓
- **Action 3** : `u_visitor` POST `{type:"tagpoint_private", context_id:"tp_z"}` → conv private avec `created_by=u_visitor` (PAS u_creator). ✓ (BR-48.07)

---

## §B — GET /api/conversations

### T48-GET-01 — Liste vide
- **Action** : `u_alone` GET `/conversations` (jamais participé).
- **Attendu** : 200, `[]`.

### T48-GET-02 — Liste 1 conv `service` enrichie
- **Setup** : T48-POST-01 + 1 message dans la conv (envoyé par u_buyer via WS).
- **Action** : `u_buyer` GET.
- **Attendu** : tableau 1 élément avec `last_message`, `unread_count=0` (sender = self), `is_blocked=false`, `other_participant.user_id=u_coach`.

### T48-GET-03 — `unread_count` non-zéro
- **Setup** : T48-POST-01 + 3 messages envoyés par u_coach (sans que u_buyer ne lise).
- **Action** : u_buyer GET.
- **Attendu** : `unread_count=3`.

### T48-GET-04 — Conv group avec `participant_count` + `context_image`
- **Setup** : tag_point `tp_y` avec `images=["https://img.com/a.jpg"]` et 5 membres dans la group conv.
- **Action** : un membre GET.
- **Attendu** : `type=tagpoint_group`, `other_participant=null`, `participant_count=5`, `context_image="https://img.com/a.jpg"`.

### T48-GET-05 — `context_deleted` via colonne authoritative
- **Setup** : conv service `c1` ; le service est soft-deleted via DELETE service → `_mark_conversations_context_deleted` set `c1.context_deleted=TRUE`.
- **Action** : un participant GET.
- **Attendu** : `c1.context_deleted=true`.

### T48-GET-06 — `context_deleted` via fallback dynamique (tag_point inactif)
- **Setup** : conv group `c2` ; `tag_points.active=FALSE` mais `context_deleted=FALSE`.
- **Action** : GET.
- **Attendu** : `c2.context_deleted=true` (fallback BR-48.13 niveau b).

### T48-GET-07 — Tri `last_message_at DESC NULLS LAST`
- **Setup** : 3 convs : c_a (last_msg t-1h), c_b (last_msg t-3h), c_c (last_msg null).
- **Action** : GET.
- **Attendu** : ordre `[c_a, c_b, c_c]`.

### T48-GET-08 — Conv soft-deleted invisible
- **Setup** : conv `c3` avec `deleted_at NOT NULL` (auto-archivée via leave).
- **Action** : un ex-participant GET.
- **Attendu** : `c3` absente du résultat.

### T48-GET-09 — Sender anonymisé (sender_id NULL après suppression user)
- **Setup** : conv avec un message dont le sender a été DELETE (FK SET NULL).
- **Action** : GET.
- **Attendu** : `last_message.sender_name="Utilisateur supprimé"`, `last_message.sender_id=null`.

### T48-GET-10 — `last_message` masqué si soft-deleted
- **Setup** : un message DELETE-soft dans la conv (le dernier).
- **Action** : GET.
- **Attendu** : `last_message.content="[Message supprimé]"`.

### T48-GET-11 — `is_blocked=true`
- **Setup** : conv group ; user kické (status='blocked') via leave SpotYou (`spot_you_routes.py:269–275`).
- **Action** : ce user GET.
- **Attendu** : conv visible avec `is_blocked=true`.

### T48-GET-12 — User `left` voit toujours la conv (jusqu'à auto-archive)
- **Setup** : conv 2-participants ; user A leave (status='left'). User B est encore actif.
- **Action** : user A GET.
- **Attendu** : conv visible avec `is_blocked=false` (status='left' mappe à `is_blocked=false`). Lecture historique encore possible (via GET messages).

---

## §C — GET /api/conversations/{id}/messages

### T48-MSG-01 — Lecture nominal (chronologique ASC)
- **Setup** : conv avec 5 messages aux timestamps t1<t2<t3<t4<t5.
- **Action** : GET (limit default 50, no before).
- **Attendu** : tableau ordonné [m1, m2, m3, m4, m5].

### T48-MSG-02 — `limit=2` retourne les 2 plus récents en ordre ASC
- **Action** : GET `?limit=2`.
- **Attendu** : `[m4, m5]` (les 2 dernières DESC, puis reversed).

### T48-MSG-03 — `before` cursor pagination
- **Setup** : conv avec 10 messages.
- **Action** : GET `?limit=3&before=<m7.created_at_iso>`.
- **Attendu** : `[m4, m5, m6]` (les 3 derniers strictement avant t7).

### T48-MSG-04 — Limit hors range → 422
- **Action** : GET `?limit=0`.
- **Attendu** : 422 (Pydantic Query `ge=1`).
- **Action** : GET `?limit=101`.
- **Attendu** : 422 (`le=100`).

### T48-MSG-05 — Permission : non-participant → 403
- **Action** : `u_stranger` GET sur conv où il n'est jamais entré.
- **Attendu** : 403 `{"detail":"Not a participant"}`.

### T48-MSG-06 — Permission : status='left' OK
- **Setup** : user A a `status='left'` sur la conv.
- **Action** : user A GET.
- **Attendu** : 200, historique visible (BR-48.20).

### T48-MSG-07 — Side-effect mark-read
- **Setup** : conv avec 3 messages unread pour le caller.
- **Action** : GET.
- **Attendu** : 200 + DB `cp.last_read_at` updated to NOW + `unread_total` recalculé pour le caller (vérif via `notifRegistry` mock).

### T48-MSG-08 — Sender anonymisé
- **Setup** : message dont sender a été supprimé.
- **Action** : GET.
- **Attendu** : `sender_id=null`, `sender_name="Utilisateur supprimé"`, `sender_picture=null`.

### T48-MSG-09 — Message soft-deleted
- **Setup** : 1 des 3 messages a `deleted_at NOT NULL`.
- **Action** : GET.
- **Attendu** : ce message présent dans la liste avec `content="[Message supprimé]"` et `deleted_at` populé.

---

## §D — PUT /api/conversations/{id}/read

### T48-READ-01 — Mark-read nominal
- **Setup** : conv avec 5 messages unread pour le caller.
- **Action** : PUT.
- **Attendu** : 200 `{success:true}` + DB `last_read_at=NOW` + WS `unread_total` poussé.

### T48-READ-02 — Idempotent
- **Action** : PUT 2 fois consécutivement.
- **Attendu** : 200 les deux fois (timestamp avancé à chaque appel).

### T48-READ-03 — Non-participant : silent 200
- **Action** : `u_stranger` PUT sur conv inconnue.
- **Attendu** : 200 `{success:true}` (BR-48.25 — pas de 403).

---

## §E — DELETE /api/messages/{id}

### T48-DEL-01 — Auteur supprime son message
- **Setup** : message envoyé par u_a.
- **Action** : u_a DELETE.
- **Attendu** : 200 `{success:true, deleted:true, message_id}`. DB `deleted_at NOT NULL`. Broadcast WS `{type:"message_deleted"}` reçu par tous les ws de la conv.

### T48-DEL-02 — Admin supprime n'importe quel message
- **Setup** : message de u_b.
- **Action** : u_admin DELETE.
- **Attendu** : 200 + broadcast.

### T48-DEL-03 — Non-auteur non-admin → 403
- **Setup** : message de u_a, conv contient u_a + u_c.
- **Action** : u_c DELETE.
- **Attendu** : 403 `{"detail":"Non autorisé à supprimer ce message"}`.

### T48-DEL-04 — Idempotent (déjà supprimé)
- **Setup** : T48-DEL-01 exécuté.
- **Action** : u_a DELETE même message_id.
- **Attendu** : 200 `{success:true, already_deleted:true}` — **AVANT** check ownership (BR-48.27).

### T48-DEL-05 — Idempotent garde priorité sur 403
- **Setup** : message de u_a déjà soft-deleted.
- **Action** : u_c (non-auteur) DELETE.
- **Attendu** : 200 `{already_deleted:true}` (BR-48.27 ordre : 404 → already_deleted → 403).

### T48-DEL-06 — 404 message inexistant
- **Action** : DELETE `/messages/msg_inexistant`.
- **Attendu** : 404 `{"detail":"Message introuvable"}`.

---

## §F — PATCH /api/conversations/{id}/leave

### T48-LEAVE-01 — Leave nominal
- **Setup** : conv 3 participants tous actifs.
- **Action** : u_a PATCH.
- **Attendu** : 200 `{success:true, left:true, conversation_id}`. DB `status='left'`. Conv pas archivée (2 actifs restants).

### T48-LEAVE-02 — Leave dernier actif → auto-archive
- **Setup** : conv 1 participant actif (u_a).
- **Action** : u_a PATCH.
- **Attendu** : 200 + `conversations.deleted_at=NOW`. Conv invisible dans GET /conversations.

### T48-LEAVE-03 — Idempotent (déjà left)
- **Action** : u_a PATCH après T48-LEAVE-01.
- **Attendu** : 200 `{success:true, already_left:true}`.

### T48-LEAVE-04 — Non-participant → 404
- **Action** : u_stranger PATCH sur conv où il n'a jamais été.
- **Attendu** : 404.

### T48-LEAVE-05 — Aucun broadcast WS
- **Action** : u_a PATCH ; u_b est connecté en WS sur cette conv.
- **Attendu** : u_b ne reçoit AUCUN frame (BR-48.34). Vérifie qu'on n'invente pas un `participant_left`.

---

## §G — WS /api/ws/chat/{conv_id}

### T48-WS-CHAT-01 — Handshake nominal
- **Setup** : u_a est `status='active'` dans `conv_x`.
- **Action** : ouvrir WS, envoyer `{token:"<JWT_a>"}` dans 5 s.
- **Attendu** : connexion établie (pas de close).

### T48-WS-CHAT-02 — Timeout handshake → close 4001
- **Action** : ouvrir WS, ne rien envoyer.
- **Attendu** : après 5 s, close `4001`.

### T48-WS-CHAT-03 — JWT invalide → close 4001
- **Action** : envoyer `{token:"invalid"}`.
- **Attendu** : close `4001`.

### T48-WS-CHAT-04 — Token absent → close 4001
- **Action** : envoyer `{}`.
- **Attendu** : close `4001`.

### T48-WS-CHAT-05 — Frame non-JSON au handshake → close 4001
- **Action** : envoyer "hello" (texte plain).
- **Attendu** : close `4001`.

### T48-WS-CHAT-06 — Non-membre actif → close 4003
- **Setup** : u_b a `status='left'` dans `conv_x`.
- **Action** : u_b ouvre WS + handshake valide.
- **Attendu** : close `4003`.

### T48-WS-CHAT-07 — Non-participant → close 4003
- **Action** : u_stranger ouvre WS + handshake valide.
- **Attendu** : close `4003`.

### T48-WS-CHAT-08 — Envoi message nominal
- **Setup** : u_a connecté, u_b connecté sur même conv (tous deux actifs).
- **Action** : u_a envoie `{content:"Bonjour"}`.
- **Attendu** :
  - u_a et u_b reçoivent le broadcast `{message_id, conversation_id, sender_id:u_a, sender_name, sender_picture, content:"Bonjour", created_at}`.
  - DB : 1 row `messages` ; `conversations.last_message_at` = NOW.
  - u_b reçoit aussi `{type:"unread_total", count:1}` sur son `/ws/notifications` (s'il est connecté).
  - Push notif fire-and-forget envoyée à u_b (si push tokens enregistrés) avec `data.type=chat_message`, `data.conversationId=conv_x`. NE crée PAS de row `notifications`.

### T48-WS-CHAT-09 — Content vide après trim → silent skip
- **Action** : envoyer `{content:"   "}`.
- **Attendu** : aucun broadcast, aucune INSERT, pas de close. WS reste ouvert.

### T48-WS-CHAT-10 — Anti-spam 500 ms → silent skip
- **Action** : envoyer 2 messages valides à 100 ms d'intervalle.
- **Attendu** : 1er accepté + broadcasté ; 2ème silent skip (pas de close, pas de réponse). 1 INSERT en DB.

### T48-WS-CHAT-11 — Anti-spam respect après 500 ms
- **Action** : envoyer 2 messages à 600 ms d'intervalle.
- **Attendu** : les 2 acceptés + broadcastés.

### T48-WS-CHAT-12 — Message > 8 KB → close 4009
- **Action** : envoyer `{content: "a" * 8200}` (UTF-8 = 8200 bytes).
- **Attendu** : close `4009`. Aucun INSERT.

### T48-WS-CHAT-13 — Message exactement 8192 bytes → accepté
- **Action** : envoyer 8192 bytes UTF-8.
- **Attendu** : accepté (le check est `> 8192`, strict).

### T48-WS-CHAT-14 — context_deleted → erreur frame, pas de close
- **Setup** : conv avec `context_deleted=TRUE`.
- **Action** : u_a envoie un message valide.
- **Attendu** : reçoit `{type:"error", code:"CONTEXT_DELETED", message:"..."}`. Pas de close. Aucun INSERT. Aucun broadcast aux autres.

### T48-WS-CHAT-15 — Cleanup au close client
- **Action** : u_a ferme proprement la connexion.
- **Attendu** : `chatRegistry.disconnect(conv_x, ws)` exécuté (cf. logs DEBUG ou observation `Map.size`).

### T48-WS-CHAT-16 — Cleanup en cas d'exception serveur
- **Action** : forcer une exception (mock DB error sur INSERT).
- **Attendu** : exception loguée, `disconnect` exécuté dans `finally`, pas de leak.

### T48-WS-CHAT-17 — Anti-spam compteur n'avance pas sur skip
- **Action** : envoyer message valide (t=0), envoyer message vide (t=100ms), envoyer message valide (t=600ms).
- **Attendu** : 2 messages broadcastés (le 3ème respecte le cooldown de 500ms à partir du 1er, pas du 2ème skipped).

### T48-WS-CHAT-18 — Multiple sessions du même user
- **Setup** : u_a ouvre 2 sessions WS (mobile + web) sur même conv.
- **Action** : u_a envoie 1 message depuis session A.
- **Attendu** : les 2 sessions de u_a reçoivent le broadcast (session A reçoit son propre message). Iso (BR-48.48).

---

## §H — WS /api/ws/notifications

### T48-WS-NOTIF-01 — Handshake + frames init
- **Setup** : u_a a 4 messages unread (toutes convs) et 7 notifs unread.
- **Action** : ouvrir WS, envoyer `{token}`.
- **Attendu** : reçoit immédiatement (dans cet ordre) :
  1. `{type:"unread_total", count:4}`
  2. `{type:"unread_notif", count:7}`

### T48-WS-NOTIF-02 — Pas de check membership
- **Action** : n'importe quel user authentifié ouvre WS.
- **Attendu** : connexion OK (BR-48.53).

### T48-WS-NOTIF-03 — Frames clients ignorées
- **Action** : u_a envoie `{ping:1}`.
- **Attendu** : aucune réponse, WS reste ouvert (BR-48.55).

### T48-WS-NOTIF-04 — Push `unread_total` après lecture WS chat
- **Setup** : u_a et u_b connectés à `/ws/notifications` ; u_a connecté à `/ws/chat/conv_x`.
- **Action** : u_a envoie un message dans `conv_x`.
- **Attendu** : u_b reçoit `{type:"unread_total", count:N}` sur `/ws/notifications`.

### T48-WS-NOTIF-05 — Cleanup au disconnect
- **Action** : u_a ferme la connexion.
- **Attendu** : `notifRegistry.disconnect(u_a, ws)` exécuté.

---

## §I — WS /api/ws/spot-you/{point_id}

### T48-WS-SPOTYOU-01 — Handshake nominal
- **Action** : u_a ouvre WS pour `tp_x`, handshake valide.
- **Attendu** : connexion OK, **AUCUN frame** envoyé à la connexion (BR-48.58).

### T48-WS-SPOTYOU-02 — Pas de check membership
- **Action** : u_stranger (jamais membre de `tp_x`) ouvre WS.
- **Attendu** : connexion OK (BR-48.57).

### T48-WS-SPOTYOU-03 — Reçoit broadcasts join/going
- **Setup** : u_a connecté.
- **Action** : un autre user `u_b` POST `/api/spot-you/tp_x/join`.
- **Attendu** : u_a reçoit `{type:"spotyou_update", point_id:"tp_x", participants_count:N}`.

### T48-WS-SPOTYOU-04 — Frames clients ignorées
- **Action** : u_a envoie `{action:"subscribe"}`.
- **Attendu** : aucune réponse.

---

## §J — Intégration cross-slice

### T48-INT-01 — Soft-delete service propage `context_deleted`
- **Setup** : conv service `c_x` ; coach DELETE le service.
- **Attendu** : `conversations.context_deleted=TRUE` (set par S29-équivalent service / `_mark_conversations_context_deleted`).
- **Vérif** : `GET /conversations` renvoie `c_x.context_deleted=true`. WS chat sur `c_x` renvoie `{type:"error", code:"CONTEXT_DELETED"}` à l'envoi.

### T48-INT-02 — Soft-delete tag_point propage
- **Setup** : conv group `c_y` ; owner DELETE le tag_point.
- **Attendu** : `c_y.context_deleted=TRUE`. WS chat refuse l'envoi.

### T48-INT-03 — Reactivate service réactive `context_deleted=FALSE`
- **Setup** : T48-INT-01 puis owner POST `/services/{id}/reactivate`.
- **Attendu** : `context_deleted=FALSE`. WS chat sur `c_x` accepte à nouveau les envois.

### T48-INT-04 — Leave SpotYou bloque dans la group conv
- **Setup** : u_a membre de `tp_y` + actif dans la group conv.
- **Action** : u_a DELETE `/spot-you/tp_y/leave`.
- **Attendu** : `conversation_participants.status='blocked'` (set par `spot_you_routes.py:269–275`). WS chat handshake → close 4003 (status != 'active').

### T48-INT-05 — Anonymisation user (DELETE RGPD)
- **Setup** : u_x avec messages dans plusieurs convs.
- **Action** : DELETE `/users/u_x` (S29-équivalent).
- **Attendu** : tous les messages restent visibles avec `sender_id=NULL`, `sender_name="Utilisateur supprimé"`, `sender_picture=null`.

### T48-INT-06 — S47 mark-read notif déclenche `unread_notif` WS
- **Setup** : u_a connecté à `/ws/notifications` avec 5 notifs unread.
- **Action** : u_a PATCH `/users/me/notifications/{id}/read`.
- **Attendu** : reçoit `{type:"unread_notif", count:4}` (count décrémenté).

### T48-INT-07 — POST conversation tagpoint_group réactive un user blocked
- **Setup** : u_a est `status='blocked'` dans la group conv de `tp_y` (ex-membre kické).
- **Action** : u_a re-POST `/conversations` `{type:"tagpoint_group", context_id:"tp_y"}` (suppose qu'il a re-joint via `POST /spot-you/{id}/join` avant).
- **Attendu** : `ON CONFLICT DO UPDATE SET status='active'`. Status repasse à actif.

---

## §K — Edge cases

### T48-EDGE-01 — Conv sans messages → `last_message=null`
- **Setup** : conv créée mais aucun message.
- **Action** : GET /conversations.
- **Attendu** : entrée avec `last_message=null`.

### T48-EDGE-02 — Conv avec 1 seul participant ayant left
- **Setup** : conv 2-participants ; les 2 leave.
- **Attendu** : conv `deleted_at NOT NULL`. Invisible dans GET. Mais les messages restent en DB (pas de hard-delete cascade).

### T48-EDGE-03 — context_image null si tag_point.images vide
- **Setup** : conv group ; tag_point avec `images='[]'` ou `null`.
- **Action** : GET.
- **Attendu** : `context_image=null`.

### T48-EDGE-04 — context_image parse string JSON legacy
- **Setup** : tag_point avec `images='["url1"]'` (string JSON, fallback DDL legacy).
- **Action** : GET.
- **Attendu** : `context_image="url1"` (parse JSON correct, BR-48.18).

### T48-EDGE-05 — `_get_unread_total` exclut messages du caller
- **Setup** : u_a envoie 5 messages dans conv où il est aussi participant.
- **Action** : u_a GET /conversations.
- **Attendu** : `unread_count=0` pour cette conv (filtre `sender_id != caller`).

### T48-EDGE-06 — Multiple "other_participants" en private (cas anormal)
- **Setup** : conv tagpoint_private avec 3 participants u_a (caller), u_b, u_c.
- **Action** : u_a GET.
- **Attendu** : `other_participant` = un seul de u_b/u_c (le 1er rencontré). Iso (BR-48.17).

### T48-EDGE-07 — `last_message_at` race condition envoi simultané
- **Setup** : 2 users envoient simultanément un message dans la même conv.
- **Attendu** : DB cohérente — `last_message_at` = max des 2 timestamps. Pas de deadlock.

### T48-EDGE-08 — UTF-8 multi-bytes message
- **Action** : envoyer `{content: "🎉"}` (4 bytes UTF-8 mais 1 caractère).
- **Attendu** : accepté. Stocké correctement. Affiché correctement.

### T48-EDGE-09 — Caractère NULL dans le content
- **Action** : envoyer `{content: "abc\u0000def"}`.
- **Attendu** : PostgreSQL rejette le `\0` dans `text`. Java doit catcher l'erreur DB et NE PAS close abruptement (reproduire le comportement Python — qui logue l'exception via le `try/except` global `except Exception as exc`).

### T48-EDGE-10 — Conv `deleted_at` mais user reconnaît via WS
- **Setup** : conv soft-deleted ; user a une session WS encore ouverte sur cette conv.
- **Action** : envoyer un message.
- **Attendu** : iso Python — la session reste OK (le `deleted_at` n'est pas vérifié au runtime WS chat ; seul `_context_deleted` l'est). Limitation acceptée. Le test documente le comportement actuel.

### T48-EDGE-11 — Sender supprimé pendant qu'il est connecté
- **Setup** : u_a connecté en WS chat ; admin DELETE u_a (RGPD).
- **Action** : u_a tente d'envoyer un message.
- **Attendu** : INSERT échoue (FK SET NULL ne supprime pas la ligne user, mais `auth_utils` bloque déjà à require_auth — sauf que le WS n'utilise pas require_auth, juste `decode_jwt`). En pratique, l'INSERT passe avec `sender_id=u_a` (encore valide car user_id pas vraiment "supprimé" en hard, juste anonymized). Documenter le comportement réel.

### T48-EDGE-12 — Anti-spam ne s'applique pas cross-sessions
- **Setup** : u_a a 2 sessions WS ouvertes sur même conv.
- **Action** : envoyer 1 msg sur session A à t=0, 1 msg sur session B à t=100ms.
- **Attendu** : les 2 acceptés (état `_last_msg_time` est local par session, BR-48.46).
- **Note** : limitation acceptée (en pratique, un client ouvre rarement 2 sessions ; un attaquant pourrait contourner).

---

## §L — Régressions inter-slices

### T48-REG-01 — S47 `_push_unread` non bloquant
- **Setup** : u_a sans WS notif ouvert.
- **Action** : GET /messages (qui appelle `_push_unread`).
- **Attendu** : 200 nominal. Le `notifRegistry.notify(uid, ...)` ne bloque pas (pas de session = no-op).

### T48-REG-02 — S29 (deletion users) cascade conversations
- **Setup** : DELETE user → cascade `conversation_participants` (FK CASCADE l. 1123).
- **Action** : u_a est supprimé.
- **Attendu** : `conversation_participants` rows de u_a supprimées. Les conversations restent (created_by FK no-action). Les messages restent avec sender_id=NULL.

### T48-REG-03 — S40 / S41 deletion cascade pas de side-effect chat
- **Action** : DELETE marketplace_product → ne touche AUCUNE conversation (pas de table/relation chat-product).
- **Attendu** : iso (à vérifier — pas de regression S48 sur cette slice).

---

## §M — Performance

### T48-PERF-01 — `GET /conversations` 100 convs sous 500ms
- **Setup** : u_a participant à 100 convs avec messages variés.
- **Action** : GET.
- **Attendu** : latence < 500 ms (grâce au batch enrich BR-48.14, sinon ~85 s avec N+1).

### T48-PERF-02 — `GET /messages` limit=100 sous 200ms
- **Setup** : conv avec 10 000 messages (joint users).
- **Action** : GET ?limit=100.
- **Attendu** : < 200 ms (grâce à l'index `idx_messages_conv`).

### T48-PERF-03 — WS chat broadcast à 50 sessions sous 100 ms
- **Setup** : group conv avec 50 sessions WS ouvertes.
- **Action** : 1 user envoie un message.
- **Attendu** : tous les 50 reçoivent dans < 100 ms (loop synchrone + send_json non-blocking dans `chat_manager.broadcast`).

---

## §N — Tableau récapitulatif

| Section | Cas | Couverture |
|---------|-----|------------|
| §A POST /conversations | 12 | types, idempotence, permissions group, 400, 401 |
| §B GET /conversations | 12 | enrich, context_deleted, soft-delete, blocked |
| §C GET /messages | 9 | pagination before, limit, mark-read, soft-delete |
| §D PUT read | 3 | nominal, idempotent, silent non-part |
| §E DELETE /messages | 6 | author, admin, 403, 404, idempotent, ordre gardes |
| §F PATCH /leave | 5 | nominal, archive, idempotent, 404, no-broadcast |
| §G WS chat | 18 | handshake, 4001/4003/4009, anti-spam, context_deleted, multi-session |
| §H WS notifications | 5 | handshake, init frames, ignore client |
| §I WS spot-you | 4 | handshake, no-check, broadcast |
| §J Intégration | 7 | propagation context_deleted, S47, S29 |
| §K Edge cases | 12 | UTF-8, race, null sender, cross-session |
| §L Régressions | 3 | S29, S40, S47 |
| §M Performance | 3 | batch enrich, index, broadcast |
| **TOTAL** | **~99 cas** | |

> Les tests doivent être exécutés via Spring Boot Test + un client WebSocket (Jetty client ou Spring `WebSocketClient`). Les cas `*-WS-*` requièrent un test runtime — pas de stub possible.
