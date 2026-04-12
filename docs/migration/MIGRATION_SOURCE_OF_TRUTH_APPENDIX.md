# MIGRATION_SOURCE_OF_TRUTH_APPENDIX.md — Annexe concise
> Généré le 2026-04-12. Complément de `MIGRATION_SOURCE_OF_TRUTH.md`.  
> Ce fichier contient uniquement les 4 tableaux de référence rapide.

---

## TABLEAU 1 — Exclusions

| # | Route | Fichier:ligne | Type d'exclusion | Redirect |
|---|---|---|---|---|
| EX-01 | `POST /api/upload-image/debug-422` | upload_routes.py:114 | Définitive | Non |
| EX-02 | `GET /api/admin/subscription-plans` | subscription_routes.py:151 | Définitive (shadow) | Non |
| EX-03 | `GET /api/admin/subscriptions` | subscription_routes.py:453 | Définitive (shadow) | Non |
| EX-04 | `GET /api/receiver/requests` | booking_routes.py:1060 | Définitive (chemin non-standard) | 301 optionnel → `/api/bookings/received` |
| EX-05 | `POST /api/bookings` | booking_routes.py:391 | Temporaire (alias rétrocompat) | 301 → `POST /api/bookings/request` |

---

## TABLEAU 2 — Aliases

| # | Path alias | Path canonique | Handler | Traitement Java | ARB |
|---|---|---|---|---|---|
| AL-01 | `GET /api/users/me/bookings` | `GET /api/bookings/me` | `my_bookings` (booking_routes.py:1035) | `@GetMapping({"/bookings/me", "/users/me/bookings"})` OU 301 | ARB-003 |
| AL-02 | `PATCH /api/services/{id}` | `PUT /api/services/{id}` | `update_service` (service_routes.py:852) | Deux annotations, un service partagé OU PUT uniquement | ARB-013 |
| AL-03 | `POST /api/spot-you/{id}/join` | `POST /api/tag-points/{id}/join` | handlers DISTINCTS (logiques différentes) | Conserver les deux OU unifier | ARB-006 |
| AL-04 | `DELETE /api/spot-you/{id}/leave` | `DELETE /api/tag-points/{id}/leave` | handlers DISTINCTS (logiques différentes) | Conserver les deux OU unifier | ARB-007 |

> Note AL-03/AL-04 : ces deux entrées ne sont PAS des aliases à proprement parler (les logiques divergent). Elles sont listées ici pour rappel — la décision finale est humaine.

---

## TABLEAU 3 — Collisions arbitrées

| # | Chemin collision | Handler retenu | Fichier:ligne | Handler exclu | Fichier:ligne | ARB |
|---|---|---|---|---|---|---|
| COL-01 | `GET /api/admin/subscriptions` | `admin_subscriptions` | payment_routes.py:497 | `admin_list_subscriptions` | subscription_routes.py:453 | ARB-001 |
| COL-02 | `GET /api/admin/subscription-plans` | `list_subscription_plans` | admin_routes.py:210 | `admin_list_plans` | subscription_routes.py:151 | ARB-002 |

**Preuve de l'ordre** (server.py) :
- payment_router → ligne 106 | subscription_router → ligne 107 → payment gagne COL-01
- admin_router → ligne 102 | subscription_router → ligne 107 → admin gagne COL-02

---

## TABLEAU 4 — Points à validation humaine

| # | ARB | Question concrète | Impact si non validé | Urgence (Slice) |
|---|---|---|---|---|
| VH-01 | ARB-001 | Le frontend admin affiche-t-il bien les champs `user_name`, `email`, `plan_name`, `plan_price` depuis `GET /admin/subscriptions` ? | Handler Java basé sur payload incomplet | Slice 16 |
| VH-02 | ARB-002 | `ORDER BY subscription_plans.created_at ASC` (admin_routes) ou `DESC` (shadow) ? | Ordre de tri légèrement différent dans l'UI admin | Slice 16 |
| VH-03 | ARB-003 | Le frontend appelle-t-il `/api/users/me/bookings` ou `/api/bookings/me` (ou les deux) ? | Si les deux → double @GetMapping obligatoire. Si un seul → simple annotation. | Slice 11 |
| VH-04 | ARB-013 | Les clients envoient-ils `PUT` avec un body complet attendant un remplacement total, ou `PATCH` est-il toujours utilisé pour des mises à jour partielles ? | Impacte la sémantique REST du ServiceController Java | Slice 8 |
| VH-05 | ARB-006 | Le frontend utilise-t-il actuellement `POST /api/spot-you/{id}/join` ? | Si non → exclure, -1 endpoint, simplification. Si oui → conserver (logique spécifique auto-ajout conversation). | Slice 6 |
| VH-06 | ARB-007 | Le frontend utilise-t-il actuellement `DELETE /api/spot-you/{id}/leave` ? | Si non → exclure, -1 endpoint. Si oui → conserver (logique annulation attendances + blocage conv). | Slice 6 |
