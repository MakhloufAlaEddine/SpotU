# WINEK - Product Requirements Document

## Original Problem Statement
Application mobile "WINEK" - Plateforme hyperlocale de connexion par tags (V1: sports et coaching).
- Utilisateurs peuvent créer et rechercher des "tagPoints" géolocalisés
- Les coachs peuvent proposer des services payants
- Stack: React Native (Expo/TypeScript) + FastAPI + PostgreSQL/PostGIS
- Bilingue: Français/Anglais

## Architecture
```
/app
├── backend/
│   ├── server.py          # FastAPI app + startup
│   ├── database.py        # AsyncPG pool + CREATE TABLE migrations
│   ├── models.py          # Pydantic models
│   ├── seed.py            # Seed data (users, domains, tagpoints, services)
│   ├── auth_utils.py      # JWT auth
│   └── routes/
│       ├── auth_routes.py
│       ├── tagpoint_routes.py
│       ├── service_routes.py
│       ├── user_routes.py
│       └── upload_routes.py
├── frontend/
│   ├── app/
│   │   ├── (tabs)/        # Map, Discover, Create tagpoint, Profile
│   │   ├── create-service.tsx   # Service creation (5 étapes)
│   │   ├── edit-service/[id].tsx # Service editing (5 étapes)
│   │   └── tag-point/[id].tsx   # TagPoint detail
│   └── components/
│       ├── DateTimePicker.tsx   # DateTimePickerModal (partagé)
│       ├── MapViewComponent.tsx
│       ├── DomainPill.tsx
│       └── TagSelector.tsx
```

## What's Been Implemented

### Core Features (DONE)
- Auth: login/signup + Google Social Login (ON HOLD - bug Expo Go)
- TagPoints: CRUD complet + carte géolocalisée + précision PostGIS
- Services: CRUD complet avec formulaire 5 étapes
  - Étape 1: Titre, description, prix, durée
  - Étape 2: Sport & tags
  - Étape 3: Lieux sur carte (jusqu'à 5)
  - Étape 4: Créneaux avec DateTimePickerModal (refonte 2026-02-27)
  - Étape 5: Résumé + publication
- Profil: Visualisation tagPoints et services du coach
- Booking: Système de réservation V1

### Dernière implémentation (2026-02-27)
- P0 Terminé: Refonte UI date/heure Step 4 (create-service + edit-service)
  - Remplacé: chips scrollables heures/minutes
  - Par: DateTimePickerModal (identique à create-tag-point)
  - Mode datetime pour créneau "Date unique"
  - Mode time pour créneaux "Récurrent" et "Disponibilité"
  - Validation intégrée (fin > début, sélection requise)
  - Tests: 12/12 backend + 15/15 frontend PASS

## Key DB Schema (PostgreSQL + PostGIS)
- users: user_id, email, hashed_password, role (user/coach/admin), full_name
- tag_points: tag_point_id, user_id, title, description, lat, lng, precision, schedule (JSONB)
- services: service_id, coach_id, title, description, price, domain_id, status
- service_slots: slot_id, service_id, slot_type (recurring/single/availability), day_of_week, days_of_week (JSONB), start_time, end_time, slot_date
- bookings: booking_id, service_id, user_id, slot_id, status, notes

## Credentials (test)
- admin@winek.app / WinekAdmin2024!
- coach@winek.app / WinekCoach2024!
- user@winek.app / WinekUser2024!

## Known Issues / Blockers
- Expo hot-reload: Non fonctionnel → sudo supervisorctl restart expo requis après chaque modif frontend
- Google Auth Expo Go: In-app browser ne se ferme pas automatiquement (ON HOLD)

## Prioritized Backlog

### P1 (Prochain sprint)
- [ ] Boutons d'action (Similaire/Partager/Sauvegarder) sur tag-point/[id].tsx - layout insatisfaisant
- [ ] Système de réservation V2: acceptation/rejet par le coach
- [ ] Recherche et filtrage des services sur la carte

### P2 (Future)
- [ ] Intégration Stripe (paiements services)
- [ ] Support bilingue i18n (Français/Anglais)
- [ ] Chat entre utilisateurs
- [ ] Dashboard Admin
- [ ] Fix Google Auth sur Expo Go
