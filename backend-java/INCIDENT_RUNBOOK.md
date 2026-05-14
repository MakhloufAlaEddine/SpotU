# INCIDENT_RUNBOOK

Scope: incidents backend-java pre-cutover et post-cutover.

## 1) Niveaux severite

- SEV-1: indisponibilite majeure user-facing ou paiements incoherents
- SEV-2: degradation forte mais service partiellement operationnel
- SEV-3: anomalie limitee avec workaround

## 2) Process incident standard

1. Detecter (alerte monitoring ou signal support).
2. Qualifier impact (routes, utilisateurs, scope geographique, paiements).
3. Stabiliser (feature flag, throttling, rollback cible si seuil depasse).
4. Communiquer (canal incident, status updates cadence 15 min).
5. Corriger / contourner.
6. Valider retour a la normale.
7. Postmortem (<48h).

## 3) Playbooks par domaine

### A. HTTP 5xx/latence

Symptomes:
- 5xx spike
- p95/p99 latence degradee

Actions:
- verifier saturation DB pool/JVM
- isoler endpoint(s) dominant(s)
- reduire charge (rate-limit si disponible)
- si seuil rollback atteint: rollback cutover Java

Verification sortie:
- 5xx < 2% stable 30 min
- p95 revenu sous seuil

### B. Stripe webhooks

Symptomes:
- hausse erreurs webhook/signature
- retard traitement events

Actions:
- verifier secret/horloge/env
- verifier latence DB et locks
- controler idempotence (`stripe_webhook_events`)
- si erreur webhook > seuil critique: suspendre cutover, rollback

Verification sortie:
- backlog events stable/diminue
- error rate revenu sous warning

### C. Redis / WebSocket

Symptomes:
- deconnexions massives
- close codes anormaux (1006/1011)
- messages non diffuses cross-instance

Actions:
- verifier sante Redis pub/sub
- verifier saturation instances WS
- confirmer fallback/noop non active par erreur en prod
- si perte realtime critique persistante: rollback

Verification sortie:
- close code distribution normalisee
- connexions stables 30 min

### D. Expo Push

Symptomes:
- `push_failed` en hausse
- `invalid_token_disabled` anormal

Actions:
- verifier connectivite Expo/API
- inspecter erreurs transport
- confirmer non-blocage des flows metier
- pas de retry non-idempotent force

Verification sortie:
- success rate redevenu normal
- pas de blocage API metier

### E. Workers / Scheduled Jobs

Symptomes:
- job non execute
- backlog qui augmente
- echec repetitif par tick

Actions:
- verifier scheduler active
- verifier locks/transactions
- relancer job de maniere controlee
- si impact large et non maitrise: rollback

Verification sortie:
- backlog baisse
- echec job sous seuil warning

### F. DB pool / JVM GC

Symptomes:
- threads en attente Hikari
- memory pressure / GC pauses longues

Actions:
- verifier charge et queries lourdes
- reduire trafic si necessaire
- redimensionner ressources si safe
- rollback si starvation persistante

Verification sortie:
- pending threads a 0
- heap/GC revenus en zone stable

## 4) Conditions de rollback cutover

Rollback immediat si un critere critique persiste >5-10 min:
- 5xx > 8%
- webhook errors > 10%
- WS abnormal close > 15%
- DB pool starvation persistante

## 5) Evidence minimale a collecter

- timestamp debut/fin incident
- captures dashboards concernes
- logs representatifs
- endpoints/features impactes
- decision prise (hold/rollback) + raison
