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

### Phase 4 - Save for Later (Session 6 - Actuel)
- ✅ **Backend**: Table `tag_point_saves`, endpoints save/unsave/list
- ✅ **Frontend [id].tsx**: Icônes d'action redessinées (card-style 54x54, spacing amélioré)
  - "Similaires" → icône `layers-outline`
  - "Partager" → icône `share-social-outline`
  - "Sauvegarder" → `bookmark-outline` / `bookmark` (rempli + couleur primaire quand sauvegardé)
- ✅ **Frontend saved.tsx**: Nouvel écran `/saved` avec liste des tagPoints sauvegardés
  - Cards avec image, titre, distance, date de sauvegarde
  - Bouton unsave par card
  - État vide avec bouton "Explorer"
  - Refresh on focus
- ✅ **Frontend profile.tsx**: Bouton "ENREGISTRÉS" navigue vers `/saved`
- ✅ **_layout.tsx**: Route `saved` ajoutée au Stack
- ✅ **Fix Expo Metro**: `typedRoutes: false`, `web.output: "spa"`, stubs `expo-router/internal/*`

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
