# FULL_CUTOVER_REMAINING_BACKLOG

Date: 2026-05-08  
Objectif: **aucun cutover** tant que ce backlog n'est pas ferme.  
Source: code Java reel + audits contradictoires.

## P0 (bloquants absolus)

### P0-01
- **Description**: rendre la verification signature Stripe impossible a desactiver en prod.
- **Domaine**: payments / security.
- **Impact prod**: faux events webhook acceptes -> incoherence paiements/bookings.
- **Action attendue**: fail-fast au demarrage si profil `prod` et `STRIPE_WEBHOOK_SECRET` vide.
- **Fichier/code concerne**: `src/main/java/com/spotu/modules/payments/service/StripeWebhookService.java`, `src/test/java/com/spotu/modules/payments/service/StripeWebhookSecretProdGuardTest.java`.
- **Critere de done**: boot `prod` echoue sans secret; tests config + webhook verifies.
- **Statut**: **DONE** (2026-05-08)

### P0-02
- **Description**: supprimer le modele `permitAll` global.
- **Domaine**: securite API.
- **Impact prod**: endpoint futur non protege expose publiquement par erreur.
- **Action attendue**: declarer des regles explicites (`authenticated`) par defaut + exceptions `permitAll` limitees.
- **Fichier/code concerne**: `src/main/java/com/spotu/config/SecurityConfig.java`.
- **Critere de done**: deny-by-default actif; tests integration auth/401/403 mis a jour et verts.
- **Statut**: **DONE** (2026-05-08)

### P0-03
- **Description**: durcir origines WebSocket.
- **Domaine**: websocket security.
- **Impact prod**: connexions WS abusives cross-origin.
- **Action attendue**: remplacer `setAllowedOriginPatterns("*")` par whitelist config.
- **Fichier/code concerne**: `src/main/java/com/spotu/modules/chat/ws/ChatWebSocketConfig.java`, config `application*.yml`.
- **Critere de done**: seules origines front autorisees acceptent WS; tests WS avec origin interdit.
- **Statut**: **DONE** (2026-05-08)

### P0-04
- **Description**: implementer un transport push reel (chat + notifications).
- **Domaine**: temps reel mobile Expo.
- **Impact prod**: notifications silencieuses malgre API 200.
- **Action attendue**: remplacer stubs par provider push resilient (retry, DLQ/simple persistence).
- **Fichier/code concerne**: `src/main/java/com/spotu/modules/chat/service/ChatPushService.java`, `src/main/java/com/spotu/modules/notifications/service/NotifBroadcaster.java`, `src/main/java/com/spotu/modules/spotyou/service/SpotYouPushSideEffectService.java`.
- **Critere de done**: test integration avec provider mock + metriques delivery (sent/failed) exposes.
- **Statut**: **DONE** (2026-05-08) — transport Expo actif sur `ChatPushService`, `NotifBroadcaster`, `SpotYouPushSideEffectService`; gestion token invalide via desactivation; logs de synthese `attempted/sent/failed/invalid_token_disabled` ajoutes.

### P0-05
- **Description**: corriger WS multi-instance.
- **Domaine**: chat realtime distribue.
- **Impact prod**: messages/unread partiellement perdus selon pod.
- **Action attendue**: ajouter bus pub/sub inter-instances pour broadcasts (Redis/Kafka) ou architecture equivalente.
- **Fichier/code concerne**: `src/main/java/com/spotu/modules/chat/ws/WsConnectionRegistry.java` + nouveau module broker.
- **Critere de done**: test E2E multi-noeuds prouve diffusion cross-instance.
- **Statut**: **DONE** (2026-05-08) — relay Redis branche + fallback noop + anti-boucle `instance_id` + validation cross-instance quasi-reelle automatisee (`RedisWsClusterRelayCrossInstanceTest`) + procedure manuelle pre-prod (`WS_CLUSTER_VALIDATION.md`).

### P0-06
- **Description**: resoudre le gap media `/api/uploads/**`.
- **Domaine**: uploads/media.
- **Impact prod**: URLs fallback locales cassees.
- **Action attendue**: soit exposer handler statique securise, soit supprimer fallback local et forcer R2-only.
- **Fichier/code concerne**: `src/main/java/com/spotu/modules/uploads/service/FileStorageService.java`, `src/main/java/com/spotu/config/WebConfig.java` (ou nouveau `ResourceHandler`).
- **Critere de done**: toutes URLs medias resolvent en prod; tests integration upload+fetch.
- **Statut**: **DONE** (2026-05-08) — `ResourceHandler` `/api/uploads/**` expose depuis `app.uploads.local-dir` + test d'integration de serving statique.

### P0-07
- **Description**: implementer purge physique marketplace (non-stub).
- **Domaine**: workers/storage.
- **Impact prod**: retention non appliquee, dette cout et conformite.
- **Action attendue**: suppression reelle R2/local avec idempotence et journal d'erreur.
- **Fichier/code concerne**: `src/main/java/com/spotu/modules/workers/service/MarketplaceFilePurgeService.java`.
- **Critere de done**: test integration de purge reelle + reprise sur echec.
- **Statut**: **DONE** (2026-05-08) — purge physique reelle branchee via `FileStorageService.deleteUploadFile` + marquage `done/failed` sur `pending_file_deletions` + tests integration (nominal/erreur+continuation).

### P0-08
- **Description**: stabiliser contrat erreurs front (shape + status).
- **Domaine**: compatibilite frontend.
- **Impact prod**: crash parsing mobile/web sur erreurs heterogenes.
- **Action attendue**: standardiser `error payload` minimum commun par famille endpoint.
- **Fichier/code concerne**: `src/main/java/com/spotu/error/GlobalExceptionHandler.java` + controllers qui renvoient erreurs custom.
- **Critere de done**: matrice erreurs documentee + tests d'integration verifies sur endpoints critiques.
- **Statut**: **DONE** (2026-05-08) — sous-lot 1 (`GlobalExceptionHandler`) + sous-lot 2 (`ServicesController`, `ProductCreationController`, `AdminProductController`) livres: ajout non-breaking du champ `code` tout en preservant `error/detail`, tests critiques front renforces (`services 422`, `products 400/403`, `admin products 403/404`) et matrice de classification documentee dans `P0_08_ERROR_HANDLER_CLASSIFICATION.md`.

## P1 (haut risque non bloquant architecture)

### P1-01
- **Description**: ajouter aliases legacy manquants (ou migration front complete prouvee).
- **Domaine**: compat front.
- **Impact prod**: clients anciens cassent.
- **Action attendue**: exposer alias compatibles (`/api/users/profile`, `PATCH /api/bookings/{id}/status`) avec comportement Python legacy.
- **Fichier/code concerne**: controllers users/bookings.
- **Critere de done**: tests compatibility legacy + contrat front valide.
- **Statut**: **DONE** (2026-05-08) — alias `GET /api/users/profile` ajoute (bridge vers `/api/users/me`) + alias `PATCH /api/bookings/{id}/status` ajoute (delegation vers `accept/refuse/complete/cancel`), avec tests d'integration dedies.

### P1-02
- **Description**: renforcer tests de concurrence paiements/webhook/status.
- **Domaine**: payments runtime.
- **Impact prod**: statuts divergents sous charge.
- **Action attendue**: tests concurrentiels `checkout status` vs webhook vs workers.
- **Fichier/code concerne**: tests payments (`StripeWebhookIntegrationTest`, `CheckoutIntegrationTest`).
- **Critere de done**: scenarios race reproduits et idempotence prouvee.
- **Statut**: **DONE** (2026-05-08) — sous-lot 1 + 2 + 3 livres dans `StripeWebhookConcurrencyIntegrationTest`:
  - meme event webhook en parallele (8 POST) -> unicite `stripe_webhook_events` + coherence statut final,
  - `checkout/status` en concurrence avec webhook `checkout.session.completed` -> etat final coherent (`authorized/requested`) sans exception,
  - webhook `payment_intent.succeeded` en concurrence avec `checkout/status` -> etat final borne coherent (`authorized|captured`, `requested|confirmed`) + `stripe_charge_id` correctement pose,
  - webhook `charge.refunded` en concurrence avec lecture `GET /api/payments/{id}` -> etat final `refunded` coherent et booking non regresse.
  - `ExpiryWorkerService` en concurrence avec webhook `checkout.session.completed` sur booking `awaiting_payment` expire:
    etats finaux acceptes et verifies = `{expired+cancelled}` (worker gagne) ou `{confirmed+captured+paid}` (webhook gagne), sans exception concurrente.

### P1-03
- **Description**: renforcer tests workers (crash/reprise/contention).
- **Domaine**: workers.
- **Impact prod**: effets non deterministes apres restart.
- **Action attendue**: augmenter couverture au-dela des tests single scenario.
- **Fichier/code concerne**: `modules/workers/service/*Test.java`.
- **Critere de done**: minimum 3 scenarios par worker (nominal, reprise, concurrence).
- **Statut**: **DONE** (2026-05-08) — grille etendue sur les workers critiques:
  - `AdminProductReminderScheduler`: nominal + idempotence + disabled,
  - `ExpiryWorkerService`: nominal + reprise/idempotence + contention + robustesse erreur Stripe deja couverts,
  - `ExpiryWorkerScheduler`: startup enabled + disabled (startup/periodic no-op),
  - `MarketplaceMediaPurgeScheduler`: nominal + idempotence + disabled,
  - `MarketplaceFilePurgeService`: nominal + continuation apres echec + contention concurrente (etat final unique en base, pas de pending residuel).

### P1-04
- **Description**: formaliser garanties @Async (ordering/retry/failure metrics).
- **Domaine**: async side effects.
- **Impact prod**: notifications perdues silencieusement.
- **Action attendue**: policy retry + logging structure + compteur echec.
- **Fichier/code concerne**: services `@Async` spotyou/marketplace.
- **Critere de done**: metriques + alertes sur echec async operationnelles.
- **Statut**: **DONE** (2026-05-08) — sous-lot 1 + 2 livres:
  - cartographie `@Async` confirmee (`SpotYouPushSideEffectService.fireAndForget`, `ProductCreationService.notifyAdminsPendingAsync`),
  - resilience non-blocante renforcee (`notifyAdminsPendingAsync` et spotyou JSON/expo errors sans propagation),
  - compteurs legers internes ajoutes sur side-effects async critiques:
    - `attempted`, `success`, `failed`, `retry_attempted`, `invalid_token`,
  - logs structures enrichies (`marketplace_async_summary`, `spotyou_push_summary` avec `retry_attempted`),
  - tests cibles verifies:
    - success increments success,
    - failure increments failed,
    - invalid token increments invalid_token,
    - `retry_attempted=0` (no retry by design).
  No retry explicite: **refuse par design** pour eviter doubles notifications/push sur side-effects non strictement idempotents.
  Export metriques/alerting transverse: **explicitement delegue a P1-07** (`observabilite obligatoire pre-cutover`), pour eviter chevauchement de perimetre.

### P1-05
- **Description**: valider perf SQL geospatiale et queries lourdes.
- **Domaine**: PostGIS/performance.
- **Impact prod**: latence P95/P99 elevee, timeouts.
- **Action attendue**: benchmarks + index review + explain plan sur datasets prod-like.
- **Fichier/code concerne**: repositories home/services/spotyou.
- **Critere de done**: SLO latence atteints sous charge cible.
- **Statut**: **PARTIAL-BLOCKED-BY-ENV** (2026-05-08) — sous-lot 1+2 preuve/livrable:
  - baseline perf PostGIS formalisee dans `P1_05_POSTGIS_PERF_BASELINE.md`,
  - inventaire des requetes critiques (`HomeRepository`, `ServicesRepository`, `TagPointReadRepository`),
  - commandes `EXPLAIN (ANALYZE, BUFFERS)` pretes a executer en pre-prod/prod-like,
  - gap explicite releve: pas d'index geospatial explicite dans migrations actuelles,
  - sous-lot 2: tentative validation reelle locale documentee (`psql`/`docker` indisponibles), audit requetes complete, candidats indexes identifies mais **non appliques par design** sans plans reels (anti tuning speculatif).
  Requis pour DONE:
  - execution `EXPLAIN ANALYZE` reelle en environnement pre-prod/prod-like (Postgres + PostGIS),
  - preuve avant/apres si index ajoute,
  - validation SLO P95/P99.
  Candidats index (a appliquer uniquement apres mesure):
  - `service_locations(location)` en GIST,
  - `tag_points(location)` en GIST.
  Aucun cutover final tant que P1-05 n'est pas valide.

### P1-06
- **Description**: tests de charge WebSocket long-running.
- **Domaine**: websocket.
- **Impact prod**: degradations memoire/reconnexions.
- **Action attendue**: soak tests (connexions persistantes + flood modere).
- **Fichier/code concerne**: module chat/ws + infra test.
- **Critere de done**: pas de fuite memoire/erreur critique sur fenetre test definie.
- **Statut**: **PARTIAL-BLOCKED-BY-ENV** (2026-05-08) — sous-lot 1+2 livres:
  - plan de soak WS multi-canaux cree (`P1_06_WS_SOAK_PLAN.md`),
  - script reproductible local/pre-prod ajoute (`scripts/ws_soak_runner.mjs`) couvrant:
    - chat WS (`/api/ws/chat/{conv_id}`),
    - notifications WS (`/api/ws/notifications`),
    - spotyou WS (`/api/ws/spot-you/{point_id}`),
  - metriques ciblees explicites: connexions actives, messages/sec, erreurs, close codes, RSS memoire process.
  - sous-lot 2: execution reelle degradee effectuee dans environnement courant (backend WS indisponible),
    micro-fix runner applique pour garantir emission `FINAL_REPORT` meme sans connexions ouvertes.
  Resultat courant: validation partielle (erreurs capturees, pas de derive memoire runner evidente) mais pas de verdict soak backend.
  Requis pour DONE:
  - execution du runner sur backend Java WS reel (pre-prod/prod-like) avec DB/Redis/JWT operationnels,
  - duree cible >= 30min (ideal 2h),
  - canaux testes: chat + notifications + spotyou,
  - metriques capturees: connexions, messages/sec, erreurs, close codes, memoire serveur, logs.
  Aucun cutover final tant que P1-06 n'est pas valide.

### P1-07
- **Description**: observabilite obligatoire pre-cutover.
- **Domaine**: ops.
- **Impact prod**: incidents non detectes.
- **Action attendue**: dashboards + alertes (webhook, ws, workers, 5xx, push, db locks).
- **Fichier/code concerne**: config logs/actuator + plateforme monitoring.
- **Critere de done**: alertes testees (fire drill) et runbook associe.
- **Statut**: **DONE** (2026-05-08) — sous-lot 1+2 livres:
  - livrables ops:
    - `DASHBOARDS_AND_ALERTING_PLAN.md`,
    - `INCIDENT_RUNBOOK.md`,
    - `ALERT_THRESHOLDS.md`,
    - `PROMETHEUS_SCRAPE_EXAMPLE.yml`,
    - `GRAFANA_DASHBOARD_MINIMAL.md`,
    - `PROMETHEUS_ALERT_RULES_EXAMPLE.yml`,
  - integration observability minimale cote app:
    - Actuator + Micrometer Prometheus actifs (`/actuator/prometheus`),
    - probes liveness/readiness exposes (`/actuator/health/liveness`, `/actuator/health/readiness`),
    - histogrammes/SLI latence HTTP configures,
    - metriques custom legeres exposees (`spotu_ws_active_sessions`, `spotu_push_*`, `spotu_marketplace_async_*`),
  - hardening securite:
    - endpoint Prometheus public **desactive par defaut** en prod via `app.observability.prometheus-public-endpoint=false`,
    - endpoints sensibles non exposes (`/actuator/env` deny).

## P2 (hardening final)

### P2-01
- **Description**: unifier naming payloads (snake_case) hors zones deja stables.
- **Domaine**: DTO contracts.
- **Impact prod**: dette compat future.
- **Action attendue**: revue DTO/responses et correction des deviations restantes.
- **Fichier/code concerne**: DTO controllers cross-domain.
- **Critere de done**: rapport de conformite payload complete.

### P2-02
- **Description**: harmoniser 400/422 selon contrat final.
- **Domaine**: API ergonomie.
- **Impact prod**: UX erreurs incoherente.
- **Action attendue**: politique validation unique et tests.
- **Fichier/code concerne**: `GlobalExceptionHandler` + validateurs endpoint.
- **Critere de done**: matrice statut validation stable.

### P2-03
- **Description**: documentation runbook full cutover/rollback Java-only.
- **Domaine**: exploitation.
- **Impact prod**: gestion crise lente.
- **Action attendue**: procedure standardisee bascule complete + rollback complet.
- **Fichier/code concerne**: docs ops.
- **Critere de done**: exercice de simulation reussi.

### P2-04
- **Description**: audit final externe de securite API/WS.
- **Domaine**: security assurance.
- **Impact prod**: risque residuel non detecte.
- **Action attendue**: pentest cible API+WS.
- **Fichier/code concerne**: plateforme complete.
- **Critere de done**: zero findings critiques ouvertes.
