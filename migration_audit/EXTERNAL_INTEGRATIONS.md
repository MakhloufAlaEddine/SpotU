# EXTERNAL_INTEGRATIONS.md

| Service externe | Usage observé | Module(s) | Criticité |
|-------------------|---------------|-------------|-----------|
| **PostgreSQL (Supabase / asyncpg)** | Base principale ; SSL CA pour non-local | `database.py`, tous les `routes/*` | **Critique** |
| **Stripe** | Checkout, PaymentIntent, webhooks, abonnements ; endpoint proxy si clé test Emergent | `stripe_service.py`, `payment_routes.py`, `webhook_handlers.py`, `subscription_routes.py`, `booking_routes.py` (déduit) | **Critique** |
| **Cloudflare R2 (S3 API)** | Upload / suppression images ; `boto3` | `r2_storage.py`, `upload_routes.py`, `admin_purge_worker.py` | **Haute** |
| **Expo Push Notification API** | Envoi notifications mobiles | `push_service.py` | **Haute** |
| **Emergent OAuth session API** | `GET …/session-data` avec header `X-Session-ID` | `auth_utils.py` `fetch_emergent_session` | **Haute** (login Google) |
| **HTTP générique (httpx)** | OAuth + appels divers | `auth_utils.py`, routes potentiellement autres | **Moyenne** |
| **Google (OAuth)** | Pas d’API Google Places côté backend repéré dans grep limité | — | **N/A backend** (frontend probable) |

---

## Dépendances déclarées mais usage applicatif **non confirmé** (flou)

| Package | Fichier liste | Observation |
|---------|---------------|---------------|
| `pymongo`, `motor` | `requirements.txt` | Aucun import applicatif repéré hors `tests/` dans l’audit rapide. |
| `emergentintegrations` | `requirements.txt` | Usage non localisé. |
| `pandas`, `numpy` | `requirements.txt` | Probablement scripts / ML / reporting — **non cartographié**. |

---

## Dépendances **utilisées** mais **absentes** du `requirements.txt` lu (flou / anomalie)

| Module | Fichier | Risque |
|--------|---------|--------|
| `asyncpg` | `database.py` | Build / déploiement cassé si l’environnement ne l’installe pas transitivement. |
| `exponent_server_sdk` | `push_service.py` | Idem. |

**Action recommandée** : aligner `requirements.txt` avec les imports réels (hors scope de cet audit code).

---

## Variables d’environnement typiques (non exhaustif — voir `env.sample`)

- `DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `APP_URL`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, … (préfixes Stripe — **liste complète dans `stripe_service.py` / `payment_routes.py`**)
- `R2_*`, `R2_PUBLIC_URL`
- Clés liées aux workers (TTL, intervalles)

---

## Criticité pour une future stack Java

1. **Stripe webhooks** : signature + idempotence + ordre des événements.
2. **JWT** : même secret / algo côté mobile.
3. **R2** : compatibilité SDK AWS S3 Java.
4. **Expo Push** : format message identique.
5. **Emergent OAuth** : dépendance produit ; migration possible vers Google direct — **décision produit**, pas technique seule.
