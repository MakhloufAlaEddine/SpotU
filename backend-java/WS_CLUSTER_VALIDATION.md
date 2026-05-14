# WS_CLUSTER_VALIDATION

Validation P0-05 (multi-instance WS).

## Validation automatique (quasi-reelle)

Le test `RedisWsClusterRelayCrossInstanceTest` couvre:

1. Instance A publie sur `chat.conv`.
2. Message transporte via envelope Redis (`instance_id`, `key`, `payload`).
3. Instance B recoit et rebroadcast local a ses sessions.
4. Instance A ignore son propre message (anti-boucle via `instance_id`).
5. Absence de rebroadcast infini cote instance B (pas de re-publication sur consume).

## Validation manuelle pre-prod (Redis reel)

1. Activer cluster WS:
   - `APP_WS_CLUSTER_ENABLED=true`
   - `APP_WS_CLUSTER_PROVIDER=redis`
   - `APP_WS_CLUSTER_INSTANCE_ID=node-a` (puis `node-b`)
   - `REDIS_HOST` / `REDIS_PORT`
2. Lancer 2 instances backend-java connectees au meme Redis.
3. Ouvrir une session WS chat sur node-a et une autre sur node-b, meme `conv_id`.
4. Envoyer un message depuis node-a.
5. Verifier reception immediate sur node-b.
6. Verifier absence de duplication/boucle dans les logs (`instance_id` local ignore).
