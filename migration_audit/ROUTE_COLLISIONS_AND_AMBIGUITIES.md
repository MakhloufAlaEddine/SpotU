# ROUTE_COLLISIONS_AND_AMBIGUITIES.md

## 0. Ordre d’inclusion des routers (`server.py`, **certain**)

L’index ci-dessous suit l’ordre des `api_router.include_router(...)` aux lignes 94–112 de `backend/server.py` (0 = le plus tôt). En **déduit** du routage Starlette, la **première** route qui matche `(méthode, path)` est utilisée lorsque plusieurs `APIRoute` partagent la même signature.

| Index | Fichier module | Préfixe `include_router` |
|------:|----------------|---------------------------|
| 0 | `auth_routes.py` | `/auth` |
| 1 | `user_routes.py` | `/users` |
| 2 | `domain_routes.py` | *(aucun)* |
| 3 | `tagpoint_routes.py` | *(aucun)* |
| 4 | `spot_you_routes.py` | *(aucun)* |
| 5 | `home_routes.py` | *(aucun)* |
| 6 | `service_routes.py` | *(aucun)* |
| 7 | `booking_routes.py` | *(aucun)* |
| 8 | `admin_routes.py` | `/admin` |
| 9 | `chat_routes.py` | *(aucun)* |
| 10 | `push_routes.py` | `/users` |
| 11 | `upload_routes.py` | *(aucun)* |
| 12 | `payment_routes.py` | *(aucun)* |
| 13 | `subscription_routes.py` | *(aucun)* |
| 14 | `address_routes.py` | *(aucun)* |
| 15 | `marketplace_routes.py` | *(aucun)* |
| 16 | `product_creation_routes.py` | *(aucun)* |
| 17 | `admin_product_routes.py` | *(aucun)* |
| 18 | `deletion_routes.py` | *(aucun)* |

## 1. Collisions `méthode + path` (certain, AST)

### `GET` `/api/admin/subscription-plans`

- `admin_routes.py` **`list_subscription_plans`** (l.211) — ordre include ≈ **8** (plus petit = enregistré plus tôt dans la chaîne `routes/*.py` sauf `server.py`).
- `subscription_routes.py` **`admin_list_plans`** (l.152) — ordre include ≈ **13** (plus petit = enregistré plus tôt dans la chaîne `routes/*.py` sauf `server.py`).

**Gagnant déduit (premier enregistré)** : `admin_routes.py` → `list_subscription_plans`.

### `GET` `/api/admin/subscriptions`

- `payment_routes.py` **`admin_subscriptions`** (l.498) — ordre include ≈ **12** (plus petit = enregistré plus tôt dans la chaîne `routes/*.py` sauf `server.py`).
- `subscription_routes.py` **`admin_list_subscriptions`** (l.454) — ordre include ≈ **13** (plus petit = enregistré plus tôt dans la chaîne `routes/*.py` sauf `server.py`).

**Gagnant déduit (premier enregistré)** : `payment_routes.py` → `admin_subscriptions`.

### Impact migration Spring

- Une collision `(méthode, path)` doit devenir **un seul** mapping `@GetMapping` / `@RequestMapping` ; sinon erreur de mapping dupliqué ou comportement indéfini.
- Décider **quel** handler Spring porte la vérité métier, puis fusionner ou supprimer l’autre logique côté Python aujourd’hui **shadowée**.

## 2. Décorateurs multiples sur un même handler

| Fichier | Handler | Nature | Chemins |
|---------|---------|--------|--------|
| `booking_routes.py` | `my_bookings` | Alias (2 GET) | `/api/bookings/me`, `/api/users/me/bookings` |
| `booking_routes.py` | `received_bookings` | Alias (2 GET) | `/api/bookings/received`, `/api/receiver/requests` |
| `service_routes.py` | `update_service` | Double décorateur (PUT + PATCH même `{service_id}`) | Une ressource, deux verbes HTTP |

## 3. Ambiguïtés / incertitudes

| Sujet | Détail | Certitude |
|-------|--------|----------|
| Auth WebSocket | Les trois handlers (`ws_chat`, `ws_notifications`, `ws_spot_you`) font `accept()` puis **premier message JSON `{token}`** + `decode_jwt` — pas de Bearer header classique (**certain**, `chat_routes.py` ~L459–690). |
| `upload_routes.py` `UPLOADS_DIR` | Constante `/app/backend/uploads` vs `server.py` monte `ROOT_DIR/uploads` sous `/api/uploads` | déduit : deux mécanismes de stockage (upload HTTP vs fichiers servis) — cohérence à valider |
| Handler collision subscription | `subscription_routes.admin_list_plans` vs `admin_routes.list_subscription_plans` : requêtes SQL quasi identiques, tri légèrement différent | déduit |
| Handler collision subscriptions list | `payment_routes.admin_subscriptions` vs `subscription_routes.admin_list_subscriptions` : l’un sans `LIMIT`, l’autre `LIMIT 500` + sérialisation différente | certain (code) — **comportement API différent** si le second était atteint |

