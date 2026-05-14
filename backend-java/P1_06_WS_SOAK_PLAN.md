# P1-06 WebSocket Soak Plan (micro-lot 1)

Objectif: fournir un plan et un runner reproductible pour soak WS sans modifier le runtime applicatif.

## Scope canaux

- Chat WS: `/api/ws/chat/{conv_id}`
- Notifications WS: `/api/ws/notifications`
- SpotYou WS: `/api/ws/spot-you/{point_id}`

## Preconditions

- Backend Java deploye (local ou pre-prod).
- Un token JWT valide.
- IDs existants:
  - `conv_id` pour chat,
  - `point_id` pour spotyou.
- Node.js >= 20 (WebSocket client global disponible).

## Metriques attendues

- `connections_opened`
- `connections_closed`
- `messages_sent`
- `messages_received`
- `errors`
- `close_codes` (distribution)
- `rss_mb` (memoire process runner, proxy simple de stabilite client)
- debit approx `messages/sec` (derive de sent+received / duree)

## Fenetre soak recommandee

- Smoke: 5 min
- Soak court: 30 min
- Soak cible pre-go: 2h+

## Criteres de vigilance

- Pas de hausse continue des erreurs WS.
- Close codes attendus (pas de rafale 1011/1006).
- Stagnation ou croissance raisonnable de `rss_mb` (pas de fuite evidente cote client runner).
- Stabilite connexions (reconnect loops controlees).

## Commande de run (exemple)

```bash
node scripts/ws_soak_runner.mjs \
  --base-url ws://localhost:8080 \
  --token "<JWT>" \
  --conv-id "conv_demo_001" \
  --point-id "pt_demo_001" \
  --duration-sec 600 \
  --chat-clients 20 \
  --notif-clients 20 \
  --spotyou-clients 20
```

## Limites

- Runner client-side (pas un profiler serveur).
- Ne remplace pas la telemetry serveur (Prometheus/Grafana) attendue en P1-07.
- Les seuils finaux GO/NO-GO doivent etre valides en environnement pre-prod/prod-like.

## Execution reelle dans l'environnement courant (2026-05-08)

- Backend WS local indisponible:
  - `curl http://localhost:8080/actuator/health` -> connexion refusee.
  - tentative `spring-boot:run` en profil test echouee (`JWT_SECRET` requis + pas d'environnement DB/WS pre-prod).
- Soak execute en mode degrade contre endpoint local absent (validation robustesse runner + capture erreurs):
  - commande:
    - `node scripts/ws_soak_runner.mjs --base-url ws://localhost:8080 --token dummy --conv-id conv_demo_001 --point-id pt_demo_001 --duration-sec 15 --chat-clients 3 --notif-clients 3 --spotyou-clients 3`
  - resultat observe:
    - `connections_opened=0`
    - `connections_closed=0`
    - `messages_sent=0`
    - `messages_received=0`
    - `errors=9`
    - `close_codes={}`
    - `rss_mb` ~ 43 -> 36.4 (pas de derive memoire evidente cote runner)

## Micro-fix runner applique

- Probleme detecte:
  - si aucune connexion n'arrive a l'etat `open`, le runner pouvait sortir sans rapport final exploitable.
- Correctif minimal:
  - `openClient()` resolve desormais aussi sur `error/close/timeout` (2s), pas uniquement sur `open`.
  - resultat: rapport intermediaire + `FINAL_REPORT` toujours emis, meme en environnement degrade.
- Impact:
  - aucun changement protocole WS backend, uniquement outillage soak.

## Verdict intermediaire P1-06

- Validation partielle seulement dans cet environnement (absence backend WS fonctionnel).
- Aucun signal de fuite memoire evidente cote runner observe sur cette fenetre courte.
- Verdict exploitable pre-go encore manquant tant que soak reelle (30min/2h+) n'est pas executee contre backend WS actif en pre-prod/prod-like.
