# SLICE 47 — DB Mapping (Notifications inbox)

> **Source** : `/app/backend/routes/tagpoint_routes.py` + `/app/backend/migrations/001_initial_schema.sql`

---

## 1. Tables impactées

| Table | GET inbox | PATCH single | PATCH all |
|-------|:---------:|:------------:|:---------:|
| `notifications` | SELECT | UPDATE + SELECT COUNT | UPDATE |
| `users` | LEFT JOIN (sender picture) | — | — |

---

## 2. Schéma `notifications`

```sql
CREATE TABLE public.notifications (
    notif_id    text NOT NULL,                    -- PK
    user_id     text,                             -- FK users ON DELETE CASCADE
    type        text NOT NULL,                    -- libre, ex: 'booking_request', 'spot_you_invite', ...
    title       text NOT NULL,
    body        text NOT NULL,
    data        jsonb DEFAULT '{}'::jsonb,
    read        boolean DEFAULT false,
    created_at  timestamptz DEFAULT now()
);

ALTER TABLE notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (notif_id);

-- Index optimal pour GET inbox
CREATE INDEX idx_notifications_user
    ON notifications USING btree (user_id, created_at DESC);

-- FK
user_id → users(user_id) ON DELETE CASCADE
```

### Colonnes — usage S47

| Colonne | Type | GET | PATCH single | PATCH all | Notes |
|---------|------|:---:|:------------:|:---------:|-------|
| `notif_id` | text PK | SELECT | WHERE | — | renommé `id` côté JSON |
| `user_id` | text FK | WHERE | WHERE (owner) | WHERE (owner) | extrait JWT |
| `type` | text | SELECT | — | — | libre |
| `title` | text | SELECT | — | — | |
| `body` | text | SELECT | — | — | |
| `data` | jsonb | SELECT | — | — | parsing dual côté Java |
| `read` | boolean | SELECT | UPDATE TRUE | UPDATE TRUE | DEFAULT false |
| `created_at` | timestamptz | SELECT, ORDER BY DESC | — | — | DEFAULT now() |

---

## 3. Requêtes SQL textuelles

### GET /users/me/notifications
```sql
SELECT n.notif_id, n.type, n.title, n.body, n.data, n.read, n.created_at,
       u.picture as sender_current_picture
  FROM notifications n
  LEFT JOIN users u ON u.user_id = (n.data->>'sender_id')
 WHERE n.user_id = $1
 ORDER BY n.created_at DESC
 LIMIT $2
```
- `$1` : user_id JWT.
- `$2` : limit (int, range 1–200).
- LEFT JOIN volontaire (pas de filtre supplémentaire si `data->>'sender_id'` est NULL ou inexistant dans users).

### PATCH single read
```sql
UPDATE notifications
   SET read = TRUE
 WHERE notif_id = $1 AND user_id = $2
```
Puis :
```sql
SELECT COUNT(*) FROM notifications
 WHERE user_id = $1 AND read = FALSE
```

### PATCH read-all
```sql
UPDATE notifications
   SET read = TRUE
 WHERE user_id = $1 AND read = FALSE
```
> **Pas** de SELECT COUNT après (le code Python broadcast `count: 0` hardcodé).

---

## 4. Index & performance

### Index existant
- `idx_notifications_user` sur `(user_id, created_at DESC)` — idéal pour `GET inbox` (filtre + tri).

### Pas d'index sur (user_id, read)
- Les requêtes COUNT et UPDATE filtrant `user_id + read=FALSE` peuvent scanner via l'index `(user_id, created_at DESC)` (préfixe `user_id` exploité, puis filtre `read` en heap).
- Acceptable pour des volumes < 10k notifs par user.
- ⚠️ Iso Python — **NE PAS** ajouter d'index sans mesure.

### LEFT JOIN `users.picture` via `data->>'sender_id'`
- Pas d'index spécifique sur `(data->>'sender_id')`.
- PostgreSQL utilise l'index PK `users(user_id)` pour la jointure.
- Acceptable.

---

## 5. JSONB `data`

### Stockage
- Type `jsonb` (PostgreSQL natif).
- Default `'{}'::jsonb`.
- Contenu **arbitraire** selon le `type` de notif. Exemples :
  - `{"sender_id": "usr_xxx", "sender_picture": "...", "spot_you_id": "tp_xxx"}`
  - `{"booking_id": "bkg_xxx", "service_title": "..."}`
  - `{}`

### Lecture côté Java
1. PostgreSQL retourne soit un `String` JSON, soit un `PGobject`, selon driver.
2. Parsing dual à reproduire :
   ```java
   JsonNode data;
   if (raw == null || (raw instanceof String s && s.isEmpty())) {
       data = OBJECT_MAPPER.createObjectNode();
   } else if (raw instanceof String s) {
       try {
           data = OBJECT_MAPPER.readTree(s);
           if (!data.isObject()) data = OBJECT_MAPPER.createObjectNode();
       } catch (JsonProcessingException e) {
           data = OBJECT_MAPPER.createObjectNode();
       }
   } else {
       data = OBJECT_MAPPER.valueToTree(raw);  // Map → JsonNode
   }
   ```

### Override `data.sender_picture`
```java
if (senderCurrentPicture != null) {
    ((ObjectNode) data).put("sender_picture", senderCurrentPicture);
}
```

---

## 6. FKs & Cascades

| FK | Cible | Action |
|----|-------|--------|
| `user_id` | `users(user_id)` | `ON DELETE CASCADE` |

### Conséquences
- Hard delete user → toutes ses notifications supprimées (CASCADE).
- Pas d'autre FK dans la table (data.sender_id est juste un texte JSONB, pas une vraie FK).

---

## 7. Concurrence

- Pas de lock dans le code Python.
- UPDATE atomique. Race condition possible entre :
  - User mark-read une notif (UPDATE).
  - Worker push insère une nouvelle notif unread (INSERT).
  - Le SELECT COUNT après UPDATE peut voir la nouvelle.
- Iso Python — non bloquant fonctionnellement.

---

## 8. Transactions

### Comportement Python actuel
- **Aucun** `async with conn.transaction():`.
- Chaque endpoint = 1 ou 2 requêtes simples.
- L'UPDATE et le SELECT COUNT du PATCH single sont **séquentiels mais non atomiques**.

### Recommandation Java
- `@Transactional` **optionnel** sur PATCH single (cohérence COUNT post-UPDATE).
- Sans transaction explicite, la race avec un INSERT concurrent est tolérable.

---

## 9. Effets de bord SQL ordonnés

### GET inbox
```
1. SELECT (avec LEFT JOIN users)
```

### PATCH single read
```
1. UPDATE notifications SET read=TRUE WHERE notif_id=$1 AND user_id=$2
2. SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND read=FALSE
3. (deferred WS) notif_manager.notify(user_id, {type:"unread_notif", count})
```

### PATCH read-all
```
1. UPDATE notifications SET read=TRUE WHERE user_id=$1 AND read=FALSE
2. (deferred WS) notif_manager.notify(user_id, {type:"unread_notif", count:0})
```

---

## 10. Pas d'INSERT côté S47

- **Aucun endpoint POST** ne crée de notification dans le scope S47.
- Les INSERTs proviennent de :
  - `media_notif_worker.py`
  - `spot_you_notif_worker.py`
  - `admin_product_reminder_worker.py`
  - `webhook_handlers.py`
  - `push_service.py`
  - Endpoints booking/payments/services (push fire-and-forget après actions métier)
- Ces writers restent côté Python et alimentent la même table.
- Côté Java, S47 lit ce que les writers Python écrivent — pas de désynchro tant que la DB est partagée.

> ⚠️ La migration future des writers (Java) est hors scope S47. Elle sera traitée slice par slice (chaque domaine migrant ses notifs).
