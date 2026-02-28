# WINEK - Product Requirements Document

## Vue d'ensemble
WINEK est une plateforme hyperlocale de connexion sportive basée sur des tags géolocalisés. Focus initial sur le sport et le coaching. Application mobile (Expo React Native) + Backend (FastAPI + PostgreSQL/PostGIS).

## Stack Technique
- **Frontend**: Expo / React Native (Web + Mobile)
- **Backend**: FastAPI + asyncpg + PostgreSQL + PostGIS
- **Auth**: JWT custom + Google Auth (Emergent-managed)
- **Paiements**: Stripe (planifié)
- **Géocoding**: OpenStreetMap Nominatim

## Architecture des fichiers clés
```
/app
├── backend/
│   ├── models.py               # Pydantic models (ServiceCreate, ServicePackageItem, DaySlotPayload...)
│   ├── database.py             # DB schema + migrations + seed
│   ├── routes/
│   │   ├── service_routes.py   # CRUD services (create gère maintenant packages)
│   │   ├── auth_routes.py      # JWT login/register/Google
│   │   ├── user_routes.py      # Profil utilisateur
│   │   ├── tagpoint_routes.py  # TagPoints géolocalisés
│   │   ├── booking_routes.py   # Réservations
│   │   └── payment_routes.py   # Stripe
│   └── seed.py                 # Données de test
├── frontend/
│   ├── app/
│   │   ├── (tabs)/
│   │   │   ├── map.tsx         # Carte principale
│   │   │   ├── profile.tsx     # Profil (MODIFIÉ: bouton coach + espace coach)
│   │   │   ├── create.tsx      # Créer TagPoint
│   │   │   └── search.tsx      # Recherche
│   │   ├── create-service.tsx  # NOUVEAU: formulaire 4 étapes (packages)
│   │   ├── service/[id].tsx    # Détail service (slots groupés par jour)
│   │   └── edit-service/[id].tsx # Édition service
│   └── components/
│       ├── WeekCalendar.tsx    # Calendrier style Teams (nouveau)
│       ├── LocationPicker.tsx  # Sélection de lieu
│       └── DateTimePicker.tsx  # Sélecteur date/heure
```

## Modèle de données clé

### Services (nouvelle architecture packages)
- **services**: id, title, description, address, price (min), coach_id, domain_id, tag_ids
- **service_packages**: id, service_id, type_id, type_label, duration_min, max_participants, price
- **service_slots**: id, service_id, package_id, slot_type, slot_date, start_time, end_time

### TagPoints
- **tag_points**: id, title, description, location (PostGIS), tag_ids, domain_id, event_date, event_schedule

## Crédentials de test
- Admin: admin@winek.app / WinekAdmin2024!
- Coach: coach@winek.app / WinekCoach2024!
- User: user@winek.app / WinekUser2024!

---

## Fonctionnalités Implémentées

### ✅ Auth & Utilisateurs
- Inscription/connexion JWT
- Google Auth (Emergent-managed) - en cours de stabilisation mobile
- Rôles: user, coach, admin
- Profil éditable avec photo
- Changement de mot de passe
- Système de badges (Elite, Top Joueur, etc.)

### ✅ TagPoints (Points d'activité géolocalisés)
- Création avec géolocalisation, tags, images
- Recherche par rayon géographique (PostGIS)
- Types: ponctuel, récurrent hebdomadaire
- Vote, commentaires, participants, favoris
- Agenda d'événements

### ✅ Services Coach (Nouveau modèle packages - Fév 2026)
- **Formulaire 4 étapes** (`create-service.tsx`):
  - Étape 1: Titre, Description coach, Adresse
  - Étape 2: Types de prestations (multi-select: individuel, petit groupe, grand groupe, stage, online, atelier)
  - Étape 3: Configuration par prestation (prix, durée, max participants, WeekCalendar)
  - Étape 4: Résumé + score de complétion /100
- **WeekCalendar**: calendrier style Microsoft Teams (navigation semaine, clonage jour/semaine)
- **API POST /api/services**: accepte packages + slots imbriqués
- **Bouton coach** visible directement dans le profil (Espace Coach)
- **Carousel d'images** sur la page détail service
- **Vue Doctolib** : créneaux groupés par date en accordéon sur `/service/[id].tsx`
- Score de complétion basé sur 6 critères (100 pts max)

### ✅ Découverte des Services (Fév 2026)
- **Accueil (map.tsx)** : section "Services Coaches" avec cartes orange distinctives, badge "SERVICE", prix "À partir de X€", distance
- **Recherche (search.tsx)** : services et TagPoints mélangés avec badges distincts (SERVICE en orange, TAGPOINT en teal)
- **Données de test persistantes** : 4 services (svc_demo001→004), 8 packages, 32 slots, 4 locations — survivent aux redémarrages DB grâce à ON CONFLICT DO UPDATE dans `seed.py`
- Filtre par tags s'applique aussi aux services

### ✅ Réservations
- Création de réservation sur un slot
- Statuts: pending, confirmed, completed, cancelled

### ✅ Upload d'images
- Images TagPoints et profil

---

## Backlog Prioritaire

### P0 - Critique
- [x] Formulaire création service 4 étapes (packages) - TERMINÉ Fév 2026
- [x] DrumTimePicker plein écran dans WeekCalendar - TERMINÉ Fév 2026
- [ ] Backend instabilité récurrente (connexion PostgreSQL) - MONITORING

### P1 - Important
- [ ] Système réservation V2: acceptation/refus coach
- [ ] Recherche services sur carte (filtres)
- [ ] Intégration Stripe (paiements)
- [ ] Support bilingue i18n (FR/EN)
- [ ] Chat entre coach et client

### P2 - Futur
- [ ] Dashboard administrateur
- [ ] Fix Google Auth sur Expo Go (natif mobile)
- [ ] Fix hot-reload Expo (workaround: supervisorctl restart expo)
- [ ] Amélioration layout boutons d'action [id].tsx

---

## Issues Techniques Connues

### Récurrentes
- **Backend connectivity**: Le backend peut perdre la connexion PostgreSQL au démarrage (IPv6 vs IPv4). Fix: s'assurer que DATABASE_URL utilise 127.0.0.1 et redémarrer avec supervisorctl.
- **Expo hot-reload**: Ne fonctionne pas. Workaround: `sudo supervisorctl restart expo` après chaque changement frontend.

### Résolues
- [x] Tables packages/slots manquantes → ajoutées dans database.py
- [x] Route create_service ne gérait pas les packages → corrigée
- [x] React Native Web warning "Unexpected text node" dans bouton Publier → corrigé
