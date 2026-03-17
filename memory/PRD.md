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

### Composant partage MapPreview (2026-03-17)
| Composant | Changement |
|-----------|-----------|
| `frontend/components/MapPreview.tsx` | **NOUVEAU** - Composant partage pour affichage carte avec precision |
| `frontend/app/service/[id].tsx` | Utilise MapPreview au lieu de MapViewComponent directement |
| `frontend/app/spot-you/[id].tsx` | Utilise MapPreview au lieu de MapViewComponent directement |
| `frontend/components/StepLocalisation.tsx` | Utilise MapPreview au lieu de MapViewComponent directement |

**Comportement:**
- Precision "exact": affiche un marqueur pin
- Precision "100m": affiche un cercle rouge de 100m (zoom 15)
- Precision "1000m": affiche un cercle rouge de 1km (zoom 13)
- Supporte des pins additionnels (pour services multi-lieux)

### Commission Dynamique (2026-03-16)
| Composant | Changement |
|-----------|-----------|
| `backend/server.py` | `GET /api/config/commission` - taux depuis pricing_rules |
| `backend/routes/booking_routes.py` | `POST /api/bookings/price-preview` - apercu pricing complet avant reservation |
| `frontend/app/create-service.tsx` | Hook useCommission avec receiverPct (commission coach 10%) |
| `frontend/app/service/[id].tsx` | Commission dynamique receiverPct dans detail service |
| `frontend/app/booking/confirm.tsx` | Ventilation prix : base + frais service + total a payer |
| `backend/tests/test_commission_e2e.py` | 6 tests E2E : taux, calculs, coherence preview vs config |

### Autres fonctionnalites completees
- [x] Suite E2E comprehensive (85 backend + 183 frontend = 268 tests)
- [x] Fix pull-to-refresh (booking detail + SpotYou detail)
- [x] Fix flash ecran blanc au chargement
- [x] Placeholder images dynamiques pour services sans photos
- [x] Score de completion service mis a jour
- [x] Fix liste tags vide lors creation SpotYou
- [x] StepLocalisation composant partage pour selection adresse
- [x] Masquage adresse backend (precision non-exact)

## Key API Endpoints
- `GET /api/config/commission` - (PUBLIC) Taux commission actif
- `POST /api/bookings/price-preview` - (AUTH) Apercu pricing
- `GET/PUT /api/services/{id}` - Service CRUD (locations.precision: exact|100m|1000m)
- `GET /api/tag-points/{id}` - Tag point detail (masquage adresse si precision non-exact)

## Prioritized Backlog

### P0 - COMPLETE
- [x] Composant partage MapPreview (cercle precision fonctionnel)
- [x] Commission dynamique
- [x] Tests E2E

### P1 - Important
- [ ] Sauvegardes automatiques DB
- [ ] Pipeline CI automatise
- [ ] Valeurs hardcodees backend configurables (DEFAULT_RADIUS, MSG_MIN_INTERVAL, etc.)

### P2 - Souhaite
- [ ] Support bilingue FR/EN (i18n)
- [ ] File d'attente mutations offline
- [ ] Amelioration notifications systeme
- [ ] Push Notifications production (EAS Build)
- [ ] Refactorisation `create-service.tsx` en composants plus petits

### P3 - Production
- [ ] Configurer STRIPE_WEBHOOK_SECRET
- [ ] Tester Stripe en production

## Code Architecture
```
/app
├── backend/
│   ├── server.py
│   ├── pricing_engine.py
│   ├── routes/
│   │   ├── tagpoint_routes.py    # Masquage adresse + precision
│   │   ├── booking_routes.py
│   │   ├── service_routes.py
│   │   └── admin_routes.py
│   └── tests/
└── frontend/
    ├── components/
    │   ├── MapPreview.tsx         # NOUVEAU - Composant partage carte
    │   ├── MapViewComponent.tsx   # Composant carte bas niveau (Leaflet)
    │   ├── StepLocalisation.tsx   # Selection adresse + precision
    │   └── ServicePlaceholder.tsx # Placeholder images services
    └── app/
        ├── service/[id].tsx      # Detail service (utilise MapPreview)
        ├── spot-you/[id].tsx     # Detail SpotYou (utilise MapPreview)
        └── create-service.tsx    # Creation service
```

## Known Issues
- ngrok tunnel instability (infrastructure, not code)
