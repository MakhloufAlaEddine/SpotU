# Slice 23 — Auth canonique

Implémenté le **2026-04-15** pour rendre le bloc auth front-ready côté Java, aligné sur `auth_routes.py` / `auth_utils.py`.

## Endpoints couverts

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/google`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `PUT /api/auth/change-password`
- `GET /api/auth/native-callback` (aligné Python)

## Composants auth créés/modifiés

- `modules/auth/service/AuthService` : register/login/google/logout/change-password.
- `modules/auth/service/JwtService` : encode + decode payload (`user_id`, `role`, `exp`).
- `modules/auth/service/JwtAuthFilter` : extraction best-effort et payload en attribut requête.
- `modules/auth/service/AuthRateLimiter` : limites auth (`5/min` register/login, `10/min` google).
- `modules/auth/service/EmergentOAuthClient` : appel HTTP vers Emergent OAuth.
- `modules/auth/service/AuthMeService` : `requireCurrentUser` + `requireAdmin`.
- `modules/auth/infra/UserMeRepository` : projection `USER_FIELDS` + credentials + inserts/updates auth.
- `modules/auth/api/AuthController` : 7 routes auth.
- `config/SecurityConfig` : branchement conditionnel du `JwtAuthFilter` sans casser les tests `@WebMvcTest`.
- `error/ApiTooManyRequestsException` + handler 429 dans `GlobalExceptionHandler`.

## Tables touchées

- `users` uniquement (SELECT/INSERT/UPDATE pour auth).
- Schéma de test H2 mis à jour avec `users.password_hash`.

## Points de fidélité Python respectés

- Email normalisé en lowercase (`register`, `login`, `google`).
- `login` anti-enumeration : `401 "Invalid credentials"` pour email inconnu **et** mauvais mot de passe.
- `verify_password("x", "")` reproduit : `false`, jamais d’exception.
- JWT claims : `user_id`, `role`, `exp` ; expiration 7 jours ; secret partagé `JWT_SECRET`.
- Extraction token : header `Authorization: Bearer` prioritaire, fallback cookie `winek_token`.
- Google OAuth via session Emergent (`X-Session-ID`), pas de `id_token` Google standard.
- `logout` ne fait pas d’invalidation serveur, répond `{ "success": true }`.
- `change-password` : erreur `401 "Mot de passe actuel incorrect"` si hash absent/faux (incluant users Google sans password).

## Tests

- Nouveau : `AuthIntegrationTest` (register nominal/duplicate, login mauvais mdp, `/me` token invalide, google nominal+erreur, change-password + relogin).
- Suite complète `mvn test` verte après intégration.

## Écarts assumés vs Python

- Validation `register` / `change-password` : Python renvoie typiquement **422 Pydantic**, Java renvoie **400** via exceptions métier (documenté dans `KNOWN_GAPS_VS_PYTHON.md`).
- Rate limiting : implémentation Java en mémoire (équivalent fonctionnel), pas SlowAPI.

## Hors périmètre restant (Bloc 1)

- Uniformisation globale des erreurs de validation au format Pydantic 422 pour toutes les routes.
- Durcissement éventuel `SecurityFilterChain` (actuellement `permitAll()` et auth vérifiée au niveau service, comme les slices précédentes).
