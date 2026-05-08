# SLICE 47 — Business Rules (Notifications inbox)

> **Source** : `/app/backend/routes/tagpoint_routes.py` l. 1350–1425

---

## 1. Visibilité utilisateur (ownership)

### Règle absolue
- Un utilisateur ne voit **que ses propres notifications** (`notifications.user_id = JWT.user_id`).
- Pas de partage, pas de visibilité admin.

### Application
| Endpoint | Filtre owner |
|----------|--------------|
| GET inbox | `WHERE n.user_id = $1` |
| PATCH single | `WHERE notif_id=$1 AND user_id=$2` (silent si pas owner) |
| PATCH all | `WHERE user_id=$1 AND read=FALSE` |

> ⚠️ **Aucun bypass admin**. Iso Python.

---

## 2. Read / Unread

### Lecture
- Le champ `read` est exposé tel quel dans la réponse GET.
- Boolean strict.

### Mark-read
- Idempotent : appeler PATCH `/read` sur une notif déjà lue → réponse 200, UPDATE 0 ligne effective, COUNT recalculé.
- Mark-all-read : idempotent (ne crashe pas si 0 unread).

### Unread count
- **Recalculé** à chaque PATCH single (`SELECT COUNT(*)`).
- **Forcé à 0** dans le broadcast WS du PATCH all (sans SELECT — asymétrie).
- **Pas exposé** via endpoint HTTP standalone.

---

## 3. Pagination

### Type
- **LIMIT seul** (pas d'offset, pas de cursor).
- Pas de `total_count` retourné.
- Pas de `has_more`.

### Défaut & contraintes
- `limit` query param, default `50`, range `[1, 200]`.
- Hors range → 422.

### Conséquence
- Le front affiche au max 200 notifs. Au-delà, **pas de mécanisme** pour récupérer les plus anciennes via cette API.
- Iso Python — ne PAS ajouter d'offset/cursor.

---

## 4. Tri

- **Toujours** `ORDER BY created_at DESC` (les plus récentes en haut).
- Pas de paramétrage du tri côté API.

---

## 5. Filtres

- **Aucun** filtre par `type`, `read`, ni date côté API.
- Le front filtre côté client si besoin.

> ⚠️ NE PAS ajouter de query params `?type=...&read_only=true` côté Java. Iso strict.

---

## 6. Champ `data` jsonb — règles

### Toujours **objet**
- Si DB `NULL` → réponse `{}`.
- Si DB string JSON valide → objet parsé.
- Si DB string JSON invalide → `{}` (fallback silencieux, pas d'erreur 500).
- Si DB déjà dict (driver auto-convertit) → utiliser tel quel (`dict(raw)` Python).

### Override `sender_picture`
- Règle stricte (cf. SLICE_47_API_CONTRACTS.md §6).
- `sender_current_picture` du JOIN écrase `data.sender_picture` **uniquement** si `IS NOT NULL`.

---

## 7. Format `created_at`

- ISO 8601 string ou `null`.
- `r["created_at"].isoformat() if r["created_at"] else None`.

---

## 8. Validation d'entrée

### GET inbox
- Query param `limit` validé Pydantic : `int, ge=1, le=200`.

### PATCH single
- `notif_id` path param : pas de validation format. Si inexistant ⇒ silent no-op (pas 404).

### PATCH all
- Aucun input.

---

## 9. WebSocket broadcast (deferred — slice future)

### Calls Python
- PATCH single : `notif_manager.notify(user_id, {"type":"unread_notif", "count": int(unread)})`.
- PATCH all   : `notif_manager.notify(user_id, {"type":"unread_notif", "count": 0})`.

### Comportement
- `notif_manager` est un `NotifManager` (cf. `chat_manager.py`) qui maintient des connexions WebSocket par `user_id` et diffuse à toutes les sessions ouvertes.
- **Fire-and-forget côté HTTP** : si la diffusion échoue (aucune session WS, erreur réseau), la réponse HTTP n'est PAS impactée.

### Recommandation Java S47
- Ajouter un service Java `NotifBroadcaster` avec une méthode `notify(userId, payload)` initialement **stub no-op**.
- Une fois la slice Chat/WS mergée (S∞), implémenter le vrai broadcast.
- Documenter le stub en Javadoc.

---

## 10. Erreurs

### Codes HTTP
| Code | Source |
|------|--------|
| 401 | JWT manquant/invalide (filtre auth) |
| 422 | `limit` hors range |

### Pas de 404
- PATCH single avec `notif_id` inconnu → 200 silent.
- Iso Python.

### Pas de 500 sur data malformé
- Le parsing dual `try/except` retourne `{}` en fallback.

---

## 11. Asymétries Python à conserver

| # | Asymétrie | Détail |
|---|-----------|--------|
| 1 | Mark-single retourne count, mark-all ne retourne PAS | `{success:true, unread_notif:N}` vs `{success:true}`. |
| 2 | Mark-all broadcast count=0 sans SELECT | Hardcodé. Pas de SELECT COUNT après. |
| 3 | Mark-single silent si pas owner | UPDATE 0 ligne, COUNT recalculé, 200 OK. |
| 4 | Override `sender_picture` uniquement si IS NOT NULL | Conserve la photo historique si compte sender supprimé. |
| 5 | `data` parsing dual | string/dict/null/malformé → fallback `{}`. |
| 6 | Pagination LIMIT seul | Pas d'offset, pas de cursor, pas de total. |
| 7 | Pas de filtres API | Filtrage côté client uniquement. |
| 8 | Endpoints regroupés dans `tagpoint_routes.py` | Implémentation Python ; côté Java, créer un controller dédié `NotificationsController`. |
| 9 | Pas d'endpoint DELETE | Notifs jamais supprimées par l'API. CASCADE user uniquement. |
| 10 | Aucun endpoint GET unread-count standalone | Comptage uniquement via WS ou via `unread_notif` du PATCH single. |

---

## 12. Synthèse des règles

| Règle | Source |
|-------|--------|
| BR-47.01 | JWT requis sur les 3 endpoints. |
| BR-47.02 | Filtrage strict par `user_id` (= JWT) — aucun bypass admin. |
| BR-47.03 | GET ordonné `created_at DESC`, LIMIT 1–200, default 50. |
| BR-47.04 | Aucun filtre query param hors `limit`. |
| BR-47.05 | `data` toujours retourné comme **objet** (jamais null). |
| BR-47.06 | Parsing `data` dual avec fallback `{}` silencieux. |
| BR-47.07 | Override `data.sender_picture` par photo actuelle (si IS NOT NULL). |
| BR-47.08 | PATCH single silent si pas owner (200 quand même). |
| BR-47.09 | PATCH single retourne `unread_notif` recalculé. |
| BR-47.10 | PATCH all retourne `{success:true}` sans count. |
| BR-47.11 | WS broadcast fire-and-forget (deferred slice WS). |
| BR-47.12 | Pas d'endpoint POST/DELETE notif. |
| BR-47.13 | Idempotence des PATCH (re-call sans erreur). |
| BR-47.14 | FK CASCADE `users → notifications`. |
| BR-47.15 | Pas de transaction explicite. |
