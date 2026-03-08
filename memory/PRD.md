# SpotU - Product Requirements Document

## Original Problem Statement
Application mobile "SpotU" - plateforme hyperlocale, basée sur les tags.
Fonctionnalités : création/découverte de services et SpotYous, système de réservation, chat/notifications temps réel, moteur de monétisation générique + paiements Stripe.

## Tech Stack
- **Frontend**: Expo (React Native Web) - port 3000
- **Backend**: FastAPI - port 8001 (routes préfixées `/api`)
- **DB**: PostgreSQL (DATABASE_URL depuis .env)
- **Paiements**: Stripe via SDK natif + proxy Emergent (sk_test_emergent)
- **Tests E2E**: Playwright Python + pytest

## User Personas
- **User** (user@winek.app): Découvre, réserve et paie les SpotYous/services
- **Coach** (coach@winek.app): Crée et gère des SpotYous/services, reçoit les paiements
- **Admin** (admin@winek.app): Gestion admin dashboard, configure les tarifs

## Core Requirements
1. SpotYou & Service CRUD (création, découverte, mise à jour, suppression)
2. Découverte sur carte + recherche par tags
3. Système de réservation (bookings) — atomique, idempotent, row-level locking
4. Chat temps réel + notifications
5. Upload sécurisé d'images (profil, service, SpotYou)
6. Tests E2E complets
7. Moteur de monétisation générique (pricing_engine.py)
8. Paiements Stripe PaymentIntent (capture_method=manual) + webhooks

## What's Been Implemented

### Phase 1 - Core Features
- Auth JWT (login/register/logout)
- SpotYou CRUD complet
- Services CRUD
- Carte interactive avec markers
- Recherche par tags et domaines
- Chat temps réel (WebSocket)
- Notifications temps réel (WebSocket)
- Système de réservation

### Phase 2 - Sécurité & Qualité
| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-02 | SEC-02: Stockage sécurisé JWT (expo-secure-store) | frontend/lib/storage.ts |
| 2026-02 | SEC-12: Rate limiting API pagination | backend/routes/admin_routes.py, chat_routes.py, tagpoint_routes.py |
| 2026-03 | E2E Tests: 45 tests Playwright | frontend/e2e/ |
| 2026-03 | P0 Bugfix: Suppression images BDD JSONB fix | backend/routes/service_routes.py |
| 2026-03 | Rate limit login: 30/min | backend/routes/auth_routes.py |
| 2026-03 | P0 Bugfix: Planning scroll TDZ bug | frontend/app/planning.tsx |

### Phase 3 - Moteur de Monétisation (2026-03)
| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03-08 | Moteur pricing centralisé avec Decimal | backend/pricing_engine.py |
| 2026-03-08 | Tables DB: payments, pricing_rules, subscription_plans, user_subscriptions | backend/database.py |
| 2026-03-08 | Admin Dashboard monetization: CRUD règles tarifaires + plans | frontend/app/admin/index.tsx |
| 2026-03-08 | Bug corrigé: ordre init DB (tables base avant migrations) | backend/database.py |
| 2026-03-08 | Bug corrigé: React hooks violation dans AdminScreen | frontend/app/admin/index.tsx |
| 2026-03-08 | Expiration auto bookings : expiry_worker.py + TTL guard accept + expires_at | backend/expiry_worker.py, booking_routes.py |
| 2026-03-08 | DB: slot_status + idempotency_key + 2 index UNIQUE | backend/database.py |
| 2026-03-08 | Enums: BookingStatus (6), SlotStatus (6), PaymentStatus (7) | backend/models.py |

### Phase 4 - Stripe PaymentIntent + Manual Capture (2026-03-08)
| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03-08 | **stripe_service.py créé** : wrapper SDK natif, create_checkout_session (capture_method=manual), capture_payment_intent, cancel_payment_intent, parse_webhook_event, Stripe Connect | backend/stripe_service.py |
| 2026-03-08 | **payment_routes.py réécrit** : SDK Stripe natif, checkout session avec capture manuelle, status polling, webhook dispatcher | backend/routes/payment_routes.py |
| 2026-03-08 | **booking_routes.py étendu** : capture Stripe après accept, annulation Stripe après refuse/cancel | backend/routes/booking_routes.py |
| 2026-03-08 | **expiry_worker.py étendu** : annulation Stripe PaymentIntent lors de l'expiration | backend/expiry_worker.py |
| 2026-03-08 | DB migration: stripe_checkout_session_id colonne dans payments | backend/database.py |
| 2026-03-08 | Test suite: 61 tests backend Stripe (100% pass) | backend/tests/test_stripe_payment_iter50.py |

### Phase 5 - Abonnements Stripe (2026-03-08)
| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03-08 | **stripe_service.py** : ensure_subscription_price (Product+Price idempotent), create_subscription_checkout_session (mode='subscription'), cancel_subscription (at_period_end), retrieve_subscription | backend/stripe_service.py |
| 2026-03-08 | **subscription_routes.py créé** : GET plans, GET/history me, POST subscribe, POST cancel, admin endpoints, handle_subscription_event() exporté | backend/routes/subscription_routes.py |
| 2026-03-08 | **pricing_engine.py refactorisé** : _load_subscription_benefits() isolé, compute_pricing() avec audit savings_payer/savings_receiver | backend/pricing_engine.py |
| 2026-03-08 | **payment_routes.py webhook** : dispatcher unifié → délègue subscription events à handle_subscription_event (bugfix: dispatch avant early-return) | backend/routes/payment_routes.py |
| 2026-03-08 | DB migration: stripe_product_id, stripe_price_id sur subscription_plans | backend/database.py |
| 2026-03-08 | Données test: plan_basic, plan_premium, plan_pro_annual | DB seed |
| 2026-03-08 | Test suite: 27 tests abonnements (100% pass) | backend/tests/test_subscriptions_iter51.py |

## Test Suite
```bash
# E2E Playwright
cd /app/frontend/e2e && python3 -m pytest --browser chromium --tb=short -v

# Backend Stripe tests
cd /app/backend && pytest tests/test_stripe_payment_iter50.py -v
```
- test_01_auth.py ~ test_10_image_deletion.py: 45 tests ✅
- test_admin_iter48.py: 27 tests admin dashboard ✅
- test_stripe_iter49.py: 22 tests (3 assertions à corriger pour nouveau flow) ⚠️
- test_stripe_payment_iter50.py: 61 tests Stripe PaymentIntent ✅
- test_booking_workflow.py: concurrency tests ✅
- test_booking_expiry.py: expiration worker tests ✅

## Code Architecture
```
/app
├── backend/
│   ├── stripe_service.py           # Wrapper Stripe SDK (PaymentIntent, Checkout, Connect)
│   ├── pricing_engine.py           # Moteur de pricing centralisé
│   ├── expiry_worker.py            # Worker expiration bookings + annulation Stripe
│   ├── database.py                 # Schema PostgreSQL + migrations
│   ├── routes/
│   │   ├── admin_routes.py         # CRUD pricing rules, subscription plans
│   │   ├── booking_routes.py       # Booking atomique + Stripe capture/cancel
│   │   └── payment_routes.py       # Stripe checkout session/status/webhook (SDK natif)
│   └── tests/
│       ├── test_pricing.py
│       ├── test_pricing_engine.py
│       ├── test_booking_workflow.py
│       ├── test_booking_expiry.py
│       ├── test_admin_iter48.py
│       ├── test_stripe_iter49.py (3 assertions obsolètes à corriger)
│       └── test_stripe_payment_iter50.py
└── frontend/
    └── app/
        ├── (tabs)/
        │   └── notifications.tsx   # (anciennement bookings)
        ├── admin/index.tsx          # Dashboard Admin (stats/règles/plans/paiements)
        ├── booking/confirm.tsx      # Confirmation + paiement Stripe
        └── payment-success.tsx      # Page retour Stripe + polling
```

## Key API Endpoints
### Paiements Stripe (SDK natif, capture_method=manual)
- `POST /api/payments/checkout/session` — Créer session Checkout Stripe (capture manuelle)
- `GET /api/payments/checkout/status/{session_id}` — Vérifier statut paiement
- `POST /api/webhook/stripe` — Webhook Stripe (checkout.session.completed, payment_intent.succeeded, etc.)
- `GET /api/payments/me` — Historique paiements utilisateur

### Bookings (avec Stripe intégré)
- `POST /api/bookings/request` — Créer réservation (booking + payment record)
- `POST /api/bookings/{id}/accept` — Accepter + capturer PaymentIntent Stripe
- `POST /api/bookings/{id}/refuse` — Refuser + annuler PaymentIntent Stripe
- `POST /api/bookings/{id}/cancel` — Annuler + annuler PaymentIntent Stripe
- `PATCH /api/bookings/{id}/status` — Endpoint legacy (redirige vers verbes dédiés)

### Admin Monetisation
- `GET/POST/PUT/DELETE /api/admin/pricing-rules`
- `GET/POST/PUT/DELETE /api/admin/subscription-plans`
- `GET /api/admin/stats`
- `GET /api/admin/payments`
- `GET /api/admin/payments/stats`

### Autres
- `POST /api/upload-image`
- `GET /api/tag-points`
- `POST /api/auth/login` (rate: 30/min)
- `GET /api/users/me/notifications`

## Prioritized Backlog

### P0 - Critique
- [x] Upload web (blob URI fix)
- [x] Suite E2E Playwright
- [x] Admin Dashboard monetisation
- [x] Intégration Stripe PaymentIntent + manual capture (COMPLÉTÉ 2026-03-08)

### P1 - Important
- [ ] Flow abonnement utilisateur (souscrire/gérer un plan Stripe Subscription)
- [ ] Update SpotYou flow (à valider post-upload fix)
- [ ] Fix test_stripe_iter49.py (3 assertions obsolètes pour nouveau webhook behavior)
- [ ] Fix pre-existing backend tests (test_notifications_iter47.py, etc.)

### P2 - Souhaité
- [ ] Implémenter stripe.Refund.create() pour annulation post-capture
- [ ] Support bilingue FR/EN (i18n)
- [ ] Push Notifications EAS Build
- [ ] Badge Admin dans profil (cosmétique)

### P3 - Production
- [ ] Configurer STRIPE_WEBHOOK_SECRET avec la vraie clé webhook Stripe
- [ ] Tester avec une vraie clé Stripe (pas le proxy Emergent) pour valider capture_method=manual

### Futur / Backlog
- [ ] Admin Dashboard amélioré
- [ ] Optimisation performance (lazy loading)
- [ ] Stripe Connect pour les coaches (payouts automatiques) — scaffold déjà dans stripe_service.py
- [ ] Tests backend étendus

## Key DB Schema
- **payments**: `{payment_id, payer_user_id, receiver_user_id, product_type, base_amount, payer_total_amount, receiver_net_amount, platform_total_fee, status, currency, stripe_payment_intent_id, stripe_checkout_session_id, stripe_charge_id, stripe_transfer_id, pricing_rule_snapshot (JSONB)}`
- **bookings**: `{booking_id, service_id, user_id, coach_id, status, slot_id, slot_status, expires_at, idempotency_key, ...}`
- **pricing_rules**: `{rule_id, product_type, payer_fixed_fee, payer_percent_fee, receiver_fixed_fee, receiver_percent_fee, active, priority, description, currency}`
- **subscription_plans**: `{plan_id, name, price, duration_days, exempt_*, active}`
- **user_subscriptions**: `{subscription_id, user_id, plan_id, stripe_subscription_id, status, starts_at, expires_at}`
- **users**: `{..., stripe_customer_id, stripe_account_id}`

## Stripe Flow (avec capture manuelle)
1. User se connecte → navigue vers un service → clique "Réserver"
2. Confirmation → notes → "Envoyer la demande au coach"
3. Booking créé → pricing calculé → payment record avec status='requires_authorization'
4. Bouton "Payer maintenant (X.XX €)" → `POST /api/payments/checkout/session`
5. Checkout Session créée avec `payment_intent_data.capture_method=manual` → URL Stripe
6. User paie via Stripe Checkout → PaymentIntent en `requires_capture`
7. Webhook `checkout.session.completed` → payment status='authorized' en DB
8. Coach voit la demande → accepte → `POST /api/bookings/{id}/accept`
9. Backend: DB booking='accepted', puis `stripe.PaymentIntent.capture(pi_id)` → payment status='captured'
10. Coach refuse → `POST /api/bookings/{id}/refuse` → `stripe.PaymentIntent.cancel(pi_id)` → remboursement auto
11. Expiration (48h sans réponse) → expiry_worker → `stripe.PaymentIntent.cancel(pi_id)` → remboursement auto

## Credentials de test
- Admin: admin@winek.app / WinekAdmin2024!
- Coach: coach@winek.app / WinekCoach2024!
- User: user@winek.app / WinekUser2024!

## Notes Techniques - Proxy Emergent Stripe
Le proxy Emergent (`sk_test_emergent` → `https://integrations.emergentagent.com/stripe`) est utilisé pour les tests. Comportement connu :
- `session.payment_intent = None` (le proxy ne retourne pas l'ID du PI)
- Les appels `capture_payment_intent` / `cancel_payment_intent` sont silencieusement skippés (null check)
- En production avec une vraie clé Stripe, `session.payment_intent` est peuplé et la capture manuelle fonctionne
