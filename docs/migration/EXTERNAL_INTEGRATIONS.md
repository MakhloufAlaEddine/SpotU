# EXTERNAL_INTEGRATIONS.md — Intégrations externes SpotU
> Généré le 2026-04-11.

---

## 1. PostgreSQL / Supabase

| | |
|---|---|
| **Type** | Base de données relationnelle |
| **Provider** | Supabase (PostgreSQL managé) |
| **Mode** | Session Pooler (Supavisor, port 5432) |
| **Driver** | asyncpg |
| **SSL** | CERT_REQUIRED avec CA cert embarqué (`certs/supabase-ca.crt`) |
| **Extensions** | PostGIS (`geometry`, `ST_DWithin`, `ST_Distance`, `ST_X/Y`) |
| **Fichiers** | `database.py`, toutes les routes |
| **Criticité** | CRITIQUE — source de vérité unique |

**Notes migration Spring :**
- Remplacer asyncpg par **Spring Data JPA** + **HikariCP** + driver JDBC PostgreSQL
- PostGIS : utiliser **Hibernate Spatial** (`hibernate-spatial` + `postgis-jdbc`)
- Codec JSONB custom (asyncpg) → **Column(columnDefinition = "jsonb")** en JPA
- `statement_cache_size=0` requis Supavisor → `prepareThreshold=0` dans le JDBC URL
- IDs TEXT (non UUID) → PK `@Id @Column(name="...", columnDefinition="TEXT")` en JPA

---

## 2. Stripe

| | |
|---|---|
| **Type** | Paiement |
| **SDK** | `stripe==14.3.0` (Python) |
| **Proxy Emergent** | Oui — si `STRIPE_API_KEY=sk_test_emergent`, les appels passent par `https://integrations.emergentagent.com/stripe` |
| **Fichiers** | `stripe_service.py`, `payment_routes.py`, `booking_routes.py`, `subscription_routes.py`, `webhook_handlers.py` |
| **Criticité** | CRITIQUE |

**Fonctionnalités utilisées :**
- PaymentIntent (create, capture, cancel)
- Checkout Session (bookings + subscriptions)
- Connect (transfer vers sellers) — partiellement implémenté
- Subscriptions (create, cancel, retrieve)
- Webhooks : `payment_intent.*`, `charge.*`, `checkout.session.completed`, `customer.subscription.*`
- Customer management (create / retrieve)

**Notes migration Spring :**
- Utiliser `stripe-java` SDK (bien maintenu)
- Le proxy Emergent est spécifique Python → configurer `Stripe.apiBase` si proxy nécessaire en Java
- Webhook signature : `Webhook.constructEvent(payload, sigHeader, endpointSecret)`
- L'idempotence des webhooks via `stripe_webhook_events` doit être conservée

---

## 3. Cloudflare R2

| | |
|---|---|
| **Type** | Object storage (S3-compatible) |
| **SDK** | boto3 (Python) |
| **Fichiers** | `r2_storage.py`, `upload_routes.py`, `admin_purge_worker.py` |
| **Criticité** | ÉLEVÉE |

**Opérations :**
- `upload_fileobj` (PUT avec Content-Type, ACL public-read)
- `delete_object` (suppression physique dans purge worker)
- Compression PIL avant upload (max 2000px, JPEG q=85)

**Notes migration Spring :**
- Utiliser **AWS SDK for Java v2** (`software.amazon.awssdk:s3`) en mode S3-compatible
- Configurer `EndpointOverride` → `R2_ENDPOINT`
- Compression image → **Thumbnailator** ou `ImageIO` en Java
- La logique de suppression différée (`pending_file_deletions`) reste en DB → worker Spring `@Scheduled`

---

## 4. Expo Push Notifications

| | |
|---|---|
| **Type** | Push notifications mobiles |
| **SDK** | `exponent_server_sdk` (Python) |
| **Fichiers** | `push_service.py` |
| **Criticité** | MOYENNE |

**Flux :**
1. Token push stocké dans `push_tokens` (INSERT via `/api/push-token`)
2. `send_push_to_user(pool, user_id, title, body, data)` → SELECT tokens → Expo Push API
3. Fire-and-forget via `asyncio.create_task`
4. En mode `TEST_ENV` : logs seulement, pas d'envoi réel

**Notes migration Spring :**
- Utiliser **OkHttp** ou `RestTemplate` pour appeler l'API Expo REST directement (pas de SDK Java officiel)
- Endpoint : `POST https://exp.host/--/api/v2/push/send`
- Le `asyncio.create_task` devient `@Async` + `ThreadPoolTaskExecutor` en Spring

---

## 5. Emergent (Google OAuth + Proxy Stripe)

| | |
|---|---|
| **Type** | Service interne Emergent Labs |
| **Fichiers** | `auth_utils.py` (Google OAuth), `stripe_service.py` (Stripe proxy) |
| **Criticité** | MOYENNE (auth Google) + ÉLEVÉE (Stripe proxy si utilisé) |

### Google OAuth
Endpoint : `GET https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data?session_id={id}`
Retourne : `{email, name, picture, provider_id}`
Usage : `POST /api/auth/google` → récupère le profil via session_id passé par le frontend

**Notes migration Spring :**
- En Java, remplacer par une implémentation Spring Security OAuth2 directe avec Google
- Ou conserver l'appel HTTP vers Emergent si le service reste disponible en production
- Ne pas coupler la migration Java à cette dépendance — traiter séparément

### Stripe Proxy
Si `STRIPE_API_KEY == "sk_test_emergent"` → les calls Stripe passent par `https://integrations.emergentagent.com/stripe`.
En production avec une vraie clé Stripe → direct sans proxy.

---

## 6. PostGIS (Extension PostgreSQL)

| | |
|---|---|
| **Type** | Extension spatiale PostgreSQL |
| **Fichiers** | `tagpoint_routes.py`, `spot_you_routes.py`, `home_routes.py`, `service_routes.py` |
| **Criticité** | ÉLEVÉE |

**Fonctions utilisées :**
- `ST_DWithin(location, ST_SetSRID(ST_MakePoint(lng, lat), 4326), radius)` — filtrage par rayon
- `ST_Distance(location, ST_SetSRID(ST_MakePoint(...), 4326))` — distance calculée
- `ST_X(location::geometry)` / `ST_Y(location::geometry)` — extraction lng/lat
- `ST_SetSRID(ST_MakePoint(lng, lat), 4326)` — création point géographique

**Notes migration Spring :**
- Hibernate Spatial supporte PostGIS nativement
- Dépendance Maven : `org.hibernate:hibernate-spatial`
- Type Java : `org.locationtech.jts.geom.Point`
- Les requêtes SQL brutes avec PostGIS peuvent rester en `@Query(nativeQuery=true)`

---

## Résumé des criticités

| Service | Criticité | Peut migrer sans ? |
|---------|-----------|-------------------|
| PostgreSQL / Supabase | CRITIQUE | Non |
| PostGIS | ÉLEVÉE | Non (spatial obligatoire) |
| Stripe | CRITIQUE | Non (paiements) |
| Cloudflare R2 | ÉLEVÉE | Non (médias) |
| Expo Push | MOYENNE | Oui (dégradé sans push) |
| Emergent Google OAuth | MOYENNE | Oui (remplacer par OAuth2 direct) |
| Emergent Stripe Proxy | ÉLEVÉE | Oui (remplacer par clé Stripe directe) |
