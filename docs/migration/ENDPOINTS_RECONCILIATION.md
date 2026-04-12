# ENDPOINTS_RECONCILIATION.md — Réconciliation comptage endpoints SpotU
> Généré le 2026-04-12. Source : grep exhaustif sur /app/backend/routes/*.py

---

## Résultats du rebalayage

| Métrique | Valeur |
|----------|--------|
| Décorateurs `@router.*` trouvés | **179** |
| Alias (double décorateur, même handler) | **3** |
| Handlers distincts | **176** (179 − 3) |
| Collisions path+méthode identiques | **2** (routes shadowed) |
| Routes distinctes réellement joignables | **174** (176 − 2 shadowed) |
| Routes HTTP distinctes joignables | **171** |
| Routes WebSocket | **3** |
| Fonctionnels-alias (paths distincts, logique partagée) | **5** |
| Routes incertaines / internes / debug | **2** |

---

## Comptage par fichier

| Fichier | Décorateurs | Handlers distincts | Notes |
|---------|------------|-------------------|-------|
| `auth_routes.py` | 7 | 7 | — |
| `user_routes.py` | 18 | 18 | préfixe `/users` |
| `push_routes.py` | 2 | 2 | préfixe `/users` (inclus dans user_router pool) |
| `domain_routes.py` | 18 | 18 | — |
| `tagpoint_routes.py` | 28 | 28 | plus gros fichier |
| `spot_you_routes.py` | 7 | 7 | — |
| `home_routes.py` | 2 | 2 | — |
| `service_routes.py` | 10 | **9** | 1 alias PUT+PATCH même handler |
| `booking_routes.py` | 11 | **9** | 2 alias double-décorateurs |
| `admin_routes.py` | 20 | 20 | préfixe `/admin` |
| `chat_routes.py` | 7 | 7 | 3 WS + 4 HTTP |
| `upload_routes.py` | 2 | 2 | dont 1 route debug |
| `payment_routes.py` | 8 | 8 | — |
| `subscription_routes.py` | 8 | 8 | 2 shadowed par collisions |
| `address_routes.py` | 4 | 4 | — |
| `marketplace_routes.py` | 1 | 1 | — |
| `product_creation_routes.py` | 5 | 5 | — |
| `admin_product_routes.py` | 4 | 4 | — |
| `deletion_routes.py` | 8 | 8 | — |
| **TOTAL** | **179** | **176** | |

---

## Les 3 alias (double décorateurs, même handler)

| Handler | Décorateur 1 | Décorateur 2 | Fichier |
|---------|-------------|-------------|---------|
| `my_bookings` | `GET /bookings/me` | `GET /users/me/bookings` | `booking_routes.py:1035-1036` |
| `received_bookings` | `GET /bookings/received` | `GET /receiver/requests` | `booking_routes.py:1059-1060` |
| `update_service` | `PUT /services/{service_id}` | `PATCH /services/{service_id}` | `service_routes.py:852-853` |

---

## Les 2 collisions (même méthode+path, handlers différents)

| Path complet | Fichier 1 (gagne) | Fichier 2 (shadowed) | Explication |
|-------------|-------------------|----------------------|-------------|
| `GET /api/admin/subscriptions` | `payment_routes.py:497` | `subscription_routes.py:453` | payment_router registered avant subscription_router (server.py l.106 < l.107) |
| `GET /api/admin/subscription-plans` | `admin_routes.py:210` | `subscription_routes.py:151` | admin_router registered avant subscription_router (server.py l.102 < l.107) |

**Impact :** `subscription_routes.py:453` et `subscription_routes.py:151` ne sont **jamais appelés** en production.

---

## Les 5 alias fonctionnels (paths distincts, logique partagée)

| Route A | Route B | Logique partagée |
|---------|---------|-----------------|
| `POST /api/tag-points/{id}/join` | `POST /api/spot-you/{id}/join` | `_do_join()` ou logique identique |
| `DELETE /api/tag-points/{id}/leave` | `DELETE /api/spot-you/{id}/leave` | même logique de départ |
| `POST /api/bookings/request` | `POST /api/bookings` | appel `_do_booking_request()` (handlers différents) |
| `GET /api/admin/subscriptions` | *(shadowed)* | voir collisions |
| `GET /api/admin/subscription-plans` | *(shadowed)* | voir collisions |

---

## Explication des écarts avec la première documentation

### Écart principal : 70 documentés → 174 réels

La première documentation sous-comptait massivement pour 4 raisons :

**1. User routes incomplètes (12 routes manquantes)**
`user_routes.py` expose 18 routes mais seule une poignée avait été détaillée. Les routes reviews, followers, following, cover, block, suggestions, remove-follower manquaient.

**2. Domain routes : uniquement les GET documentés**
`domain_routes.py` expose 18 routes (CRUD complet). Seuls 3 GET avaient été mentionnés. Les 15 PUT/DELETE/POST + usage-stats étaient absents.

**3. Tagpoint routes sous-comptées (6+ manquantes)**
`tagpoint_routes.py` (le plus gros fichier avec 28 routes) avait ~22 routes documentées. Manquaient : participants, pending-requests, my-vote, votes, et several details.

**4. Routes admin, abonnements, suppression sous-documentées**
- `admin_routes.py` : tag-points admin, services admin, domains admin absents
- `subscription_routes.py` : subscriptions/me, history, checkout/status absents
- `deletion_routes.py` : reactivatable, reactivate user absents
- `push_routes.py` : chemin INCORRECT documenté (`/api/push-token` → réel : `/api/users/push-token`)

**5. Route debug non documentée**
`POST /api/upload-image/debug-422` dans `upload_routes.py:114`

**6. Route auth non documentée**
`GET /api/auth/native-callback` dans `auth_routes.py:14`
