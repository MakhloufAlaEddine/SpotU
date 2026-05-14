# SpotU — backend Java (socle Spring Boot)

Socle technique pour migration progressive depuis `backend/` (Python/FastAPI).  
Référence fonctionnelle cible : `../migration_audit/MIGRATION_INTERFACE_CONTRACT.md`.

## Prérequis

- **JDK 21+** (LTS cible : **21** ; les builds CI peuvent utiliser une version plus récente, ex. Temurin 21 ou 25)
- **Maven 3.9+** (ex. `brew install maven`)
- **PostgreSQL 16** (profil `local`) ou variables d’environnement (profil `dev`)

## Lancer en local

1. Démarrer PostgreSQL (exemple Docker) :

```bash
docker run --name spotu-pg -e POSTGRES_USER=spotu -e POSTGRES_PASSWORD=spotu -e POSTGRES_DB=spotu -p 5432:5432 -d postgres:16
```

2. Compiler et tester :

```bash
cd backend-java
mvn -q test
```

3. Démarrer l’application (profil `local`) :

```bash
mvn spring-boot:run -Dspring-boot.run.profiles=local
```

4. Vérifier les sondes :

- `GET http://localhost:8080/api/liveness`
- `GET http://localhost:8080/api/readiness` (nécessite une DB joignable)
- `GET http://localhost:8080/actuator/health`

## Profils

| Profil | Usage |
|--------|--------|
| `local` | Machine développeur, PostgreSQL local |
| `dev` | Variables `DATABASE_*` obligatoires |
| `prod` | Logs JSON console, niveaux WARN/INFO |
| `test` | H2 en mémoire (activé automatiquement par les tests) |

## Documentation projet

- `MIGRATION_BOOTSTRAP_NOTES.md` — décisions de socle
- `SLICE_01_IMPLEMENTED.md` — `GET /api/config/booking` et `/api/config/commission` (lecture PostgreSQL)
- `MODULES_PLANNED.md` — découpage packages futur
- `KNOWN_GAPS_VS_PYTHON.md` — écarts volontaires / à combler
