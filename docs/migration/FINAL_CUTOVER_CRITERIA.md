# FINAL_CUTOVER_CRITERIA.md — Critères de bascule front → Java
> Généré le 2026-04-13.

---

## Définition : "Cutover"

Le moment où le frontend est reconfiguré pour pointer vers le backend Java exclusivement,
et le backend Python est éteint (ou maintenu uniquement en shadow pour comparaison).

---

## Checklist P0 — Critères OBLIGATOIRES avant cutover

### 1. Authentification

- [ ] POST /auth/register → crée un user, retourne JWT
- [ ] POST /auth/login → vérifie credentials, retourne JWT
- [ ] POST /auth/google → OAuth Google, upsert user, retourne JWT
- [ ] GET /auth/me → retourne le profil du user connecté (token valide)
- [ ] POST /auth/logout → invalide la session / supprime push token
- [ ] JWT compatible : même algorithme (HS256), même secret, même structure (claim `user_id`)
- [ ] Cookie `winek_token` supporté (fallback auth)

### 2. SpotYou / TagPoints (fonctionnalité cœur)

- [ ] GET /tag-points → liste avec filtres géo (PostGIS ST_DWithin)
- [ ] GET /tag-points/{id} → détail complet (15+ sous-requêtes)
- [ ] POST /tag-points → créer un SpotYou
- [ ] PUT /tag-points/{id} → modifier
- [ ] POST /tag-points/{id}/join → rejoindre (3 modes : open, admin_approval, members_approval)
- [ ] POST /tag-points/{id}/invite → inviter un membre
- [ ] POST /tag-points/{id}/invitations/accept → accepter invitation
- [ ] POST /tag-points/{id}/members/{mid}/approve → approuver demande
- [ ] GET /tag-points/{id}/participants → liste des membres
- [ ] Tous les 28+ endpoints tagpoint fonctionnels
- [ ] Les 7 endpoints spot_you fonctionnels

### 3. Services

- [ ] GET /services → liste publique (avec PostGIS _mask_address)
- [ ] GET /services/{id} → détail (slots, packages, reviews)
- [ ] POST /services → créer (coach)
- [ ] PUT /services/{id} → modifier
- [ ] DELETE /services/{id} → soft-delete
- [ ] GET /services/mine → mes services

### 4. Bookings (cycle complet)

- [ ] POST /bookings/request → créer réservation (4 flux : instant/manual × pay_now/pay_later)
- [ ] POST /bookings/{id}/pay → initier paiement Stripe Checkout
- [ ] POST /bookings/{id}/accept → accepter (+ capture Stripe Cas A)
- [ ] POST /bookings/{id}/refuse → refuser (+ cancel PI)
- [ ] POST /bookings/{id}/cancel → annuler (+ refund si captured)
- [ ] GET /bookings/me → mes réservations
- [ ] GET /bookings/received → demandes reçues
- [ ] GET /bookings/{id} → détail

### 5. Payments + Stripe

- [ ] POST /payments/checkout/session → créer Checkout Session
- [ ] GET /payments/checkout/status/{sid} → polling post-redirect
- [ ] POST /webhook/stripe → tous les events (payment + subscription) traités
- [ ] Capture, cancel, refund Stripe réels (pas de stubs)
- [ ] ExpiryWorker actif (background)

### 6. Subscriptions

- [ ] Cycle complet user (plans, subscribe, me, history, cancel)
- [ ] Webhook subscription (6 event types)
- [ ] Admin CRUD plans + cancel
- [ ] Benefits snapshot dans pricing engine

### 7. Chat + WebSocket

- [ ] POST /conversations → créer conversation
- [ ] GET /conversations → liste
- [ ] GET /conversations/{id}/messages → messages
- [ ] WS /ws/chat/{conv_id} → messages temps réel
- [ ] WS /ws/notifications → notifications temps réel
- [ ] PUT /conversations/{id}/read → marquer lu

### 8. Home + Navigation

- [ ] GET /home/feed → feed accueil
- [ ] GET /home/nearest-sector → secteur géo
- [ ] GET /domains, /tags/categories, /tags → référentiels

### 9. User complet

- [ ] GET /users/profile, PUT /users/profile → profil lecture + écriture
- [ ] GET /users/{uid}/public → profil public
- [ ] POST/DELETE /users/{uid}/follow → follow/unfollow
- [ ] GET /users/{uid}/followers, /following → social
- [ ] POST/DELETE /users/{uid}/block → block/unblock
- [ ] GET /users/{uid}/reviews → reviews lecture
- [ ] GET /users/search → recherche

### 10. Infrastructure

- [ ] POST /upload-image → upload Cloudflare R2
- [ ] POST /push-token → enregistrer token FCM
- [ ] GET /users/me/notifications → notifications
- [ ] PATCH notifications read / read-all

---

## Checklist P1 — Critères IMPORTANTS (dégradation acceptable temporairement)

- [ ] PUT /auth/change-password
- [ ] POST /users/{uid}/reviews → créer avis
- [ ] GET /users/me/activity-feed
- [ ] GET /users/{uid}/suggestions
- [ ] GET /services/saved, /services/deactivated
- [ ] POST /bookings/price-preview
- [ ] GET /payments/me, GET /payments/{pid}
- [ ] Soft-delete / rétention (8 endpoints)
- [ ] Products / Marketplace (6 endpoints)
- [ ] Addresses CRUD (4 endpoints)
- [ ] Workers secondaires (MediaPurge, MediaNotif, SpotYouNotif)

---

## Checklist P2 — Critères SECONDAIRES (post-cutover OK)

- [ ] Admin dashboard complet (~35 endpoints)
- [ ] Admin products (approve/reject)
- [ ] Admin pricing-rules CRUD
- [ ] Admin referentiels CRUD
- [ ] Admin purge
- [ ] Workers admin (AdminProductReminder, AdminPurge)
- [ ] PATCH /bookings/{id}/status (legacy endpoint)
- [ ] GET /auth/native-callback
- [ ] POST /upload-image/debug-422

---

## Divergences acceptables au cutover

| Divergence | Acceptable ? | Raison |
|---|---|---|
| Réponses JSON avec champs en ordre différent | ✅ | Le front ne dépend pas de l'ordre |
| Timestamps format légèrement différent | ✅ | Tant que ISO 8601 |
| Messages d'erreur en anglais (vs français Python) | ✅ | Le front utilise ses propres messages |
| Admin endpoints absents | ✅ | Admin peut rester sur Python temporairement |
| Workers background sur Python pendant transition | ✅ | Ne bloque pas le front |
| `plan_code` colonne legacy absente des réponses | ✅ | Non utilisé par le front |

---

## Divergences NON acceptables

| Divergence | Risque |
|---|---|
| Structure JWT différente | Le front ne peut pas décoder le token |
| Statuts booking/payment différents | Machine d'états incohérente |
| Webhook ne traite pas certains events | Paiements/abonnements bloqués |
| PostGIS absent | Recherche géo cassée |
| Upload vers un storage différent | Images existantes inaccessibles |
| benefits_snapshot format différent | Pricing engine incohérent |

---

## Métriques de confiance cutover

| Métrique | Seuil minimum |
|---|---|
| Endpoints P0 fonctionnels | 100% (64/64) |
| Tests E2E passing | > 95% |
| Latence comparable | < 2× Python (P95) |
| Zéro régression sur les statuts | 100% compatibilité machine d'états |
| Webhook round-trip testé | Tous les 16 event types |
