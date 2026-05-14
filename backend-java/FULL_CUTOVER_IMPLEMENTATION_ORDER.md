# FULL_CUTOVER_IMPLEMENTATION_ORDER

Date: 2026-05-08  
Objectif: finir tout ce qui bloque un **cutover complet Java-only**, sans split-routing.

## Ordre exact recommande

## Phase 0 - Preconditions (obligatoire avant dev lourd)
1. Verrouiller l'objectif: cutover complet uniquement, pas de coexistence longue Python.
2. Geler les changements front contractuels non necessaires.

## Phase 1 - Securite et verrouillage platforme (P0)
1. `P0-01` Stripe webhook secret obligatoire.
2. `P0-02` Security deny-by-default (sortir de `permitAll` global).
3. `P0-03` WS origins whitelist.

Dependances:
- Phase 1 doit etre terminee avant toute validation prod-like.

## Phase 2 - Runtime critique temps reel/media (P0)
4. `P0-04` Push reel (chat/notifications/spotyou).
5. `P0-05` WS multi-instance distribue.
6. `P0-06` Strategie media finale (R2-only ou `/api/uploads/**` robuste).
7. `P0-07` Purge physique marketplace reelle.

Dependances:
- `P0-05` depend de decisions infra (broker/bus).
- `P0-06` depend de decision storage definitive.
- `P0-07` depend de `P0-06` si memes artefacts storage.

## Phase 3 - Contrats front et stabilite metier (P0/P1)
8. `P0-08` Normalisation erreurs (shape/status critiques).
9. `P1-01` Aliases legacy (ou preuve de non-utilisation cote front).
10. `P1-02` Tests concurrency paiements/webhooks.
11. `P1-03` Tests workers reprise/contention.

Dependances:
- `P0-08` doit preceder les validations front finales.
- `P1-02` s'appuie sur Phase 1 et 2 stables.

## Phase 4 - Robustesse et observabilite (P1)
12. `P1-04` Garanties @Async (retry/metrics).
13. `P1-05` Validation perf SQL/PostGIS.
14. `P1-06` Soak tests WS.
15. `P1-07` Dashboards/alerting + runbook incidents.

Dependances:
- Phase 4 doit etre complete avant go/no-go final.

## Phase 5 - Hardening final (P2)
16. `P2-01` Conformite payload naming.
17. `P2-02` Harmonisation validation status codes.
18. `P2-03` Runbook full cutover/rollback Java-only.
19. `P2-04` Audit securite externe.

## Gate final obligatoire
20. Executer `FULL_CUTOVER_GO_NO_GO_CHECKLIST.md` a 100%.
21. No-Go automatique si un item P0 ou P1 est incomplet.

## Ce qui doit etre fait avant quoi (resume dependencies)

- **Security first**: Phase 1 avant tout.
- **Runtime infra second**: Phase 2 avant tests de charge et front sign-off.
- **Contrats third**: Phase 3 avant recette front globale.
- **Observability before launch**: Phase 4 avant go/no-go.
- **Hardening last**: Phase 5 avant bascule definitive.
