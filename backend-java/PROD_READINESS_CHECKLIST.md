# PROD_READINESS_CHECKLIST

Date: 2026-05-08  
Usage: checklist pre-cutover executable.

## 1) Secrets et variables d'environnement

- [ ] `JWT_SECRET` defini (obligatoire, non vide).
- [ ] `DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD` valides.
- [ ] `STRIPE_API_KEY` defini.
- [ ] `STRIPE_WEBHOOK_SECRET` defini (obligatoire en prod).
- [ ] `APP_CORS_ALLOWED_ORIGINS` restreint aux domaines front.
- [ ] `SPRING_PROFILES_ACTIVE=prod`.

## 2) Database / PostGIS / Flyway

- [ ] PostgreSQL prod accessible.
- [ ] Extension PostGIS installee.
- [ ] Flyway execute sans erreur ni drift.
- [ ] Tests fonctionnels geospatiaux (`/api/services`, `/api/tag-points`, `/api/home/*`) valides sur DB prod-like.

## 3) Storage (R2 / uploads)

- [ ] `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` configures.
- [ ] Decision explicite: fallback local autorise ou interdit.
- [ ] Si fallback local autorise: exposition `GET /api/uploads/**` geree (app ou proxy/CDN).

## 4) Stripe / webhooks

- [ ] Endpoint `POST /api/webhook/stripe` reachable publiquement.
- [ ] Signature Stripe active et verifiee.
- [ ] Evenements critiques verifies en sandbox:  
  `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `refund.updated`.
- [ ] Idempotence webhook observee en replay.

## 5) Workers / schedulers

- [ ] `ExpiryWorker` active (`EXPIRY_WORKER_ENABLED=true`) + monitoring erreurs.
- [ ] `MarketplaceMediaPurge` active + decision sur purge physique (stub actuel).
- [ ] `AdminProductReminder` active.
- [ ] Alertes sur echec scheduler + backlog.

## 6) WebSocket / reverse proxy

- [ ] Proxy/ALB configure pour `Upgrade: websocket`.
- [ ] Timeouts idle et keep-alive adequats.
- [ ] Handshake custom `{token}` teste en prod-like.
- [ ] Close codes (`4001/4003/4009`) verifies.
- [ ] Si multi-instance: sticky sessions ou bus pub/sub distribue.

## 7) Push notifications

- [ ] Perimetre push Java clarifie (ce qui est DB-only vs device push reel).
- [ ] Plan de mitigation produit si push no-op conserve temporairement.

## 8) Observabilite et exploitation

- [ ] Sondes `GET /api/liveness`, `GET /api/readiness`, `/actuator/health` integrees.
- [ ] Dashboards 4xx/5xx/latence par domaine.
- [ ] Logs centralises sur webhooks, workers, ws, auth.
- [ ] Runbook rollback split-routing documente et teste.

## 9) Tests avant GO

- [ ] `mvn test` vert (actuel: 367/367).
- [ ] Smoke e2e manuel sur 10 parcours critiques front.
- [ ] Test canary avec trafic reel limite et rollback valide.

## Statut recommande

- **Ready for PARTIAL GO**, apres fermeture des points P0:
  - webhook signature obligatoire en prod,
  - strategie uploads (`/api/uploads/**` ou R2-only),
  - decision explicite sur push/temps reel.
