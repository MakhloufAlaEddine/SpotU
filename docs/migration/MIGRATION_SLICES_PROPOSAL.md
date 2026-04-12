# MIGRATION_SLICES_PROPOSAL.md — Plan de migration par slices progressives
> Stratégie : jamais big bang. Chaque slice est déployable indépendamment, testable en isolation.
> Approche recommandée : **strangler fig** — le backend Python reste actif pendant toute la migration.
> Généré le 2026-04-11.

---

## Prérequis avant toute slice

### P0 — Socle technique Spring Boot
**Avant de commencer quoi que ce soit :**
1. Setup projet Spring Boot 3.x (Java 21)
2. Configuration HikariCP + asyncpg → JDBC PostgreSQL
3. Configuration SSL Supabase (truststore avec CA cert)
4. Configuration `prepareThreshold=0` (JDBC URL) requis Supavisor
5. `@SQLRestriction("deleted_at IS NULL")` sur les entités soft-delete
6. Hypersistence Utils pour JSONB
7. Hibernate Spatial + PostGIS JDBC
8. `IdGenerator.generate(prefix)` équivalent Python `new_id(prefix)`
9. Configuration Spring Security STATELESS (JWT)
10. Tests d'intégration DB fonctionnels

---

## Ordre de migration recommandé

---

### SLICE 1 — Référentiels statiques
**Difficulté : Faible | Risque : Faible**

**Endpoints :**
- `GET /api/domains`
- `GET /api/tags/categories`
- `GET /api/tags`
- `GET /api/admin/all-domains`
- `GET /api/admin/all-categories`
- `GET /api/admin/all-tags`
- `POST/PUT/DELETE /api/domains`, `/api/tags`, `/api/tags/categories`
- `GET /api/admin/tags-analytics`

**Entités :** `domains`, `tags`, `tag_categories`, `tag_category_links`, `tag_entity_type_links`

**Dépendances :** Aucune (pas de Stripe, pas de workers, pas de push)

**Raison :** CRUD pur, lecture seule principalement, aucune logique métier complexe. Idéal pour valider le socle Spring (entities JPA, repositories, controllers, JSONB).

---

### SLICE 2 — Auth (register / login / me)
**Difficulté : Moyenne | Risque : Élevé**

**Endpoints :**
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout` (stateless = no-op)
- `PUT /api/auth/change-password`

**Entités :** `users`

**Dépendances :** bcrypt, JWT HS256

**Note :** **Ne pas migrer Google OAuth dans cette slice.** Conserver l'endpoint `/api/auth/google` dans Python jusqu'à la slice dédiée.

**Raison :** L'auth est bloquante pour toutes les autres slices. Valider le JwtAuthFilter Spring avant d'avancer. Tests de non-régression JWT indispensables (mêmes tokens, même TTL).

---

### SLICE 3 — Profil utilisateur
**Difficulté : Faible | Risque : Faible**

**Endpoints :**
- `GET/PUT /api/users/profile`
- `GET /api/users/{user_id}/public`
- `GET /api/users/search`
- `POST/DELETE /api/users/{user_id}/follow`
- `POST/DELETE /api/users/{user_id}/block`

**Entités :** `users`, `user_follows`, `user_blocks`, `user_saved_addresses`

**Dépendances :** Auth (Slice 2)

**Raison :** Pas de workers ni de Stripe. CRUD profil simple. Valide la couche service + `@Transactional` Spring.

---

### SLICE 4 — Upload médias + purge différée (infrastructure)
**Difficulté : Moyenne | Risque : Moyen**

**Endpoints :**
- `POST /api/upload-image`

**Workers :**
- `MediaPurgeWorker` → `@Scheduled` + S3 SDK Java
- `MediaNotifWorker` → `@Scheduled`

**Entités :** `pending_file_deletions`

**Dépendances :** R2 (AWS SDK v2), Expo Push, Auth

**Raison :** Migrer cette infrastructure tôt permet aux slices suivantes (SpotYou, Services, Produits) d'utiliser immédiatement R2 via Java. Le pipeline J+90 doit être opérationnel avant de migrer les entités soft-deletables.

---

### SLICE 5 — Push Notifications (infrastructure)
**Difficulté : Faible | Risque : Faible**

**Endpoints :**
- `POST/DELETE /api/push-token`

**Composants :**
- `PushService.sendPushToUser()` (HTTP vers Expo via OkHttp)
- Remplace `push_service.py`

**Dépendances :** Auth (Slice 2), DB tokens

**Raison :** Socle requis par toutes les slices avec effets secondaires (SpotYou, Booking, Produits).

---

### SLICE 6 — SpotYous (lecture + création + membership)
**Difficulté : Élevée | Risque : Moyen**

**Endpoints :**
- `GET /api/tag-points`
- `GET /api/tag-points/{id}`
- `POST /api/tag-points`
- `PUT /api/tag-points/{id}`
- `POST /api/tag-points/{id}/join`
- `DELETE /api/tag-points/{id}/cancel-request`
- `DELETE /api/tag-points/{id}/leave`
- `POST/DELETE /api/tag-points/{id}/save`
- `GET /api/users/me/events`

**Entités :** `tag_points`, `spot_you_members`, `tag_point_saves`, `spot_you_attendance`

**Dépendances :** PostGIS, Auth, Push (Slice 5), `apply_precision_offset`

**Note :** La state machine `spot_you_members` (4 statuts × 3 canaux) est la partie la plus sensible. Écrire des tests unitaires exhaustifs sur le `SpotYouMemberService` avant déploiement.

---

### SLICE 7 — SpotYous Admin (demandes, invitations)
**Difficulté : Moyenne | Risque : Faible**

**Endpoints :**
- `GET /api/tag-points/{id}/join-requests`
- `POST /api/tag-points/{id}/members/{uid}/approve`
- `POST /api/tag-points/{id}/members/{uid}/reject`
- `POST /api/tag-points/{id}/invite`
- `POST /api/tag-points/{id}/invitations/accept`
- `POST /api/tag-points/{id}/invitations/refuse`
- Notifications liées

**Dépendances :** Slice 6

**Raison :** Séparé de Slice 6 car moins critique et plus récent dans le code. Valide la gestion de concurrence (409 Conflict).

---

### SLICE 8 — Services (coach)
**Difficulté : Élevée | Risque : Moyen**

**Endpoints :**
- `GET/POST/PUT/DELETE /api/services`
- `GET /api/services/{id}`
- `POST /api/services/{id}/reactivate`
- `POST/DELETE /api/services/{id}/save`

**Entités :** `services`, `service_slots`, `service_locations`, `service_packages`, `service_saves`

**Dépendances :** Auth, PostGIS, Push, Upload (Slice 4)

**Note :** La structure `service_slots` + `service_locations` + `service_packages` forme un agrégat complexe. Utiliser un service Spring transactionnel unique pour la création/mise à jour.

---

### SLICE 9 — Home Feed & Discovery
**Difficulté : Moyenne | Risque : Faible**

**Endpoints :**
- `GET /api/home/feed`
- `GET /api/home/nearest-sector`
- `GET /api/marketplace/products`

**Dépendances :** PostGIS, tag_points, services, products

**Raison :** Lecture seule, pas d'effets secondaires. L'algorithme de scoring est complexe mais entièrement déterministe.

---

### SLICE 10 — Pricing Engine
**Difficulté : Faible (code) | Risque : CRITIQUE**

**Composant :**
- `PricingService.computePricing()` équivalent de `pricing_engine.py`

**Dépendances :** `pricing_rules`, `user_subscriptions`

**Note :** **Tests obligatoires.** Comparer les résultats Java et Python avec les mêmes entrées avant de déployer quoi que ce soit de la Slice 11.

---

### SLICE 11 — Bookings
**Difficulté : Très élevée | Risque : CRITIQUE**

**Endpoints :**
- `POST /api/bookings/price-preview`
- `POST /api/bookings/request`
- `POST /api/bookings/{id}/accept`
- `POST /api/bookings/{id}/refuse`
- `POST /api/bookings/{id}/cancel`
- `GET /api/bookings/me`, `/received`

**Workers :**
- `ExpiryWorker` → `@Scheduled` + `SELECT … FOR UPDATE SKIP LOCKED`

**Dépendances :** Pricing Engine (Slice 10), Services (Slice 8), Stripe (partiel)

**Note :** Ne pas migrer en même temps que Stripe. Migrer d'abord la logique booking en mode `pay_later` uniquement. Ajouter Stripe dans Slice 12.

---

### SLICE 12 — Paiements Stripe
**Difficulté : Très élevée | Risque : CRITIQUE**

**Endpoints :**
- `POST /api/payments/checkout/session`
- `GET /api/payments/checkout/status/{session_id}`
- `POST /api/webhook/stripe`

**Dépendances :** stripe-java SDK, Slice 11

**Note :** La migration du webhook Stripe est le point le plus risqué de toute la migration. Tester en environnement staging avec Stripe CLI (`stripe listen --forward-to`). Valider l'idempotence avec des events en double.

---

### SLICE 13 — Abonnements
**Difficulté : Élevée | Risque : Élevé**

**Endpoints :**
- `GET /api/subscription-plans`
- `POST /api/subscriptions/subscribe`
- `POST /api/subscriptions/cancel`
- Webhooks subscription Stripe

**Dépendances :** Stripe (Slice 12), Users (Slice 3)

---

### SLICE 14 — Marketplace Produits
**Difficulté : Moyenne | Risque : Faible**

**Endpoints :**
- `GET/POST/PUT/DELETE /api/products`
- `POST /api/admin/products/{id}/approve`
- `POST /api/admin/products/{id}/reject`

**Workers :**
- `AdminProductReminderWorker` → `@Scheduled`

**Dépendances :** Auth, Push, Upload, Tags

---

### SLICE 15 — Notifications + Suppression
**Difficulté : Moyenne | Risque : Élevé**

**Endpoints :**
- `GET /api/users/me/notifications`
- `PATCH /api/users/me/notifications/{id}/read`
- `DELETE /api/users/{id}` (soft delete + anonymisation + pipeline J+90)
- `DELETE /api/tag-points/{id}`
- `DELETE /api/messages/{id}`

**Workers :**
- `MediaPurgeWorker` (si pas déjà migré en Slice 4)

**Note :** La suppression utilisateur est l'opération la plus risquée ici (RGPD + irréversible). Valider chaque champ anonymisé.

---

### SLICE 16 — Admin Dashboard
**Difficulté : Faible | Risque : Faible**

**Endpoints :**
- `GET /api/admin/stats`
- `GET/POST/PUT/DELETE /api/admin/pricing-rules`
- `GET/POST/PUT/DELETE /api/admin/subscription-plans`
- `GET/PUT /api/admin/app-config`
- `POST /api/admin/purge`
- `GET /api/admin/purge/status`

---

### SLICE 17 — Chat & WebSocket (en dernier)
**Difficulté : Très élevée | Risque : Élevé**

**Endpoints :**
- `POST /api/conversations`
- `GET /api/conversations`
- `GET /api/conversations/{id}/messages`
- `WS /ws/chat/{conv_id}`
- `WS /ws/notifications`
- `WS /ws/spot-you/{point_id}`

**Dépendances :** Toutes les slices précédentes

**Note :** Migrer en dernier. Le frontend peut continuer à utiliser le backend Python pour les WebSockets même quand tout le reste est migré vers Java. Prévoir une période de cohabitation.

---

### SLICE 18 — Google OAuth (option : remplacer Emergent)
**Difficulté : Moyenne | Risque : Faible**

**Endpoint :**
- `POST /api/auth/google`

Remplacer l'appel HTTP vers `demobackend.emergentagent.com` par `spring-security-oauth2-client` avec Google.

---

## Résumé tableau

| # | Slice | Diff | Risque | Prérequis |
|---|-------|------|--------|-----------|
| P0 | Socle Spring Boot | Élevée | — | — |
| 1 | Référentiels | Faible | Faible | P0 |
| 2 | Auth JWT | Moyenne | Élevé | P0 |
| 3 | Profil utilisateur | Faible | Faible | 2 |
| 4 | Upload + R2 | Moyenne | Moyen | 2 |
| 5 | Push Notifications | Faible | Faible | 2 |
| 6 | SpotYous core | Élevée | Moyen | 1,2,4,5 |
| 7 | SpotYous invitations | Moyenne | Faible | 6 |
| 8 | Services | Élevée | Moyen | 2,4,5 |
| 9 | Home Feed | Moyenne | Faible | 1,6,8 |
| 10 | Pricing Engine | Faible | **CRITIQUE** | 2 |
| 11 | Bookings | Très élevée | **CRITIQUE** | 8,10 |
| 12 | Paiements Stripe | Très élevée | **CRITIQUE** | 11 |
| 13 | Abonnements | Élevée | Élevé | 12 |
| 14 | Marketplace Produits | Moyenne | Faible | 2,4,5 |
| 15 | Notifications + Delete | Moyenne | Élevé | 4,5 |
| 16 | Admin Dashboard | Faible | Faible | Tout |
| 17 | Chat & WebSocket | Très élevée | Élevé | Tout |
| 18 | Google OAuth | Moyenne | Faible | 2 |
