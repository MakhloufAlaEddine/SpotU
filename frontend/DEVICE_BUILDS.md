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
