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

## What's Been Implemented

### Commission Dynamique (2026-03-16)
| Composant | Changement |
|-----------|-----------|
| `backend/server.py` | `GET /api/config/commission` - taux depuis pricing_rules |
| `backend/routes/booking_routes.py` | `POST /api/bookings/price-preview` - apercu pricing complet avant reservation |
| `frontend/app/create-service.tsx` | Hook useCommission avec receiverPct (commission coach 10%) |
| `frontend/app/service/[id].tsx` | Commission dynamique receiverPct dans detail service |
| `frontend/app/booking/confirm.tsx` | Ventilation prix : base + frais service + total a payer |
| `backend/tests/test_commission_e2e.py` | 6 tests E2E : taux, calculs, coherence preview vs config |

**Calcul pour un service a 60€ (regle: 5% payeur, 10% coach):**
- Payeur voit : 60€ + 3€ frais = **63€ total**
- Coach voit : Commission 10% · Net **54€**
- Plateforme : 9€ total

## Key API Endpoints
- `GET /api/config/commission` - (PUBLIC) Taux commission actif
- `POST /api/bookings/price-preview` - (AUTH) Apercu pricing complet avant reservation
- `POST /api/bookings/request` - Creer une reservation (pricing_engine interne)
- `GET/POST/PUT/DELETE /api/services/{id}` - Service CRUD
- `GET/PUT /api/users/profile` - Profile
- `GET/POST/PUT/DELETE /api/admin/pricing-rules` - Admin gestion tarifs

## Prioritized Backlog

### P0 - Critique (TOUS COMPLETES)
- [x] Commission dynamique depuis pricing_rules admin
- [x] Double verification back/front (price-preview endpoint)
- [x] Tests E2E commission (6/6 pass)
- [x] Affichage commission payeur sur ecran reservation
- [x] Correction calcul (receiverPct vs total_percent_fee)
- [x] Suite E2E comprehensive (85 backend + 183 frontend = 268 tests, 100% pass)

### P1 - Important
- [ ] Flow abonnement utilisateur (Stripe Subscription)
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
│   ├── server.py                  # GET /api/config/commission
│   ├── pricing_engine.py          # Moteur calcul tarifs generique
│   ├── routes/
│   │   ├── booking_routes.py      # POST /api/bookings/price-preview + request
│   │   ├── service_routes.py      # CRUD services
│   │   └── admin_routes.py        # Admin pricing-rules CRUD
│   └── tests/
│       ├── test_commission_e2e.py # 6 tests E2E commission
│       └── e2e/
│           ├── conftest.py           # Fixtures pytest
│           ├── e2e_helpers.py        # Helpers auth/token
│           ├── test_api_endpoints.py # 76 tests API (auth, users, config, tags, spotyou, services, bookings, chat, notifs, upload, payments, subscriptions, admin, addresses, follow, push, performance)
│           └── test_websockets.py    # 9 tests WebSocket (chat, notifications, spotyou)
└── frontend/
    └── app/
        ├── create-service.tsx     # useCommission(receiverPct) + lazy upload
        ├── service/[id].tsx       # Commission dynamique detail service
        └── booking/confirm.tsx    # Ventilation prix + total avant paiement
```

## Known Issues
- ngrok tunnel instability (infrastructure, not code)
