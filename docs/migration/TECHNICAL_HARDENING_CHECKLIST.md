# TECHNICAL_HARDENING_CHECKLIST.md — Checklist technique avant cutover
> Généré le 2026-04-30. À cocher avant tout déploiement Java en prod.

---

## 1. Variables d'environnement

### 1.1 Auth / JWT
- [ ] `JWT_SECRET` = **valeur strictement identique** entre Python et Java pour cutover non-disruptif. Si différente → tous les tokens existants invalidés (401 forcé pour tous les utilisateurs).
- [ ] `JWT_EXPIRATION_DAYS=7` (cf. S23 BR-XX) — confirmer même valeur Java
- [ ] `JWT_ALGORITHM=HS256` (PAS RS256, PAS HS512)
- [ ] Claim custom `user_id` (pas `sub`) — vérifier dans `JwtService` Java
- [ ] BCrypt `$2a$` ou `$2b$` cross-compat (default Spring vs Python passlib)

### 1.2 Database (Supabase PostgreSQL)
- [ ] `DATABASE_URL` ou équivalent Java JDBC (`jdbc:postgresql://...`) pointant vers le **même schéma** que Python
- [ ] `DB_POOL_SIZE` = 20 (HikariCP) au minimum
- [ ] PostGIS activé (`CREATE EXTENSION IF NOT EXISTS postgis;`) — vérifier avec `SELECT PostGIS_Version();`
- [ ] Toutes les migrations `/app/backend/migrations/*.sql` jouées (notamment `009_pending_file_deletions.sql` + `011_pending_file_deletions_status.sql`)
- [ ] Tester accessibilité depuis le pod Java : `psql $DATABASE_URL -c "SELECT 1"` réussit

### 1.3 Stripe
- [ ] `STRIPE_SECRET_KEY` = **clé prod** (pas test)
- [ ] `STRIPE_WEBHOOK_SECRET` = secret de l'endpoint webhook prod (différent de test)
- [ ] `STRIPE_PROXY_URL` (Emergent proxy conditionnel) configuré si applicable (cf. S19 `StripeConfig`)
- [ ] Webhook URL Stripe Dashboard pointant vers le **nouveau** path Java `/api/webhook/stripe` (vérifier qu'il match le path Python — sinon update Stripe Dashboard)
- [ ] Stripe API version Java = celle utilisée par Python (vérifier dans `stripe_service.py` headers)

### 1.4 Cloudflare R2
- [ ] `R2_ACCOUNT_ID`
- [ ] `R2_ACCESS_KEY_ID`
- [ ] `R2_SECRET_ACCESS_KEY`
- [ ] `R2_BUCKET` (ex: `spotyou-uploads`)
- [ ] `R2_ENDPOINT` (S3-compatible, format `https://<account_id>.r2.cloudflarestorage.com`)
- [ ] `R2_PUBLIC_URL_BASE` (CDN URL prefix pour servir les fichiers)
- [ ] Test upload depuis pod Java : `aws s3 cp test.jpg s3://$R2_BUCKET/test/ --endpoint-url $R2_ENDPOINT`

### 1.5 Push notifications (Expo)
- [ ] `EXPO_ACCESS_TOKEN` (si utilisé pour stats)
- [ ] Endpoint `https://exp.host/--/api/v2/push/send` accessible depuis pod Java
- [ ] Test push manuel : envoyer une notif factice à un token de test → confirmer réception

### 1.6 Emergent OAuth (Google natif)
- [ ] `EMERGENT_OAUTH_BASE_URL` (si applicable)
- [ ] Flow `POST /auth/google` avec `X-Session-ID` header — protocole propriétaire vs id_token standard (cf. S23 piège)

### 1.7 CORS
- [ ] `CORS_ALLOWED_ORIGINS` = liste explicite (PAS `*`) :
  - URL prod web (ex: `https://app.spotyou.com`)
  - URL preview Emergent
  - URL Expo Go dev (si nécessaire)
- [ ] `CORS_ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE,OPTIONS`
- [ ] `CORS_ALLOWED_HEADERS=Content-Type,Authorization,X-Session-ID,Stripe-Signature`
- [ ] `CORS_ALLOW_CREDENTIALS=true` (pour cookies si utilisés)
- [ ] **Tester** preflight OPTIONS depuis le domaine prod web : `curl -X OPTIONS https://api.../api/auth/me -H "Origin: https://app...."`

### 1.8 Application
- [ ] `SERVER_PORT=8001` (cohérent avec Python pour faciliter swap)
- [ ] `BASE_URL` ou `PUBLIC_URL` (pour générer URLs absolues — webhook callbacks, deeplinks)
- [ ] `ENVIRONMENT=production`

---

## 2. Stripe — points critiques

- [ ] **Webhook signature** : controller Spring DOIT recevoir `byte[]` raw (pas DTO JSON parsé). Pattern :
  ```java
  @PostMapping("/api/webhook/stripe")
  public ResponseEntity<String> webhook(
      @RequestBody byte[] rawBody,
      @RequestHeader("Stripe-Signature") String signature) { ... }
  ```
- [ ] **Toujours retourner 200** côté webhook même en cas d'erreur applicative (sinon Stripe retry exponentiel = surcharge)
- [ ] **Idempotence** : table `stripe_webhook_events` (PK `event_id`) + INSERT ON CONFLICT DO NOTHING avant traitement (cf. S16 BR)
- [ ] **Capture/cancel/refund** via `StripePaymentService` (S19) — service HORS `@Transactional` (appels réseau)
- [ ] **Idempotency keys Stripe** : préfixe `rf_` pour refund, time-window 5min pour subscribe (cf. S21)
- [ ] **PRODUCTION key** vérifiée (pas accidentellement `sk_test_*`)

---

## 3. Cloudflare R2 / Upload

- [ ] Bucket existe et est accessible (test SDK AWS S3 v2 Java avec `S3Client.builder().endpointOverride(...)`)
- [ ] Configurer le `S3Client` Java avec :
  ```java
  S3Client.builder()
    .endpointOverride(URI.create(r2Endpoint))
    .region(Region.of("auto"))
    .credentialsProvider(StaticCredentialsProvider.create(
        AwsBasicCredentials.create(r2AccessKey, r2SecretKey)))
    .build();
  ```
- [ ] **HEIC non supporté** par ImageIO Java natif — utiliser librairie tierce (`twelvemonkeys-imageio-heif`) OU rejeter HEIC (cf. S24 piège)
- [ ] Magic bytes 5 formats (cf. S24 BR-XX) : JPEG, PNG, WebP, GIF, HEIC
- [ ] Limite 15 Mo (`spring.servlet.multipart.max-file-size=15MB`)
- [ ] Compression Pillow Python → équivalent Java `BufferedImage` + JPEG quality 85
- [ ] Catégorisation prefixes : `profiles/`, `services/`, `spotyou/`, `chats/`, `products/`, `other/`
- [ ] **MediaPurgeWorker stub R2** : décider de migrer S40-bis (purge physique) avant ou après cutover

---

## 4. PostGIS

- [ ] Extension activée : `CREATE EXTENSION IF NOT EXISTS postgis;`
- [ ] Vérifier version : `SELECT PostGIS_Version();` ≥ 3.0
- [ ] Colonnes `geometry` ou `geography(Point, 4326)` présentes sur :
  - `tag_points` (location)
  - `service_locations` (location)
  - autres si applicable
- [ ] Index GiST :
  ```sql
  CREATE INDEX IF NOT EXISTS idx_tag_points_location_gist
    ON tag_points USING GIST(location);
  CREATE INDEX IF NOT EXISTS idx_service_locations_location_gist
    ON service_locations USING GIST(location);
  ```
- [ ] **Java JDBC** : configurer `org.postgresql.geometric.PGgeometry` ou utiliser `JdbcTemplate.queryForList` + parsing manuel ST_AsGeoJSON
- [ ] **Coordonnées** : `ST_MakePoint(lng, lat)` — **PAS** `(lat, lng)` (piège classique S25/S26/S28)
- [ ] **Distance Haversine côté Java** vs PostGIS `ST_Distance` : S38 utilise Haversine Java (pas PostGIS), S25/S26 utilisent PostGIS — cohérence à valider

---

## 5. CORS

(cf. § 1.7 ci-dessus pour les variables)

- [ ] Configuration Spring Security :
  ```java
  @Bean CorsConfigurationSource corsConfigurationSource() {
      CorsConfiguration config = new CorsConfiguration();
      config.setAllowedOrigins(List.of(allowedOrigins.split(",")));
      config.setAllowedMethods(List.of("GET","POST","PUT","PATCH","DELETE","OPTIONS"));
      config.setAllowedHeaders(List.of("Content-Type","Authorization","X-Session-ID","Stripe-Signature"));
      config.setAllowCredentials(true);
      config.setMaxAge(3600L);
      UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
      source.registerCorsConfiguration("/**", config);
      return source;
  }
  ```
- [ ] **Webhook Stripe doit accepter requêtes externes sans CORS auth** (Stripe IPs, pas de browser preflight) — exclure du filtre CORS si nécessaire
- [ ] Test preflight depuis dev tools navigateur sur app preview

---

## 6. Workers (`@Scheduled`)

### 6.1 Workers documentés et à activer

| Worker | Slice | Cadence | Status Java |
|---|---|---|---|
| `ExpiryWorker` (booking timeout) | S18 | 60s | À implémenter |
| `MediaPurgeWorker` (marketplace) | S40 | 3600s | STUB R2 (S40-bis) |
| `AdminProductReminderWorker` | S41 | 600s | À implémenter |
| `media_notif_worker.py` (T+83j) | hors slice | ? | NON migré |
| `admin_purge_worker.run_purge` (R2 physique) | S40-bis | ? | NON migré (STUB) |

### 6.2 Configuration Spring

- [ ] `@EnableScheduling` activé sur la classe `@SpringBootApplication`
- [ ] `@EnableAsync` pour les push notifications fire-and-forget
- [ ] `ThreadPoolTaskScheduler` configuré avec `pool-size>=4` (sinon les workers se bloquent mutuellement)
- [ ] Configurer `@Async` executor `pushExecutor` séparé du scheduler
- [ ] **Singleton process** : si plusieurs replicas Spring, ajouter advisory lock PostgreSQL OU `ShedLock` pour empêcher exécution parallèle des workers
- [ ] `FOR UPDATE SKIP LOCKED` (S18) — utiliser `JdbcTemplate.queryForList` natif (JPA ne supporte pas)

---

## 7. Logs & Monitoring

### 7.1 Structured logging
- [ ] Format JSON via Logback `JsonEncoder` ou `logstash-logback-encoder`
- [ ] Champs obligatoires : `timestamp`, `level`, `logger`, `thread`, `traceId`, `message`
- [ ] Correlation ID : `MDC.put("traceId", UUID.randomUUID().toString())` en filtre Spring

### 7.2 Niveaux de log par domaine
- [ ] `com.spotyou.payment` = `INFO` (audit Stripe complet)
- [ ] `com.spotyou.auth` = `WARN` (pas de password en log)
- [ ] `com.spotyou.product.lifecycle` = `INFO` (purge worker)
- [ ] `com.spotyou.admin` = `INFO` (modération)
- [ ] Default = `INFO`
- [ ] Pas de log de body raw (Stripe webhook signature, JWT tokens, mots de passe)

### 7.3 Monitoring
- [ ] **Healthcheck** `/actuator/health` actif et exposé (port distinct ou path)
- [ ] **Liveness/Readiness** Kubernetes probes :
  - Liveness : `/actuator/health/liveness`
  - Readiness : `/actuator/health/readiness` (vérifie DB + R2 + Stripe accessible)
- [ ] Metrics Prometheus via `micrometer-registry-prometheus` exposé sur `/actuator/prometheus`
- [ ] Alertes sur :
  - Erreur 5xx > 1% sur 5min
  - Latency p99 > 2s
  - DB connections pool > 80%
  - JVM heap > 80%
  - Workers en panne (last cycle > 2× cadence)

### 7.4 Sentry / error tracking
- [ ] `SENTRY_DSN` configuré (si Sentry est utilisé)
- [ ] Filtrer les exceptions attendues (`NotFoundException`, `BadRequestException`) pour ne pas spammer

---

## 8. Database migrations

### 8.1 Outil
- [ ] **Flyway** ou **Liquibase** activé côté Java (cohérent avec convention Spring Boot)
- [ ] Stratégie : Java **ne crée pas** de nouvelles migrations pour S10–S41 (le schéma existe déjà depuis Python). Java doit **lire le schéma existant** sans le toucher.

### 8.2 État actuel à vérifier
- [ ] Toutes les migrations `/app/backend/migrations/*.sql` Python jouées en prod
- [ ] Notamment :
  - `009_pending_file_deletions.sql` (S40)
  - `011_pending_file_deletions_status.sql` (S40)
  - Migrations PostGIS si applicable
  - Colonnes lifecycle marketplace (`media_purged`, `media_purge_scheduled_at`, `reactivated_at`, `admin_reminder_sent_at`, `admin_validated_*`, etc.)

### 8.3 Audit DDL critique
- [ ] `marketplace_products.image_urls` = `jsonb` (CONFIRMÉ S41)
- [ ] `marketplace_products.tag_ids` / `pricing_modes` / `related_spotyou_ids` / `delivery_modes` = `text[]` ? `jsonb` ? — **À CONFIRMER** par `\d marketplace_products`
- [ ] `users.name` vs `users.full_name` — incohérence entre slices (S23/S24 vs S39/S41)
- [ ] `pending_file_deletions` UNIQUE constraint ? (S40 piège DB-01)

---

## 9. Front frontend `EXPO_PUBLIC_BACKEND_URL`

### 9.1 Switch progressif (recommandé)
- [ ] **Option A — Big bang** : changer `EXPO_PUBLIC_BACKEND_URL` d'un coup → tous les users sur Java
- [ ] **Option B — Feature flag** : envoyer 1% / 10% / 50% / 100% via Remote Config
- [ ] **Option C — Hybride par domaine** : Chat reste sur Python via path Python, reste sur Java
  - Front lit `EXPO_PUBLIC_BACKEND_URL_JAVA` et `EXPO_PUBLIC_BACKEND_URL_PYTHON`
  - Wrapper `lib/api.ts` route selon domaine
  - **Permet cutover partiel** sans bloquer sur Chat (B-P0-01)

### 9.2 Rollback
- [ ] **Plan de rollback** : revenir à `EXPO_PUBLIC_BACKEND_URL=python_url` documenté et testé
- [ ] OTA update Expo prêt pour push immédiat
- [ ] Limites : si DB en double (Python+Java), risque d'incohérence — privilégier 1 seule DB Supabase partagée

---

## 10. Tests E2E preprod

Les 8 flows critiques à valider AVANT cutover :

- [ ] **Flow 1** : `register → login → /auth/me` (Auth S23)
- [ ] **Flow 2** : `create SpotYou → join → going → leave` (S26+S27+S28+spot-you/going)
- [ ] **Flow 3** : `create service coach → search → reserve → accept → pay → webhook → completed` (Services + S11–S17)
- [ ] **Flow 4** : `subscribe premium → checkout → webhook → /me → cancel` (S21)
- [ ] **Flow 5** : `publish product → admin pending → approve → catalogue → DELETE → reactivate` (S38–S41)
- [ ] **Flow 6** : `chat 1-1 send/receive/read` (Chat — bloquant si non migré)
- [ ] **Flow 7** : `notifications inbox → read-all → planning-events` (Notifications + Agenda)
- [ ] **Flow 8** : `cancel booking → refund Stripe → webhook → état final` (S15+S16+S19)

---

## 11. Sécurité

- [ ] **Rate limiting** : Spring Bucket4j ou Resilience4j sur `/auth/login` (5/min) et `/auth/google` (10/min) (cf. S23)
- [ ] **Headers** sécurité : `X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options=DENY`
- [ ] **Pas de stack trace** en réponse HTTP en prod (default Spring Boot — vérifier `server.error.include-stacktrace=never`)
- [ ] **Helmet équivalent** Spring Security : `.headers().contentSecurityPolicy(...).and()`
- [ ] **Secrets management** : Kubernetes Secrets ou Vault (PAS de `.env` en clair en prod)
- [ ] **Audit log** des opérations admin (approve/reject products, change role, purge)

---

## Récapitulatif

### Items bloquants à valider absolument
1. JWT_SECRET partagé Python/Java
2. Stripe webhook bytes raw + 200 toujours
3. PostGIS version + index GiST
4. CORS allowed origins explicites (pas `*`)
5. R2 credentials + bucket accessible
6. Migrations DB jouées
7. Workers `@EnableScheduling` actifs

### Items dégradables (cutover possible avec dette)
- MediaPurgeWorker physique R2 (STUB)
- Quality slices anomalies préservées
- Endpoints non migrés via proxy hybride
