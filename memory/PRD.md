# SpotU - Product Requirements Document

## Original Problem Statement
Application mobile "SpotU" - plateforme hyperlocale, basée sur les tags.
Fonctionnalités : création/découverte de services et SpotYous, système de réservation, chat/notifications temps réel.

## Tech Stack
- **Frontend**: Expo (React Native Web) - port 3000
- **Backend**: FastAPI - port 8001 (routes préfixées `/api`)
- **DB**: MongoDB (MONGO_URL + DB_NAME depuis .env)
- **Tests E2E**: Playwright Python + pytest

## User Personas
- **User** (user@winek.app): Découvre et participe aux SpotYous
- **Coach** (coach@winek.app): Crée et gère des SpotYous/services
- **Admin** (admin@winek.app): Gestion admin dashboard

## Core Requirements
1. SpotYou & Service CRUD (création, découverte, mise à jour, suppression)
2. Découverte sur carte + recherche par tags
3. Système de réservation (bookings)
4. Chat temps réel + notifications
5. Upload sécurisé d'images (profil, service, SpotYou)
6. Tests E2E complets

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

### Phase 2 - Sécurité & Qualité (dernier sprint)
| Date | Fonctionnalité | Fichiers modifiés |
|------|---------------|-------------------|
| 2026-02 | SEC-02: Stockage sécurisé JWT (expo-secure-store) | frontend/lib/storage.ts |
| 2026-02 | SEC-12: Rate limiting API pagination (ge/le validation) | backend/routes/admin_routes.py, chat_routes.py, tagpoint_routes.py |
| 2026-02 | Bugfix: Messages chat dans notifications → corrigé | backend/routes/chat_routes.py |
| 2026-02 | Bugfix: SpotYou discovery bug (SQL param index) | backend/routes/tagpoint_routes.py |
| 2026-02 | Bugfix: HEIC image upload | backend/routes/upload_routes.py |
| 2026-03 | **P0 Fix: Upload web (blob URI → fetch → FormData)** | frontend/app/(tabs)/create.tsx |
| 2026-03 | **E2E Tests: 45 tests Playwright couvrant tous les scénarios** | frontend/e2e/ |
| 2026-03 | testIDs ajoutés: hero-card, recent-row, header-search-btn | frontend/app/(tabs)/map.tsx |
| 2026-03 | Rate limit login: 5/min → 30/min | backend/routes/auth_routes.py |

## Test Suite (E2E Playwright)
```bash
cd /app/frontend/e2e && python3 -m pytest --browser chromium --tb=short -v
```
- test_01_auth.py: 6 tests (login UI, token, register, logout)
- test_02_home.py: 5 tests (accueil, SpotYous, navigation)
- test_03_spotyou.py: 7 tests (CRUD, RSVP, vote, save)
- test_04_search.py: 4 tests (recherche, tags, cliquable)
- test_05_chat.py: 4 tests (conversation, message, chat≠notifs)
- test_06_notifications.py: 3 tests (chargement, mark-all-read)
- test_07_profile.py: 7 tests (user/coach/admin, spotme, planning)
- test_08_bookings.py: 2 tests (réservations)
- test_09_upload.py: 7 tests (JPEG, PNG, auth, invalid, >5Mo, UI)
**Total: 45/45 ✅ TOUS PASSENT**

## Code Architecture
```
/app
├── backend/
│   ├── routes/
│   │   ├── admin_routes.py       # Rate limit pagination
│   │   ├── auth_routes.py        # Rate limit 30/min login
│   │   ├── chat_routes.py        # store=False pour notifs, rate limit
│   │   ├── tagpoint_routes.py    # Fix SQL param bug, rate limit
│   │   └── upload_routes.py      # HEIC support, size validation
│   └── tests/
│       └── test_sec_limit_audit.py
└── frontend/
    ├── app/
    │   ├── (tabs)/
    │   │   ├── create.tsx         # P0 FIX: web upload via blob fetch
    │   │   └── map.tsx            # testIDs ajoutés
    ├── e2e/                       # NOUVEAU: Suite E2E Playwright
    │   ├── conftest.py            # login_fast, navigate_to_tab
    │   ├── test_01_auth.py ~ test_09_upload.py
    │   └── run_e2e.sh
    └── lib/
        └── storage.ts             # expo-secure-store (JWT)
```

## Prioritized Backlog

### P0 - Critique
- [x] Upload web (blob URI fix)
- [x] Suite E2E Playwright

### P1 - Important
- [ ] Update SpotYou flow (à valider post-upload fix)
- [ ] Fix pre-existing backend tests (test_notifications_iter47.py, test_sec_p0_audit.py)

### P2 - Souhaité
- [ ] Intégration Stripe (paiement réservations)
- [ ] Support bilingue FR/EN (i18n)
- [ ] Push Notifications EAS Build

### Futur / Backlog
- [ ] Admin Dashboard amélioré
- [ ] Optimisation performance (lazy loading)
- [ ] Tests backend étendus

## Key API Endpoints
- POST /api/upload-image
- GET /api/tag-points
- PUT /api/tag-points/{id}
- POST /api/auth/login (rate: 30/min)
- GET /api/users/me/notifications

## Credentials de test
- Admin: admin@winek.app / WinekAdmin2024!
- Coach: coach@winek.app / WinekCoach2024!
- User: user@winek.app / WinekUser2024!
