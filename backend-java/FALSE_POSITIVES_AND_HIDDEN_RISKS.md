# FALSE_POSITIVES_AND_HIDDEN_RISKS

Date: 2026-05-08

## Faux positifs probables (tests verts, prod cassable)

1. **Workers "passes" mais couverture superficielle**
- `MarketplaceMediaPurgeSchedulerTest`, `AdminProductReminderSchedulerTest`, `ExpiryWorkerSchedulerStartupTest` sont courts (1 scenario principal).
- Peu de tests de contention, reprise apres crash, multi-instance, latence DB.

2. **WebSocket tests partiels**
- `ChatWebSocketIntegrationTest` couvre surtout close codes (4001/4003/4009).
- Pas de test de diffusion multi-instance (cross-node impossible avec registry local).
- Pas de test charge/soak long-lived connections.

3. **Split-routing peu valide en runtime complet**
- Les tests valident les domaines applicatifs, pas la strategie de routage infra (gateway rules/canary/rollback data consistency).

4. **Push "fonctionnel" en apparence**
- API 200 OK ne garantit pas delivery device.
- Plusieurs flux sont explicitement no-op/stub.

5. **Stripe "OK en tests" != resilient en prod**
- Concurrence inter-services (ex: webhook + polling checkout status) peu testee a fort volume.
- Gestion de signature dependante env var; erreur de config = fail-open partiel.

## Risques caches non evidents dans les docs

## Runtime infra

- **WS origin permissif**: `setAllowedOriginPatterns("*")` sur les endpoints WS.
- **Securite globale permissive**: `anyRequest().permitAll()`.
- **Side effects async**: `@Async` sans guarantees e2e delivery/ordering.

## Data consistency

- Race potentielle entre workers et actions utilisateurs (reactivate/delete, reminders, purge).
- Dependance a gardes SQL/idempotence; robuste mais pas prouvee sous charge reel.

## Compatibilite front/mobile

- Variabilite forte des payloads d'erreur selon domaine.
- Alias legacy absents pouvant casser clients non alignes.
- Mobile Expo: support token present mais pipeline push concret incomplet sur flux cles.

## Prod-only risks prioritaires

1. Mauvaise config secrets (`JWT_SECRET`, `STRIPE_WEBHOOK_SECRET`) en environnement cible.
2. Drift PostGIS en prod (extension/DDL/perf plans) mal reproduit en H2 test.
3. URL media non resolues en fallback local sans `/api/uploads/**`.
4. WS partiellement silencieux en cluster (sessions sur pods differents).
5. Backpressure/perf sur requetes lourdes sans tests de charge.
