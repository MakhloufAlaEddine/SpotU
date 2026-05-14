# MIGRATION_BOOTSTRAP_NOTES.md

## Objectif de cette étape

Fournir un **socle Spring Boot 3.5 / Java 21** compilable, avec infra minimale (DB, Flyway, Actuator, erreurs, sécurité ouverte), puis **slice 01** (config publique) et **slice 02** (`GET /api/auth/me`, JWT HS256 + lecture `users`).

## Décisions techniques

| Sujet | Choix | Certitude |
|-------|--------|-----------|
| Parent Maven | `spring-boot-starter-parent` **3.5.0** | certain (POM) |
| API HTTP port | `8080` par défaut (Python historique souvent `8000` — **écart** documenté dans `KNOWN_GAPS_VS_PYTHON.md`) | recommandé |
| Préfixe routes infra | `/api/...` aligné sur `MIGRATION_INTERFACE_CONTRACT.md` | certain |
| Sécurité | `permitAll()` global ; **slice 02** : auth JWT **dans le service** pour `/api/auth/me` uniquement (pas de filtre global encore) | recommandé par slice |
| JWT | Variable **`JWT_SECRET`** (identique Python) → `app.jwt.secret` dans `application.yml` ; absence → échec au démarrage du bean `JwtService` (comme `RuntimeError` Python au chargement) | certain |
| Config booking / commission | **Slice 01** : lecture réelle `app_config` / `pricing_rules` (voir `SLICE_01_IMPLEMENTED.md`) | certain |
| Readiness `/api/readiness` | `SELECT 1` + `Connection.isValid` — analogue fonctionnel au Python | déduit |
| Flyway | `V1` marqueur + `V2` tables config/commission sur PostgreSQL | certain |
| Tests (`test`) | Flyway **désactivé** ; schéma + données via `spring.sql.init` (scripts `test-*.sql`) | certain |
| Logs structurés | `logstash-logback-encoder` activé pour le profil **`prod`** uniquement | certain (`logback-spring.xml`) |

## Hors périmètre (volontairement)

- Autres endpoints métier (`POST /api/auth/login`, `/bookings`, Stripe, WebSocket métier, etc.) — hors slice 02
- Workers / `@Scheduled`
- `ResourceHandler` pour `/api/uploads/**` (noté pour slice ultérieure)
- Parité stricte des codes d’erreur sur toutes les routes (exception documentée pour erreurs SQL sur `/api/config/*`)

## Prochaine slice suggérée

1. Factoriser **JWT** (filtre `OncePerRequestFilter` + `SecurityContext`) pour réutiliser `require_auth` sur d’autres routes sans dupliquer la logique.
2. **Login / register** (bcrypt, émission JWT) — slice auth écriture.
3. Brancher **readiness** sur les mêmes checks que l’infra cible (Redis, etc.) si applicable.
