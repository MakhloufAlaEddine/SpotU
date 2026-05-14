# SPLIT_ROUTING_PLAN

Date: 2026-05-08  
Mode cible: cutover progressif Python -> Java par domaine.

## Classification domaines

## SAFE_TO_SWITCH

- Auth
- Users (profile/public/follow/block/reviews)
- Config/Referential/Home
- SpotYou (read/write/lifecycle/membership)
- Services (read/write/slots/packages/save)
- Marketplace (public/seller/admin)
- Bookings
- Payments + Stripe webhook
- Subscriptions
- Notifications inbox REST
- Chat REST + WebSocket core

## PARTIAL

- Uploads (upload OK, static serving local non expose).
- Push/temps reel notif (composants encore stub/no-op).
- WebSocket horizontal scaling (registry local au process).

## KEEP_ON_PYTHON (phase initiale recommandee)

- Push device critiques tant que pipeline Java n'est pas complete.
- Serving media local legacy si client depend de `/api/uploads/**` et R2 pas force.

## Sequence de bascule recommandee

1. **Wave 1 (risque faible)**  
Auth, users, config, referential, home.

2. **Wave 2 (metier coeur)**  
services, spotyou, marketplace reads/writes.

3. **Wave 3 (transactionnel paiement)**  
bookings, payments checkout/status, webhook Stripe, subscriptions.

4. **Wave 4 (temps reel)**  
chat/ws + notifications inbox, avec monitorings renforces.

5. **Wave 5 (zones PARTIAL)**  
uploads legacy + push transport reel + ws multi-instance.

## Garde-fous execution

- Routage par domaine/chemin (gateway rules explicites).
- Canary traffic progressif (5% -> 25% -> 50% -> 100%).
- Health gates: `liveness/readiness` + taux 5xx + latence P95.
- Rollback instantane par route map.
- Webhook Stripe: bascule atomique et unique endpoint actif.

## Exit criteria par wave

- 0 regression fonctionnelle front observee 24h.
- 0 augmentation significative 4xx/5xx.
- Pas de divergence donnees critiques (payments/bookings/subscriptions).
- Runbook rollback valide en repetable.
