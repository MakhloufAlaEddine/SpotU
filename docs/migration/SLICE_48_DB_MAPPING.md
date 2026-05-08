# SLICE 48 — DB Mapping (Chat & WebSockets)

> **Source** :
> - `/app/backend/migrations/001_initial_schema.sql` (DDL initial)
> - `/app/backend/migrations/008_soft_delete_columns.sql` (colonnes soft-delete)
> - `/app/backend/migrations/010_fk_set_null_anonymization.sql` (FK SET NULL)

---

## 1. Tables WRITE/READ par S48

| Table | Mode | Usage |
|-------|------|-------|
| `conversations` | R/W | INSERT (POST /conversations), UPDATE `last_message_at` (WS chat envoi), UPDATE `deleted_at` (PATCH /leave si plus aucun actif), READ list (GET /conversations) |
| `conversation_participants` | R/W | INSERT (POST /conversations), UPDATE `status` (rejoin tagpoint_group), UPDATE `last_read_at` (GET /messages, PUT /read), UPDATE `status='left'` (PATCH /leave), READ permission, READ unread |
| `messages` | R/W | INSERT (WS chat), UPDATE `deleted_at` (DELETE /messages), READ enrich (GET /conversations + GET /messages) |
| `tag_points` | R uniquement | Lookup title + creator (POST /conversations group/private), READ context_deleted dynamique (GET /conversations), READ images (enrichissement context_image groups) |
| `services` | R uniquement | Lookup title + coach_id (POST /conversations service), READ context_deleted dynamique |
| `users` | R uniquement | LEFT JOIN sender_name + sender_picture (GET /messages, GET /conversations enrich), READ user_info au handshake WS chat (`name` + `picture`) |
| `spot_you_members` | R uniquement | Permission membership (POST /conversations type=tagpoint_group) |
| `notifications` | R uniquement | COUNT unread pour `_get_unread_notif` au handshake WS notifications |

> ⚠️ **AUCUNE écriture sur `tag_points`, `services`, `spot_you_members`, `notifications`** dans S48.

---

## 2. Schémas DDL (extraits)

### 2.1. `conversations`
```sql
CREATE TABLE public.conversations (
    conversation_id text NOT NULL,
    type            text NOT NULL,
    context_id      text NOT NULL,
    context_title   text NOT NULL,
    created_by      text,
    last_message_at timestamp with time zone DEFAULT now(),
    created_at      timestamp with time zone DEFAULT now(),
    -- Migration 008 :
    deleted_at      timestamp with time zone NULL,
    context_deleted boolean NOT NULL DEFAULT FALSE,

    CONSTRAINT conversations_pkey PRIMARY KEY (conversation_id),
    CONSTRAINT conversations_type_check CHECK (type = ANY (ARRAY[
        'service'::text, 'tagpoint_group'::text, 'tagpoint_private'::text
    ])),
    CONSTRAINT conversations_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES users(user_id)
);

CREATE INDEX idx_conversations_created_by ON public.conversations USING btree (created_by);
CREATE INDEX idx_conversations_ctx_del    ON public.conversations(context_deleted)
    WHERE context_deleted = TRUE;  -- partial index Migration 008
```

> ⚠️ **`conversation_id`, `context_id`, `created_by`** sont des `text` (pas UUID natifs PostgreSQL). Java DOIT typer ces colonnes en `String`. Pas de cast `::uuid`.

### 2.2. `conversation_participants`
```sql
CREATE TABLE public.conversation_participants (
    conversation_id text NOT NULL,
    user_id         text NOT NULL,
    joined_at       timestamp with time zone DEFAULT now(),
    last_read_at    timestamp with time zone DEFAULT now(),
    status          text NOT NULL DEFAULT 'active',

    CONSTRAINT conversation_participants_pkey
        PRIMARY KEY (conversation_id, user_id),
    CONSTRAINT conversation_participants_conversation_id_fkey
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    CONSTRAINT conversation_participants_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_conv_participants        ON public.conversation_participants USING btree (user_id);
CREATE INDEX idx_conv_participants_status ON public.conversation_participants USING btree (conversation_id, status);
```

> ⚠️ **PK composite** `(conversation_id, user_id)` — utiliser `@IdClass` ou `@Embeddable` côté JPA, ou `MapSqlParameterSource` pour Spring JdbcTemplate.
> ⚠️ **`status` valeurs observées** : `'active'`, `'blocked'`, `'left'`, `'invited'`. **PAS de CHECK constraint au DDL** — toute valeur texte techniquement acceptée. Java doit valider applicativement (enum).

### 2.3. `messages`
```sql
CREATE TABLE public.messages (
    message_id      text NOT NULL,
    conversation_id text,
    sender_id       text,
    content         text NOT NULL,
    created_at      timestamp with time zone DEFAULT now(),
    -- Migration 008 :
    deleted_at      timestamp with time zone NULL,

    CONSTRAINT messages_pkey PRIMARY KEY (message_id),
    CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id)
        REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    -- Migration 010 (override) :
    CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id)
        REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX idx_messages_conv    ON public.messages USING btree (conversation_id, created_at);
CREATE INDEX idx_messages_deleted ON public.messages(deleted_at)
    WHERE deleted_at IS NOT NULL;  -- partial index Migration 008
```

> ⚠️ **`sender_id` et `conversation_id` sont nullable** au DDL initial. Préserver côté Java (`String`, pas `@NotNull`).
> ⚠️ **`messages.sender_id` ON DELETE SET NULL** (Migration 010) → en cas d'anonymisation RGPD, le contenu reste mais `sender_id=NULL`. Java DOIT gérer ce cas dans les SELECT enrichis (`COALESCE(u.name, 'Utilisateur supprimé')`).

---

## 3. Génération d'IDs (textuels)

| Entité | Pattern | Helper Python | Java suggéré |
|--------|---------|---------------|--------------|
| `conversation_id` | `"conv_" + 12 hex chars` | `new_id("conv")` (`models.py:8`) | `"conv_" + UUID.randomUUID().toString().replace("-","").substring(0,12)` |
| `message_id` | `"msg_" + 12 hex chars` | `new_id("msg")` | `"msg_" + UUID.randomUUID().toString().replace("-","").substring(0,12)` |

> Définition Python complète :
> ```python
> def new_id(prefix: str = "") -> str:
>     suffix = uuid.uuid4().hex[:12]
>     return f"{prefix}_{suffix}" if prefix else suffix
> ```

---

## 4. Requêtes SQL exhaustives par endpoint

### 4.1. `POST /api/conversations` — type `tagpoint_group`

```sql
-- Permission
SELECT 1 FROM spot_you_members
 WHERE spot_you_id = $1 AND user_id = $2
UNION
SELECT 1 FROM tag_points
 WHERE point_id = $1 AND user_id = $2;

-- Title
SELECT title FROM tag_points WHERE point_id = $1;

-- Idempotence
SELECT conversation_id FROM conversations
 WHERE type='tagpoint_group' AND context_id = $1;

-- Si existing :
INSERT INTO conversation_participants (conversation_id, user_id, status)
VALUES ($1, $2, 'active')
ON CONFLICT (conversation_id, user_id)
DO UPDATE SET status = 'active';

-- Si nouvelle :
SELECT user_id FROM tag_points WHERE point_id = $1;     -- creator_id

INSERT INTO conversations
       (conversation_id, type, context_id, context_title, created_by)
VALUES ($1, 'tagpoint_group', $2, $3, $4);

-- Pour chaque pid in {creator_id, uid} :
INSERT INTO conversation_participants (conversation_id, user_id, status)
VALUES ($1, $2, 'active')
ON CONFLICT DO NOTHING;

-- Réponse finale :
SELECT conversation_id, type, context_id, context_title, created_by,
       last_message_at, created_at
  FROM conversations
 WHERE conversation_id = $1;
```

### 4.2. `POST /api/conversations` — type `tagpoint_private`

```sql
-- Title
SELECT title FROM tag_points WHERE point_id = $1;

-- Idempotence (1 conv per (context, user))
SELECT c.conversation_id
  FROM conversations c
  JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
 WHERE c.type = 'tagpoint_private' AND c.context_id = $1 AND cp.user_id = $2
 LIMIT 1;

-- Si nouvelle :
SELECT user_id FROM tag_points WHERE point_id = $1;     -- creator_id

INSERT INTO conversations (conversation_id, type, context_id, context_title, created_by)
VALUES ($1, 'tagpoint_private', $2, $3, $4);

-- Pour chaque pid in {creator_id, uid} (sans status — DEFAULT 'active' du DDL) :
INSERT INTO conversation_participants (conversation_id, user_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;
```

### 4.3. `POST /api/conversations` — type `service`

```sql
-- Title
SELECT title FROM services WHERE service_id = $1;

-- Idempotence
SELECT c.conversation_id
  FROM conversations c
  JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
 WHERE c.type = 'service' AND c.context_id = $1 AND cp.user_id = $2
 LIMIT 1;

-- Si nouvelle :
SELECT coach_id FROM services WHERE service_id = $1;    -- coach_id

INSERT INTO conversations (conversation_id, type, context_id, context_title, created_by)
VALUES ($1, 'service', $2, $3, $4);

-- Pour chaque pid in {coach_id, uid} :
INSERT INTO conversation_participants (conversation_id, user_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;
```

### 4.4. `GET /api/conversations`

```sql
-- Q0 : liste brute
SELECT c.conversation_id, c.type, c.context_id,
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
  LEFT JOIN tag_points tp ON c.type IN ('tagpoint_private','tagpoint_group')
                          AND tp.point_id = c.context_id
  LEFT JOIN services   svc ON c.type = 'service' AND svc.service_id = c.context_id
  JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
 WHERE cp.user_id = $1 AND c.deleted_at IS NULL
 ORDER BY c.last_message_at DESC NULLS LAST;

-- Q1 : last_message (DISTINCT ON)
SELECT DISTINCT ON (m.conversation_id)
       m.conversation_id, m.message_id,
       CASE WHEN m.deleted_at IS NOT NULL THEN '[Message supprimé]' ELSE m.content END AS content,
       m.created_at, m.sender_id,
       COALESCE(u.name, 'Utilisateur supprimé') AS sender_name
  FROM messages m
  LEFT JOIN users u ON u.user_id = m.sender_id
 WHERE m.conversation_id = ANY($1::text[])
 ORDER BY m.conversation_id, m.created_at DESC;

-- Q2 : unread_count
SELECT m.conversation_id,
       COUNT(*) FILTER (
           WHERE m.created_at > cp.last_read_at AND m.sender_id != $1
       ) AS unread_count
  FROM messages m
  JOIN conversation_participants cp
    ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
 WHERE m.conversation_id = ANY($2::text[])
 GROUP BY m.conversation_id;

-- Q3 : status caller
SELECT conversation_id, status
  FROM conversation_participants
 WHERE conversation_id = ANY($1::text[]) AND user_id = $2;

-- Q4 : other_participant (uniquement non-group)
SELECT cp.conversation_id, u.user_id, u.name, u.picture
  FROM conversation_participants cp
  JOIN users u ON u.user_id = cp.user_id
 WHERE cp.conversation_id = ANY($1::text[]) AND cp.user_id != $2;

-- Q5a : participant_count (groups)
SELECT conversation_id, COUNT(*) AS cnt
  FROM conversation_participants
 WHERE conversation_id = ANY($1::text[])
 GROUP BY conversation_id;

-- Q5b : context_image (groups)
SELECT point_id, images
  FROM tag_points
 WHERE point_id = ANY($1::text[]);
```

### 4.5. `GET /api/conversations/{conv_id}/messages`

```sql
-- Permission
SELECT 1 FROM conversation_participants
 WHERE conversation_id = $1 AND user_id = $2;

-- Lecture (avec before)
SELECT m.message_id, m.conversation_id, m.sender_id,
       CASE WHEN m.deleted_at IS NOT NULL THEN '[Message supprimé]' ELSE m.content END AS content,
       m.created_at, m.deleted_at,
       COALESCE(u.name, 'Utilisateur supprimé') AS sender_name,
       u.picture AS sender_picture
  FROM messages m
  LEFT JOIN users u ON m.sender_id = u.user_id
 WHERE m.conversation_id = $1 AND m.created_at < $2::timestamptz
 ORDER BY m.created_at DESC
 LIMIT $3;

-- Lecture (sans before)
SELECT ... FROM messages m LEFT JOIN users u ON m.sender_id = u.user_id
 WHERE m.conversation_id = $1
 ORDER BY m.created_at DESC
 LIMIT $2;

-- Mark read
UPDATE conversation_participants
   SET last_read_at = NOW()
 WHERE conversation_id = $1 AND user_id = $2;

-- Recompute unread_total (push)
SELECT COUNT(*) FROM messages m
  JOIN conversation_participants cp
    ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
 WHERE m.created_at > cp.last_read_at
   AND m.sender_id != $1;
```

### 4.6. `PUT /api/conversations/{conv_id}/read`

```sql
UPDATE conversation_participants
   SET last_read_at = NOW()
 WHERE conversation_id = $1 AND user_id = $2;

-- Recompute unread_total identique 4.5
SELECT COUNT(*) FROM messages m
  JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
 WHERE m.created_at > cp.last_read_at AND m.sender_id != $1;
```

### 4.7. `DELETE /api/messages/{message_id}`

```sql
SELECT message_id, sender_id, conversation_id, deleted_at
  FROM messages WHERE message_id = $1;

UPDATE messages SET deleted_at = NOW() WHERE message_id = $1;
```

### 4.8. `PATCH /api/conversations/{conv_id}/leave`

```sql
SELECT status FROM conversation_participants
 WHERE conversation_id = $1 AND user_id = $2;

UPDATE conversation_participants SET status = 'left'
 WHERE conversation_id = $1 AND user_id = $2;

SELECT COUNT(*) FROM conversation_participants
 WHERE conversation_id = $1 AND status = 'active';

-- Si remaining = 0
UPDATE conversations SET deleted_at = NOW()
 WHERE conversation_id = $1 AND deleted_at IS NULL;
```

### 4.9. `WS /ws/chat/{conv_id}` — handshake + steady state

```sql
-- Au handshake :
SELECT 1 FROM conversation_participants
 WHERE conversation_id = $1 AND user_id = $2 AND status = 'active';

SELECT user_id, name, picture FROM users WHERE user_id = $1;

SELECT context_deleted FROM conversations WHERE conversation_id = $1;

-- Sur chaque message envoyé (steady state) :
INSERT INTO messages (message_id, conversation_id, sender_id, content, created_at)
VALUES ($1, $2, $3, $4, $5);

UPDATE conversations SET last_message_at = $1 WHERE conversation_id = $2;

SELECT user_id FROM conversation_participants
 WHERE conversation_id = $1 AND user_id != $2 AND status = 'active';

-- Pour chaque autre participant : recalcule unread_total identique 4.5
```

### 4.10. `WS /ws/notifications` — handshake

```sql
-- unread_total (identique 4.5)
SELECT COUNT(*) FROM messages m
  JOIN conversation_participants cp
    ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
 WHERE m.created_at > cp.last_read_at AND m.sender_id != $1;

-- unread_notif
SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = FALSE;
```

### 4.11. `WS /ws/spot-you/{point_id}` — handshake
- **Aucune requête SQL** au handshake (juste `decode_jwt`).

---

## 5. Index utilisés (audit perf)

| Index | Utilisation S48 |
|-------|-----------------|
| `conversations_pkey` | Lookup direct `WHERE conversation_id = ?` (toutes routes) |
| `idx_conversations_created_by` | Non utilisé en S48 |
| `idx_conversations_ctx_del` (partial) | Optimisation : reste cohérent mais peu utilisé en S48 (le filtre `context_deleted` est dans CASE, pas WHERE) |
| `conversation_participants_pkey` (`conversation_id, user_id`) | Lookup `WHERE conversation_id = ? AND user_id = ?` (permissions, mark read) |
| `idx_conv_participants` (`user_id`) | `GET /conversations` (jointure `cp.user_id = $1`) |
| `idx_conv_participants_status` (`conversation_id, status`) | WS chat handshake (`status = 'active'`) + leave (`COUNT(*) WHERE status = 'active'`) |
| `messages_pkey` | Lookup `WHERE message_id = ?` (DELETE message) |
| `idx_messages_conv` (`conversation_id, created_at`) | GET messages, last_message DISTINCT ON, unread_count |
| `idx_messages_deleted` (partial WHERE deleted_at IS NOT NULL) | Non utilisé directement en S48 (pas de filtre `deleted_at IS NOT NULL`) |
| `idx_notifications_user` (`user_id, created_at DESC`) | WS notifications handshake (COUNT unread) |

> ⚠️ **Aucun nouvel index requis** pour S48. Les index existants couvrent toutes les requêtes.

---

## 6. Cardinalité & contraintes critiques

| Contrainte | Comportement |
|------------|--------------|
| `conversations.type` CHECK in {`service`, `tagpoint_group`, `tagpoint_private`} | Java DOIT valider applicativement (l'INSERT rejet 23514 sinon) |
| `conversation_participants.PK = (conversation_id, user_id)` | Idempotence garantie côté DB pour les `ON CONFLICT DO NOTHING / DO UPDATE` |
| `conversation_participants.conversation_id FK CASCADE` | Si une conv est hard-deleted, les participants disparaissent (S48 ne hard-delete jamais — soft seulement) |
| `messages.sender_id FK SET NULL` (Migration 010) | Sender supprimé → message reste avec `sender_id = NULL`. Java doit gérer (COALESCE name → 'Utilisateur supprimé'). |
| `messages.conversation_id FK CASCADE` | Si conv hard-deleted → messages disparaissent. Iso (mais S48 ne hard-delete pas). |

---

## 7. Patterns de migration spéciaux

### 7.1. `CASE … END AS context_deleted` (3 niveaux fallback)
```sql
CASE
    WHEN c.context_deleted = TRUE THEN TRUE                     -- (a) colonne authoritative
    WHEN c.type IN ('tagpoint_private','tagpoint_group')
         AND (tp.point_id IS NULL                                -- (b) tagpoint introuvable
              OR tp.active = FALSE                               -- (b) ou désactivé
              OR tp.deleted_at IS NOT NULL)                      -- (b) ou soft-deleted
         THEN TRUE
    WHEN c.type = 'service'
         AND (svc.service_id IS NULL                             -- (c) service introuvable
              OR svc.active = FALSE
              OR svc.deleted_at IS NOT NULL)
         THEN TRUE
    ELSE FALSE
END AS context_deleted
```

> ⚠️ **3 niveaux** : (a) colonne DB explicite (set par les routes deletion), (b) détection dynamique tag_point, (c) détection dynamique service. Java DOIT reproduire les 3 — le code Python a délibérément un fallback dynamique pour gérer les cas où `context_deleted` n'aurait pas été propagé (ex. avant migration 008).

### 7.2. `DISTINCT ON (m.conversation_id) … ORDER BY m.conversation_id, m.created_at DESC`
- PostgreSQL-only.
- Java JdbcTemplate / R2DBC : exécute la requête native `DISTINCT ON` (PG-spécifique). Ne PAS migrer vers une window function (différent comportement quand multiple rows ont même `created_at`).

### 7.3. `COUNT(*) FILTER (WHERE …)`
- PostgreSQL standard moderne (≥9.4).
- Java : conserver la syntaxe FILTER côté SQL natif. Ne PAS faire `COUNT(CASE WHEN … THEN 1 END)` (sémantique identique mais perf différente sur des plans complexes).

### 7.4. Parsing `tag_points.images` — JSONB ou string

Côté Python (l. 186–194 chat_routes.py) :
```python
imgs = r["images"]
if isinstance(imgs, str):
    try:
        imgs = json.loads(imgs)
    except Exception:
        imgs = []
ctx_image_map[r["point_id"]] = imgs[0] if imgs else None
```

> ⚠️ **`images` est `jsonb`** (cf. PRD Slice 41 §3 — confirmé par cohérence avec d'autres slices). Le `isinstance(str)` est un fallback historique pour gérer d'éventuelles colonnes restées en `text`. Java DOIT lire en `Jsonb` (PGobject) puis parser comme `List<String>`. Premier élément en fallback `null`.

---

## 8. ORM / mapping Java suggéré

```java
@Entity @Table(name = "conversations")
class Conversation {
    @Id String conversationId;
    String type;            // ENUM applicatif {SERVICE, TAGPOINT_PRIVATE, TAGPOINT_GROUP}
    String contextId;
    String contextTitle;
    String createdBy;       // nullable (FK users)
    OffsetDateTime lastMessageAt;
    OffsetDateTime createdAt;
    OffsetDateTime deletedAt;          // nullable
    @Column(name = "context_deleted") boolean contextDeleted;  // NOT NULL DEFAULT FALSE
}

@Entity @Table(name = "conversation_participants")
@IdClass(ConversationParticipantId.class)
class ConversationParticipant {
    @Id String conversationId;
    @Id String userId;
    OffsetDateTime joinedAt;
    OffsetDateTime lastReadAt;
    String status;          // ENUM applicatif {ACTIVE, BLOCKED, LEFT, INVITED}
}

@Entity @Table(name = "messages")
class Message {
    @Id String messageId;
    String conversationId;       // nullable au DDL — préserver
    String senderId;             // nullable (FK SET NULL)
    String content;
    OffsetDateTime createdAt;
    OffsetDateTime deletedAt;    // nullable
}
```

> Recommandation : pour l'enrichissement `_batch_enrich_conversations`, utiliser `JdbcTemplate` natif (5 queries `IN ANY(:ids)`) plutôt que des `@OneToMany` JPA — les performances ne sont garanties qu'avec batch SQL natif.
