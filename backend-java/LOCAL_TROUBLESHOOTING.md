# LOCAL_TROUBLESHOOTING

Objectif: diagnostiquer rapidement les problemes frequents quand le front mobile pointe sur `backend-java`.

## 1) CORS bloque (HTTP 403/erreur navigateur)

Symptomes:
- requetes front bloquees
- erreurs CORS dans console web

Checks:
- `APP_CORS_ALLOWED_ORIGINS` contient bien l'origine front
- `APP_WS_ALLOWED_ORIGINS` contient bien l'origine WS front

Fix:

```bash
export APP_CORS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:19006,http://localhost:8081"
export APP_WS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:19006,http://localhost:8081"
```

Puis redemarrer backend.

## 2) Erreur demarrage JWT_SECRET

Symptomes:
- backend refuse de demarrer
- messages lies a `JWT_SECRET` / secret JWT vide

Fix:

```bash
export JWT_SECRET="dev-jwt-secret-at-least-32-chars-123"
```

Puis relancer `mvn spring-boot:run`.

## 3) Redis indisponible

Symptomes:
- erreurs connexion Redis
- WS cluster non fonctionnel

Fix rapide dev:
- laisser cluster desactive:

```bash
export APP_WS_CLUSTER_ENABLED=false
export APP_WS_CLUSTER_PROVIDER=noop
```

Ou lancer Redis local:

```bash
docker run --name spotu-redis -p 6379:6379 -d redis:7
```

## 4) Stripe webhook local ne passe pas

Symptomes:
- paiements sandbox sans event webhook recu

Checks:
- `STRIPE_WEBHOOK_SECRET` correspond au `stripe listen`
- URL forward correcte vers backend Java

Commande:

```bash
stripe listen --forward-to http://localhost:8080/api/payments/webhook
```

## 5) PostGIS / geospatial errors

Symptomes:
- erreurs SQL sur fonctions geospatiales (`ST_*`)
- resultats map/spotyou incoherents

Fix:
- verifier que la DB locale est Postgres compatible schema attendu
- si usage geospatial reel necessaire, privilegier instance Postgres avec extension PostGIS active
- verifier migrations Flyway appliquees au bon schema

## 6) R2 probleme (upload/lecture image)

Symptomes:
- upload KO
- URLs media casses

Fix dev:
- utiliser uploads locaux:

```bash
export UPLOADS_DIR="$(pwd)/../backend/uploads"
```

- laisser variables R2 vides si non testees
- verifier acces `/api/uploads/**`

## 7) WebSocket ne connecte pas

Symptomes:
- chat/notif ne se connecte pas
- close rapide apres ouverture

Checks:
- URL backend front correcte (`EXPO_PUBLIC_BACKEND_URL`)
- WS derive bien sur port Java (`8080` par defaut)
- token JWT valide envoye lors handshake
- origin autorisee via `APP_WS_ALLOWED_ORIGINS`

## 8) Front pointe encore Python au lieu de Java

Symptomes:
- comportement/API inattendus
- logs Java silencieux

Checks:
- `frontend/.env` -> `EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8080` (ou variante device)
- Expo redemarre avec cache purge:

```bash
npx expo start -c
```

## 9) Health/readiness KO

Checks:

```bash
curl -s http://localhost:8080/api/liveness
curl -s http://localhost:8080/api/readiness
curl -s http://localhost:8080/actuator/health
```

Interpretation:
- liveness KO: backend non demarre / erreur bootstrap
- readiness KO: probleme DB (ou dependance critique)

## 10) Commande debug rapide (full local)

```bash
cd backend-java
export SPRING_PROFILES_ACTIVE=local
export JWT_SECRET="dev-jwt-secret-at-least-32-chars-123"
export APP_CORS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:19006,http://localhost:8081"
export APP_WS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:19006,http://localhost:8081"
mvn spring-boot:run -Dspring-boot.run.profiles=local
```

