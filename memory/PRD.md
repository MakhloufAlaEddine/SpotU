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

### Phase 7 - Notifications branchées sur workflow booking/payment/subscription (2026-03-08)
| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03-08 | **booking_routes.py** : 3 nouvelles notifications — `booking_accepted` (payer), `booking_refused` (payer), `booking_cancelled` (receiver). Queries enrichies avec payer_user_id/receiver_user_id | backend/routes/booking_routes.py |
| 2026-03-08 | **webhook_handlers.py réécriture** : 12 événements → 12 notifications. Architecture pending_notifs (liste mutable passée aux handlers). Guard rows_updated > 0 (anti-doublon sur transitions déjà faites). Notifications envoyées APRÈS libération de la connexion DB (pas de deadlock). push_service.store_notification() + WebSocket broadcast | backend/webhook_handlers.py |
| 2026-03-08 | **test_notifications_iter53.py créé** : 17 tests (notifications booking + payment + subscription + anti-doublon) — 100% pass | backend/tests/test_notifications_iter53.py |
| 2026-03-08 | **pytest.ini amélioré** : pythonpath=. pour que les modules backend soient importables depuis tests/ | backend/pytest.ini |


| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03-08 | **payment_routes.py webhook refactorisé** : ~80 lignes de logique inline → ~15 lignes qui délèguent à `webhook_handlers.dispatch()`. Endpoint unifié, signature vérifiée, event_id requis | backend/routes/payment_routes.py |
| 2026-03-08 | **webhook_handlers.py** : dispatcher centralisé idempotent. Couvre payment_intent.*, checkout.session.completed, charge.refunded, refund.updated, customer.subscription.*, invoice.paid, invoice.payment_failed. Source de vérité = Stripe. Guards anti-régression (WHERE status NOT IN (...)). Table stripe_webhook_events pour traçabilité | backend/webhook_handlers.py |
| 2026-03-08 | **seed.py** : plans d'abonnement ajoutés au seed (plan_basic 9.99€/mois, plan_premium 19.99€/mois, plan_pro_annual 149.99€/an) | backend/seed.py |
| 2026-03-08 | **test_webhooks_iter52.py créé** : 28 tests (paiements, remboursements, abonnements, idempotence, anti-régression, cycles complets) — 100% pass | backend/tests/test_webhooks_iter52.py |
| 2026-03-08 | **test_stripe_payment_iter50.py corrigé** : 4 tests webhook mis à jour (event_id requis, assertion .get()) | backend/tests/test_stripe_payment_iter50.py |
| 2026-03-08 | **test_subscriptions_iter51.py corrigé** : make_webhook_body() génère maintenant un event_id unique | backend/tests/test_subscriptions_iter51.py |


| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03-08 | **stripe_service.py** : ensure_subscription_price (Product+Price idempotent), create_subscription_checkout_session (mode='subscription'), cancel_subscription (at_period_end), retrieve_subscription | backend/stripe_service.py |
| 2026-03-08 | **subscription_routes.py créé** : GET plans, GET/history me, POST subscribe, POST cancel, admin endpoints, handle_subscription_event() exporté | backend/routes/subscription_routes.py |
| 2026-03-08 | **pricing_engine.py refactorisé** : _load_subscription_benefits() isolé, compute_pricing() avec audit savings_payer/savings_receiver | backend/pricing_engine.py |
| 2026-03-08 | **payment_routes.py webhook** : dispatcher unifié → délègue subscription events à handle_subscription_event (bugfix: dispatch avant early-return) | backend/routes/payment_routes.py |
| 2026-03-08 | DB migration: stripe_product_id, stripe_price_id sur subscription_plans | backend/database.py |
| 2026-03-08 | Données test: plan_basic, plan_premium, plan_pro_annual | DB seed |
| 2026-03-08 | Test suite: 27 tests abonnements (100% pass) | backend/tests/test_subscriptions_iter51.py |

### Phase 9 - Flags globaux admin + MVP simplifié (2026-03-09)
| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03-09 | Table `app_config` en DB (key-value pour les flags globaux) | backend/database.py |
| 2026-03-09 | API publique `GET /api/config/booking` (no auth) | backend/server.py |
| 2026-03-09 | API admin `GET/PUT /api/admin/app-config` | backend/routes/admin_routes.py |
| 2026-03-09 | Normalisation service à la création/mise à jour selon flags | backend/routes/service_routes.py |
| 2026-03-09 | Normalisation réservation (409 si pay_later désactivé globalement) | backend/routes/booking_routes.py |
| 2026-03-09 | Hook `useBookingConfig` (cache module-level, /config/booking) | frontend/lib/useBookingConfig.ts |
| 2026-03-09 | Onglet "Réservations" dans admin panel (toggles + MVP banner) | frontend/app/admin/index.tsx |
| 2026-03-09 | Service detail : badges "Réservation directe · Paiement immédiat" par défaut | frontend/app/service/[id].tsx |
| 2026-03-09 | Confirm booking : sélecteur pay_later masqué si flag=false | frontend/app/booking/confirm.tsx |
| 2026-03-09 | Received bookings : boutons accept/refuse masqués si manual=false | frontend/app/bookings/received.tsx |
| 2026-03-09 | Create-service : Step 4 sauté si les 2 flags désactivés | frontend/app/create-service.tsx |
| 2026-03-09 | Tests : fixtures autouse par classe pour activer/désactiver les flags | backend/tests/test_booking_workflows_v2.py |

**Stratégie données existantes :** Maintien des données (services existants non modifiés en DB). Les flags sont appliqués à la création/MAJ de service ET au moment de chaque réservation (défense en profondeur). Les services en mode manual_approval sont traités comme instant_booking si le flag global est false.


| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03-09 | **NOUVEAU FLUX** : pay_now → autorisation immédiate à la demande, capture à l'acceptation | backend/routes/booking_routes.py |
| 2026-03-09 | `pay_booking` : accepte `requested+pay_now` (autorisation Stripe dès demande) | backend/routes/booking_routes.py |
| 2026-03-09 | `accept_booking` : si payment.status=authorized → capture PI → status=confirmed | backend/routes/booking_routes.py |
| 2026-03-09 | Frontend : note "confirmé maintenant, débité après acceptation" + bouton autorisation | frontend/app/booking/confirm.tsx |
| 2026-03-09 | Frontend : payment-success gère statut `authorized` (message en attente coach) | frontend/app/payment-success.tsx |
| 2026-03-09 | Frontend : bookings/index bouton "Confirmer le paiement" orange pour requested+pay_now | frontend/app/bookings/index.tsx |
| 2026-03-09 | Tests : 25/25 tests workflow + 2 nouveaux tests (pay_allowed_requested, accept_captures_authorized) | backend/tests/test_booking_workflows_v2.py |

## Test Suite
```bash
# Tests workflow de réservation (PRINCIPAUX)
cd /app/backend && pytest tests/test_booking_workflows_v2.py -v  # 25/25 ✅

# E2E Playwright
cd /app/frontend/e2e && python3 -m pytest --browser chromium --tb=short -v

# Backend Stripe tests
cd /app/backend && pytest tests/test_stripe_payment_iter50.py -v
```
- test_booking_workflows_v2.py: 25 tests workflow (flux A/B/C/D, concurrence, expiry) ✅
- test_01_auth.py ~ test_10_image_deletion.py: 45 tests ✅
- test_admin_iter48.py: 27 tests admin dashboard ✅
- test_stripe_payment_iter50.py: 61 tests Stripe PaymentIntent ✅

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

## What's Been Implemented (suite)

### Phase 8 - Navigation Monétisation (2026-03-08)
| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03-08 | **profile.tsx** : Nouvelle section "Réservations & Services" | frontend/app/(tabs)/profile.tsx |
| 2026-03-08 | **Politique d'annulation complète** : payeur/bénéficiaire/admin | backend/* |

## Prioritized Backlog

### P0 - Critique (TOUS COMPLÉTÉS)
- [x] Upload web (blob URI fix)
- [x] Suite E2E Playwright
- [x] Admin Dashboard monetisation
- [x] Intégration Stripe PaymentIntent + manual capture
- [x] Workflow de réservation flexible v2 (4 flux) — COMPLÉTÉ 2026-03-08
- [x] UI configuration booking service (section étape 3 wizard) — COMPLÉTÉ 2026-03-08

### Phase 5c - Frontend Booking UX (2026-03-08) ✅ TERMINÉ

**booking/confirm.tsx — Refonte complète :**
- `useCountdown` hook (mise à jour chaque seconde)
- Sélecteur "Payer maintenant" / "Payer plus tard" (visible si `allow_pay_later=true`)
- Note dynamique expliquant le comportement selon les 4 combinaisons mode×paiement
- Bouton adapté : "Réserver maintenant" (instant) vs "Envoyer la demande" (manual)
- 3 états post-booking : `awaiting_payment+pay_now`, `awaiting_payment+pay_later`, `requested`
- Countdown expiry sur le booking `awaiting_payment`
- `handlePay` → `POST /bookings/{id}/pay` (nouveau endpoint)
- Badge mode réservation + machine à états du paiement (idle/opening/verifying/timeout)

**bookings/index.tsx :**
- Status `awaiting_payment` + `confirmed` ajoutés au BOOKING_STATUS map
- Countdown live pour les bookings `awaiting_payment`
- CTA "Payer maintenant" pour `awaiting_payment` (plus seulement `accepted`)
- `handlePay` → `POST /bookings/{id}/pay`
- Filtre `active` inclut `awaiting_payment` et `confirmed`

**bookings/received.tsx :**
- Filtre "Paiement" (onglet `awaiting_payment`) avec badge bleu
- `useCountdown` hook → "⏱ Paiement attendu dans : Xm Ys"
- `handleAccept` met à jour le statut en `awaiting_payment` (pas `accepted`)
- Badge bleu sur le filtre si bookings `awaiting_payment` existent

**service/[id].tsx :**
- Badge "Réservation directe" (vert flash) / "Validation manuelle" (orange) dans la barre du bas
- Badge "Paiement différé possible" (bleu) si `allow_pay_later=true`

**Tests : 17/17 frontend passent**



**create-service.tsx — Section "Configuration des réservations" (Étape 3) :**
- Option cards pour `booking_approval_mode`: Réservation directe / Validation manuelle
- Option cards pour `allow_pay_later`: Paiement immédiat / Payer plus tard  
- Chips délai d'expiration: 30 min, 1h, 2h, 4h, 1 jour (visibles seulement si pay_later=true)
- Warning amber si pay_later activé
- Bloc impact dynamique (4 combinaisons, 4 couleurs: vert/bleu/orange/amber)
- Badge résumé dans l'étape 4 (Résumé & Publication)
- Chargement automatique des valeurs en mode édition
- Payload envoyé correctement à l'API: `booking_approval_mode`, `allow_pay_later`, `pay_later_expiration_minutes`

**Tests: 16/16 tests frontend passent**

**Backend v2 - 4 flux de réservation configurables :**

| Flux | Mode approbation | Paiement | Statut initial | Après accept |
|------|-----------------|----------|----------------|--------------|
| A | instant_booking | pay_now | awaiting_payment (30min) | N/A |
| B | instant_booking | pay_later | awaiting_payment (configurable) | N/A |
| C | manual_approval | pay_now | requested (48h) | awaiting_payment (30min) |
| D | manual_approval | pay_later | requested (48h) | awaiting_payment (configurable) |

**Endpoints ajoutés/modifiés :**
- `POST /bookings/request` — Crée une réservation selon le workflow configuré
- `POST /bookings/{id}/accept` — requested → awaiting_payment (avec timedelta Python)
- `POST /bookings/{id}/pay` — Crée une Stripe Checkout Session (metadata dict corrigé)
- `POST /bookings/{id}/cancel` — Libère les slots reserved/pending/booked
- `PATCH /services/{id}` — Alias PATCH pour configurer booking_approval_mode, allow_pay_later
- Worker d'expiration : gère awaiting_payment + requested

**Tests : 55/55 tests backend passent (3 skips attendus — pas de slots single disponibles)**

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
