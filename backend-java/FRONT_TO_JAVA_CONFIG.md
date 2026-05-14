# FRONT_TO_JAVA_CONFIG

Objectif: brancher le front mobile sur `backend-java` en dev/local.

## 1) Variable front principale

Le front lit `EXPO_PUBLIC_BACKEND_URL` (voir `frontend/lib/api.ts`).

Dans `frontend/.env`:

```bash
EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8080
```

Notes appareil:
- iOS simulateur: `http://127.0.0.1:8080` fonctionne generalement.
- Android emulateur: preferer `http://10.0.2.2:8080`.
- Device physique: utiliser IP LAN du Mac, ex `http://192.168.1.20:8080`.

Puis redemarrer Expo (important):

```bash
cd frontend
npx expo start -c
```

## 2) API base URL Java

Le front fait `fetch(${EXPO_PUBLIC_BACKEND_URL}/api...)`.

Donc:
- ne pas mettre `/api` dans `EXPO_PUBLIC_BACKEND_URL`
- exemple correct: `http://127.0.0.1:8080`

## 3) WebSocket URL Java

Le front derive WS depuis la meme variable:
- `http://...` -> `ws://...`
- `https://...` -> `wss://...`

A verifier:
- chat: `/api/ws/chat/{id}`
- notifications: `/api/ws/notifications`
- spotyou: `/api/ws/spot-you/{id}`

## 4) Auth/JWT/Cookies

Le front mobile utilise principalement JWT Bearer:
- token stocke en local (`spotu_token`)
- header `Authorization: Bearer <token>`

Implication:
- `JWT_SECRET` backend doit etre defini au demarrage
- si vous changez `JWT_SECRET`, il faut se deconnecter/reconnecter sur le front

## 5) CORS / origins

Configurer backend Java pour les origines front locales:

```bash
export APP_CORS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:19006,http://localhost:8081"
export APP_WS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:19006,http://localhost:8081"
```

Si device physique ou tunnel:
- ajouter l'origine exacte (ip LAN/ngrok/expo web url).

## 6) Points de verification mobile/simulateur

- L'app charge sans erreurs reseau immediates.
- Login fonctionne et `GET /api/auth/me` repond.
- Les ecrans map/spotyou chargent sans timeout.
- Chat WS se connecte et recoit les messages.
- Upload image retourne une URL utilisable.
- Logout/login invalide l'ancien token proprement.

## 7) Commandes type (front + java)

Backend Java:

```bash
cd backend-java
export SPRING_PROFILES_ACTIVE=local
export JWT_SECRET="dev-jwt-secret-at-least-32-chars-123"
mvn spring-boot:run -Dspring-boot.run.profiles=local
```

Frontend:

```bash
cd frontend
cp env.sample .env # si besoin
# puis editer .env avec EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8080
npx expo start -c
```

