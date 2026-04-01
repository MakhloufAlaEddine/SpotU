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

### Cleanup Post-Migration Supabase — Code Mort et Tests Obsolètes (2026-04-01)

**Fichiers supprimés (psycopg2 + DSN hardcodé localhost/winek_db) :**
- `test_booking_workflows_v2.py` — psycopg2 + `winek_db/winek2024/localhost`
- `test_booking_expiry.py` — psycopg2 + `winek_db/winek2024/localhost`
- `test_webhook_instant_booking_iter62.py` — psycopg2 + `winek_db/winek2024/localhost`
- `test_business_rules_audit.py` — psycopg2 + `winek_db/winek2024/localhost`
- `test_tagpoint_address_privacy_iter87.py` — psycopg2 + 5 connexions `127.0.0.1/winek_db`
- `test_address_privacy_full.py` — `DB_URL` hardcodé sans `os.environ.get`

**Classe supprimée :**
- `TestPERF01_StaticAnalysis` dans `test_perf01_indexes.py` — cherchait `CREATE INDEX IF NOT EXISTS` dans `database.py` (zero-DDL depuis Supabase migration)

**Fallbacks hardcodés nettoyés (7 fichiers) :**
- `test_notifications_iter53.py` — `DB_URL` + `BASE_URL` hardcodés → `os.environ.get`
- `test_webhooks_iter52.py` — fallback DSN + URL preview → `os.environ.get`
- `test_pricing.py` — `BASE = localhost:8001` + DSN fallback → `os.environ.get`
- `test_pricing_engine.py` — même correction
- `test_subscriptions_iter51.py` — `API_BASE` + DSN fallback → `os.environ.get`
- `test_booking_workflow.py` — `BASE_URL` + DSN fallback → `os.environ.get`
- `test_perf01_indexes.py` — DSN fallback → `os.environ.get`

**Suite test_no_ddl_at_boot.py : 9/9 PASSED ✅**

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

### Réorganisation Steps + SpotYou 20km + Distance (2026-03-30)
| Fichier | Changement |
|---------|-----------|
| `ProductCreationFlow.tsx` | Step 6 (Localisation) déplacé avant Step 4 (Tarification) → nouvel ordre: Classification > Essentiel > Photos > **Localisation** > Tarification > Logistique > Détails/Règles > Publication |
| `ProductFormContext.tsx` | validateStep mis à jour : case 4=Localisation, case 5=Tarification, case 6=Logistique ; messages finaux Étape 5/6 corrigés |
| `Step5Pricing.tsx` | Double fetch : `/tag-points/mine` (propriétaire, filtre Haversine 20km) + `/tag-points?lat&lng&radius=20000&tag_ids` (autres créateurs) ; badge "Mon SpotYou" vert ; badge distance bleu ; tri : propriétaire en premier puis autres par distance ; message vide adaptatif (sans localisation / aucun résultat) |

**Comportement :**
- Localisation saisie avant tarification → les lat/lng sont disponibles dans `form` quand la section SpotYou se charge
- SpotYou du créateur : Haversine client-side, filtrés à 20km, badgés "Mon SpotYou" et affichés en premier
- SpotYou des autres : filtrés par l'API (20km + tags matching), triés par distance ascendante
- Si pas de localisation renseignée : message explicite invite à remplir l'étape précédente


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


## Implémentation VENTE (sale) — 31 mars 2026
- DB: `brand`, `model`, `weight`, `stripe_product_id`, `stripe_price_id` ajoutées à `marketplace_products`
- Backend `product_creation_routes.py`: `product_type IN ('rental','sale')`, validation séparée par type, brand/model/weight sauvegardés via UPDATE
- `ProductFormContext.tsx`: `sale_price`, `brand`, `model`, `weight` ajoutés; `validateStep()` branché sur `product_type`; `calcProductQuality()` adapté vente
- `Step1TypeCategory.tsx`: option Vente activée (`available: true`)
- `Step2Essential.tsx`: champs brand/model/weight optionnels visibles pour vente uniquement
- `StepSalePricingLocation.tsx` (NOUVEAU): step 4 vente — prix plat + mode remise + localisation
- `ProductCreationFlow.tsx`: stepper dynamique — LOCATION = 8 steps / VENTE = 5 steps (SALE_STEP_CONFIG + SALE_COMPONENTS)
- `Step7Summary.tsx`: récap adapté vente (prix plat, sans caution/SpotYou; conseils vente)
- `ProductDetailView.tsx`: bouton "Acheter" vert, prix plat vert, `COND_LABELS` localisé
- `my-products.tsx`: prix vente affiché sans "/ jour"
- Tests: 15/15 scénarios frontend OK, 8/8 tests backend pytest OK, aucune régression location

## Priorités suivantes (P1)
- UI acheteur: sélection quantité (vente) / durée (location) + calcul total dynamique
- Checkout Stripe: flow d'achat complet (vente) + réservation (location)

---

## Restauration couverture P1 TERMINÉE (2026-04-01)

### test_mask_address_unit.py — 22 tests unitaires

| Classe | Tests | Cas couverts |
|--------|-------|-------------|
| `TestMaskAddressExact` | 3 | exact → identique, None, '' |
| `TestMaskAddressNullInput` | 4 | None × {100m,1000m}, '' × {100m,1000m} |
| `TestMaskAddress100m` | 8 | numéro, bis, ter, quater, sans numéro, sans virgule, grand numéro, seul segment |
| `TestMaskAddress1000m` | 7 | CP → ville, France ignoré, CP seul, arrondissement, sans CP, méridionale, CP4 |

### test_business_rules_v2.py — 14 tests HTTP

| Classe | Tests | Règle |
|--------|-------|-------|
| `TestOwnerCannotLeaveCommunity` | 4 | 403 owner, 200 membre, 404 inexistant, 401 sans auth |
| `TestMaxImagesValidation` | 6 | 11 imgs→400, 10 imgs→200, PUT 11→400, 0 img→200, tag_ids req, min>max |
| `TestSlotsMasquesSiBookingActif` | 4 | visible→réservé→masqué→annulé→visible, slot_status dans réponse |

**Bug backend corrigé :** `spot_you_routes.py` — `/leave` sur SpotYou inexistant retournait 200 (manquait le 404 quand `owner_id is None`)

### Suite complète finale
```
126 tests / 0 échec / 0 skip (5.86s, mode ②)
  test_mask_address_unit.py           22/22
  test_booking_expiry_v2.py           18/18
  test_booking_flows_v2.py            25/25
  test_booking_business_rules_v2.py   32/32
  test_business_rules_v2.py           14/14
  test_perf01_indexes.py              15/15
Zéro écriture sur Supabase.
```


### Levée des 3 skips restants

| Test | Résultat | Raison du skip initial |
|------|----------|----------------------|
| `test_F_cancel_awaiting_payment_releases_slot` | **PASSÉ** ✅ | Manque `slot_status` dans réponse API service |
| `test_G_accept_expired_booking_returns_410` | **PASSÉ** ✅ | Serveur de test non démarré |
| `test_G_accept_valid_booking_returns_200` | **PASSÉ** ✅ | Serveur de test non démarré |

**Corrections apportées :**
- `routes/service_routes.py` : ajout `slot_status` dans `_get_service_slots` SELECT
- `scripts/start_test_server.sh` : chargement `.env.test` via source + timeout 3s
- `scripts/reset_test_db.sh` : chargement `.env.test` avant seed.py (déjà corrigé)

### Nouveaux tests règles métier (test_booking_business_rules_v2.py)

| Classe | Tests | Couverture |
|--------|-------|-----------|
| `TestRequiredFields` | 7 | service_id manquant (422), payment_mode invalide (400), service inexistant (404), auth requise (401) |
| `TestResponseFields` | 3 | booking_id/status/expires_at/amount/pricing_snapshot obligatoires, /accept response |
| `TestPricingEngine` | 2 | amount = prix service, devise EUR |
| `TestInvalidStateTransitions` | 6 | cancel refused (409), refuse accepted (409), tous les 404 sur IDs inexistants |
| `TestAuthorization` | 6 | user≠accept (403), user≠refuse (403), tiers≠cancel (403), receiver≠cancel requested (409), coach≠pay (403), admin=cancel any (200) |
| `TestIdempotence` | 4 | idempotency_key, /refuse×2, /cancel×2, /accept×2 |
| `TestSelfBookingForbidden` | 1 | coach ne réserve pas son propre service |
| `TestPayExpiredBooking` | 1 | /pay expiré → 410 (mode ②) |
| `TestCancelByPayerReleasesSlot` | 1 | cancel payeur → slot available (mode ②) |
| `TestSlotUnavailableRejection` | 1 | slot reserved → 409 (mode ②) |

### Suite P0 finale

```
90 tests / 0 échec / 0 skip  (en mode ②, 4.93s)
  - test_booking_expiry_v2.py        : 18/18
  - test_booking_flows_v2.py         : 25/25 (dont F et G@DB)
  - test_booking_business_rules_v2.py: 32/32
  - test_perf01_indexes.py           : 15/15
```

**Isolation confirmée :** zéro écriture dans Supabase pour tous les tests.


### Stabilisation tests P0 — winek_test

**Bugs corrigés :**

| Fichier | Bug | Correction |
|---------|-----|-----------|
| `scripts/reset_test_db.sh` | `JWT_SECRET` non injecté → `seed.py` crashait | Chargement `.env.test` via `source` avant seed |
| `routes/booking_routes.py` POST `/pay` | `origin_url` vide → Stripe "Not a valid URL" → 500 | Fallback `APP_URL` depuis `os.environ` |
| `routes/booking_routes.py` POST `/pay` | Paiement autorisé depuis statut `requested` (logique métier incorrecte) | Restriction à `awaiting_payment` uniquement |
| `routes/booking_routes.py` POST `/pay` | Réponse ne retournait que `url` (manquait `checkout_url`) | Ajout alias `checkout_url` pour compatibilité |
| `tests/test_booking_flows_v2.py` | Assertions trop strictes (400/422) pour rejets pay_later → backend retourne 409 | Ajout 409 dans les codes acceptés |

**Résultats tests P0 :**
- `test_booking_expiry_v2.py` : 18/18 ✅ (DB isolée winek_test)
- `test_booking_flows_v2.py` : 22/22 ✅ + 3 skippés (mode ② non activé)
- `test_perf01_indexes.py` : 15/15 ✅ (déjà propre)
- **TOTAL : 55/55 passés, 3 skippés (légitimes)**

**Couverture fonctionnelle P0 :**
- Worker expiration : transitions statuts, libération slots, notifications, idempotence
- Flux A/B/C/D : instant_booking + manual_approval × pay_now + pay_later
- Endpoint `/pay` : autorisé, refusé (403/404/409/410), idempotence Stripe
- Annulation : slot libéré, success 200

**Isolation confirmée :** zéro écriture dans Supabase pour les tests DB.


### Ce qui a été fait
- `database.py` : réécriture complète (~85 lignes). Zéro DDL/ALTER TABLE au runtime.
  Pool asyncpg avec auto-détection SSL :
  - Local (127.0.0.1) → ssl=False
  - Supabase (Supavisor) → ssl_ctx (CERT_NONE) — cert Supabase non vérifiable depuis GCP
  - statement_cache_size=0 (pgbouncer/Supavisor compatible)
- `server.py` : seed_initial_data() retiré du hook startup
- `seed.py` : guard CLI `if __name__ == '__main__':` ajouté + seed exécuté avec succès sur Supabase
- `migrations/003_drop_legacy_columns.sql` : créé et appliqué (brand_model, max_duration_days, rental_duration_unit, rental_duration_qty supprimés)
- `migrations/run_migrations.py` : SSL auto-detect + pool.terminate() (résout le hang asyncpg)
- Supabase : 35 tables, _migrations enregistrées (001, 002, 003), colonnes legacy supprimées
- `.env` : DATABASE_URL → Supabase Supavisor session mode (aws-0-eu-west-1.pooler.supabase.com:5432)
- API vérifiée : Login ✅, Marketplace ✅ (5 produits, 0 colonnes legacy), Domains ✅, Profile ✅

### Stratégie de connexion retenue
- **Dev + Prod** : Supavisor session mode (`aws-0-eu-west-1.pooler.supabase.com:5432`)
- ssl_ctx (CERT_NONE) requis depuis l'hébergeur GCP Kubernetes
- Connexion directe (`db.PROJECT.supabase.co:5432`) : hostname non résolvable depuis pods GCP

- Route `GET /api/readiness` et `GET /api/liveness` ajoutées dans `server.py` (infra, tag "infra")
  - Liveness : 200 `{status: alive}` — process FastAPI vivant, aucune dépendance vérifiée
  - Readiness : 200 `{status: ready, database: ok}` si pool + SELECT 1 OK, sinon 503
- Système de migrations renforcé (2026-04-01)
  - Transactions atomiques par migration (rollback automatique si échec)
  - Vérification checksum anti-tamper (SHA-256 complet + compat anciens checksums 16 chars)
  - Commande `--new <nom>` pour créer une migration depuis un template
  - Connexion simple `asyncpg.connect()` au lieu d'un pool (outil CLI)
  - Documentation complète : `migrations/MIGRATIONS.md`
  - Convention nommage stricte validée par regex : `NNN_description.sql`
  - Limites documentées : forward-only, pas de lock distribué, certains DDL hors transaction

### Architecture migrations versionnées
- `001_initial_schema.sql` : schéma complet (déjà appliqué par agent précédent)
- `002_sale_product_fields.sql` : colonnes produits vente
- `003_drop_legacy_columns.sql` : suppression colonnes obsolètes
- `006_product_location_address_raw.sql` : colonne `location_address_raw` sur `marketplace_products`
- Commande : `cd /app/backend && python migrations/run_migrations.py`
- Seed manuel : `cd /app/backend && python seed.py`

---

## Nettoyage pollution données de test Supabase prod (2026-04-01)

### Cause identifiée
- `test_spotyou_participation.py` + `test_winek_iter9.py` et 12 autres fichiers avaient une **URL de production hardcodée** (`"https://location-payload-fix.preview.emergentagent.com/api"`) comme constante de module, **bypassing entièrement** le mécanisme d'isolation de `conftest.py`
- Premier `run_tests.sh` du fork a déclenché ces tests → 35 SpotYou de test créés dans Supabase prod

### Corrections appliquées
1. **35 records nettoyés** de Supabase prod (tag_points + dépendances FK)
2. **14 fichiers de test corrigés** : URL hardcodée → `os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:9999")` — désormais bloqués par conftest.py
3. `run_tests.sh` : déjà correct (`TEST_ENV=test` forcé), pas de changement nécessaire

### Garanties post-correction
- Aucun test HTTP ne peut atteindre Supabase prod sans `TEST_BASE_URL=http://localhost:800x`
- Tests DB-only (`winek_test`) : toujours isolés ✅
- 126/126 tests passés après correction ✅

## Passe finale — GET /services/{id} (2026-04-01)

### Audit et optimisation
- Identifié : 2 roundtrips Supabase séquentiels inévitables avant le batch (auth + SELECT base)
- Fix : `asyncio.gather(auth, base_select)` dans `get_service` → 1 roundtrip économisé
- Bonus : suppression des `print(f"DEBUG...")` dans `get_optional_auth` (polluaient tous les logs)
- Fichiers : `service_routes.py`, `auth_utils.py`
- Gain : **1.48s → 1.14s (-23%)** — payload identique, 126/126 tests passés

### Ce qui reste incompressible
- Batch 1 (6 requêtes en parallèle) = 1 roundtrip Supabase (~211ms) — déjà optimal
- pkg_slots (dépend du résultat packages) = 1 roundtrip inévitable (~211ms)
- Base + auth = 1 roundtrip (parallélisés) = 211ms
- Overhead réseau/pool : ~300ms
- **Plancher réel estimé : ~950ms**

## Phase 3 Performance — Middleware + Cache Frontend (2026-04-01)

### Backend — Middleware X-Response-Time (`server.py`)
- Middleware `add_response_time_header` ajouté (impact ~1µs/req)
- Header `X-Response-Time` (ms entier) sur toutes les réponses
- Log structuré : `METHOD path → status  XXXms` via `logging.INFO`

### Frontend — Cache semi-statiques (`map.tsx`, `cache.ts`)
1. **Bug corrigé** : `feedTtl = 5` (ms!) → `getTtl('/home/feed') ?? 5 * 60_000` — le cache feed était toujours invalide
2. **Cache ajouté** : `/home/nearest-sector` dans `fetchNearestSector` (TTL 10 min, clé = coords arrondies à 0.01°)
3. **TTLs ajoutés** dans `CACHE_TTL_MAP` : `/home/feed` (5 min), `/home/nearest-sector` (10 min), `/marketplace/products` (5 min)

### Tests : 126/126 passés — zéro régression

## Phase 2 Optimisation Performance Globale — Batch N+1 (2026-04-01)

### Endpoints refactorisés
| Endpoint | Avant | Après | Gain |
|----------|-------|-------|------|
| `GET /home/feed` | 1.76s | **1.31s** | **-26%** |
| `GET /tag-points/mine` | 2.25s | **1.39s** | **-38%** |
| `GET /marketplace/products` | 1.28s | **0.81s** | **-37%** |

### Stratégie appliquée
- **`GET /home/feed`** (`home_routes.py`) : N+1 `is_going` (1 requête/SpotYou dans boucle) → 1 batch `SELECT DISTINCT ... ANY($1::text[])` pour tous les SpotYou
- **`GET /tag-points/mine`** (`tagpoint_routes.py`) : 2N queries (`going_count` + `is_going` par point) → 2 batch queries `WHERE spot_you_id = ANY()`, résultat filtré en Python par date de session
- **`GET /marketplace/products`** (`marketplace_routes.py`) : `SELECT p.*` (64 cols) → 47 colonnes ciblées (exclusion : `stripe_*`, `brand`, `model`, `weight`, `size_dimensions`, `location_address_raw`, `admin_validated_*`, `rejection_reason`, `radius_km`) + 4 seller_stats séquentielles → `asyncio.gather` parallèle

### Tests : 126/126 passés — zéro régression

## Phase 1 Optimisation Performance Globale — asyncio.gather (2026-04-01)

### Endpoints refactorisés
| Endpoint | Avant | Après | Gain |
|----------|-------|-------|------|
| `GET /tag-points/{id}` | 2.28s | **1.42s moy** | **-38%** |
| `GET /conversations` | 1.53s | **1.07s moy** | **-30%** |
| `GET /services/{id}` | 2.07s | **1.40s moy** | **-32%** |

### Stratégie appliquée
- Remplacement des boucles N+1 séquentielles par `asyncio.gather` avec connexions pool indépendantes
- `GET /tag-points/{id}` : 9 requêtes séquentielles → 3 batches parallèles (1 base + 4 statiques || + 3 auth ||)
- `GET /conversations` : N×4 requêtes → 5 requêtes batch (`_batch_enrich_conversations`)
- `GET /services/{id}` : 5 requêtes séquentielles → 7 batch (`_batch_enrich_services_for_owner`)

### Fichiers modifiés
- `backend/routes/tagpoint_routes.py` — Phase 1.2 (`import asyncio` + refactor `get_tag_point`)
- `backend/routes/chat_routes.py` — Phase 1.1 (`_batch_enrich_conversations`)
- `backend/routes/service_routes.py` — Phase 1.3 (`_enrich_service_detail`)

### Tests
- 126/126 passés (mode ② winek_test) — zéro régression
- Payload JSON identique avant/après (vérifié par diff programmatique)

## Optimisations performance écran recherche (2026-04-01)

### Contexte
Audit performance déclenché par un chargement > 1s sur l'écran recherche SpotYou + Service.
Latence de base Supabase = 215ms/requête. Le N+1 Python était le multiplicateur principal.

### Fix 1 : Batch N+1 `/services` (search)
- Remplacé `_enrich_service × N` par `_batch_enrich_services_for_search` (4 requêtes `asyncio.gather`)
- 3 820ms → 762ms (-80%)
- Slots et packages non chargés pour la liste (non affichés dans cet écran)

### Fix 2 : Migration 007 — Index `service_locations(service_id)`
- `CREATE INDEX IF NOT EXISTS idx_service_locations_service_id ON service_locations(service_id)`
- Seq Scan 46ms → Index Scan 12ms sur le filtre EXISTS géographique

### Fix 3 : Cache module-level `/tags/categories` (frontend)
- Variable `_tagCache` TTL 5min dans `search.tsx`
- `getCachedTagCategories()` / `invalidateTagCache()` au pull-to-refresh
- 640ms sur montages 2+ → 0ms (cache hit)

### Fix 4 : Batch N+1 `/services/mine`
- Nouveau `_batch_enrich_services_for_owner` : 6 requêtes batch + 1 pour package_slots
- 3 750ms → 1 400ms (-63%)
- is_owner=True, original_description, slots, packages conservés

### Fichiers modifiés
- `backend/routes/service_routes.py`
- `backend/migrations/007_service_locations_service_id_index.sql`
- `frontend/app/(tabs)/search.tsx`

### Problème
Les tests E2E HTTP tournaient sans `TEST_BASE_URL` → ils écrivaient sur Supabase prod :
- 107 SpotYous, 117 services, 45 users, 234 notifications, 164 bookings de test créés en production
- Thomas Dupont (user_demo001) recevait des notifications de test sur son vrai compte

### Corrections
**1. `conftest.py` — Garde anti-contamination**
- Si `TEST_ENV=test` mais `TEST_BASE_URL` absent → `EXPO_PUBLIC_BACKEND_URL` écrasé par `http://localhost:9999`
- Les tests HTTP échouent avec `ConnectionError` au lieu de polluer Supabase
- Si `TEST_BASE_URL` est défini → il est injecté comme URL HTTP (mode ②)

**2. Nettoyage Supabase prod**
- Supprimé : 107 SpotYous test, 117 services test, 45 users test, 234+ notifications test
- Supprimé : 96 bookings test, 96 paiements test
- DB finale : 8 SpotYous légitimes, 8 services légitimes, 0 bookings, 42 notifications

### État final
- `user_demo001`: 0 notifications ✅
- `user_coach001`: 6 notifications légitimes ✅
- 9/9 tests No-DDL toujours ✅
- Prochaine exécution de `bash run_tests.sh` → message "🔒 ISOLATION ACTIVÉE" (HTTP bloqué)

### Problème
Le formulaire d'édition produit affichait la ville masquée ("Lyon") au lieu de l'adresse exacte saisie par le propriétaire, car :
1. Le payload frontend (`ProductCreationFlow.tsx`) n'incluait pas `location_address_raw`
2. Le backend (`product_creation_routes.py`) n'acceptait pas ni ne sauvegardait ce champ

### Solution appliquée
| Fichier | Changement |
|---------|-----------|
| `frontend/components/product-form/ProductCreationFlow.tsx` | Ajout `location_address_raw: (form.locationAddress ?? '').trim() \|\| null` dans le payload de soumission |
| `backend/routes/product_creation_routes.py` | Ajout d'un UPDATE séparé `SET location_address_raw = $1 WHERE product_id = $2` après l'INSERT/UPDATE principal (même pattern que `price_per_session` et `brand/model/weight`) |

### Résultat
- `POST /api/products` : `location_address_raw` sauvegardée ✅
- `POST /api/products` (UPDATE) : `location_address_raw` mise à jour ✅
- `GET /api/products/{id}/detail` : `location_address_raw` restituée correctement ✅
- Tests No-DDL : 9/9 ✅
