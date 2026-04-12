# OPTIONAL_VALIDATION_CHECKLIST.md — Checklist pré-migration Java/Spring Boot
> Généré le 2026-04-12. À compléter avant de démarrer la migration Java.  
> Format : `[ ]` = à valider | `[x]` = validé | `[!]` = bloquant si non validé

---

## BLOC 1 — Collisions arbitrées (critique — Spring Boot refuse de démarrer si non résolues)

- `[ ]` **ARB-001** : `GET /api/admin/subscriptions` — décision confirmée : handler `payment_routes.py:497` retenu, `subscription_routes.py:453` exclu définitivement.
  - Valider que la réponse de `payment_routes.py:497` est bien celle attendue par le frontend admin (champs : `user_name`, `email`, `plan_name`, `plan_price`).
  
- `[ ]` **ARB-002** : `GET /api/admin/subscription-plans` — décision confirmée : handler `admin_routes.py:210` retenu, `subscription_routes.py:151` exclu.
  - Valider que `ORDER BY priority DESC, created_at ASC` est intentionnel (et non `DESC`).

---

## BLOC 2 — Auth HTTP validée

- `[ ]` Mécanisme JWT vérifié : `decode_jwt(token)` → `user_id` extrait.
- `[ ]` Middleware `require_auth` reproduit en Java (`SecurityContextHolder` ou filtre JWT).
- `[ ]` Middleware `require_role(request, pool, "admin")` reproduit (`hasRole('ADMIN')`).
- `[ ]` Auth optionnelle `get_optional_auth` reproduite (`@AuthenticationPrincipal(required=false)`).
- `[ ]` Rate limiting sur `POST /api/auth/login` reproduit.
- `[ ]` `POST /api/auth/google` : proxy Emergent confirmé (pas d'intégration Google directe).

---

## BLOC 3 — Auth WebSocket validée (ARB-010)

- `[ ]` Protocole confirmé : `accept()` → JSON `{"token": "..."}` dans 5 s → `decodeJWT` → `close(4001)` si échec.
- `[ ]` Token ne transite PAS dans l'URL (règle SEC-14).
- `[ ]` `WebSocketHandler` Java custom implémenté (pas `@MessageMapping` standard).
- `[ ]` Codes de fermeture reproduits : `4001` (auth), `4003` (accès refusé), `4009` (anti-spam).
- `[ ]` Anti-spam WS chat : 1 message / 500 ms + taille max 8 Ko reproduit.
- `[ ]` Les 3 handlers WS distincts confirmés : `/ws/chat/{convId}`, `/ws/notifications`, `/ws/spot-you/{pointId}`.

---

## BLOC 4 — Uploads validés

- `[ ]` `POST /api/upload-image` : auth JWT obligatoire confirmé.
- `[ ]` Limite de taille : 15 Mo (MAX_UPLOAD_SIZE dans le code).
- `[ ]` Validation magic bytes reproduite (JPEG, PNG, WebP, GIF, HEIC) — pas de confiance au Content-Type client.
- `[ ]` Catégories R2 confirmées : `profiles`, `services`, `spotyou`, `chats`, `products`, `other`.
- `[ ]` `POST /api/upload-image/debug-422` confirmé exclu (ARB-009).
- `[ ]` Fallback filesystem local (si R2 non configuré) reproduit en Java ou décision de le supprimer en v1 Java.

---

## BLOC 5 — Webhook Stripe validé

- `[ ]` `POST /api/webhook/stripe` : PAS d'auth JWT — vérification par signature `Stripe-Signature` header.
- `[ ]` Clé secrète webhook Stripe disponible en variable d'environnement Java.
- `[ ]` Logique idempotente (evénements Stripe traités une seule fois) reproduite.

---

## BLOC 6 — Infra endpoints validés (ARB-012)

- `[ ]` `GET /api/liveness` → réponse simple `{"status": "ok"}` ou 200 (probe K8s).
- `[ ]` `GET /api/readiness` → vérifie la connexion DB avant de répondre 200.
- `[ ]` `GET /api/config/booking` → retourne les paramètres de booking (TTL, montants).
- `[ ]` `GET /api/config/commission` → retourne le taux de commission.
- `[ ]` Ces 4 routes créées dans `InfraController` / `ConfigController` dédiés (pas dans `Application.java`).

---

## BLOC 7 — Exclusions validées

- `[ ]` `POST /api/upload-image/debug-422` absent du périmètre Java.
- `[ ]` `GET /api/admin/subscriptions` (subscription_routes) absent du périmètre Java.
- `[ ]` `GET /api/admin/subscription-plans` (subscription_routes) absent du périmètre Java.
- `[ ]` Redirection 301 implémentée pour `GET /api/receiver/requests` → `/api/bookings/received`.
- `[ ]` Redirection 301 implémentée pour `POST /api/bookings` → `/api/bookings/request`.

---

## BLOC 8 — Aliases validés

- `[ ]` **ARB-003** : décision prise sur `GET /api/users/me/bookings`.
  - Option A : `@GetMapping({"/bookings/me", "/users/me/bookings"})` (conserver l'alias).
  - Option B : 301 depuis `/users/me/bookings` vers `/bookings/me`.
  - `[ ]` Audit des clients (frontend + mobile) effectué pour confirmer lequel est utilisé.

- `[ ]` **ARB-005 / ARB-013** : décision prise sur PUT vs PATCH `/api/services/{serviceId}`.
  - `[ ]` Audit des clients confirmé (certains envoient-ils explicitement `PUT` en s'attendant à un remplacement complet ?).
  - `[ ]` Décision documentée dans `ARBITRAGE_DECISIONS.md` (ARB-013).

- `[ ]` **ARB-006 / ARB-007** : décision prise sur `/api/spot-you/{id}/join` et `/leave`.
  - `[ ]` Audit frontend : le frontend actuel utilise-t-il `/spot-you/*` ou `/tag-points/*` ?
  - `[ ]` Décision unification (Option B) ou maintien (Option A) documentée.

---

## BLOC 9 — Logique métier critique

- `[ ]` Idempotency booking (`idempotency_key` + UNIQUE INDEX) reproduite.
- `[ ]` Machine d'états booking (`requested → accepted → completed`, etc.) documentée et reproduite.
- `[ ]` Règles d'adhésion SpotYou reproduites :
  - `[ ]` `private` → 403 toujours (invitation uniquement)
  - `[ ]` `open` → adhésion directe
  - `[ ]` `admin_approval` → status=pending + notif owner
  - `[ ]` `members_approval` → status=pending + notif tous membres
- `[ ]` Capacité max communauté (`max_community_members`) vérifiée avant join.
- `[ ]` Conflits concurrents (409) sur approve/reject join-requests reproduits.
- `[ ]` Soft delete 90 jours : `active = FALSE` + TTL worker reproduit ou délégué à Python pendant transition.

---

## BLOC 10 — Ordre des routes statique vs paramétrique

> Spring Boot utilise la spécificité du pattern, mais vérifier l'ordre dans chaque contrôleur.

- `[ ]` `/tag-points/mine`, `/tag-points/saved` déclarés avant `/tag-points/{pointId}`.
- `[ ]` `/bookings/me`, `/bookings/received`, `/bookings/price-preview`, `/bookings/request` déclarés avant `/bookings/{bookingId}`.
- `[ ]` `/services/mine`, `/services/saved`, `/services/deactivated` déclarés avant `/services/{serviceId}`.
- `[ ]` `/spot-you/my-completion-stats` déclaré avant `/spot-you/{pointId}/*`.
- `[ ]` `/admin/products/pending` déclaré avant `/admin/products/{productId}`.
- `[ ]` `/subscriptions/me`, `/subscriptions/history`, `/subscriptions/subscribe`, `/subscriptions/cancel` déclarés avant `/subscriptions/checkout/status/{sessionId}`.
- `[ ]` `/users/me/*`, `/users/search` déclarés avant `/users/{userId}/*`.

---

## BLOC 11 — Variables d'environnement

- `[ ]` Toutes les variables Python `.env` listées et transposées en `application.yml` Java.
- `[ ]` `BOOKING_EXPIRY_HOURS` disponible (TTL booking expiry worker).
- `[ ]` `R2_PUBLIC_URL`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET` disponibles.
- `[ ]` `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` disponibles.
- `[ ]` `JWT_SECRET` (ou équivalent) disponible et format compatible.
- `[ ]` `DATABASE_URL` (Supabase / PostgreSQL) disponible.
- `[ ]` `EXPO_PUSH_URL` (si push Expo maintenu depuis Java) disponible.

---

## BLOC 12 — Périmètre final confirmé

- `[ ]` 169 endpoints HTTP retenus comptés et listés dans `MIGRATION_INTERFACE_CONTRACT.md`.
- `[ ]` 3 endpoints WS retenus.
- `[ ]` 4 endpoints infra (server.py) inclus.
- `[ ]` 5 endpoints exclus définitivement confirmés.
- `[ ]` 4 endpoints exclus temporairement (avec redirection 301) planifiés.
- `[ ]` Toutes les décisions ARB-001 à ARB-013 documentées et signées.

---

## Récapitulatif des décisions humaines requises

| ARB | Question |
|---|---|
| ARB-001 | La réponse de `payment_routes.py:497` correspond-elle bien à ce qu'affiche le frontend admin ? |
| ARB-002 | `ORDER BY created_at ASC` intentionnel, ou préférez-vous `DESC` comme dans l'autre handler mort ? |
| ARB-003 | Le frontend mobile/web utilise-t-il `/users/me/bookings` ou `/bookings/me` ? Alias conservé ou 301 ? |
| ARB-005/013 | PUT et PATCH `/services/{id}` → conserver les deux, ou PUT uniquement ? |
| ARB-006/007 | Le frontend utilise-t-il `/spot-you/{id}/join` et `/leave` ? Conserver distincts ou unifier vers `/tag-points/` ? |
