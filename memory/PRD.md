# SpotU - Product Requirements Document

## Original Problem Statement
Application mobile "SpotU" - plateforme hyperlocale, basée sur les tags.
Fonctionnalités : création/découverte de services et SpotYous, système de réservation, chat/notifications temps réel, moteur de monétisation générique + paiements Stripe.

## Tech Stack
- **Frontend**: Expo (React Native Web) - port 3000
- **Backend**: FastAPI - port 8001 (routes préfixées `/api`)
- **DB**: PostgreSQL (DATABASE_URL depuis .env)
- **Paiements**: Stripe via emergentintegrations (StripeCheckout)
- **Tests E2E**: Playwright Python + pytest

## User Personas
- **User** (user@winek.app): Découvre, réserve et paie les SpotYous/services
- **Coach** (coach@winek.app): Crée et gère des SpotYous/services, reçoit les paiements
- **Admin** (admin@winek.app): Gestion admin dashboard, configure les tarifs

## Core Requirements
1. SpotYou & Service CRUD (création, découverte, mise à jour, suppression)
2. Découverte sur carte + recherche par tags
3. Système de réservation (bookings)
4. Chat temps réel + notifications
5. Upload sécurisé d'images (profil, service, SpotYou)
6. Tests E2E complets
7. Moteur de monétisation générique (pricing_engine.py)
8. Paiements Stripe Checkout + webhooks

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
| 2026-03-08 | **Intégration Stripe Checkout** (emergentintegrations) | backend/routes/payment_routes.py |
| 2026-03-08 | **UI paiement post-réservation** (Payer maintenant / Payer plus tard) | frontend/app/booking/confirm.tsx |
| 2026-03-08 | **Page retour Stripe** avec polling statut | frontend/app/payment-success.tsx |
| 2026-03-08 | Bug corrigé: AuthContext OAuth callback trop large | frontend/context/AuthContext.tsx |

## Test Suite (E2E Playwright)
```bash
cd /app/frontend/e2e && python3 -m pytest --browser chromium --tb=short -v
```
- test_01_auth.py ~ test_10_image_deletion.py: 45 tests ✅
- test_admin_iter48.py: 27 tests admin dashboard ✅
- test_stripe_iter49.py: 22 tests Stripe ✅
**Total: 94 tests passent**

## Code Architecture
```
/app
├── backend/
│   ├── pricing_engine.py           # Moteur de pricing centralisé
│   ├── database.py                 # Schema PostgreSQL + migrations
│   ├── routes/
│   │   ├── admin_routes.py         # CRUD pricing rules, subscription plans
│   │   ├── booking_routes.py       # Création atomique booking+payment
│   │   └── payment_routes.py       # Stripe checkout session/status/webhook
│   └── tests/
│       ├── test_pricing.py
│       ├── test_pricing_engine.py
│       ├── test_admin_iter48.py
│       └── test_stripe_iter49.py
└── frontend/
    └── app/
        ├── (tabs)/
        │   └── notifications.tsx   # (anciennement bookings)
        ├── admin/index.tsx          # Dashboard Admin (stats/règles/plans/paiements)
        ├── booking/confirm.tsx      # Confirmation + paiement Stripe
        └── payment-success.tsx      # Page retour Stripe + polling
```

## Key API Endpoints
### Paiements Stripe
- `POST /api/payments/checkout/session` — Créer session Stripe (body: {booking_id, origin_url})
- `GET /api/payments/checkout/status/{session_id}` — Vérifier statut paiement
- `POST /api/webhook/stripe` — Webhook Stripe (payment_intent.succeeded etc.)
- `GET /api/payments/me` — Historique paiements utilisateur

### Admin Monetisation
- `GET/POST/PUT/DELETE /api/admin/pricing-rules`
- `GET/POST/PUT/DELETE /api/admin/subscription-plans`
- `GET /api/admin/stats`
- `GET /api/admin/payments`

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
- [x] Intégration Stripe Checkout

### P1 - Important
- [ ] Flow abonnement utilisateur (souscrire/gérer un plan Stripe Subscription)
- [ ] Update SpotYou flow (à valider post-upload fix)
- [ ] Fix pre-existing backend tests (test_notifications_iter47.py, etc.)

### P2 - Souhaité
- [ ] Support bilingue FR/EN (i18n)
- [ ] Push Notifications EAS Build
- [ ] Badge Admin dans profil (cosmétique)

### Futur / Backlog
- [ ] Admin Dashboard amélioré
- [ ] Optimisation performance (lazy loading)
- [ ] Stripe Connect pour les coaches (payouts automatiques)
- [ ] Tests backend étendus

## Key DB Schema
- **payments**: `{payment_id, payer_user_id, receiver_user_id, product_type, base_amount, payer_total_amount, receiver_net_amount, platform_total_fee, status, currency, stripe_payment_intent_id (stocke aussi session_id Stripe), pricing_rule_snapshot (JSONB)}`
- **pricing_rules**: `{rule_id, product_type, payer_fixed_fee, payer_percent_fee, receiver_fixed_fee, receiver_percent_fee, active, priority, description, currency}`
- **subscription_plans**: `{plan_id, name, price, duration_days, exempt_payer_fixed, exempt_payer_percent, exempt_receiver_fixed, exempt_receiver_percent, active}`
- **user_subscriptions**: `{subscription_id, user_id, plan_id, stripe_subscription_id, status, starts_at, expires_at}`

## Credentials de test
- Admin: admin@winek.app / WinekAdmin2024!
- Coach: coach@winek.app / WinekCoach2024!
- User: user@winek.app / WinekUser2024!

## Stripe Test Flow
1. User se connecte → navigue vers un service → clique "Réserver"
2. Confirmation → notes → "Envoyer la demande au coach"  
3. Booking créé → pricing calculé → bouton "Payer maintenant (X.XX €)" affiché
4. Click → `POST /api/payments/checkout/session` → URL Stripe checkout créée
5. Redirect vers checkout.stripe.com → paiement avec carte test (4242 4242 4242 4242)
6. Stripe redirect vers `/payment-success?session_id=cs_test_...`
7. Polling `GET /api/payments/checkout/status/{session_id}` → status "succeeded" → affiche succès
