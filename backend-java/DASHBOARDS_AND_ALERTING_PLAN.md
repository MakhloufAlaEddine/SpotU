# DASHBOARDS_AND_ALERTING_PLAN

Scope: P1-07 uniquement (observabilite pre-cutover Java-only).

Artefacts techniques lies:
- `PROMETHEUS_SCRAPE_EXAMPLE.yml`
- `GRAFANA_DASHBOARD_MINIMAL.md`
- `PROMETHEUS_ALERT_RULES_EXAMPLE.yml`

## 1) Dashboard API Core

Panels:
- Requetes HTTP par route/status (`2xx/4xx/5xx`)
- Taux `5xx` global et par endpoint critique
- Latence `p50/p95/p99` globale et par endpoint critique
- Throughput (`req/s`)

Alertes:
- `5xx_rate > 2%` sur 5 min (warning)
- `5xx_rate > 5%` sur 5 min (critical -> rollback evaluation)
- `p95_latency > 800ms` sur endpoints critiques 10 min (warning)
- `p99_latency > 1500ms` 10 min (critical)

## 2) Dashboard Stripe / Webhooks

Panels:
- Volume events webhook (`received`, `success`, `error`, `idempotent_skip`)
- Age max des events en `processing`
- Erreurs signature webhook (`400`)
- Latence traitement webhook (si timer dispo via logs/metrics)

Alertes:
- `webhook_error_rate > 3%` sur 10 min (warning)
- `webhook_error_rate > 8%` sur 10 min (critical)
- `processing_event_age > 120s` (critical)

## 3) Dashboard Redis / WebSocket

Panels:
- Connexions WS ouvertes (chat/notif/spotyou)
- Ouvertures/fermetures par minute
- Distribution `close codes`
- Erreurs WS (handshake/auth/transport)
- Redis pub/sub errors (si exposees)

Alertes:
- `abnormal_close_code_rate(1006/1011) > 5%` sur 10 min (warning)
- `abnormal_close_code_rate > 10%` sur 10 min (critical)
- chute brutale `connections_opened` avec hausse erreurs (critical)

## 4) Dashboard Push Expo

Panels:
- `attempted/sent/failed/invalid_token_disabled` (chat/notif/spotyou)
- Taux echec push
- Invalid tokens par minute

Alertes:
- `push_failed_rate > 10%` sur 15 min (warning)
- `push_failed_rate > 25%` sur 15 min (critical)
- `invalid_token_spike` > x3 baseline sur 30 min (warning)

## 5) Dashboard Workers / Schedulers

Panels:
- Executions worker par job (count, duration)
- Success/failure par tick
- Backlog taille (`pending_file_deletions`, etc.)
- Expiry worker processed count

Alertes:
- job critique non execute depuis >2x interval (critical)
- echec job > 20% sur 30 min (warning), >40% (critical)
- backlog monotone croissant 30 min (warning)

## 6) Dashboard DB Pool + JVM

Panels:
- Hikari active/idle/pending threads
- DB connection timeout count
- JVM heap used/max
- GC pause (`count`, `sum`, `max`)
- CPU load process

Alertes:
- Hikari pending threads > 0 durable 5 min (warning), >5 (critical)
- heap usage > 85% 10 min (warning), >92% 5 min (critical)
- GC pause p99 > 300ms (warning), >800ms (critical)

## 7) Cutover / Rollback thresholds

Pendant la fenetre cutover:
- rollback immediat si:
  - `5xx_rate > 8%` sur 5 min
  - webhook Stripe erreurs > 10% sur 10 min
  - WS close anormaux > 15% sur 10 min
  - DB pool starvation continue > 5 min
- hold/review (pas rollback immediat) si:
  - p95 latence > 1s sur 15 min
  - push_failed_rate > 20% sur 15 min

## 8) Ownership

- API/HTTP + JVM: Backend on-call
- Stripe webhooks: Payments owner
- Redis/WS: Realtime owner
- Push Expo: Mobile + backend owner
- Workers: Platform/backend owner
