# ARBITRAGE_DECISIONS.md — Contrat d'arbitrage final avant migration Java/Spring
> Généré le 2026-04-12. Basé sur analyse du code source, `ENDPOINTS_RECONCILIATION.md`, `ROUTE_COLLISIONS_AND_AMBIGUITIES.md`, `RECOMMENDED_CANONICAL_SCOPE.md`.  
> **Aucun changement de code dans ce document.**  
> Format : `CONSTAT CERTAIN` | `DÉDUCTION` | `RECOMMANDATION` | `DÉCISION PROPOSÉE`

---

## Index des décisions

| ID | Type | Sujet | Validation humaine ? |
|---|---|---|---|
| [ARB-001](#arb-001) | Collision | GET /api/admin/subscriptions | OUI |
| [ARB-002](#arb-002) | Collision | GET /api/admin/subscription-plans | OUI |
| [ARB-003](#arb-003) | Alias double-décorateur | GET /bookings/me + GET /users/me/bookings | OUI |
| [ARB-004](#arb-004) | Alias double-décorateur | GET /bookings/received + GET /receiver/requests | NON |
| [ARB-005](#arb-005) | Alias double-décorateur | PUT + PATCH /services/{service_id} | OUI |
| [ARB-006](#arb-006) | Alias fonctionnel (logiques ≠) | POST /spot-you/{id}/join vs POST /tag-points/{id}/join | OUI |
| [ARB-007](#arb-007) | Alias fonctionnel (logiques ≠) | DELETE /spot-you/{id}/leave vs DELETE /tag-points/{id}/leave | OUI |
| [ARB-008](#arb-008) | Alias de corps | POST /bookings vs POST /bookings/request | NON |
| [ARB-009](#arb-009) | Route debug | POST /upload-image/debug-422 | NON |
| [ARB-010](#arb-010) | Auth WebSocket | Handshake JWT dans premier message JSON | NON |
| [ARB-011](#arb-011) | Chemin inhabituel | GET /api/receiver/requests | NON |
| [ARB-012](#arb-012) | Routes hors routes/*.py | 4 routes server.py (liveness, readiness, config) | NON |
| [ARB-013](#arb-013) | Sémantique HTTP | PATCH vs PUT pour mise à jour de service | OUI |

---

## ARB-001
**Type** : Collision  
**Endpoints concernés** : `GET /api/admin/subscriptions`  
**Fichiers concernés** :
- `payment_routes.py:497` — handler `admin_subscriptions` (gagne, enregistré ligne 106 dans server.py)
- `subscription_routes.py:453` — handler `admin_list_subscriptions` (mort, enregistré ligne 107)

**État actuel observé** (CONSTAT CERTAIN) :
- Les deux fichiers déclarent `@router.get("/admin/subscriptions")` sans préfixe de router.
- FastAPI enregistre `payment_routes.py:497` en premier → son handler répond TOUJOURS.
- `subscription_routes.py:453` n'est **jamais appelé** en production.
- Requête SQL de `payment_routes.py:497` : `SELECT us.*, u.name, u.email, sp.name, sp.price FROM user_subscriptions us LEFT JOIN users u LEFT JOIN subscription_plans sp ORDER BY created_at DESC`
- Requête SQL de `subscription_routes.py:453` : identique (même jointure, même ORDER BY).

**Problème de migration** :
Spring Boot lève `IllegalStateException: Ambiguous mapping` au démarrage si deux méthodes mappent le même chemin.

**Options** :
- A) Conserver uniquement `payment_routes.py:497` (handler actif).
- B) Fusionner les deux handlers en Java dans `AdminController`.
- C) Supprimer `subscription_routes.py:453` du périmètre de migration (route morte → non migrée).

**RECOMMANDATION** : Option A. Le handler `subscription_routes.py:453` est mort et la requête SQL est quasi-identique. Conserver le handler de `payment_routes.py` comme référence pour Java.

**DÉCISION PROPOSÉE** : `GET /api/admin/subscriptions` → `AdminController#getSubscriptions` basé sur `payment_routes.py:497`. Route `subscription_routes.py:453` exclue définitivement.

**Impact migration Java** : Aucun changement fonctionnel. Élimine l'ambiguïté au démarrage Spring.

**Validation humaine requise** : **OUI** — confirmer que la réponse de `payment_routes.py:497` est bien celle attendue par le frontend admin.

---

## ARB-002
**Type** : Collision  
**Endpoints concernés** : `GET /api/admin/subscription-plans`  
**Fichiers concernés** :
- `admin_routes.py:210` — handler `list_subscription_plans` (gagne, router avec prefix=/admin, enregistré ligne 102)
- `subscription_routes.py:151` — handler `admin_list_plans` (mort, enregistré ligne 107)

**État actuel observé** (CONSTAT CERTAIN) :
- `admin_routes.py:210` : `@router.get("/subscription-plans")` + router enregistré avec `prefix="/admin"` → résolution : `/api/admin/subscription-plans`
- `subscription_routes.py:151` : `@router.get("/admin/subscription-plans")` + aucun préfixe → résolution : `/api/admin/subscription-plans`
- Même chemin final. `admin_routes.py:210` enregistré en premier (ligne 102 < 107) → gagne.

**Différence SQL** (CONSTAT CERTAIN) :
- `admin_routes.py:210` : `ORDER BY priority DESC, created_at` (ASC implicite)
- `subscription_routes.py:151` : `ORDER BY priority DESC, created_at DESC`

**Problème de migration** : Même ambiguïté Spring Boot que ARB-001. De plus, les ORDER BY diffèrent légèrement.

**Options** :
- A) Conserver `admin_routes.py:210` (handler actif) avec son ORDER BY.
- B) Conserver `admin_routes.py:210` mais aligner le ORDER BY sur `created_at DESC`.
- C) Fusionner en Java.

**RECOMMANDATION** : Option A. Le handler actif est `admin_routes.py:210` ; ses résultats sont ce que le frontend voit actuellement.

**DÉCISION PROPOSÉE** : `GET /api/admin/subscription-plans` → `AdminController#getSubscriptionPlans` basé sur `admin_routes.py:210`. Route `subscription_routes.py:151` exclue définitivement.

**Impact migration Java** : Ordre de tri `created_at ASC` conservé tel quel (correspondant au comportement réel actuel).

**Validation humaine requise** : **OUI** — confirmer si `ORDER BY created_at ASC` est intentionnel ou si `DESC` était voulu.

---

## ARB-003
**Type** : Alias double-décorateur  
**Endpoints concernés** : `GET /api/bookings/me` et `GET /api/users/me/bookings`  
**Fichiers concernés** : `booking_routes.py:1035-1036` — handler unique `my_bookings`

**État actuel observé** (CONSTAT CERTAIN) :
```python
@router.get("/bookings/me")
@router.get("/users/me/bookings")
async def my_bookings(request: Request):
```
Les deux paths répondent avec la même logique, même payload de réponse.

**DÉDUCTION** : `/api/users/me/bookings` a probablement été ajouté pour cohérence avec le namespace `/users/me/...` (notifications, events, etc.). Les deux peuvent être utilisés par des clients.

**Problème de migration** : Spring Boot interdit deux `@GetMapping` sur la même méthode, ou requiert un tableau de paths explicite.

**Options** :
- A) Conserver les deux avec `@GetMapping({"/bookings/me", "/users/me/bookings"})` en Java.
- B) Conserver `/bookings/me` comme canonique, ajouter une redirection 301 depuis `/users/me/bookings`.
- C) Conserver uniquement `/users/me/bookings` (namespace cohérent avec les autres `/users/me/*`).

**RECOMMANDATION** : Option A (accepter les deux en Java via tableau de paths). Si la simplification est voulue, Option C est plus cohérente avec le reste du namespace `/users/me/*`.

**DÉCISION PROPOSÉE** : Retenir `GET /api/bookings/me` comme primaire, migrer avec `@GetMapping({"/bookings/me", "/users/me/bookings"})` jusqu'à dépréciation confirmée de l'alias.

**Impact migration Java** : Trivial. Spring supporte `@GetMapping({path1, path2})`.

**Validation humaine requise** : **OUI** — vérifier quels clients utilisent `/users/me/bookings` avant de supprimer l'alias.

---

## ARB-004
**Type** : Alias double-décorateur  
**Endpoints concernés** : `GET /api/bookings/received` et `GET /api/receiver/requests`  
**Fichiers concernés** : `booking_routes.py:1059-1060` — handler unique `received_bookings`

**État actuel observé** (CONSTAT CERTAIN) :
```python
@router.get("/bookings/received")
@router.get("/receiver/requests")
async def received_bookings(request: Request):
```

**DÉDUCTION** : `/receiver/requests` est un chemin hérité non-standard (hors namespace REST usuel). Probablement non utilisé par le frontend actuel.

**Problème de migration** : `/api/receiver/requests` ne suit pas les conventions REST (pas de ressource principale identifiable). Chemin ambigu pour un contrôleur Java.

**RECOMMANDATION** : Conserver uniquement `/api/bookings/received`. Ajouter une redirection 301 vers `/bookings/received` depuis `/receiver/requests` pour rétrocompatibilité.

**DÉCISION PROPOSÉE** : `GET /api/bookings/received` → canonical. `/api/receiver/requests` → exclusion définitive du périmètre de migration (redirection 301 optionnelle).

**Impact migration Java** : Aucun impact fonctionnel. `BookingController#receivedBookings`.

**Validation humaine requise** : **NON** — chemin clairement non-standard.

---

## ARB-005
**Type** : Alias double-décorateur  
**Endpoints concernés** : `PUT /api/services/{service_id}` et `PATCH /api/services/{service_id}`  
**Fichiers concernés** : `service_routes.py:852-853` — handler unique `update_service`

**État actuel observé** (CONSTAT CERTAIN) :
```python
@router.put("/services/{service_id}")
@router.patch("/services/{service_id}")
async def update_service(...)
```
Le handler effectue une mise à jour complète (tous les champs du body sont traités). Il n'existe pas de logique de mise à jour partielle (PATCH sémantique).

**DÉDUCTION** : `PATCH` a été ajouté par commodité côté frontend (éviter d'envoyer tous les champs). Le handler ne distingue pas PUT de PATCH.

**Problème de migration** :
- En Java/Spring, `@PutMapping` et `@PatchMapping` sont deux annotations distinctes sur deux méthodes différentes.
- Si les deux sont conservés avec la même logique, il faut deux méthodes Java appelant le même service.
- Si le PATCH était destiné à être une mise à jour partielle, la logique doit être enrichie.

**Options** :
- A) Implémenter `@PutMapping` uniquement (remplacement complet). Supprimer PATCH.
- B) Implémenter `@PutMapping` + `@PatchMapping` appelant le même service (mise à jour complète dans les deux cas).
- C) Implémenter `@PutMapping` (complet) + `@PatchMapping` (partiel, via JsonMergePatch ou champs nullable).

**RECOMMANDATION** : Option B à court terme (migration fidèle, sans changement métier). Option C à moyen terme si une mise à jour partielle est souhaitée.

**DÉCISION PROPOSÉE** : Implémenter `@PutMapping` + `@PatchMapping` appelant `ServiceService#update(...)` en Java. Comportement identique dans les deux cas pour la v1.

**Impact migration Java** : Faible. Deux méthodes, un seul service.

**Validation humaine requise** : **OUI** — confirmer si la logique PATCH partielle est souhaitée ou si les deux méthodes doivent être identiques.

---

## ARB-006
**Type** : Alias fonctionnel — logiques DIFFÉRENTES  
**Endpoints concernés** : `POST /api/spot-you/{point_id}/join` et `POST /api/tag-points/{point_id}/join`  
**Fichiers concernés** :
- `spot_you_routes.py:132` — handler `join_spot_you`
- `tagpoint_routes.py:684` — handler `join_tag_point`

**État actuel observé** (CONSTAT CERTAIN) :

| Attribut | spot_you_routes.py | tagpoint_routes.py |
|---|---|---|
| Table cible | `spot_you_members` | `spot_you_members` |
| Vérification visibilité/privé | NON | **OUI** (403 si private) |
| Modes d'adhésion (open/approval) | NON — toujours direct | **OUI** (open/admin/members) |
| Capacité max | NON | **OUI** (409 si plein) |
| Notifications admin/membres | Simple (notification owner) | Complexe (selon join_mode) |
| Vérification statut existant | Partielle (ON CONFLICT DO NOTHING) | **Complète** (accepted/pending/invited/rejected) |
| Auto-ajout conversation groupe | **OUI** | NON |
| Broadcast temps réel | OUI | OUI |

**DÉDUCTION** : `spot_you_routes.py` est une route historique plus simple (communauté directe). `tagpoint_routes.py` est la version complète avec toute la logique métier actuelle. Ces deux endpoints ne sont PAS équivalents.

**Problème de migration** : En Java, deux handlers distincts avec des logiques distinctes doivent être maintenus, ou l'un doit être migré vers l'autre.

**Options** :
- A) Migrer les deux en Java comme deux endpoints distincts (`SpotYouCommunityController#join` + `SpotYouController#join`).
- B) Déprecier `/spot-you/{id}/join`, migrer toute logique vers `/tag-points/{id}/join` (enrichi de l'auto-ajout conversation groupe).
- C) Conserver `/spot-you/{id}/join` pour le cas "communauté directe" (sans approval), `/tag-points/{id}/join` pour le cas "complet".

**RECOMMANDATION** : Option B (unification long terme). Option A (migration fidèle v1 sans risque).

**DÉCISION PROPOSÉE (v1)** : Migrer les deux en Java comme endpoints distincts. Planifier l'unification en v2 après audit des clients.

**Impact migration Java** : Deux `@PostMapping` dans deux contrôleurs (ou dans `SpotYouController` avec logique séparée).

**Validation humaine requise** : **OUI** — confirmer si `/spot-you/{id}/join` est encore utilisé par le frontend ou si c'est un endpoint legacy.

---

## ARB-007
**Type** : Alias fonctionnel — logiques DIFFÉRENTES  
**Endpoints concernés** : `DELETE /api/spot-you/{point_id}/leave` et `DELETE /api/tag-points/{point_id}/leave`  
**Fichiers concernés** :
- `spot_you_routes.py:212` — handler `leave_spot_you`
- `tagpoint_routes.py:1264` — handler `leave_tag_point`

**État actuel observé** (CONSTAT CERTAIN) :

| Attribut | spot_you_routes.py | tagpoint_routes.py |
|---|---|---|
| Suppression spot_you_members | OUI | OUI |
| Annulation attendances futures | **OUI** (spot_you_attendance) | À vérifier |
| Blocage conversation groupe | **OUI** (status='blocked') | À vérifier |
| Broadcast temps réel (going_count, is_full) | **OUI** (données riches) | Basique |
| Vérification owner | OUI (403) | OUI (403) |

**DÉDUCTION** : `spot_you_routes.py` contient davantage d'effets de bord (annulation attendances, blocage conversation, broadcast enrichi). Ces effets manquent dans `tagpoint_routes.py`.

**Problème de migration** : Si la logique de `spot_you_routes.py` est plus complète, les clients qui appellent `/tag-points/{id}/leave` peuvent ne pas bénéficier des effets de bord (annulation attendances, etc.).

**RECOMMANDATION** : Option B (unification) : enrichir `/tag-points/{id}/leave` avec les effets de bord de `spot_you_routes.py` dans la v1 Java. Option A (migration fidèle) : conserver les deux distincts.

**DÉCISION PROPOSÉE (v1)** : Migrer les deux endpoints distincts en Java. Planifier l'unification en v2.

**Impact migration Java** : Identique à ARB-006.

**Validation humaine requise** : **OUI** — même décision que ARB-006 (les deux endpoints forment un couple).

---

## ARB-008
**Type** : Alias de corps  
**Endpoints concernés** : `POST /api/bookings` et `POST /api/bookings/request`  
**Fichiers concernés** : `booking_routes.py:385-394`

**État actuel observé** (CONSTAT CERTAIN) :
```python
@router.post("/bookings/request")
async def request_booking(data: BookingRequest, request: Request):
    return await _do_booking_request(data, request)

@router.post("/bookings")
async def create_booking(data: BookingCreate, request: Request):
    return await _do_booking_request(data, request)
```
`BookingCreate` et `BookingRequest` ont **exactement les mêmes champs** (vérifié par introspection : `['service_id', 'scheduled_at', 'slot_id', 'location_id', 'notes', 'idempotency_key', 'payment_mode']`).  
Commentaire dans le code : `# BookingCreate = alias rétrocompat`.

**Problème de migration** : Deux endpoints REST distincts appelant la même logique avec le même modèle de corps. Risque de duplication inutile.

**Options** :
- A) Conserver uniquement `POST /api/bookings/request` en Java (endpoint v2 sémantiquement explicite).
- B) Conserver les deux en Java (`@PostMapping({"/bookings", "/bookings/request"}`).

**RECOMMANDATION** : Option A. `POST /bookings` est explicitement marqué `rétrocompat` dans le code.

**DÉCISION PROPOSÉE** : Migrer uniquement `POST /api/bookings/request` → `BookingController#createBooking`. Ajouter redirection 301 depuis `POST /api/bookings` pendant 6 mois.

**Impact migration Java** : Aucun impact fonctionnel.

**Validation humaine requise** : **NON** — commentaire dans le code confirme le caractère rétrocompat.

---

## ARB-009
**Type** : Route debug  
**Endpoint concerné** : `POST /api/upload-image/debug-422`  
**Fichier concerné** : `upload_routes.py:114`

**État actuel observé** (CONSTAT CERTAIN) :
```python
@router.post("/upload-image/debug-422")
async def debug_upload(request: Request):
    """Endpoint temporaire pour diagnostiquer les 422 sur upload."""
    ct = request.headers.get("content-type", "")
    body = await request.body()
    logger.warning(f"[DEBUG-422] content-type={ct} body_len={len(body)} ...")
    return {"content_type": ct, "body_len": len(body), "body_start": body[:100].hex()}
```
- **Aucune vérification d'authentification** (pas de `require_auth`).
- Retourne le contenu brut du body (potentiellement des données sensibles).
- Marqué "temporaire" dans le docstring.

**Problème de migration** : Route debug exposée en production sans auth. Risque de sécurité si migrée.

**DÉCISION PROPOSÉE** : **Ne pas migrer.** Supprimer du périmètre définitivement.

**Impact migration Java** : Aucun.

**Validation humaine requise** : **NON** — clairement temporaire et non sécurisé.

---

## ARB-010
**Type** : Auth WebSocket  
**Endpoints concernés** : `/ws/chat/{conv_id}`, `/ws/notifications`, `/ws/spot-you/{point_id}`  
**Fichier concerné** : `chat_routes.py:459, 606, 666`

**État actuel observé** (CONSTAT CERTAIN) :
Le mécanisme d'authentification WebSocket est **identique sur les 3 handlers** :
```
1. websocket.accept()           # Accepter sans auth (requis protocole WS)
2. asyncio.wait_for(websocket.receive_json(), timeout=5.0)  # Attendre {"token": "..."}
3. decode_jwt(token)            # Valider le JWT
4. websocket.close(code=4001)  # Si timeout ou token invalide
```
**Le token ne transite JAMAIS dans l'URL.** Il passe dans le premier message JSON post-connexion.

**Codes de fermeture** :
- `4001` : Auth échouée (timeout, token invalide, user_id manquant)
- `4003` : Accès refusé (user non membre de la conversation)
- `4009` : Anti-spam (message > 8 Ko)

**Problème de migration** : Spring Boot WebSocket utilise par défaut `HttpHandshakeInterceptor` avec headers HTTP (pas JSON post-connexion). La reproduction exacte requiert un `WebSocketHandler` custom.

**RECOMMANDATION** :
Implémenter un `AuthenticatedWebSocketHandler` abstrait en Java qui :
1. Accepte la connexion sans auth
2. Attend un message JSON `{"token": "..."}` dans un `CompletableFuture` avec timeout 5 secondes
3. Valide le JWT via `JwtService#decode`
4. Ferme avec code `1008` (Policy Violation) si auth échoue (note : WebSocket standard ne supporte pas 4001, nécessite SockJS ou code custom)

**DÉCISION PROPOSÉE** : Reproduire le pattern JSON auth dans chaque `WebSocketHandler` Java. Documenter le protocole client : **le premier message après connexion doit être `{"token": "..."}` dans les 5 secondes.**

**Impact migration Java** : Non-trivial. Implique un handler custom Spring WebSocket.

**Validation humaine requise** : **NON** — constat technique clair.

---

## ARB-011
**Type** : Chemin inhabituel  
**Endpoint concerné** : `GET /api/receiver/requests`  
**Fichier concerné** : `booking_routes.py:1060`

**État actuel observé** (CONSTAT CERTAIN) :
- Alias de `GET /api/bookings/received` (même handler, même réponse).
- Chemin `/receiver/requests` ne suit pas les conventions REST standard.
- Aucune ressource principale identifiable dans le path.

**DÉCISION PROPOSÉE** : Exclusion définitive du périmètre de migration. Redirection 301 optionnelle.

**Impact migration Java** : Aucun.

**Validation humaine requise** : **NON**.

---

## ARB-012
**Type** : Routes hors routes/*.py  
**Endpoints concernés** : 4 routes déclarées directement dans `server.py`  
**Fichier concerné** : `server.py:130, 142, 183, 202`

**État actuel observé** (CONSTAT CERTAIN) :

| Route | Ligne | Rôle |
|---|---|---|
| `GET /api/liveness` | 130 | Kubernetes liveness probe |
| `GET /api/readiness` | 142 | Kubernetes readiness probe |
| `GET /api/config/booking` | 183 | Config bookings (TTL, montants) exposée au frontend |
| `GET /api/config/commission` | 202 | Taux de commission |

Ces 4 routes ne figuraient PAS dans le scan des `routes/*.py` → sont absentes des 179 décorateurs initialement documentés. Elles constituent l'écart entre 179 (grep routes/) et 183 (total réel).

**DÉCISION PROPOSÉE** :
- `GET /api/liveness` + `GET /api/readiness` → `InfraController` en Java
- `GET /api/config/booking` + `GET /api/config/commission` → `ConfigController` en Java

**Impact migration Java** : Ne pas oublier de les inclure dans le périmètre. Ne pas les laisser dans la classe principale `Application.java`.

**Validation humaine requise** : **NON**.

---

## ARB-013
**Type** : Sémantique HTTP  
**Endpoint concerné** : `PUT /api/services/{service_id}` vs `PATCH /api/services/{service_id}`  
**Fichier concerné** : `service_routes.py:852-853`

**État actuel observé** (CONSTAT CERTAIN) :
Le handler Python effectue une mise à jour par champs : il lit le body et ne met à jour que les champs fournis (`IF field IS NOT NULL → update`). Il n'existe pas de remplacement complet (pas de DELETE + INSERT).

**DÉDUCTION** : La sémantique réelle est `PATCH` (mise à jour partielle). Le `PUT` a été ajouté par commodité ou erreur de nommage.

**Problème de migration** : En Java, `@PutMapping` implique sémantiquement un remplacement complet. Si le comportement réel est partiel, l'utilisation de `@PutMapping` est techniquement incorrecte (mais fonctionnellement acceptable à court terme).

**Options** :
- A) Java : `@PatchMapping` uniquement (aligné sur la sémantique réelle).
- B) Java : `@PutMapping` + `@PatchMapping` avec même logique (fidèle à l'actuel).
- C) Java : `@PutMapping` (remplacement complet, enrichir la logique) + `@PatchMapping` (partiel, logique actuelle).

**RECOMMANDATION** : Option A si la sémantique doit être correcte. Option B si migration fidèle sans risque.

**DÉCISION PROPOSÉE** : Implémenter `@PatchMapping` (sémantique réelle) + `@PutMapping` (alias fidèle, même logique) pour la v1. Planifier la suppression de `@PutMapping` en v2.

**Impact migration Java** : Faible.

**Validation humaine requise** : **OUI** — confirmer si des clients envoient `PUT` avec un body complet et s'attendent à un remplacement intégral.
