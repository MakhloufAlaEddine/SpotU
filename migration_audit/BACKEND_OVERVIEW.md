# BACKEND_OVERVIEW.md — Audit SpotU (Python / FastAPI)

**Date de l’audit** : déduction à partir de l’état du dépôt au moment de la génération (branche courante : vérifier avec `git branch`).  
**Niveau de confiance** : **certain** pour les fichiers lus ; **déduit** pour le comportement runtime non exécuté ici ; **flou / à vérifier** indiqués explicitement.

---

## 1. Architecture actuelle (certain)

- **Style** : monolithe HTTP **FastAPI** avec un `APIRouter` racine préfixé `/api`, puis sous-routers par domaine fonctionnel.
- **Persistance** : **PostgreSQL** via pool **asyncpg** (`database.py`). Schéma versionné par scripts SQL dans `backend/migrations/` (exécution via `migrations/run_migrations.py` — non relu en détail pour cet audit).
- **Temps réel** : **WebSockets** pour chat, notifications, SpotYou (`routes/chat_routes.py`).
- **Fichiers statiques** : montage Starlette `StaticFiles` sur `/api/uploads` → répertoire uploads local (`server.py`).
- **Tâches de fond** : plusieurs **workers** asyncio démarrés au **startup** FastAPI (`server.py` → `@app.on_event("startup")`), arrêt au shutdown.

---

## 2. Point d’entrée (certain)

| Élément | Fichier | Rôle |
|--------|---------|------|
| Application ASGI | `backend/server.py` | Crée `app = FastAPI(...)`, middlewares, `api_router`, montage uploads, CORS, lifespan startup/shutdown. |
| Serveur process | **uvicorn** (hors repo ou scripts parent) | Non documenté dans ce fichier ; typiquement `uvicorn server:app`. |

---

## 3. Frameworks & bibliothèques (mix certain / flou)

### 3.1 Déclarées dans `backend/requirements.txt` (certain — contenu fichier)

- **fastapi**, **uvicorn**, **pydantic**, **python-multipart**
- **asyncpg** : **non listé** dans `requirements.txt` de la branche auditée, alors que `database.py` importe `asyncpg` → **flou** : dépendance manquante dans le fichier, ou génération d’audit sur une branche partielle, ou install groupé ailleurs.
- **slowapi** + **limits** (rate limiting)
- **stripe**
- **httpx**
- **pyjwt**, **bcrypt**, **passlib**, **cryptography**
- **boto3** (usage typique S3-compatible / R2)
- **python-dotenv**
- **pymongo**, **motor** : présents dans `requirements.txt` — **aucune occurrence** dans les modules applicatifs listés par recherche rapide hors `tests/` → **déduit** : legacy / inutilisé ou usage limité non détecté ; **à vérifier** (`grep -R pymongo backend` hors tests).
- **emergentintegrations** : déclaré — usage applicatif **non confirmé** dans les routes lues ; **à vérifier**.
- **pandas**, **numpy**, **jq**, **typer**, **pytest**, linters : tooling / tests / scripts.

### 3.2 Importés dans le code mais absents du snippet `requirements.txt` (flou)

- **`exponent_server_sdk`** dans `push_service.py` — absent de la liste `requirements.txt` lue → **à vérifier** (dépendance transitive ou fichier requirements incomplet).

---

## 4. Structure des dossiers (certain — listing)

```
backend/
├── server.py              # Entrée app, CORS, workers startup
├── database.py            # Pool asyncpg, codecs JSON
├── models.py              # Pydantic + enums métier
├── auth_utils.py          # JWT, bcrypt, OAuth Emergent (HTTP)
├── limiter.py             # slowapi Limiter + IP client
├── stripe_service.py      # Stripe API + webhook parse
├── webhook_handlers.py    # Dispatch événements Stripe (idempotence)
├── r2_storage.py          # Cloudflare R2 (déduction nom fichier)
├── push_service.py        # Expo Push + notifications DB
├── pricing_engine.py      # Règles tarifaires (non audité ligne par ligne)
├── chat_manager.py        # État temps réel (non audité en profondeur)
├── seed.py                # Seed (non exécuté)
├── admin_purge_worker.py  # Purge fichiers différés (CLI + appel API)
├── expiry_worker.py
├── spot_you_notif_worker.py
├── admin_product_reminder_worker.py
├── media_purge_worker.py
├── media_notif_worker.py
├── routes/                # Routers FastAPI par domaine
├── migrations/            # SQL + run_migrations.py + MIGRATIONS.md
├── tests/                 # Pytest volumineux
└── certs/                 # CA Supabase (SSL)
```

---

## 5. Configuration notable (certain — d’après `server.py`, `database.py`, `auth_utils.py`, `limiter.py`)

| Variable / sujet | Où lu | Notes |
|------------------|-------|--------|
| `DATABASE_URL` | `database.py` | Obligatoire ; SSL selon hôte (local sans SSL). |
| `JWT_SECRET` | `auth_utils.py` | Obligatoire au **import** du module (crash si absent). |
| `ALLOWED_ORIGINS`, `APP_URL` | `server.py` | CORS ; fallback + logs si liste vide. |
| `BOOKING_EXPIRY_HOURS`, `EXPIRY_WORKER_INTERVAL_SECS` | `server.py` | Workers réservations. |
| `TESTING` | `limiter.py` | Rate limit désactivé / clé unique par requête. |
| `TEST_ENV` | `push_service.py` | Supprime envoi push réel mais pas l’insert DB (commentaire code). |
| `STRIPE_*` | `stripe_service.py`, `payment_routes.py` | Webhook + clés (non listées ici). |
| `R2_*`, `R2_PUBLIC_URL` | `upload_routes.py`, `r2_storage.py` | Stockage images. |
| Chemins uploads | `upload_routes.py` | `UPLOADS_DIR = Path("/app/backend/uploads")` — **déduction** : chemin orienté conteneur ; peut diverger de `server.py` qui utilise `ROOT_DIR / "uploads"` pour StaticFiles → **risque de double emplacement** (voir `MIGRATION_RISKS.md`). |

---

## 6. Composants clés (certain)

| Composant | Fichiers principaux |
|-----------|---------------------|
| Auth email / JWT | `auth_routes.py`, `auth_utils.py` |
| OAuth Google via Emergent | `auth_routes.py` → `fetch_emergent_session` (`auth_utils.py`) |
| Utilisateurs & profil | `user_routes.py` |
| Taxonomie (domaines, tags) | `domain_routes.py` |
| Tag points / SpotYou communautaire | `tagpoint_routes.py`, `spot_you_routes.py` |
| Services & recherche | `service_routes.py` |
| Réservations & paiement métier | `booking_routes.py`, `payment_routes.py`, `webhook_handlers.py` |
| Chat & WS | `chat_routes.py`, `chat_manager.py` |
| Home / feed | `home_routes.py` |
| Marketplace & produits | `marketplace_routes.py`, `product_creation_routes.py`, `admin_product_routes.py` |
| Abonnements | `subscription_routes.py` (+ chevauchement partiel avec `payment_routes` admin — voir risques) |
| Admin | `admin_routes.py` |
| Adresses | `address_routes.py` |
| Suppression / RGPD | `deletion_routes.py` |
| Push tokens | `push_routes.py` |
| Upload | `upload_routes.py` |

---

## 7. Zones legacy ou peu claires

| Sujet | Niveau | Détail |
|-------|--------|--------|
| **pymongo / motor** dans `requirements.txt` | Flou | Pas d’usage évident dans le code applicatif scanné. |
| **emergentintegrations** | Flou | Package présent ; usage non localisé dans l’audit rapide. |
| **`get_spot_you_members`** dans `spot_you_routes.py` | Certain (code) | Fonction **async** **sans** décorateur `@router` → **non exposée** comme endpoint HTTP dans l’état actuel ; possible code mort ou oubli de route. |
| **`COMMISSION_RATE = 0.15`** dans `auth_utils.py` | Déduit | Constante Python ; usage effectif **non vérifié** dans cet audit (peut être utilisé ailleurs ou legacy). |
| **`print(...)` dans `decode_jwt`** | Certain | Logs debug vers stdout — bruit / fuite d’info en prod. |
| **Double `return v` dans `TagPointCreate.validate_schedule_times`** (`models.py`) | Certain | Duplication de `return v` (lignes ~183–184) — possible bug / dead code ; **comportement Python** : premier `return` prime. |

---

## 8. Tests & qualité

- Nombre très important de tests sous `backend/tests/` et `backend/tests/e2e/` — **non cartographiés** endpoint par endpoint dans ce document.
- **Confiance** : ils constituent une **source de vérité comportementale** pour une future migration ; les référencer slice par slice.

---

## 9. Méthodologie de lecture (traçabilité)

- Fichiers effectivement ouverts / grep : `server.py`, `database.py`, `models.py` (partiel), `auth_utils.py`, `limiter.py`, `push_service.py`, `webhook_handlers.py` (en-tête), `admin_purge_worker.py` (en-tête), `upload_routes.py` (partiel), `payment_routes.py` (partiel), `subscription_routes.py` (partiel), `routes/*.py` (signatures `@router`), `migrations/001_initial_schema.sql` + `009_*.sql`, `requirements.txt`.
