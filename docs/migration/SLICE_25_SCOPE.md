# SLICE_25_SCOPE.md — Cadrage de la Slice 25
> Basé sur `home_routes.py` (405 lignes).
> Généré le 2026-04-15.

---

## Flow choisi — Home feed complet (2 endpoints)

### Cible

Documenter les 2 endpoints de l'écran d'accueil : le secteur le plus proche (`nearest-sector`) et le fil personnalisé (`feed`) qui combine SpotYou et Services triés par score de pertinence.

| # | Méthode | Chemin API | Auth | Complexité |
|---|---|---|---|---|
| 1 | GET | `/api/home/nearest-sector` | OPTIONNELLE | MOYENNE (PostGIS) |
| 2 | GET | `/api/home/feed` | OPTIONNELLE | **ÉLEVÉE** (PostGIS + scoring + auto-expansion + 2 domaines) |

---

## Justification du choix

| Critère | Justification |
|---|---|
| **Écran d'accueil** | Première chose que l'utilisateur voit après login — P0 absolu |
| **Force PostGIS** | Les 2 endpoints utilisent `ST_DWithin`, `ST_Distance`, `ST_MakePoint` — l'implémenter ici débloque SpotYou list (S27) et Services list (S09 lu mais géo manquant) |
| **Auth optionnelle** | Nouveau pattern `get_optional_auth` — enrichit le feed si connecté, fonctionne aussi en anonyme |
| **Mix SpotYou + Services** | Le seul endpoint qui combine les 2 domaines — définit le pattern de requête pour les deux |
| **Scoring algorithm** | Algorithme de pertinence (tags communs + popularité + distance + bonus membre) — logique métier centrale |

### Pourquoi MAINTENANT ?

| Critère | Valeur |
|---|---|
| Bloc 1 terminé | User peut s'inscrire et configurer son profil (S23–S24) |
| Prochain blocker P0 | FINAL_FRONT_BLOCKERS.md classe home feed comme blocker #6 |
| PostGIS pré-requis | SpotYou (S27–S31) et Services (S32) dépendent de PostGIS — l'implémenter ici plutôt que dans chaque slice |
| Complexité justifie une slice | 405 lignes, scoring, auto-expansion, 2 requêtes PostGIS — pas combinable avec d'autres endpoints |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `home_routes.py` | 30–97 | `GET /home/nearest-sector` |
| `home_routes.py` | 100–147 | Helpers : `_parse_tags`, `_score_spot`, `_score_service` |
| `home_routes.py` | 152–404 | `GET /home/feed` (feed principal) |
| `auth_utils.py` | 61–65, 86–100 | `get_token_from_request`, `get_optional_auth` (auth optionnelle) |

---

## Dépendances

| Dépendance | Type | Rôle |
|---|---|---|
| **PostGIS** | Extension PostgreSQL | `ST_DWithin`, `ST_Distance`, `ST_MakePoint`, `ST_SetSRID`, `ST_X`, `ST_Y` |
| Table `tag_points` | DB (SELECT) | SpotYou — `location` (geography), `active`, `tag_ids`, etc. |
| Table `services` + `service_locations` | DB (SELECT) | Services — localisation via `service_locations.location` |
| Table `users` | DB (SELECT JOIN) | Noms/photos des owners/coaches |
| Table `spot_you_members` | DB (SELECT) | Membership pour scoring + bonus |
| Table `spot_you_attendance` | DB (SELECT) | going_count + is_going batch |
| Table `bookings` | DB (SELECT COUNT) | booking_count pour scoring services |
| `get_token_from_request` + `decode_jwt` | S23 infra | Auth optionnelle (pas require_auth) |

---

## Scope explicite

### INCLUS (Slice 25)

- 2 endpoints home
- 3 helpers scoring/parsing
- Pattern auth optionnelle
- PostGIS setup documentation
- Auto-expansion du rayon

### EXCLU

| Composant | Raison |
|---|---|
| GET /tag-points (liste) | S27 — endpoint dédié avec filtres avancés |
| GET /services (liste) | S09 lu — S32 pour le CRUD |
| User search / suggestions | S25+ |

---

## Niveau de risque

**ÉLEVÉ.**

| Point | Risque | Détail |
|---|---|---|
| PostGIS obligatoire | ÉLEVÉ | Extension à installer. Sans PostGIS, RIEN ne fonctionne |
| Requête SQL complexe dynamique | ÉLEVÉ | 50+ lignes de SQL avec conditions dynamiques + paramètres indexés |
| Auto-expansion rayon (boucle) | MOYEN | 4 itérations potentielles — chacune avec 2 requêtes (spots + services) |
| Scoring en application | FAIBLE | Calcul pur en Python/Java — pas de dépendance externe |
| Auth optionnelle | FAIBLE | Pattern simple (try/catch, null si échoue) |

---

## Résumé ultra court

- **Flow choisi** : Home feed — 2 endpoints (`nearest-sector` + `feed`), écran d'accueil de l'app
- **Tables touchées** : `tag_points` (PostGIS SELECT), `services` + `service_locations` (PostGIS SELECT), `users` (JOIN), `spot_you_members` (membership), `spot_you_attendance` (going), `bookings` (count)
- **Top 3 pièges** :
  1. **PostGIS OBLIGATOIRE** : `ST_DWithin`, `ST_Distance`, `ST_MakePoint` — sans l'extension, zéro résultat. En Java : JPA native queries avec PostGIS functions
  2. **Auto-expansion rayon** : boucle 50→100→200→500 km si < 3 résultats — les 2 requêtes (spots + services) sont re-exécutées à chaque itération
  3. **SQL dynamique avec paramètres indexés** : les positions `$N` changent selon la présence de `current_user_id` et `lat/lng` — reconstruction SQL à chaque appel
- **Raison du choix** : écran d'accueil P0, force PostGIS (pré-requis de S27–S32), seul endpoint combinant SpotYou + Services
