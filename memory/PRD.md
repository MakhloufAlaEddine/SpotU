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

### Phase 5 - Protection réseau avancée — COMPLÈTE (2026-03)
| Date | Composant | Fichiers |
|------|-----------|---------|
| 2026-03 | `lib/cache.ts` — cache persistant (AsyncStorage + TTL + metadata) | NEW |
| 2026-03 | `lib/network-error.ts` — classification offline/timeout/5xx/401/403 | NEW |
| 2026-03 | `hooks/useNetwork.ts` — détection connectivité + refresh progressif | NEW |
| 2026-03 | `hooks/useScreenData.ts` — ScreenState (loading_initial/ready_fresh/ready_cached/error_no_data) | NEW |
| 2026-03 | `components/OfflineBanner.tsx` — bannière globale + StaleBanner + ErrorNoData | NEW |
| 2026-03 | `lib/api.ts` — timeout 10s AbortController + classification erreurs | UPDATED |
| 2026-03 | `app/_layout.tsx` — OfflineBanner globale | UPDATED |
| 2026-03 | `app/(tabs)/map.tsx` — cache stale-while-revalidate + screenState | UPDATED |
| 2026-03 | `app/(tabs)/chat.tsx` — cache + screenState + registerScreenRefresh | UPDATED |
| 2026-03 | `app/(tabs)/notifications.tsx` — cache + screenState + registerScreenRefresh | UPDATED |
| 2026-03 | `app/spot-you/[id].tsx` — guard offline mutations + cacheInvalidate ciblée | UPDATED |
| 2026-03 | `app/spot-me.tsx` — 4-états + StaleBanner + guard offline toggleGoing + cacheInvalidate | UPDATED |
| 2026-03 | `app/chat/[id].tsx` — guard offline envoi (isConnected check + Alert explicite) | UPDATED |
| 2026-03 | `app/(tabs)/profile.tsx` — 4-états dataScreenState + StaleBanner + timeout anti-spinner | UPDATED |
| 2026-03 | `@react-native-community/netinfo@12.0.1` installé | package.json |
### Phase 8 — Gestion Admin Tags & Domaines (2026-03-12)
| Date | Composant | Changement |
|------|-----------|-----------|
| 2026-03-12 | `routes/domain_routes.py` | Ajout PUT/DELETE pour domains, tag_categories, tags + endpoints usage (/usage) |
| 2026-03-12 | `routes/admin_routes.py` | Ajout /admin/all-domains, /admin/all-categories, /admin/all-tags, /admin/tags-analytics |
| 2026-03-12 | `frontend/app/admin/index.tsx` | Nouvel onglet "Tags" (6e tab) avec CRUD complet + stats visuelles |
| 2026-03-12 | `backend/tests/test_tags_domains_iter78.py` | 35 tests de régression pour le CRUD tags/domaines |

**Fonctionnalités ajoutées :**
- CRUD complet Domaines (ajout, modification, désactivation, suppression cascade)
- CRUD complet Catégories de tags (ajout, modification, désactivation, suppression cascade)
- CRUD complet Tags (ajout, modification, désactivation, suppression cascade)
- Modal d'avertissement à la suppression : affiche le nb d'utilisations (SpotYou + profils), propose "Désactiver" vs "Supprimer définitivement"
- Statistiques analytics : top 20 tags + top domaines par usage (SpotYou + profils utilisateurs), barres visuelles proportionnelles
- Recherche de tags dans le panneau admin

### Phase 7 — Nouvelles règles métier SpotYou (2026-03)
| Date | Composant | Changement |
|------|-----------|-----------|
| 2026-03 | `backend/routes/spot_you_routes.py` | Suppression auto-join; ajout vérification membership (403 si non-membre) dans `POST /spot-you/{id}/going` |
| 2026-03 | `backend/routes/spot_you_routes.py` | `DELETE /spot-you/{id}/leave` : changement UPDATE→DELETE pour annuler les séances futures |
| 2026-03 | `backend/routes/tagpoint_routes.py` | `get_tag_point` : `going_count=None` et `can_participate=False` pour non-membres; propriétaire toujours membre |
| 2026-03 | `backend/routes/tagpoint_routes.py` | `get_saved_tag_points` : vérification membership batch; masquage `going_count` pour non-membres |
| 2026-03 | `backend/routes/tagpoint_routes.py` | `my_tag_points` : `can_participate=True` pour le propriétaire |
| 2026-03 | `frontend/app/spot-you/[id].tsx` | Ajout état `canParticipate`; UI conditionnelle basée sur données backend |
| 2026-03 | `frontend/components/SpotYouCard.tsx` | Utilisation `can_participate` pour affichage conditionnel chip + bouton |
| 2026-03 | `backend/tests/test_spotyou_participation.py` | Tests mis à jour pour refléter nouvelles règles (19/19 passent) |


- **spot-you/[id].tsx** : loadPoint avec cache, screenState 4-états, StaleBanner, ErrorNoData (onBack), cacheInvalidate ciblé
- **ErrorNoData** : prop `onBack?` + bouton "Retour" (testID=`back-nav-btn`)
- **user/[id].tsx** : ErrorNoData avec onBack
- **lib/chat.ts** : `loadHistory` avec cache (buildCacheKey/cacheGet/cacheSet/isFresh), `historyState` ('loading'|'loaded'|'error'), `ws.onmessage` met à jour le cache après chaque nouveau message
- **chat/[id].tsx** : `currentUserId` depuis `storage.get('spotu_user')` (offline-safe), `convInfo` depuis `storage.get('spotu_conv_${id}')` en premier, `ErrorNoData` conditionnel quand `historyState==='error' && messages.length===0`
- **21/21 tests PASS** — `/app/frontend/e2e/test_17_chat_cache_errornodata.py`

### Phase 6 — Composant partagé SpotYouCard + Écran Enregistrés (2026-03-11) + Shared Components (2026-03-11)
- **SpotYouCard.tsx** : props `testID?` + `headerAction?` ajoutés
- **spot-me.tsx** : `SpotCard` local supprimé → `SpotYouCard` partagé utilisé (testID `my-tp-*` préservé)
- **saved.tsx** : onglet SpotYou → `SpotYouCard` complet (going, participants) + overlay unsave + offline guard
- **Backend `/tag-points/saved`** : enrichi avec `going_count`, `is_going`, `next_session_date`, `participants_count`, `rating`, `vote_count`
- **UserAvatar.tsx** (nouveau) : avatar circulaire partagé, taille configurable, fallback initiale
- **ScreenLoader.tsx** (nouveau) : spinner centré plein-écran
- **EmptyState.tsx** (nouveau) : icône + titre + sous-titre + bouton optionnel
- **Migration 6 écrans** : chat, notifications, profile, user/[id], spot-me, bookings → 16/16 tests PASS
- **Fix bug closure** : `notifications.tsx` — `loadedFromCache` remplace `notifs.length` dans le catch

### Phase 7 — Cover Photo Repositioning (2026-03-11)
- **cover_offset_y FLOAT DEFAULT 0.5** colonne ajoutée à la table users (database.py)
- **Photos de couverture seed** pour profils de test (coach→fitness, demo001→running, demo002→basketball, demo003→yoga)
- **PATCH /api/users/{id}/cover** accepte maintenant `cover_offset_y` (user_routes.py)
- **GET /api/users/{id}/public** retourne `cover_offset_y` (user_routes.py)
- **Affichage cover** : positionnement absolu + overflow:hidden, image 380px > container 220px
- **Modal repositionnement** : PanResponder glisser vertical, guide central, "Enregistrer"/"Annuler"
- **ActionSheet** : si photo déjà uploadée → "Changer" ou "Repositionner" ; sinon → picker direct
- **Post-upload** : Alert propose immédiatement le repositionnement

### Phase 6b — Refactoring UX + Gamification Profil (2026-03-11) ✅ TERMINÉ
- **SpotYouCard.tsx** : labels boutons harmonisés ("Rejoindre"/"Quitter", "Je participe"/"Annuler")
- **spot-you/[id].tsx** : labels boutons cohérents avec SpotYouCard
- **components/index.ts** : barrel file pour imports simplifiés (SpotYouCard, UserAvatar, ScreenLoader, EmptyState)
- **user/[id].tsx** — Empty state redesigné : CTA motivant (propriétaire) + message doux (visiteur)
- **user/[id].tsx** — **ProfileCompletionBar** 5 étapes : Photo, Bio, Centres d'intérêt, SpotYou, Réservation
  - 20% par étape, affichage conditionnel (masqué à 100%)
  - `GET /api/bookings/me` pour détecter la 1ère réservation
  - ✅ Vérifié visuellement : 20% affiché correctement pour admin@winek.app (seul Bio complété)

**Détails**:
- Clé cache = méthode + path + params normalisés + userId + schemaVersion
- Fallback cache JAMAIS pour 401/403 (erreurs auth toujours propagées)
- Refresh progressif au retour réseau (écrans prioritaires d'abord, délai 350ms entre chaque)
- Invalidation ciblée: join/leave → `/tag-points,/planning,/conversations` | going → `/planning,/tag-points/mine`
- Actions offline (join, going, send chat) → message explicite, **zéro échec silencieux**
- Garde-fou anti-spinner infini: timeout 8s sur refreshUser() dans profile.tsx
- 4 cas aucun échec silencieux validés: toggleGoing, sendMessage WS, loadData profile, loadPoints spot-me


| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03 | Feedback sonore + haptic sur boutons principaux | frontend/hooks/useClickSound.ts, [id].tsx, spot-me.tsx |
| 2026-03 | expo-av@16.0.8 installé | frontend/package.json |
| 2026-03 | test_11_spotyou_rules.py — règles métier propriétaire/membre/non-membre + modals | frontend/e2e/ |
| 2026-03 | test_12_spotme.py — SpotMe, Planning, Profile extended tests | frontend/e2e/ |

**Tests E2E — Couverture totale validée (Iteration 68)**:
- 68 tests PASS, 1 SKIP, 0 FAIL (tous fichiers test_01→test_12)
- Règles testées: owner no-rsvp, owner-bar, owner-group-chat, member group-chat, confirm modals
- SpotMe, Planning, Profile, Chat, Auth, Search, Upload, CRUD, Image deletion

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

### Phase 3 - MVP Booking Flow & Planning (2026-03)
| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03 | MVP Booking: bouton unique "Réserver et payer maintenant" | frontend/app/booking/confirm.tsx |
| 2026-03 | Fix Stripe polling (pas de webhooks) | backend/routes/payment_routes.py |
| 2026-03 | Bookings dans Planning view | frontend/app/planning.tsx, backend/routes/tagpoint_routes.py |

### Phase 4 - Système de Participation SpotYou (2026-03)
| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03 | DB Migration: tables spot_you_participants + spot_you_attendance | backend/database.py |
| 2026-03 | DB Migration: colonnes minimum_participants + maximum_participants sur tag_points | backend/database.py |
| 2026-03 | API: POST/DELETE /spot-you/{id}/join et /leave | backend/routes/spot_you_routes.py |
| 2026-03 | API: POST/DELETE /spot-you/{id}/going | backend/routes/spot_you_routes.py |
| 2026-03 | API: GET /spot-you/{id}/members + /going | backend/routes/spot_you_routes.py |
| 2026-03 | Backend: champs is_member, is_going, going_count, is_full, next_session_date dans GET /tag-points/{id} | backend/routes/tagpoint_routes.py |
| 2026-03 | Frontend: Bouton "Rejoindre" + "Je viens" sur écran SpotYou | frontend/app/spot-you/[id].tsx |
| 2026-03 | Frontend: Compteurs "X membres" et "X viennent" | frontend/app/spot-you/[id].tsx |
| 2026-03 | Frontend: Badge "Complet" si capacité atteinte | frontend/app/spot-you/[id].tsx |
| 2026-03 | Frontend: Section Capacité (min/max) dans stepper création | frontend/app/(tabs)/create.tsx |
| 2026-03 | Worker: SpotYouNotifWorker (notifications post-séance + 3h avant) | backend/spot_you_notif_worker.py |
| 2026-03 | Tests: 17/17 tests backend test_spotyou_participation.py | backend/tests/test_spotyou_participation.py |

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

## Phase 11 - MVP Single-Click Booking Flow (2026-03)
| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-03 | **FEATURE** : Bouton unique "Réserver et payer maintenant" - handleReserveAndPay chain booking+Stripe en 1 action | frontend/app/booking/confirm.tsx |
| 2026-03 | **FEATURE** : Badges "Réservation directe" + "Paiement immédiat" masqués en mode MVP | frontend/app/booking/confirm.tsx, frontend/app/service/[id].tsx |
| 2026-03 | **FEATURE** : Auto-confirmation réservation + notification DEUX parties (payeur + coach) sur checkout.session.completed | backend/webhook_handlers.py |
| 2026-03 | **VÉRIFIÉ** : 30/30 tests (25 workflow + 5 webhook nouveaux) + 7/7 frontend | backend/tests/test_webhook_instant_booking_iter62.py |

| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-02 | **BUGFIX** : `confirm.tsx` masque "Validation manuelle" quand flag global=false via `effectiveApprovalMode` | frontend/app/booking/confirm.tsx |
| 2026-02 | **VÉRIFIÉ** : 25/25 tests workflow + 24/24 tests flags globaux passent | backend/tests/test_booking_workflows_v2.py |
| 2026-02 | **VÉRIFIÉ** : 9/9 scénarios frontend validés (badges, sélecteur pay_later, confirm, admin panel) | — |

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

### SpotYou Participation System + UI Refinements (2026-03-10)
- SpotYou Participation: BDD (spot_you_participants, spot_you_attendance), APIs join/leave/going, capacity limits
- Home Screen Activity Feed (/api/users/me/activity-feed), scrollable, 4 items max, positionnée sous Coachs & Services
- SpotYou detail UI redesign: 
  - Bouton "Je participe" + compteur participants (cliquable) dans une `eventActionBar` sous la date
  - Bouton "Rejoindre" + compteur membres déplacés dans la ligne rating/meta (utilise le gap entre distance et stars)
  - Section RSVP simplifiée → juste chatRow (Message + Groupe)

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

## Fix décalage d'un jour SpotYou ↔ Planning (2026-03-10)
### Cause racine
`get_next_session_date` comparait les heures de session (Paris local) avec `datetime.now(UTC)`.
Entre H (heure Paris) et H+1 (UTC), le backend pensait que la session n'était pas encore passée
alors que le frontend (qui utilise l'heure locale) la considérait comme terminée → 1 jour de décalage.

### Fix
- `spot_you_routes.py` : `get_next_session_date` utilise `ZoneInfo('Europe/Paris')` pour tout (date today + comparaison heure session)
- `tagpoint_routes.py` : `get_planning_events` ajoute `AND a.session_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date` pour n'afficher que les séances à venir

## Planning SpotYou — Basé sur présence uniquement (2026-03-10)
### Changement majeur de logique
- **Avant** : être membre d'un SpotYou → TOUS les créneaux (récurrents/unique) dans le planning
- **Maintenant** : UNIQUEMENT les séances cochées via "Je participe" apparaissent

### Fichier modifié
- `backend/routes/tagpoint_routes.py` : `get_planning_events` — remplace `JOIN tag_point_participants` par `JOIN spot_you_attendance WHERE status='going'`. Pour les récurrents : utilise `session_date` de l'attendance (date précise, pas génération exhaustive)
- `frontend/app/spot-me.tsx` : `formatNextDate` corrigé pour extraire l'heure depuis `event_schedule` (récurrents) ou `event_date` (date unique), au lieu d'afficher "00:00"

### Comportement résultant
| Action | Planning |
|--------|---------|
| Rejoindre SpotYou | Aucun effet sur planning |
| "Je participe" session X | Session X ajoutée au planning |
| "Je participe plus" session X | Session X retirée du planning |

## Modals de confirmation SpotYou (2026-03-10)
### Nouveau composant partagé
- `frontend/components/ConfirmActionModal.tsx` : bottom sheet animé (slide-up) avec icône colorée, titre, description, liste d'impacts (bullets), boutons Annuler / Confirmer

### Intégration
| Action | Titre modal | Style | Bullets |
|--------|-------------|-------|---------|
| Rejoindre | "Rejoindre ce SpotYou ?" | Primaire | Accès chat, notifs, profil visible |
| Quitter | "Quitter le SpotYou ?" | Danger | Chat bloqué, plus de notifs, rejoindre possible |
| Je participe | "Confirmer votre présence ?" | Primaire | Coach notifié, rappel avant séance |
| Annuler participation | "Annuler votre participation ?" | Danger | Reste membre, coach informé |

### Fichiers modifiés
- `frontend/app/spot-you/[id].tsx` : toggleRSVP et toggleGoing remplacés par confirmation gated
- `frontend/app/spot-me.tsx` : toggleGoing remplacé par confirmation gated
### Comportement implémenté
| Statut | Bouton Groupe | Voir chat | Envoyer | Notifs push |
|--------|---------------|-----------|---------|-------------|
| Non-membre | Caché | Non | Non | Non |
| Membre actif | Visible | Oui | Oui | Oui |
| Ancien membre (a quitté) | — | Oui (lecture seule) | Non | Non |
| Propriétaire | "Voir le groupe" | Oui | Oui | Oui |

### Fichiers modifiés
- `backend/database.py`: Migration `ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`
- `backend/routes/spot_you_routes.py`: join → auto-add conversation_participants (status='active'); leave → UPDATE status='blocked'; going → idem join
- `backend/routes/chat_routes.py`: WS check status='active'; push notif filter status='active'; _enrich_conversations ajoute is_blocked; create_or_get_conversation vérifie membership
- `frontend/app/spot-you/[id].tsx`: Bouton "Groupe" conditionné sur `isMember`
- `frontend/app/chat/[id].tsx`: Bannière de blocage si is_blocked=true
- `frontend/lib/chat.ts`: Interface Conversation + is_blocked?: boolean

## Feature Suggestions d'abonnements — COMPLÈTE (2026-03-12)

### Objectif
Onglet "Suggestions" dans la modal followers/following, visible uniquement sur son propre profil.

### Backend (user_routes.py)
| Endpoint | Description |
|----------|-------------|
| `GET /api/users/{id}/suggestions?skip=0&limit=10` | Suggestions basées sur les intérêts communs (coach_tags). Si pas d'intérêts ou aucun résultat: fallback utilisateurs populaires. Pagination 10/10. |

**Logique :**
- Si has_interests ET tags communs → utilisateurs triés par `common_count DESC`
- Si has_interests MAIS aucun résultat → fallback populaires (`is_popular_fallback=true`)
- Si no interests → utilisateurs populaires + `has_interests=false`
- Exclut: déjà suivi, bloqué, soi-même
- Fix JSONB double-encodage: `SAFE_TAGS` SQL CASE expression + double-parsing Python

### Frontend (FollowListModal.tsx)
- Refactorisé en modal unifiée avec 3 onglets internes: **Abonnés | Abonnements | Suggestions**
- Onglet Suggestions: visible uniquement si `isOwnProfile && meId`
- CTA "Ajouter mes intérêts" (`testID: no-interests-cta`) avec redirect vers `/edit-profile`
- Badge "X intérêts communs" sur chaque suggestion
- Bouton Suivre dans suggestions → retire l'utilisateur de la liste immédiatement
- Bouton "Voir 10 de plus" (`testID: load-more-suggestions`) pour la pagination

### Tests
- 11/11 tests backend PASSÉS (`tests/test_suggestions_iter77.py`)
- 7/7 vérifications frontend PASSÉES (iteration_77.json)

## Feature Followers/Following Instagram-style — COMPLÈTE (2026-03-12)

### Objectif
Modals de gestion des abonnés/abonnements sur la page profil, style Instagram.

### Backend (user_routes.py)
| Endpoint | Description |
|----------|-------------|
| `GET /api/users/{id}/followers` | Liste des abonnés, triée alphabétiquement. Retourne `is_following_back`, `is_blocked` |
| `GET /api/users/{id}/following` | Liste des abonnements. Retourne `follows_back`, `is_blocked` |
| `DELETE /api/users/{id}/followers/{follower_id}` | Retirer un abonné (propriétaire uniquement) |
| `POST /api/users/{id}/block` | Bloquer (supprime les follows dans les deux sens) |
| `DELETE /api/users/{id}/block` | Débloquer |

### Frontend
- `frontend/components/FollowListModal.tsx` : modal complète avec recherche, filtre par rôle, bouton Suivre/Abonné (tous utilisateurs connectés), menu 3 points (propriétaire: retirer abonné, bloquer), badge Mutuel
- `frontend/app/user/[id].tsx` : stats `abonnés` et `abonnements` rendues cliquables (`TouchableOpacity`, testID `followers-count-btn` / `following-count-btn`)

### DB
- `user_blocks(blocker_id, blocked_id)` — migration Alembic ajoutée

### Tests
- 14/14 tests backend PASSÉS (`tests/test_follow_feature_iter76.py`)
- 12/12 vérifications frontend PASSÉES

## Notes Techniques - Proxy Emergent Stripe
Le proxy Emergent (`sk_test_emergent` → `https://integrations.emergentagent.com/stripe`) est utilisé pour les tests. Comportement connu :
- `session.payment_intent = None` (le proxy ne retourne pas l'ID du PI)
- Les appels `capture_payment_intent` / `cancel_payment_intent` sont silencieusement skippés (null check)
- En production avec une vraie clé Stripe, `session.payment_intent` est peuplé et la capture manuelle fonctionne


## Audit des règles métier — Mars 2026

### Tests ajoutés (`backend/tests/test_business_rules_audit.py`)
23 tests couvrant les 9 règles métier non testées :

| # | Règle | Tests | Statut |
|---|-------|-------|--------|
| 1 | Interdiction de réserver son propre service | `TestCannotBookOwnService` (1 test) | PASS |
| 2 | Propriétaire ne peut pas quitter sa communauté | `TestOwnerCannotLeaveCommunity` (2 tests) | PASS |
| 3 | Quitter → annule participations futures | `TestLeaveDeletesFutureAttendance` (1 test) | PASS |
| 4 | Masquage coordonnées (100m/1000m) | `TestCoordinatePrecisionMasking` (5 tests) | PASS |
| 5 | Max 10 images (gap documenté) | `TestMaxImagesValidation` (1 test) | PASS (documente l'absence de validation backend) |
| 6 | Slots masqués si booking actif | `TestSlotsHiddenWithActiveBooking` (2 tests) | PASS |
| 7 | Images retirées supprimées du disque | `TestImageDeletionOnRemoval` (3 tests) | PASS |
| 8 | Service soft delete | `TestServiceSoftDelete` (3 tests) | PASS |
| 9 | Fuseau Europe/Paris | `TestTimezoneParis` (5 tests) | PASS |

### Gap documenté
- **Max 10 images** : La validation est uniquement côté frontend (`create.tsx` L300). Le backend accepte >10 images. Le test documente ce comportement.
