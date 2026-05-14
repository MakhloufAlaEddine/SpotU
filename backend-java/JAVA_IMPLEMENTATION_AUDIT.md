# JAVA_IMPLEMENTATION_AUDIT

Date audit: 2026-05-08  
Scope: `backend-java` (code reel + execution tests), pas seulement docs slices.

## Methode executable

- Inventaire routes via controllers Spring et config WS.
- Verification des gaps connus dans `KNOWN_GAPS_VS_PYTHON.md`.
- Verification config/runtime (`application.yml`, security, storage, workers).
- Execution complete tests: `mvn test` -> **367 tests, 0 failure, BUILD SUCCESS**.

## 1) Endpoints reellement manquants ou partiels

### Manquants (constates)

- `GET /api/uploads/**` (serving statique local) non expose par Spring.
- Alias legacy `GET /api/users/profile` absent (Java expose `GET /api/users/me`).
- Alias legacy `PATCH /api/bookings/{id}/status` absent (Java expose `POST /api/bookings/{id}/complete`).

### Presents mais partiellement branches (effets metier)

- Notifications WS slice 47: `NotifBroadcaster` no-op.
- Push chat: `ChatPushService` no-op.
- Purge physique media marketplace: `MarketplaceFilePurgeService` stub (log only).

## 2) Compatibilite front reelle

### Globalement compatible

- Prefix routes `/api` coherent.
- Formats snake_case largement preserves dans les payloads critiques.
- Dates ISO `+00:00` alignees via `PythonIsoTimestamps` sur domaines sensibles.
- Auth duale (Bearer + cookie fallback) presente sur flux critiques (auth/payments).

### Ecarts de compat a traiter

- Heterogeneite format erreurs selon domaine (`detail`, `error`, `error+details[]`).
- Quelques ecarts statut HTTP historiquement assumes:
  - certains `DataAccessException` -> `503` (Python etait souvent `500`).
  - certaines validations Java en `400` vs `422` Python.
- Alias legacy non exposes (profile read / booking complete legacy path).
- Upload URL locale generee (`/api/uploads/...`) mais route de serving absente.

## 3) Readiness split-routing par domaine

### SAFE_TO_SWITCH

- Auth (`/api/auth/*`, `/api/auth/me`)
- Users social/profile/public/reviews/follow/block
- Config + Referential + Home
- Bookings (reads + buyer flow + accept/refuse/cancel/complete)
- Payments (checkout/status, reads, webhook infra + handlers paiement/refund)
- Subscriptions (user + admin + webhook abonnement)
- Services (reads + CRUD + slots + packages + save/unsave)
- SpotYou (reads + writes + lifecycle + membership)
- Marketplace (public list + seller CRUD lifecycle + admin moderation)
- Chat REST + WS protocol core (handshake/codes/permissions)
- Notifications inbox REST

### PARTIAL

- Uploads: upload OK, serving local `/api/uploads/**` manquant.
- Temps reel notifications/push: API OK, transport push/ws partiellement stub.
- WebSocket en horizontal scaling: registry process-local (pas pub/sub distribue).

### KEEP_ON_PYTHON (pour cutover initial)

- Aucun domaine API principal strictement bloque.
- Recommande de garder provisoirement Python pour:
  - flux push temps reel critiques produit,
  - serving media local legacy si utilise par clients existants.

## 4) Infra/prod readiness (etat reel)

### Prerequis confirms

- `JWT_SECRET` obligatoire au boot.
- DB/Flyway/PostgreSQL operationnels.
- Stripe SDK + webhook endpoint presents.
- Schedulers actifs (`Expiry`, `MediaPurge`, `AdminReminder`).

### Points bloquants/fortement recommends avant cutover

- Configurer `STRIPE_WEBHOOK_SECRET` en prod (sinon signature non verifiee).
- Valider `R2_*` complet si objectif sans disque local.
- Mettre en place reverse-proxy WS (upgrade/timeouts/sticky ou bus distribue).
- Restreindre CORS prod (`APP_CORS_ALLOWED_ORIGINS`).

## 5) Tests reels et risques

- Etat actuel: **367 tests verts**.
- Forte couverture integration: payments/webhooks, bookings, subscriptions, services, spotyou, marketplace, users.
- Couverture plus faible:
  - workers secondaires (tests smoke),
  - split-routing global (gateway/canary/fallback),
  - push/WS multi-instance sous charge.

## Decision audit

- Readiness technique backend-java estimee: **84%**.
- Recommendation cutover: **PARTIAL GO**.
- Strategie: bascule progressive par domaine SAFE_TO_SWITCH + maintien Python temporaire pour zones PARTIAL.
