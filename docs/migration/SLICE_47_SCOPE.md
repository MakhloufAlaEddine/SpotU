# SLICE 47 — Notifications inbox (in-app)

> **Statut** : À implémenter en Java/Spring Boot
> **Source unique de vérité** :
> - `/app/backend/routes/tagpoint_routes.py` l. 1350–1425
> - `/app/backend/migrations/001_initial_schema.sql` (table `notifications`)
> - `/app/backend/chat_manager.py` (`notif_manager` — référence WS, deferred)
> **Domaine** : Notifications / Agenda — première slice (inbox in-app)
> **Précédentes slices** : domaines déjà migrés (auth, users, SpotYou, booking, payments, subscriptions, marketplace, services S42–S46)

---

## 1. Constat factuel

Le backend Python expose **3 endpoints** dédiés aux notifications in-app utilisateur, tous regroupés dans `tagpoint_routes.py` malgré le scope « notifications générales » (transverse SpotYou, bookings, services, marketplace, …).

| # | Méthode | Path | Handler |
|---|---------|------|---------|
| 1 | `GET`   | `/api/users/me/notifications` | `get_my_notifications` (l. 1350) |
| 2 | `PATCH` | `/api/users/me/notifications/{notif_id}/read` | `mark_notification_read` (l. 1394) |
| 3 | `PATCH` | `/api/users/me/notifications/read-all` | `mark_all_notifications_read` (l. 1413) |

> ⚠️ **Aucun endpoint DELETE** : impossible de supprimer une notification côté Python. Pas d'inventaire à inventer côté Java.
> ⚠️ **Aucun endpoint GET unread-count standalone** : le compteur unread est diffusé uniquement via WebSocket `notif_manager` (slice future Chat/WS).

---

## 2. Endpoints choisis pour S47

✅ Les **3 endpoints HTTP** ci-dessus.

> Cette slice ferme entièrement le sous-domaine « inbox notifications in-app ». Les autres sous-domaines (planning-events, activity-feed, push-token, agenda bookings) sont **hors scope S47** (cf. §3).

---

## 3. Endpoints **EXCLUS** de S47

| Endpoint | Slice cible / N/A | Justification |
|----------|-------------------|---------------|
| `GET /api/users/me/planning-events` (l. 1462) | **S48 (Planning/Agenda)** | Logique calendrier date/timezone complexe, joint attendance + tag_points. |
| `GET /api/users/me/events` (l. 1428) | **S48** | Idem. |
| `GET /api/users/me/activity-feed` (l. 377 user_routes) | **S49 (Activity Feed social)** | Fil d'activité, agrégation 80+80 lignes + dédup, scope distinct. |
| `POST /api/push-token` + `DELETE /api/push-token` (push_routes) | **Slice push tokens** (mineure) | Gestion tokens FCM/APNS, indépendant de l'inbox in-app. |
| `WebSocket /ws/notifications` (chat_routes l. 606) | **Bloc Chat / WS** (gros) | Diffusion live unread_count, dépend de l'infra chat_manager. |
| `DELETE /notifications/{id}` | **N/A** | N'existe pas en Python, ne pas inventer. |
| `GET /notifications/unread-count` | **N/A** | N'existe pas en HTTP, **uniquement via WS**. |

---

## 4. Fichiers Python concernés

| Fichier | Lignes | Rôle |
|---------|--------|------|
| `/app/backend/routes/tagpoint_routes.py` | 1350–1391 | `get_my_notifications` |
| `/app/backend/routes/tagpoint_routes.py` | 1394–1410 | `mark_notification_read` |
| `/app/backend/routes/tagpoint_routes.py` | 1413–1425 | `mark_all_notifications_read` |
| `/app/backend/migrations/001_initial_schema.sql` | (table `notifications`) | Schéma |
| `/app/backend/chat_manager.py` | (instance `notif_manager`) | Broadcast WS unread_count (référence — deferred) |

> **Aucune modification** ne doit être apportée à ces fichiers — strict mode documentation-only.

---

## 5. Auth & Permissions

| Action | Auth | Permission |
|--------|------|------------|
| GET inbox | JWT requis | Tout authentifié — filtrage strict par `user_id` (= JWT) |
| PATCH single read | JWT requis | Idem (filtre `WHERE notif_id=? AND user_id=?` ⇒ silent si pas owner) |
| PATCH read-all | JWT requis | Idem (filtre `WHERE user_id=?`) |

> ⚠️ Aucune restriction de rôle. Aucune notion d'admin (un admin n'accède PAS à la boîte d'un autre utilisateur via ces endpoints).

---

## 6. Dépendances

### Côté Java (déjà en place)
- Middleware JWT (S1+).
- Pool PostgreSQL.
- Repository générique pour `users` (lecture jointe pour `sender_current_picture`).

### Référence (deferred)
- `notif_manager.notify(user_id, payload)` — méthode du chat_manager Python qui diffuse via WebSocket un événement `{type: "unread_notif", count: N}` à toutes les sessions WS de l'utilisateur.
  - **Côté Java** : à stub / no-op tant que la slice Chat/WS n'est pas mergée. La réponse HTTP est **indépendante** de cette diffusion.

---

## 7. Niveau de risque

🟢 **FAIBLE-MOYEN**

| Risque | Impact |
|--------|--------|
| 🟢 Schéma simple | 1 table, 8 colonnes, FK CASCADE users. |
| 🟢 Pagination via LIMIT seul | Pas d'offset, pas de cursor. Iso. |
| 🟠 JOIN `LEFT JOIN users ON u.user_id = (n.data->>'sender_id')` | JSONB extraction inline ; à reproduire **strictement** côté Java. |
| 🟠 Parsing `data` dual (string OR dict) | Le code Python try/except json.loads avec fallback dict si déjà parsé. À reproduire. |
| 🟠 Override `data.sender_picture` par photo actuelle | Iso : la photo stockée est ignorée si une photo actuelle existe. |
| 🟢 WS broadcast deferred | À stub. Réponse HTTP non bloquante. |
| 🟢 Pas de transaction | Updates simples atomiques. |

---

## 8. Justification du choix

1. **Bloc le plus utile au front** : la cloche notifications est visible sur tous les écrans connectés (header). Sans S47, le front reste captif Python pour cette UI critique.
2. **Self-contained** : 3 endpoints, 1 table, 0 dépendance externe (sauf WS broadcast qui est fire-and-forget et stubable).
3. **Petite slice** : ~80 lignes Python, idéale après la séquence Services Coach (S42–S46) avant les gros blocs Chat/WS et Agenda.
4. **Débloque l'agenda futur** : les notifications déclenchées par les bookings/payments alimentent déjà cette inbox côté Python. Une fois S47 mergée, la cohérence inbox est stable côté Java même si les writers (workers, webhooks) restent Python.
5. **Pas de WS strict** : le broadcast `notif_manager.notify` est purement « UX en plus » — la réponse HTTP, elle, contient déjà `unread_notif` count pour single read. Pas besoin d'attendre la slice WS.

---

## 9. Critères de Done

- [ ] `GET /users/me/notifications` retourne max `limit` notifs ordonnées DESC, format JSON cohérent (cf. `SLICE_47_API_CONTRACTS.md`).
- [ ] `LEFT JOIN users` enrichit `data.sender_picture` avec la photo **actuelle** (pas celle stockée).
- [ ] `data` parsing dual (string / dict / null → `{}`) reproduit.
- [ ] `PATCH /notifications/{id}/read` met à jour la ligne **uniquement si owner**, retourne `{success, unread_notif: count}`.
- [ ] `PATCH /notifications/read-all` met à jour toutes les unread du user, retourne `{success}`.
- [ ] Cas owner : tous les endpoints sont étanches (filtre `user_id = JWT`).
- [ ] Validation `limit` Pydantic-like : `1 <= limit <= 200`, default 50.
- [ ] Cohérence après mark-read : un GET subséquent reflète `read=true`.
- [ ] WS broadcast `notif_manager.notify` stubbé jusqu'à slice Chat/WS (ne PAS bloquer la réponse HTTP).
- [ ] Tests d'intégration TC-S47-* tous verts.
- [ ] Aucun nouvel endpoint exposé.
