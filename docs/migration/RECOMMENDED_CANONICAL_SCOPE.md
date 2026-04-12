# RECOMMENDED_CANONICAL_SCOPE.md
> Généré le 2026-04-12.  
> **Objectif** : définir la liste canonique définitive des endpoints à migrer vers Java/Spring Boot.  
> Ce document est la source de vérité pour le périmètre de migration. Il supplante toute liste précédente.

---

## Résumé exécutif

| Catégorie | Nombre | Action |
|---|---|---|
| Endpoints à migrer (canoniques) | **169** | MIGRER en Java |
| Endpoints à exclure (debug, shadow, alias secondaire) | **9** | NE PAS migrer |
| Endpoints à arbitrage préalable (collisions) | **2** | DÉCIDER avant migration |
| Routes infra server.py | **4** | MIGRER dans contrôleur dédié |
| **TOTAL périmètre complet** | **184** | — |

> Note : le total de 184 = 174 routes joignables (routes/*.py) + 4 routes server.py + 3 double-décorateurs alias + 2 shadow + 1 debug = 183 décorateurs réels + 1 route server.py supplémentaire.

---

## PARTIE 1 — Endpoints À MIGRER (scope canonique Java)

> Règle : path primaire retenu, auth Java à implémenter (`@PreAuthorize`, `SecurityContext`, etc.)

### BLOC AUTH `/api/auth` — 7 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 1 | GET | `/api/auth/native-callback` | `AuthController#nativeCallback` | Public |
| 2 | POST | `/api/auth/register` | `AuthController#register` | Public |
| 3 | POST | `/api/auth/login` | `AuthController#login` | Public + RateLimit |
| 4 | POST | `/api/auth/google` | `AuthController#googleAuth` | Public |
| 5 | GET | `/api/auth/me` | `AuthController#getMe` | `@Authenticated` |
| 6 | POST | `/api/auth/logout` | `AuthController#logout` | `@Authenticated` |
| 7 | PUT | `/api/auth/change-password` | `AuthController#changePassword` | `@Authenticated` |

### BLOC USERS `/api/users` — 18 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 8 | GET | `/api/users/profile` | `UserController#getProfile` | `@Authenticated` |
| 9 | PUT | `/api/users/profile` | `UserController#updateProfile` | `@Authenticated` |
| 10 | POST | `/api/users/become-coach` | `UserController#becomeCoach` | `@Authenticated` |
| 11 | GET | `/api/users/{userId}/public` | `UserController#getPublicProfile` | Optional |
| 12 | GET | `/api/users/{userId}/reviews` | `UserController#getReviews` | Optional |
| 13 | PUT | `/api/users/{userId}/reviews/{reviewId}` | `UserController#updateReview` | `@Authenticated` |
| 14 | POST | `/api/users/{userId}/reviews` | `UserController#createReview` | `@Authenticated` |
| 15 | GET | `/api/users/me/activity-feed` | `UserController#activityFeed` | `@Authenticated` |
| 16 | POST | `/api/users/{userId}/follow` | `UserController#followUser` | `@Authenticated` |
| 17 | DELETE | `/api/users/{userId}/follow` | `UserController#unfollowUser` | `@Authenticated` |
| 18 | PATCH | `/api/users/{userId}/cover` | `UserController#updateCover` | `@Authenticated` |
| 19 | GET | `/api/users/{userId}/followers` | `UserController#getFollowers` | Optional |
| 20 | GET | `/api/users/{userId}/following` | `UserController#getFollowing` | Optional |
| 21 | DELETE | `/api/users/{userId}/followers/{followerId}` | `UserController#removeFollower` | `@Authenticated` |
| 22 | POST | `/api/users/{userId}/block` | `UserController#blockUser` | `@Authenticated` |
| 23 | DELETE | `/api/users/{userId}/block` | `UserController#unblockUser` | `@Authenticated` |
| 24 | GET | `/api/users/{userId}/suggestions` | `UserController#getSuggestions` | `@Authenticated` |
| 25 | GET | `/api/users/search` | `UserController#searchUsers` | Optional |

### BLOC PUSH `/api/users` — 2 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 26 | POST | `/api/users/push-token` | `PushController#registerToken` | `@Authenticated` |
| 27 | DELETE | `/api/users/push-token` | `PushController#deleteToken` | `@Authenticated` |

### BLOC DOMAINS & TAGS — 15 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 28 | GET | `/api/domains` | `DomainController#listDomains` | Public |
| 29 | POST | `/api/domains` | `DomainController#createDomain` | `@Admin` |
| 30 | PUT | `/api/domains/{domainId}` | `DomainController#updateDomain` | `@Admin` |
| 31 | GET | `/api/domains/{domainId}/usage` | `DomainController#getDomainUsage` | `@Admin` |
| 32 | DELETE | `/api/domains/{domainId}` | `DomainController#deleteDomain` | `@Admin` |
| 33 | GET | `/api/tags/categories` | `TagController#listCategories` | Public |
| 34 | POST | `/api/tags/categories` | `TagController#createCategory` | `@Admin` |
| 35 | PUT | `/api/tags/categories/{categoryId}` | `TagController#updateCategory` | `@Admin` |
| 36 | GET | `/api/tags/categories/{categoryId}/usage` | `TagController#getCategoryUsage` | `@Admin` |
| 37 | DELETE | `/api/tags/categories/{categoryId}` | `TagController#deleteCategory` | `@Admin` |
| 38 | GET | `/api/tags` | `TagController#listTags` | Public |
| 39 | POST | `/api/tags` | `TagController#createTag` | `@Admin` |
| 40 | PUT | `/api/tags/{tagId}` | `TagController#updateTag` | `@Admin` |
| 41 | GET | `/api/tags/{tagId}/usage` | `TagController#getTagUsage` | `@Admin` |
| 42 | DELETE | `/api/tags/{tagId}` | `TagController#deleteTag` | `@Admin` |

### BLOC TAG-POINTS (SpotYous) — 30 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 43 | GET | `/api/tag-points` | `SpotYouController#list` | Optional |
| 44 | GET | `/api/tag-points/mine` | `SpotYouController#getMine` | `@Authenticated` |
| 45 | GET | `/api/tag-points/saved` | `SpotYouController#getSaved` | `@Authenticated` |
| 46 | GET | `/api/tag-points/{pointId}` | `SpotYouController#getDetail` | Optional |
| 47 | GET | `/api/tag-points/{pointId}/similar` | `SpotYouController#getSimilar` | Optional |
| 48 | POST | `/api/tag-points` | `SpotYouController#create` | `@Authenticated` |
| 49 | PUT | `/api/tag-points/{pointId}` | `SpotYouController#update` | `@Authenticated` |
| 50 | PATCH | `/api/tag-points/{pointId}/new-date` | `SpotYouController#toggleNewDate` | `@Authenticated` |
| 51 | POST | `/api/tag-points/{pointId}/save` | `SpotYouController#save` | `@Authenticated` |
| 52 | DELETE | `/api/tag-points/{pointId}/unsave` | `SpotYouController#unsave` | `@Authenticated` |
| 53 | POST | `/api/tag-points/{pointId}/join` | `SpotYouController#join` | `@Authenticated` |
| 54 | DELETE | `/api/tag-points/{pointId}/cancel-request` | `SpotYouController#cancelRequest` | `@Authenticated` |
| 55 | POST | `/api/tag-points/{pointId}/invite` | `SpotYouController#invite` | `@Authenticated` |
| 56 | GET | `/api/users/me/spotyou-invitations` | `SpotYouController#getMyInvitations` | `@Authenticated` |
| 57 | POST | `/api/tag-points/{pointId}/invitations/accept` | `SpotYouController#acceptInvitation` | `@Authenticated` |
| 58 | POST | `/api/tag-points/{pointId}/invitations/refuse` | `SpotYouController#refuseInvitation` | `@Authenticated` |
| 59 | GET | `/api/tag-points/{pointId}/join-requests` | `SpotYouController#getJoinRequests` | `@Authenticated` |
| 60 | POST | `/api/tag-points/{pointId}/members/{memberId}/approve` | `SpotYouController#approveRequest` | `@Authenticated` |
| 61 | POST | `/api/tag-points/{pointId}/members/{memberId}/reject` | `SpotYouController#rejectRequest` | `@Authenticated` |
| 62 | DELETE | `/api/tag-points/{pointId}/leave` | `SpotYouController#leave` | `@Authenticated` |
| 63 | GET | `/api/tag-points/{pointId}/participants` | `SpotYouController#getParticipants` | `@Authenticated` |
| 64 | GET | `/api/users/me/pending-requests` | `SpotYouController#getPendingRequests` | `@Authenticated` |
| 65 | GET | `/api/users/me/notifications` | `NotificationController#getNotifications` | `@Authenticated` |
| 66 | PATCH | `/api/users/me/notifications/{notifId}/read` | `NotificationController#markRead` | `@Authenticated` |
| 67 | PATCH | `/api/users/me/notifications/read-all` | `NotificationController#markAllRead` | `@Authenticated` |
| 68 | GET | `/api/users/me/events` | `SpotYouController#getMyEvents` | `@Authenticated` |
| 69 | GET | `/api/users/me/planning-events` | `SpotYouController#getPlanningEvents` | `@Authenticated` |
| 70 | GET | `/api/tag-points/{pointId}/my-vote` | `SpotYouController#getMyVote` | `@Authenticated` |
| 71 | POST | `/api/tag-points/{pointId}/vote` | `SpotYouController#vote` | `@Authenticated` |
| 72 | GET | `/api/tag-points/{pointId}/votes` | `SpotYouController#getVotes` | Optional |

### BLOC SPOT-YOU (routes courtes) — 5 endpoints

> Note : `POST /spot-you/{id}/join` et `DELETE /spot-you/{id}/leave` sont des **alias fonctionnels** de tag-points. Voir PARTIE 2 pour la décision.

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 73 | POST | `/api/spot-you/{pointId}/going` | `SpotYouController#setGoing` | `@Authenticated` |
| 74 | DELETE | `/api/spot-you/{pointId}/going` | `SpotYouController#unsetGoing` | `@Authenticated` |
| 75 | GET | `/api/spot-you/my-completion-stats` | `SpotYouController#myStats` | `@Authenticated` |
| 76 | GET | `/api/spot-you/{pointId}/activity` | `SpotYouController#getActivity` | Optional |
| 77 | GET | `/api/spot-you/{pointId}/going` | `SpotYouController#getGoingList` | Public |

### BLOC HOME & DISCOVERY — 2 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 78 | GET | `/api/home/nearest-sector` | `HomeController#nearestSector` | Optional |
| 79 | GET | `/api/home/feed` | `HomeController#feed` | Optional |

### BLOC SERVICES — 10 endpoints

> Note : `PUT` et `PATCH /api/services/{id}` sont le même handler en Python. Voir PARTIE 2 — décision sémantique requise.

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 80 | GET | `/api/services` | `ServiceController#list` | Optional |
| 81 | GET | `/api/services/mine` | `ServiceController#getMine` | `@Authenticated` |
| 82 | GET | `/api/services/saved` | `ServiceController#getSaved` | `@Authenticated` |
| 83 | GET | `/api/services/deactivated` | `ServiceController#getDeactivated` | `@Authenticated` |
| 84 | GET | `/api/services/{serviceId}` | `ServiceController#getDetail` | Optional |
| 85 | POST | `/api/services` | `ServiceController#create` | `@Authenticated` |
| 86 | PUT | `/api/services/{serviceId}` | `ServiceController#update` | `@Authenticated` |
| 87 | DELETE | `/api/services/{serviceId}` | `ServiceController#delete` | `@Authenticated` |
| 88 | POST | `/api/services/{serviceId}/reactivate` | `ServiceController#reactivate` | `@Authenticated` |
| 89 | POST | `/api/services/{serviceId}/save` | `ServiceController#save` | `@Authenticated` |
| 90 | DELETE | `/api/services/{serviceId}/unsave` | `ServiceController#unsave` | `@Authenticated` |

### BLOC BOOKINGS — 10 endpoints

> Note : `/bookings/me` et `/bookings/received` sont les paths primaires. Alias `GET /receiver/requests` et `GET /users/me/bookings` exclus (voir PARTIE 2).

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 91 | POST | `/api/bookings/price-preview` | `BookingController#pricePreview` | `@Authenticated` |
| 92 | POST | `/api/bookings/request` | `BookingController#createBooking` | `@Authenticated` |
| 93 | POST | `/api/bookings/{bookingId}/accept` | `BookingController#accept` | `@Authenticated` |
| 94 | POST | `/api/bookings/{bookingId}/pay` | `BookingController#pay` | `@Authenticated` |
| 95 | POST | `/api/bookings/{bookingId}/refuse` | `BookingController#refuse` | `@Authenticated` |
| 96 | POST | `/api/bookings/{bookingId}/cancel` | `BookingController#cancel` | `@Authenticated` |
| 97 | PATCH | `/api/bookings/{bookingId}/status` | `BookingController#updateStatus` | `@Authenticated` |
| 98 | GET | `/api/bookings/me` | `BookingController#myBookings` | `@Authenticated` |
| 99 | GET | `/api/bookings/received` | `BookingController#receivedBookings` | `@Authenticated` |
| 100 | GET | `/api/bookings/{bookingId}` | `BookingController#getBooking` | `@Authenticated` |

### BLOC ADMIN — 24 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 101 | GET | `/api/admin/stats` | `AdminController#getStats` | `@Admin` |
| 102 | GET | `/api/admin/users` | `AdminController#getUsers` | `@Admin` |
| 103 | PUT | `/api/admin/users/{userId}/role` | `AdminController#setRole` | `@Admin` |
| 104 | PUT | `/api/admin/users/{userId}/verify-coach` | `AdminController#verifyCoach` | `@Admin` |
| 105 | GET | `/api/admin/tag-points` | `AdminController#listTagPoints` | `@Admin` |
| 106 | DELETE | `/api/admin/tag-points/{pointId}` | `AdminController#deleteTagPoint` | `@Admin` |
| 107 | GET | `/api/admin/services` | `AdminController#listServices` | `@Admin` |
| 108 | GET | `/api/admin/pricing-rules` | `AdminController#getPricingRules` | `@Admin` |
| 109 | POST | `/api/admin/pricing-rules` | `AdminController#createPricingRule` | `@Admin` |
| 110 | PUT | `/api/admin/pricing-rules/{ruleId}` | `AdminController#updatePricingRule` | `@Admin` |
| 111 | DELETE | `/api/admin/pricing-rules/{ruleId}` | `AdminController#deletePricingRule` | `@Admin` |
| 112 | GET | `/api/admin/subscription-plans` | `AdminController#getSubscriptionPlans` | `@Admin` |
| 113 | POST | `/api/admin/subscription-plans` | `AdminController#createPlan` | `@Admin` |
| 114 | PUT | `/api/admin/subscription-plans/{planId}` | `AdminController#updatePlan` | `@Admin` |
| 115 | DELETE | `/api/admin/subscription-plans/{planId}` | `AdminController#deletePlan` | `@Admin` |
| 116 | GET | `/api/admin/domains` | `AdminController#getDomains` | `@Admin` |
| 117 | GET | `/api/admin/tags-analytics` | `AdminController#getTagsAnalytics` | `@Admin` |
| 118 | GET | `/api/admin/all-domains` | `AdminController#getAllDomains` | `@Admin` |
| 119 | GET | `/api/admin/all-categories` | `AdminController#getAllCategories` | `@Admin` |
| 120 | GET | `/api/admin/all-tags` | `AdminController#getAllTags` | `@Admin` |
| 121 | GET | `/api/admin/app-config` | `AdminController#getAppConfig` | `@Admin` |
| 122 | PUT | `/api/admin/app-config` | `AdminController#updateAppConfig` | `@Admin` |
| 123 | POST | `/api/admin/purge` | `AdminController#triggerPurge` | `@Admin` |
| 124 | GET | `/api/admin/purge/status` | `AdminController#purgeStatus` | `@Admin` |

### BLOC CHAT & WEBSOCKET — 7 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 125 | POST | `/api/conversations` | `ChatController#createConversation` | `@Authenticated` |
| 126 | GET | `/api/conversations` | `ChatController#listConversations` | `@Authenticated` |
| 127 | GET | `/api/conversations/{convId}/messages` | `ChatController#getMessages` | `@Authenticated` |
| 128 | PUT | `/api/conversations/{convId}/read` | `ChatController#markRead` | `@Authenticated` |
| 129 | WS | `/ws/chat/{convId}` | `ChatWebSocketHandler#handleChat` | Token query param |
| 130 | WS | `/ws/notifications` | `NotifWebSocketHandler#handle` | Token query param |
| 131 | WS | `/ws/spot-you/{pointId}` | `SpotYouWebSocketHandler#handle` | Token query param |

### BLOC UPLOAD — 1 endpoint (1 exclu)

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 132 | POST | `/api/upload-image` | `UploadController#uploadImage` | `@Authenticated` |

### BLOC PAYMENTS — 9 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 133 | GET | `/api/payments/me` | `PaymentController#myPayments` | `@Authenticated` |
| 134 | GET | `/api/payments/{paymentId}` | `PaymentController#getPayment` | `@Authenticated` |
| 135 | POST | `/api/payments/checkout/session` | `PaymentController#createCheckout` | `@Authenticated` |
| 136 | GET | `/api/payments/checkout/status/{sessionId}` | `PaymentController#checkoutStatus` | `@Authenticated` |
| 137 | POST | `/api/webhook/stripe` | `PaymentController#stripeWebhook` | Public (sig Stripe) |
| 138 | PATCH | `/api/payments/{paymentId}/stripe` | `PaymentController#syncStripe` | `@Authenticated` |
| 139 | GET | `/api/admin/payments` | `AdminController#getPayments` | `@Admin` |
| 140 | GET | `/api/admin/payments/stats` | `AdminController#getPaymentStats` | `@Admin` |
| 141 | GET | `/api/admin/subscriptions` | `AdminController#getSubscriptions` | `@Admin` (ARBITRAGE requis — voir PARTIE 2) |

### BLOC SUBSCRIPTIONS — 6 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 142 | GET | `/api/subscription-plans` | `SubscriptionController#listPlans` | Public |
| 143 | GET | `/api/subscriptions/me` | `SubscriptionController#getMySub` | `@Authenticated` |
| 144 | GET | `/api/subscriptions/history` | `SubscriptionController#getHistory` | `@Authenticated` |
| 145 | POST | `/api/subscriptions/subscribe` | `SubscriptionController#subscribe` | `@Authenticated` |
| 146 | POST | `/api/subscriptions/cancel` | `SubscriptionController#cancel` | `@Authenticated` |
| 147 | GET | `/api/subscriptions/checkout/status/{sessionId}` | `SubscriptionController#checkoutStatus` | `@Authenticated` |
| 148 | POST | `/api/admin/subscriptions/{subscriptionId}/cancel` | `AdminController#cancelSubscription` | `@Admin` |

### BLOC ADDRESSES — 4 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 149 | GET | `/api/addresses` | `AddressController#getAddresses` | `@Authenticated` |
| 150 | POST | `/api/addresses` | `AddressController#create` | `@Authenticated` |
| 151 | PUT | `/api/addresses/{addressId}` | `AddressController#update` | `@Authenticated` |
| 152 | DELETE | `/api/addresses/{addressId}` | `AddressController#delete` | `@Authenticated` |

### BLOC MARKETPLACE & PRODUCTS — 6 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 153 | GET | `/api/marketplace/products` | `MarketplaceController#listProducts` | Optional |
| 154 | GET | `/api/products/mine` | `ProductController#myProducts` | `@Authenticated` |
| 155 | GET | `/api/products/{productId}/detail` | `ProductController#getDetail` | Optional |
| 156 | POST | `/api/products` | `ProductController#create` | `@Authenticated` |
| 157 | DELETE | `/api/products/{productId}` | `ProductController#delete` | `@Authenticated` |
| 158 | POST | `/api/products/{productId}/reactivate` | `ProductController#reactivate` | `@Authenticated` |

### BLOC ADMIN PRODUCTS — 4 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 159 | GET | `/api/admin/products/pending` | `AdminController#listPendingProducts` | `@Admin` |
| 160 | GET | `/api/admin/products/{productId}` | `AdminController#getProduct` | `@Admin` |
| 161 | POST | `/api/admin/products/{productId}/approve` | `AdminController#approveProduct` | `@Admin` |
| 162 | POST | `/api/admin/products/{productId}/reject` | `AdminController#rejectProduct` | `@Admin` |

### BLOC DELETION / LIFECYCLE — 8 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| 163 | DELETE | `/api/users/{userId}` | `UserController#deleteUser` | `@Authenticated` |
| 164 | DELETE | `/api/tag-points/{pointId}` | `SpotYouController#deleteTagPoint` | `@Authenticated` |
| 165 | POST | `/api/tag-points/{pointId}/reactivate` | `SpotYouController#reactivate` | `@Authenticated` |
| 166 | DELETE | `/api/messages/{messageId}` | `ChatController#deleteMessage` | `@Authenticated` |
| 167 | PATCH | `/api/conversations/{convId}/leave` | `ChatController#leaveConversation` | `@Authenticated` |
| 168 | PATCH | `/api/users/{userId}/deactivate` | `UserController#deactivate` | `@Authenticated` |
| 169 | POST | `/api/users/{userId}/reactivate` | `UserController#reactivate` | `@Authenticated` |
| 170 | GET | `/api/users/me/reactivatable` | `UserController#getReactivatable` | `@Authenticated` |

### BLOC INFRA (server.py) — 4 endpoints

| # | Méthode | Path | Handler Java recommandé | Auth Java |
|---|---|---|---|---|
| S1 | GET | `/api/liveness` | `InfraController#liveness` | Public |
| S2 | GET | `/api/readiness` | `InfraController#readiness` | Public |
| S3 | GET | `/api/config/booking` | `ConfigController#bookingConfig` | Public |
| S4 | GET | `/api/config/commission` | `ConfigController#commissionConfig` | Public |

---

## PARTIE 2 — Endpoints À EXCLURE ou en ARBITRAGE

### A. Endpoints à exclure (ne pas migrer)

| Route | Raison d'exclusion | Alternative en Java |
|---|---|---|
| `GET /api/receiver/requests` | Alias non-standard de `GET /api/bookings/received`. Chemin hors convention. | Redirection 301 vers `/api/bookings/received` pendant 6 mois. |
| `GET /api/users/me/bookings` | Double-décorateur alias de `GET /api/bookings/me`. | Redirection 301 vers `/api/bookings/me` si utilisé par des clients. |
| `POST /api/upload-image/debug-422` | Route debug interne exposée. Aucune utilité en production. | `@Profile("local")` ou à supprimer complètement. |
| `GET /api/admin/subscriptions` (subscription_routes) | SHADOW — jamais appelé. Doublon de payment_routes. | Décision d'arbitrage : fusionner les deux handlers. |
| `GET /api/admin/subscription-plans` (subscription_routes) | SHADOW — jamais appelé. Doublon de admin_routes. | Décision d'arbitrage : conserver admin_routes uniquement. |

### B. Endpoints en ARBITRAGE (décision requise avant migration)

| Route | Problème | Options |
|---|---|---|
| `GET /api/admin/subscriptions` | Collision : `payment_routes:497` (gagne) vs `subscription_routes:453` (mort). Les deux handlers peuvent avoir des champs de réponse différents. | **Option A** : garder `payment_routes` uniquement (handler actif). **Option B** : fusionner les deux dans un seul handler Java. |
| `GET /api/admin/subscription-plans` | Collision : `admin_routes:210` (gagne) vs `subscription_routes:151` (mort). | **Option A** : garder `admin_routes` uniquement. **Option B** : fusionner. |
| `PUT` vs `PATCH /api/services/{serviceId}` | Un seul handler en Python. Spring Boot nécessite deux méthodes distinctes ou une décision sémantique claire. | **Option A** : garder `PUT` uniquement (remplacement complet). **Option B** : implémenter `PUT` (complet) + `PATCH` (partiel) correctement. |
| `POST /api/bookings` vs `POST /api/bookings/request` | Deux routes créant une réservation. `/bookings` est retro-compat. | **Option A** : conserver uniquement `/bookings/request` (sémantique explicite). **Option B** : conserver les deux avec dépréciation de `/bookings`. |
| `POST /api/spot-you/{id}/join` + `DELETE /api/spot-you/{id}/leave` | Alias fonctionnels de `/api/tag-points/{id}/join` et `leave`. | **Option A** : supprimer les routes `/spot-you/` et tout rediriger vers `/tag-points/`. **Option B** : maintenir les deux avec un service commun `SpotYouService`. |

---

## PARTIE 3 — Architecture Spring Boot recommandée

### Structure des contrôleurs

```
src/main/java/com/spotu/
├── controller/
│   ├── AuthController.java          # /api/auth/**
│   ├── UserController.java          # /api/users/**
│   ├── SpotYouController.java       # /api/tag-points/**, /api/spot-you/**
│   ├── HomeController.java          # /api/home/**
│   ├── ServiceController.java       # /api/services/**
│   ├── BookingController.java       # /api/bookings/**
│   ├── ChatController.java          # /api/conversations/**, DELETE /messages/**
│   ├── UploadController.java        # /api/upload-image
│   ├── PaymentController.java       # /api/payments/**, /api/webhook/stripe
│   ├── SubscriptionController.java  # /api/subscriptions/**, /api/subscription-plans
│   ├── AddressController.java       # /api/addresses/**
│   ├── MarketplaceController.java   # /api/marketplace/**
│   ├── ProductController.java       # /api/products/**
│   ├── DomainController.java        # /api/domains/**, /api/tags/**
│   ├── NotificationController.java  # /api/users/me/notifications/**
│   ├── PushController.java          # /api/users/push-token
│   ├── AdminController.java         # /api/admin/**
│   ├── InfraController.java         # /api/liveness, /api/readiness
│   └── ConfigController.java        # /api/config/**
└── websocket/
    ├── ChatWebSocketHandler.java    # /ws/chat/{convId}
    ├── NotifWebSocketHandler.java   # /ws/notifications
    └── SpotYouWebSocketHandler.java # /ws/spot-you/{pointId}
```

### Règles de nommage

| Python (FastAPI) | Java (Spring Boot) | Règle |
|---|---|---|
| `point_id` | `pointId` | snake_case → camelCase |
| `@router.get("/tag-points/{point_id}")` | `@GetMapping("/tag-points/{pointId}")` | kebab-case conservé dans les URLs |
| `Optional[str] = Depends(get_optional_auth)` | `@AuthenticationPrincipal(required=false)` | Auth optionnelle |
| `Depends(require_auth)` | `@AuthenticationPrincipal` ou `@PreAuthorize("isAuthenticated()")` | Auth obligatoire |
| `role == "admin"` | `@PreAuthorize("hasRole('ADMIN')")` | Contrôle de rôle |

### Priorité de migration par tranche

| Tranche | Blocs | Justification |
|---|---|---|
| **1** (fondation) | AUTH, USERS, INFRA | Authentification = prérequis de tout |
| **2** (core métier) | TAG-POINTS/SPOT-YOU, HOME, SERVICES | Cœur de valeur de l'application |
| **3** (transactions) | BOOKINGS, PAYMENTS, SUBSCRIPTIONS | Dépendent du core métier |
| **4** (support) | CHAT+WS, UPLOAD, ADDRESSES | Fonctionnalités secondaires |
| **5** (administration) | ADMIN, DOMAINS/TAGS, PRODUCTS, DELETION | Admin et backoffice |
