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
