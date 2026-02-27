# WINEK — Product Requirements Document

**Dernière mise à jour**: 27 Février 2026 (v6)

---

## Énoncé du Problème Original

Construire une application mobile **WINEK**, une plateforme hyperlocale de connexion basée sur des tags. La V1 se concentre sur le sport et le coaching, permettant aux utilisateurs de publier et rechercher des activités géolocalisées ("tagPoints"). Fonctionnalité clé : un abonnement payant pour les coachs, avec intégration Stripe.

---

## Architecture Technique

- **Frontend** : React Native (Expo), TypeScript
- **Backend** : FastAPI (Python)
- **Base de données** : PostgreSQL avec PostGIS (géospatial)
- **Auth** : JWT custom + Emergent-managed Google OAuth (natif non-fonctionnel)
- **Paiements** : Stripe (prévu)
- **Reverse Geocoding** : OpenStreetMap Nominatim

---

## Fonctionnalités Implémentées ✅

### Authentication & Utilisateurs
- Connexion email/mot de passe (JWT)
- Inscription
- Profil utilisateur avec ses tagPoints
- Google OAuth (web uniquement, natif ON HOLD)
- **Profil public** : Bio, intérêts, téléphone (conditionnel), avis ✅
- **Édition de profil** : Photo, bio, téléphone, intérêts, toggle show_phone/show_reviews ✅
- **Système d'avis** : Notation 1-5 étoiles + commentaire sur profil public ✅
- **Confidentialité** : Toggle pour afficher/masquer téléphone et autoriser les avis ✅
- **Coordonnées bancaires** : IBAN/BIC/Titulaire pour les futurs paiements ✅
- **Changement de mot de passe** : Section sécurité dans edit-profile ✅

### TagPoints (Core Feature)
- Création en mode wizard multi-étapes (titre, description, domaine, tags, images, localisation, date)
- Édition et suppression
- Contrôle visibilité (public/privé)
- Sauvegarde de tagPoints pour plus tard
- Détail complet avec map, tags, images

### Services Coaches ✅ NOUVEAU (27 Fév 2026)
- **Multi-lieux** : Un service peut avoir plusieurs lieux géolocalisés avec précision (exact/±100m/±1km)
- **Multi-créneaux** : Créneaux récurrents hebdomadaires (lundi 09h-10h, etc.)
- **Stepper 5 étapes** : Interface orange (#FF9500) distincte du tagPoint
  - Étape 1 : Informations (titre, prix, durée, participants max)
  - Étape 2 : Sport & Tags (domaine, tags)
  - Étape 3 : Lieux (carte + précision + description)
  - Étape 4 : Créneaux (récurrents hebdomadaires)
  - Étape 5 : Résumé & Publication
- **Recherche géospatiale** : Trouve un service si AU MOINS UN de ses lieux est dans le rayon
- **Suppression hourly_rate** : Champ "Taux horaire" supprimé du profil et de la DB ✅
- **Écran Détail Service** (`/service/[id].tsx`) ✅ NOUVEAU
  - Hero : titre, prix badge orange, durée, participants, domaine
  - Fiche coach cliquable → profil public
  - Carte multi-lieux avec sélection interactive
  - Tableau créneaux avec prochaine occurrence calculée
  - Modal réservation : sélection lieu + créneau + notes
  - Bouton "Réserver" caché pour le propriétaire du service
  - Bookings sauvegardés avec slot_id et location_id
- **Navigation unifiée** : Service cards dans coach/[id].tsx et user/[id].tsx pointent vers /service/{id}

### Géolocalisation
- Recherche par localisation avec précision ajustable (exact, 100m, 1km)
- Map avec PostGIS
- Offset de coordonnées selon précision

### Dates & Planification
- Type "Sans date" (permanent)
- Type "Date unique" avec heure de début ET heure de fin ✅
- Type "Récurrent" hebdomadaire avec créneaux début/fin par jour ✅
- Validation avant de passer à l'aperçu

---

## Schema DB Principal

### `users`
| Colonne | Type | Notes |
|---|---|---|
| show_phone | BOOLEAN | Afficher le téléphone sur profil public (défaut: false) |
| show_reviews | BOOLEAN | Autoriser les avis (défaut: true) |
| iban | TEXT | Coordonnées bancaires |
| bic | TEXT | Code BIC |
| iban_name | TEXT | Titulaire du compte |
| ~~hourly_rate~~ | - | **SUPPRIMÉ** (27 Fév 2026) |

### `tag_points`
| Colonne | Type | Notes |
|---|---|---|
| event_date | TIMESTAMPTZ | Date de début |
| event_end_date | TIMESTAMPTZ | Heure de fin |
| event_schedule | JSONB | `{type:'weekly', schedule:{dayIdx:[{start:'HH:MM',end:'HH:MM'}]}}` |

### `services`
| Colonne | Type | Notes |
|---|---|---|
| service_id | TEXT PK | |
| coach_id | TEXT FK | Référence users |
| title, description | TEXT | |
| price | NUMERIC | Prix par séance |
| duration_min | INTEGER | Durée en minutes |
| max_participants | INTEGER | |
| tag_ids | JSONB | |
| domain_id | TEXT | |

### `service_locations` ✅ NOUVEAU
| Colonne | Type | Notes |
|---|---|---|
| location_id | TEXT PK | |
| service_id | TEXT FK | Référence services |
| location | GEOMETRY(Point, 4326) | PostGIS |
| precision | TEXT | exact/100m/1000m |
| description | TEXT | Nom du lieu |

### `service_slots` ✅ NOUVEAU
| Colonne | Type | Notes |
|---|---|---|
| slot_id | TEXT PK | |
| service_id | TEXT FK | Référence services |
| day_of_week | INTEGER | 0=Lun … 6=Dim |
| start_time | TEXT | 'HH:MM' |
| end_time | TEXT | 'HH:MM' |

### `reviews`
| Colonne | Type | Notes |
|---|---|---|
| booking_id | TEXT NULL | Nullable - avis directs (sans réservation) supportés |
| reviewer_id | TEXT | Utilisateur qui note |
| reviewee_id | TEXT | Utilisateur noté |
| rating | INTEGER | 1 à 5 |
| comment | TEXT NULL | Optionnel |

---

## Backlog Priorisé

### P0 — Critique
- ~~Amélioration de profil (show_phone, intérêts, avis)~~ ✅ TERMINÉ
- ~~Heure de fin d'événement~~ ✅ TERMINÉ
- ~~Stepper create-service + suppression hourly_rate~~ ✅ TERMINÉ (27 Fév 2026)
- ~~Multi-lieux et multi-créneaux pour services~~ ✅ TERMINÉ (27 Fév 2026)
- Fix Expo hot-reload (CI=true dans le pod K8s)

### P1 — Important
- **Refonte boutons d'action** sur `tag-point/[id].tsx` (Similar, Share, Save) - insatisfaction utilisateur
- **Intégration Stripe** pour les paiements de services
- **Écran détail service** : Afficher lieux et créneaux sur la page `/coach/[id].tsx` ou dédiée
- **Flux de réservation** : Permettre à un utilisateur de réserver un créneau spécifique d'un service

### P2 — Futur
- Support bilingue (i18n Français/Anglais)
- Implémentation du Chat (`/app/frontend/app/(tabs)/chat.tsx`)
- Dashboard Admin
- Correction Google Auth sur Expo Go (natif)
- Affichage des services sur la page d'accueil avec les tagPoints
- Notifications de réservation (push ou email)

---

## Credentials de Test
- **Email** : `user@winek.app`
- **Password** : `WinekUser2024!`
- **Coach** : `coach@winek.app`
- **Password** : `WinekCoach2024!`
- **Admin** : `admin@winek.app`
- **Password** : `WinekAdmin2024!`

## Problèmes Connus
- **Expo hot-reload** : Non fonctionnel (CI=true au niveau Kubernetes). Workaround : `sudo supervisorctl restart expo`
- **Google Auth natif** : Cassé sur Expo Go (ON HOLD)

---

## Fichiers Clés

| Fichier | Description |
|---|---|
| `/app/frontend/app/(tabs)/create.tsx` | Wizard création/édition tagPoint (complexe) |
| `/app/frontend/app/create-service.tsx` | **REÉCRIT** Stepper 5 étapes orange |
| `/app/frontend/app/edit-profile.tsx` | Édition profil (hourly_rate supprimé) |
| `/app/frontend/app/tag-point/[id].tsx` | Détail tagPoint |
| `/app/backend/routes/tagpoint_routes.py` | Routes tagPoints (CRUD + géospatial) |
| `/app/backend/routes/service_routes.py` | **MIS À JOUR** Routes services (multi-lieux, multi-créneaux) |
| `/app/backend/models.py` | Modèles Pydantic (ServiceLocationItem, ServiceSlotItem ajoutés) |
| `/app/backend/database.py` | Init DB + migrations (service_locations, service_slots créées) |
