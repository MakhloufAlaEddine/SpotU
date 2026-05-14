# SLICE_27_IMPLEMENTED — SpotYou membership (cycle complet)

Implémentation alignée sur `backend/routes/tagpoint_routes.py` (save, join, invitations, modération, leave) et les documents `SLICE_27_*`.

## Endpoints livrés

| Méthode | Chemin |
|---------|--------|
| POST | `/api/tag-points/{pointId}/save` |
| DELETE | `/api/tag-points/{pointId}/unsave` |
| POST | `/api/tag-points/{pointId}/join` |
| DELETE | `/api/tag-points/{pointId}/cancel-request` |
| DELETE | `/api/tag-points/{pointId}/leave` |
| POST | `/api/tag-points/{pointId}/invite` (body JSON `{"invited_user_id":"…"}`) |
| GET | `/api/users/me/spotyou-invitations` |
| POST | `/api/tag-points/{pointId}/invitations/accept` |
| POST | `/api/tag-points/{pointId}/invitations/refuse` |
| GET | `/api/tag-points/{pointId}/join-requests` |
| POST | `/api/tag-points/{pointId}/members/{memberId}/approve` |
| POST | `/api/tag-points/{pointId}/members/{memberId}/reject` |

## Fichiers principaux

- `modules/spotyou/api/SpotYouMembershipController.java` — routes tag-points
- `modules/users/api/UserProfileController.java` — `GET …/spotyou-invitations`
- `modules/spotyou/service/SpotYouMembershipService.java` — machine d’états + permissions
- `modules/spotyou/infra/SpotYouMembershipRepository.java` — JDBC (save, membres, upsert join)
- `modules/spotyou/service/SpotYouPushSideEffectService.java` — `@Async`, persistance notification
- `modules/spotyou/dto/InviteBody.java` — corps d’invitation
- `SpotuApplication.java` — `@EnableAsync`

## Tables touchées

- `tag_point_saves` — save / unsave
- `spot_you_members` — join, cancel, leave, invite, accept/refuse, approve/reject
- `tag_points` — lecture (guards, modes, capacité, visibilité)
- `users` — noms / cibles invitation / join-requests
- `notifications` — effet de bord push (sans Expo)

## Machine d’états et transitions couvertes

Statuts : `pending`, `accepted`, `invited`, `rejected`.

- Join public `open` → `accepted` (+ push owner si pas soi-même)
- Join `admin_approval` / `members_approval` → `pending` (+ push owner ou tous les membres acceptés)
- Join `private` → **403**
- Rejoin après `rejected` → `UPDATE` rejected puis `INSERT` (équivalent `ON CONFLICT DO UPDATE WHERE status='rejected'`)
- Idempotence : `accepted` / `pending` / `invited` → réponses Python sans erreur
- `cancel-request` : **DELETE** si `pending` uniquement
- `leave` : **DELETE** membre même SpotYou **inactif** ; push owner si ce n’est pas l’owner
- Invite : anti-doublons `accepted` / `pending` / `invited` → **409** ; `rejected` → UPDATE réinvitation
- Accept / refuse invitation : garde `invited` ; sinon **409** avec statut actuel ; absent → **404**
- `join-requests` : owner toujours ; membre accepté seulement si `join_mode=members_approval`
- Approve : `admin_approval` → owner seul ; `members_approval` → owner ou membre accepté
- Reject : **owner** ou **rôle JWT `admin`** (plateforme), comme Python `user.get("role") != "admin"`

## Tests

- `SpotYouMembershipIntegrationTest` — scénarios nominaux, 403/409/404, permissions, invitations
- Ajustements de comptage sur données partagées : `TagPointReadIntegrationTest`, `PublicProfileIntegrationTest` (points actifs supplémentaires `tp_s27_*` dans `test-data-users.sql`)

## Écarts / limites documentés

1. **Expo push** : non branché ; seule la ligne `notifications` est écrite de façon asynchrone (équivalent partiel de `send_push_to_user`).
2. **Postgres `ON CONFLICT … WHERE`** : implémentation JDBC **UPDATE puis INSERT** (+ catch intégrité) pour rester compatible **H2** en tests.
3. **`invited_at` dans la liste des invitations** : format ISO Java vs chaîne brute possible côté Python.
4. **`join_mode=open` avec ligne `pending` résiduelle** : même permissivité d’approve que Python (pas de garde supplémentaire).

## Blocages

Aucun blocage technique identifié pour le cycle front (auth + JSON + états).
