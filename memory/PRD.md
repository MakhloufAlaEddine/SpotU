# WINEK / SpotU - Product Requirements Document

## Vue d'ensemble
SpotU (ex-WINEK) est une plateforme hyperlocale de connexion sportive basée sur des tags géolocalisés. Focus initial sur le sport et le coaching. Application mobile (Expo React Native) + Backend (FastAPI + PostgreSQL/PostGIS).

## Stack Technique
- **Frontend**: Expo / React Native (Web + Mobile)
- **Backend**: FastAPI + asyncpg + PostgreSQL + PostGIS
- **Auth**: JWT custom + Google Auth (Emergent-managed)
- **Paiements**: Stripe (planifié)
- **Géocoding**: Google Places API (Autocomplete + Place Details + Geocoding inversé)

## Architecture des fichiers clés
```
/app
├── backend/
│   ├── models.py               # Pydantic models
│   ├── database.py             # DB schema + migrations + seed
│   ├── routes/
│   │   ├── service_routes.py
│   │   ├── auth_routes.py
│   │   ├── user_routes.py
│   │   ├── tagpoint_routes.py
│   │   ├── booking_routes.py
│   │   └── payment_routes.py
│   └── seed.py
├── frontend/
│   ├── assets/
│   │   ├── splash.png          # Logo SpotU complet (texte + icône, fond noir)
│   │   ├── icon.png            # Icône seule (sans texte, fond noir)
│   │   └── adaptive-icon.png   # Icône Android adaptive
│   ├── app/
│   │   ├── _layout.tsx         # Root layout + SplashScreen.preventAutoHideAsync/hideAsync
│   │   ├── index.tsx           # Splash animé JS (logo fade+scale, fond noir)
│   │   ├── (auth)/login.tsx    # Login avec logo SpotU
│   │   ├── (tabs)/
│   │   ├── planning.tsx        # Planning agenda (scroll fixé)
│   │   └── spot-you/[id].tsx
│   └── app.json                # backgroundColor: #000000, splash contain
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
- Google Auth (Emergent-managed)
- Rôles: user, coach, admin
- Profil éditable avec photo

### ✅ EAS Build configuré (Mars 2026)
- `expo-dev-client` installé (remplace Expo Go, inclut le vrai splash screen)
- `eas.json` créé : profils development (APK Android + Simulator iOS), preview, production
- `app.json` : plugin `expo-dev-client` ajouté, prêt pour EAS
- `BUILD_GUIDE.md` : guide complet étapes 1→6 pour lancer le build
- Apple + Google Play : à configurer en fin de développement (rappel mis dans le guide)

### ✅ Planning Screen (Mars 2026)
- Scroll bug fixé: suppression getItemLayout + scrollToOffset calculé manuellement
- Nouvelle approche: scrollToIndex (React Native calcule lui-même les positions)
- onScrollToIndexFailed: fallback avec averageItemLength + retry
- useEffect pour scroll initial vers aujourd'hui

### ✅ TagPoints (Points d'activité géolocalisés)
- Création avec géolocalisation, tags, images
- Recherche par rayon géographique (PostGIS)
- Vote, commentaires, participants, favoris

### ✅ Services Coach
- Formulaire 4 étapes (create-service.tsx)
- WeekCalendar style Teams
- Vue Doctolib créneaux par date

### ✅ Système de Réservation
- Booking, confirmation, succès
- Dashboard coach (accepter/refuser)
- Mes réservations avec statuts

### ✅ Chat WebSocket temps réel
- 3 types: service 1-1, tagpoint_group, tagpoint_private
- Badge non-lus en temps réel

### ✅ Push Notifications (backend prêt, EAS build requis)

---

## Backlog Prioritaire

### P0 - Critique (Audit Sécurité)
- [x] **[SEC-01] JWT Secret hardening** — RuntimeError si absent, secret fort, algo strict — TERMINÉ Mars 2026
- [x] **[SEC-06] SQL Injection** — requêtes paramétrées asyncpg, plus de f-strings avec user_id — TERMINÉ Mars 2026
- [x] **[SEC-07] Auth upload** — `require_auth` sur `POST /api/upload-image` — TERMINÉ Mars 2026
- [x] **[SEC-08] Limite taille upload** — MAX 5 Mo, `file.read(MAX+1)` pour éviter OOM — TERMINÉ Mars 2026
- [x] **[SEC-09] Magic bytes validation** — Content-Type ignoré, détection réelle JPEG/PNG/WebP/GIF — TERMINÉ Mars 2026
- [x] **[SEC-10] Path traversal delete** — `filepath.relative_to()` bloque toute sortie hors UPLOADS_DIR — TERMINÉ Mars 2026
- [x] **[SEC-11] CORS misconfiguration** — `allow_origins=["*"]` + `allow_credentials=True` → remplacé par origines CSV depuis `ALLOWED_ORIGINS` env, `allow_headers` et `allow_methods` explicites — TERMINÉ Mars 2026
- [x] Splash screen + logo SpotU - TERMINÉ Mars 2026
- [x] Fix décalage dates événements récurrents dans Planning - TERMINÉ Mars 2026
- [x] Ajout flag `is_own` + badge "SpotMe" dans Planning - TERMINÉ Mars 2026
- [x] Liste des participants cliquables dans SpotYou detail - TERMINÉ Mars 2026
- [x] Créateur = Organisateur par défaut, peut choisir de quitter - TERMINÉ Mars 2026
- [x] Règles gestion SpotYou : solo=delete/mask, participants=cancel/restore, notifs, planning badges - TERMINÉ Mars 2026
- [x] **Gestion des demandes de réservation sur fiche service** - TERMINÉ Mars 2026
  - Coach : icône toujours visible + modal liste des demandes + boutons Accepter/Refuser inline
  - User : icône visible seulement si demande faite + modal statut de ses demandes
  - Écran booking/[id].tsx : boutons Accepter/Refuser pour coach (pending), pay pour user
  - Backend : POST /api/bookings/{id}/accept + POST /api/bookings/{id}/refuse (avec notifs push)
  - Testé : backend 18/18 + frontend 6/6 (iter_45 + iter_46)
- [x] **Exclusion SpotYou propres dans les écrans de découverte** - TERMINÉ Mars 2026
  - Accueil, Recherche, Similaire : les SpotYou créés par l'utilisateur connecté sont filtrés
  - Seuls accessibles via SpotMe (menu) et écran Mes SpotMe
  - Service utilitaire `frontend/services/googlePlacesService.ts` : searchPlaces, getPlaceDetails, reverseGeocodeGoogle
  - `LocationPicker.tsx` : Autocomplete + geocodage inversé Google
  - `(tabs)/create.tsx` (SpotYou) : geocodage inversé GPS → Google
  - `set-location.tsx` : recherche + géocodage → Google
  - Clé: EXPO_PUBLIC_GOOGLE_PLACES_KEY dans frontend/.env
- [x] **Système de Notifications Temps Réel** - TERMINÉ Mars 2026
  - Backend : table `notifications`, `store_notification()`, `send_push_to_user()` avec `notif_type` correct
  - Types : `new_booking`, `booking_accepted`, `booking_refused`, `spotyu_join`, `spotyu_leave`, `spotyu_vote`, `profile_review`
  - WebSocket `/api/ws/notifications` : compteurs `unread_total` + `unread_notif` en temps réel
  - Endpoints : `GET /api/users/me/notifications`, `PATCH /api/users/me/notifications/{id}/read`, `PATCH /api/users/me/notifications/read-all`
  - Frontend : écran Notifications redesigné (bookings.tsx), badge cloche, marquage lu individuel/global
  - Testé : backend 22/22 (iter_47)

### P1 - Important
- [ ] Intégration Stripe (paiements)
- [ ] Support bilingue i18n (FR/EN)
- [ ] Fix Action Buttons UI sur spot-you/[id].tsx

### P2 - Futur
- [ ] Dashboard administrateur
- [ ] Fix Google Auth Expo Go
- [ ] Push Notifications EAS build
- [ ] Fix hot-reload Expo

---

## Issues Techniques Connues

### Récurrentes
- **Expo hot-reload**: Ne fonctionne pas. Workaround: `sudo supervisorctl restart expo`
- **Backend connectivity**: `sudo service postgresql start && sudo supervisorctl restart backend`

### Résolues
- [x] Planning screen scroll drift (Mars 2026)
- [x] Splash screen fond non-noir (Mars 2026)
- [x] Tables packages/slots manquantes
- [x] Chat WebSocket badge non-lus


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

### ✅ Système de Réservation V1 (Fév 2026)
- **Service detail** : bouton "Réserver" grisé jusqu'à sélection d'un créneau, affiche le slot choisi dans la barre bas
- **Écran de confirmation** (`/booking/confirm`) : récap créneau + prix + message optionnel + note "paiement après validation coach"
- **Écran succès** (`/booking/success`) : avec liens "Voir mes réservations" et "Retour à l'accueil"
- **Dashboard coach** (`/coach/bookings`) : filtre En attente / Tout, Accepter / Refuser en temps réel
- **Mes réservations** (`/(tabs)/bookings`) : liste avec statuts colorés (En attente=orange, Acceptée=vert, Refusée=rouge)
- **Profile coach** : lien "Demandes de réservation" visible dans l'espace coach
- **Paiement** : intentionnellement différé (sans Stripe pour l'instant, payment_status='pending')
- Tested: 18/18 backend + 15/15 frontend (iter_44)
- **Chip localisation dynamique** : utilise `location.address` du contexte au lieu de "Paris, France" hardcodé
- **Recherche triée par distance** : résultats (Services + TagPoints mélangés) triés du plus proche au plus éloigné
- **Badge votes masqué** : flèche "+0" cachée si votes = 0 (HeroCard + RecentRow)
- **Favoris services** : bouton bookmark dans `service/[id].tsx` + onglets TagPoints/Services dans `saved.tsx` + API save/unsave/saved
- **Bug "?" corrigé** : accordéon service/[id].tsx gérait `slot_type='specific'` comme `'single'` → dates lisibles en français
- **Home redesigné** : 3 sections (hero, services compacts, feed récents), header personnalisé avec salutation + localisation
- **Section "Près de vous" supprimée** → moins de bruit visuel, meilleure hiérarchie
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
- [x] Affichage services sur carte (Accueil + Recherche) - TERMINÉ Fév 2026
- [x] Données de test persistantes (4 services + packages + slots) - TERMINÉ Fév 2026
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
- **Backend connectivity**: Le backend peut perdre la connexion PostgreSQL au démarrage. Fix: `sudo service postgresql start && sudo supervisorctl restart backend`
- **Expo hot-reload**: Ne fonctionne pas. Workaround: `sudo supervisorctl restart expo` après chaque changement frontend.

### Résolues
- [x] Tables packages/slots manquantes → ajoutées dans database.py
- [x] Route create_service ne gérait pas les packages → corrigée
- [x] React Native Web warning "Unexpected text node" dans bouton Publier → corrigé
- [x] `api.del` → `api.delete` corrigé dans `tag-point/[id].tsx` (leave, unsave, delete) et `events.tsx` (Fév 2026)
- [x] PostgreSQL auto-start : retry logic ajoutée dans `database.py` (connect_to_db avec 15 tentatives backoff exponentiel) (Fév 2026)
- [x] Bug crash "Text strings must be rendered within a <Text> component" dans `service/[id].tsx` ligne 597 : commentaire JSX et expression sur la même ligne créaient un nœud texte whitespace (Fév 2026)
- [x] Filtrage créneaux passés : les slots avec date+heure passées ne s'affichent plus dans le service detail (Fév 2026)
- [x] Disponibilité des créneaux selon réservations : slot masqué si booking pending/accepted, visible à nouveau si refused (Fév 2026)
- [x] Système de chat WebSocket temps réel : 3 types (service 1-1, tagpoint_group, tagpoint_private), tables DB, routes HTTP + WS, liste conversations, écran chat, boutons dans fiches service et tagpoint (Fév 2026)
- [x] Badge non-lus 100% WebSocket : canal `/ws/notifications` par utilisateur, push en temps réel à chaque message envoyé ET à chaque lecture de conversation, zéro polling (Fév 2026)
- [x] Push Notifications iOS + Android via Expo : table `push_tokens`, enregistrement/suppression token, envoi sur 3 événements : nouveau message chat, nouvelle réservation (coach), réservation acceptée/refusée (utilisateur) (Fév 2026)
