# SLICE_23_SCOPE.md — Cadrage de la Slice 23
> Basé sur `auth_routes.py` (119 lignes), `auth_utils.py` (133 lignes), `models.py:60–88`.
> Généré le 2026-04-13.

---

## Flow choisi — Auth complet (6 endpoints + infrastructure JWT/bcrypt)

### Cible

Documenter le module d'authentification **intégral** : les 6 endpoints HTTP + l'infrastructure partagée (JWT, bcrypt, token extraction, rate limiting). Sans ce module, aucun endpoint protégé (98% de l'API) ne fonctionne.

| # | Méthode | Chemin API | Auth | Rate Limit | Complexité |
|---|---|---|---|---|---|
| 1 | POST | `/api/auth/register` | AUCUNE | 5/min | FAIBLE |
| 2 | POST | `/api/auth/login` | AUCUNE | 5/min | FAIBLE |
| 3 | POST | `/api/auth/google` | AUCUNE | 10/min | MOYENNE (externe) |
| 4 | GET | `/api/auth/me` | STRICTE | — | FAIBLE (S02 déjà documenté) |
| 5 | POST | `/api/auth/logout` | STRICTE | — | TRIVIALE |
| 6 | PUT | `/api/auth/change-password` | STRICTE | — | FAIBLE |

**+ Infrastructure partagée** (utilisée par TOUS les endpoints protégés des S01–S22) :

| Composant | Fichier | Rôle |
|---|---|---|
| `hash_password()` | `auth_utils.py:21` | bcrypt hash |
| `verify_password()` | `auth_utils.py:25` | bcrypt verify |
| `create_jwt()` | `auth_utils.py:32` | JWT HS256 encode (expiry 7 jours) |
| `decode_jwt()` | `auth_utils.py:41` | JWT decode + validation |
| `get_token_from_request()` | `auth_utils.py:61` | Header Bearer OU cookie winek_token |
| `require_auth()` | `auth_utils.py:71` | Middleware auth (déjà référencé dans toutes les slices) |
| `require_role()` | `auth_utils.py:103` | Admin check |
| `get_optional_auth()` | `auth_utils.py:86` | Auth optionnelle (certains GET publics) |
| `fetch_emergent_session()` | `auth_utils.py:110` | Google OAuth via Emergent |
| `USER_FIELDS` | `auth_utils.py:68` | Projection SQL standardisée (18 champs) |

---

## Justification du choix

### Pourquoi tout l'auth et pas juste register/login ?

| Critère | Justification |
|---|---|
| **Module compact** | 119 lignes d'endpoints + 133 lignes d'utils = 252 lignes total |
| **Tout est interdépendant** | JWT, bcrypt, token extraction — les 6 endpoints et l'infra forment un tout |
| **Sans auth = app morte** | Aucun des ~140 endpoints restants ne fonctionne sans `require_auth` |
| **Infrastructure critique** | `require_auth()`, `create_jwt()`, `decode_jwt()` sont appelés par TOUTES les slices S02–S22 |
| **Fragmenter = gaspillage** | Documenter register seul sans l'infra JWT serait incomplet |

### Pourquoi MAINTENANT ?

| Critère | Valeur |
|---|---|
| Blocker #1 identifié | FINAL_FRONT_BLOCKERS.md classe auth comme blocker P0 absolu |
| Pré-requis de tout | L'infra JWT est le socle de tout le backend Java |
| Bloc 1 step 1 | FINAL_RECOMMENDED_ORDER.md : S23 = auth |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `auth_routes.py` | 1–119 | 6 endpoints |
| `auth_utils.py` | 1–133 | Infrastructure JWT, bcrypt, auth middleware, Google OAuth |
| `models.py` | 60–88 | DTOs Pydantic (UserCreate, UserLogin, GoogleAuthRequest, PasswordChange) |
| `limiter.py` | — | Rate limiter (SlowAPI) |
| `migrations/001_initial_schema.sql` | 570–598 | Table `users` (28 colonnes) |

---

## Dépendances

| Dépendance | Type | Rôle |
|---|---|---|
| `JWT_SECRET` | Env var | Clé secrète HS256 — **OBLIGATOIRE** (RuntimeError si absent) |
| `bcrypt` | Librairie | Hash/verify passwords |
| `PyJWT` (jwt) | Librairie | Encode/decode JWT |
| `httpx` | Librairie | Appel HTTP vers Emergent OAuth |
| Emergent OAuth API | Service externe | `https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data` |
| Table `users` | DB | INSERT (register, google), SELECT (login, me, auth), UPDATE (google, change-password) |
| `SlowAPI` | Librairie | Rate limiting (5/min register+login, 10/min google) |

---

## Scope explicite

### INCLUS (Slice 23)

- 6 endpoints auth
- 10 fonctions infrastructure auth_utils.py
- 4 modèles Pydantic (DTOs)
- Rate limiting config
- `USER_FIELDS` projection standard

### EXCLU

| Composant | Raison |
|---|---|
| `PUT /users/profile` | User write — S24 |
| `POST /users/become-coach` | User write — S24 |
| `GET /auth/me` détail | S02 déjà documenté pour la RÉPONSE, S23 documente l'INFRA |

---

## Niveau de risque

**MOYEN.**

| Point | Risque | Détail |
|---|---|---|
| JWT_SECRET partage Python/Java | MOYEN | MÊME secret obligatoire pour que les tokens émis par Python soient valides en Java (et vice versa) |
| bcrypt compatibilité | FAIBLE | BCrypt est standardisé — Java `BCryptPasswordEncoder` lit les hashes Python |
| Google OAuth via Emergent | MOYEN | Service externe propriétaire — l'API endpoint et le header `X-Session-ID` doivent être reproduits exactement |
| Rate limiting | FAIBLE | SlowAPI (Python) → Spring intercepteur ou bucket4j (Java) |
| Cookie `winek_token` | FAIBLE | Le front envoie le token en cookie ET en header — les deux doivent être supportés |

---

## Résumé ultra court

- **Flow choisi** : Auth complet — 6 endpoints + infrastructure JWT/bcrypt/OAuth (module intégral 252 lignes)
- **Tables touchées** : `users` (INSERT register/google, SELECT login/me/auth, UPDATE google/change-password)
- **Top 3 pièges** :
  1. **JWT_SECRET IDENTIQUE** : Python et Java DOIVENT partager le même secret sinon les tokens deviennent invalides au cutover
  2. **Emergent Google OAuth** : appel HTTP externe vers `demobackend.emergentagent.com` avec header `X-Session-ID` — protocole propriétaire, pas un OAuth standard
  3. **Dual token extraction** : le même token est envoyé en `Authorization: Bearer xxx` ET en cookie `winek_token` — les deux sources doivent être supportées
- **Raison du choix** : pré-requis absolu de toute l'API — sans auth Java, aucun cutover possible
