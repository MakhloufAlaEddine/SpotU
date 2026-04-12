# MIGRATION_SOURCE_OF_TRUTH.md — Source de vérité finale v1
> Généré le 2026-04-12. Basé sur : scan direct du code source + ENDPOINTS_RECONCILIATION.md + ARBITRAGE_DECISIONS.md + MIGRATION_INTERFACE_CONTRACT.md.  
> **Ce document prévaut sur tous les documents précédents en cas de divergence.**  
> Aucun code modifié.

---

## A. PÉRIMÈTRE FINAL v1

### Comptages officiels

| Catégorie | Nombre | Base de calcul |
|---|---|---|
| Endpoints HTTP retenus (handlers Java) | **169** | routes/*.py, après exclusions |
| Endpoints HTTP avec PATCH /services (si ARB-013 retenu) | **170** | +1 selon décision humaine |
| Endpoints WebSocket retenus | **3** | chat_routes.py |
| Endpoints infra retenus (server.py) | **4** | server.py direct |
| **Total v1 (base 169)** | **176** | 169 + 4 + 3 |
| **Total v1 (si PATCH retenu)** | **177** | 170 + 4 + 3 |

### Synthèse des exclusions

| Type | Nombre | Détail |
|---|---|---|
| Exclus définitivement (pas de redirect) | **3** | debug-422, 2 shadows |
| Exclus temporairement (301 redirect) | **3** | receiver/requests, POST /bookings, users/me/bookings |
| Alias conservés (double-mapping Java) | **1** | GET /bookings/me + GET /users/me/bookings |
| Collisions arbitrées | **2** | admin/subscriptions, admin/subscription-plans |
| Décisions humaines bloquantes | **6** | ARB-001, 002, 003, 005, 006, 007 |

---

## B. CONVENTION DE COMPTAGE

### Pourquoi 169 et pas un autre nombre ?

Le scan brut du code source produit **183 décorateurs** au total :
- `routes/*.py` : **179** décorateurs
- `server.py` direct : **4** décorateurs

De ces 183, on retranche :

```
183 total
 - 3  WebSocket (WS)              → comptés séparément
 - 4  server.py infra             → comptés séparément
= 176 HTTP decorators dans routes/*.py
```

De ces 176 HTTP dans routes/*.py :

```
176 HTTP bruts
 - 1  debug-422                   → aucune auth, jamais migré
 - 2  shadows (sub. plans, subs)  → jamais appelés en production
 - 1  GET /receiver/requests      → alias non-standard, exclu (301 optionnel)
 - 1  POST /bookings              → alias rétrocompat, exclu (301)
 - 1  GET /users/me/bookings      → double-mapping du même handler que GET /bookings/me,
                                    non compté comme handler séparé
 - 1  PATCH /services/{id}        → même handler que PUT (ARB-013), comptabilisé
                                    dans la note séparée si retenu
= 169 handlers HTTP canoniques    → PÉRIMÈTRE v1
```

### Règles de comptage stables

| Cas | Convention |
|---|---|
| Double décorateur (même handler, 2 paths HTTP identiques) | 1 seul handler compté. Le second path via `@GetMapping({p1, p2})` ou 301. |
| Deux méthodes HTTP différentes sur même path (PUT + PATCH) | 2 endpoints distincts si méthodes différentes — sauf si même handler ET même body (ARB-013). |
| Route morte (shadow) | 0 endpoint — jamais joignable en production. |
| Route debug sans auth | 0 endpoint — exclue définitivement. |
| Alias fonctionnel (même logique, paths différents) | 2 endpoints si logiques divergent (spot-you vs tag-points). 1 si logiques identiques. |
| Routes infra server.py | Comptées séparément, non incluses dans les 169. |
| WebSocket | Comptées séparément, non incluses dans les 169. |

---

## C. CANON OFFICIEL DE MIGRATION

### C1 — Liste canonique des 169 handlers HTTP à migrer

> Préfixe global `/api`. Format : `MÉTHODE  /chemin  [FICHIER:LIGNE]`

**AUTH (7)**
```
GET    /auth/native-callback                       auth_routes.py:14
POST   /auth/register                              auth_routes.py:26
POST   /auth/login                                 auth_routes.py:45  ← rate-limit
POST   /auth/google                                auth_routes.py:60
GET    /auth/me                                    auth_routes.py:92
POST   /auth/logout                                auth_routes.py:98
PUT    /auth/change-password                       auth_routes.py:105
```

**USERS (18)**
```
GET    /users/profile                              user_routes.py:11
PUT    /users/profile                              user_routes.py:33
POST   /users/become-coach                         user_routes.py:84
GET    /users/{userId}/public                      user_routes.py:99
GET    /users/{userId}/reviews                     user_routes.py:238
PUT    /users/{userId}/reviews/{reviewId}          user_routes.py:262
POST   /users/{userId}/reviews                     user_routes.py:310
GET    /users/me/activity-feed                     user_routes.py:377
POST   /users/{userId}/follow                      user_routes.py:494
DELETE /users/{userId}/follow                      user_routes.py:512
PATCH  /users/{userId}/cover                       user_routes.py:525
GET    /users/{userId}/followers                   user_routes.py:568
GET    /users/{userId}/following                   user_routes.py:592
DELETE /users/{userId}/followers/{followerId}      user_routes.py:616
POST   /users/{userId}/block                       user_routes.py:632
DELETE /users/{userId}/block                       user_routes.py:654
GET    /users/{userId}/suggestions                 user_routes.py:667
GET    /users/search                               user_routes.py:798
```

**PUSH (2)**
```
POST   /users/push-token                           push_routes.py:15
DELETE /users/push-token                           push_routes.py:57
```

**DOMAINS & TAGS (15)**
```
GET    /domains                                    domain_routes.py:11
POST   /domains                                    domain_routes.py:22
PUT    /domains/{domainId}                         domain_routes.py:174
GET    /domains/{domainId}/usage                   domain_routes.py:200
DELETE /domains/{domainId}                         domain_routes.py:222
GET    /tags/categories                            domain_routes.py:36
POST   /tags/categories                            domain_routes.py:88
PUT    /tags/categories/{categoryId}               domain_routes.py:244
GET    /tags/categories/{categoryId}/usage         domain_routes.py:273
DELETE /tags/categories/{categoryId}               domain_routes.py:297
GET    /tags                                       domain_routes.py:102
POST   /tags                                       domain_routes.py:143
PUT    /tags/{tagId}                               domain_routes.py:323
GET    /tags/{tagId}/usage                         domain_routes.py:343
DELETE /tags/{tagId}                               domain_routes.py:359
```

**TAG-POINTS (30)**
```
GET    /tag-points                                 tagpoint_routes.py:146
GET    /tag-points/mine                            tagpoint_routes.py:228
GET    /tag-points/saved                           tagpoint_routes.py:314
GET    /tag-points/{pointId}                       tagpoint_routes.py:389
GET    /tag-points/{pointId}/similar               tagpoint_routes.py:554
POST   /tag-points/{pointId}/save                  tagpoint_routes.py:654
DELETE /tag-points/{pointId}/unsave                tagpoint_routes.py:672
POST   /tag-points/{pointId}/join                  tagpoint_routes.py:684  ← logique complète
DELETE /tag-points/{pointId}/cancel-request        tagpoint_routes.py:833
POST   /tag-points/{pointId}/invite                tagpoint_routes.py:862
GET    /users/me/spotyou-invitations               tagpoint_routes.py:966
POST   /tag-points/{pointId}/invitations/accept    tagpoint_routes.py:1007
POST   /tag-points/{pointId}/invitations/refuse    tagpoint_routes.py:1059
GET    /tag-points/{pointId}/join-requests         tagpoint_routes.py:1107
POST   /tag-points/{pointId}/members/{id}/approve  tagpoint_routes.py:1144
POST   /tag-points/{pointId}/members/{id}/reject   tagpoint_routes.py:1212
DELETE /tag-points/{pointId}/leave                 tagpoint_routes.py:1264
GET    /tag-points/{pointId}/participants          tagpoint_routes.py:1303
GET    /users/me/pending-requests                  tagpoint_routes.py:1325
GET    /users/me/notifications                     tagpoint_routes.py:1350
PATCH  /users/me/notifications/{notifId}/read      tagpoint_routes.py:1394
PATCH  /users/me/notifications/read-all            tagpoint_routes.py:1413
GET    /users/me/events                            tagpoint_routes.py:1428
GET    /users/me/planning-events                   tagpoint_routes.py:1462
GET    /tag-points/{pointId}/my-vote               tagpoint_routes.py:1703
POST   /tag-points/{pointId}/vote                  tagpoint_routes.py:1719
GET    /tag-points/{pointId}/votes                 tagpoint_routes.py:1791
POST   /tag-points                                 tagpoint_routes.py:1808
PUT    /tag-points/{pointId}                       tagpoint_routes.py:1866
PATCH  /tag-points/{pointId}/new-date              tagpoint_routes.py:2033
```

**SPOT-YOU (7 — dont 2 conditionnels ARB-006/007)**
```
POST   /spot-you/{pointId}/join                    spot_you_routes.py:132   ← ARB-006
DELETE /spot-you/{pointId}/leave                   spot_you_routes.py:212   ← ARB-007
POST   /spot-you/{pointId}/going                   spot_you_routes.py:289
DELETE /spot-you/{pointId}/going                   spot_you_routes.py:400
GET    /spot-you/my-completion-stats               spot_you_routes.py:461
GET    /spot-you/{pointId}/activity                spot_you_routes.py:495
GET    /spot-you/{pointId}/going                   spot_you_routes.py:627
```

**HOME (2)**
```
GET    /home/nearest-sector                        home_routes.py:30
GET    /home/feed                                  home_routes.py:152
```

**SERVICES (10 canoniques — PATCH = +1 si ARB-013 retenu)**
```
GET    /services                                   service_routes.py:352
GET    /services/mine                              service_routes.py:416
GET    /services/saved                             service_routes.py:645
GET    /services/deactivated                       service_routes.py:687
GET    /services/{serviceId}                       service_routes.py:718
POST   /services                                   service_routes.py:756
PUT    /services/{serviceId}                       service_routes.py:852  ← canonique
PATCH  /services/{serviceId}                       service_routes.py:853  ← ARB-013 (conditionnel +1)
DELETE /services/{serviceId}                       service_routes.py:986
POST   /services/{serviceId}/reactivate            service_routes.py:1051
POST   /services/{serviceId}/save                  service_routes.py:1107
DELETE /services/{serviceId}/unsave                service_routes.py:1123
```
> PATCH compté dans les 169 comme alias du PUT (même handler). Si ARB-013 retient les deux comme méthodes Java distinctes = 170 HTTP.

**BOOKINGS (10)**
```
POST   /bookings/price-preview                     booking_routes.py:115
POST   /bookings/request                           booking_routes.py:385   ← canonique
POST   /bookings/{bookingId}/accept                booking_routes.py:401
POST   /bookings/{bookingId}/pay                   booking_routes.py:558
POST   /bookings/{bookingId}/refuse                booking_routes.py:675
POST   /bookings/{bookingId}/cancel                booking_routes.py:754
PATCH  /bookings/{bookingId}/status                booking_routes.py:984
GET    /bookings/me                                booking_routes.py:1035  ← double-mappé avec /users/me/bookings
GET    /bookings/received                          booking_routes.py:1059
GET    /bookings/{bookingId}                       booking_routes.py:1080
```

**ADMIN (24)**
```
GET    /admin/stats                                admin_routes.py:11
GET    /admin/users                                admin_routes.py:53
PUT    /admin/users/{userId}/role                  admin_routes.py:75
PUT    /admin/users/{userId}/verify-coach          admin_routes.py:93
GET    /admin/tag-points                           admin_routes.py:107
DELETE /admin/tag-points/{pointId}                 admin_routes.py:118
GET    /admin/services                             admin_routes.py:127
GET    /admin/pricing-rules                        admin_routes.py:138
POST   /admin/pricing-rules                        admin_routes.py:149
PUT    /admin/pricing-rules/{ruleId}               admin_routes.py:176
DELETE /admin/pricing-rules/{ruleId}               admin_routes.py:199
GET    /admin/subscription-plans                   admin_routes.py:210    ← ARB-002 : gagne collision
POST   /admin/subscription-plans                   admin_routes.py:221
PUT    /admin/subscription-plans/{planId}          admin_routes.py:252
DELETE /admin/subscription-plans/{planId}          admin_routes.py:277
GET    /admin/domains                              admin_routes.py:286
GET    /admin/tags-analytics                       admin_routes.py:295
GET    /admin/all-domains                          admin_routes.py:385
GET    /admin/all-categories                       admin_routes.py:394
GET    /admin/all-tags                             admin_routes.py:408
GET    /admin/app-config                           admin_routes.py:440
POST   /admin/purge                                admin_routes.py:451
GET    /admin/purge/status                         admin_routes.py:495
PUT    /admin/app-config                           admin_routes.py:539
```

**CHAT HTTP (4)**
```
POST   /conversations                              chat_routes.py:227
GET    /conversations                              chat_routes.py:349
GET    /conversations/{convId}/messages            chat_routes.py:389
PUT    /conversations/{convId}/read                chat_routes.py:438
```

**UPLOAD (1)**
```
POST   /upload-image                               upload_routes.py:125
```

**PAYMENTS (9)**
```
GET    /payments/me                                payment_routes.py:41
GET    /payments/{paymentId}                       payment_routes.py:62
POST   /payments/checkout/session                  payment_routes.py:85
GET    /payments/checkout/status/{sessionId}       payment_routes.py:195
POST   /webhook/stripe                             payment_routes.py:356   ← pas de JWT, sig Stripe
PATCH  /payments/{paymentId}/stripe                payment_routes.py:410
GET    /admin/payments                             payment_routes.py:452
GET    /admin/payments/stats                       payment_routes.py:471
GET    /admin/subscriptions                        payment_routes.py:497   ← ARB-001 : gagne collision
```

**SUBSCRIPTIONS (7)**
```
GET    /subscription-plans                         subscription_routes.py:130
GET    /subscriptions/me                           subscription_routes.py:165
GET    /subscriptions/history                      subscription_routes.py:199
POST   /subscriptions/subscribe                    subscription_routes.py:217
POST   /subscriptions/cancel                       subscription_routes.py:325
GET    /subscriptions/checkout/status/{sessionId}  subscription_routes.py:404
POST   /admin/subscriptions/{subId}/cancel         subscription_routes.py:472
```

**ADDRESSES (4)**
```
GET    /addresses                                  address_routes.py:35
POST   /addresses                                  address_routes.py:53
PUT    /addresses/{addressId}                      address_routes.py:77
DELETE /addresses/{addressId}                      address_routes.py:99
```

**MARKETPLACE & PRODUCTS (6)**
```
GET    /marketplace/products                       marketplace_routes.py:31
GET    /products/mine                              product_creation_routes.py:41
GET    /products/{productId}/detail               product_creation_routes.py:77
POST   /products                                   product_creation_routes.py:113
DELETE /products/{productId}                       product_creation_routes.py:459
POST   /products/{productId}/reactivate            product_creation_routes.py:507
```

**ADMIN PRODUCTS (4)**
```
GET    /admin/products/pending                     admin_product_routes.py:43
GET    /admin/products/{productId}                 admin_product_routes.py:84
POST   /admin/products/{productId}/approve         admin_product_routes.py:115
POST   /admin/products/{productId}/reject          admin_product_routes.py:161
```

**DELETION / LIFECYCLE (8)**
```
DELETE /users/{userId}                             deletion_routes.py:97
DELETE /tag-points/{pointId}                       deletion_routes.py:260
POST   /tag-points/{pointId}/reactivate            deletion_routes.py:351
DELETE /messages/{messageId}                       deletion_routes.py:436
PATCH  /conversations/{convId}/leave               deletion_routes.py:481
PATCH  /users/{userId}/deactivate                  deletion_routes.py:522
POST   /users/{userId}/reactivate                  deletion_routes.py:624
GET    /users/me/reactivatable                     deletion_routes.py:681
```

### C2 — WebSocket (3)

> Protocole d'auth : `accept()` → `receive_json({"token":"..."}, timeout=5s)` → `decode_jwt` → `close(4001)` si échec. Le token ne passe JAMAIS dans l'URL.

```
WS   /ws/chat/{convId}       chat_routes.py:459   ← mutable (envoi/réception)
WS   /ws/notifications       chat_routes.py:606   ← lecture seule côté client
WS   /ws/spot-you/{pointId}  chat_routes.py:666   ← lecture seule côté client
```

### C3 — Infra server.py (4)

```
GET  /api/liveness            server.py:130   → InfraController
GET  /api/readiness           server.py:142   → InfraController  ← vérifie DB
GET  /api/config/booking      server.py:183   → ConfigController
GET  /api/config/commission   server.py:202   → ConfigController
```

### C4 — Exclusions définitives (5 au total)

| Route | Fichier | Raison |
|---|---|---|
| `POST /api/upload-image/debug-422` | upload_routes.py:114 | Debug sans auth, temporaire |
| `GET /api/admin/subscription-plans` | subscription_routes.py:151 | Shadow — jamais appelée |
| `GET /api/admin/subscriptions` | subscription_routes.py:453 | Shadow — jamais appelée |
| `GET /api/receiver/requests` | booking_routes.py:1060 | Chemin non-standard (alias) |
| `POST /api/bookings` | booking_routes.py:391 | Alias rétrocompat explicite |

### C5 — Alias conservés (301 ou double-mapping Java)

| Path alias | Résolution Java | ARB |
|---|---|---|
| `GET /api/users/me/bookings` | `@GetMapping({"/bookings/me", "/users/me/bookings"})` OU 301 vers `/bookings/me` | ARB-003 |

### C6 — Collisions arbitrées

| Chemin collision | Handler retenu | Handler exclu |
|---|---|---|
| `GET /api/admin/subscriptions` | `payment_routes.py:497` | `subscription_routes.py:453` (shadow) |
| `GET /api/admin/subscription-plans` | `admin_routes.py:210` | `subscription_routes.py:151` (shadow) |

---

## D. DÉCISIONS BLOQUANTES À VALIDATION HUMAINE

> Ces 6 décisions bloquent certains choix d'implémentation Java. Le reste de la migration peut commencer sans elles.

| ID | Ce qui doit être validé | Impact si non validé | Urgence |
|---|---|---|---|
| **ARB-001** | La réponse de `payment_routes.py:497` pour `GET /admin/subscriptions` est-elle bien celle affichée dans le frontend admin ? (champs : user_name, email, plan_name, plan_price) | Spring lève une erreur si l'implémentation Java tente de mapper les deux handlers. Utiliser uniquement `payment_routes.py:497`. | Avant Slice 16 |
| **ARB-002** | `ORDER BY created_at ASC` (admin_routes:210) intentionnel, ou `DESC` (subscription_routes:151 shadow) préférable ? | Aucun blocage fonctionnel. Uniquement un tri légèrement différent. | Avant Slice 16 |
| **ARB-003** | Le frontend mobile/web appelle-t-il `GET /users/me/bookings` ou `GET /bookings/me` ? | Si les deux sont utilisés → double-mapping Java. Si un seul → simple annotation. | Avant Slice 11 |
| **ARB-005/013** | `PUT` et `PATCH /api/services/{id}` → conserver les deux en Java (même logique) ou `PUT` uniquement ? | Impacte le modèle de contrôleur Java pour les Services. | Avant Slice 8 |
| **ARB-006** | Le frontend utilise-t-il `POST /api/spot-you/{id}/join` ? Si non, supprimer. Si oui, conserver distinctement (logique différente de tag-points/join). | Impacte le nombre de contrôleurs et la logique d'adhésion. | Avant Slice 6 |
| **ARB-007** | Le frontend utilise-t-il `DELETE /api/spot-you/{id}/leave` ? Même question. | Identique à ARB-006. | Avant Slice 6 |

---

## E. CONVENTIONS TECHNIQUES OBLIGATOIRES POUR JAVA/SPRING

> Toutes ces règles sont issues du code source. Certaines déviations casseraient silencieusement le comportement.

### E1 — Identifiants

```
CONSTAT CERTAIN : les IDs sont des chaînes TEXT préfixées (ex: "usr_abc123", "tp_def456").
Python : new_id(prefix) = f"{prefix}_{random_hex}"
Java OBLIGATOIRE : reproduire IdGenerator.generate(prefix) — PAS d'UUID standard.
Stocker en TEXT PostgreSQL, pas en UUID type.
```

### E2 — Auth WebSocket

```
CONSTAT CERTAIN : les 3 WS utilisent le même pattern (chat_routes.py:459, 606, 666) :
  1. websocket.accept()                              # sans auth
  2. auth_msg = receive_json(timeout=5.0)            # {"token": "..."}
  3. decode_jwt(auth_msg["token"])                   # valider
  4. close(4001) si timeout ou token invalide

OBLIGATOIRE en Java :
  - NE PAS utiliser @MessageMapping Spring (stateful)
  - Implémenter WebSocketHandler abstrait custom
  - Timeout 5s sur la réception du premier message
  - Token JAMAIS dans l'URL
```

### E3 — Auth HTTP

```
Trois niveaux dans le code Python :
  require_auth(request, pool)          → JWT obligatoire
  get_optional_auth(request, pool)     → JWT optionnel (retourne None si absent)
  require_role(request, pool, "admin") → JWT + role == "admin"

Java :
  @AuthenticationPrincipal User user                  # obligatoire
  @AuthenticationPrincipal(required=false) User user  # optionnel
  @PreAuthorize("hasRole('ADMIN')")                   # admin
```

### E4 — Webhook Stripe

```
CONSTAT CERTAIN : POST /api/webhook/stripe ne vérifie PAS de JWT.
Il vérifie la signature via l'en-tête Stripe-Signature.
Java OBLIGATOIRE :
  - Exclure cette route du filtre JWT
  - Utiliser stripe-java SDK pour vérification signature
  - Variable d'env STRIPE_WEBHOOK_SECRET requise
  - Logique idempotente (même event Stripe traité une seule fois)
```

### E5 — Soft delete

```
CONSTAT CERTAIN : champ active = TRUE/FALSE sur tag_points, services, products, users.
Filtre appliqué manuellement dans chaque requête Python.
Java :
  @SQLRestriction("active = TRUE") sur les entités soft-deletables
  OU filtre explicite dans chaque repository
  Désactiver le filtre pour les routes admin uniquement
```

### E6 — Concurrence bookings

```
CONSTAT CERTAIN : booking_routes.py utilise SELECT ... FOR UPDATE NOWAIT sur slot_id.
Idempotency_key → UNIQUE INDEX en base.
Java :
  @Lock(LockModeType.PESSIMISTIC_WRITE) sur les slots
  Gérer asyncpg.exceptions.LockNotAvailableError → HTTP 409
  Vérifier UNIQUE constraint sur idempotency_key → HTTP 409
```

### E7 — Concurrence join-requests SpotYou

```
CONSTAT CERTAIN : approve/reject retournent 409 si déjà traité (tagpoint_routes.py:1144, 1212).
Java : vérifier le status avant update → HTTP 409 si status != 'pending'.
```

### E8 — Workers critiques

```
4 workers Python actifs (non testés individuellement) :
  ExpiryWorker       (intervalle=60s)   → expire bookings, libère slots
  SpotYouNotifWorker (intervalle=900s)  → notifie J-3 avant séance
  MediaPurgeWorker   (intervalle=3600s) → supprime médias J+90
  MediaNotifWorker   (intervalle=900s)  → notifie J+83 avant purge
  AdminProductReminderWorker (600s)     → rappel admin produits en attente

Java : @Scheduled sur chaque worker, SELECT ... FOR UPDATE SKIP LOCKED pour l'ExpiryWorker.
NE PAS migrer les workers avant d'avoir migré les endpoints qu'ils référencent.
```

### E9 — PostGIS / géolocalisation

```
CONSTAT CERTAIN : home_routes.py et tagpoint_routes.py utilisent ST_DWithin, ST_MakePoint.
Java : Hibernate Spatial + PostGIS JDBC requis.
Colonne location dans tag_points est de type geometry(POINT, 4326).
```

### E10 — Google OAuth

```
CONSTAT CERTAIN : POST /api/auth/google appelle un proxy Emergent (demobackend.emergentagent.com).
NE PAS tenter de reproduire l'OAuth Google directement en Java avant d'avoir clarifié
si le proxy Emergent reste ou si spring-security-oauth2-client est utilisé.
Migrer dans la Slice 18 (en dernier).
```

### E11 — Pagination et filtrage

```
La plupart des routes GET de liste utilisent des paramètres de query (limit, offset, search...).
Aucune pagination côté serveur basée sur curseur — simple OFFSET/LIMIT.
Conserver ce comportement en Java v1 (ne pas migrer vers cursor-based pagination).
```

### E12 — Ordre statique/paramétrique obligatoire

```
Dans chaque @RequestMapping, déclarer les méthodes statiques AVANT les paramétriques :
  /mine, /saved, /me, /deactivated → AVANT /{id}
  /pending → AVANT /{productId}
  /my-completion-stats → AVANT /{pointId}/*
```

---

## F. ORDRE DE DÉMARRAGE RECOMMANDÉ

### Socle préalable (P0 — avant toute slice)

```
Spring Boot 3.x + Java 21
HikariCP + JDBC PostgreSQL + SSL Supabase
prepareThreshold=0 (JDBC URL pour Supavisor)
@SQLRestriction("active = TRUE") sur entités soft-delete
IdGenerator.generate(prefix) → reproduit new_id() Python
JwtAuthFilter STATELESS
Tests d'intégration DB opérationnels
```

### Slice 1 — Référentiels (risque : faible)
```
GET/POST/PUT/DELETE /domains, /tags, /tags/categories
GET /admin/all-domains, /admin/all-categories, /admin/all-tags
GET /admin/tags-analytics
```
**Pourquoi en premier** : CRUD pur, zéro dépendance (pas de Stripe, workers, push). Valide le socle JPA + JSONB + CRUD.

### Slice 2 — Auth JWT (risque : élevé — bloquant pour tout le reste)
```
POST /auth/register, /auth/login, /auth/logout
GET /auth/me
PUT /auth/change-password
```
**Ne pas migrer dans cette slice** : POST /auth/google (Emergent proxy — Slice 18).  
**Valider impérativement** : même TTL JWT, même format token, compatibilité avec clients existants.

### Slice 3 — Profil utilisateur
```
GET/PUT /users/profile
GET /users/{id}/public, /users/search
POST/DELETE /users/{id}/follow, /users/{id}/block
```

### Slice 4 — Upload + infra médias
```
POST /upload-image
GET /api/liveness, /readiness, /config/booking, /config/commission
Workers : MediaPurgeWorker, MediaNotifWorker
```

### Slice 5 — Push notifications
```
POST/DELETE /users/push-token
PushService (HTTP → Expo via OkHttp)
```

### Slice 6 — SpotYous core (risque : moyen — state machine complexe)
```
GET/POST/PUT /tag-points, /tag-points/{id}
POST/DELETE /tag-points/{id}/join, /leave, /save
GET /users/me/events, /users/me/planning-events
Workers : ExpiryWorker (partiel), SpotYouNotifWorker
```
**Point critique** : tester la state machine spot_you_members (4 statuts × 3 modes) avant déploiement.

### Slice 7 — SpotYous avancés
```
POST/GET /tag-points/{id}/invite, /invitations/accept, /refuse
GET/POST /tag-points/{id}/join-requests, /members/{id}/approve, /reject
GET /users/me/notifications, /pending-requests
POST/GET /tag-points/{id}/vote, /votes
```

### Slices 8–10 — Services, Home Feed, Pricing Engine
Voir `MIGRATION_SLICES_PROPOSAL.md` pour détail.

### Slices 11–13 — Bookings + Paiements Stripe + Abonnements (risque : critique)
```
IMPORTANT : Ne pas migrer Stripe et Bookings en même temps.
  Slice 11 : logique booking sans paiement (pay_later uniquement)
  Slice 12 : Stripe checkout + webhook (tester avec stripe listen --forward-to)
  Slice 13 : Abonnements
```

### Slices 14–16 — Produits, Notifications, Admin Dashboard

### Slice 17 — Chat + WebSocket (en dernier — risque : élevé)
```
POST/GET /conversations, /messages
WS /ws/chat/{id}, /ws/notifications, /ws/spot-you/{id}
```
**Stratégie** : laisser le Python gérer les WS pendant toute la migration. Ne migrer que quand tout le reste est stable.

### Slice 18 — Google OAuth (optionnelle)
```
POST /auth/google
Décision : proxy Emergent conservé OU spring-security-oauth2-client
```

### À NE PAS migrer au début
- Tout ce qui touche à Stripe (webhooks, checkout)
- Les workers (migrer après les endpoints qu'ils référencent)
- Le WebSocket
- La suppression utilisateur (RGPD, irréversible)
- Google OAuth
