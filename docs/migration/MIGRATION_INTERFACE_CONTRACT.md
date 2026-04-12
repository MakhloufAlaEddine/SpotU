# MIGRATION_INTERFACE_CONTRACT.md — Contrat d'interface figé v1
> Généré le 2026-04-12. Basé sur `ARBITRAGE_DECISIONS.md` et `RECOMMENDED_CANONICAL_SCOPE.md`.  
> **Ce document est la source de vérité pour le périmètre de migration Java/Spring Boot v1.**  
> Toute déviation doit être arbitrée et tracée dans `ARBITRAGE_DECISIONS.md`.

---

## Résumé du périmètre v1

| Catégorie | Nombre |
|---|---|
| Endpoints HTTP retenus (migration v1) | **169** |
| Endpoints WebSocket retenus | **3** |
| Endpoints infra retenus (server.py) | **4** |
| **Total migration v1** | **176** |
| Endpoints exclus temporairement (avec redirection 301) | **4** |
| Endpoints exclus définitivement | **5** |
| Aliases conservés (double path en Java) | **2** |
| Aliases supprimés | **3** |
| Collisions arbitrées | **2** |

---

## SECTION A — Endpoints HTTP retenus pour migration v1

> Préfixe global : `/api`. Auth : `AUTH` = JWT obligatoire | `OPT` = optionnel | `PUB` = public | `ADM` = admin.

### AUTH (7)
```
GET    /api/auth/native-callback         PUB
POST   /api/auth/register                PUB
POST   /api/auth/login                   PUB + rate-limit
POST   /api/auth/google                  PUB
GET    /api/auth/me                      AUTH
POST   /api/auth/logout                  AUTH
PUT    /api/auth/change-password         AUTH
```

### USERS (18)
```
GET    /api/users/profile                AUTH
PUT    /api/users/profile                AUTH
POST   /api/users/become-coach           AUTH
GET    /api/users/{userId}/public        OPT
GET    /api/users/{userId}/reviews       OPT
PUT    /api/users/{userId}/reviews/{reviewId}  AUTH
POST   /api/users/{userId}/reviews       AUTH
GET    /api/users/me/activity-feed       AUTH
POST   /api/users/{userId}/follow        AUTH
DELETE /api/users/{userId}/follow        AUTH
PATCH  /api/users/{userId}/cover         AUTH
GET    /api/users/{userId}/followers     OPT
GET    /api/users/{userId}/following     OPT
DELETE /api/users/{userId}/followers/{followerId}  AUTH
POST   /api/users/{userId}/block         AUTH
DELETE /api/users/{userId}/block         AUTH
GET    /api/users/{userId}/suggestions   AUTH
GET    /api/users/search                 OPT
```

### PUSH (2)
```
POST   /api/users/push-token             AUTH
DELETE /api/users/push-token             AUTH
```

### DOMAINS & TAGS (15)
```
GET    /api/domains                      PUB
POST   /api/domains                      ADM
PUT    /api/domains/{domainId}           ADM
GET    /api/domains/{domainId}/usage     ADM
DELETE /api/domains/{domainId}           ADM
GET    /api/tags/categories              PUB
POST   /api/tags/categories              ADM
PUT    /api/tags/categories/{categoryId} ADM
GET    /api/tags/categories/{categoryId}/usage  ADM
DELETE /api/tags/categories/{categoryId} ADM
GET    /api/tags                         PUB
POST   /api/tags                         ADM
PUT    /api/tags/{tagId}                 ADM
GET    /api/tags/{tagId}/usage           ADM
DELETE /api/tags/{tagId}                 ADM
```

### TAG-POINTS / SPOTYOU — Workflow complet (30)
```
GET    /api/tag-points                   OPT
GET    /api/tag-points/mine              AUTH
GET    /api/tag-points/saved             AUTH
GET    /api/tag-points/{pointId}         OPT
GET    /api/tag-points/{pointId}/similar OPT
POST   /api/tag-points                   AUTH
PUT    /api/tag-points/{pointId}         AUTH
PATCH  /api/tag-points/{pointId}/new-date  AUTH
POST   /api/tag-points/{pointId}/save    AUTH
DELETE /api/tag-points/{pointId}/unsave  AUTH
POST   /api/tag-points/{pointId}/join    AUTH   ← ARB-006 : logique complète (approval/private/capacité)
DELETE /api/tag-points/{pointId}/cancel-request  AUTH
POST   /api/tag-points/{pointId}/invite  AUTH
GET    /api/users/me/spotyou-invitations AUTH
POST   /api/tag-points/{pointId}/invitations/accept  AUTH
POST   /api/tag-points/{pointId}/invitations/refuse  AUTH
GET    /api/tag-points/{pointId}/join-requests  AUTH
POST   /api/tag-points/{pointId}/members/{memberId}/approve  AUTH
POST   /api/tag-points/{pointId}/members/{memberId}/reject   AUTH
DELETE /api/tag-points/{pointId}/leave   AUTH
GET    /api/tag-points/{pointId}/participants  AUTH
GET    /api/users/me/pending-requests    AUTH
GET    /api/users/me/notifications       AUTH
PATCH  /api/users/me/notifications/{notifId}/read  AUTH
PATCH  /api/users/me/notifications/read-all  AUTH
GET    /api/users/me/events              AUTH
GET    /api/users/me/planning-events     AUTH
GET    /api/tag-points/{pointId}/my-vote AUTH
POST   /api/tag-points/{pointId}/vote    AUTH
GET    /api/tag-points/{pointId}/votes   OPT
```

### SPOT-YOU — Workflow communauté directe (7)
```
POST   /api/spot-you/{pointId}/join      AUTH   ← ARB-006 : logique simplifiée (direct, pas d'approval)
DELETE /api/spot-you/{pointId}/leave     AUTH   ← ARB-007 : + annulation attendances + blocage conv
POST   /api/spot-you/{pointId}/going     AUTH
DELETE /api/spot-you/{pointId}/going     AUTH
GET    /api/spot-you/my-completion-stats AUTH
GET    /api/spot-you/{pointId}/activity  OPT
GET    /api/spot-you/{pointId}/going     PUB
```

### HOME (2)
```
GET    /api/home/nearest-sector          OPT
GET    /api/home/feed                    OPT
```

### SERVICES (10 — PUT canonique, PATCH alias — cf. ARB-005 et ARB-013)
```
GET    /api/services                     OPT
GET    /api/services/mine                AUTH
GET    /api/services/saved               AUTH
GET    /api/services/deactivated         AUTH
GET    /api/services/{serviceId}         OPT
POST   /api/services                     AUTH
PUT    /api/services/{serviceId}         AUTH   ← canonical (mise à jour complète)
PATCH  /api/services/{serviceId}         AUTH   ← alias v1 (même logique que PUT — cf. ARB-013)
DELETE /api/services/{serviceId}         AUTH
POST   /api/services/{serviceId}/reactivate  AUTH
POST   /api/services/{serviceId}/save    AUTH
DELETE /api/services/{serviceId}/unsave  AUTH
```
> Note : services compte 12 chemins distincts si PUT + PATCH sont conservés (cf. ARB-005/ARB-013). Le tableau résumé en tête utilise 10 pour PUT seul ; ajuster selon décision ARB-013.

### BOOKINGS (10 — POST /bookings exclu — cf. ARB-008)
```
POST   /api/bookings/price-preview       AUTH
POST   /api/bookings/request             AUTH   ← canonical (POST /bookings exclu, voir section C)
POST   /api/bookings/{bookingId}/accept  AUTH
POST   /api/bookings/{bookingId}/pay     AUTH
POST   /api/bookings/{bookingId}/refuse  AUTH
POST   /api/bookings/{bookingId}/cancel  AUTH
PATCH  /api/bookings/{bookingId}/status  AUTH
GET    /api/bookings/me                  AUTH
GET    /api/bookings/received            AUTH
GET    /api/bookings/{bookingId}         AUTH
```

### ADMIN (24)
```
GET    /api/admin/stats                  ADM
GET    /api/admin/users                  ADM
PUT    /api/admin/users/{userId}/role    ADM
PUT    /api/admin/users/{userId}/verify-coach  ADM
GET    /api/admin/tag-points             ADM
DELETE /api/admin/tag-points/{pointId}   ADM
GET    /api/admin/services               ADM
GET    /api/admin/pricing-rules          ADM
POST   /api/admin/pricing-rules          ADM
PUT    /api/admin/pricing-rules/{ruleId} ADM
DELETE /api/admin/pricing-rules/{ruleId} ADM
GET    /api/admin/subscription-plans     ADM   ← ARB-002 : admin_routes.py:210 wins
POST   /api/admin/subscription-plans     ADM
PUT    /api/admin/subscription-plans/{planId}   ADM
DELETE /api/admin/subscription-plans/{planId}   ADM
GET    /api/admin/domains                ADM
GET    /api/admin/tags-analytics         ADM
GET    /api/admin/all-domains            ADM
GET    /api/admin/all-categories         ADM
GET    /api/admin/all-tags               ADM
GET    /api/admin/app-config             ADM
PUT    /api/admin/app-config             ADM
POST   /api/admin/purge                  ADM
GET    /api/admin/purge/status           ADM
```

### CHAT HTTP (4)
```
POST   /api/conversations                AUTH
GET    /api/conversations                AUTH
GET    /api/conversations/{convId}/messages  AUTH
PUT    /api/conversations/{convId}/read  AUTH
```

### UPLOAD (1 — debug exclu — cf. ARB-009)
```
POST   /api/upload-image                 AUTH
```

### PAYMENTS (9)
```
GET    /api/payments/me                  AUTH
GET    /api/payments/{paymentId}         AUTH
POST   /api/payments/checkout/session    AUTH
GET    /api/payments/checkout/status/{sessionId}  AUTH
POST   /api/webhook/stripe               PUB (signature Stripe)
PATCH  /api/payments/{paymentId}/stripe  AUTH
GET    /api/admin/payments               ADM
GET    /api/admin/payments/stats         ADM
GET    /api/admin/subscriptions          ADM   ← ARB-001 : payment_routes.py:497 wins
```

### SUBSCRIPTIONS (7)
```
GET    /api/subscription-plans           PUB
GET    /api/subscriptions/me             AUTH
GET    /api/subscriptions/history        AUTH
POST   /api/subscriptions/subscribe      AUTH
POST   /api/subscriptions/cancel         AUTH
GET    /api/subscriptions/checkout/status/{sessionId}  AUTH
POST   /api/admin/subscriptions/{subscriptionId}/cancel  ADM
```

### ADDRESSES (4)
```
GET    /api/addresses                    AUTH
POST   /api/addresses                    AUTH
PUT    /api/addresses/{addressId}        AUTH
DELETE /api/addresses/{addressId}        AUTH
```

### MARKETPLACE & PRODUCTS (6)
```
GET    /api/marketplace/products         OPT
GET    /api/products/mine                AUTH
GET    /api/products/{productId}/detail  OPT
POST   /api/products                     AUTH
DELETE /api/products/{productId}         AUTH
POST   /api/products/{productId}/reactivate  AUTH
```

### ADMIN PRODUCTS (4)
```
GET    /api/admin/products/pending       ADM
GET    /api/admin/products/{productId}   ADM
POST   /api/admin/products/{productId}/approve  ADM
POST   /api/admin/products/{productId}/reject   ADM
```

### DELETION / LIFECYCLE (8)
```
DELETE /api/users/{userId}               AUTH
DELETE /api/tag-points/{pointId}         AUTH
POST   /api/tag-points/{pointId}/reactivate  AUTH
DELETE /api/messages/{messageId}         AUTH
PATCH  /api/conversations/{convId}/leave AUTH
PATCH  /api/users/{userId}/deactivate    AUTH
POST   /api/users/{userId}/reactivate    AUTH
GET    /api/users/me/reactivatable       AUTH
```

---

## SECTION B — Endpoints WebSocket retenus (3)

> Protocole d'auth : accepter connexion → attendre JSON `{"token": "..."}` dans 5 s → valider JWT → fermer `4001` si invalide. (cf. ARB-010)

```
WS  /ws/chat/{convId}       AUTH (premier message JSON)
WS  /ws/notifications       AUTH (premier message JSON)
WS  /ws/spot-you/{pointId}  AUTH (premier message JSON)
```

**Codes de fermeture standardisés** :
- `4001` : Token absent, invalide ou timeout (5 s)
- `4003` : User non membre de la conversation
- `4009` : Message > 8 Ko (anti-spam)

---

## SECTION C — Endpoints exclus temporairement (avec redirection 301)

> Ces endpoints existent actuellement en production mais NE doivent PAS être migrés en Java.  
> Implémenter une redirection HTTP 301 pendant 6 mois minimum.

| Endpoint exclu | Redirige vers | Raison (ARB) |
|---|---|---|
| `GET /api/receiver/requests` | `GET /api/bookings/received` | ARB-004 — chemin non-standard |
| `GET /api/users/me/bookings` | `GET /api/bookings/me` | ARB-003 — double-décorateur alias |
| `POST /api/bookings` | `POST /api/bookings/request` | ARB-008 — alias rétrocompat explicite |

---

## SECTION D — Endpoints exclus définitivement

> Ne pas migrer. Ne pas rediriger.

| Endpoint | Fichier | Raison |
|---|---|---|
| `POST /api/upload-image/debug-422` | `upload_routes.py:114` | ARB-009 — debug sans auth |
| `GET /api/admin/subscriptions` (subscription_routes) | `subscription_routes.py:453` | ARB-001 — route morte (shadow) |
| `GET /api/admin/subscription-plans` (subscription_routes) | `subscription_routes.py:151` | ARB-002 — route morte (shadow) |
| `PATCH /api/services/{serviceId}` (si ARB-013 → Option A) | `service_routes.py:853` | ARB-013 — si décision PUT uniquement |
| `POST /api/spot-you/{pointId}/join` (si ARB-006 → Option B) | `spot_you_routes.py:132` | ARB-006 — si unification vers tag-points |
| `DELETE /api/spot-you/{pointId}/leave` (si ARB-007 → Option B) | `spot_you_routes.py:212` | ARB-007 — si unification vers tag-points |

> Note : les 3 dernières lignes sont conditionnelles à la décision humaine.

---

## SECTION E — Endpoints infra (server.py) retenus (4)

```
GET  /api/liveness            PUB  → InfraController#liveness
GET  /api/readiness           PUB  → InfraController#readiness
GET  /api/config/booking      PUB  → ConfigController#bookingConfig
GET  /api/config/commission   PUB  → ConfigController#commissionConfig
```

---

## SECTION F — Aliases conservés en Java (double path)

| Path primaire | Path alias | Méthode Java | Raison |
|---|---|---|---|
| `GET /api/bookings/me` | `GET /api/users/me/bookings` | `@GetMapping({"/bookings/me", "/users/me/bookings"})` | ARB-003 — clients potentiels |

---

## SECTION G — Aliases supprimés

| Alias supprimé | Remplacé par | Transition |
|---|---|---|
| `GET /api/receiver/requests` | `GET /api/bookings/received` | 301 (6 mois) |
| `POST /api/bookings` | `POST /api/bookings/request` | 301 (6 mois) |
| `PATCH /api/services/{serviceId}` | `PUT /api/services/{serviceId}` | Décision conditionnelle (ARB-013) |

---

## SECTION H — Collisions arbitrées

| Collision | Handler retenu | Handler exclu |
|---|---|---|
| `GET /api/admin/subscriptions` | `payment_routes.py:497` (`admin_subscriptions`) | `subscription_routes.py:453` |
| `GET /api/admin/subscription-plans` | `admin_routes.py:210` (`list_subscription_plans`) | `subscription_routes.py:151` |

---

## SECTION I — Conventions à respecter dans Java/Spring

### Nommage
```
URL kebab-case conservé :  /api/tag-points/{pointId}  (NE PAS changer en /tagPoints/)
Path variables camelCase : {pointId}, {userId}, {serviceId}  (snake_case Python → camelCase Java)
Préfixe global /api :      conserver dans tous les controllers
```

### Ordre des mappings (statique avant paramétrique)
```java
// CORRECT — statique AVANT paramétrique dans le même @RequestMapping
@GetMapping("/mine")          // doit précéder
@GetMapping("/saved")         // doit précéder
@GetMapping("/{serviceId}")   // vient après
```
**S'applique à** : tag-points, services, bookings, spot-you, admin/products, subscriptions.

### Auth WebSocket
```
Protocole : accept() → receiveJSON({"token":...}, timeout=5s) → decodeJWT → close(4001) si échec
NE PAS utiliser query param ?token=... dans l'URL (règle de sécurité SEC-14)
```

### Codes fermeture WebSocket
```
4001 = auth échouée
4003 = accès refusé (non membre)
4009 = anti-spam (message > 8 Ko)
```

### Webhook Stripe
```
Route POST /api/webhook/stripe : PAS d'auth JWT — vérification par signature Stripe (header Stripe-Signature)
```

### Idempotency sur bookings
```
Champ idempotency_key dans BookingRequest — UNIQUE INDEX en base
Spring doit renvoyer 409 Conflict si clé déjà utilisée
```

### Rôles
```
"admin"  → @PreAuthorize("hasRole('ADMIN')")
"coach"  → @PreAuthorize("hasAnyRole('COACH','ADMIN')")
Auth opt → @AuthenticationPrincipal(required=false) UserDetails user
```
