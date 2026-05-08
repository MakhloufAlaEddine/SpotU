# RECOMMENDED_NEXT_STEPS.md — Ordre exact des dernières actions avant cutover
> Généré le 2026-04-30. Compagnon de `BLOCKERS_BEFORE_FRONT_SWITCH.md` + `TECHNICAL_HARDENING_CHECKLIST.md`.

---

## Vue d'ensemble : 5 phases avant cutover

```
Phase 1 (1-2 sem) : Slices manquantes P0 documentées
Phase 2 (2-3 sem) : Implémentation Cursor des slices P0+P1
Phase 3 (3-5 j)   : Hardening technique (env vars, CORS, Stripe, R2, PostGIS)
Phase 4 (3-5 j)   : Tests E2E preprod sur 8 flows critiques
Phase 5 (1 j)     : Cutover progressif (Remote Config 1% → 100%)
```

---

## PHASE 1 — Documentation des slices manquantes (1–2 semaines)

### Ordre recommandé (dépendances → priorité business → coût)

#### 🔴 1.A — Slice 12 (Booking create) — **À AUDITER EN URGENCE**

**Action immédiate** : `ls /app/docs/migration/SLICE_12_*.md`

- Si présent → vérifier que ça couvre `POST /bookings/request` et `POST /bookings`
- Si absent → **créer immédiatement** la doc Slice 12 (suit le pattern S11/S13/S15)
- Source Python : `routes/booking_routes.py:385-401`
- Charge : 1 jour si à créer

#### 🔴 1.B — Slice 42 (Services coach CRUD)

**Pourquoi en premier** : sans Services en Java, **les bookings S11–S15 ne peuvent pas réserver** (pas de services à booker).

- 11 endpoints `service_routes.py`
- Réutilise patterns S39/S40 (CRUD owner + lifecycle)
- Charge : 2–3 jours doc (1 slice large) ou 2 slices (CRUD writes + lifecycle/saved)
- Mission Cursor pour l'agent : `Cible : POST /api/services + GET /api/services/* (search/mine/saved/deactivated/{id}) + PUT/PATCH/DELETE/reactivate/save/unsave`

#### 🔴 1.C — Slice 43 (Chat / Conversations + WebSocket)

**Pourquoi prioritaire** : écran tab principal, pas contournable proprement.

- 4 endpoints REST + 1 WebSocket (`chat_routes.py` + WS `/api/ws/spot-you/...`)
- Lectures + writes
- WebSocket Spring : `@MessageMapping` + STOMP ou SockJS — choix architectural à arbitrer
- Charge : 3–4 jours doc (slice complexe)
- Mission Cursor : `Cible : conversations + messages + WebSocket realtime`

#### 🔴 1.D — Slice 44 (Notifications + Agenda + Activity Feed)

**Pourquoi maintenant** : front utilise massivement, écran inbox + agenda critiques.

- ~7 endpoints (`tagpoint_routes.py:1350-1462` + `user_routes.py:377`)
- `users/me/notifications` + `read` + `read-all` + `events` + `planning-events` + `pending-requests` + `activity-feed`
- Lectures uniquement (pas de write — push créent les notifs)
- Charge : 1.5 jours doc

#### 🔴 1.E — Slice 45 (SpotYou RSVP "going" + completion-stats)

- 7 endpoints `spot_you_routes.py` (going POST/DELETE/GET, leave, my-completion-stats, activity)
- ⚠️ **Investiguer** la collision `/spot-you/{id}/join` vs `/tag-points/{id}/join` (S27)
- Charge : 1 jour doc

#### 🔴 1.F — Slice 46 (Search + Public profil + Reactivatable)

- `GET /users/search?q=`
- `GET /users/{uid}/public`
- `GET /users/me/reactivatable`
- Charge : 0.5 jour doc

#### 🟡 1.G — Slice 47 (User social — follow/block/reviews/suggestions)

- ~13 endpoints `user_routes.py`
- Charge : 2 jours doc

#### 🟡 1.H — Slice 48 (Adresses CRUD)

- 4 endpoints `address_routes.py`
- Charge : 0.5 jour doc

#### 🟡 1.I — Slice 49 (RGPD / Lifecycle compte)

- 4 endpoints `deletion_routes.py` (DELETE user, deactivate, reactivate, reactivatable — déjà dans 1.F)
- ⚠️ Législation EU : RGPD oblige un mécanisme de suppression. Ne PAS reporter en P2.
- Charge : 1 jour doc

#### 🟡 1.J — Slice 50 (Admin général + Domaines/Tags writes)

- ~22 endpoints `admin_routes.py` + 10 endpoints `domain_routes.py` writes
- Charge : 2–3 jours doc (slice large à découper)

#### 🟡 1.K — Slice 51 (Votes SpotYou + invitations inbox)

- `POST /tag-points/{id}/vote` + `GET /votes` + `GET /my-vote`
- `GET /users/me/spotyou-invitations`
- Confirmer S27 couvre `accept/refuse` invitations
- Charge : 1 jour doc

#### 🟢 1.L — Slice S40-bis (Purge physique R2)

- `admin_purge_worker.run_purge` complet
- State machine `pending_file_deletions` (`pending → processing → deleted/failed/skipped`)
- Cloudflare R2 DELETE API
- Charge : 1.5 jours doc
- **Décalable post-cutover** si dette stockage tolérée

### Total Phase 1
- Documents : ~12 slices supplémentaires
- Charge : **~17–22 jours doc** (1 dev temps plein) ou **~10–14 jours** (1 dev + parallélisation)

---

## PHASE 2 — Implémentation Cursor (2–3 semaines)

### Stratégie Cursor

- **1 slice = 1 mission Cursor** (pas plus, pour rester focused).
- **Ordre d'implémentation** suit l'ordre Phase 1 (dépendances).
- **Régressions automatiques** : Cursor doit rouler les tests T-XX-NN documentés dans chaque `*_TEST_CASES.md`.
- **Validation par diff** : lire le `git diff` après chaque slice pour valider la conformité aux specs.

### Découpage Cursor recommandé

| Mission | Slice(s) | Charge dev |
|---|---|---|
| 1 | S12 + S42 (booking create + services) | 4–5 j |
| 2 | S43 (chat + WebSocket) | 4–5 j |
| 3 | S44 + S45 (notifications + RSVP) | 2 j |
| 4 | S46 + S48 (search + adresses) | 1 j |
| 5 | S47 (graph social) | 2 j |
| 6 | S49 (RGPD) | 1 j |
| 7 | S50 (admin général) | 3 j |
| 8 | S51 (votes + invitations) | 1 j |
| 9 | S40-bis (R2 purge — optionnel pré-cutover) | 1 j |

**Total Phase 2** : **~19–21 jours dev**.

### Vérifications après chaque mission Cursor

À chaque slice livrée par Cursor :
1. **Compilation** : `mvn clean install` passe
2. **Tests unitaires** : `mvn test` passe avec couverture > 70%
3. **Tests d'intégration** : Testcontainers PostgreSQL + Stripe Mock
4. **Smoke test E2E** : 1 cas nominal de chaque endpoint via curl
5. **Diff review** : aligner avec les BR et les format JSON exacts
6. **Update PRD** : ajouter la slice dans `/app/memory/PRD.md`

---

## PHASE 3 — Hardening technique (3–5 jours)

### Ordre exact

#### Jour 1 — Env vars + Secrets

- [ ] Auditer toutes les env vars listées dans `TECHNICAL_HARDENING_CHECKLIST.md` § 1
- [ ] Configurer Kubernetes Secrets pour les valeurs sensibles
- [ ] Vérifier que **`JWT_SECRET` est strictement identique** Python ↔ Java
- [ ] Vérifier les keys Stripe **prod** (pas test)
- [ ] Vérifier R2 credentials accessibles depuis pod Java

#### Jour 2 — Database + PostGIS + DDL audit

- [ ] Faire `\d marketplace_products` et confirmer types pour tous les arrays/jsonb
- [ ] Confirmer `users.name` vs `users.full_name` (incohérence schéma probable)
- [ ] Confirmer migrations `009` + `011` + autres jouées
- [ ] Tester PostGIS : `SELECT PostGIS_Version();` + 1 query Haversine
- [ ] Confirmer index GiST sur location columns
- [ ] **Reporter rétroactivement** dans S39/S40 que `image_urls=jsonb`

#### Jour 3 — Stripe + R2 + CORS

- [ ] Tester webhook Stripe en preprod : `stripe trigger payment_intent.succeeded` → vérifier signature OK + 200 retourné
- [ ] Tester upload R2 depuis pod Java avec un fichier 10MB
- [ ] Tester compression image Java (Pillow → BufferedImage equivalent)
- [ ] Tester preflight CORS depuis tous les origins prod (web + Expo Go + preview Emergent)
- [ ] Tester rate limiting `/auth/login` (5/min) avec un script

#### Jour 4 — Workers + Logs + Monitoring

- [ ] Activer `@EnableScheduling` + `@EnableAsync`
- [ ] Configurer `ShedLock` ou advisory lock PostgreSQL si multi-replicas
- [ ] Tester `ExpiryWorker` (S18) en mockant `Clock` pour avancer dans le futur
- [ ] Tester `MediaPurgeWorker` (S40)
- [ ] Tester `AdminProductReminderWorker` (S41)
- [ ] Configurer Prometheus + Grafana dashboards pour les 3 workers
- [ ] Configurer alertes sur error rate, latency p99, JVM heap
- [ ] Configurer Sentry (si applicable)

#### Jour 5 — Sécurité + Headers + Rollback

- [ ] Vérifier `server.error.include-stacktrace=never`
- [ ] Configurer headers `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`
- [ ] Tester audit log admin (approve/reject products, change role)
- [ ] **Plan de rollback** documenté + testé (revenir à `EXPO_PUBLIC_BACKEND_URL=python_url`)
- [ ] OTA Expo prêt pour push immédiat

---

## PHASE 4 — Tests E2E preprod (3–5 jours)

### 8 flows critiques à valider

#### Jour 1 — Auth + Profile

- [ ] **Flow 1** : Register → Login → /auth/me → change-password → logout
- [ ] **Flow 1.b** : Google OAuth via Emergent (`X-Session-ID`)
- [ ] **Flow 1.c** : Profile update + cover update + become-coach + push-token

#### Jour 2 — SpotYou + Services + Booking

- [ ] **Flow 2** : create SpotYou → save → join → going → leave → admin reject
- [ ] **Flow 3.a** : create service coach → search → reserve → accept → pay
- [ ] **Flow 3.b** : Stripe webhook capture → completed → review

#### Jour 3 — Marketplace + Subscriptions

- [ ] **Flow 4** : subscribe premium → checkout → webhook → /me → cancel
- [ ] **Flow 5** : publish product → admin pending → reminder worker → approve → catalogue → DELETE → reactivate → re-DELETE → MediaPurgeWorker (mock T+90j)

#### Jour 4 — Chat + Notifications

- [ ] **Flow 6** : conversation 1-1 send/receive/read/leave + WebSocket realtime
- [ ] **Flow 7** : push notif → notifications inbox → read → read-all → planning-events → events

#### Jour 5 — Cancellations + Refunds

- [ ] **Flow 8** : cancel booking captured → refund Stripe → webhook charge.refunded → état final
- [ ] **Flow 8.b** : expiry worker booking timeout → cancel pending Stripe + slot release
- [ ] **Flow 8.c** : Webhook `invoice.payment_failed` subscription → past_due

### Tests régressions cross-slice

À chaque flow, valider que :
- Aucune réponse n'a un format JSON différent de Python (testez avec Postman snapshots)
- Les codes HTTP exacts sont préservés (404 vs 403 vs 409)
- Les push notifications partent (mock Expo Push API en preprod)
- Les datetime sont au format ISO 8601 avec offset

---

## PHASE 5 — Cutover progressif (1 jour)

### Stratégie recommandée : Remote Config + dual-routing

#### Étape 1 — Préparation J-7
- [ ] Front intégrer un mécanisme `useBackendRouter` qui lit `EXPO_PUBLIC_BACKEND_JAVA_PERCENT` depuis Remote Config Firebase / `getConfig`
- [ ] Domaines tagués : `auth`, `users`, `bookings`, etc. — chacun peut être routé Python ou Java indépendamment
- [ ] Déployer le front avec Remote Config par défaut à **0% Java** (= 100% Python comme avant)

#### Étape 2 — Cutover progressif J0
- [ ] **00:00** : Backend Java déployé en prod, healthchecks verts
- [ ] **00:15** : Activation Remote Config domaines à **faible risque** : `auth + users` à 5%
- [ ] **01:00** : Si erreur rate < 0.5%, monter à 25%
- [ ] **02:00** : Monter à 100% sur `auth + users`
- [ ] **04:00** : Activation Remote Config sur les domaines OK (Booking, Payments, Subscriptions, Marketplace, Home, SpotYou) à 5%
- [ ] **08:00** : Si tout vert, monter ces domaines à 100%
- [ ] **10:00** : Activation Chat à 5% (si migré — sinon laisser sur Python)
- [ ] **12:00** : Si Chat vert, monter à 100%
- [ ] **14:00** : Désactiver le routing Python (= cutover terminé)

#### Étape 3 — Surveillance J0–J7
- [ ] Monitorer error rate < 1% sur 24h
- [ ] Monitorer latency p99 < 1.5s sur 24h
- [ ] Monitorer Stripe webhook success rate = 100%
- [ ] Monitorer R2 upload success rate > 99%
- [ ] Monitorer DB pool utilization < 80%
- [ ] Monitorer JVM heap < 80%
- [ ] Validation manuelle quotidienne de 3 utilisateurs randoms (pas seulement comptes test)

#### Étape 4 — Décommissionnement J+30
- [ ] Backend Python passé en mode read-only (sécurité)
- [ ] Surveillance 7 jours supplémentaires
- [ ] Décommission complète Backend Python J+37

---

## Vérifications manuelles critiques

À faire **avant** Phase 5 :

- [ ] **Diff `git log -- routes/`** entre snapshot pre-S10 et snapshot actuel pour identifier les drifts Python ajoutés depuis le début de la migration (peuvent invalider des slices)
- [ ] **Schema diff** entre Supabase prod et Supabase preprod (toute différence = bombe à retardement)
- [ ] **Stripe Dashboard** : vérifier que webhook URL prod n'est pas pointée sur un endpoint Python obsolète
- [ ] **Cloudflare R2** : vérifier que les URLs de fichiers servies au front sont bien sur le CDN public (pas de CORS R2 issue)
- [ ] **Push notif Expo** : vérifier que le token de prod n'est pas en mode dev/sandbox
- [ ] **Monitoring** : tester un alerte volontaire (tuer le pod Java) → vérifier escalation Slack/PagerDuty

---

## Quoi faire avec Cursor (récap)

1. **Pour chaque slice non implémentée** :
   - Lire `SLICE_NN_SCOPE.md` + `_API_CONTRACTS.md` + `_DB_MAPPING.md` + `_BUSINESS_RULES.md` + `_CURSOR_IMPLEMENTATION_NOTES.md`
   - Implémenter contrôleur + service + repository
   - Lancer les tests `_TEST_CASES.md`
   - Lancer un check : `mvn clean install && mvn test`

2. **Ne pas inventer** : si une règle métier n'est pas dans la doc, demander confirmation avant d'implémenter

3. **Anomalies compat** : préserver à 100% (zombie status, dual rejection_reason, etc.) — ne pas "améliorer" sans validation explicite

---

## Quoi vérifier manuellement (récap)

1. **JWT_SECRET partagé** Python/Java
2. **Stripe webhook bytes raw** (pas de DTO Spring)
3. **PostGIS version + index GiST** + ST_MakePoint(lng, lat)
4. **CORS** explicite (pas `*`) + Stripe-Signature header autorisé
5. **R2 credentials** + bucket prod
6. **DDL drift** entre slices (`image_urls=jsonb`, `users.name`)
7. **Migration DB** toutes jouées
8. **Workers** activés (`@EnableScheduling`)
9. **Logs** structured JSON + correlation ID
10. **Rollback** documenté et testé

---

## Calendrier global estimé

| Phase | Charge | Durée wall-clock |
|---|---|---|
| Phase 1 | 17–22 j doc | 2 sem (1 dev) ou 1 sem (2 devs parallélisé) |
| Phase 2 | 19–21 j dev | 3 sem (1 dev) ou 1.5 sem (2 devs) |
| Phase 3 | 5 j | 1 sem |
| Phase 4 | 5 j | 1 sem |
| Phase 5 | 1 j + J+30 monitoring | 1 j cutover + 1 mois surveillance |
| **TOTAL** | **47–54 j** | **~6–8 semaines** (1 dev) **ou ~4–5 semaines** (2 devs) |

> ⚠️ **Recommandation** : 2 devs en parallèle sur Phase 1+2 (1 sur back Java, 1 sur doc/QA). Phase 3+4+5 peuvent être faites par 1 lead seul.

---

## Conclusion : prochaine action immédiate

**Aujourd'hui** :
1. **Auditer Slice 12** : `ls /app/docs/migration/SLICE_12_*.md` — si absent, créer la doc.
2. **Confirmer DDL `marketplace_products`** : `\d marketplace_products` sur Supabase prod pour valider tous les types de colonnes.
3. **Décider de la stratégie cutover** : full Java OU hybride par domaine.

**Cette semaine** :
- Démarrer Slice 42 (Services coach) — prérequis booking
- Démarrer Slice 43 (Chat) — prérequis fonctionnel critique

**Ne PAS commencer** Phase 5 (cutover) tant que Phase 1–4 ne sont pas vertes.
