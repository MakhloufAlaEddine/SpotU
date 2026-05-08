# SpotU — Product Requirements Document

## Problème original
Application React Native (Expo Web) + FastAPI + Supabase.
Implémenter une stratégie de rétention et réactivation avancée (Soft Delete 90j) pour profils, SpotYous, services et produits marketplace.

---

## Architecture

```
/app
├── frontend/
│   └── app/
│       ├── (tabs)/
│       │   ├── profile.tsx       ← Cartes stats 3-en-ligne + styles chips corrigés
│       │   ├── chat.tsx
│       │   └── map.tsx
│       ├── chat/[id].tsx         ← Fix MessageBubble déclaration
│       ├── spot-you/[id].tsx     ← Bannière ambre owner désactivé
│       ├── spot-me.tsx           ← 3 tabs: Actifs, Désactivés, Communautés
│       └── products/
│           └── my-products.tsx
├── backend/
│   ├── migrations/
│   │   └── 012_media_purge_retention.sql   ← APPLIQUÉ
│   ├── media_purge_worker.py               ← NOUVEAU (J+90 purge)
│   ├── media_notif_worker.py               ← NOUVEAU (J+83 notif)
│   ├── admin_purge_worker.py
│   ├── push_service.py
│   └── routes/
│       ├── deletion_routes.py              ← Soft delete + notifications membres
│       ├── service_routes.py               ← Mis à jour
│       ├── product_creation_routes.py      ← Mis à jour
│       └── tagpoint_routes.py              ← DELETE conflit supprimé + 404 désactivés
```

---

## Implémenté ✅

### Phase 3 — Gestion des Demandes d'Adhésion (Option C) + Gestion Concurrence (2026-04-05)
- **Backend** : `GET /tag-points/{id}/join-requests` — expose les demandes en attente (owner + membres si members_approval)
- **Backend** : `DELETE /tag-points/{id}/cancel-request` — annuler sa propre demande d'adhésion (pending uniquement)
- **Backend** : `GET /tag-points/{id}` retourne maintenant `join_status` ("accepted" | "pending" | "invited" | null)
- **Backend** : `POST /tag-points/{id}/members/{uid}/approve` → HTTP 409 si déjà traité (gestion concurrence)
- **Backend** : `POST /tag-points/{id}/members/{uid}/reject` → HTTP 409 si déjà traité (gestion concurrence)
- **Correctif** : `POST /tag-points/{id}/join` — utilisateurs refusés (status='rejected') peuvent re-soumettre une demande (ON CONFLICT DO UPDATE WHERE status='rejected')
- **Correctif** : `POST /tag-points/{id}/join` — utilisateurs invités (status='invited') retournent un message clair au lieu de créer une demande parasite
- **Frontend** : Badge rouge sur chip "X membres" visible pour owner et membres si members_approval
- **Frontend** : Bouton "Annuler" (orange) quand `join_status=pending` au lieu de "Rejoindre". Après annulation → "Rejoindre"
- **Frontend** : Modal Participants — bannière ambre (`conflict-banner`) visible 5s si deux admins acceptent/refusent en simultané + refresh automatique
- **Frontend** : Onglet Notifications — boutons inline "Accepter"/"Refuser". En cas de 409 (conflit) : message inline ambre + refresh automatique de la liste (`onRefresh` passé correctement)
- **Frontend** : `Alert.alert` (no-op sur web) remplacé par gestion inline pour les erreurs 409
- **Correctif** : `_fetch_is_participant` filtre sur `status='accepted'`
- **DB** : Enregistrement de conversation orpheline `conv_ed6d1a80279b` supprimé


### Phase 4 — Visibilité des SpotYous Privés (2026-04-11)
- **Backend `home_routes.py`** : Ajout de `tp.visibility_type` dans SELECT du feed accueil — badge cadenas fonctionnel sur les cartes accueil
- **Frontend `[id].tsx`** : Bandeau indigo "SpotYou privé — accès sur invitation uniquement" (`testID='private-banner'`) pour les non-membres
- **Frontend `[id].tsx`** : Bouton désactivé "Accès sur invitation" (`testID='invitation-only-btn'`) remplace "Rejoindre" pour non-membres de SpotYous privés
- **Frontend `[id].tsx`** : Membres existants conservent leur bouton "Quitter" normal
- **Tests** : Backend 14/14 PASS, Frontend 6/7 PASS (1 skipped — pas de seed membre)


## Implémenté ✅

### Phase 2 — Invitations SpotYou (2026-04-04)
- **Migration 017** : `invited_by` (FK users) + `invited_at` (timestamp) sur `spot_you_members`
- **Backend** : `POST /tag-points/{id}/invite` (check permissions, anti-doublon, push notif)
- **Backend** : `GET /users/me/spotyou-invitations` (mes invitations reçues, filtrées SpotYous actifs)
- **Backend** : `POST /tag-points/{id}/invitations/accept` → accepted + push inviteur
- **Backend** : `POST /tag-points/{id}/invitations/refuse` → rejected + push discret
- **Backend** : `GET /users/search?q=...` (followers/following en priorité, puis tous)
- **Frontend** : `InviteModal.tsx` — bottom sheet recherche + sélection + envoi invitation
- **Frontend** : `spot-you/[id].tsx` — bouton "Inviter" dans owner bar + bouton membre autorisé
- **Frontend** : `spot-me.tsx` — section "Invitations reçues" avec Accepter/Refuser + badge compteur
- **Tests e2e** : 11/11 PASS (`/app/backend/tests/test_016_spotyou_invitations_phase2.py`)

### Phase 1 — Règles SpotYou révisées (2026-04-04)
- **Migration 015** : ajout du statut `'invited'` dans `spot_you_members.status` (pending | accepted | rejected | **invited**)
- **Règle révisée** : SpotYous PRIVÉS = invitation uniquement — `POST /tag-points/{id}/join` retourne **403** si `visibility_type='private'`
- **SpotYous PUBLICS** : toujours supportent `open`, `admin_approval`, `members_approval`
- **Frontend StepAcces.tsx** : Public → section "Mode d'entrée" visible ; Privé → bandeau info "Accès uniquement sur invitation"
- **create.tsx** : défaut `invitePermissions = 'admin_and_members'` (était `'admin_only'`)
- **Tests e2e mis à jour** : R2 vérifie private → 403 (au lieu de pending), 7/7 tests passent ✅

### Phase 1 — Règles SpotYou (2026-04-03)
- **Migration 014** : +`visibility_type`, `join_mode`, `invite_permissions`, `max_community_members` dans `tag_points` ; +`status`, `requested_by`, `approved_by` dans `spot_you_members`
- **Backend** : endpoint `join` avec logique complète (public→direct, public+admin_approval→pending, public+members_approval→pending+notif membres)
- **Backend** : `GET /tag-points/{id}/join-requests`, `POST .../members/{uid}/approve`, `POST .../members/{uid}/reject`
- **Backend** : `GET /users/me/pending-requests` (SpotYous où l'utilisateur a une demande en attente)
- **Frontend** : Step 5 "Accès" dans `create.tsx` + composant `StepAcces.tsx`
- **Frontend** : Section "En attente de validation" dans l'onglet Communautés (`spot-me.tsx`)
- **Tests e2e** : 7 tests (R1→R8), tous passent ✅
- **Notifications push** : join_request → notif admin/membres ; approved/rejected → notif requester


### Phase 5 — Workers purge (session précédente)
- ExpiryWorker, SpotYouNotifWorker, AdminPurgeWorker

### Phase A — Migration DB 012 (2026-04-02)
- Colonnes `media_purge_scheduled_at`, `media_purged`, `media_purged_at`, `media_purge_notified_at`, `reactivated_at` ajoutées à `users`, `tag_points`, `services`, `marketplace_products`

### Phase B — Backend API rétention 90j (2026-04-02)
- `DELETE /tag-points/{id}` → soft delete + `media_purge_scheduled_at = +90j` + queue `pending_file_deletions` avec `scheduled_at = +90j`
- `POST /tag-points/{id}/reactivate` → restauration + annulation `pending_file_deletions`
- `DELETE /services/{id}` → soft delete + `media_purge_scheduled_at` (remplace suppression physique immédiate)
- `GET /services/deactivated` → liste services désactivés (placé avant `/{id}` pour éviter conflit routing)
- `POST /services/{id}/reactivate`
- `DELETE /products/{id}` → ajoute `deleted_at` + `media_purge_scheduled_at`
- `POST /products/{id}/reactivate`
- `PATCH /users/{id}/deactivate` → désactivation réversible (≠ DELETE RGPD)
- `POST /users/{id}/reactivate` → réactivation profil SANS cascade
- `GET /users/me/reactivatable` → entités désactivées avec `days_until_media_purge`
- Suppression du doublon `DELETE /tag-points/{id}` dans `tagpoint_routes.py`

### Phase C — Workers automatisés (2026-04-02)
- `MediaPurgeWorker` : scan hourly, marque `media_purged=TRUE` à J+90, déclenche purge physique
- `MediaNotifWorker` : notification push à J+83 (7j avant purge), idempotent via `media_purge_notified_at`
- Enregistrés dans `server.py` startup/shutdown

### Phase D — Frontend (2026-04-02)
- `profile.tsx` : section "À réactiver" avec compteur dynamique "Suppression des médias dans XX jours"
- Bouton "Réactiver" par entité avec appel API
- Fix bug préexistant `chat/[id].tsx` : déclaration `function MessageBubble` manquante + `<Bubble>` → `<MessageBubble>`

### Phase E — Soft Delete UI + Tabs (2026-04-02)
- `spot-me.tsx` : 3 tabs (Actifs, Désactivés, Communautés)
- `spot-you/[id].tsx` : bannière ambre owner + protection 404 non-owners pour désactivés
- Endpoints `join`, `vote`, `save` bloqués sur SpotYous désactivés + auto-refresh frontend
- Code `cancel`/`restore` ancien supprimé, notifications membres déplacées vers deactivation
- Fix 500 lors désactivation (import `_first_image` manquant dans `deletion_routes.py`)

### Phase F — Profile cards stats (2026-04-02)
- Cartes Enregistrés / Mes SpotYou / Planning alignées sur une ligne (`flexDirection: 'row'`)
- Styles `actionChips`, `actionChip`, `actionChipAmber`, `actionChipBlue` ajoutés
- Stats colorées dans carte "Mes SpotYou" : actifs (teal), désactivés (amber), communautés (bleu)

### Phase G — SpotYouCard non-owner + Communautés temps réel (2026-04-02)
- `SpotYouCard.tsx` : nouvelles props `onToggleJoin`, `joiningId`, `isMember`, `isOwner`. Section "Rejoindre/Quitter" avec badge "Membre" vert et bouton "Quitter" rouge pour les non-owners.
- `spot-me.tsx` : 2e hook `useSpotYouListLive` branché sur la liste `joined` (stats temps réel communautés). Fonction `toggleJoin` utilisant `ConfirmActionModal` (compatible web, pas d'Alert.alert). Onglet Communautés passe `isLive`, `isOwner=false`, `isMember=true`, `onToggleJoin`, `joiningId`.
- `tagpoint_routes.py` : Fix bug `GET /users/me/events` — calcul `is_owner` corrigé (comparaison user_id). Avant : tous les items avaient `is_owner=False`. Après : les SpotYous créés par l'utilisateur ont `is_owner=True` et sont filtrés de l'onglet Communautés.

---
1. Soft delete = désactivation 90j, médias conservés, réactivation possible
2. Réactivation > 90j (`media_purged=TRUE`) : entité restaurée mais `requires_media_reupload=TRUE`
3. Réactivation profil utilisateur : NE cascade PAS vers SpotYou/services/produits
4. Workers idempotents : skip si `reactivated_at IS NOT NULL AND reactivated_at >= deleted_at`
5. Annulation fichiers : `DELETE FROM pending_file_deletions WHERE entity_id=$1 AND status='pending'`

---

### Phase H — Documentation migration Java/Spring Boot (2026-04-12)
- Analyse exhaustive du backend FastAPI Python : 183 décorateurs détectés (179 dans `routes/*.py` + 4 dans `server.py`)
- Création de 13 fichiers Markdown dans `/app/docs/migration/` :
  - `BACKEND_OVERVIEW.md`, `DB_MAP.md`, `ENDPOINTS_INVENTORY.md`, `BUSINESS_RULES_EXTRACT.md`
  - `ASYNC_AND_SIDE_EFFECTS.md`, `EXTERNAL_INTEGRATIONS.md`, `MIGRATION_RISKS.md`, `MIGRATION_SLICES_PROPOSAL.md`
  - `ENDPOINTS_RECONCILIATION.md`, `ENDPOINTS_CANONICAL_LIST.md`, `ENDPOINTS_MISSING_FROM_PREVIOUS_DOC.md`
  - `ROUTE_COLLISIONS_AND_AMBIGUITIES.md`, `RECOMMENDED_CANONICAL_SCOPE.md`
- Réconciliation complète : 174 routes actives (171 HTTP + 3 WS), 2 collisions réelles, 3 double-décorateurs, 5 exclusions
- **Arbitrage final** : 3 fichiers créés — `ARBITRAGE_DECISIONS.md` (13 décisions), `MIGRATION_INTERFACE_CONTRACT.md` (176 endpoints v1), `OPTIONAL_VALIDATION_CHECKLIST.md` (12 blocs de validation)
- **Slice 01** : 6 fichiers de cadrage créés dans `/app/docs/migration/SLICE_01_*.md` pour `GET /api/config/booking` + `GET /api/config/commission` (scope, contrats API, mapping DB, règles métier, cas de tests, notes Cursor)
- **Slice 02** : 7 fichiers de cadrage créés dans `/app/docs/migration/SLICE_02_*.md` pour `GET /api/auth/me` (scope, contrat API, flux auth, mapping DB, règles métier BR-01→BR-10, cas de tests, notes Cursor). Vérifié sur token JWT live : claim `user_id` custom (pas `sub`), HS256, TTL 7j, 18 colonnes USER_FIELDS, fallback cookie `winek_token`, 0 vérification de statut utilisateur. Niveau de confiance global : CERTAIN (95%).
- **Slice 03** : 6 fichiers de cadrage créés dans `/app/docs/migration/SLICE_03_*.md` pour `GET /api/users/profile` (cible Java : `GET /api/users/me`). 23 champs de réponse = 18 USER_FIELDS (Slice 02) + `avg_rating`, `review_count`, `iban`, `bic`, `iban_name`. 3 requêtes DB (users × 2 + reviews × 1). Règle critique : `avg_rating = null` si 0 reviews (pas `0.0`). Niveau de risque : FAIBLE.
- **Slice 04** : 6 fichiers de cadrage créés dans `/app/docs/migration/SLICE_04_*.md` pour `GET /api/users/{user_id}/public`. Auth optionnelle (try/except → me_id=null sans 401). 11 requêtes DB sur 8 tables. Champs conditionnels : phone (show_phone), reviews (show_reviews), services (role=coach). Utilitaire `NextSessionDateCalculator` obligatoire avec fuseau `Europe/Paris`. 15 cas de test documentés. Niveau de risque : MOYEN.
- **Slice 05** : 6 fichiers de cadrage créés dans `/app/docs/migration/SLICE_05_*.md` pour `POST /api/users/{user_id}/follow` + `DELETE /api/users/{user_id}/follow`. Table `user_follows` PK composite (follower_id, following_id). Asymétrie critique : follow vérifie self (400) et existence cible (404) ; unfollow est entièrement silencieux. Double follow idempotent via `ON CONFLICT DO NOTHING`. `followers_count` recalculé SELECT post-mutation. 12 cas de test. Niveau de risque : FAIBLE.
- **Slice 06** : 6 fichiers créés dans `/app/docs/migration/SLICE_06_*.md` pour `GET /api/users/{id}/followers` + `GET /api/users/{id}/following`. Auth optionnelle `get_optional_auth`. Noms de champs asymétriques (`is_following_back` vs `follows_back`). Pas de pagination, pas de 404, `ORDER BY u.name ASC`. Tables : `user_follows`, `users`, `user_blocks` (EXISTS subquery). Niveau de risque : FAIBLE.
- **Slice 07** : 6 fichiers créés dans `/app/docs/migration/SLICE_07_*.md` pour `POST /api/users/{id}/block` + `DELETE /api/users/{id}/block`. Auth stricte. Block : self-check (400) + DELETE bidirectionnel `user_follows` + INSERT `user_blocks` ON CONFLICT. Unblock : silencieux, ne restaure pas les follows. Recommandation : `@Transactional` Java pour atomicité. 13 cas de test. Niveau de risque : FAIBLE à MOYEN.
- **Slice 08** : 6 fichiers créés dans `/app/docs/migration/SLICE_08_*.md` pour `GET /api/users/{user_id}/reviews`. Auth : AUCUNE (endpoint totalement public). Privacy gate : `show_reviews=false` → `[]` HTTP 200 (pas 403). 404 si user inexistant. JOIN `reviews` + `users`. 7 champs, `ORDER BY r.created_at DESC`, pas de pagination. `booking_id` absent du SELECT intentionnellement. `created_at` ISO 8601 via `rows_to_list`. 10 cas de test. Niveau de risque : TRÈS FAIBLE. Généré le 2026-02-XX.
- **Slice 09** : 6 fichiers créés dans `/app/docs/migration/SLICE_09_*.md` pour `GET /api/services` (liste) + `GET /api/services/{service_id}` (détail). Auth SOFT pour les deux (jamais de 401). Tables : `services`, `users`, `reviews`, `service_locations`, `tags`, `service_slots`, `service_packages`, `bookings`. Pas de pagination — LIMIT 100 hardcodé. Pièges clés : `slots=[]` et `packages=[]` toujours vides dans la liste (intentionnel), `avg_rating` par `coach_id` (pas `service_id`), `is_owner=true` pour `role="admin"` également. Niveau de risque : MOYEN (PostGIS `ST_DWithin` + `_mask_address` regex). Généré le 2026-02-XX.
- **Slice 10** : 6 fichiers créés dans `/app/docs/migration/SLICE_10_*.md` pour `GET /api/domains`, `GET /api/tags/categories`, `GET /api/tags` — référentiels légers. Auth : AUCUNE. Tables : `domains`, `tag_categories`, `tags`, `tag_category_links`, `tag_entity_type_links`. Niveau de risque : FAIBLE. Généré le 2026-02-XX.
- **Slice 11** : 6 fichiers créés dans `/app/docs/migration/SLICE_11_*.md` pour `GET /api/bookings/me` (alias `/users/me/bookings`), `GET /api/bookings/received` (alias `/receiver/requests`), `GET /api/bookings/{booking_id}`. Auth : STRICTE (`require_auth`) sur les 3. Tables : `bookings`, `services`, `users` (x2), `service_slots`. Pas de pagination. Pièges : `pricing_snapshot` JSONB/string legacy, `COALESCE(receiver_user_id, coach_id)`, contrôle d'accès détail sur 4 champs + admin, enrichissements asymétriques (slot_* absent de /received), doubles chemins actifs. Niveau de risque : MOYEN. Généré le 2026-02-XX.
- **Slice 13** : 6 fichiers créés dans `/app/docs/migration/SLICE_13_*.md` pour `POST /api/bookings/{booking_id}/accept`. Auth : STRICTE (receiver OU admin). 2 branches : Cas A (pay_now+authorized → confirmed+capture Stripe stub) et Cas B (autres → awaiting_payment+expires_at calculé). Tables : `bookings`, `services` (JOIN), `payments`, `app_config`, `service_slots`. Idempotent sur 3 statuts (état réel retourné). HTTP 410 si TTL expiré. 29 cas de test. Niveau de risque : MOYEN. Généré le 2026-02-XX. pour `POST /api/bookings/{booking_id}/refuse`. Auth : STRICTE (receiver uniquement, pas d'exception admin). Tables : `bookings` (UPDATE status→refused), `payments` (UPDATE cancelled si requires_authorization/authorized), `service_slots` (UPDATE available si slot_status=pending). Transaction atomique sur les 3 UPDATEs. Stripe HORS transaction (stub v1 acceptable). Push fire-and-forget. Idempotent si déjà refused. 25 cas de test. Niveau de risque : FAIBLE. Généré le 2026-02-XX. — classifie 3 bloquants prod (CORS wildcard, collisions admin Spring, PostGIS approximatif), 3 points importants (500 vs 503, auth filtre global, port). Plan d'action `STABILIZATION_PLAN.md` avec durée et dépendances. Checklist avant Slice 11 (booking) incluse. Généré le 2026-02-XX. pour `GET /api/domains`, `GET /api/tags/categories`, `GET /api/tags` — référentiels légers. Auth : AUCUNE (3 endpoints totalement publics). Tables : `domains`, `tag_categories`, `tags`, `tag_category_links`, `tag_entity_type_links`. Pas de pagination (LIMIT 200 sur GET /tags uniquement). Pièges clés : groupement Python côté application pour `GET /tags/categories` (2 requêtes + Map), DISTINCT conditionnel dans `GET /tags` (branche A seulement), `include_inactive=true` public sans auth sur `GET /domains`. 10 règles métier, 22 cas de test. Niveau de risque : FAIBLE. Généré le 2026-02-XX.
- **Slice 14** : 6 fichiers créés dans `/app/docs/migration/SLICE_14_*.md` pour `PATCH /api/bookings/{booking_id}/status → completed` (Java : `POST /api/bookings/{bookingId}/complete`). Auth : STRICTE (receiver OU admin). AUCUN appel Stripe. AUCUNE push notification. 3 UPDATEs atomiques : bookings (→completed), service_slots (→completed si booked, via sous-requête corrélée), payments (→captured si authorized, DB uniquement). Piège critique : PAS de garde sur le statut courant (Python accepte n'importe quel statut source). 16 cas de test. Niveau de risque : FAIBLE. Généré le 2026-02-XX.
- **Slice 15** : 6 fichiers créés dans `/app/docs/migration/SLICE_15_*.md` pour `POST /api/bookings/{booking_id}/cancel`. Auth : STRICTE. 3 acteurs (payer/receiver/admin) avec droits asymétriques. Matrice payment 4 branches : requires_auth/authorized/capture_pending→cancelled, captured→refunded, else→inchangé. Transaction atomique (bookings + payments + service_slots). Stripe hors transaction : cancel_payment_intent (stub) + create_refund (branche unique, charge_id requis). 3 patterns push (admin→les deux, payer→receiver, receiver→payer). Body optionnel `{"reason": string|null}`. `cancelled_by_user_id` et `cancellation_reason` tracés. Pièges : receiver limité à `accepted` (409 pas 403), is_payer vérifie user_id ET payer_user_id, charge_id NULL → log warning sans Stripe, idempotence early return. 22 cas de test. Niveau de risque : MOYEN. Généré le 2026-02-XX.
- **Slice 16** : 6 fichiers créés dans `/app/docs/migration/SLICE_16_*.md` pour `POST /api/webhook/stripe` (paiements uniquement — abonnements → Slice 18). Auth : AUCUNE (vérification HMAC Stripe-Signature). Tables : `stripe_webhook_events` (PK idempotence, INSERT ON CONFLICT), `payments`, `bookings`. 10 event types paiements : checkout.session.completed (3 branches), payment_intent.* (5 events), charge.refunded, refund.updated. Pièges critiques : body raw bytes OBLIGATOIRE (signature HMAC invalide si Spring parse JSON), toujours retourner 200 (Stripe réessaie si non-200), checkout.session.completed dual routing (mode=payment vs subscription), `stripe_charge_id` stocké uniquement via `latest_charge` dans payment_intent.succeeded, notifications hors transaction, 4 fallbacks `_resolve_payment_id`. 18 cas de test. Niveau de risque : MOYEN-ÉLEVÉ. Généré le 2026-02-XX.
- **Slice 17** : 6 fichiers créés dans `/app/docs/migration/SLICE_17_*.md` pour `POST /api/payments/checkout/session` + `GET /api/payments/checkout/status/{sessionId}`. Auth : STRICTE (POST, 404 si pas payer — pas 403) / OPTIONNELLE (GET, user peut être None — redirect web Stripe). Tables : `payments` (LEFT JOIN `bookings`). 13 règles métier (BR-01→BR-13). Pièges critiques : montant TOUJOURS depuis snapshot `payer_total_amount` (jamais recalculé), `{{CHECKOUT_SESSION_ID}}` = placeholder Stripe littéral (ne pas interpoler en Java), UPDATE CASE idempotent (ne pas régresser si webhook S16 déjà passé), lookup double clé `cs_...` OU `pi_...`, `real_session_id` depuis DB (pas le paramètre URL), graceful failure Stripe retrieve → `status="unknown"` + HTTP 200. Push uniquement branche instant_booking. Niveau de risque : MOYEN. Généré le 2026-02-XX.
- **Slice 18** : 6 fichiers créés dans `/app/docs/migration/SLICE_18_*.md` pour `ExpiryWorker` — worker asyncio d'expiration automatique des bookings (`expiry_worker.py` intégral + `server.py:278–285`). Aucun endpoint HTTP. Scheduler `@Scheduled(fixedDelay=60s, initialDelay=0)`. Tables : `bookings` (SELECT FOR UPDATE SKIP LOCKED + UPDATE→expired), `payments` (LEFT JOIN + UPDATE→cancelled conditionnel), `service_slots` (UPDATE→available si slot_type IN single/specific), `notifications` (INSERT x2), `services` (SELECT title). Stripe : `cancel_payment_intent` HORS transaction après COMMIT. 11 règles métier (BR-01→BR-11). Pièges critiques : FOR UPDATE SKIP LOCKED = requête native obligatoire en Java (JPA ne supporte pas), drain loop while (`count >= BATCH_SIZE`) — ne pas traiter qu'un seul batch, Stripe hors `@Transactional` (ne pas tenir le lock DB pendant appel réseau), `slot_type IN ('single','specific')` UNIQUEMENT (récurrents jamais libérés), guard `RETURNING booking_id` → skip silencieux si race condition. Notifications DB uniquement (pas de push FCM). 36 cas de test. Niveau de risque : MOYEN. Généré le 2026-02-XX.
- **Slice 19** : 6 fichiers créés dans `/app/docs/migration/SLICE_19_*.md` pour `StripePaymentService` Java — les 3 appels réseau réels (`capture`, `cancel`, `refund`) qui remplacent TOUS les stubs écrits dans les Slices 12, 13, 15 et 18. Source : `stripe_service.py:136–237`. Méthodes : `capturePaymentIntent(intentId, amountToCapture?)`, `cancelPaymentIntent(intentId, reason)` avec mapping `_CANCEL_REASONS` (5 entrées → Stripe enum), `createRefund(chargeId, amountCents?, reason, idempotencyKey?)` avec préfixe `rf_` idempotence. Infrastructure : `StripeConfig` (`@PostConstruct` + proxy Emergent conditionnel), pas de `@Transactional` (service pur réseau). 13 règles métier (BR-01→BR-13). Pièges critiques : service HORS `@Transactional` obligatoire, `CancellationReason` enum Java vs string Python, `RefundCreateParams.Reason` enum, idempotency_key préfixée `rf_`, `amount_to_capture` en centimes Long (pas Double). 36 cas de test (unitaires + intégration callers). Niveau de risque : MOYEN. Après S19, 0 stub Stripe restant dans le cycle booking write S12–S18. Généré le 2026-04-13.
- **Slice 20** : 6 fichiers créés dans `/app/docs/migration/SLICE_20_*.md` pour `SubscriptionWebhookHandler` Java — première slice Stripe Subscriptions. Handler des 6 event types subscription dans le dispatcher webhook centralisé (extension de S16). Events : `checkout.session.completed` (mode=subscription) → INSERT active + benefits_snapshot, `customer.subscription.created` → INSERT fallback, `customer.subscription.updated` → mapping 5 statuts (active/cancelling/cancelled/past_due/trialing), `customer.subscription.deleted` → cancelled inconditionnel, `invoice.paid` → renouvellement (expires_at + force active), `invoice.payment_failed` → past_due. Tables : `user_subscriptions` (INSERT + UPDATE), `subscription_plans` (SELECT). 14 règles métier (BR-01→BR-14). Pièges critiques : dual routing `checkout.session.completed` (même event dans PAYMENT_EVENTS et SUBSCRIPTION_EVENTS — discriminant par `mode`), appel Stripe `retrieve_subscription` DANS le handler (try/except protège), handler legacy `subscription_routes.py:handle_subscription_event` dupliqué NON appelé en production (ne pas migrer), guard `NOT IN ('cancelled')` sur 4/6 events (SAUF `subscription.deleted`). Anomalie documentée : `benefits_snapshot` figé à l'activation (jamais mis à jour). 36 cas de test. Niveau de risque : MOYEN. Fondation obligatoire pour tous les endpoints subscription (S21+). Généré le 2026-04-13.
- **Slice 21** : 6 fichiers créés dans `/app/docs/migration/SLICE_21_*.md` pour le cycle complet abonnement utilisateur — 6 endpoints. `GET /subscription-plans` (public, plans actifs ordonnés), `POST /subscriptions/subscribe` (3 appels Stripe séquentiels : get_or_create_customer → ensure_subscription_price → create_subscription_checkout_session, idempotency key time window 5min), `GET /subscriptions/checkout/status/{session_id}` (ownership par customer_id, admin bypass), `GET /subscriptions/me` (inclut past_due contrairement à /subscribe guard, retourne has_subscription:false pas 404), `GET /subscriptions/history` (tous statuts, pas de LIMIT), `POST /subscriptions/cancel` (immediate réservé admin, Stripe AVANT DB — ordre inversé vs booking cancel S15, body optionnel). Tables : `subscription_plans` (SELECT + UPDATE stripe_ids), `user_subscriptions` (SELECT + UPDATE), `users` (UPDATE stripe_customer_id). 14 règles métier (BR-01→BR-14). Asymétrie critique : filtre status différent entre /me (inclut past_due), /subscribe guard (exclut past_due), /cancel (exclut past_due). 40 cas de test. Niveau de risque : MOYEN. Ferme le cycle complet abonnement côté utilisateur (plans → subscribe → checkout → /me → cancel → history). Généré le 2026-04-13.
- **Slice 22** : 6 fichiers créés dans `/app/docs/migration/SLICE_22_*.md` pour Admin Subscriptions & Plans complet — CRUD plans (4 endpoints `admin_routes.py`) + gestion subscriptions admin (2 endpoints `subscription_routes.py`). `GET /admin/subscription-plans` (SELECT *, inclut stripe_*, actifs+inactifs — DUPLICATION documentée : même chemin dans 2 fichiers Python), `POST /admin/subscription-plans` (seul `name` requis, pas de validation price/duration_days), `PUT /admin/subscription-plans/{plan_id}` (UPDATE dynamique avec set `allowed` de 10 champs, champs inconnus ignorés, pas de sync Stripe), `DELETE /admin/subscription-plans/{plan_id}` (suppression physique, FK non gérée en Python → 500, en Java → 409), `GET /admin/subscriptions` (LEFT JOIN users+plans, LIMIT 500), `POST /admin/subscriptions/{subscription_id}/cancel` (lookup par ID direct sans filtre status, Stripe AVANT DB, pas de guard re-cancel). 13 règles métier (BR-01→BR-13). 35 cas de test. Niveau de risque : FAIBLE. **Domaine subscription intégralement couvert (S19→S22).** Généré le 2026-04-13.
- **FINAL MIGRATION GAP ANALYSIS** : 6 fichiers créés dans `/app/docs/migration/FINAL_*.md` (1043 lignes). Inventaire exhaustif des 179 endpoints Python + 3 WebSockets + 6 workers. **22% documenté** (39/179), **78% restant** (~140 endpoints). 10 blockers identifiés pour front full-Java, ~64 endpoints P0. Ordre recommandé en 9 blocs (S23→S46). Cutover possible après Bloc 5 (97 endpoints front user). Généré le 2026-04-13.
- **Slice 23** : 6 fichiers créés dans `/app/docs/migration/SLICE_23_*.md` pour Auth complet — 6 endpoints + infrastructure JWT/bcrypt/OAuth partagée. `POST /auth/register` (bcrypt hash, INSERT users, JWT HS256 7j), `POST /auth/login` (verify bcrypt, anti-enumeration message identique), `POST /auth/google` (Emergent OAuth propriétaire via X-Session-ID header, upsert user — écrase name+picture à chaque login), `GET /auth/me` (infra require_auth → S02), `POST /auth/logout` (no-op serveur, success:true), `PUT /auth/change-password` (vérifie ancien hash, Google users sans password_hash→401). Infrastructure : `JwtService` (claim custom "user_id" PAS "sub", expire 7j), `JwtAuthFilter` (Header Bearer > cookie winek_token), `require_auth/require_role/get_optional_auth` (middleware pour TOUTES les slices), rate limiting 5/min register+login 10/min google. 13 règles métier (BR-01→BR-13). Pièges critiques : JWT_SECRET IDENTIQUE Python/Java obligatoire au cutover, Emergent OAuth protocole propriétaire (pas id_token standard), BCrypt $2b$ vs $2a$ cross-compatible. 37 cas de test. Niveau de risque : MOYEN. Pré-requis absolu pour tout le backend Java. Généré le 2026-04-15.
- **Slice 24** : 6 fichiers créés dans `/app/docs/migration/SLICE_24_*.md` pour Profile write + Upload image + Push tokens — 7 endpoints fermant le flow "configuration compte". `PUT /users/profile` (UPDATE dynamique 16 champs, CLEARABLE_FIELDS pour null explicite, JSONB ::jsonb cast pour coach_tags/goals/user_roles, suppression ancienne photo via delete_upload_file), `POST /users/become-coach` (transition user→coach, 400 si déjà coach/admin), `PATCH /users/{uid}/cover` (ownership strict, cover_offset_y/cover_scale optionnels), `POST /upload-image` (Cloudflare R2 + fallback local, magic bytes 5 formats, compression Pillow, 15 Mo max, catégorisation profiles/services/spotyou/chats/products/other), `POST /upload-image/debug-422` (debug), `POST /push-token` (ExponentPushToken validation, upsert ON CONFLICT, transfert entre users), `DELETE /push-token` (soft-disable is_active=FALSE). 14 règles métier (BR-01→BR-14). Pièges critiques : CLEARABLE_FIELDS distingue absent vs null en Pydantic (Jackson Java ne le fait pas nativement), R2 S3-compatible avec endpoint custom, HEIC non supporté par ImageIO Java. 37 cas de test. Niveau de risque : MOYEN. Upload est la dépendance critique de tous les CRUD à venir (services, SpotYou, chat). **Bloc 1 complet après S24.** Généré le 2026-04-15.
- **Slice 25** : 6 fichiers créés dans `/app/docs/migration/SLICE_25_*.md` pour Home feed — 2 endpoints écran d'accueil. `GET /home/nearest-sector` (PostGIS ST_Distance ORDER BY LIMIT 1 + ST_DWithin 50km count, auth optionnelle, retourne null si vide), `GET /home/feed` (PostGIS, auto-expansion rayon 50→100→200→500km si <3 résultats, scoring 3 signaux — tags communs 0-40 + popularité 0-30 + distance 0-30 + bonus membre +20, mix SpotYou LIMIT 60→30 + Services LIMIT 40→20 via service_locations JOIN, batch is_going, coach object wrapping, JSONB double parsing). 6 tables lues (tag_points, services, service_locations, users, spot_you_members, spot_you_attendance, bookings). 12 règles métier (BR-01→BR-12). Pièges critiques : ST_MakePoint(lng,lat) pas (lat,lng), auto-expansion worst case 4×3 queries, SQL dynamique conditionnel. 17 cas de test. Niveau de risque : ÉLEVÉ (PostGIS obligatoire). Force PostGIS — pré-requis de S27–S32. **Bloc 2 commencé.** Généré le 2026-04-15.
- **Slice 26** : 6 fichiers créés dans `/app/docs/migration/SLICE_26_*.md` pour SpotYou lectures — 7 endpoints. `GET /tag-points` (search PostGIS + filtres dynamiques domain_id/tag_ids/?| operator, auth optionnelle, precision offset privacy), `GET /tag-points/mine` (batch queries participants_count + going_count + is_going + next_session_date), `GET /tag-points/saved` (JOIN tag_point_saves + batch enrichissement), `GET /tag-points/{point_id}` (détail : 8 queries parallèles asyncio.gather — tags, vote stats, vote distribution, member count + is_participant, is_going, is_saved — endpoint le plus complexe du codebase), `GET /tag-points/{point_id}/similar` (JSONB jsonb_typeof + jsonb_array_elements_text, tags OR distance <10km), `GET /tag-points/{point_id}/participants` (public, créateur first), `GET /users/me/pending-requests` (membership pending). Helpers partagés : TP_FIELDS (26 colonnes + 3 sous-requêtes corrélées), build_point_response (owner object, GeoJSON, address masking), apply_precision_offset (brouillage GPS déterministe par seed). 7 tables lecture seule. 13 règles métier (BR-01→BR-13). Pièges critiques : détail 8 queries parallèles asyncio.gather → CompletableFuture ou séquentiel Java, `?|` operator JDBC conflit, precision offset hashCode Python≠Java. 29 cas de test. Niveau de risque : ÉLEVÉ. Première slice SpotYou — fondation pour les writes (S27+). Généré le 2026-04-15.
- **Slice 27** : 6 fichiers créés dans `/app/docs/migration/SLICE_27_*.md` pour SpotYou membership lifecycle complet — 11 endpoints. Machine d'états à 4 statuts (pending, accepted, invited, rejected). Save/unsave (ON CONFLICT DO NOTHING, idempotent). Join 3 modes (open→accepted direct, admin_approval→pending+push owner, members_approval→pending+push tous membres). Private→403 invitation uniquement. Re-join après reject via ON CONFLICT DO UPDATE WHERE status='rejected'. Cancel (pending uniquement, DELETE physique). Leave (même SpotYou inactif, DELETE physique). Invite (permissions admin_only/admin_and_members, anti-doublon par status, réinvitation rejected). Accept/refuse invitation (status='invited' requis). Join-requests (permission owner + membres si members_approval). Approve (owner+membres, 1 acceptation suffit). Reject (owner seul — asymétrie intentionnelle). Capacité max_community_members check. Push notifications fire-and-forget (8/11 endpoints). 15 règles métier (BR-01→BR-15). 48 cas de test. Niveau de risque : MOYEN. Cœur des interactions sociales SpotYou. Généré le 2026-04-19.
- **Slice 28** : 6 fichiers créés dans `/app/docs/migration/SLICE_28_*.md` pour SpotYou CRUD — 3 endpoints write. `POST /tag-points` (create : PostGIS INSERT `ST_SetSRID(ST_MakePoint(lng,lat),4326)`, 21 champs dont 3 JSONB `$N::jsonb` tag_ids/images/event_schedule, `randomize_for_storage` brouillage GPS random NON déterministe avant stockage, auto-membership owner via INSERT spot_you_members ON CONFLICT DO NOTHING, défauts visibility_type=public/join_mode=open/invite_permissions=admin_only). `PUT /tag-points/{point_id}` (update : 165 lignes, owner OU admin plateforme, SQL dynamique 15+ champs conditionnels, location via ST_MakePoint si lat+lng fournis, helper `_vals_equal` comparaison timestamps UTC + floats tolérance 1e-7 + JSONB json.dumps sort_keys, suppression images retirées via delete_upload_files, push fire-and-forget aux membres SSI has_real_changes ET NOT cancelled, body vide → retour sans UPDATE). `PATCH /tag-points/{point_id}/new-date` (toggle booléen NOT current, owner OU admin). 13 règles métier (BR-01→BR-13). Pièges critiques : double offset GPS indépendant (randomize_for_storage random write vs apply_precision_offset déterministe read = S26), JSONB `::jsonb` via String JSON en Java (ObjectMapper.writeValueAsString + PgObject/cast), notifications conditionnelles sur diff réel (pas sur réception body), auto-membership idempotent. 31 cas de test. Niveau de risque : ÉLEVÉ. Acte fondateur de la plateforme — sans create, pas de contenu. Réutilise `build_point_response`/`TP_FIELDS` de S26 et `delete_upload_files` de S24. Généré le 2026-04-19.

---

### Migration Java — Slice 43 (2026-05-08) — Services Coach CRUD principal (5 endpoints write)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/SLICE_43_*.md`
  - `SLICE_43_SCOPE.md`, `SLICE_43_API_CONTRACTS.md`, `SLICE_43_DB_MAPPING.md`, `SLICE_43_BUSINESS_RULES.md` (12 sections, ~30 règles), `SLICE_43_TEST_CASES.md` (~50 cas TC-1.x à TC-6.x), `SLICE_43_CURSOR_IMPLEMENTATION_NOTES.md`
- **5 endpoints couverts** (`routes/service_routes.py:756–1104`) :
  - `POST /api/services` — create (coach/admin), 1 INSERT services + N INSERT service_locations PostGIS, normalisation booking via `app_config`
  - `PUT/PATCH /api/services/{id}` — même handler, whitelist scalar + JSONB cast `::jsonb` + replace destructif locations + **suppression IMMÉDIATE images retirées** (`delete_upload_files` sync R2/FS)
  - `DELETE /api/services/{id}` — soft delete : `active=FALSE`, `deleted_at`, `media_purge_scheduled_at = NOW()+90j`, INSERT pending_file_deletions (×img), UPDATE conversations context_deleted, **garde 409 bookings actifs** (sauf admin)
  - `POST /api/services/{id}/reactivate` — réactivation < 90j (full restore) ou ≥ 90j (`media_purged=TRUE` → `requires_media_reupload:true`), DELETE pending_file_deletions pending, UPDATE conversations
- **Tables touchées (8)** : `services` (INSERT/UPDATE), `service_locations` (PostGIS write `ST_SetSRID(ST_MakePoint(lng,lat),4326)`), `pending_file_deletions` (INSERT lifecycle / DELETE reactivate), `conversations` (UPDATE context_deleted), `app_config` (SELECT flags), `bookings` (SELECT garde COUNT statuts actifs), `service_slots` / `service_packages` (deferred S44/S45).
- **Découpage strict** : slots[] et packages[] **acceptés** au contrat API mais **persistance reportée S44/S45**. Save/unsave **exclus** (slice favoris dédiée). Locations conservées car indissociables masquage adresse S42.
- **Top 3 pièges identifiés** :
  1. **`images=null` vs `images=[]` vs liste** — None=keep / [] = wipe sync R2 / liste = diff + suppression sync des retirées. À reproduire **strictement** côté Java (Optional/JsonNullable, ne jamais convertir null→[] au binding).
  2. **Asymétrie purge médias** — UPDATE images = suppression **synchrone immédiate** R2/FS via `delete_upload_files` ; DELETE service = programmation **différée 90j** via `pending_file_deletions`. Deux comportements pour le même type de fichier.
  3. **Defaults booking POST vs PUT divergents** — POST `mode='manual_approval'` / `payLater=true` / `expiry=1440` ; PUT `mode='instant_booking'` / `payLater=false` / `expiry=1440`. **Asymétrie volontaire** à conserver. ServiceCreate Pydantic n'expose PAS booking_approval_mode (lu via `getattr` avec defaults), à exposer côté DTO Java.
- **Asymétries préservées** : whitelist scalar PUT (sans `coach_id`/`address`), pas de validation `title≥5/images≤5/price≥0` sur PUT (alors que POST oui), `media_purged` ne repasse jamais à FALSE après reactivate, `pay_later_expiration_minutes` jamais NULL en DB (`or 1440`), conversations matching uniquement par `context_id` sans filtre `context_type`, messages erreur mixtes français (REACTIVATE) / anglais (UPDATE/DELETE).
- **Recommandation Java au-delà de l'iso-Python** : imposer `@Transactional` sur les 4 méthodes service (Python n'a aucune transaction explicite — amélioration de robustesse sans impact métier, à documenter en Javadoc).
- **Garde DELETE bookings actifs** : statuts bloquants `IN ('pending','accepted','awaiting_payment','confirmed')`, message FR avec compteur exact. Admin **bypass** la garde.
- **Niveau de risque** : MOYEN-ÉLEVÉ — PostGIS write + JSONB cast dynamique + diff images sync + lifecycle 90j + normalisation booking flags + 5 messages erreur exacts (FR/EN mixés).
- **Justification du choix** : débloque le **dashboard coach complet** (créer/éditer/supprimer/réactiver service) — sans S43 le coach reste captif du Python. Découpage propre slots/packages → S44/S45 préserve un PR Java de taille raisonnable. Réutilise `_enrich_service` mapper de S42 et worker `pending_file_deletions` de S40.
- **HORS scope (volontairement reporté)** : `service_slots` writes (recurring/single/availability + days_of_week + location_index + raw_schedule) → **S44**. `service_packages` writes (+ DaySlotPayload nested + calcul prix dérivé) → **S45**. `POST /save` + `DELETE /unsave` → **slice favoris**. Notifications, audit log, réindexation : hors scope global.
- **Aucune modif de code Python** (mode documentation-only strict).

---

### Migration Java — Slice 42 (2026-04-30) — Services Coach LECTURES (5 endpoints)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/SLICE_42_*.md` couvrant le bloc lectures Services.
  - `SLICE_42_SCOPE.md`, `SLICE_42_API_CONTRACTS.md`, `SLICE_42_DB_MAPPING.md`, `SLICE_42_BUSINESS_RULES.md` (18 règles BR-42.01 à BR-42.18), `SLICE_42_TEST_CASES.md` (~67 cas T42-SRC/MIN/SAV/DEA/DET/INT/EDGE), `SLICE_42_CURSOR_IMPLEMENTATION_NOTES.md`
- **5 endpoints couverts** (`routes/service_routes.py:1–754`) :
  - `GET /api/services` (search PostGIS public, auto-exclusion services personnels si JWT, LIMIT 100) — 352-413
  - `GET /api/services/mine` (coach dashboard, 7 queries // batch enrich avec slots+packages) — 416-427
  - `GET /api/services/saved` (format plat distinct via `json_build_object`+`json_agg` SQL inline) — 645-684
  - `GET /api/services/deactivated` (lifecycle service supprimé + calcul `days_until_media_purge`) — 687-715
  - `GET /api/services/{service_id}` (`get_optional_auth` + détection `is_owner` coach OR admin) — 718-753
- **Tables touchées (9 lecture seule)** : `services`, `service_locations` (PostGIS ST_X/ST_Y), `service_slots` (filtre futurs + NOT EXISTS bookings), `service_packages`, `service_saves`, `users` (coach JOIN), `reviews` (AVG/COUNT GROUP BY), `tags` (lookup), `bookings` (sub-query NOT EXISTS).
- **Auth** : 2 endpoints publics (`search`, `detail`), 3 authenticated (`mine`, `saved`, `deactivated`). Aucun n'exige role coach. `is_owner` détecté applicativement (coach OR admin).
- **18 règles métier** : auth différenciée, auto-exclusion services personnels search (try/catch silencieux), LIMIT 100 hardcodé, filtres dynamiques composables, **filtre slots futurs concaténation `(slot_date || ' ' || start_time)::timestamp` + NOT EXISTS bookings 4 statuts**, helper `_mask_address` (precision exact/100m/1000m + skip country names FR), `is_owner` (coach OR admin) detail, suppression `original_address`/`original_description` non-owner detail, search vue light (`slots:[]`, `packages:[]`, `is_owner:false` toujours), saved format plat distinct (DTO séparé, pas tag_ids/tags/slots/packages), `available_slots` count saved sans NOT EXISTS booking (asymétrie compat), `days_until_media_purge` UTC-aware avec `max(0, days)`, detail SANS filtre `active`/`deleted_at` (compat permissive), `_fetch_pkg_slots` séquentiel post-packages, `images`/`tag_ids` parsing dual jsonb/text fallback.
- **~67 cas de test T42-XX-NN** : SRC 17, MIN 10, SAV 9, DEA 9, DET 9, INT 7, EDGE 10. Régressions S11 (booking detail consomme `/services/{id}`), S25 (home feed cohérent), S37 (price-preview package lookup), S38 (catalogue marketplace cohérent).
- **Top 3 pièges identifiés** :
  1. **Ambiguïté `WHERE sl.service_id = service_id`** (l. 385) — le `service_id` non préfixé est interprété par PostgreSQL comme la colonne outer query `services.service_id` (corrélation). Java DOIT qualifier explicitement `services.service_id` pour éviter ambiguïté + valider plan d'exécution PostgreSQL.
  2. **Cast string `(slot_date || ' ' || start_time)::timestamp > NOW()::timestamp`** + **`slot_date >= TO_CHAR(NOW(), 'YYYY-MM-DD')`** (saved) — préserver SQL exact, **NE PAS optimiser** en `slot_date::date` ni `CURRENT_DATE`. Sous-requêtes `json_build_object`/`json_agg` (saved) → mapping Jackson dans row mapper Java (string JSON retourné par PostgreSQL).
  3. **Format réponse asymétrique 5 endpoints** — search (light, slots/packages vides toujours) vs mine (owner complet) vs saved (format PLAT distinct sans tag_ids/tags/slots/packages, latitude/longitude flat) vs deactivated (lifecycle minimal + days_until_media_purge) vs detail (mêmes données que mine mais avec is_owner conditionnel). 5 DTO Java distincts requis. NE PAS factoriser.
- **Asymétries préservées** : LIMIT 100 hardcodé, auto-exclusion silencieuse JWT KO, slots vue light search (`slots:[], packages:[], is_owner:false` toujours), saved format plat (5 champs en moins vs mine), available_slots saved sans NOT EXISTS booking (vs mine avec), detail sans filtre lifecycle (consultable même si deleted), 404 detail format `{"detail": "Service not found"}` (HTTPException Spring 6).
- **Niveau de risque** : ÉLEVÉ (PostGIS + 7 queries // batch enrich + SQL string concat + dual parsing jsonb/text + 5 DTO distincts + cast string-timestamp).
- **Justification du choix** : suite logique débloquant **5 écrans front simultanément** (Search / Coach Dashboard / Saved / Deactivated / Service Detail). **`GET /services/{id}` est la dépendance critique de S11 booking detail** — sans S42 le booking est aveugle. Pattern enrich `_batch_enrich_*` mis en place sera **réutilisé tel quel par S43+ writes** (qui retournent le service enrichi via le même service).
- **HORS scope (volontairement reporté)** : POST/PUT/DELETE/reactivate/save/unsave services → **S43** (R2 upload + PostGIS write + flag normalization). Service slots writes → S44. Service packages writes → S45. Helpers `_get_booking_flags` et `_normalize_booking_config` → S43.
- **Roadmap S43 suggérée** : 🔴 **Services CRUD writes** (create/update/delete/reactivate + save/unsave) — ferme la boucle authoring services côté coach.
- **Aucune modif de code Python** (mode documentation-only strict).

---

### Audit final pré-cutover (2026-04-30) — 5 livrables consolidés
- **Livrables** : 5 documents générés dans `/app/docs/migration/` :
  - `FINAL_CUTOVER_GAPS.md` — endpoints non migrés / migrés avec écart / non utilisés / critiques manquants (~48 endpoints non migrés sur 128)
  - `FRONT_API_COVERAGE.md` — couverture par domaine : 5/12 ✅ OK (Auth, Booking, Payments, Subscriptions, Marketplace), 3/12 🟡 PARTIEL (Users, SpotYou, Admin), 4/12 🔴 MANQUANT (Chat, Adresses, Notifications/Agenda, Services coach)
  - `BLOCKERS_BEFORE_FRONT_SWITCH.md` — 10 P0 (~12-18 j), 9 P1 (~10-14 j), 6 P2 (~3 j)
  - `TECHNICAL_HARDENING_CHECKLIST.md` — env vars, Stripe, R2, PostGIS, CORS, workers, logs, monitoring, DB migrations
  - `RECOMMENDED_NEXT_STEPS.md` — 5 phases (~4-8 semaines selon ressources)
- **Méthodologie** : grep `lib/api.ts` + ~80 chemins front détectés vs 128 endpoints Python détectés vs slices S10–S41 PRD.
- **Couverture finale** : ~62% endpoints, ~70% pondérée par usage front, **5/12 domaines complets**.
- **Top 5 blockers restants** :
  1. 🔴 **Chat domaine entier non migré** (4 REST + 1 WS) — écran tab principal KO
  2. 🔴 **Services coach domaine entier non migré** (11 endpoints) — booking S11-S15 inopérants en cascade
  3. 🔴 **Slice 12 (booking create) à AUDITER d'urgence** — possible gap caché dans la PRD
  4. 🔴 **Notifications inbox + Agenda + planning-events** non migrés (5 endpoints) — front utilise massivement
  5. 🔴 **JWT_SECRET partagé Python/Java** non vérifié — risque invalidation tous les tokens au cutover
- **Découverte critique** : `image_urls` est `jsonb` (confirmé S41 `jsonb_array_length`) — à reporter rétroactivement S39/S40.
- **GO / NO-GO** : ❌ **NO-GO actuel** — 10 P0 bloquants. Cutover possible après 4-8 semaines de travail (Phase 1 doc + Phase 2 impl Cursor + Phase 3 hardening + Phase 4 tests E2E + Phase 5 cutover progressif Remote Config).
- **Stratégie recommandée** : cutover progressif Remote Config (5% → 25% → 100%) par domaine, avec rollback OTA Expo prêt.
- **Aucune modif de code Python** (mode documentation-only strict).

---

### Migration Java — Slice 41 (2026-04-30) — Marketplace Admin moderation (pending/approve/reject + reminder worker)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/SLICE_41_*.md` couvrant le bloc admin marketplace.
  - `SLICE_41_SCOPE.md`, `SLICE_41_API_CONTRACTS.md`, `SLICE_41_DB_MAPPING.md`, `SLICE_41_BUSINESS_RULES.md` (21 règles BR-41.01 à BR-41.21), `SLICE_41_TEST_CASES.md` (~92 cas T41-PND/DET/APP/REJ/WRK/INT/EDGE), `SLICE_41_CURSOR_IMPLEMENTATION_NOTES.md`
- **4 endpoints + 1 worker couverts** (`routes/admin_product_routes.py:1–207` + `admin_product_reminder_worker.py:1–104`) :
  - `GET /api/admin/products/pending` (liste pending_review + JOIN seller + `quality_score` SQL 0-100) — 43-80
  - `GET /api/admin/products/{id}` (`SELECT p.*` + seller_email + quality_score) — 84-111
  - `POST /api/admin/products/{id}/approve` (UPDATE 5 colonnes + push seller `product_approved`) — 115-157
  - `POST /api/admin/products/{id}/reject` (UPDATE 6 colonnes + `rejection_reason = admin_comment` dupliqué + push seller deeplink edit) — 161-206
  - `AdminProductReminderWorker` Spring `@Scheduled(fixedDelay=600000)` — produits >2h sans rappel + push M×N admins
- **Tables touchées (2)** : `marketplace_products` (UPDATE 5/6 colonnes selon action + UPDATE batch `admin_reminder_sent_at`) + `users` (JOIN read pour seller_name/picture/email + SELECT admins pour reminder).
- **Auth** : helper applicatif `_require_admin` (S23 + check `role=='admin'`) — 401 JWT KO ; **403 avec `{"detail":"Admin only"}`** (custom AccessDeniedHandler côté Java).
- **🔴 DÉCOUVERTE CRITIQUE rétroactive** : `image_urls` est de type **`jsonb`** (confirmé par `jsonb_array_length(COALESCE(p.image_urls, '[]'::jsonb))` dans le calcul `quality_score`). Cette info résout l'incertitude DDL planant sur S39 (création produit) et S40 (DELETE planification purge médias) — **à reporter dans les notes S39/S40** lors de la prochaine consolidation. Java doit utiliser `PGobject(type="jsonb", value=ObjectMapper.writeValueAsString(list))` pour `image_urls`.
- **21 règles métier** : auth admin, format erreur asymétrique 403/404 (`detail` vs `error`), `quality_score` 9 critères pondérés en SQL (PAS en Java), GET pending FIFO + JOIN strict (sellers orphelins masqués), GET detail `SELECT p.*` drift schéma volontaire, **AUCUN guard sur statut courant approve/reject** (compat permissive — admin peut ressusciter zombie deleted/draft/rejected/active), UPDATE approve 5 colonnes (status=active + in_stock=TRUE + admin_validated_*), UPDATE reject 6 colonnes avec **`rejection_reason = admin_comment = :comment`** (1 paramètre, 2 placements SQL), comment optionnel strip vide→null DB, push synchrone Python (recommandation `@Async` post-commit Java), push payload exact (titre + guillemets typographiques `«»` + deeplink edit), divergence subtile **`data.admin_comment` peut être `""` côté push tandis que DB stocke `null`**, worker cadence 600s + délai 2h + LIMIT 50 + UPDATE batch puis push M×N (cartésien produits×admins), worker ordre UPDATE BEFORE push (rappels manqués acceptés en cas d'échec push).
- **~92 cas de test T41-XX-NN** : PND 13 (FIFO + JOIN strict + quality_score), DET 7 (drift + seller_email), APP 14 (idempotent + zombie), REJ 11 (duplication + push payload), WRK 16 (idempotence 2h + LIMIT 50), INT 10 (régressions S38/S39/S40 dont **anomalie zombie DELETE→approve** et **rejection_reason perdu après Reactivate**), EDGE 15 (quality_score bornes exactes).
- **Top 3 pièges identifiés** :
  1. **Format JSON erreur asymétrique 403/404** — 403 retourne `{"detail":"Admin only"}` (HTTPException) tandis que 404 retourne `{"error":"Produit introuvable."}` (`JSONResponse`). Java DOIT préserver les 2 schémas distincts via custom AccessDeniedHandler (403) + custom exception handler (404).
  2. **Anomalie zombie + duplication SQL critiques** — (a) approve/reject SANS guard `status='pending_review'` peuvent ressusciter un produit deleted (`deleted → active`), à préserver mais logguer WARN ; (b) reject UPDATE écrit la **MÊME valeur `:comment`** dans 2 colonnes distinctes (`rejection_reason` ET `admin_comment`) — `MapSqlParameterSource` Java avec named param réutilisé 2 fois ; (c) push reject `data.admin_comment` peut être `""` (string vide) tandis que DB stocke `null` — divergence subtile à reproduire.
  3. **`image_urls` est `jsonb`** (CONFIRMÉ par S41) — résout l'incertitude DDL S39/S40. Java DOIT utiliser `PGobject(type="jsonb", value=mapper.writeValueAsString(list))` partout. À reporter rétroactivement dans S39/S40 lors de la consolidation.
- **Asymétries préservées** : 2 mécanismes erreur (detail/error), GET pending vs GET detail (seller_email seulement en detail), JOIN strict masque sellers orphelins, push synchrone bloque réponse, dual `rejection_reason`/`admin_comment`, push reject `data.admin_comment=""` vs DB null, pas de pagination GET pending, worker ordre UPDATE→push (admin_reminder_sent_at committed avant push potentiellement échoué).
- **Anomalies compat documentées** : zombie status (admin peut ressusciter deleted via approve), Reactivate (S40) force status='active' avec rejection_reason fantôme préservé en DB (UX confuse — slice future à corriger), `users.name` vs `users.full_name` à investiguer (incohérence schéma S23/S24/S39/S41), push synchrone bloque ~200-500ms HTTP.
- **Niveau de risque** : MOYEN (4 endpoints simples + 1 worker, pas de Stripe, pas de transaction complexe, mais drift schéma SELECT p.*, JOIN strict, anomalies compat à préserver, push payloads exacts critiques).
- **HORS scope (volontairement reporté)** : edition/suppression admin produit (n'existe PAS en Python — confirmé), bulk approve/reject (n'existe pas), historique modérations (pas de table), routes `/admin/*` génériques non-marketplace → S-Admin, achat produit (n'existe pas en Python — entièrement à concevoir).
- **Bloc Marketplace seller COMPLET après S41** : S38 lecture publique + S39 authoring + S40 lifecycle + S41 admin moderation = cycle de vie complet d'un produit côté seller+admin. Le seul gap est l'achat côté buyer (entièrement à concevoir, pas une migration).
- **Roadmap suggérée** : 🟡 **Document de consolidation `MIGRATION_INDEX_MARKETPLACE.md`** (S38+S39+S40+S41) AVANT d'attaquer S42. Puis 🔴 **S42** (lifecycle SpotYou — `tag_points` soft-delete, mêmes patterns S40 réutilisés à 80%) ou 🟡 **S40-bis** (purge physique R2 — `admin_purge_worker.run_purge` + state machine `pending_file_deletions` complète).
- **Aucune modif de code Python** (mode documentation-only strict).

---

### Migration Java — Slice 40 (2026-04-30) — Marketplace Lifecycle seller (DELETE + Reactivate + MediaPurgeWorker)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/SLICE_40_*.md` couvrant le triptyque lifecycle seller.
  - `SLICE_40_SCOPE.md`, `SLICE_40_API_CONTRACTS.md`, `SLICE_40_DB_MAPPING.md`, `SLICE_40_BUSINESS_RULES.md` (17 règles BR-40.01 à BR-40.17), `SLICE_40_TEST_CASES.md` (~68 cas T40-DEL/REA/WRK/INT/EDGE), `SLICE_40_CURSOR_IMPLEMENTATION_NOTES.md`
- **2 endpoints + 1 worker couverts** (`routes/product_creation_routes.py:459–556` + `media_purge_worker.py:1–127`) :
  - `DELETE /api/products/{id}` (soft-delete owner-only, planification purge T+90j) — 459–503
  - `POST /api/products/{id}/reactivate` (restauration owner OU admin, 2 modes médias intacts/purgés) — 507–556
  - `MediaPurgeWorker` Spring `@Scheduled(fixedDelay=3600000)` — partagé 4 entités, S40 active uniquement marketplace_products
- **Path réel confirmé** : `/api/products/{id}` et `/api/products/{id}/reactivate` (PAS `/api/marketplace/products/{...}`) — cohérent avec S39.
- **Tables touchées (2)** : `marketplace_products` (UPDATE soft-delete / restauration / marquage purge — 9 colonnes lifecycle) — `pending_file_deletions` (INSERT par image avec `entity_type='product'` + DELETE annulation purge `status='pending'`).
- **17 règles métier** : auth obligatoire, DELETE owner-only sans bypass admin (anti-énumération 404), DELETE soft + planification J+90j (`now()+timedelta(days=90)`), DELETE 1 INSERT par image (`entity_type='product'`, ON CONFLICT DO NOTHING), Reactivate owner OU admin (404→409→403 ordre exact), Reactivate annule pending purges (status=pending only), Reactivate force `status='active'` peu importe statut antérieur (anomalie compat draft/pending_review→active), Reactivate **NE reset PAS `media_purged`** (dicte `requires_media_reupload`), Reactivate ne purge pas image_urls orphelines (front gère 404), idempotence asymétrique (2e DELETE→404, 2e Reactivate→409), worker cadence 3600s + idempotence triple (`media_purged=FALSE` + `status='deleted'` + `reactivated_at < deleted_at OR NULL`), worker partagé 4 entités via SQL dynamique, worker délégation `run_purge` try/catch silencieux.
- **~68 cas de test T40-XX-NN** : DEL 19, REA 22, WRK 11, INT 8, EDGE 8. Régressions S38 (catalogue exclut deleted) + S39 (mine exclut deleted) + S23 (auth).
- **Top 3 pièges identifiés** :
  1. **Format JSON erreur asymétrique** : DELETE renvoie `{"error": "..."}` (`JSONResponse`) tandis que Reactivate renvoie `{"detail": "..."}` (`HTTPException`). Java DOIT préserver les 2 mécanismes distincts (clé `error` vs `detail`) — le front teste sur cette divergence.
  2. **`image_urls` parsing dual `text[]` vs string JSON legacy** + **`cover_image_url` non purgée si hors `image_urls[]`** + **DDL `pending_file_deletions` ON CONFLICT sans UNIQUE explicite** — auditer DDL Supabase EXACTE avant repo (3 incertitudes schéma).
  3. **Idempotence triple worker** (`media_purged=FALSE` AND `status='deleted'` AND `(reactivated_at IS NULL OR reactivated_at < deleted_at)`) — la comparaison `<` strict permet le re-traitement après cycle DELETE→REACTIVATE→DELETE ; condition critique à porter exactement (la mauvaise version causerait soit double-purge soit zombie rows).
- **Asymétries préservées** : DELETE owner-only / Reactivate owner+admin, formats JSON erreur divergents, codes HTTP idempotence (404 vs 409), `media_purged` non reset par Reactivate, status auto-active à reactivate (court-circuite modération `pending_review`), worker `entity_type` polymorphe sans FK SQL.
- **Anomalies compat documentées** : status restauré toujours = `'active'` (perte du statut antérieur draft/pending_review/rejected), cover_image_url orpheline non planifiée pour purge, image_urls orphelines après purge T+90 (front doit gérer 404), 4 transactions Python fragmentées sur 4 connexions distinctes (Java fusionne en 1 `@Transactional`).
- **Niveau de risque** : MOYEN-ÉLEVÉ (worker scheduler asyncio→Spring, `text[]` vs `jsonb` à confirmer, idempotence triple, permissions asymétriques, SQL dynamique worker multi-entités).
- **HORS scope (volontairement reporté)** : `admin_purge_worker.run_purge` (suppression physique R2 + state machine pending_file_deletions complete) → slice infra dédiée (S40-bis) ; `media_notif_worker` (notif seller T+83j) → slice notif différée ; lifecycle `tag_points`/`services`/`users` → S42+ ; admin produits → S41 ; **Achat/checkout produit n'existe pas en Python (audit confirmé) — rien à migrer.**
- **Roadmap S41 suggérée** : 🔴 **Admin produits** (`admin_product_routes.py` — endpoints `/admin/products/pending`, `approve`, `reject`) — débloque la modération côté Java une fois le seller workflow complet (S39+S40).
- **Aucune modif de code Python** (mode documentation-only strict).

---

### Migration Java — Slice 39 (2026-04-29) — Marketplace Création produit (writes seller)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/SLICE_39_*.md` couvrant le triptyque seller authoring.
  - `SLICE_39_SCOPE.md`, `SLICE_39_API_CONTRACTS.md`, `SLICE_39_DB_MAPPING.md`, `SLICE_39_BUSINESS_RULES.md` (18 règles BR-39.01 à BR-39.18), `SLICE_39_TEST_CASES.md` (65+ cas T39-XX-NN), `SLICE_39_CURSOR_IMPLEMENTATION_NOTES.md`
- **⚠️ ALERTE PATH** : le prompt utilisateur mentionnait `POST /api/marketplace/products`. **Ce path n'existe PAS côté Python** — le code réel expose `POST /api/products`, `GET /api/products/mine`, `GET /api/products/{product_id}/detail` (router monté sans prefix `/marketplace` — `server.py:110`). Compat stricte = Java DOIT exposer `/api/products` (pas `/api/marketplace/products`). Documenté en haut de SCOPE.
- **3 endpoints couverts** (`routes/product_creation_routes.py:1–568`) : `POST /products` (UPSERT draft↔pending_review, 113–431), `GET /products/mine` (listing seller filtré rental+sale, 41–73), `GET /products/{id}/detail` (édition pré-remplissage 44 champs, 77–109). **Auth** : `require_auth` sur les 3 (S23) — AUCUN check de rôle seller/coach (any user authentifié).
- **Tables touchées (2)** : `marketplace_products` (INSERT 46 colonnes / UPDATE x4 fragmentés / SELECT) — `users` SELECT (notif admins). **AUCUNE** écriture sur `tags`, `notifications`, `pending_file_deletions`, `service_locations`.
- **18 règles métier** : auth obligatoire, UPSERT applicatif (PAS `ON CONFLICT` SQL pour préserver ownership check), génération id `prod_<12 hex>`, statuts pilotables (draft/pending_review) + bypass admin auto-publish (admin+pending_review→active sans notif), validations 5+3 erreurs `pending_review` rental vs sale (libellés divergents, ordre exact préservé), validation minimale 400 (title/product_type/description≥30) appliquée même en draft, anti-downgrade status 403 (active→draft interdit, clé JSON `detail` pas `error`), snapshot dénormalisé seller_name+seller_picture_url figé à l'INSERT, helper `_delivery_modes` fallback (local_pickup/creator_handoff), parse robuste virgule décimale (`"12,50"→12.50`), parse `available_quantity` int strict + `max(1,...)`, cover image fallback `image_urls[0]`, notif push admins fire-and-forget HORS transaction, atomicité fragmentée (4 transactions Python — Java fusionne en 1 `@Transactional`), ownership UPDATE+detail (404 anti-énumération), filtre `/mine` `product_type IN ('rental','sale')`, wrapping réponse asymétrique (POST minimal / mine wrapper / detail direct).
- **65+ cas de test T39-XX-NN** : POS 50 (création/édition + 5+3 validations + auth/ownership), MIN 10, DET 8, EDGE 14, INT 5 (cohérence cross-slice S23/S24/S38).
- **Top 3 pièges identifiés** : (1) **3 formats erreurs JSON divergents** — 400 `{error}` / 403 `{detail}` (FastAPI HTTPException) / 422 `{error, details[]}` — Java DOIT préserver, (2) **`text[]` vs `jsonb` sur 5 colonnes** (`pricing_modes`, `image_urls`, `tag_ids`, `related_spotyou_ids`, `delivery_modes`) — auditer DDL Supabase EXACTE avant repo (le projet utilise les deux types selon slice), (3) **atomicité fragmentée 4 transactions** Python (INSERT principal + UPDATE `price_per_session` + UPDATE `brand/model/weight/stripe_*` + UPDATE `location_address_raw`) — Java doit choisir : préserver compat stricte OU fusionner en 1 `@Transactional` (recommandé, à documenter).
- **Asymétries préservées** : libellés erreur sale ≠ rental ("prix de vente" vs "prix"), wrappers de réponse différents, snapshot seller figé, UPDATE annexes sans `seller_id` (anomalie Python à corriger en Java par défense en profondeur), filtre `/mine` exclut autres `product_type`, GET detail retourne 404 (pas 403) anti-énumération.
- **Niveau de risque** : ÉLEVÉ (46 colonnes INSERT, validations conditionnelles 2 branches, UPSERT avec garde, atomicité fragmentée, body permissif Map<String,Object> recommandé pour ne pas rejeter ce que Python accepte).
- **HORS scope (volontairement reporté)** : `DELETE /api/products/{id}` (soft-delete + `MediaPurgeWorker` 90j) → S40 ; `POST /api/products/{id}/reactivate` → S40 ; routes admin produits (validation/rejet `/admin/products/*`) → S41 ; sync Stripe Product/Price → S42.
- **Roadmap S40 suggérée** : 🔴 **Lifecycle produit** (DELETE soft + reactivate + worker `MediaPurgeWorker` + table `pending_file_deletions`) — ferme la boucle authoring.
- **Aucune modif de code Python** (mode documentation-only strict).

---

### Migration Java — Slice 38 (2026-04-28) — Marketplace Products (lecture publique)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/SLICE_38_*.md` (1818 lignes au total)
  - `SLICE_38_SCOPE.md` (133 l), `SLICE_38_API_CONTRACTS.md` (245 l), `SLICE_38_DB_MAPPING.md` (271 l), `SLICE_38_BUSINESS_RULES.md` (413 l, 18 règles BR-38.01 à BR-38.18), `SLICE_38_TEST_CASES.md` (306 l, 32 cas T38-01 à T38-32), `SLICE_38_CURSOR_IMPLEMENTATION_NOTES.md` (450 l)
- **Endpoint couvert** : `GET /api/marketplace/products` — **PREMIER endpoint PUBLIC migré** (pas de `require_auth`, `permitAll` Spring Security). Source : `routes/marketplace_routes.py:1–267`.
- **Périmètre fonctionnel** : mélange produits (`marketplace_products` `status='active'`) + services (`services` `active=TRUE`, uniquement si tags fournis), enrichis (distance Haversine, badges owner/other, `seller_stats` ratings + counts), tri owner-first puis `created_at DESC`. Branchement par paramètres `tag_ids` / `spotyou_id` (4 modes : feed brut, filtre tags, lookup SpotYou, hybride).
- **Tables lues (5)** : `marketplace_products`, `services`, `tag_points` (lookup SpotYou), `users` (JOIN seller, name/picture), `service_ratings` + `marketplace_product_ratings` (seller_stats). **AUCUNE écriture, AUCUN Stripe**.
- **18 règles métier (BR-38.01 → BR-38.18)** : public/permitAll, visibilité status/active, branchement tag_ids vs spotyou_id, lookup `tag_points` résout tags+owner+GPS, filtre PostgreSQL **`&&`** (array overlap products) vs **`?|`** (JSONB services), `filter_requested && tags vides → []`, owner_id depuis SpotYou (pas user courant), Haversine côté Java (pas PostGIS), badges owner/other par `seller_id == owner_id`, seller_stats agrégés, parallélisme `asyncio.gather` → `CompletableFuture`, sort owner-first stable, LIMIT 20 produits / 20 services, JSONB tags double parsing.
- **32 cas de test T38-01 à T38-32** : nominaux feed/tag_ids/spotyou_id/hybride, edge cases (tags vides, SpotYou inexistant, seller anonyme), régressions (status='draft' filtré, active=FALSE filtré, distance NULL si pas de GPS).
- **Top 3 pièges identifiés** : (1) opérateur PostgreSQL **`?|`** sur JSONB tags services nécessite cast `::text[]` paramétré JDBC (Spring `NamedParameterJdbcTemplate` + `PgArray`), (2) Haversine côté Java en `BigDecimal` + `Math.toRadians` (pas `ST_Distance` ici, contrairement à S25/S26), (3) `asyncio.gather` 3 queries parallèles (products + services + seller_stats) → `CompletableFuture.allOf` ou exécution séquentielle Spring (mesurer avant d'optimiser).
- **Asymétries préservées** : (a) services UNIQUEMENT si `tag_ids` fournis (pas de services en mode feed brut), (b) **AUCUN endpoint détail** `GET /products/{id}` côté public en Python — ne PAS l'inventer en Java, (c) seller_stats inclut ratings agrégés mais PAS la liste des avis individuels.
- **Niveau de risque** : MOYEN-ÉLEVÉ (filtres JSONB `?|`, parallélisme, premier endpoint public Spring Security).
- **Roadmap S39 suggérée** : 🔴 **Marketplace writes** (`POST /products` création — `product_creation_routes.py:1–567`) OU **booking writes** (`POST /bookings/{id}/cancel` lignes 754–983) — au choix de l'utilisateur.
- **Aucune modif de code Python** (mode documentation-only strict).

---

### Migration Java — Slice 37 (2026-04-28) — AUDIT NO-OP
- **Constat majeur** : `POST /api/bookings/price-preview` (lignes 115–158) est **déjà couvert intégralement par Slice 30**. Vérification ligne-à-ligne : 0 divergence (auth, body, SELECT services active=TRUE, pricing_engine, response 9 champs).
- **Documents S30 couvrant price-preview** : SCOPE (Endpoint #1), API_CONTRACTS (section "Endpoint 1"), BUSINESS_RULES, DB_MAPPING, TEST_CASES (cas PRV-XX), CURSOR_IMPLEMENTATION_NOTES (`@PostMapping("/price-preview")`)
- **Livrables S37** : 6 fichiers Markdown courts orientés AUDIT no-op + recommandation roadmap (`SLICE_37_*.md`)
- **Décision recommandée** : **NE RIEN FAIRE sur price-preview**. S37 = audit no-op pur. Re-router l'effort vers la VRAIE prochaine slice manquante.
- **Prochaine vraie slice recommandée** : 🔴 **S38 — `POST /bookings/{id}/cancel`** (lignes 754–983). Justifications : (1) action courante du buyer côté UI, (2) ferme la boucle parcours buyer (créer S30 → consulter S11/S34 → cancel S38 → refund S35 déjà migré), (3) pas de nouvelle infra webhook (S35 reçoit déjà le `charge.refunded` déclenché par cancel), (4) débloque l'autonomie buyer côté Java.
- **Aucune modif de code Python** (mode documentation-only strict)

---

### Migration Java — Slice 36 (2026-04-26) — AUDIT + RÉGRESSION
- **Constat majeur** : les 3 endpoints booking read sont **déjà couverts par Slice 11** (datée 2026-02-XX). Audit du code Python `routes/booking_routes.py:1035–1110` confirme **aucune divergence** : BOOKING_FIELDS identique (22 colonnes), JOINs identiques (services/users/service_slots), permissions 4-OR identiques, aliases dual identiques.
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/SLICE_36_*.md` orientés **audit + régression** (pas de re-port de S11)
  - `SLICE_36_SCOPE.md` — confirmation couverture S11 + roadmap booking writes (S37+)
  - `SLICE_36_API_CONTRACTS.md` — projection asymétrique entre les 3 endpoints, 8 régressions à valider
  - `SLICE_36_DB_MAPPING.md` — vérification que S30/S31/S33/S35 n'ont pas cassé S11 + asymétrie volontaire S35 (booking inchangé après refund)
  - `SLICE_36_BUSINESS_RULES.md` — 13 règles BR-36.01 à BR-36.13 axées asymétries préservées
  - `SLICE_36_TEST_CASES.md` — **20 cas de régression T36-01 à T36-20** (S30/S31/S33/S35 → /me, /received, /{id}) en complément des nominaux S11
  - `SLICE_36_CURSOR_IMPLEMENTATION_NOTES.md` — patch de régression Spring Boot (réutilise `AuthService` + `ObjectMapper` S34), 12 pièges, 10 critères Done
- **Recommandation forte** : la VRAIE prochaine slice utile au front = **booking writes** (S37 preview, S38 request, S39 cancel). S36 = audit uniquement.
- **Tables touchées** : aucune écriture (S36 = lecture seule, identique S11).
- **Top 3 pièges identifiés** : (1) permissions **4-OR** (vs S34 3-OR) — ne pas oublier `coach_id` et `user_id` legacy, (2) aliases dual routing, (3) **NE PAS** ajouter de JOIN `payments` "pour optimiser" — booking reads doivent rester sans `refund_amount` (compat stricte ; le front fait 2 appels distincts).
- **Aucune modif de code Python** (mode documentation-only strict)

---

### Migration Java — Slice 35 (2026-04-25)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/` pour la slice `Webhook Stripe Charge/Refund Handlers`
  - `SLICE_35_SCOPE.md`, `SLICE_35_API_CONTRACTS.md`, `SLICE_35_DB_MAPPING.md`,
    `SLICE_35_BUSINESS_RULES.md` (15 règles BR-35.01 à BR-35.15), `SLICE_35_TEST_CASES.md` (30 cas T35-01 à T35-30 + 3 régressions S32/S33/S34), `SLICE_35_CURSOR_IMPLEMENTATION_NOTES.md`
- **Flow couvert** : 2 events Stripe — `charge.refunded` (full → status=refunded / partial → status=partially_refunded + notif payer) + `refund.updated` (Phase 1 edge case full-refund avec early return + Phase 2 sync simple `refund_status`, **aucune notif**)
- **Activations sur S32-S33** : populate `_CHARGE_EVENTS = {charge.refunded, refund.updated}` + activer la branche `if event_type in _CHARGE_EVENTS` du dispatcher + porter `_handle_charge_event` (458–582)
- **Tables touchées** : WRITE `payments` (status, refund_amount, refund_status, stripe_charge_id COALESCE), `notifications` (1 notif charge.refunded payer) — READ `payments` (payer_user_id, payer_total_amount edge case, lookup par stripe_charge_id) — **PAS** d'écriture sur `bookings` (asymétrie volontaire vs S33)
- **HORS périmètre** : `_handle_subscription_event` (subscriptions → S36+), `charge.dispute.*` (compat stricte, non présents Python)
- **Top 3 pièges** : (1) conversion centimes→euros via `BigDecimal.divide(100, 2, HALF_UP)`, (2) full vs partial via boolean `obj.refunded` (PAS comparaison montants), (3) `refund.updated` Phase 1 avec early return si payment_id résolu via charge_id ET amount==total (tolérance 0.02 strict `<`)
- **Asymétries préservées** : pas de notif sur `refund.updated`, pas d'UPDATE bookings, COALESCE stripe_charge_id, format `%.2f` Locale.ROOT (point décimal), libellés notif full/partial distincts
- **Aucune modif de code Python** (mode documentation-only strict)

---

### Migration Java — Slice 34 (2026-04-25)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/` pour la slice `Payment Reads (consultation user-scope)`
  - `SLICE_34_SCOPE.md`, `SLICE_34_API_CONTRACTS.md`, `SLICE_34_DB_MAPPING.md`,
    `SLICE_34_BUSINESS_RULES.md` (15 règles BR-34.01 à BR-34.15), `SLICE_34_TEST_CASES.md` (24 cas T34-01 à T34-24 + 3 régressions + 4 robustesse), `SLICE_34_CURSOR_IMPLEMENTATION_NOTES.md`
- **Flow couvert** : 2 endpoints — `GET /api/payments/me` (liste payer/receiver + JOIN names + ORDER created_at DESC) + `GET /api/payments/{payment_id}` (détail + permissions 3-OR `payer || receiver || admin`)
- **Fichiers Python** : `routes/payment_routes.py:32–80`, `auth_utils.py:71–83`, `database.py:53–69`
- **Tables** : READ uniquement `payments` (SELECT *), `users` (LEFT JOIN). Pas d'écriture.
- **Choix slice** : la plus **petite + utile au front** parmi les candidats (refunds = encore webhook = S35 ; chat/WS = trop gros). Ferme le parcours buyer en lecture (créer S30 → payer S30 → status S31 → webhook S32-33 → **consulter S34**).
- **Top 3 pièges** : (1) permissions 3-OR `/payments/{id}` à porter strictement, (2) auth dual Bearer/cookie `winek_token`, (3) `SELECT *` complet (toutes colonnes incluant `stripe_*`, `metadata`, `idempotency_key`)
- **Asymétries préservées** : `/me` JOIN names mais pas `/{id}`, ordre `404 avant 403`, format datetime `+00:00` pas `Z`, pas de pagination, snake_case
- **Aucune modif de code Python** (mode documentation-only strict)

---

### Migration Java — Slice 33 (2026-04-25)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/` pour la slice `Webhook Stripe Payment Handlers`
  - `SLICE_33_SCOPE.md` (146 l), `SLICE_33_API_CONTRACTS.md` (316 l), `SLICE_33_DB_MAPPING.md` (283 l),
    `SLICE_33_BUSINESS_RULES.md` (568 l, 19 règles BR-33.01 à BR-33.19), `SLICE_33_TEST_CASES.md` (496 l, 42 cas T33-01 à T33-42), `SLICE_33_CURSOR_IMPLEMENTATION_NOTES.md` (602 l)
- **Flow couvert** : 5 events Stripe paiement — `checkout.session.completed` (mode=payment, 3 sous-branches A/B/C), `payment_intent.amount_capturable_updated`, `payment_intent.succeeded` (avec/sans `latest_charge`), `payment_intent.payment_failed`, `payment_intent.canceled`
- **Activations sur S32** : populate `_PAYMENT_EVENTS` (5 events) + activer la branche `if event_type in _PAYMENT_EVENTS` du dispatcher + porter `_handle_payment_event` (185–453) + porter `_resolve_payment_id` complet (122–180, 4 stratégies de lookup)
- **Tables touchées** : WRITE `payments` (status, stripe_charge_id), `bookings` (status, payment_status), `notifications` (via `store_notification`) — READ `payments` (payer/receiver, lookups), `bookings` (status guard), `services` (title JOIN)
- **HORS périmètre** : `_handle_charge_event` (refunds → S34), `_handle_subscription_event` (subscriptions → S35)
- **Asymétries critiques documentées** : Branch A vs C guards différents (Branch A inclut `'cancelled'` dans NOT IN), libellés notifs différents ("À bientôt !" Branch A only, "capturé" PI succeeded vs "reçu" CSC paid), `payment_intent.canceled` AUCUNE notif (booking déjà notifié), `payment_intent.payment_failed` notif **payer** seul
- **Top piège** : émettre la notification UNIQUEMENT si `rows_updated > 0` (sinon doublons à chaque retry Stripe)
- **Aucune modif de code Python** (mode documentation-only strict)

---

### Migration Java — Slice 32 (2026-04-25)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/` pour la slice `Webhook Stripe Infrastructure`
  - `SLICE_32_SCOPE.md`, `SLICE_32_API_CONTRACTS.md`, `SLICE_32_DB_MAPPING.md`,
    `SLICE_32_BUSINESS_RULES.md`, `SLICE_32_TEST_CASES.md`, `SLICE_32_CURSOR_IMPLEMENTATION_NOTES.md`
- **Flow couvert** : `POST /api/webhook/stripe` — 1 endpoint, `payment_routes.py:356–405` + `webhook_handlers.py:80–117, 979–1071` + `stripe_service.py:242–248`
- **Périmètre exact** : signature HMAC + raw body + idempotence (`stripe_webhook_events`) + dispatcher squelette avec **handlers STUB vides** (sets `_PAYMENT_EVENTS / _CHARGE_EVENTS / _SUBSCRIPTION_EVENTS` initialisés à `set()`)
- **HORS périmètre** : `_handle_payment_event` (S33), `_handle_charge_event` (S34), `_handle_subscription_event` (S35), `_resolve_payment_id` (S33)
- **Aucune modif de code Python** (mode documentation-only strict)

---

### Migration Java — Slice 31 (2026-04-20)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/` pour la slice `Checkout Status (retour Stripe + confirmation front)`
  - `SLICE_31_SCOPE.md`, `SLICE_31_API_CONTRACTS.md`, `SLICE_31_DB_MAPPING.md`,
    `SLICE_31_BUSINESS_RULES.md`, `SLICE_31_TEST_CASES.md`, `SLICE_31_CURSOR_IMPLEMENTATION_NOTES.md`
- **Flow couvert** : `GET /api/payments/checkout/status/{session_id}` — 1 endpoint, `payment_routes.py:195–351`
- **Ferme le parcours acheteur front** : appelé par le front après redirect Stripe, fait un upsert best-effort (indépendant du webhook)
- **Patterns neufs documentés** : auth OPTIONNELLE via try/except, lookup dual session OR payment_intent, push SYNC (pas fire-and-forget), fallback "unknown" silencieux si Stripe down
- **Aucune modif de code Python** (mode documentation-only strict)

---

### Migration Java — Slice 30 (2026-04-20)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/` pour la slice `Booking Create + Pay (parcours acheteur core)`
  - `SLICE_30_SCOPE.md`, `SLICE_30_API_CONTRACTS.md`, `SLICE_30_DB_MAPPING.md`,
    `SLICE_30_BUSINESS_RULES.md`, `SLICE_30_TEST_CASES.md`, `SLICE_30_CURSOR_IMPLEMENTATION_NOTES.md`
- **Flow couvert** : `POST /bookings/price-preview` + `POST /bookings/request` (+ alias `POST /bookings`) + `POST /bookings/{id}/pay` — 3 endpoints, `booking_routes.py:115–382, 558–670`
- **Débloque le cutover acheteur** : sans ce trio, pas de parcours réserver-payer possible en Java
- **Patterns neufs documentés** : pricing_engine centralisé, lock `FOR UPDATE NOWAIT`, intégration Stripe Checkout Session, triple idempotence
- **Aucune modif de code Python** (mode documentation-only strict)

---

### Migration Java — Slice 29 (2026-04-20)
- **Livrables** : 6 fichiers Markdown générés dans `/app/docs/migration/` pour la slice `SpotYou Soft-Delete + Reactivate`
  - `SLICE_29_SCOPE.md`, `SLICE_29_API_CONTRACTS.md`, `SLICE_29_DB_MAPPING.md`,
    `SLICE_29_BUSINESS_RULES.md`, `SLICE_29_TEST_CASES.md`, `SLICE_29_CURSOR_IMPLEMENTATION_NOTES.md`
- **Flow couvert** : `DELETE /api/tag-points/{id}` + `POST /api/tag-points/{id}/reactivate` (2 endpoints, `deletion_routes.py:260–431`)
- **Ferme le CRUD SpotYou** initié en Slice 28 (create/update/new-date) — cycle de vie owner complet
- **Pattern introduit** : rétention 90j + `pending_file_deletions` + workers différés (réutilisable pour Services/Products)
- **Aucune modif de code Python** (mode documentation-only strict)

---

## Backlog (priorité décroissante)

### P1 — En attente
- **Buyer-Side Reservation/Purchase UI** : sélection durée/quantité + calcul prix total
- **SpotYou Timeslot Selection** : sélection créneau lors réservation "per session"

### P2 — Futur
- Réécriture `test_booking_expiry_guard.py` (Règle 3 : leave community annule participations futures)
- **Image Quality Validation** : client-side scoring (résolution, taille, luminosité) avant upload

### P3 — Backlog
- Refactoring `products/create.tsx` en composants plus petits

---

## Tests
- Rapport : `/app/test_reports/iteration_103.json` — 100% backend (22/24 + 2 idempotency-skips)
- Fichier test : `/app/backend/tests/test_retention_90j.py`

## Credentials de test
Voir `/app/memory/test_credentials.md`
