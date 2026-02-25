# WINEK - Product Requirements Document

## Problem Statement
Build WINEK, a hyperlocal tag-based connection platform focused on sports and coaching.
Users can post and find geo-located activities ("tagPoints") near them.
Coaches can offer paid sessions with integrated Stripe payments.
The app is bilingual (French / English) with configurable language per user.

## Tech Stack
- **Backend**: FastAPI + Python + PostgreSQL + PostGIS (geospatial queries)
- **Frontend**: React Native + Expo + TypeScript + Expo Router
- **Database**: PostgreSQL 15 with PostGIS 3.3
- **Auth**: JWT (email/password) + Google OAuth (Emergent-managed)
- **Payments**: Stripe (via emergentintegrations)
- **Maps**: Leaflet (via react-native-webview on native, iframe on web)

## User Personas
1. **Standard User**: Can create and search tagPoints, book coach services
2. **Coach**: Can create services, receive bookings, get paid
3. **Admin**: Can manage users, domains, content

## Core Features Implemented (MVP)

### Authentication
- Email/password register + login
- Google OAuth login
- JWT token management
- Bilingual signup (FR/EN selection)
- **FIX (2026-02-25)**: Race condition résolue — navigation post-login via `useEffect` sur `user` dans `login.tsx`, `register.tsx`, `callback.tsx`
- **FIX (2026-02-25)**: Guards `loading` dans `profile.tsx` + `bookings.tsx` avec fallback `refreshUser`

### TagPoints (Core Feature)
- Create geo-located posts with tags, domain, precision (exact/100m/1km)
- PostGIS geo-search with configurable radius (ST_DWithin)
- Tag-based filtering + domain filtering
- Privacy: precision masking for non-owners
- Expiry system (24h, 3 days, 1 week, never)

### Coach Services
- Coach profile creation
- Service listings with geo-location
- Booking system with 15% platform commission
- Stripe Checkout integration

### Map & Search
- Leaflet map with TagPoint pins (color-coded by domain)
- Web: iframe fallback | Native: WebView
- Radius search (1km, 5km, 10km, 25km, 50km)
- Domain filters (Sport, Coaching, Services, Social)

### Profiles
- Edit profile (name, bio)
- Become Coach flow
- Language switcher (FR/EN)
- My TagPoints, My Services display

## Database Schema (PostgreSQL + PostGIS)
- **users**: user_id, email, password_hash, name, role, language, is_coach_verified, coach_tags, hourly_rate
- **domains**: domain_id, name, label_fr, label_en, icon, color
- **tag_categories**: category_id, domain_id, name, label_fr, label_en, icon
- **tags**: tag_id, category_id, domain_id, name, label_fr, label_en
- **tag_points**: point_id, user_id, title, description, location GEOMETRY(Point,4326), precision, tag_ids JSONB, domain_id, active, expires_at
- **services**: service_id, coach_id, title, description, price, duration_min, location GEOMETRY(Point,4326), tag_ids JSONB
- **bookings**: booking_id, service_id, user_id, coach_id, status, amount, commission, payment_status
- **reviews**: review_id, booking_id, reviewer_id, reviewee_id, rating, comment
- **payment_transactions**: transaction_id, booking_id, session_id, amount, status

## Seed Data
- Admin: admin@winek.app / WinekAdmin2024!
- Coach: coach@winek.app / WinekCoach2024! (Sophie Martin, fitness/running)
- User: user@winek.app / WinekUser2024! (Thomas Dupont)
- 4 demo TagPoints near Paris
- 1 demo Service (coaching)
- 4 domains, 13 categories, 28 tags

## API Endpoints
- POST /api/auth/register, /api/auth/login, /api/auth/google, GET /api/auth/me
- GET/PUT /api/users/profile, POST /api/users/become-coach
- GET /api/domains, /api/tags, /api/tags/categories
- GET/POST/PUT/DELETE /api/tag-points
- GET/POST/PUT/DELETE /api/services
- GET/POST/PUT /api/bookings
- POST /api/payments/checkout, GET /api/payments/status/{session_id}
- GET /api/admin/stats, /api/admin/users

## P0/P1/P2 Backlog

### P0 (Critical - Done)
- [x] PostgreSQL + PostGIS backend migration
- [x] Auth (email/password + Google)
- [x] TagPoints geo-CRUD
- [x] Map with pins
- [x] Search with radius + domain filter
- [x] Create TagPoint form
- [x] Profile screen
- [x] Bilingual FR/EN support
- [x] Homepage redesign (carousel + sections) (2026-02-24)
- [x] Distance calculation + display (2026-02-24)
- [x] **BUG FIX: Distances se mettent à jour quand localisation change** (2026-02-25)
  - Implémenté LocationContext réactif (context/LocationContext.tsx)
  - Pipe Haversine côté client (utils/distance.ts) — calcul pur sans appel API
  - set-location.tsx utilise setLocation() du contexte pour mise à jour instantanée
  - map.tsx et search.tsx calculent les distances depuis les coords GPS des tagpoints
- [x] **BUG FIX: Écrans de tabs affichent "Veuillez vous connecter" après login** (2026-02-25)
  - AuthContext.tsx: OAuth early-return garde loading=true jusqu'à processGoogleCallback
  - processGoogleCallback gère setLoading(true/false), refreshUser wrappé useCallback
  - profile.tsx + bookings.tsx: guard loading (ActivityIndicator) + fallback refreshUser
  - tagpoint_routes.py: fix 500 sur création (alias tp manquant dans SELECT post-insert)
- [x] **BUG FIX CRITIQUE: App bloquée sur écran login après connexion** (2026-02-25)
  - NavigationGuard centralisé dans _layout.tsx (source unique de vérité)
  - useRootNavigationState pour attendre que le stack navigation soit prêt (expo-router v6)
  - Suppression de toute logique de navigation dans login.tsx, register.tsx, index.tsx
  - callback.tsx simplifié — le Guard gère le redirect succès OAuth
  - 7/7 scénarios de navigation validés par l'agent de test

- [x] **FEATURE + BUG FIX: Écran set-location amélioré** (2026-02-25)
  - Nouvelle fonctionnalité: champ de recherche d'adresse avec Nominatim (OpenStreetMap) — debounce 500ms, dropdown résultats
  - Correction bug: tap sur la carte déclenche maintenant le reverse geocoding Nominatim pour mettre à jour l'adresse affichée
  - Formatage intelligent des adresses (rue, code postal, ville) pour éviter les noms trop verbeux
  - Ajout data-testid sur tous les éléments interactifs
  - 7/7 tests frontend passés

### P1 (High Priority - Remaining)
- [x] TagPoint detail screen (/tag-point/[id]) - UI redesign + header bug fix (2026-02-24)
- [ ] Coach service creation screen (/create-service)
- [ ] Complete Stripe payment flow testing
- [ ] Coach profile detail screen (/coach/[id])
- [ ] Booking detail + pay screen (/booking/[id])
- [ ] Write/read reviews for coaches
- [ ] Push notifications (booking confirmations)
- [ ] Admin dashboard UI

### P2 (Future)
- [ ] Real-time updates (WebSocket)
- [ ] Chat between users
- [ ] Group activities
- [ ] Recurring events
- [ ] Mobile app (iOS/Android) native builds
- [ ] Advanced analytics

## Frontend URL
https://geo-coach-hub.preview.emergentagent.com

## Architecture Notes
- Backend binding: 0.0.0.0:8001, all routes prefixed /api
- Frontend: Expo Web at port 3000
- Maps: Leaflet (CDN) via WebView (native) or iframe (web)
- JSONB handling: asyncpg global codec (json.dumps/loads) for JSONB columns
- geospatial precision levels: exact, 100m (rounded to 3 decimals), 1000m (rounded to 2 decimals)
