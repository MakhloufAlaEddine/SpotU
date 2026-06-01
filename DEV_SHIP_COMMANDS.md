# SpotU — Commandes de déploiement (ship)

Scripts à lancer **depuis la racine du dépôt** (`spotU/`).

| Commande | Action |
|----------|--------|
| `npm run ship:front` | Git commit/push → EAS Update channel `preview` (pas de rebuild natif) |
| `npm run ship:back` | Git commit/push → SSH Hetzner (git pull + compose build) → `/api/readiness` |
| `npm run ship:all` | Backend + frontend OTA |
| `npm run ship:smart` | Détecte les changements locaux et choisit l’action |
| `npm run build:preview:android` | Build EAS APK preview (`com.winek.app`) |
| `npm run build:preview:ios` | Build EAS iOS preview (`com.winek.mobile`) |
| `npm run start:back` | Démarrer le backend sur Hetzner (`docker compose up -d`) |
| `npm run stop:back` | Arrêter le backend (`docker compose down`) |
| `npm run restart:back` | Redémarrer le service `spotu-api` |
| `npm run status:back` | Statut des conteneurs (`docker compose ps`) |
| `npm run logs:back` | Logs en direct du service `spotu-api` |
| `npm run health:back` | Vérifier `/api/readiness` |

---

## 1. Frontend OTA (`ship:front`)

```bash
npm run ship:front
```

Étapes :

1. `git status` → commit si changements (`SHIP_COMMIT_MSG` optionnel)
2. `git push`
3. `eas update --channel preview` dans `frontend/`

**Après publication OTA** (build **preview EAS** installé sur le téléphone, pas `npx expo run:ios`) :

1. Fermer complètement l’app
2. Rouvrir (téléchargement OTA en arrière-plan)
3. Fermer à nouveau, rouvrir (JS mis à jour)

> **Important** : les builds preview créés *avant* la réactivation d’expo-updates ignorent l’OTA. Dans ce cas : `npm run build:preview:ios` (ou Android) une fois, puis `ship:front` fonctionnera.

> **Dev Metro** (`npm run dev:ios`) : `ship:front` ne met pas à jour l’app — recharge via Metro (`r`).

Variables utiles :

```bash
SHIP_COMMIT_MSG="fix: écran login" npm run ship:front
EAS_UPDATE_MESSAGE="fix login" npm run ship:front
SHIP_SKIP_COMMIT=1 npm run ship:front   # refuse si working tree sale
```

---

## 2. Backend (`ship:back`)

### Configuration requise (une fois)

```bash
cp scripts/ship/deploy.env.example scripts/ship/deploy.env
# Édite scripts/ship/deploy.env (non commité — couvert par .gitignore)
```

Variables **obligatoires** :

| Variable | Description |
|----------|-------------|
| `HETZNER_SSH` | SSH, ex. `root@178.105.95.184` |
| `HETZNER_APP_DIR` | Dossier git sur le serveur (`docker-compose.yml`, `Dockerfile`, `.env` prod) |

Variables **optionnelles** :

| Variable | Défaut | Description |
|----------|--------|-------------|
| `BACKEND_READINESS_URL` | `http://178.105.95.184:8080/api/readiness` | URL de vérification post-deploy |
| `HETZNER_COMPOSE_FILE` | `docker-compose.yml` | Fichier compose sur le serveur |
| `HETZNER_COMPOSE_SERVICE` | `spotu-api` | Service à rebuild / redémarrer |
| `HETZNER_DEPLOY_COMMAND` | — | Remplace la séquence git pull + compose |

Pas de registry Docker : le build se fait **sur le serveur Hetzner**.

Puis :

```bash
npm run ship:back
```

Étapes :

1. **Local** : commit (si changements) + `git push`
2. **Serveur** (SSH) :
   ```bash
   cd $HETZNER_APP_DIR
   git pull
   docker compose build spotu-api
   docker compose up -d spotu-api
   ```
3. **Local** : `curl $BACKEND_READINESS_URL` (12 tentatives × 5 s)

---

## 2b. Gestion backend à distance (Hetzner)

Prérequis : `scripts/ship/deploy.env` avec `HETZNER_SSH` et `HETZNER_APP_DIR`.

Exemple :

```bash
HETZNER_SSH=root@178.105.95.184
HETZNER_APP_DIR=/opt/spotu/SpotU/backend-java
```

| Commande | Action SSH |
|----------|------------|
| `npm run start:back` | `docker compose up -d` |
| `npm run stop:back` | `docker compose down` |
| `npm run restart:back` | `docker compose restart spotu-api` |
| `npm run status:back` | `docker compose ps` |
| `npm run logs:back` | `docker compose logs -f spotu-api` |
| `npm run health:back` | `curl $BACKEND_READINESS_URL` (local) |

```bash
npm run start:back
npm run stop:back
npm run restart:back
npm run status:back
npm run logs:back      # Ctrl+C pour quitter
npm run health:back
```

---

## 3. Full deploy (`ship:all`)

```bash
npm run ship:all
```

Un seul commit/push, puis backend deploy + EAS Update preview.

---

## 4. Script intelligent (`ship:smart`)

Analyse les fichiers modifiés (non commités) :

| Détection | Fichiers typiques |
|-----------|-------------------|
| **Backend** | `backend-java/**` |
| **Frontend OTA** | `frontend/**` sauf natif |
| **Natif** | `frontend/ios/`, `frontend/android/`, `app.json`, `app.config.*`, `eas.json`, `babel.config.js`, `package.json`, `patches/` |

Actions :

| Situation | Action |
|-----------|--------|
| JS/TS/assets seulement | `ship:front` |
| Backend seulement | `ship:back` |
| Backend + frontend OTA | `ship:all` |
| Natif seulement | Propose build preview Android/iOS |
| Natif + autre | Message : rebuild natif d’abord, puis ship:back / ship:front |

Exemple de sortie :

```
Backend changes detected:        yes
Frontend OTA changes detected:   yes
Native changes detected:         no
Action selected: full deploy (backend + OTA)
```

---

## 5. Builds natifs preview

```bash
npm run build:preview:android   # réinstaller l’APK
npm run build:preview:ios       # installer via lien EAS
```

Identifiants inchangés :

- Android : `com.winek.app`
- iOS : `com.winek.mobile`

---

## Prérequis

- Git configuré, branche avec remote
- `npx eas login` (frontend OTA / builds)
- SSH vers Hetzner + `deploy.env` rempli (backend ship)
- `curl` pour readiness
- Sur le serveur : git, docker, docker compose, clone du repo

---

## Fichiers scripts

```
scripts/ship/
  common.sh
  git-sync.sh
  detect-changes.sh
  ship-front.sh
  ship-back.sh
  ship-all.sh
  ship-smart.sh
  build-preview-android.sh
  build-preview-ios.sh
  start-back.sh
  stop-back.sh
  restart-back.sh
  status-back.sh
  logs-back.sh
  health-back.sh
  deploy.env.example
```
