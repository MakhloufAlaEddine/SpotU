# FULL_CUTOVER_CURSOR_TASKS

Date: 2026-05-08  
Objectif: micro-taches Cursor, securisees, executables par petits lots.

## Lot 1 - Stripe secret obligatoire (P0-01)

### Task 1.1
Prompt Cursor:
"Rends `STRIPE_WEBHOOK_SECRET` obligatoire en profil `prod`. Si vide, fail-fast au demarrage. Ajoute test qui verifie que le contexte ne demarre pas en prod sans secret."

### Task 1.2
Prompt Cursor:
"Ajoute test integration webhook qui confirme qu'une signature invalide retourne 400 quand secret configure."

## Lot 2 - Security deny-by-default (P0-02)

### Task 2.1
Prompt Cursor:
"Refactor `SecurityConfig` pour appliquer `authenticated()` par defaut et whitelist explicite des endpoints publics requis. Ne change pas la logique metier des services."

### Task 2.2
Prompt Cursor:
"Ajoute tests integration 401/403 sur endpoints sensibles (bookings/payments/admin) pour verifier qu'un endpoint oublie n'est pas ouvert."

## Lot 3 - WS origins whitelist (P0-03)

### Task 3.1
Prompt Cursor:
"Ajoute propriete de configuration `app.ws.allowed-origins` et remplace `setAllowedOriginPatterns(\"*\")` par la whitelist."

### Task 3.2
Prompt Cursor:
"Ajoute tests WS: origine autorisee OK, origine interdite refusee."

## Lot 4 - Push reel (P0-04)

### Task 4.1
Prompt Cursor:
"Remplace `ChatPushService` no-op par implementation provider push (interface + adapter concret). Ajoute retry simple + logs structures."

### Task 4.2
Prompt Cursor:
"Remplace `NotifBroadcaster` no-op par diffusion reelle (au minimum via bus interne) et ajoute tests unitaires/integration."

### Task 4.3
Prompt Cursor:
"Ajoute metriques push `sent/failed/retried` et tests de non-regression."

## Lot 5 - WS multi-instance (P0-05)

### Task 5.1
Prompt Cursor:
"Introduis abstraction de broadcast distribue (ex: Redis pub/sub) pour chat/notifs/spot-you; garde compat avec registry locale."

### Task 5.2
Prompt Cursor:
"Ajoute test d'integration multi-instance simule (publisher instance A, subscriber instance B) qui valide la diffusion cross-instance."

## Lot 6 - Upload strategy finale (P0-06)

### Task 6.1
Prompt Cursor:
"Option A: expose route statique securisee `/api/uploads/**` basee sur local dir; bloque path traversal; ajoute tests upload+fetch."

### Task 6.2
Prompt Cursor:
"Option B: supprimer fallback local et imposer R2-only; si R2 incomplet, fail-fast en prod. Ajoute tests de configuration."

## Lot 7 - Purge physique marketplace (P0-07)

### Task 7.1
Prompt Cursor:
"Implemente suppression physique dans `MarketplaceFilePurgeService` (R2/local), idempotente, avec logs d'erreurs exploitables."

### Task 7.2
Prompt Cursor:
"Ajoute tests integration purge: nominal, objet deja supprime, erreur provider puis reprise."

## Lot 8 - Contrat erreurs unifie (P0-08)

### Task 8.1
Prompt Cursor:
"Definis un schema d'erreur minimal commun (`code`,`message`,`details?`) et applique-le aux endpoints critiques sans casser les statuts metier."

### Task 8.2
Prompt Cursor:
"Ajoute tests de contrat erreurs front sur auth/bookings/payments/services/marketplace."

## Lot 9 - Compat legacy (P1-01)

### Task 9.1
Prompt Cursor:
"Ajoute alias `GET /api/users/profile` vers comportement actuel `/api/users/me`."

### Task 9.2
Prompt Cursor:
"Ajoute alias legacy `PATCH /api/bookings/{id}/status` vers logique `complete` existante, avec format reponse compatible."

## Lot 10 - Stress/concurrency/runtime (P1)

### Task 10.1
Prompt Cursor:
"Ajoute tests concurrency pour `checkout status` vs webhook Stripe et verifie idempotence finale DB."

### Task 10.2
Prompt Cursor:
"Etends tests workers avec scenarios reprise apres echec et concurrence."

### Task 10.3
Prompt Cursor:
"Ajoute soak test WS (connexions longues, reconnects, debit messages modere) + assertions memoire/erreurs."

## Lot 11 - Observabilite + go-live pack (P1/P2)

### Task 11.1
Prompt Cursor:
"Ajoute instrumentation metriques et logs structures pour ws/webhooks/workers/push (taux succes/echec/latence)."

### Task 11.2
Prompt Cursor:
"Cree runbook technique de cutover complet Java-only + rollback complet Java-only (pas de split-routing)."

## Regle d'execution

- Ne lancer qu'un lot a la fois.
- Merge uniquement si tests verts + critere de done du lot atteint.
- Stop immediat du planning si un lot P0 echoue.
