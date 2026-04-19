# SLICE_27_API_CONTRACTS.md — Contrats API SpotYou membership
> Basé sur `tagpoint_routes.py:654–1300`.
> Généré le 2026-04-15.

---

## 1. POST /api/tag-points/{point_id}/save
Auth: **STRICTE**. Guard: SpotYou actif (404 sinon). SQL: `INSERT INTO tag_point_saves ON CONFLICT DO NOTHING`. Réponse: `{success: true, is_saved: true}`. Idempotent (ON CONFLICT).

## 2. DELETE /api/tag-points/{point_id}/unsave
Auth: **STRICTE**. SQL: `DELETE FROM tag_point_saves WHERE point_id=$1 AND user_id=$2`. Réponse: `{success: true, is_saved: false}`. Pas d'erreur si pas sauvegardé (DELETE 0 rows → success quand même).

---

## 3. POST /api/tag-points/{point_id}/join (COMPLEXE)

Auth: **STRICTE**.

### Guards séquentiels
1. SpotYou actif → 404
2. Owner ne peut pas joindre son propre SpotYou → 400
3. Déjà membre `accepted` → retour idempotent `{status: "accepted", is_participant: true, participants_count}`
4. Déjà `pending` → retour `{status: "pending", message: "...en attente..."}`
5. Déjà `invited` → retour `{status: "invited", message: "...acceptez invitation..."}`
6. `private` visibility → 403 (invitation uniquement)
7. Capacité `max_community_members` atteinte → 409

### 3 modes de join

| `visibility` | `join_mode` | Résultat | Notification |
|---|---|---|---|
| public | open | `accepted` direct | Push owner "Nouveau membre" |
| public | admin_approval | `pending` | Push owner "Nouvelle demande" |
| public | members_approval | `pending` | Push TOUS les membres "Nouvelle demande" |
| private | * | 403 | — |

### SQL (join avec approval)
```sql
INSERT INTO spot_you_members (id, spot_you_id, user_id, status, requested_by)
VALUES ($1, $2, $3, 'pending', $4)
ON CONFLICT (spot_you_id, user_id) DO UPDATE
SET status = 'pending', requested_by = EXCLUDED.requested_by
WHERE spot_you_members.status = 'rejected'
```

### SQL (join direct)
```sql
INSERT INTO spot_you_members (id, spot_you_id, user_id, status, requested_by)
VALUES ($1, $2, $3, 'accepted', $4)
ON CONFLICT (spot_you_id, user_id) DO UPDATE
SET status = 'accepted', requested_by = EXCLUDED.requested_by
WHERE spot_you_members.status = 'rejected'
```

---

## 4. DELETE /api/tag-points/{point_id}/cancel-request
Auth: **STRICTE**. Guard: membership `status='pending'` → 400 si pas pending, 404 si pas trouvé. SQL: `DELETE FROM spot_you_members WHERE ... AND status='pending'`. Réponse: `{success: true, message: "Demande annulée"}`.

---

## 5. DELETE /api/tag-points/{point_id}/leave
Auth: **STRICTE**. Guard: SpotYou existe (même inactif — leave permis sur inactif). SQL: `DELETE FROM spot_you_members WHERE spot_you_id=$1 AND user_id=$2` (DELETE physique). Push owner "Participant retiré". Réponse: `{success: true, participants_count, is_participant: false}`.

---

## 6. POST /api/tag-points/{point_id}/invite
Auth: **STRICTE**. Body: `{invited_user_id: "user_xxx"}`.

### Permission checks
| `invite_permissions` | Caller owner | Caller member accepted | Autorisé ? |
|---|---|---|---|
| `admin_only` | ✅ | ❌ 403 | Owner seul |
| `admin_and_members` | ✅ | ✅ | Owner + membres |

### Anti-doublon par status existant
| Status existant | Résultat |
|---|---|
| `accepted` | 409 "déjà membre" |
| `pending` | 409 "demande en attente" |
| `invited` | 409 "invitation en attente" |
| `rejected` | UPDATE → `invited` (réinvitation OK) |
| ∅ | INSERT `invited` |

### SQL (nouvelle invitation)
```sql
INSERT INTO spot_you_members (id, spot_you_id, user_id, status, invited_by, invited_at)
VALUES ($1, $2, $3, 'invited', $4, NOW())
```

### SQL (réinvitation après reject)
```sql
UPDATE spot_you_members
SET status='invited', invited_by=$1, invited_at=NOW(), requested_by=NULL
WHERE spot_you_id=$2 AND user_id=$3
```

Push notification à l'invité. Réponse: `{success: true, message: "Invitation envoyée à {name}"}`.

---

## 7. GET /api/users/me/spotyou-invitations
Auth: **STRICTE**. SQL: JOIN tag_points + spot_you_members (status='invited') + users inviter. Retourne array de SpotYou enrichis avec `inviter: {user_id, name, picture}`, `invited_at`, `join_status: "invited"`. Utilise `build_point_response()` (S26).

---

## 8. POST /api/tag-points/{point_id}/invitations/accept
Auth: **STRICTE**. Guard: membership `status='invited'` → 404 si absent, 409 si pas invited. SQL: `UPDATE ... SET status='accepted', joined_at=NOW()`. Push inviteur "Invitation acceptée". Réponse: `{success: true, status: "accepted", participants_count}`.

## 9. POST /api/tag-points/{point_id}/invitations/refuse
Auth: **STRICTE**. Guard: identique accept. SQL: `UPDATE ... SET status='rejected'`. Push inviteur "Invitation refusée". Réponse: `{success: true, status: "rejected"}`.

---

## 10. GET /api/tag-points/{point_id}/join-requests
Auth: **STRICTE**. Permission: owner toujours, membre accepted seulement si `join_mode='members_approval'`. SQL: `SELECT members JOIN users WHERE status='pending'`. Réponse: array `{user_id, name, picture, role, requested_at}`.

## 11. POST /api/tag-points/{point_id}/members/{member_id}/approve
Auth: **STRICTE**. Permission: `admin_approval` → owner seul, `members_approval` → owner OU membre accepted. Guard: `status='pending'` → 409 si accepted/rejected. SQL: `UPDATE ... SET status='accepted', approved_by=$1 WHERE status='pending'`. Push membre "Demande acceptée !". Réponse: `{success: true, participants_count}`.

## 12. POST /api/tag-points/{point_id}/members/{member_id}/reject
Auth: **STRICTE**. Permission: **owner seul** (+ platform admin). Guard: `status='pending'` → 409 si accepted. SQL: `UPDATE ... SET status='rejected', approved_by=$1 WHERE status='pending'`. Vérifie `UPDATE 0` → 404. Push membre "Demande refusée". Réponse: `{success: true}`.
