# REAL_SAFE_TO_SWITCH

Date: 2026-05-08  
Regle de classement: "SAFE" = front operationnel + risques runtime acceptables sans dependance cachee Python.

## SAFE_NOW

- Auth (`/api/auth/*`, `/api/auth/me`)
- Users social/profile/public/reviews/follow/block
- Config + Referential + Home
- SpotYou (read/write/lifecycle/membership)
- Services (reads/writes/slots/packages/save)
- Marketplace CRUD/admin (hors purge physique media)
- Bookings core
- Payments reads + checkout + webhook metier
- Subscriptions (user/admin/webhook)

Conditions implicites:
- secrets correctement configures,
- Postgres/PostGIS conformes.

## SAFE_WITH_MONITORING

- Chat REST
- Chat WS (single-instance ou sticky sessions strictes)
- Notifications inbox REST
- Workers expiry/reminder/purge logique

Monitoring obligatoire:
- latence P95/P99,
- erreurs async,
- drift unread counts/messages,
- taux de reconnexion WS,
- incoherences worker lifecycle.

## NOT_SAFE_YET

1. **Push temps reel cross-domain**
- `ChatPushService` no-op.
- `NotifBroadcaster` no-op.
- Delivery device non garantie.

2. **WebSocket horizontal scaling natif**
- Registry WS process-local sans bus distribue.
- Non safe en multi-pod sans architecture complementaire.

3. **Uploads fallback local**
- URLs generees mais serving local `/api/uploads/**` absent.

4. **Purge physique media marketplace**
- Service de purge physique encore stub.

## Synthese critique

- Emergent a raison sur une base solide "core API".
- Emergent surestime la "safety" des couches runtime temps reel/media.
- Le cutover est viable **si** ces domaines restent declasses et monitorés.
