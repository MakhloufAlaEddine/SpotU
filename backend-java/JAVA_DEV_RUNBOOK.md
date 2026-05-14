# JAVA_DEV_RUNBOOK

Objectif: lancer `backend-java` en local/dev pour connecter le front mobile au backend Java (sans prod/preprod, sans cutover).

## 1) Prerequis

- Java 21+ (`java -version`)
- Maven 3.9+ (`mvn -version`)
- PostgreSQL (local Docker/natif) ou Supabase
- Redis local (optionnel mais recommande pour WS cluster dev)
- Stripe CLI (optionnel, pour webhooks sandbox)

## 2) Profils Spring a utiliser

- `local` (recommande machine dev): DB locale par defaut (`jdbc:postgresql://localhost:5432/spotu`, user/pwd `spotu`)
- `dev` (si DB/creds via variables d'env)
- `test` reserve aux tests automatises
- Ne pas utiliser `prod` pour ce runbook

Commande:

```bash
cd backend-java
mvn spring-boot:run -Dspring-boot.run.profiles=local
```

## 3) Variables d'environnement utiles (dev/local)

Minimum pour demarrer proprement:

```bash
export SPRING_PROFILES_ACTIVE=local
export JWT_SECRET="dev-jwt-secret-at-least-32-chars-123"
```

Variables frequentes:

```bash
export SERVER_PORT=8080
export APP_CORS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:19006,http://localhost:8081"
export APP_WS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:19006,http://localhost:8081"
export REDIS_HOST=localhost
export REDIS_PORT=6379
export APP_WS_CLUSTER_ENABLED=false
export APP_WS_CLUSTER_PROVIDER=noop
```

## 4) Base de donnees: Postgres local ou Supabase

### Option A - Postgres local (recommande)

```bash
docker run --name spotu-pg \
  -e POSTGRES_USER=spotu \
  -e POSTGRES_PASSWORD=spotu \
  -e POSTGRES_DB=spotu \
  -p 5432:5432 -d postgres:16
```

Avec profil `local`, aucune variable DB supplementaire n'est necessaire.

### Option B - Supabase (profil `dev` ou override)

```bash
export SPRING_PROFILES_ACTIVE=dev
export DATABASE_URL="jdbc:postgresql://<host>:5432/postgres"
export DATABASE_USER="<user>"
export DATABASE_PASSWORD="<password>"
```

Note: les flows geospatiaux SpotYou sont plus fiables avec Postgres + PostGIS reel.

## 5) Redis (dev)

Pour dev simple (single-instance WS), `APP_WS_CLUSTER_ENABLED=false` suffit.

Si vous voulez tester WS multi-instance en local:

```bash
docker run --name spotu-redis -p 6379:6379 -d redis:7
export APP_WS_CLUSTER_ENABLED=true
export APP_WS_CLUSTER_PROVIDER=redis
export APP_WS_CLUSTER_INSTANCE_ID=spotu-dev-node-1
```

## 6) Uploads: local vs R2

### Local uploads (recommande dev)

```bash
export UPLOADS_DIR="$(pwd)/../backend/uploads"
```

Le backend expose les fichiers via `/api/uploads/**`.

### R2 (optionnel en dev)

```bash
export R2_ACCESS_KEY_ID="..."
export R2_SECRET_ACCESS_KEY="..."
export R2_ENDPOINT="https://<account>.r2.cloudflarestorage.com"
export R2_BUCKET_NAME="..."
export R2_PUBLIC_URL="https://<public-domain>"
```

## 7) Stripe sandbox (dev)

```bash
export STRIPE_API_KEY="sk_test_..."
export STRIPE_WEBHOOK_SECRET="whsec_..."
```

Ecoute webhooks en local (optionnel):

```bash
stripe listen --forward-to http://localhost:8080/api/payments/webhook
```

Recuperer le `whsec_...` affiche par Stripe CLI et le mettre dans `STRIPE_WEBHOOK_SECRET`.

## 8) Expo push dev

```bash
export EXPO_PUSH_ENABLED=true
# Optionnel:
export EXPO_PUSH_ENDPOINT="https://exp.host/--/api/v2/push/send"
```

Pour des tests locaux sans push externe:

```bash
export EXPO_PUSH_ENABLED=false
```

## 9) WebSocket (chat/notif/spotyou)

Endpoints backend Java:
- `ws://<host>:8080/api/ws/chat/{conversationId}`
- `ws://<host>:8080/api/ws/notifications`
- `ws://<host>:8080/api/ws/spot-you/{pointId}`

Le front derive WS a partir de `EXPO_PUBLIC_BACKEND_URL` (`http` -> `ws`, `https` -> `wss`).

## 10) Lancement complet recommande (dev local)

Terminal 1 - Postgres:

```bash
docker start spotu-pg || docker run --name spotu-pg -e POSTGRES_USER=spotu -e POSTGRES_PASSWORD=spotu -e POSTGRES_DB=spotu -p 5432:5432 -d postgres:16
```

Terminal 2 - Redis (optionnel):

```bash
docker start spotu-redis || docker run --name spotu-redis -p 6379:6379 -d redis:7
```

Terminal 3 - Backend Java:

```bash
cd backend-java
export SPRING_PROFILES_ACTIVE=local
export JWT_SECRET="dev-jwt-secret-at-least-32-chars-123"
export APP_CORS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:19006,http://localhost:8081"
export APP_WS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:19006,http://localhost:8081"
mvn spring-boot:run -Dspring-boot.run.profiles=local
```

Checks rapides:

```bash
curl -s http://localhost:8080/api/liveness
curl -s http://localhost:8080/api/readiness
curl -s http://localhost:8080/actuator/health
```

