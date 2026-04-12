# BACKEND_OVERVIEW.md — SpotU Backend
> Généré le 2026-04-11 — Ne pas modifier manuellement.

---

## 1. Résumé général

Application **FastAPI** asynchrone (Python 3.11+) avec base de données **PostgreSQL** (Supabase / asyncpg). Pas de ORM — SQL brut via asyncpg. Pas de cache Redis. Architecture monolithique, tous les modules dans un seul process.

- **Nom API** : SpotU API v1.0.0
- **Process** : `uvicorn` géré par `supervisor`
- **Port** : 8001 (interne)
- **Préfixe global** : `/api`

---

## 2. Point d'entrée

| Fichier | Rôle |
|---------|------|
| `server.py` | FastAPI app, enregistrement des routers, middleware, startup/shutdown |
| `database.py` | Pool asyncpg, codec JSONB, gestion SSL Supabase |
| `auth_utils.py` | JWT HS256, bcrypt, `require_auth`, `get_optional_auth` |

---

## 3. Frameworks et librairies principales

| Librairie | Version | Usage |
|-----------|---------|-------|
| `fastapi` | 0.110.1 | Framework HTTP + routing |
| `uvicorn` | 0.25.0 | Serveur ASGI |
| `asyncpg` | — | Driver PostgreSQL async |
| `pydantic` | ≥2.6.4 | Validation des modèles |
| `pyjwt` | ≥2.10.1 | JWT tokens (HS256) |
| `bcrypt` | 4.1.3 | Hachage mots de passe |
| `stripe` | 14.3.0 | Paiements (PaymentIntent, Checkout, Connect, Subscriptions) |
| `slowapi` | 0.1.9 | Rate limiting (wraps `limits`) |
| `boto3` | ≥1.34 | Cloudflare R2 (S3-compatible) |
| `Pillow` | — | Compression d'images avant upload R2 |
| `exponent_server_sdk` | — | Push notifications Expo |
| `httpx` | 0.28.1 | Requêtes HTTP async (Google OAuth via Emergent) |
| `python-dotenv` | ≥1.0.1 | Chargement .env |
| `emergentintegrations` | 0.1.0 | Proxy Emergent (Stripe, Google OAuth) |

---

## 4. Organisation des dossiers

```
/app/backend/
├── server.py                         ← FastAPI app, startup, CORS, rate limiting
├── database.py                       ← Pool asyncpg (Supabase session mode)
├── auth_utils.py                     ← JWT, bcrypt, require_auth, optional_auth
├── models.py                         ← Pydantic models (validation entrée)
├── pricing_engine.py                 ← Moteur de calcul de frais (singleton)
├── stripe_service.py                 ← Wrapper Stripe SDK complet
├── push_service.py                   ← Push Expo (send_push_notification, send_push_to_user)
├── r2_storage.py                     ← Upload/suppression R2 (S3 boto3 + compression PIL)
├── webhook_handlers.py               ← Handlers centralisés webhooks Stripe
├── chat_manager.py                   ← ConnectionManager (WS chat) + NotificationManager (WS notif)
├── limiter.py                        ← Singleton slowapi Limiter
├── expiry_worker.py                  ← Worker expiration bookings (boucle asyncio)
├── spot_you_notif_worker.py          ← Worker notifs SpotYou pré/post séance
├── admin_product_reminder_worker.py  ← Worker rappel admin produits en pending
├── media_purge_worker.py             ← Worker purge médias J+90
├── media_notif_worker.py             ← Worker notification pré-purge J+83
├── admin_purge_worker.py             ← Purge physique fichiers (appelé par MediaPurgeWorker)
├── routes/
│   ├── auth_routes.py               ← /api/auth/*
│   ├── user_routes.py               ← /api/users/*
│   ├── domain_routes.py             ← /api/domains/*, /api/tags/*
│   ├── tagpoint_routes.py           ← /api/tag-points/*, notifications, votes, invitations
│   ├── spot_you_routes.py           ← /api/spot-you/* (join/leave/going/activity)
│   ├── service_routes.py            ← /api/services/*
│   ├── booking_routes.py            ← /api/bookings/*
│   ├── payment_routes.py            ← /api/payments/*, /api/webhook/stripe
│   ├── subscription_routes.py       ← /api/subscriptions/*, /api/subscription-plans/*
│   ├── chat_routes.py               ← /api/conversations/*, WebSocket /ws/*
│   ├── home_routes.py               ← /api/home/*
│   ├── marketplace_routes.py        ← /api/marketplace/products
│   ├── product_creation_routes.py   ← /api/products/*
│   ├── admin_routes.py              ← /api/admin/*
│   ├── admin_product_routes.py      ← /api/admin/products/*
│   ├── upload_routes.py             ← /api/upload-image
│   ├── push_routes.py               ← /api/users/push-token
│   ├── address_routes.py            ← /api/addresses/*
│   └── deletion_routes.py           ← DELETE users, tag-points, messages, conversations
├── migrations/
│   ├── run_migrations.py            ← CLI runner migrations (SHA-256, transactionnel)
│   └── 001_initial_schema.sql → 017_spotyou_invite_fields.sql
├── certs/
│   └── supabase-ca.crt             ← CA cert Supabase (SSL CERT_REQUIRED)
└── tests/                          ← ~80 fichiers pytest
```

---

## 5. Configuration importante

| Variable env | Obligatoire | Usage |
|-------------|-------------|-------|
| `DATABASE_URL` | OUI | URL asyncpg PostgreSQL (Supabase session pooler) |
| `JWT_SECRET` | OUI | Clé HMAC HS256 (expire si manquant au démarrage) |
| `ALLOWED_ORIGINS` | OUI | CORS whitelist CSV |
| `APP_URL` | Non | Fallback CORS |
| `SSL_CA_CERT_PATH` | Non | CA cert Supabase (défaut: certs/supabase-ca.crt) |
| `R2_ACCESS_KEY_ID` | Non | Cloudflare R2 |
| `R2_SECRET_ACCESS_KEY` | Non | Cloudflare R2 |
| `R2_ENDPOINT` | Non | Cloudflare R2 |
| `R2_BUCKET_NAME` | Non | Cloudflare R2 |
| `R2_PUBLIC_URL` | Non | URL publique des médias |
| `STRIPE_API_KEY` | Non | Stripe (mode test sk_test_emergent via proxy Emergent) |
| `STRIPE_WEBHOOK_SECRET` | Non | Vérification signature webhook Stripe |
| `BOOKING_EXPIRY_HOURS` | Non | TTL expiration bookings (défaut: 48h) |
| `EXPIRY_WORKER_INTERVAL_SECS` | Non | Fréquence worker expiry (défaut: 60s) |
| `TEST_ENV` | Non | Si "test" : supprime les push Expo réels |
| `TESTING` | Non | Si "true" : désactive le rate limiting |

---

## 6. Dépendances externes visibles dans le code

| Service | Fichier | Détail |
|---------|---------|--------|
| PostgreSQL / Supabase | `database.py` | asyncpg pool, SSL CA cert, Supavisor session mode |
| Stripe | `stripe_service.py`, `payment_routes.py`, `webhook_handlers.py` | PaymentIntent, Checkout, Connect, Subscriptions |
| Cloudflare R2 | `r2_storage.py`, `upload_routes.py` | S3-compatible boto3, compression PIL |
| Expo Push | `push_service.py` | exponent_server_sdk, tokens stockés en DB |
| Emergent (Google OAuth) | `auth_utils.py` | `https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data` |
| Emergent (Stripe proxy) | `stripe_service.py` | `https://integrations.emergentagent.com/stripe` si clé "sk_test_emergent" |

---

## 7. Mécanismes techniques importants

### Auth JWT
- Token HS256, expire dans 7 jours, lu depuis `Authorization: Bearer` ou cookie `winek_token`
- `require_auth(request, pool)` → `dict` utilisateur complet
- `get_optional_auth(request, pool)` → `dict | None` (pas de 401 si absent)
- `require_role(request, pool, role)` → 403 si rôle différent

### Pool asyncpg
- `min_size=2, max_size=10`, `statement_cache_size=0` (requis Supavisor)
- Codec JSONB installé par connexion (`_init_connection`)
- Retry 15 tentatives au démarrage (back-off exponentiel)
- SSL : local=False, Supabase=CERT_REQUIRED avec CA cert embarqué

### Migrations
- Versionnées `NNN_desc.sql`, contrôlées par SHA-256 + table `_migrations`
- Exécutées UNIQUEMENT via `run_migrations.py`, JAMAIS au runtime
- Runner CLI : `--status`, `--dry-run`, `--new <nom>`

### Rate Limiting
- slowapi + `limits`, IP réelle via `X-Forwarded-For`
- Géré par décorateur `@limiter.limit("X/minute")` sur les routes sensibles
- En mode `TESTING=true` : clé unique → jamais limité

### WebSocket
- 3 canaux : `/ws/chat/{conv_id}`, `/ws/notifications`, `/ws/spot-you/{point_id}`
- Gérés par `ConnectionManager` (chat) et `NotificationManager` (notifications/spotyou)
- Auth via query param `token=` (JWT dans l'URL)

### Middleware
- `X-Response-Time` header sur chaque réponse (perf_counter)
- CORS strict : origines explicites, `allow_credentials=True`

### Workers (asyncio, lancés au startup)
| Worker | Fichier | Intervalle |
|--------|---------|-----------|
| ExpiryWorker | `expiry_worker.py` | 60s (configurable) |
| SpotYouNotifWorker | `spot_you_notif_worker.py` | 15 min |
| AdminProductReminderWorker | `admin_product_reminder_worker.py` | 10 min |
| MediaPurgeWorker | `media_purge_worker.py` | 1h |
| MediaNotifWorker | `media_notif_worker.py` | 15 min |

### Soft Delete
- Entités concernées : `users`, `tag_points`, `services`, `marketplace_products`, `conversations`, `messages`
- Colonnes : `deleted_at`, `deleted_by`, `media_purge_scheduled_at` (J+90), `reactivated_at`
- La purge physique des fichiers (R2) est déclenchée par `MediaPurgeWorker` à J+90

### Pricing Engine
- Singleton `pricing_engine` dans `pricing_engine.py`
- Aucune route ne calcule de montant directement
- Résout la règle active (`pricing_rules`), applique les exemptions d'abonnement (`user_subscriptions`)
- Résultat stocké en JSONB immuable (`pricing_rule_snapshot`) dans `payments`

### IDs
- Format : `{prefix}_{hex12}` (ex: `user_abc123def456`, `bk_xyz789`)
- Généré par `new_id(prefix)` dans `models.py`
- Pas d'UUID natif PostgreSQL — TEXT en PK

### Géolocalisation
- Colonnes `location geometry(Point,4326)` dans `tag_points`
- Extension PostGIS : `ST_DWithin`, `ST_Y`/`ST_X`, `ST_Distance`
- Obfuscation de localisation : `apply_precision_offset` (bruit gaussien selon précision `exact|100m|1000m`)
