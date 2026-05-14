# EMERGENT_VERDICT_CHALLENGE

Date: 2026-05-08  
Approche: audit contradictoire, base sur code Java reel + tests reels executes (`mvn test`, 367/367 verts).

## Ce qui est confirme (Emergent avait raison)

- La couverture fonctionnelle HTTP est large sur les domaines slices 01-48.
- Les flux critiques (bookings/payments/stripe/subscriptions/services/spotyou) ont une vraie base de tests integration.
- La recommendation **PARTIAL GO** est defensible techniquement.
- Le mode split-routing progressif est pertinent.

## Ce qui est surestime

1. **SAFE_TO_SWITCH trop optimiste pour le temps reel**
- Chat/notifications/push ne sont pas homogenes:
  - `ChatPushService` = stub no-op.
  - `NotifBroadcaster` = stub no-op.
  - WS registry en memoire locale process (`WsConnectionRegistry`), non distribue multi-instance.
- Conclusion: le domaine "chat+notif temps reel" n'est pas SAFE plein.

2. **Readiness 75-84% peut masquer des risques infra P0**
- Webhook Stripe sans `STRIPE_WEBHOOK_SECRET` actif -> verification signature de fait desactivee.
- Upload fallback local produit des URLs `/api/uploads/...` mais serving statique absent.
- Ces deux points peuvent casser prod meme avec tests verts.

3. **"SAFE" front trop generalise**
- Alias legacy absents (`/api/users/profile`, `PATCH /api/bookings/{id}/status`).
- Heterogeneite erreur/status cross-domain (`detail` vs `error`, 400/422, 500/503).
- Si front mobile/web parser strict: risque de regression immediate.

4. **Securite sous-estimee**
- `SecurityConfig` est globalement `permitAll()`.
- L'auth repose sur discipline service/controller endpoint par endpoint.
- Aujourd'hui ca passe, mais c'est fragile aux futures evolutions.

## Ce qui est reellement risque

- Temps reel en horizontal scaling (WS cross-pod).
- Push Expo reel non couvert (seulement persist DB selon flux).
- Worker purge physique media marketplace non implemente (stub log-only).
- Cas de bascule split-routing non testes E2E (gateway failover/canary rollback).

## Challenge du verdict Emergent

- **Conserve**: PARTIAL GO.
- **Corrige**: la liste SAFE_TO_SWITCH doit etre declassifiee pour:
  - real-time/push/ws,
  - uploads fallback local,
  - chemins/erreurs legacy front.
- **Lecture contradictoire**: le principal risque n'est pas "metier non implemente", mais "runtime/infra/distribution incomplet".
