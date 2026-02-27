# WINEK - Product Requirements Document

## Original Problem Statement
Application mobile hyperlocale WINEK - plateforme de connexion basée sur des tags (sports/coaching). V1 orientée sports et coaching : créer, chercher et gérer des "tagPoints" et "Services" géolocalisés. Modèle payant pour les coaches avec intégration Stripe.

**Langue préférée**: Français

---

## Architecture Technique
- **Frontend**: React Native (Expo), TypeScript
- **Backend**: FastAPI (Python), PostgreSQL + PostGIS
- **Auth**: JWT + Google Social Login (Emergent-managed)
- **Géolocalisation**: PostGIS pour les requêtes spatiales
- **Paiements**: Stripe (planifié)

## Personas Utilisateurs
- **User (standard)**: Cherche des activités, sauvegarde des tagPoints, réserve des services
- **Coach**: Crée des profils, offre des services payants avec planning par lieu
- **Admin**: Gestion de la plateforme

---

## What's Been Implemented

### Session 1-3 (Fondations)
- Auth JWT + Google Social Login
- TagPoints CRUD avec géolocalisation PostGIS
- Écran carte principal + recherche
- Profil utilisateur + coach
- Domaines/Tags/Catégories
- Système de services de base

### Session 4-6 (Services & Booking)
- Système de réservation (bookings)
- Formulaire création service (create-service.tsx) - 5 étapes
- Formulaire édition service (edit-service/[id].tsx)
- Bug fix: connexion backend PostgreSQL

### Session 7 (Refactoring UI - Obsolète)
- Refactoring UI date/time picker (déprécié immédiatement après)

### Session 8 (Architecture Location-Based - ACTUEL)
**Date**: 2026-02-27
- **Nouvelle colonne**: `service_slots.location_id` FK → `service_locations(location_id)`
- **Modèle**: `ServiceSlotItem` avec `location_index` (int) pour résoudre le mapping
- **Backend create/update**: Collecte les IDs de locations créées, mappe via `location_index`
- **Retour GET**: `slot.location_id` retourné dans la réponse API
- **Frontend create-service.tsx**: `handleSubmit` envoie `location_index: locIdx`
- **Frontend edit-service/[id].tsx**: REÉCRIT - étapes 3 & 4 avec nouvelle architecture
  - Étape 3: `LocationPicker` pour ajouter des lieux + precision chips
  - Étape 4: Planning indépendant par lieu (sélecteur type, jours, créneaux horaires)
  - `loadService`: reconstruit l'état depuis l'API (groupement slots par location_id)
  - `handleSubmit`: envoie `location_index` pour chaque slot
- **Fix**: `GET /services/mine` filtre `active=TRUE` (services soft-deleted masqués)
- **Tests**: 100% - 32/32 (16 backend + 16 frontend) - iteration_27.json

---

## Prioritized Backlog

### P0 - Critique
- Aucun P0 actif (location-based scheduling TERMINÉ ✅)

### P1 - Haute Priorité
- **Booking System V2**: Acceptation/rejet des réservations par le coach
- **Service Search**: Recherche et filtrage des services sur la carte principale
- **Action Buttons UI**: Layout insatisfaisant (`Similaire/Partager/Sauvegarder`) sur `tagPoint/[id].tsx`
- **Stripe Integration**: Paiements pour les services

### P2 - Priorité Moyenne
- **i18n**: Support bilingue Français/Anglais
- **Chat**: Implémentation du chat entre utilisateurs
- **Admin Dashboard**: Interface d'administration

### P3 - Backlog
- Fix Google Auth sur Expo Go (IN HOLD)
- Admin Dashboard complet
- Notifications push

---

## Issues Connues

### Non-bloquantes
- **Expo Hot-Reload**: Cassé - utiliser `sudo supervisorctl restart expo` après chaque changement frontend
- **Google Auth Expo Go**: Navigateur in-app ne se ferme pas automatiquement (ON HOLD)
- **React Native Web warnings**: "Unexpected text node" (console, non-bloquant)

---

## Données de Test
- **coach**: `coach@winek.app` / `WinekCoach2024!`
- **user**: `user@winek.app` / `WinekUser2024!`
- **admin**: `admin@winek.app` / `WinekAdmin2024!`
- **Service test**: `svc_8f29229294d2` (Cours Tennis Multi-lieux, 2 lieux, 2 slots)

---

## API Endpoints Clés
- `POST /api/services` - Créer service (location_index dans slots)
- `PUT /api/services/{id}` - Modifier service (location_index dans slots)
- `GET /api/services/{id}` - Récupérer service (slot.location_id retourné)
- `GET /api/services/mine` - Services du coach connecté (filtre active=TRUE)

## Schéma DB Clé (service_slots)
```sql
slot_id TEXT PK
service_id TEXT FK
location_id TEXT FK → service_locations(location_id) ON DELETE SET NULL
slot_type TEXT DEFAULT 'recurring'
days_of_week JSONB
day_of_week INT
start_time TEXT
end_time TEXT
slot_date TEXT
```
