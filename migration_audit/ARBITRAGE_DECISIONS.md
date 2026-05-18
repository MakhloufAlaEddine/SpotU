# ARBITRAGE_DECISIONS.md

**Objectif** : figer les arbitrages nécessaires pour une migration Java/Spring **v1**, sans modifier le backend Python.

**Sources** : code (`backend/server.py`, `backend/routes/*.py`) et audits `ENDPOINTS_RECONCILIATION.md`, `ENDPOINTS_CANONICAL_LIST.md`, `ROUTE_COLLISIONS_AND_AMBIGUITIES.md`, `RECOMMENDED_CANONICAL_SCOPE.md`.

**Légende** : **certain** (vérifiable dans le dépôt) · **déduit** (convention Starlette/FastAPI non exécutée ici) · **recommandé** (choix de périmètre v1).

---

## ARB-001 — Collision `GET /api/admin/subscriptions`

| Champ | Valeur |
|-------|--------|
| **ID** | ARB-001 |
| **Type** | Collision `méthode + path` |
| **Endpoint(s)** | `GET /api/admin/subscriptions` |
| **Fichier(s)** | `payment_routes.py`, `subscription_routes.py` |
| **Handler(s)** | `admin_subscriptions` (l.~498), `admin_list_subscriptions` (l.~454) |
| **État actuel** | Deux décorateurs `@router.get` enregistrent le **même** chemin complet sous `/api` (**certain**, AST). |
| **Ambiguïté / problème** | Deux implémentations : pas de `LIMIT` côté payment vs `LIMIT 500` + `_sub_to_dict` côté subscription (**certain**, différences de code). Ordre effectif au runtime : **déduit** — `payment_router` est inclus **avant** `subscription_router` dans `server.py` (index 12 vs 13, `ROUTE_COLLISIONS_AND_AMBIGUITIES.md`). |
| **Options** | A) Porter en Spring le handler **payment** (aligné déduit runtime). B) Porter le handler **subscription** et accepter un écart avec le Python actuel tant que la collision n’est pas résolue côté Python. C) Fusionner les deux logiques métier dans un seul handler Spring après analyse produit. |
| **Recommandation** | **A** pour parité avec le comportement **déduit** aujourd’hui. |
| **Décision proposée** | **v1 Spring** : une seule opération `GET /api/admin/subscriptions` implémentée comme **`payment_routes.admin_subscriptions`** (sémantique + forme de réponse `rows_to_list`). Documenter que `admin_list_subscriptions` est **shadowé** en Python. |
| **Impact migration** | Un seul `@GetMapping` ; ne pas dupliquer le mapping. Tests de contrat sur pagination/volume à aligner avec le handler payment. |
| **Validation humaine** | **Oui** — confirmer par un appel HTTP réel (ou introspection `app.routes`) que le premier match est bien `payment_routes` ; valider côté produit si la limite 500 / format `_sub_to_dict` était attendu sur ce chemin. |

---

## ARB-002 — Collision `GET /api/admin/subscription-plans`

| Champ | Valeur |
|-------|--------|
| **ID** | ARB-002 |
| **Type** | Collision `méthode + path` |
| **Endpoint(s)** | `GET /api/admin/subscription-plans` |
| **Fichier(s)** | `admin_routes.py`, `subscription_routes.py` |
| **Handler(s)** | `list_subscription_plans` (admin, l.~211), `admin_list_plans` (subscription, l.~152) |
| **État actuel** | Même chemin complet ; les deux exigent `require_role(..., "admin")` et listent `subscription_plans` (**certain**). Tri SQL légèrement différent (**certain**). |
| **Ambiguïté / problème** | Ordre d’inclusion : `admin_router` **avant** `subscription_router` (**certain**, `server.py` L102 vs L107) → gagnant **déduit** : `admin_routes.list_subscription_plans`. |
| **Options** | A) Spring = handler **admin_routes**. B) Spring = handler **subscription** (écart avec déduit Python). C) Unifier la requête SQL après revue métier. |
| **Recommandation** | **A**. |
| **Décision proposée** | **v1 Spring** : `GET /api/admin/subscription-plans` = logique **`admin_routes.list_subscription_plans`**. |
| **Impact migration** | Un seul `@GetMapping` ; ordre de tri / champs à calquer sur `admin_routes.py`. |
| **Validation humaine** | **Oui** — confirmation runtime recommandée ; choix **B** si le produit préfère explicitement la variante `subscription_routes`. |

---

## ARB-003 — Double décorateur `PUT` + `PATCH` sur `/api/services/{service_id}`

| Champ | Valeur |
|-------|--------|
| **ID** | ARB-003 |
| **Type** | Double décorateur fonctionnel (même handler) |
| **Endpoint(s)** | `PUT /api/services/{service_id}`, `PATCH /api/services/{service_id}` |
| **Fichier(s)** | `service_routes.py` |
| **Handler(s)** | `update_service` (décorateurs L852–853, **certain**) |
| **État actuel** | Une seule fonction ; deux verbes HTTP sur la même ressource (**certain**). |
| **Ambiguïté / problème** | Aucune pour le routage : ce sont **deux** opérations distinctes au sens `(méthode, path)`. |
| **Options** | A) Exposer **PUT** et **PATCH** en Spring comme en Python. B) Ne garder qu’un verbe (cassant pour les clients utilisant l’autre). |
| **Recommandation** | **A**. |
| **Décision proposée** | **v1** : conserver **les deux** mappings Spring (`@PutMapping` + `@PatchMapping`) pointant vers la même logique de service (ou délégation interne commune). |
| **Impact migration** | Pas de fusion en un seul verbe ; documenter sémantique identique côté mise à jour partielle/totale selon contrat `ServiceUpdate`. |
| **Validation humaine** | **Non** (sauf si politique API interne impose un seul verbe). |

---

## ARB-004 — Alias « mes réservations » (`my_bookings`)

| Champ | Valeur |
|-------|--------|
| **ID** | ARB-004 |
| **Type** | Alias secondaire (deux chemins, un handler) |
| **Endpoint(s)** | `GET /api/bookings/me`, `GET /api/users/me/bookings` |
| **Fichier(s)** | `booking_routes.py` |
| **Handler(s)** | `my_bookings` (L1035–1036, **certain**) |
| **État actuel** | Docstring : « les deux chemins supportés » (**certain**). |
| **Ambiguïté / problème** | Risque de duplication involontaire en Spring si deux contrôleurs mappent le même préfixe par erreur. |
| **Options** | A) Deux routes Spring explicites vers la même méthode de service. B) Une seule route + redirection (non présente en Python). |
| **Recommandation** | **A** (parité stricte). |
| **Décision proposée** | **v1** : **conserver les deux** chemins. |
| **Impact migration** | Deux `@GetMapping` (ou équivalent) sur une logique partagée. |
| **Validation humaine** | **Non**. |

---

## ARB-005 — Alias « réservations reçues » (`received_bookings`)

| Champ | Valeur |
|-------|--------|
| **ID** | ARB-005 |
| **Type** | Alias secondaire |
| **Endpoint(s)** | `GET /api/bookings/received`, `GET /api/receiver/requests` |
| **Fichier(s)** | `booking_routes.py` |
| **Handler(s)** | `received_bookings` (L1059–1060, **certain**) |
| **État actuel** | Même logique, deux chemins (**certain**). |
| **Ambiguïté / problème** | Second chemin peu intuitif (`/api/receiver/requests`) mais utilisé côté legacy possible. |
| **Options** | A) Conserver les deux. B) Déprécier un chemin en v2 uniquement (hors scope Python inchangé). |
| **Recommandation** | **A**. |
| **Décision proposée** | **v1** : **conserver les deux** chemins. |
| **Impact migration** | Idem ARB-004. |
| **Validation humaine** | **Non** (dépréciation = décision produit ultérieure). |

---

## ARB-006 — Route morte / non exposée : `get_spot_you_members`

| Champ | Valeur |
|-------|--------|
| **ID** | ARB-006 |
| **Type** | Fonction sans décorateur `@router` |
| **Endpoint(s)** | *(aucun HTTP)* |
| **Fichier(s)** | `spot_you_routes.py` |
| **Handler(s)** | `get_spot_you_members` (~L599, **certain** : pas de route dans grep/audit) |
| **État actuel** | Non exposée sur l’API publique. |
| **Ambiguïté / problème** | Risque qu’un développeur Spring crée un endpoint « manquant » par erreur. |
| **Options** | A) **Hors périmètre v1** (aucun controller). B) Ajouter plus tard un endpoint aligné sur un besoin produit (**hors** changement Python actuel). |
| **Recommandation** | **A**. |
| **Décision proposée** | **Exclure du contrat v1** ; ne pas générer de mapping Spring tant que le Python n’expose pas la route. |
| **Impact migration** | Aucun code Spring requis ; mention dans backlog si besoin métier. |
| **Validation humaine** | **Recommandé** — confirmer avec le produit qu’aucun client ne s’appuie sur un chemin non documenté inexistant. |

---

## ARB-007 — Handlers « morts » par collision (shadowing)

| Champ | Valeur |
|-------|--------|
| **ID** | ARB-007 |
| **Type** | Code joignable **non** / **incertain** selon résolution runtime |
| **Endpoint(s)** | Mêmes que ARB-001 et ARB-002 |
| **Fichier(s)** | `subscription_routes.py` (handlers `admin_list_plans`, `admin_list_subscriptions`) |
| **Handler(s)** | Voir ARB-001 / ARB-002 |
| **État actuel** | Décorateurs présents mais **gagnant déduit** ailleurs (**déduit**). |
| **Ambiguïté / problème** | Duplication de maintenance ; risque de divergence perçue comme « bug Spring » si mal documenté. |
| **Options** | A) Spring n’implémente **que** les gagnants ARB-001/002. B) Documenter les handlers Python shadowés comme **référence métier optionnelle** (ex. limite 500). |
| **Recommandation** | **A** + note doc **B** pour ARB-001. |
| **Décision proposée** | **Ne pas** porter les handlers shadowés en second endpoint HTTP ; intégrer volontairement leur logique dans les specs/tests si le produit l’exige après validation humaine. |
| **Impact migration** | Réduction de la surface dupliquée côté Spring ; pas de changement Python. |
| **Validation humaine** | **Oui** pour ARB-001 (diff LIMIT / sérialisation). |

---

## ARB-008 — Endpoint debug `POST /api/upload-image/debug-422`

| Champ | Valeur |
|-------|--------|
| **ID** | ARB-008 |
| **Type** | Endpoint diagnostic |
| **Endpoint(s)** | `POST /api/upload-image/debug-422` |
| **Fichier(s)** | `upload_routes.py` (L114–120, **certain**) |
| **Handler(s)** | `debug_upload` |
| **État actuel** | Conservé dans le code ; commentaire « temporaire » (**certain**). |
| **Ambiguïté / problème** | Bruit pour le contrat produit / sécurité (exposition en prod). |
| **Options** | A) **Exclure temporairement** du contrat Spring v1. B) Inclure derrière un profil `debug` uniquement. |
| **Recommandation** | **A** (aligné `RECOMMENDED_CANONICAL_SCOPE.md`). |
| **Décision proposée** | **Hors périmètre v1** par défaut ; réintégration possible en profil non-prod. |
| **Impact migration** | Aucun `@PostMapping` obligatoire en v1. |
| **Validation humaine** | **Oui** si une équipe OPS impose la parité stricte « tous les chemins Python ». |

---

## ARB-009 — Racines d’upload divergentes (`UPLOADS_DIR` vs `StaticFiles`)

| Champ | Valeur |
|-------|--------|
| **ID** | ARB-009 |
| **Type** | Cohérence stockage / statique |
| **Endpoint(s)** | `POST /api/upload-image` (écriture) ; montage `GET /api/uploads/...` (**certain** : `upload_routes.py` L23–24 vs `server.py` L241–244) |
| **Fichier(s)** | `upload_routes.py`, `server.py` |
| **Handler(s)** | `upload_image` + `StaticFiles` |
| **État actuel** | `UPLOADS_DIR = Path("/app/backend/uploads")` (**certain**) ; statique sert `ROOT_DIR / "uploads"` (**certain**). |
| **Ambiguïté / problème** | En déploiement local ou si `/app/backend` ≠ `ROOT_DIR`, fichiers servis vs fichiers écrits peuvent diverger (**déduit** / **validation infra**). |
| **Options** | A) Spring : **unifier** répertoire d’écriture et de lecture pour v1 (recommandation **infra**, pas changement Python ici). B) Reproduire à l’identique les deux chemins si contrainte legacy. |
| **Recommandation** | **A** côté Spring/config déploiement ; documenter l’écart Python actuel. |
| **Décision proposée** | **Contrat v1** : `POST /api/upload-image` **retenu** ; exposition statique **`/api/uploads/**` **retenue** comme ressource technique (ResourceHandler) ; **alignement des chemins** = sujet **validation humaine / infra**, pas arbitrage code Python. |
| **Impact migration** | Variables d’environnement / volumes Kubernetes à cadrer avec ARB-009. |
| **Validation humaine** | **Oui** (obligatoire). |

---

## ARB-010 — Auth WebSocket

| Champ | Valeur |
|-------|--------|
| **ID** | ARB-010 |
| **Type** | Auth non standard (hors header Bearer à l’upgrade) |
| **Endpoint(s)** | `WS /api/ws/chat/{conv_id}`, `WS /api/ws/notifications`, `WS /api/ws/spot-you/{point_id}` |
| **Fichier(s)** | `chat_routes.py` |
| **Handler(s)** | `ws_chat`, `ws_notifications`, `ws_spot_you` (**certain** : handshake JSON `{token}` puis `decode_jwt`, voir ~L459–690) |
| **État actuel** | Auth **après** `accept()`, via premier message (**certain**). |
| **Ambiguïté / problème** | Spring Security WebSocket classique vs protocole actuel. |
| **Options** | A) Reproduire le protocole (accept + JSON token). B) STOMP + token dans headers (cassant client). |
| **Recommandation** | **A** pour parité client. |
| **Décision proposée** | **Contrat v1** : documenter **obligatoirement** le handshake `{ "token": "<jwt>" }` dans les 5 premières secondes ; codes de fermeture alignés sur Python. |
| **Impact migration** | HandshakeInterceptor ou handler custom ; tests d’intégration WS. |
| **Validation humaine** | **Non** pour le principe (**certain** dans le code) ; **oui** pour choix librairie / durcie sécurité entreprise. |

---

## ARB-011 — Endpoints techniques (infra / config / statique)

| Champ | Valeur |
|-------|--------|
| **ID** | ARB-011 |
| **Type** | Périmètre « technique » vs « métier » |
| **Endpoint(s)** | `GET /api/liveness`, `GET /api/readiness`, `GET /api/config/booking`, `GET /api/config/commission`, `GET/HEAD/… /api/uploads/**` |
| **Fichier(s)** | `server.py` (routes + `StaticFiles`) |
| **Handler(s)** | `liveness`, `readiness`, `public_booking_config`, `public_commission_config` + statique |
| **État actuel** | Quatre routes JSON sous `api_router` (**certain**) ; statique monté sur `app` (**certain**). |
| **Ambiguïté / problème** | Souvent migrés vers Actuator / config server en Spring — risque de double implémentation. |
| **Options** | A) **Retenir** les quatre GET dans le contrat v1 pour parité URL. B) Remplacer par Actuator en gardant **alias** reverse-proxy (hors code Python). |
| **Recommandation** | **A** pour parité chemins ; **B** acceptable **uniquement** si un gateway préserve les chemins `/api/liveness` etc. |
| **Décision proposée** | **v1** : **retenus** les 4 endpoints JSON infra/config ; **statique** `/api/uploads/**` = **retenu** comme surface technique (pas contrôleur métier classique). |
| **Impact migration** | Spring Boot : controllers dédiés + `ResourceHandlerRegistry` ou équivalent. |
| **Validation humaine** | **Oui** si la plateforme cible impose Actuator à la place (politique d’exploitation). |

---

## Synthèse des IDs

| ID | Sujet |
|----|--------|
| ARB-001 | Collision `GET /api/admin/subscriptions` |
| ARB-002 | Collision `GET /api/admin/subscription-plans` |
| ARB-003 | Double décorateur `PUT`/`PATCH` services |
| ARB-004 | Alias `my_bookings` |
| ARB-005 | Alias `received_bookings` |
| ARB-006 | `get_spot_you_members` sans route |
| ARB-007 | Handlers shadowés (collisions) |
| ARB-008 | Debug `upload-image/debug-422` |
| ARB-009 | Racines upload divergentes |
| ARB-010 | Auth WebSocket |
| ARB-011 | Infra / config / statique |

**Total : 11 décisions d’arbitrage documentées.**
