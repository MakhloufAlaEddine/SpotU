# SLICE_26_SCOPE.md — Cadrage de la Slice 26
> Basé sur `tagpoint_routes.py:146–652,1303–1347`.
> Généré le 2026-04-15.

---

## Flow choisi — SpotYou / TagPoints lectures (7 endpoints)

### Cible

Documenter les 7 endpoints de LECTURE SpotYou qui forment le parcours "navigation" complet : du résultat de recherche au détail en passant par les listes personnelles et les similaires.

| # | Méthode | Chemin API | Auth | Complexité | Lignes Python |
|---|---|---|---|---|---|
| 1 | GET | `/api/tag-points` | OPTIONNELLE | ÉLEVÉE (PostGIS + filtres dynamiques) | 146–225 |
| 2 | GET | `/api/tag-points/mine` | STRICTE | ÉLEVÉE (batch queries + next_session) | 228–311 |
| 3 | GET | `/api/tag-points/saved` | STRICTE | MOYENNE (JOIN saves + batch) | 314–387 |
| 4 | GET | `/api/tag-points/{point_id}` | OPTIONNELLE | **TRÈS ÉLEVÉE** (8 queries parallèles) | 389–551 |
| 5 | GET | `/api/tag-points/{point_id}/similar` | OPTIONNELLE | ÉLEVÉE (PostGIS + JSONB tag match) | 554–651 |
| 6 | GET | `/api/tag-points/{point_id}/participants` | AUCUNE (public) | FAIBLE | 1303–1322 |
| 7 | GET | `/api/users/me/pending-requests` | STRICTE | FAIBLE | 1325–1347 |

**+ Helpers partagés** :
- `TP_FIELDS` (projection SQL standard — 26 colonnes + sous-requêtes)
- `build_point_response()` (owner object, address masking, precision offset)
- `apply_precision_offset()` (brouillage coordonnées GPS pour privacy)
- `_first_image()` (JSONB images parsing)

---

## Justification du choix

| Critère | Justification |
|---|---|
| **Navigation post-home** | L'utilisateur clique sur un SpotYou du feed → détail (endpoint 4). C'est le flux le plus fréquent |
| **Détail = le plus complexe** | 8 queries parallèles via asyncio.gather — le pattern le plus avancé du codebase |
| **Search = le plus utilisé** | La recherche géo est la fonctionnalité principale de l'app |
| **Tout en lecture** | Pas de risque transactionnel — entrée en douceur dans le domaine SpotYou |
| **Helpers réutilisés** | `build_point_response`, `TP_FIELDS`, precision offset — utilisés par TOUS les endpoints SpotYou write (S27+) |
| **Pattern asyncio.gather** | Établit le pattern Java `CompletableFuture.allOf()` pour les queries parallèles |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `tagpoint_routes.py` | 1–145 | Helpers, constantes, TP_FIELDS, build_point_response, precision offset |
| `tagpoint_routes.py` | 146–225 | GET /tag-points (search) |
| `tagpoint_routes.py` | 228–311 | GET /tag-points/mine |
| `tagpoint_routes.py` | 314–387 | GET /tag-points/saved |
| `tagpoint_routes.py` | 389–551 | GET /tag-points/{point_id} (détail) |
| `tagpoint_routes.py` | 554–651 | GET /tag-points/{point_id}/similar |
| `tagpoint_routes.py` | 1303–1322 | GET /tag-points/{point_id}/participants |
| `tagpoint_routes.py` | 1325–1347 | GET /users/me/pending-requests |
| `spot_you_routes.py` | `get_next_session_date()` | Calcul CPU prochaine séance (importé par mine/saved/detail) |
| `service_routes.py` | `_mask_address()` | Masquage adresse (importé par build_point_response) |

---

## Dépendances

| Dépendance | Type | Endpoints |
|---|---|---|
| **PostGIS** | Extension DB | search, similar |
| Table `tag_points` | DB | tous |
| Table `users` | DB (JOIN) | tous |
| Table `spot_you_members` | DB | mine, detail, participants, pending-requests |
| Table `spot_you_attendance` | DB | mine, saved, detail |
| Table `tag_point_saves` | DB | saved, detail |
| Table `tag_point_votes` | DB | detail |
| Table `tags` | DB | detail |
| `get_next_session_date()` | spot_you_routes import | mine, saved, detail |
| `_mask_address()` | service_routes import | build_point_response |

---

## Niveau de risque

**ÉLEVÉ.**

| Point | Risque |
|---|---|
| Détail : 8 queries parallèles asyncio.gather | ÉLEVÉ — pattern de concurrence complexe |
| SQL dynamique search (6 filtres conditionnels) | MOYEN — positions $N variables |
| Similar : JSONB `jsonb_typeof` + `jsonb_array_elements_text` | MOYEN — SQL avancé |
| Precision offset avec seed | FAIBLE — calcul CPU pur |
| `get_next_session_date` import cross-module | FAIBLE — logique indépendante |

---

## Résumé ultra court

- **Flow choisi** : 7 endpoints SpotYou lectures (search, mine, saved, detail, similar, participants, pending-requests) + helpers partagés
- **Tables touchées** : `tag_points`, `users`, `spot_you_members`, `spot_you_attendance`, `tag_point_saves`, `tag_point_votes`, `tags` (7 tables, lecture seule)
- **Top 3 pièges** :
  1. **Détail : 8 queries parallèles** via `asyncio.gather` — en Java : `CompletableFuture.allOf()` ou requêtes séquentielles (plus simple mais plus lent)
  2. **Precision offset** : brouillage GPS avec seed déterministe (`random.seed(hash(point_id))`) pour que les coordonnées décalées soient consistantes — reproduire exactement le même hash en Java
  3. **JSONB `tag_ids ?|` operator** : le filtre tags dans search utilise l'opérateur PostgreSQL `?|` (contains any) — syntaxe native, pas JPA standard
- **Raison du choix** : flux post-home-feed le plus fréquent, établit les patterns réutilisés par TOUS les endpoints SpotYou write, le détail est l'endpoint le plus complexe du codebase
