# Guide EAS Build — SpotU

> **App sur téléphone (sans Expo Go, sans Metro)** : voir **[DEVICE_BUILDS.md](./DEVICE_BUILDS.md)** (profil `preview`, APK Android, iOS ad hoc / TestFlight).

## Prérequis
- Node.js ≥ 18 installé sur votre machine
- eas-cli installé : `npm install -g eas-cli`
- Compte expo.dev : makhlouf.aladin@live.fr

---

## ÉTAPE 1 — Récupérer le code

Utilisez "Save to Github" dans l'interface Emergent, puis clonez le repo :
```bash
git clone https://github.com/VOTRE_USER/VOTRE_REPO.git
cd VOTRE_REPO/frontend
npm install  # ou yarn
```

---

## ÉTAPE 2 — Connexion Expo

```bash
eas login
# Email : makhlouf.aladin@live.fr
# Entrez votre mot de passe expo.dev
```

---

## ÉTAPE 3 — Lier le projet à expo.dev (une seule fois)

```bash
eas build:configure
```

Cette commande va :
- Créer le projet "SpotU" sur votre compte expo.dev
- Mettre à jour app.json avec le `projectId` automatiquement

---

## ÉTAPE 4 — Lancer le build Development Android

```bash
eas build --platform android --profile development
```

Durée : **5-10 minutes** (build sur les serveurs Expo)

À la fin, vous recevez un **lien de téléchargement .apk**

---

## ÉTAPE 5 — Installer le .apk sur votre Android

1. Téléchargez le .apk depuis le lien EAS
2. Transférez-le sur votre téléphone (USB, email, etc.)
3. Installez-le (vous devrez autoriser "sources inconnues" dans les réglages)

---

## ÉTAPE 6 — Connecter l'app au serveur de dev

Quand vous ouvrez le SpotU dev build sur votre téléphone :

1. L'app affichera un écran "Enter URL manually"
2. Dans le terminal de votre machine, lancez : `npx expo start`
3. Copiez l'URL affiché (ex: `exp://192.168.x.x:8081`)
4. Collez-la dans l'app → L'app se charge avec le **vrai splash screen SpotU** !

---

## Build iOS Simulator (optionnel, sans compte Apple)

```bash
eas build --platform ios --profile development
# Choisissez "Simulator" quand demandé
```

Installe sur le simulateur Xcode (Mac requis).

---

## Rappels futurs (fin des développements)

### Build Production iOS (App Store)
- Besoin : Apple Developer Program ($99/an)
- Commandes :
```bash
eas build --platform ios --profile production
eas submit --platform ios
```

### Build Production Android (Google Play)
- Besoin : Google Play Developer ($25 unique)
- Commandes :
```bash
eas build --platform android --profile production
eas submit --platform android
```

---

## Structure des fichiers EAS configurés

| Fichier | Rôle |
|---------|------|
| `eas.json` | Profils de build (development, preview, production) |
| `app.json` | Config app + expo-dev-client plugin |
| `assets/icon.png` | Icône app (logo SpotU sans texte) |
| `assets/splash.png` | Splash screen (logo SpotU sans texte, fond noir) |
| `assets/adaptive-icon.png` | Icône Android adaptive |
