# SLICE_27_DB_MAPPING.md — Mapping base de données
> Généré le 2026-04-15.

---

## Table principale — `spot_you_members`

```sql
CREATE TABLE spot_you_members (
    id             text NOT NULL PRIMARY KEY,
    spot_you_id    text REFERENCES tag_points(point_id),
    user_id        text REFERENCES users(user_id),
    status         text DEFAULT 'pending',        -- pending, accepted, invited, rejected
    requested_by   text,                          -- user_id qui a initié (join)
    invited_by     text,                          -- user_id qui a invité
    invited_at     timestamptz,
    approved_by    text,                          -- user_id qui a approuvé/rejeté
    joined_at      timestamptz DEFAULT now(),
    UNIQUE (spot_you_id, user_id)                 -- empêche les doublons
);
```

### Opérations par endpoint

| Endpoint | Op | Colonnes | Condition |
|---|---|---|---|
| join (open) | INSERT | id, spot_you_id, user_id, status='accepted', requested_by | ON CONFLICT DO UPDATE WHERE status='rejected' |
| join (approval) | INSERT | id, spot_you_id, user_id, status='pending', requested_by | ON CONFLICT DO UPDATE WHERE status='rejected' |
| cancel-request | DELETE | — | WHERE spot_you_id, user_id, status='pending' |
| leave | DELETE | — | WHERE spot_you_id, user_id |
| invite (new) | INSERT | id, spot_you_id, user_id, status='invited', invited_by, invited_at | — |
| invite (re-invite) | UPDATE | status='invited', invited_by, invited_at, requested_by=NULL | WHERE spot_you_id, user_id (status='rejected') |
| accept invitation | UPDATE | status='accepted', joined_at=NOW() | WHERE spot_you_id, user_id (status='invited') |
| refuse invitation | UPDATE | status='rejected' | WHERE spot_you_id, user_id (status='invited') |
| approve | UPDATE | status='accepted', approved_by | WHERE spot_you_id, user_id, status='pending' |
| reject | UPDATE | status='rejected', approved_by | WHERE spot_you_id, user_id, status='pending' |

---

## Table `tag_point_saves`

```sql
CREATE TABLE tag_point_saves (
    save_id   text NOT NULL PRIMARY KEY,
    point_id  text REFERENCES tag_points(point_id),
    user_id   text REFERENCES users(user_id),
    saved_at  timestamptz DEFAULT now(),
    UNIQUE (point_id, user_id)
);
```

| Endpoint | Op |
|---|---|
| save | INSERT ON CONFLICT DO NOTHING |
| unsave | DELETE WHERE point_id, user_id |

---

## Tables lues (SELECT uniquement)

| Table | Endpoints | Colonnes |
|---|---|---|
| `tag_points` | tous | user_id, title, images, visibility_type, join_mode, invite_permissions, max_community_members, active |
| `users` | invite (target check), join-requests, my-invitations | user_id, name, picture, role |

---

## Contrainte UNIQUE clé

`UNIQUE (spot_you_id, user_id)` sur `spot_you_members` est la base de l'idempotence et du `ON CONFLICT`. C'est la contrainte la plus importante de cette slice.
