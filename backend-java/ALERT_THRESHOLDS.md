# ALERT_THRESHOLDS

Objectif: seuils uniformes pre-cutover pour decisions GO/HOLD/ROLLBACK.

## 1) API HTTP

- Warning:
  - `5xx_rate > 2%` sur 5 min
  - `4xx_rate > 20%` sur 10 min (hors endpoints auth si pic attendu)
  - `p95_latency > 800ms` sur 10 min
- Critical:
  - `5xx_rate > 5%` sur 5 min
  - `p99_latency > 1500ms` sur 10 min
- Rollback:
  - `5xx_rate > 8%` sur 5 min

## 2) Stripe Webhooks

- Warning:
  - `webhook_error_rate > 3%` sur 10 min
  - `event_processing_age > 60s`
- Critical:
  - `webhook_error_rate > 8%` sur 10 min
  - `event_processing_age > 120s`
- Rollback:
  - `webhook_error_rate > 10%` ou backlog croissant 15 min

## 3) Redis / WebSocket

- Warning:
  - close codes anormaux (`1006`,`1011`) > 5% sur 10 min
  - errors WS en hausse continue 10 min
- Critical:
  - close codes anormaux > 10% sur 10 min
  - chute > 40% connexions ouvertes avec erreurs en hausse
- Rollback:
  - close anormaux > 15% + impact utilisateur confirme

## 4) Expo Push

- Warning:
  - `push_failed_rate > 10%` sur 15 min
  - `invalid_token_disabled` > x2 baseline 30 min
- Critical:
  - `push_failed_rate > 25%` sur 15 min
- Rollback:
  - pas de rollback automatique; hold/review sauf impact metier core

## 5) Workers / Scheduled Jobs

- Warning:
  - echec job critique > 20% sur 30 min
  - retard execution > 1x interval
- Critical:
  - echec > 40% sur 30 min
  - job critique non execute > 2x interval
- Rollback:
  - backlog critique croissant 30 min + impact user/paiement confirme

## 6) DB Pool

- Warning:
  - Hikari pending threads > 0 sur 5 min
  - DB conn timeout > 0 sur 5 min
- Critical:
  - Hikari pending threads > 5 sur 5 min
  - conn timeout recurrent > 10 min
- Rollback:
  - starvation DB persistante > 5 min

## 7) JVM Memory / GC

- Warning:
  - heap used > 85% sur 10 min
  - GC pause p99 > 300ms
- Critical:
  - heap used > 92% sur 5 min
  - GC pause p99 > 800ms
- Rollback:
  - OOM ou saturation memoire persistante avec impact API

## 8) Cutover decision matrix

- GO:
  - aucune alerte critical active 30 min
  - alertes warning sous controle et tendance stable
- HOLD:
  - critical transitoire resolu mais stabilite non prouvee
- ROLLBACK:
  - au moins un critere rollback atteint
  - ou 2+ critical simultanes sur domaines differents
