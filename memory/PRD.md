# WINEK - Product Requirements Document

## Original Problem Statement
Application mobile "WINEK" - plateforme hyperlocale de connexion basée sur des tags. V1 focalisée sur le sport et le coaching. Les utilisateurs peuvent poster et rechercher des activités géolocalisées ("tagPoints"). Tier payant pour coachs avec Stripe. Backend PostgreSQL/PostGIS, Frontend React Native (Expo). App bilingue FR/EN.

## Tech Stack
- Frontend: React Native (Expo), TypeScript
- Backend: FastAPI, PostgreSQL + PostGIS, asyncpg
- Auth: JWT (custom) + Google OAuth (Emergent-managed, ON HOLD mobile)
- Payments: Stripe (planned)

## User Personas
- **User standard**: Cherche et rejoins des activités sportives
- **Coach**: Crée des services payants, profil vérifié
- **Admin**: Gestion de la plateforme

## Core Requirements
- Créer/rechercher/gérer des tagPoints géolocalisés
- Géolocalisation avec PostGIS (rayon ajustable)
- Services coaching payants
- Rôles: User / Coach / Admin
- Bilingue FR/EN (i18n - à implémenter)
- Auth: login/password + Google (natif ON HOLD)

## Architecture
```
/app
├── backend/
│   ├── server.py
│   ├── database.py        # PostGIS, migrations, seed
│   ├── seed.py
│   └── routes/
│       ├── auth_routes.py
│       ├── user_routes.py
│       ├── tagpoint_routes.py  # POST/PATCH endpoints
│       ├── domain_routes.py
│       ├── service_routes.py
│       ├── booking_routes.py
│       ├── payment_routes.py
│       └── admin_routes.py
├── frontend/
│   ├── app/
│   │   ├── (tabs)/
│   │   │   ├── create.tsx     # Wizard multi-étapes (978 lignes)
│   │   │   ├── search.tsx
│   │   │   ├── map.tsx
│   │   │   ├── chat.tsx
│   │   │   ├── profile.tsx
│   │   │   └── bookings.tsx
│   │   ├── tag-point/[id].tsx  # Détail tagPoint
│   │   └── (auth)/
│   ├── components/
│   │   ├── custom/
│   │   │   ├── DateTimePicker.tsx  # Sélecteur date/heure custom
│   │   │   └── RichTextInput.tsx   # Éditeur markdown
│   │   └── ui/ (shadcn)
│   └── lib/api.ts
```

## What's Been Implemented

### Session 1-3 (prior)
- Auth complète (JWT + Google OAuth partiel)
- Recherche géolocalisée avec filtres tags
- Écran détail tagPoint ([id].tsx)
- Sauvegarde tagPoints
- Système d'événements/planning
- Backend complet (tagpoints, domains, tags, services, bookings, payments)

### Session 4 (2026-02-26)
- **Wizard "Créer TagPoint" (create.tsx)**: 4 étapes + aperçu
  - Étape 1: Essentiel (photos + titre) — messages d'aide toujours visibles
  - Étape 2: Contenu (description, domaine, tags)
  - Étape 3: Localisation — 3 boutons confidentialité sur même ligne
  - Étape 4: Date — jours multiples + multi-créneaux horaires pour récurrent
  - Étape 5: Aperçu + bouton "Voir l'aperçu complet" (modal détail)
- **Score de qualité** en temps réel (Basique → Bien → Très bien → Excellent)
- **FullPreviewModal**: Modal plein écran montrant le tagPoint comme il apparaîtra
- **RichTextInput.tsx**: Éditeur markdown (gras, italique, souligné, listes)
- **DateTimePicker.tsx**: Calendrier custom + sélecteur heure
- **Markdown display** dans [id].tsx
- Backend: colonne `new_date_coming`, endpoint PATCH toggle-new-date
- Fix double-encoding JSON au POST /api/tag-points
- Payload récurrent: {type:'weekly', days:[0,2,4], times:['09:00','17:00']}
- **Tests**: 100% (Backend 62/62, Frontend 24/24 scénarios)

## Credentials de Test
- user@winek.app / WinekUser2024!
- coach@winek.app / WinekCoach2024!
- admin@winek.app / WinekAdmin2024!

## API Endpoints Clés
- POST /api/auth/login → { user, token }
- GET /api/tag-points?lat=&lng=&radius=
- POST /api/tag-points (auth required)
- PATCH /api/tag-points/{id}/toggle-new-date
- GET /api/domains
- GET /api/tags/categories?domain_id=

## Known Issues
- Google Auth sur Expo Go (mobile): in-app browser ne se ferme pas automatiquement (ON HOLD)
- Boutons d'action ([id].tsx): layout "Similar/Share/Save" insatisfaisant (P1)

## Prioritized Backlog

### P0 - Critique
- [x] Wizard Créer TagPoint - DONE & TESTED

### P1 - Important
- [ ] Refonte layout boutons d'action ([id].tsx)
- [ ] Flux "Create Service" pour coachs (create-service.tsx)
- [ ] Intégration Stripe pour paiements

### P2 - Moyen terme
- [ ] Support bilingue (i18n) FR/EN
- [ ] Implémentation Chat (chat.tsx)
- [ ] Refactoring create.tsx en sous-composants

### P3 - Futur
- [ ] Système notes & avis utilisateurs
- [ ] Dashboard Admin
- [ ] Fix Google Auth Expo Go (natif)
- [ ] Upload photos réelles (actuellement envoi tableaux vides)
