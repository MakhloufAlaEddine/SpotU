# Slice 02 — `GET /api/auth/me` (Java)

## Réalisé

- **Endpoint** : `GET /api/auth/me` aligné sur `auth_routes.py` + `require_auth` / `get_token_from_request` / `decode_jwt` (`auth_utils.py`).
- **Lecture du token** : header `Authorization` avec préfixe exact `Bearer ` (sensible à la casse), sinon cookie `winek_token`.
- **JWT** : HS256, secret `JWT_SECRET` → `app.jwt.secret` (même variable d’environnement que Python). Claims requis équivalents à PyJWT `require: ["exp", "user_id"]` (contrôle explicite de `exp` et `user_id` après parsing).
- **Erreurs 401** : corps `{"detail":"..."}` — `Not authenticated`, `Invalid token`, `Token expired`, `Invalid token algorithm`, `User not found`.
- **Cas `Bearer` + token vide** : comme Python, `if not token` avant décodage → **`Not authenticated`** (et non « Invalid token »).
- **Persistance** : `SELECT` des 18 colonnes `USER_FIELDS` sur `users` par `user_id`, sans filtre `deleted_at` / `banned_until`.
- **Réponse** : DTO `CurrentUserDto` avec stratégie Jackson snake_case ; timestamps UTC formatés comme `datetime.isoformat()` Python (`+00:00`, pas `Z`).
- **Tests d’intégration** : `AuthMeIntegrationTest` + données H2 `test-schema-users.sql` / `test-data-users.sql`.

## Écarts / incertitudes vs Python ou vs doc Emergent

| Sujet | Détail |
|-------|--------|
| **TC-ME-12 (doc Emergent)** | Le cadrage indiquait parfois `Invalid token` pour `Authorization: Bearer ` vide ; le **code Python** renvoie **`Not authenticated`** (`not token` sur chaîne vide). Java suit le **Python**. |
| **Erreur DB sur `/api/auth/me`** | FastAPI peut remonter une 500 implicite ; le handler global Java mappe toujours `DataAccessException` → **503** (identique slice 01). Voir `KNOWN_GAPS_VS_PYTHON.md`. |
| **JSONB PostgreSQL** | Les tests utilisent des colonnes texte JSON côté H2 ; en prod le driver JDBC renvoie en général une représentation textuelle exploitable par `getString` — à surveiller si un type driver exigeait un mapping `PGobject`. |

## Fichiers principaux

- `modules/auth/api/AuthController.java`
- `modules/auth/service/AuthMeService.java`, `JwtService.java`, `TokenExtractor.java`
- `modules/auth/infra/UserMeRepository.java`
- `modules/auth/dto/CurrentUserDto.java`, `modules/auth/support/PythonIsoTimestamps.java`
- `error/ApiAuthException.java` + handler dans `GlobalExceptionHandler.java`
- Dépendances : `io.jsonwebtoken:jjwt-*` (0.12.6)

## Blocages

- Aucun : `mvn test` vert sur le périmètre actuel.
