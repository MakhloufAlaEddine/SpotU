# FULL_CUTOVER_GO_NO_GO_CHECKLIST

Date: 2026-05-08  
Regle: **NO-GO automatique** si une case critique n'est pas validee.

## A. Gates P0 (tous obligatoires)

- [x] A1 `STRIPE_WEBHOOK_SECRET` obligatoire en prod (fail-fast prouve).
- [x] A2 Security deny-by-default actif (plus de `anyRequest().permitAll()` global).
- [x] A3 WS origins whitelist active (plus de wildcard).
- [x] A4 Push reel implemente (pas de no-op sur flux critiques).
- [x] A5 WS multi-instance distribue valide par test cross-instance.
- [x] A6 Strategie media finale active (R2-only ou `/api/uploads/**` robuste).
- [x] A7 Purge physique marketplace operationnelle (non-stub).
- [x] A8 Contrat erreurs front stabilise sur domaines critiques. _(global + handlers custom marketplace/services/admin alignes en non-breaking avec `code` + `error/detail`, matrice documentee)_

## B. Gates P1 (tous obligatoires avant go complet)

- [x] B1 Compat legacy traitee (alias actifs ou preuve formelle de non-usage client).
- [x] B2 Tests concurrence paiements/webhooks ajoutés et verts.
- [x] B3 Tests workers reprise/contention ajoutes et verts.
- [ ] B4 Soak test WS passe sur fenetre cible. _(PARTIAL-BLOCKED-BY-ENV: backend WS reel requis avec DB/Redis/JWT; run >=30min (ideal 2h) sur chat/notif/spotyou + metriques connexions/messages/sec/erreurs/close codes/memoire/logs; no final cutover tant que B4 non valide)_
- [ ] B5 Validation perf PostGIS/queries lourdes conforme SLO. _(PARTIAL-BLOCKED-BY-ENV: EXPLAIN ANALYZE Postgres/PostGIS reel requis pour DONE; candidats index GIST documentes `service_locations.location`, `tag_points.location`; no final cutover tant que B5 non valide)_
- [x] B6 Observabilite complete (dashboards+alerting) et testee. _(P1-07 livre: Actuator+Prometheus+probes + metriques custom WS/push/async + exemples scrape/dashboard/alerts + runbook; endpoint Prometheus securise via flag `app.observability.prometheus-public-endpoint`, sensible endpoints non exposes.)_
- [x] B7 Gestion @Async instrumentee (retry/metrics/alertes). _(garanties minimales async validees: non-blocage + compteurs + logs + no-retry-by-design documente/teste; export dashboards/alerting explicitement traite par B6/P1-07)_

## C. Validation systeme complete

- [ ] C1 `mvn test` vert apres tous changements.
- [ ] C2 Test e2e front mobile/web complet sans Python fallback.
- [ ] C3 Verification push mobile Expo en environnement prod-like.
- [ ] C4 Verification webhooks Stripe en conditions reelles sandbox.
- [ ] C5 Verification worker periodicite + reprise apres restart.
- [ ] C6 Verification WS sous plusieurs instances applicatives.

## D. Readiness exploitation

- [ ] D1 Runbook incident/severity valide par l'equipe.
- [ ] D2 Procedure rollback complete documentee et repetee.
- [ ] D3 Owners on-call identifies par domaine (payments/ws/workers/storage).
- [ ] D4 Alarmes critiques routees (pager/chatops) et testees.

## E. Decision finale

- **GO** seulement si A+B+C+D = 100% OK.
- **NO-GO** si au moins une case A ou B est non validee.
- **NO-GO** si des stubs critiques restent actifs (`ChatPushService`, `NotifBroadcaster`, `MarketplaceFilePurgeService`).
