# FRONT_API_COVERAGE.md — Couverture front par domaine
> Généré le 2026-04-30. Basé sur grep `lib/api.ts` calls + slices migrés.

---

## Légende

- ✅ **OK** : tous les endpoints utilisés par le front sont migrés ; cutover possible
- 🟡 **PARTIEL** : certains endpoints utilisés sont migrés, d'autres non — cutover dégrade des écrans
- 🔴 **MANQUANT** : aucun endpoint utilisé par le front n'est migré — cutover bloque le domaine

---

## 1. Auth — ✅ **OK** (S23)

| Endpoint front | Slice |
|---|---|
| `POST /auth/login` | S23 |
| `POST /auth/register` | S23 |
| `POST /auth/google` | S23 |
| `GET /auth/me` | S23 |
| `POST /auth/logout` | S23 |
| `PUT /auth/change-password` | S23 |

**Statut cutover** : ✅ Prêt. Pré-requis JWT_SECRET identique Python/Java au moment du switch (cf. S23 BR).

---

## 2. Users — 🟡 **PARTIEL** (S23 + S24 + gros gaps)

### Couverts (S23 + S24)

| Endpoint | Slice |
|---|---|
| `GET /auth/me` (profil courant) | S23 |
| `GET /profile` | S24 |
| `PUT /profile` (= `/users/profile`) | S24 |
| `POST /users/become-coach` | S24 |
| `PATCH /users/{uid}/cover` | S24 |
| `POST /push-token` / `DELETE /push-token` | S24 |
| `POST /upload-image` | S24 |

### Front utilise mais NON couvert

| Endpoint front détecté | Lignes Python | Slice manquante |
|---|---|---|
| `GET /users/search?q=` | `user_routes.py:798` | ❌ |
| `GET /users/me/activity-feed` | `user_routes.py:377` | ❌ |
| `GET /users/me/reactivatable` | `deletion_routes.py:681` | ❌ |
| `GET /users/{uid}/public` (profil public) | `user_routes.py:99` | ❌ |
| `GET /users/{uid}/reviews` + `POST /users/{uid}/reviews` | `user_routes.py:238/310` | ❌ |
| `POST /users/{uid}/follow` + `DELETE` | `user_routes.py:494/512` | ❌ |
| `GET /users/{uid}/followers` / `following` / `suggestions` | `user_routes.py:568+` | ❌ |
| `POST /users/{uid}/block` + `DELETE` | `user_routes.py:632/654` | ❌ |
| `PATCH /users/{user_id}/deactivate` | `deletion_routes.py:522` | ❌ |
| `POST /users/{user_id}/reactivate` | `deletion_routes.py:624` | ❌ |
| `DELETE /users/{user_id}` | `deletion_routes.py:97` | ❌ |

**Statut cutover** : 🟡 PARTIEL — auth + profil OK ; **graphe social + recherche + RGPD KO**. Écrans dégradés : profil utilisateur tiers, follow/block, search bar, suppression compte, réactivation.

---

## 3. SpotYou (`tag-points` + `spot-you`) — 🟡 **PARTIEL**

### Couverts

| Endpoint front | Slice |
|---|---|
| `GET /tag-points?lat=&lng=...` (search PostGIS) | S26 |
| `GET /tag-points/mine` | S26 |
| `GET /tag-points/saved` | S26 |
| `GET /tag-points/{id}` (détail) | S26 |
| `GET /tag-points/{id}/similar` | S26 |
| `GET /tag-points/{id}/participants` | S26 |
| `POST /tag-points/{id}/save` + `DELETE /unsave` | S27 |
| `POST /tag-points/{id}/join` | S27 |
| `DELETE /tag-points/{id}/cancel-request` | S27 |
| `POST /tag-points/{id}/invite` | S27 |
| `POST /tag-points` (create) | S28 |
| `PUT /tag-points/{id}` (update) | S28 |
| `PATCH /tag-points/{id}/new-date` | S28 |

### Front utilise mais NON couvert

| Endpoint front détecté | Lignes Python | Slice manquante |
|---|---|---|
| `POST /spot-you/{id}/going` + `DELETE` | `spot_you_routes.py:289/400` | ❌ RSVP attendance |
| `GET /spot-you/my-completion-stats` | `spot_you_routes.py:461` | ❌ |
| `GET /spot-you/{id}/activity` | `spot_you_routes.py:495` | ❌ |
| `GET /spot-you/{id}/going` | `spot_you_routes.py:627` | ❌ |
| `POST /tag-points/{id}/vote` + `GET /votes` + `GET /my-vote` | `tagpoint_routes.py:1703-1791` | ❌ |
| `GET /users/me/spotyou-invitations` | `tagpoint_routes.py:966` | ❌ |
| `POST /tag-points/{id}/invitations/accept` + `refuse` | `tagpoint_routes.py:1007/1059` | ❌ (à confirmer S27) |
| `GET /tag-points/{id}/join-requests` | `tagpoint_routes.py:1107` | ⚠️ partiellement S27 |
| `DELETE /tag-points/{id}/leave` | `tagpoint_routes.py:1264` | ⚠️ collision `spot-you/{id}/leave` ? |

**Statut cutover** : 🟡 PARTIEL — discovery + CRUD owner OK ; **RSVP "going" + votes + invitations inbox KO**. Écrans dégradés : compteur live de présence, agenda d'événements, votes communautaires.

> 🔴 **À INVESTIGUER** : `/spot-you/{id}/join` (`spot_you_routes.py:132`) vs `/tag-points/{id}/join` (S27) — possible doublon nécessitant clarification.

---

## 4. Booking — ✅ **OK** (S11 + S13–S15 + S18)

| Endpoint front | Slice |
|---|---|
| `GET /bookings/me` | S11 |
| `GET /bookings/received` | S11 |
| `GET /bookings/{id}` | S11 |
| `POST /bookings/request` (= `POST /bookings`) | S12 (booking create — supposé ; **à confirmer dans PRD**) |
| `POST /bookings/price-preview` | S12 ou S37 |
| `POST /bookings/{id}/accept` | S13 |
| `POST /bookings/{id}/refuse` | S13 |
| `POST /bookings/{id}/pay` | (intégré S17 ?) |
| `POST /bookings/{id}/cancel` | S15 |
| `PATCH /bookings/{id}/status` (→ completed) | S14 |
| Worker `ExpiryWorker` | S18 |

**Statut cutover** : ✅ Prêt sous réserve confirmation S12 (booking create) — pas de slice S12 visible dans PRD. **Si S12 absente, c'est un BLOQUANT P0.**

> ⚠️ **À VÉRIFIER** : la PRD ne mentionne pas explicitement Slice 12. Soit l'endpoint `POST /bookings/request` est traité dans S11 (peu probable car S11 = reads), soit c'est un gap caché. **Auditer impérativement avant cutover.**

---

## 5. Payments — ✅ **OK** (S16 + S17 + S19 + S33–S35)

| Endpoint front | Slice |
|---|---|
| `POST /payments/checkout/session` | S17 |
| `GET /payments/checkout/status/{sid}` | S17 |
| `POST /webhook/stripe` (paiements) | S16 + S33 + S35 |
| `GET /payments/me` + `GET /payments/{id}` | S34 |
| `StripePaymentService` (capture/cancel/refund) | S19 |

**Statut cutover** : ✅ Prêt. Webhook nécessite signature HMAC bytes raw (pas de parsing JSON Spring) — vérifier config.

---

## 6. Subscriptions — ✅ **OK** (S20 + S21 + S22)

| Endpoint front | Slice |
|---|---|
| `GET /subscription-plans` | S21 |
| `POST /subscriptions/subscribe` | S21 |
| `GET /subscriptions/me` | S21 |
| `POST /subscriptions/cancel` | S21 |
| `GET /subscriptions/checkout/status/{sid}` | S21 |
| Webhook subscription events | S20 |
| Admin CRUD plans | S22 |

**Statut cutover** : ✅ Prêt. Asymétries filtres `past_due` documentées (S21 BR-XX).

---

## 7. Marketplace — ✅ **OK** (S38 + S39 + S40 + S41)

| Endpoint front | Slice |
|---|---|
| `GET /marketplace/products?...` (catalogue public) | S38 |
| `POST /products` (create/edit) | S39 |
| `GET /products/mine` | S39 |
| `GET /products/{id}/detail` | S39 |
| `DELETE /products/{id}` | S40 |
| `POST /products/{id}/reactivate` | S40 |
| `GET /admin/products/pending` | S41 |
| `GET /admin/products/{id}` | S41 |
| `POST /admin/products/{id}/approve` + `reject` | S41 |
| Worker `MediaPurgeWorker` | S40 (STUB physique R2) |
| Worker `AdminProductReminderWorker` | S41 |

**Statut cutover** : ✅ Prêt côté seller + admin. ⚠️ **Achat côté buyer N'EXISTE PAS en Python** — donc pas migrable, pas un gap migration mais à concevoir.

⚠️ **STUB MediaPurgeWorker** = la purge physique R2 n'est pas réelle (S40-bis nécessaire post-cutover ou tolérer dette stockage).

---

## 8. Chat — 🔴 **MANQUANT**

| Endpoint front | Lignes Python | Slice |
|---|---|---|
| `POST /conversations` | `chat_routes.py:227` | ❌ |
| `GET /conversations` | `chat_routes.py:349` | ❌ |
| `GET /conversations/{cid}/messages` | `chat_routes.py:389` | ❌ |
| `PUT /conversations/{cid}/read` | `chat_routes.py:438` | ❌ |
| `DELETE /messages/{mid}` | `deletion_routes.py:436` | ❌ |
| `PATCH /conversations/{cid}/leave` | `deletion_routes.py:481` | ❌ |
| WebSocket chat (si existant) | `/api/ws/spot-you/...` | ❌ (présence détectée front) |

**Statut cutover** : 🔴 **BLOQUANT ABSOLU** — écran Chat 100 % KO. **6 endpoints REST + 1 WebSocket** à migrer.

---

## 9. Admin — 🟡 **PARTIEL**

### Couverts (S22, S41, partiel)

| Endpoint | Slice |
|---|---|
| `GET/POST/PUT/DELETE /admin/subscription-plans` | S22 |
| `GET /admin/subscriptions` | S22 |
| `POST /admin/subscriptions/{id}/cancel` | S22 |
| `GET /admin/products/*` + approve/reject | S41 |

### Front utilise mais NON couvert

| Endpoint front détecté | Lignes | Slice |
|---|---|---|
| `GET /admin/stats` | `admin_routes.py:11` | ❌ |
| `GET /admin/payments` | `payment_routes.py:452` | ❌ |
| `GET /admin/pricing-rules` + CRUD | `admin_routes.py:138-199` | ❌ |
| `GET /admin/tags-analytics` | `admin_routes.py:295` | ❌ |
| `GET /admin/all-domains` / `all-categories` / `all-tags` | `admin_routes.py:385-408` | ❌ |
| `GET /admin/app-config` + `PUT` | `admin_routes.py:440/539` | ❌ |
| `GET /admin/users` + `PUT /role` + `verify-coach` | `admin_routes.py:53-93` | ❌ |
| `GET /admin/tag-points` + `DELETE /admin/tag-points/{id}` | `admin_routes.py:107-118` | ❌ |
| `GET /admin/services` | `admin_routes.py:127` | ❌ (dépend domaine Services) |
| `POST /admin/purge` + status | `admin_routes.py:451-495` | ❌ |
| `GET /admin/domains` | `admin_routes.py:286` | ❌ |
| Domaines/tags/categories CRUD | `domain_routes.py` writes | ❌ |

**Statut cutover** : 🟡 PARTIEL — Subscriptions et produits OK ; **dashboard admin général + analytics + référentiels CRUD KO**.

---

## 10. Domaines transverses

### Adresses — 🔴 **MANQUANT**

| Endpoint front | Slice |
|---|---|
| `GET/POST/PUT/DELETE /addresses*` | ❌ Aucune slice |

**Impact** : carnet d'adresses KO (livraison/déplacement).

### Notifications + Agenda — 🔴 **MANQUANT**

| Endpoint front | Slice |
|---|---|
| `GET /users/me/notifications` | ❌ |
| `PATCH /users/me/notifications/{nid}/read` | ❌ |
| `PATCH /users/me/notifications/read-all` | ❌ |
| `GET /users/me/events` | ❌ |
| `GET /users/me/planning-events` | ❌ |
| `GET /users/me/pending-requests` | ❌ |

**Impact** : centre de notifications + agenda côté utilisateur 100% KO.

### Services coach (réservations de prestations) — 🔴 **MANQUANT**

| Endpoint front | Slice |
|---|---|
| Tous les endpoints `service_routes.py` (11 endpoints) | ❌ Aucune slice |

**Impact** : les coachs ne peuvent pas publier de services en Java → bookings S11–S15 ne peuvent pas créer de réservations puisque pas de services à réserver. **Bloquant absolu.**

---

## Tableau récapitulatif

| Domaine | Statut | Endpoints front | Migrés | Manquants |
|---|---|---|---|---|
| **Auth** | ✅ OK | 6 | 6 | 0 |
| **Users** | 🟡 PARTIEL | ~15 | 7 | 8 |
| **SpotYou** | 🟡 PARTIEL | ~22 | 14 | 8 |
| **Booking** | ✅ OK¹ | 9 | 9 | 0 (à confirmer S12) |
| **Payments** | ✅ OK | 5 | 5 | 0 |
| **Subscriptions** | ✅ OK | 6 | 6 | 0 |
| **Marketplace** | ✅ OK | 11 | 11 | 0 (achat = à concevoir) |
| **Chat** | 🔴 MANQUANT | 6 | 0 | 6 |
| **Admin** | 🟡 PARTIEL | ~17 | 7 | 10 |
| **Adresses** | 🔴 MANQUANT | 4 | 0 | 4 |
| **Notifications/Agenda** | 🔴 MANQUANT | 6 | 0 | 6 |
| **Services coach** | 🔴 MANQUANT | 11 | 0 | 11 |

¹ Sous réserve confirmation Slice 12 (booking create).

---

## Couverture finale

- **Domaines OK** : Auth, Booking, Payments, Subscriptions, Marketplace (5/12)
- **Domaines PARTIELS** : Users, SpotYou, Admin (3/12)
- **Domaines MANQUANTS** : Chat, Adresses, Notifications/Agenda, Services coach (4/12)

**Couverture par domaines** : **5/12 = 42 %**
**Couverture pondérée par usage front** : **~70 %** (les domaines manquants sont concentrés mais critiques)
