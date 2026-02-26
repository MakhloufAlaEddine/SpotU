# WINEK - Product Requirements Document

## Original Problem Statement
Build **WINEK** — une plateforme mobile hyperlocale de connexion par tags, focalisée sur les sports et le coaching. Les utilisateurs peuvent créer et rechercher des activités géolocalisées ("tagPoints"). Les coachs peuvent proposer des services payants (Stripe). Architecture scalable avec PostgreSQL/PostGIS + React Native (Expo) + FastAPI. Application bilingue (Français/Anglais).

## Core Requirements
- **TagPoints**: Créer/chercher des activités géolocalisées
- **Géolocalisation**: Recherche par rayon avec PostGIS
- **Services de coaching**: Profils coachs + sessions payantes
- **Paiements**: Stripe
- **Rôles**: Utilisateur standard, Coach, Admin
- **Tech Stack**: React Native (Expo), TypeScript, FastAPI, PostgreSQL/PostGIS
- **Auth**: Email/password + Google OAuth (web only - natif en attente)
- **Bilingue**: Français/Anglais

## What's Been Implemented

### Phase 1 - Foundation
- PostgreSQL/PostGIS backend avec schéma complet
- Authentification JWT (email/password) + Google OAuth (web)
- CRUD TagPoints avec géolocalisation
- Recherche par tags et par rayon

### Phase 2 - TagPoint Detail Screen (Session 1-4)
- Galerie photos carousel
- Système de votes/commentaires complet (`tag_point_votes` table)
- Fonctionnalité RSVP "Je participe" (`tag_point_participants` table)
- TagPoints similaires (PostGIS + tags)
- Squelette de chargement (shimmer)
- Profil créateur cliquable
- Tags colorés par catégorie
- Affichage des horaires
- FAB pour voter
- Affichage des commentaires avec bottom sheet "Voir tout"

### Phase 3 - UX Améliorations (Session 4-5)
- Recherche avancée par tags (modal multi-sélection)
- Recherche d'adresse avec Nominatim dans `set-location.tsx`
- Persistance de localisation session-only (non stockée entre lancements)
- Fix SSL PostgreSQL (`ssl=False` dans database.py)

### Phase 5 - Formulaire Create TagPoint v2 (Session 9)
- ✅ **Tags modal** : Fix layout (hauteur fixe 80% + ScrollView avec flex:1) + filtre catégories vides + couleur par catégorie + compteur tags sélectionnés
- ✅ **Location modal** : Refonte `LocationPicker.tsx` - Nominatim search, GPS, reverse geocoding, carte interactive. Click sur "Localisation" dans le create form ouvre le modal
- ✅ **Date/Time pickers** : Nouveau composant `DateTimePicker.tsx` - calendrier mensuel (navigation mois/an, grille jours, today dot) + roue heure/min avec presets + mode datetime/date/time
- ✅ **"Bientôt une nouvelle date"** : Visible sur pt_demo013 (event passé + `new_date_coming=true` dans seed) + banner teal + toggle créateur
- ✅ **seed.py** : Updates toujours exécutés (hors `if count == 0`) pour event_date, event_schedule, new_date_coming
- ✅ **expo-image-picker** : Fix dépréciation `MediaTypeOptions` → `'images'`
- ✅ **Frontend create.tsx**: Refonte complète de l'écran de création avec :
  - Section photos (expo-image-picker, jusqu'à 10 images, avec badge "Principale")
  - Titre requis (80 chars) + Description (500 chars, multiline)
  - Sélecteur domaine (4 domaines depuis API, pills horizontales)
  - Sélecteur tags avec modal bottom sheet (catégories + chips colorés, multi-select)
  - Précision localisation (Élevé/Moyen/Faible) avec icônes
  - Carte interactive (OpenStreetMap) + adresse + refresh GPS
  - Date & Horaire : Sans date / Date unique / Récurrent (avec jours + heure)
  - Bouton "Publier" en header + bouton "Publier le TagPoint" en bas
  - Validation : titre requis, formats date, etc.
- ✅ **Backend models.py**: Ajout de `images: Optional[List[str]] = []` dans `TagPointCreate`
- ✅ **Backend tagpoint_routes.py**: 
  - INSERT inclut maintenant la colonne `images`
  - Fix double encodage JSON : `tag_ids`, `images`, `event_schedule` passés comme objets Python (list/dict) directement à asyncpg (pas via json.dumps)
- ✅ **lib/api.ts**: Ajout méthode `api.patch()`
- ✅ **Événements passés** (Session 7): Badge "Passé", label "Événement passé", toggle créateur "Annoncer une nouvelle date", banner "Bientôt une nouvelle date"
- ✅ **Backend**: Table `tag_point_saves`, endpoints save/unsave/list
- ✅ **Frontend [id].tsx**: Icônes d'action redessinées (card-style 54x54, spacing amélioré)
  - "Similaires" → icône `layers-outline`
  - "Partager" → `share-social-outline`
  - "Sauvegarder" → `bookmark-outline` / `bookmark` (rempli + couleur primaire quand sauvegardé)
- ✅ **Frontend saved.tsx**: Nouvel écran `/saved` avec liste des tagPoints sauvegardés
- ✅ **Frontend profile.tsx**: Bouton "ENREGISTRÉS" navigue vers `/saved`
- ✅ **_layout.tsx**: Route `saved` ajoutée au Stack
- ✅ **Fix Expo Metro**: `typedRoutes: false`, `web.output: "spa"`, stubs `expo-router/internal/*`
- ✅ **Événements passés**: Affichage muted avec badge "Passé" + label "Événement passé"
  - Badge teal "Bientôt une nouvelle date" si `new_date_coming=true`
  - Toggle pour le créateur pour annoncer/retirer "Nouvelle date"
  - Endpoint `PATCH /api/tag-points/{id}/new-date` (créateur uniquement)
- ✅ **RÉCURRENT**: Couleur uniformisée avec les dates fixes (teal `Colors.primary`)

## Tech Architecture
```
/app
├── backend
│   ├── routes
│   │   ├── domain_routes.py    # /tags/categories
│   │   └── tagpoint_routes.py  # TagPoints CRUD + votes + saves + rsvp + similar
│   ├── database.py             # PostgreSQL/PostGIS connection (ssl=False)
│   └── server.py
├── frontend
│   ├── app
│   │   ├── (auth)/             # Login, Register, Callback
│   │   ├── (main)/             # Screens: search, set-location, create-service
│   │   ├── (tabs)/             # Tabs: index, search, create, bookings, profile
│   │   ├── tag-point/[id].tsx  # Detail screen complet
│   │   ├── saved.tsx           # NEW: Saved tagpoints list
│   │   └── _layout.tsx         # Stack avec route "saved"
│   ├── context/
│   │   ├── AuthContext.tsx     # JWT Auth + Google OAuth
│   │   └── LocationContext.tsx # Session-only location
│   ├── constants/Colors.ts
│   └── lib/api.ts
└── memory/PRD.md
```

## Key DB Schema
```sql
tag_points: point_id, user_id, title, description, latitude, longitude, 
            tags (JSONB), images (JSONB), schedule (JSONB), domain_id
tag_point_votes: id, tag_point_id, user_id, rating, comment, created_at
tag_point_participants: id, tag_point_id, user_id, joined_at
tag_point_saves: id, user_id, tag_point_id, saved_at
```

## Key API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/tag-points/{id}/vote | Voter sur un tagpoint |
| GET | /api/tag-points/{id}/my-vote | Mon vote |
| GET | /api/tag-points/{id}/votes | Tous les votes |
| GET | /api/tag-points/{id}/similar | TagPoints similaires |
| POST | /api/tag-points/{id}/join | Rejoindre (RSVP) |
| DELETE | /api/tag-points/{id}/leave | Se retirer |
| POST | /api/tag-points/{id}/save | Sauvegarder |
| DELETE | /api/tag-points/{id}/unsave | Retirer sauvegarde |
| GET | /api/tag-points/saved | Liste des sauvegardés |

## Test Credentials
- Email: `user@winek.app`
- Password: `WinekUser2024!`

## Known Issues
- **Google Auth natif (Expo Go)**: Non fonctionnel sur Expo Go (déprioritisé par l'utilisateur)
- **PostgreSQL**: Le mot de passe doit être réinitialisé si la DB redémarre: `ALTER USER winek WITH PASSWORD 'winek2024'`

## Prioritized Backlog

### P0 (Critical)
- [x] Save for Later (terminé)

### P1 (High)
- [ ] Flux création de service pour coachs (`create-service.tsx`)
- [ ] Intégration Stripe pour paiements
- [ ] Support bilingue i18n complet (FR/EN)
- [ ] Chat (`chat.tsx`)

### P2 (Medium)
- [ ] Système d'avis et notes étendu
- [ ] Dashboard administrateur
- [ ] Fix Google Auth sur Expo Go

## 3rd Party Integrations
- **Emergent Google Auth**: Web ✅ / Natif ❌ (on hold)
- **OpenStreetMap Nominatim**: Reverse geocoding ✅
- **Stripe**: Planifié (non implémenté)
