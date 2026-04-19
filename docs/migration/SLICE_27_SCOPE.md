# SLICE_27_SCOPE.md — Cadrage de la Slice 27
> Basé sur `tagpoint_routes.py:654–1300`.
> Généré le 2026-04-15.

---

## Flow choisi — SpotYou membership lifecycle complet (11 endpoints)

### Cible

Documenter le cycle de vie complet des interactions sociales SpotYou : save/unsave, rejoindre (3 modes), inviter, accepter/refuser invitation, lister/approuver/rejeter demandes, quitter. C'est une **machine d'états** à 4 statuts (`pending`, `accepted`, `invited`, `rejected`) qui ne peut pas être fragmentée.

| # | Méthode | Chemin API | Auth | Sous-domaine |
|---|---|---|---|---|
| 1 | POST | `/api/tag-points/{id}/save` | STRICTE | Save |
| 2 | DELETE | `/api/tag-points/{id}/unsave` | STRICTE | Save |
| 3 | POST | `/api/tag-points/{id}/join` | STRICTE | **Join** (3 modes) |
| 4 | DELETE | `/api/tag-points/{id}/cancel-request` | STRICTE | Join |
| 5 | DELETE | `/api/tag-points/{id}/leave` | STRICTE | Leave |
| 6 | POST | `/api/tag-points/{id}/invite` | STRICTE | **Invite** |
| 7 | GET | `/api/users/me/spotyou-invitations` | STRICTE | Invite |
| 8 | POST | `/api/tag-points/{id}/invitations/accept` | STRICTE | Invite |
| 9 | POST | `/api/tag-points/{id}/invitations/refuse` | STRICTE | Invite |
| 10 | GET | `/api/tag-points/{id}/join-requests` | STRICTE | **Modération** |
| 11 | POST | `/api/tag-points/{id}/members/{mid}/approve` | STRICTE | Modération |
| 12 | POST | `/api/tag-points/{id}/members/{mid}/reject` | STRICTE | Modération |

---

## Machine d'états membership

```
                              join (open)
    ∅ ──────────────────────────────────────── accepted ←─── invite + accept
    │                                              ↑
    │  join (approval needed)                      │ approve
    └─────────────── pending ──────────────────────┤
    │                   │                          │
    │                   │ reject                   │
    │                   ▼                          │
    │               rejected ←── refuse            │
    │                   │                          │
    │                   │ re-join / re-invite       │
    │                   └──────────→ pending / invited
    │
    └── invite ──────── invited ───── accept ──── accepted
                           │
                           │ refuse
                           ▼
                        rejected
    
    accepted ── leave ── ∅ (DELETE physique)
```

---

## Justification du choix

| Critère | Justification |
|---|---|
| **Machine d'états indivisible** | 4 statuts + 8 transitions — fragmenter = états incohérents |
| **Blocker front #2** | Les interactions sociales sont le cœur de SpotYou — après la navigation (S26) |
| **Notifications push** | 8/11 endpoints émettent des push notifications — établit le pattern Java @Async |
| **Capacité + permissions** | max_community_members, join_mode, invite_permissions — logique métier critique |
| **ON CONFLICT patterns** | Gestion re-join après reject via `ON CONFLICT DO UPDATE WHERE status='rejected'` |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `tagpoint_routes.py` | 654–681 | save / unsave |
| `tagpoint_routes.py` | 684–855 | join (3 modes) + cancel-request |
| `tagpoint_routes.py` | 862–963 | invite |
| `tagpoint_routes.py` | 966–1004 | my invitations (read) |
| `tagpoint_routes.py` | 1007–1103 | accept / refuse invitation |
| `tagpoint_routes.py` | 1107–1261 | join-requests (read) + approve + reject |
| `tagpoint_routes.py` | 1264–1300 | leave |
| `push_service.py` | `send_push_to_user` | Notifications push (fire-and-forget) |

---

## Dépendances

| Dépendance | Type | Endpoints |
|---|---|---|
| Table `tag_point_saves` | DB (INSERT/DELETE) | save, unsave |
| Table `spot_you_members` | DB (INSERT/UPDATE/DELETE/SELECT) | join, cancel, leave, invite, accept, refuse, approve, reject, requests |
| Table `tag_points` | DB (SELECT) | tous (vérification active + propriétaire + modes) |
| Table `users` | DB (SELECT) | invite (target check), requests (names) |
| `push_service.send_push_to_user` | Service async | join, invite, accept, refuse, approve, reject, leave |
| `_first_image()` | Helper (S26) | Extraction image pour notifications |
| `build_point_response()` | Helper (S26) | my-invitations |
| `TP_FIELDS` | Projection (S26) | my-invitations |

---

## Niveau de risque

**MOYEN.**

| Point | Risque |
|---|---|
| ON CONFLICT DO UPDATE WHERE status='rejected' | MOYEN — PostgreSQL spécifique |
| Push notifications async fire-and-forget | FAIBLE — @Async en Java |
| Permission checks (join_mode × invite_permissions) | FAIBLE — logique conditionnelle |
| Capacity check (race condition) | FAIBLE — pas de lock, acceptable pour MVP |

---

## Résumé ultra court

- **Flow choisi** : SpotYou membership lifecycle complet — 11 endpoints couvrant save, join (3 modes), invite, accept/refuse, approve/reject, leave
- **Tables touchées** : `spot_you_members` (INSERT/UPDATE/DELETE), `tag_point_saves` (INSERT/DELETE), `tag_points` (SELECT), `users` (SELECT)
- **Top 3 pièges** :
  1. **3 modes de join** : `open` → accepted direct, `admin_approval` → pending + notif owner, `members_approval` → pending + notif tous les membres — logique conditionnelle complexe
  2. **ON CONFLICT DO UPDATE WHERE status='rejected'** : permet de re-soumettre une demande après rejet — PostgreSQL spécifique, pas standard SQL
  3. **Push notifications fire-and-forget** : `asyncio.create_task(send_push_to_user(...))` — ne bloque pas la réponse, erreur silencieuse — en Java : `@Async` ou `CompletableFuture.runAsync()`
- **Raison du choix** : machine d'états indivisible, cœur des interactions sociales SpotYou, établit le pattern notifications push Java
