# SpotU - Product Requirements Document

## Original Problem Statement
Application mobile "SpotU" - plateforme hyperlocale, basee sur les tags.
Fonctionnalites : creation/decouverte de services et SpotYous, systeme de reservation, chat/notifications temps reel, moteur de monetisation generique + paiements Stripe.

## Tech Stack
- **Frontend**: Expo (React Native Web) - port 3000
- **Backend**: FastAPI - port 8001 (routes prefixees `/api`)
- **DB**: PostgreSQL (DATABASE_URL depuis .env)
- **Paiements**: Stripe via SDK natif + proxy Emergent (sk_test_emergent)
- **Images**: Cloudflare R2 (compression Pillow + CDN)
- **Tests E2E**: Playwright Python + pytest

## User Personas
- **User** (user@winek.app / WinekUser2024!): Decouvre, reserve et paie les SpotYous/services
- **Coach** (coach@winek.app / WinekCoach2024!): Cree et gere des SpotYous/services, recoit les paiements
- **Admin** (admin@winek.app / WinekAdmin2024!): Gestion admin dashboard, configure les tarifs

## Core Requirements
1. SpotYou & Service CRUD (creation, decouverte, mise a jour, suppression)
2. Decouverte sur carte + recherche par tags
3. Systeme de reservation (bookings) - atomique, idempotent, row-level locking
4. Chat temps reel + notifications
5. Upload securise d'images (profil, service, SpotYou) via Cloudflare R2
6. Tests E2E complets
7. Moteur de monetisation generique (pricing_engine.py)
8. Paiements Stripe PaymentIntent (capture_method=manual) + webhooks

## What's Been Implemented

### Completed Features (All phases 1-18)
- Auth JWT, SpotYou/Service CRUD, Carte interactive, Chat/Notifications WS
- Stripe PaymentIntent + manual capture, Booking workflows (4 flux)
- Admin Dashboard (monetisation, tags, domaines, analytics)
- Cloudflare R2 image storage + compression (Pillow)
- Lazy upload pattern (profile + services)
- Participation system, WebSocket temps reel
- Protection reseau, cache, offline guards
- Navigation anti-double-tap, onboarding multi-etapes
- Followers/Following, Suggestions d'abonnements
- Profile refactoring, Cover photo repositioning
- Tags pre-fill en mode edition service (fix domainId par defaut)

### Phase 19 - Commission Dynamique (2026-03-16)
| Date | Composant | Changement |
|------|-----------|-----------|
| 2026-03-16 | `backend/server.py` | Nouvel endpoint public `GET /api/config/commission` - lit pricing_rules active pour service_booking |
| 2026-03-16 | `frontend/app/create-service.tsx` | Hook `useCommission()` avec cache - remplace commission 15% en dur |
| 2026-03-16 | `frontend/app/service/[id].tsx` | Commission dynamique via `/config/commission` - masquee si aucune regle |

**Tests**: 9/9 backend PASS (test_commission_iter86.py), code review confirme 0 reference hardcoded restante

## Key API Endpoints
- `GET /api/config/commission` - (PUBLIC) Retourne le taux de commission actif depuis pricing_rules
- `POST /api/upload-image?category={cat}` - Upload image to R2 with compression
- `GET/POST/PUT/DELETE /api/services/{id}` - Service CRUD
- `GET/PUT /api/users/profile` - Profile management
- `POST /api/auth/login` - Authentication
- `GET/POST/PUT/DELETE /api/admin/pricing-rules` - Admin gestion tarifs

## Prioritized Backlog

### P0 - Critique (TOUS COMPLETES)
- [x] Upload web (blob URI fix)
- [x] Suite E2E Playwright
- [x] Integration Stripe PaymentIntent + manual capture
- [x] Cloudflare R2 image storage
- [x] Lazy upload pattern (profile + services)
- [x] Tags pre-fill en mode edition service
- [x] Commission dynamique (remplacer 15% en dur par pricing_rules admin)

### P1 - Important
- [ ] Flow abonnement utilisateur (souscrire/gerer un plan Stripe Subscription)
- [ ] Sauvegardes automatiques DB
- [ ] Pipeline CI automatise

### P2 - Souhaite
- [ ] Support bilingue FR/EN (i18n)
- [ ] File d'attente mutations offline
- [ ] Push Notifications (EAS Build)
- [ ] Refactorisation `create-service.tsx` en composants plus petits

### P3 - Production
- [ ] Configurer STRIPE_WEBHOOK_SECRET avec la vraie cle webhook Stripe
- [ ] Tester avec une vraie cle Stripe pour valider capture_method=manual

## Code Architecture
```
/app
├── backend/
│   ├── server.py                  # GET /api/config/commission endpoint
│   ├── pricing_engine.py          # Moteur de calcul tarifs generique
│   ├── routes/
│   │   ├── upload_routes.py       # POST /api/upload-image (R2 + compression)
│   │   ├── service_routes.py      # CRUD services + R2 deletion
│   │   ├── admin_routes.py        # Admin pricing-rules CRUD
│   │   ├── user_routes.py         # Profile + followers/suggestions
│   │   └── tagpoint_routes.py     # SpotYou CRUD + R2 deletion
│   └── tests/
│       ├── test_commission_iter86.py  # 9 tests commission dynamique
│       └── test_service_crud_iter85.py
└── frontend/
    └── app/
        ├── create-service.tsx     # useCommission hook + lazy upload + tags fix
        ├── service/[id].tsx       # Commission dynamique dans detail service
        ├── edit-profile.tsx       # Lazy upload reference
        └── edit-service/[id].tsx  # Redirect to create-service in edit mode
```

## Known Issues
- ngrok tunnel instability (infrastructure, not code)
- edit-service/[id].tsx redirect can race with root layout mount (MEDIUM, pre-existing)
- svc_demo001 seed data has cross-domain tags (data integrity, not code bug)
