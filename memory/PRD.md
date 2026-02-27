# WINEK — Product Requirements Document

**Dernière mise à jour**: 27 Février 2026 (v3)

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
- **Profil public** : Affichage de la bio, intérêts, téléphone (conditionnel), avis ✅ NOUVEAU (27 Fév 2026)
- **Édition de profil** : Photo, bio, téléphone, intérêts, toggle show_phone/show_reviews ✅ NOUVEAU
- **Système d'avis** : Notation 1-5 étoiles + commentaire sur profil public ✅ NOUVEAU
- **Confidentialité** : Toggle pour afficher/masquer téléphone et autoriser les avis ✅ NOUVEAU

### TagPoints (Core Feature)
- Création en mode wizard multi-étapes (titre, description, domaine, tags, images, localisation, date)
- Édition et suppression
- Contrôle visibilité (public/privé)
- Sauvegarde de tagPoints pour plus tard
- Détail complet avec map, tags, images

### Géolocalisation
- Recherche par localisation avec précision ajustable (exact, 100m, 1km)
- Map avec PostGIS
- Offset de coordonnées selon précision

### Dates & Planification
- Type "Sans date" (permanent)
- Type "Date unique" avec heure de début ET heure de fin (optionnel) ✅ NOUVEAU
- Type "Récurrent" hebdomadaire avec créneaux début/fin par jour ✅ NOUVEAU
- Validation avant de passer à l'aperçu
- Affichage plage horaire "14:00 → 15:30" ✅ NOUVEAU

### Navigation
- Navigation directe vers détail après création/édition
- Gestion correcte de la pile de navigation (pas de doublon)
- useFocusEffect pour rafraîchir après retour

---

## Schema DB Principal

### `users`
| Colonne | Type | Notes |
|---|---|---|
| show_phone | BOOLEAN | **NOUVEAU** Afficher le téléphone sur profil public (défaut: false) |
| show_reviews | BOOLEAN | **NOUVEAU** Autoriser les avis (défaut: true) |

### `tag_points`
| Colonne | Type | Notes |
|---|---|---|
| event_date | TIMESTAMPTZ | Date de début (unique) |
| event_end_date | TIMESTAMPTZ | **NOUVEAU** Heure de fin |
| event_schedule | JSONB | `{type:'weekly', schedule:{dayIdx:[{start:'HH:MM',end:'HH:MM'}]}}` |

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
- ~~Amélioration de profil (show_phone, intérêts, avis)~~ ✅ TERMINÉ (27 Fév 2026)
- ~~Heure de fin d'événement~~ ✅ TERMINÉ (26 Fév 2026)
- Fix Expo hot-reload (CI=true dans le pod K8s)

### P1 — Important
- **Refonte boutons d'action** sur `[id].tsx` (Similar, Share, Save) - insatisfaction utilisateur
- **Flux "Créer un Service"** pour les coachs (`/app/frontend/app/create-service.tsx`)
- **Intégration Stripe** pour les paiements de services

### P2 — Futur
- Support bilingue (i18n Français/Anglais)
- Implémentation du Chat (`/app/frontend/app/(tabs)/chat.tsx`)
- Dashboard Admin
- Correction Google Auth sur Expo Go (natif)

---

## Credentials de Test
- **Email** : `user@winek.app`
- **Password** : `WinekUser2024!`

## Problèmes Connus
- **Expo hot-reload** : Non fonctionnel (CI=true au niveau Kubernetes). Workaround : `sudo supervisorctl restart expo`
- **Google Auth natif** : Cassé sur Expo Go (ON HOLD)
- **FullPreviewModal** : votes et commentaires hardcodés

---

## Fichiers Clés

| Fichier | Description |
|---|---|
| `/app/frontend/app/(tabs)/create.tsx` | Wizard création/édition (complexe, ~1740 lignes) |
| `/app/frontend/app/tag-point/[id].tsx` | Détail tagPoint |
| `/app/backend/routes/tagpoint_routes.py` | Routes tagPoints (CRUD + géospatial) |
| `/app/backend/models.py` | Modèles Pydantic |
| `/app/backend/database.py` | Init DB + migrations |
| `/app/backend/tests/test_event_end_date.py` | Tests backend heure de fin |
