# SpotU — App installée sur téléphone (preview)

App **autonome** : pas d’Expo Go, pas de Metro. L’API pointe vers Hetzner (`EXPO_PUBLIC_BACKEND_URL` dans `eas.json`).

Le dev quotidien avec Cursor reste inchangé : `npx expo run:ios` ou `npx expo start` (profil **development**, dev client).

---

## Prérequis (une fois)

```bash
cd frontend
npm install
npx eas login            # compte expo.dev (aladinmakhlouf)
```

`eas` n’est pas installé globalement sur ta machine : utilise **`npx eas`** ou les scripts npm (`npm run build:preview:android`, etc.) qui passent par le `eas-cli` du projet.

Apple : compte **Apple Developer** actif.  
Android : aucun compte Play requis pour installer un APK.

---

## Android — APK sur téléphone

### 1. Lancer le build

```bash
cd frontend
npm run build:preview:android
# ou : eas build --platform android --profile preview
```

Durée ~10–20 min. À la fin, EAS affiche un **lien de téléchargement .apk**.

### 2. Installer

1. Ouvre le lien sur le téléphone (ou transfère le fichier).
2. Autorise **Sources inconnues** / installation d’apps inconnues si Android le demande.
3. Installe **SpotU**.

### 3. Utiliser

- Ouvre l’app : elle démarre directement (splash SpotU), **sans** écran « Enter URL ».
- Connexion / API → `http://178.105.95.184:8080` (déjà dans le build).
- 4G ou Wi‑Fi : le téléphone doit joindre l’IP Hetzner (pas besoin du Mac).

### 4. Mettre à jour le JS sans réinstaller l’APK (optionnel)

Après des changements **uniquement JavaScript/TypeScript** :

```bash
npm run update:preview
```

Puis rouvre l’app (parfois deux lancements).  
Si tu changes du natif (`app.json`, nouvelle lib Expo, permissions) → refais un build APK.

---

## iOS — iPhone physique

Deux chemins possibles.

### Option A — Ad hoc (rapide, jusqu’à 100 appareils / an)

#### 1. Enregistrer l’iPhone (une fois par appareil)

```bash
cd frontend
npm run device:register
# ou : eas device:create
```

Suis les instructions (site Apple / QR) pour enregistrer l’**UDID** de ton iPhone.

#### 2. Build

```bash
npm run build:preview:ios
# ou : eas build --platform ios --profile preview
```

La première fois, EAS peut demander de créer les **certificats / profils** iOS : accepte (compte Apple Developer).

#### 3. Installer

1. Ouvre le lien du build sur l’iPhone (page expo.dev → Install).
2. Réglages → Général → **Gestion de VPN et appareils** → fais confiance au développeur si besoin.
3. L’icône **SpotU** reste installée comme une app normale.

#### 4. Utiliser

Même comportement qu’Android : app autonome, API Hetzner, pas de Metro.

---

### Option B — TestFlight (recommandé pour plusieurs testeurs)

#### 1. App Store Connect

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **My Apps** → **+** → nouvelle app iOS.
2. Bundle ID iOS : `com.winek.mobile` (Android reste `com.winek.app`).
3. Note l’**Apple ID de l’app** (nombre, ex. `1234567890`).

#### 2. Configurer `eas.json`

Remplace dans `submit.preview-testflight.ios.ascAppId` :

```json
"ascAppId": "TON_APP_STORE_CONNECT_APP_ID"
```

#### 3. Build + envoi TestFlight

```bash
cd frontend
eas build --platform ios --profile preview-testflight
eas submit --platform ios --profile preview-testflight --latest
```

#### 4. Testeurs

App Store Connect → TestFlight → ajoute des testeurs internes → ils installent via l’app **TestFlight**.

---

## Changer l’URL de l’API

1. Modifie `EXPO_PUBLIC_BACKEND_URL` dans `eas.json` (profils `preview` / `development`).
2. Refais un build (`npm run build:preview:android` / `ios`) **ou** `npm run update:preview` si seul le JS change.

Le fichier `.env` local sert **uniquement** à Metro / `expo run:*`, pas aux builds EAS cloud.

---

## Récap des profils EAS

| Profil | Usage | Expo Go | Metro | Téléphone |
|--------|--------|---------|-------|-----------|
| `development` | Dev Cursor, simulateur | Non (dev client) | Oui | Simulateur / dev client + URL |
| `preview` | APK + iOS ad hoc | Non | Non | **Oui, autonome** |
| `preview-testflight` | TestFlight | Non | Non | **Oui, via TestFlight** |
| `production` | Stores | Non | Non | Stores |

---

## Dépannage

| Problème | Piste |
|----------|--------|
| Écran « Enter URL » sur preview | Tu as installé un **dev client** ; refais un build profil **preview** (pas `development`). |
| Splash puis fermeture immédiate | Désinstalle l’ancienne app, refais `npm run build:preview:android`. Logs (zsh : **guillemets** autour de `*:E`) : `adb logcat '*:E' \| grep -iE 'AndroidRuntime\|FATAL\|ReactNative\|expo'` ou `adb logcat -d \| tail -200`. |
| API inaccessible sur mobile | Vérifie `curl http://178.105.95.184:8080/api/liveness` depuis le téléphone (Safari). |
| iOS « Untrusted Developer » | Réglages → Général → Gestion des appareils → Trust. |
| Android bloque l’APK | Autoriser installation apps inconnues pour Chrome / Fichiers. |
| Build iOS échoue (credentials) | `eas credentials` puis rebuild. |
| **Push Android ne marchent pas** (iOS OK) | Voir section **Push Android (FCM)** ci-dessous. |

---

## Push Android (FCM)

Sur Android, Expo passe par **Firebase Cloud Messaging (FCM)**. iOS utilise APNs (déjà configuré si les push iPhone marchent). **Les deux sont indépendants.**

### 1. Credentials FCM dans EAS (obligatoire)

```bash
cd frontend
npx eas credentials -p android
# Profil : preview
# Google Service Account → FCM V1 → Upload le JSON *firebase-adminsdk*.json
```

Guide Expo : [FCM credentials](https://docs.expo.dev/push-notifications/fcm-credentials/)

Sans cette clé, Expo **ne peut pas envoyer** les push depuis le serveur.

### 1b. `google-services.json` dans l’app (obligatoire pour l’arrière-plan)

La clé EAS FCM V1 sert à **envoyer**. L’APK a aussi besoin du fichier **`google-services.json`** pour **recevoir** en arrière-plan.

1. [Firebase Console](https://console.firebase.google.com/) → projet **`spotu-35061`**
2. ⚙️ Project settings → **Your apps** → ajoute une app **Android** si besoin  
   - Package : **`com.winek.app`**
3. Télécharge **`google-services.json`**
4. Copie-le ici :

```bash
cp ~/Downloads/google-services.json frontend/google-services.json
cp frontend/google-services.json frontend/android/app/google-services.json
```

5. Rebuild APK :

```bash
npm run build:preview:android
```

**Symptôme typique sans ce fichier :** push visibles **uniquement quand l’app est ouverte** (WebSocket + notif locale), rien en arrière-plan.

Sans `google-services.json`, l’APK preview **ne peut pas** obtenir un `ExponentPushToken[...]` valide pour Android.

### 2. Permission notifications (Android 13+)

L’app demande `POST_NOTIFICATIONS` au premier lancement. Si refusée :

**Réglages → Apps → SpotU → Notifications → Autoriser**

Après changement du manifest (`POST_NOTIFICATIONS`), refais un build APK :

```bash
npm run build:preview:android
```

### 3. Vérifier que le token est enregistré

1. Connecte-toi sur l’APK Android.
2. Dans les logs Metro (dev) ou via `adb logcat | grep -i Push`, cherche :
   - `[Push] Token obtenu android ExponentPushToken[...]`
   - `[Push] Token enregistré: ExponentPushToken[...]`
3. Dans Supabase, table `push_tokens` : une ligne active pour ton `user_id` avec un token `ExponentPushToken[...]`.

### 4. Vérifier l’envoi serveur

Sur Hetzner :

```bash
docker compose logs -f spotu-api | grep chat_push_summary
```

Envoie un message **vers** le compte Android (app en arrière-plan). Tu dois voir `attempted=1 sent=1`.

Si `attempted=0` → pas de token en base pour cet utilisateur.  
Si `invalid_token_disabled=1` → refais login sur l’APK (token FCM régénéré) ou reconfigure FCM EAS.

### 5. Backend

`EXPO_PUSH_ENABLED=true` dans `/opt/spotu/SpotU/backend-java/.env` (comme pour iOS).

---

## Commandes utiles

```bash
# Dev (inchangé)
npx expo start
npx expo run:ios

# Preview téléphone
npm run build:preview:android
npm run build:preview:ios
npm run device:register

# OTA JS
npm run update:preview
```
