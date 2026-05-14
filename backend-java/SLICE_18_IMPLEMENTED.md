# Slice 18 — ExpiryWorker (async/workers)

## Composants créés

- Scheduler :
  - `config/SchedulingConfig` (`@EnableScheduling`)
  - `modules/workers/service/ExpiryWorkerScheduler`
- Service métier :
  - `modules/workers/service/ExpiryWorkerService`
- Repository natif :
  - `modules/workers/infra/ExpiryWorkerRepository`
- Stripe (hors transaction) :
  - `modules/payments/stripe/StripePaymentService` (SDK réel, slice 19 — même bean que le module bookings)

## Fréquence et démarrage

- Tick immédiat au démarrage via `@EventListener(ApplicationReadyEvent)`.
- Tick périodique via `@Scheduled` toutes les `expiry.worker.interval.secs` secondes.
- Valeurs configurables :
  - `expiry.worker.enabled` (défaut `true`)
  - `expiry.worker.interval.secs` (défaut `60`)
- Profil test : worker désactivé par défaut (`application-test.yml`) pour éviter les effets de bord inter-tests.

## Comportement métier implémenté

- Batch size strict : `50`.
- Drain loop strict : `processBatch(50)` tant que `count >= 50`.
- Requête de sélection native avec lock :
  - `FOR UPDATE OF b SKIP LOCKED`
  - `ORDER BY b.expires_at ASC`
  - `LIMIT 50`
- Transitions DB :
  - `bookings` : `requested|awaiting_payment -> expired` (guard idempotent)
  - `service_slots` : `pending|reserved -> available` uniquement pour `slot_type in ('single','specific')`
  - `payments` : `requires_authorization|authorized|capture_pending -> cancelled`
- Notifications DB (2 inserts/booking) :
  - payer + receiver
  - textes asymétriques selon `booking_status`
  - fallback `service_title="un service"` si service introuvable
  - `notif_id` formaté `ntf_` + 12 hex chars
- Stripe :
  - annulation PI hors transaction (après commit DB)
  - erreurs Stripe avalées (log uniquement, pas de rollback)

## Schéma de test ajusté

- `test-schema-users.sql` :
  - ajout table `notifications` (nécessaire au flow worker)

## Tests ajoutés

- `ExpiryWorkerServiceIntegrationTest`
  - batch simple
  - drain backlog `>50`
  - idempotence
  - cas payment absent
  - slot libéré
  - payment annulé
  - Stripe post-commit + erreur non bloquante
  - concurrence (2 appels simultanés sans double processing)
- `ExpiryWorkerSchedulerStartupTest`
  - tick startup exécuté immédiatement

## Validation

- `mvn -Dtest=ExpiryWorkerServiceIntegrationTest,ExpiryWorkerSchedulerStartupTest test` ✅
- `mvn test` ✅ (non-régression ; voir slice 19 pour Stripe réseau booking)
