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

### Fix Stabilité Tunnel ngrok (2026-03-24)
| Fichier | Changement |
|---------|-----------|
| `node_modules/@expo/ngrok/src/process.js` | Détection processus ngrok existant (ports 4040-4044) + kill zombies avant démarrage |
| `node_modules/@expo/ngrok/src/client.js` | Fix TypeError pour `error.response` undefined |
| `node_modules/@expo/ngrok/index.js` | Gestion ECONNREFUSED + reset processPromise + reconnect auto |
| `node_modules/expo/.../AsyncNgrok.js` | Timeout tunnel 10s → 60s |

**Problème résolu** : Boucle de crash ngrok lors des redémarrages Expo (conflit sous-domaine `delivery-badges`).

### Flow Création Produit LOCATION (2026-03-26)
**Nouveaux fichiers:**
| Fichier | Rôle |
|---------|------|
| `backend/routes/product_creation_routes.py` | CRUD produit : GET mine, POST create, DELETE |
| `frontend/app/products/_layout.tsx` | Stack violet products |
| `frontend/app/products/create.tsx` | Entrée du flow (wraps context) |
| `frontend/app/products/my-products.tsx` | Liste mes produits + statuts |
| `frontend/lib/imageUpload.ts` | Helper upload R2 partagé |
| `frontend/components/product-form/ProductFormContext.tsx` | Context + validation + qualité |
| `frontend/components/product-form/ProductCreationFlow.tsx` | Stepper violet 7 étapes |
| `frontend/components/product-form/steps/Step1TypeCategory.tsx` | Type + Catégorie |
| `frontend/components/product-form/steps/Step2MainInfo.tsx` | Titre, description, prix |
| `frontend/components/product-form/steps/Step3Photos.tsx` | Upload photos |
| `frontend/components/product-form/steps/Step4RentalConditions.tsx` | Caution, remise, retour |
| `frontend/components/product-form/steps/Step5Availability.tsx` | Localisation + StepLocalisation |
| `frontend/components/product-form/steps/Step6SpotYouLink.tsx` | Liaison SpotYou |
| `frontend/components/product-form/steps/Step7Summary.tsx` | Récap + aperçu ProductDetailView |

**Modifié:** `database.py` (migration +17 colonnes), `upload_routes.py` (catégorie products), `server.py` (route produits), `profile.tsx` (section Mes produits), `_layout.tsx` (stack products)

**Architecture:** `ProductFormContext` → `ProductCreationFlow` → 7 steps | Status: `draft → pending_review → active`


| Composant | Changement |
|-----------|-----------|
| `frontend/app/marketplace/_layout.tsx` | **NOUVEAU** — Stack layout pour les écrans boutique |
| `frontend/app/marketplace/[spotYouId].tsx` | **NOUVEAU** — Écran grille produits (remplace MarketplaceModal) avec flèche retour |
| `frontend/app/marketplace/product-detail.tsx` | **NOUVEAU** — Écran détail produit avec flèche retour |
| `frontend/lib/marketplaceStore.ts` | **NOUVEAU** — Store module-level léger pour passer les données entre écrans |
| `frontend/app/spot-you/[id].tsx` | **MODIFIÉ** — Boutique navigue vers `/marketplace/[spotYouId]` (router.push) au lieu d'ouvrir un modal |
| `frontend/app/_layout.tsx` | **MODIFIÉ** — Enregistrement du stack `marketplace` |
| `frontend/components/MarketplaceModal.tsx` | **SUPPRIMÉ** — Code mort après migration |

**Comportement:**
- Clic "Boutique" dans un SpotYou → navigation vers `/marketplace/[spotYouId]` (slide depuis la droite)
- Clic sur un produit → navigation vers `/marketplace/product-detail` (slide depuis la droite)
- Panier flottant → navigation vers `/cart` (écran existant)
- Flèche retour disponible sur chaque écran (Boutique, Détail, Panier)


| Composant | Changement |
|-----------|-----------|
| `frontend/components/ProductDetailView.tsx` | **NOUVEAU** — Vue détail produit complète (image, identité, infos, description dépliable, bloc propriétaire toggle, autres contenus, footer CTA sticky) |
| `frontend/components/MarketplaceModal.tsx` | **MODIFIÉ** — Ajout animation slide-from-right (Animated.spring/timing), openDetail/closeDetail, cartes cliquables (TouchableOpacity), overlay animé zIndex 20, keyExtractor fix |
| `backend/routes/marketplace_routes.py` | **MODIFIÉ** — Enrichissement seller_stats: rating_avg, rating_count, products_count, services_count, spotyou_count par vendeur/coach (4 requêtes SQL parallèles) |

**Comportement:**
- Clic sur une carte produit → slide depuis la droite vers la vue détail (Animated.spring tension=65/friction=11)
- Bouton retour → slide vers la droite + retour grille (Animated.timing 260ms)
- Carte propriétaire → toggle bloc show/hide avec stats (produits, services, SpotYou)
- Section "Autres propositions" calculée client-side depuis la liste déjà chargée
- Footer sticky avec CTA adaptatif ("Voir l'offre" ou "Voir les conditions" pour locations)
- Gestion états: loading, error, produit indisponible (outOfStock)

### Autres fonctionnalites completees
- [x] Suite E2E comprehensive (85 backend + 183 frontend = 268 tests)
- [x] Fix pull-to-refresh (booking detail + SpotYou detail)
- [x] Fix flash ecran blanc au chargement
- [x] Placeholder images dynamiques pour services sans photos
- [x] Score de completion service mis a jour
- [x] Fix liste tags vide lors creation SpotYou
- [x] StepLocalisation composant partage pour selection adresse
- [x] Masquage adresse backend (precision non-exact)
- [x] Fix masquage "France" trop vague pour 1000m → retourne maintenant la ville/quartier
- [x] Masquage uniforme owner/non-owner avec toggle propriétaire pour adresse exacte

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
- [x] Fix masquage adresse "France" (1000m) + masquage uniforme owner/non-owner
- [x] Marketplace SpotYou (modal + backend route + seed data + filtrage par tags)
- [x] Distances duelles produits physiques (SpotYou→Produit ET Utilisateur→Produit via Haversine)
- [x] **Vue Détail Produit** dans MarketplaceModal (ProductDetailView + animation slide + seller_stats backend)

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
│   ├── admin_product_reminder_worker.py  # NEW - Worker rappel 2h produits
│   ├── routes/
│   │   ├── tagpoint_routes.py
│   │   ├── booking_routes.py
│   │   ├── service_routes.py
│   │   ├── admin_routes.py
│   │   ├── product_creation_routes.py    # Création produit (auto-publish admin)
│   │   └── admin_product_routes.py       # Modération admin (approve/reject)
│   └── tests/
└── frontend/
    ├── components/
    │   ├── product-form/               # Flux création 7 étapes
    │   │   ├── steps/Step1...Step7.tsx
    │   │   ├── ProductCreationFlow.tsx
    │   │   └── ProductFormContext.tsx
    └── app/
        ├── admin/index.tsx             # Dashboard admin (onglet Produits ajouté)
        ├── products/                   # Écrans produits
        │   ├── create.tsx
        │   ├── my-products.tsx
        │   └── _layout.tsx
        ├── service/[id].tsx
        ├── spot-you/[id].tsx
        └── create-service.tsx
```

## Recently Completed (Mar 2026)
- Admin Product Moderation Dashboard (onglet « Produits » en bleu #3B82F6)
- Push notifications admin (nouveau produit pending)
- Push notifications créateur (validation / refus avec deep link edit mode)
- Admin auto-publish (status pending_review → active)
- Worker de rappel 2h (AdminProductReminderWorker)

## Known Issues
- ngrok tunnel instability (infrastructure, not code)
