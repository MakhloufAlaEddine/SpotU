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

### Unification Sélecteur de Tags — TagPickerField Partagé (2026-03-27)
| Composant | Changement |
|-----------|-----------|
| `TagPickerField.tsx` | Mis à jour : entityType optionnel ('' = tous), onTagsLoaded callback, déduplication catégories et tags par id |
| `create-service.tsx` | Step 2 Domaine & Tags → `<TagPickerField entityType="service" showDomains />`, suppression modal inline + loadDomains/loadCategories/toggleTag |
| `create.tsx` (SpotYou) | StepContenu → `<TagPickerField entityType="spotyou" showDomains />`, suppression modal inline + fonctions redondantes |
| `search.tsx` | TagModal local supprimé, remplacement par `<TagPickerField entityType="" showDomains={false} />` dans vue liste ET carte |

### Refactoring Stepper Produit — UX + Validation Complète (2026-03-27)
| Composant | Changement |
|-----------|-----------|
| `ProductFormContext.tsx` | validateStep corrigé : tags obligatoires step1, pricing_modes step4, session→SpotYou step6, step7 final complet |
| `create.tsx` | apiToFormData : pre-fill 100% champs edit mode (tag_ids, pricing_modes, price_per_hour/day/week/month) |
| `Step6SpotYouLink.tsx` | Logique métier corrigée : texte visibilité par tags, warning séance seule, badge obligatoire si session |
| `ProductCreationFlow.tsx` | UX épurée : erreurs fixes (hors ScrollView), bouton unique Suivant, header compact |
| `product_creation_routes.py` | Validation backend : tags obligatoires, session sans SpotYou bloqué |
| `test_product_stepper_iter95.py` | 21 tests nouveaux |
| `test_product_validation_iter93.py` | Mis à jour catégories DB IDs, session pricing, max_duration_days |

### Tags produit + Tarification multi-unité (2026-03-27)
- `Step1TypeCategory.tsx` : sélection tags par catégorie (max 5), block repair idempotent DB
- `Step2MainInfo.tsx` : UI multi-tarifs (heure/jour/semaine/mois/séance)
- DB migrations : pricing_modes, price_per_hour/day/week/month, admin_validated_*, short_description...

### Corrections backend startup (2026-03-27)
- `database.py` : user_follows et cover photos après seed_initial_data
- `seed.py` : tags dupliqués et liaisons FK corrects
- Toutes migrations marketplace_products ajoutées


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

### Refonte Taxonomie — Domaines/Catégories/Tags (2026-03-26)
| Composant | Changement |
|-----------|-----------|
| `backend/database.py` | Ajout colonne `entity_type` sur `tag_categories`, tables `tag_category_links` et `tag_entity_type_links` |
| `backend/seed.py` | Reset complet + nouvelle architecture : 4 domaines, 58 catégories (entity_type), 60 tags, liaisons M:M |
| `backend/routes/domain_routes.py` | Filtrage `entity_type` sur /tags/categories et /tags, désactivation cascade Domaine→Catégories |
| `backend/models.py` | `TagCategoryCreate` avec champ `entity_type` |
| `frontend/app/admin/index.tsx` | Badges entity_type + filtres Tout/SpotYou/Service/Produit dans CategoriesPanel et TagsPanel |
| `frontend/app/admin/index.tsx` | CategoryForm avec sélecteur entity_type obligatoire |
| `frontend/components/product-form/steps/Step1TypeCategory.tsx` | Catégories dynamiques via API `entity_type=product` |
| `frontend/app/(tabs)/create.tsx` | Filtre `entity_type=spotyou` sur categories fetch |
| `frontend/app/create-service.tsx` | Filtre `entity_type=service` sur categories fetch |

**Architecture:**
- Domaines → communs (sport, coaching, services_locaux, social)
- Catégories → avec entity_type (spotyou=21, service=21, product=16)
- Tags → 60 tags partagés, liés via `tag_category_links` (M:M) et `tag_entity_type_links`
- Règle: désactivation domaine → cascade catégories (écrans création uniquement)


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
### Redesign Stepper 9 étapes légères (2026-03-27)
| Étape | Composant | Contenu |
|-------|-----------|---------|
| 1 | Step1TypeCategory | Type + Catégorie + Tags (info visibilité si tag sélectionné) |
| 2 | Step2Essential (NEW) | Titre* + État* + Quantité* + Marque (opt) |
| 3 | Step3Details (NEW) | Résumé + Description + Inclus (tous opt) |
| 4 | Step3Photos | Photos (min 1*) |
| 5 | Step5Pricing (NEW) | Pills tarification + inputs conditionnels + SpotYou (si séance) |
| 6 | Step6Logistics (NEW) | Mode remise* + Durée max (cond) + Caution (cond) |
| 7 | Step7Rules (NEW) | Consignes + Retour + Annulation (tous opt) |
| 8 | Step5Availability | Localisation* |
| 9 | Step7Summary | Score qualité + Récap + Brouillon/Publier |

**Résultats tests (iteration_97): 10/10 passés**
- Tous les steps naviguent correctement
- Validations bloquantes toutes fonctionnelles
- Fix bug catégorie '—' : `category_label` ajouté au form state


| Composant | Changement |
|-----------|-----------|
| `Step2MainInfo.tsx` | Fusion Step 2 + Step 6 : section SpotYou intégrée dans l'étape tarification (conditionnelle si mode séance) |
| `ProductCreationFlow.tsx` | TOTAL_STEPS 7 → 6, suppression Step6SpotYouLink, mise à jour STEP_CONFIG et STEP_COMPONENTS |
| `ProductFormContext.tsx` | validateStep case 2 : validation SpotYou si mode séance (bloque Suivant), case 6 = no-op |
| `Step6SpotYouLink.tsx` | Conservé mais inutilisé (code mort — peut être supprimé) |

**Logique métier corrigée :**
- "Lier à un SpotYou permet aux membres de cette communauté de **louer** votre produit dans les créneaux proposés par le SpotYou"
- "Ton produit apparaît automatiquement dans la **boutique des SpotYou dont les tags correspondent aux tiens** et dans la boutique globale"
- Suppression de la phrase fausse sur la visibilité directe par rattachement
- "En mode séance : au moment de la réservation, l'utilisateur choisira un créneau parmi ceux du SpotYou **rattaché au produit**"
- Conseil ajouté : activer aussi une tarification par heure/jour pour ne pas bloquer la location si pas de créneau dispo

- Admin Product Moderation Dashboard (onglet « Produits » en bleu #3B82F6)
- Push notifications admin (nouveau produit pending)
- Push notifications créateur (validation / refus avec deep link edit mode)
- Admin auto-publish (status pending_review → active)
- Worker de rappel 2h (AdminProductReminderWorker)
- Mode édition produits refusés (pré-remplissage complet catégorie, durée max, etc.)
- Validation stricte champs obligatoires avant soumission (front + back)
- **[2026-03-26] Remplacement complet couleur VIOLET (#8B5CF6) → BLEU (#3B82F6)** dans tous les composants product-form (Step1…Step7, ProductCreationFlow, ProductFormContext)

## Recently Completed (2026-03-30)

### Fix Scroll Clavier Description Step 2 + Nettoyage (2026-03-30)
| Fichier | Changement |
|---------|-----------|
| `Step2Essential.tsx` | Import `useRef` + `useFlowScroll` ; `descRef` sur le wrapper View Description ; `onFocus={scrollToDesc}` → scroll localisé identique à StepDetailsRules ; suppression imports inutiles `findNodeHandle, UIManager` |
| `Step3Details.tsx` | **SUPPRIMÉ** (code mort après fusion) |
| `Step7Rules.tsx` | **SUPPRIMÉ** (code mort après fusion) |

**Comportement corrigé :**
- Champ Titre → aucun scroll automatique (comportement neutre souhaité)
- Champ Description → scroll doux vers le champ (-120px) dès le focus, clavier ne cache plus le textarea
- Même pattern que StepDetailsRules.tsx (pickupRef/returnRef/cancelRef)

### Changements précédents (2026-03-29)
- Description déplacée en Step 2 avec minimum 30 caractères (frontend + backend)
- Marque/Modèle supprimé (UI + backend + ALTER TABLE DROP COLUMN)
- Types Vente/Digital désactivés dans Step1TypeCategory + seed.py
- Steps Details + Rules fusionnés en StepDetailsRules (8 étapes total)
- Bouton "Retour/Précédent" ajouté dans la barre de navigation bas
- FlowScrollContext créé + appliqué sur Step5Availability et StepDetailsRules
- Correction status `active` dans ProductDetailView (n'affichait plus "Brouillon" à tort)

## Known Issues
- ngrok tunnel instability (infrastructure, not code)
