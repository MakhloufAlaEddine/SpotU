# ROUTE_COLLISIONS_AND_AMBIGUITIES.md
> Généré le 2026-04-12. Source : analyse exhaustive de `/app/backend/routes/*.py` + `server.py`.  
> Objectif : recenser tout ce qui peut créer de l'ambiguïté lors de la migration vers Java/Spring Boot.

---

## Table des matières

1. [Collisions réelles confirmées](#1-collisions-réelles-confirmées)
2. [Doublons de décorateur (double-decorator aliases)](#2-doublons-de-décorateur-double-decorator-aliases)
3. [Alias fonctionnels (paths distincts, logique partagée)](#3-alias-fonctionnels-paths-distincts-logique-partagée)
4. [Faux doublons (apparents uniquement, résolution par préfixe)](#4-faux-doublons-apparents-uniquement-résolution-par-préfixe)
5. [Conflits d'ordre statique vs paramétrique](#5-conflits-dordre-statique-vs-paramétrique)
6. [Routes hors `routes/*.py` (server.py direct)](#6-routes-hors-routespy-serverpydirect)
7. [Routes ambiguës / chemin inhabituel](#7-routes-ambiguës--chemin-inhabituel)
8. [Résumé des risques pour Spring Boot](#8-résumé-des-risques-pour-spring-boot)

---

## 1. Collisions réelles confirmées

> **Définition** : deux handlers différents mappés sur le même `HTTP_METHOD + PATH_COMPLET`.  
> FastAPI ne lève **pas** d'erreur : le premier handler enregistré dans `server.py` **gagne toujours**.  
> Le second handler n'est **jamais appelé** en production.

### Collision A — `GET /api/admin/subscriptions`

| Attribut | Handler 1 (GAGNE) | Handler 2 (SHADOW — mort) |
|---|---|---|
| Fichier | `payment_routes.py:497` | `subscription_routes.py:453` |
| Fonction | `admin_subscriptions` | `admin_list_subscriptions` |
| Chemin déclaré | `/admin/subscriptions` | `/admin/subscriptions` |
| Préfixe router | aucun | aucun |
| Position `server.py` | ligne 106 (`payment_router`) | ligne 107 (`subscription_router`) |
| Statut | **ACTIF** | **MORT** (jamais appelé) |

**Raison de la collision** : les deux routers sont enregistrés sans préfixe ; tous deux déclarent le même chemin `/admin/subscriptions`. Le router enregistré en premier (ligne 106) capture toujours la requête.

**Risque migration** : en Spring Boot, les deux méthodes provoqueront une `IllegalStateException` au démarrage. Il faut **décider** lequel conserver ou les fusionner.

---

### Collision B — `GET /api/admin/subscription-plans`

| Attribut | Handler 1 (GAGNE) | Handler 2 (SHADOW — mort) |
|---|---|---|
| Fichier | `admin_routes.py:210` | `subscription_routes.py:151` |
| Fonction | `get_admin_plans` | `admin_plans` |
| Chemin déclaré | `/subscription-plans` | `/admin/subscription-plans` |
| Préfixe router | `/admin` (ligne 102 server.py) | aucun |
| Chemin résolu | `/api/admin/subscription-plans` | `/api/admin/subscription-plans` |
| Position `server.py` | ligne 102 | ligne 107 |
| Statut | **ACTIF** | **MORT** (jamais appelé) |

**Raison de la collision** : `admin_routes.py` utilise le chemin relatif `/subscription-plans` et son router a le préfixe `/admin` → résolution finale identique au chemin absolu `/admin/subscription-plans` de `subscription_routes.py`.

**Risque migration** : même problème que Collision A. Ces deux handlers ont des structures de réponse potentiellement différentes ; comparer leurs corps avant de trancher.

---

## 2. Doublons de décorateur (double-decorator aliases)

> **Définition** : un seul handler Python décoré par **deux** `@router.*` distincts.  
> Les deux chemins sont actifs et appels le même code.

| Handler | Décorateur 1 (primaire) | Décorateur 2 (alias) | Fichier |
|---|---|---|---|
| `my_bookings` | `GET /api/bookings/me` | `GET /api/users/me/bookings` | `booking_routes.py:1035-1036` |
| `received_bookings` | `GET /api/bookings/received` | `GET /api/receiver/requests` | `booking_routes.py:1059-1060` |
| `update_service` | `PUT /api/services/{service_id}` | `PATCH /api/services/{service_id}` | `service_routes.py:852-853` |

**Recommandation migration** :
- Conserver **un seul** chemin par handler en Java (le chemin « primaire » ci-dessus).
- Ajouter un `@Deprecated` + redirection 301 sur l'alias si des clients l'utilisent encore.
- `PATCH /api/services/{service_id}` vs `PUT` : décider sémantiquement (PUT = remplacement total, PATCH = partiel) et adapter la logique en Java.

---

## 3. Alias fonctionnels (paths distincts, logique partagée)

> **Définition** : deux routes avec des chemins **différents** (`/tag-points/...` vs `/spot-you/...`) qui appellent la même logique métier (parfois via un helper partagé `_do_join()`).

| Route A (tag-points) | Route B (spot-you) | Logique partagée | Impact migration |
|---|---|---|---|
| `POST /api/tag-points/{point_id}/join` | `POST /api/spot-you/{point_id}/join` | Même logique de jonction (membre → communauté) | **Fusionner** en Java ou garder 2 contrôleurs séparés avec service commun |
| `DELETE /api/tag-points/{point_id}/leave` | `DELETE /api/spot-you/{point_id}/leave` | Même logique de départ (membre → quitter) | Idem |

**Note** : les routes `spot-you/*` semblent être une couche de compatibilité ajoutée ultérieurement. En Java, envisager un seul `SpotYouController` avec les deux préfixes mappés via `@RequestMapping`.

---

## 4. Faux doublons (apparents uniquement, résolution par préfixe)

> **Définition** : le grep brut de `/app/backend/routes/*.py` remonte ces chemins comme "doublons" car le path *local* au router est identique, mais le **préfixe d'enregistrement** dans `server.py` les différencie.  
> Ce ne sont **PAS** des collisions réelles.

| Path local (brut) | Fichier A → Path résolu | Fichier B → Path résolu | Statut |
|---|---|---|---|
| `GET /domains` | `domain_routes.py:11` → `/api/domains` | `admin_routes.py:286` → `/api/admin/domains` | Pas de collision (préfixes différents) |
| `GET /services` | `service_routes.py:352` → `/api/services` | `admin_routes.py:127` → `/api/admin/services` | Pas de collision |
| `GET /tag-points` | `tagpoint_routes.py:146` → `/api/tag-points` | `admin_routes.py:107` → `/api/admin/tag-points` | Pas de collision |
| `DELETE /tag-points/{point_id}` | `deletion_routes.py:260` → `/api/tag-points/{point_id}` | `admin_routes.py:118` → `/api/admin/tag-points/{point_id}` | Pas de collision |
| `GET /subscription-plans` | `subscription_routes.py:130` → `/api/subscription-plans` | `admin_routes.py:210` → `/api/admin/subscription-plans` | Pas de collision |

**Attention migration** : la colonne « fichier B » correspond toujours à `admin_routes.py`, enregistré avec `prefix="/admin"`. En Java, il sera naturel de séparer `AdminController` et les controllers publics, éliminant toute ambiguïté.

---

## 5. Conflits d'ordre statique vs paramétrique

> **Définition** : FastAPI résout les routes dans l'ordre d'enregistrement. Si une route statique (`/mine`) est déclarée **après** une route paramétrique (`/{service_id}`), le paramètre capture tout et la route statique devient injoignable.  
> **Bonne nouvelle** : dans le code actuel, l'ordre est **correct** partout. Ce tableau sert de garde-fou pour la migration Java.

### Ordre actuel (Python) — à reproduire en Spring Boot

| Groupe | Routes statiques (doivent précéder) | Route paramétrique (suit) | Ordre actuel correct ? |
|---|---|---|---|
| Tag-points | `GET /tag-points/mine` (l.228), `GET /tag-points/saved` (l.314) | `GET /tag-points/{point_id}` (l.389) | **OUI** |
| Bookings | `GET /bookings/me` (l.1035), `GET /bookings/received` (l.1059) | `GET /bookings/{booking_id}` (l.1080) | **OUI** |
| Services | `GET /services/mine` (l.416), `GET /services/saved` (l.645), `GET /services/deactivated` (l.687) | `GET /services/{service_id}` (l.718) | **OUI** |
| Spot-you | `GET /spot-you/my-completion-stats` (l.461) | `GET /spot-you/{point_id}/activity` (l.495) | **OUI** |
| Admin products | `GET /admin/products/pending` (l.43) | `GET /admin/products/{product_id}` (l.84) | **OUI** |
| Subscriptions | `GET /subscriptions/me` (l.165), `GET /subscriptions/history` (l.199) | `GET /subscriptions/checkout/status/{session_id}` (l.404) | **OUI** |

**Règle à appliquer en Spring Boot** : dans chaque `@RestController`, déclarer les méthodes avec des chemins statiques (`/mine`, `/me`, `/saved`) **avant** les méthodes avec des path variables (`/{id}`). Spring Boot utilise la spécificité du pattern, donc une route `/mine` gagne toujours sur `/{id}` — mais l'ordre explicite reste une bonne pratique.

---

## 6. Routes hors `routes/*.py` (server.py direct)

> Ces 4 routes sont déclarées **directement dans `server.py`** via `@api_router.get(...)` et **n'ont pas été comptées** dans les 179 décorateurs détectés (qui ne scannaient que `routes/*.py`).

| # | Méthode | Path complet | Fichier:ligne | Description |
|---|---|---|---|---|
| S1 | GET | `/api/liveness` | `server.py:130` | Health check Kubernetes (liveness probe) |
| S2 | GET | `/api/readiness` | `server.py:142` | Health check Kubernetes (readiness probe) |
| S3 | GET | `/api/config/booking` | `server.py:183` | Config de booking (montants, règles) |
| S4 | GET | `/api/config/commission` | `server.py:202` | Taux de commission actuel |

**Total décorateurs réels** : 179 (routes/*.py) + 4 (server.py) = **183**.

> Cela explique l'écart entre les 183 décorateurs détectés par l'outil externe et les 179 comptés par le grep sur `routes/*.py` uniquement.

**Recommandation migration** : en Java, ces 4 routes doivent être déplacées dans un `InfraController` ou `ConfigController` dédié — ne pas les laisser dans la classe principale `Application`.

---

## 7. Routes ambiguës / chemin inhabituel

| Route | Problème d'ambiguïté | Recommandation |
|---|---|---|
| `GET /api/receiver/requests` | Chemin non-standard (alias de `GET /api/bookings/received`). Chemin hors convention REST `/bookings/...`. | Supprimer en Java. Redirection 301 → `/api/bookings/received` pendant période de transition. |
| `POST /api/upload-image/debug-422` | Route de debug exposée en production. Aucune guard auth vérifiée. | Ne **pas** migrer en Java. Supprimer ou protéger derrière `@Profile("local")`. |
| `PATCH /api/payments/{payment_id}/stripe` | Nom ambigu : "stripe" dans le path vs suffixe logique. | Renommer en `/api/payments/{payment_id}/sync-stripe` pour clarté. |
| `POST /api/bookings` vs `POST /api/bookings/request` | Deux routes pour créer une réservation. `/bookings` est un alias retro-compat de `/bookings/request`. | Conserver uniquement `POST /api/bookings/request` en Java (sémantique explicite). |

---

## 8. Résumé des risques pour Spring Boot

| Risque | Niveau | Routes concernées | Action requise |
|---|---|---|---|
| Collisions réelles (2) — Spring Boot lèvera une erreur au démarrage | **CRITIQUE** | `GET /api/admin/subscriptions`, `GET /api/admin/subscription-plans` | Choisir un handler par route avant migration |
| Double-décorateurs (3) — Spring Boot interdit un handler sur 2 `@GetMapping` | **ÉLEVÉ** | `/bookings/me` + `/users/me/bookings`, `/bookings/received` + `/receiver/requests`, `PUT` + `PATCH /services/{id}` | Séparer en 2 méthodes Java ou supprimer l'alias |
| Routes hors routes/*.py (4) — risque d'omission | **MOYEN** | Liveness, Readiness, config/booking, config/commission | Recenser dans `ENDPOINTS_CANONICAL_LIST.md` complémentaire |
| Route debug exposée (1) | **MOYEN** | `POST /api/upload-image/debug-422` | Ne pas migrer, ou `@Profile("local")` |
| Alias fonctionnels (2 paires) | **BAS** | join/leave en double prefix | Décision architecturale avant migration |
| Ordre statique/paramétrique (6 groupes) | **INFORMATIF** | Tous les groupes ci-dessus | Reproduire l'ordre en Java |
