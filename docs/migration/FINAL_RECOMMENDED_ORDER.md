# FINAL_RECOMMENDED_ORDER.md — Ordre de migration recommandé
> Orienté "front full Java" — priorité aux blockers utilisateur.
> Généré le 2026-04-13.

---

## Principes de priorisation

1. **Auth d'abord** — sans auth, rien ne fonctionne
2. **Écran principal ensuite** — home feed = première chose que l'utilisateur voit
3. **Cœur métier** — SpotYou (la raison d'être de l'app)
4. **Transactionnel** — booking create + pay (le flow argent)
5. **Communication** — chat + notifications (engagement)
6. **Infra partagée** — upload, push tokens (utilisés partout)
7. **Admin en dernier** — ne bloque pas le front utilisateur

---

## BLOC 1 — Fondation (auth + profil + upload) — ~15 endpoints

**Justification** : Sans auth, aucun endpoint protégé ne fonctionne. Upload est requis par la plupart des flows d'écriture (profil, services, SpotYou). Push tokens sont requis pour les notifications.

| Slice | Domaine | Endpoints | Fichier |
|---|---|---|---|
| S23 | **Auth complet** | register, login, google, logout, change-password, native-callback | auth_routes.py |
| S24 | **User profil write** | PUT /profile, become-coach, cover, search | user_routes.py |
| S25 | **Upload + Push** | upload-image, push-token register/delete | upload_routes.py, push_routes.py |

**Résultat** : Un utilisateur peut s'inscrire, se connecter, modifier son profil, uploader des images.

---

## BLOC 2 — Écran principal + SpotYou lecture (home + tagpoints reads) — ~20 endpoints

**Justification** : Le home feed est l'écran d'accueil. Les lectures SpotYou/TagPoints sont le contenu principal affiché.

| Slice | Domaine | Endpoints | Fichier |
|---|---|---|---|
| S26 | **Home feed** | GET /home/feed, GET /home/nearest-sector | home_routes.py |
| S27 | **TagPoints lectures** | GET list, mine, saved, detail, similar, participants, my-vote, votes | tagpoint_routes.py |
| S28 | **Notifications + planning** | GET notifications, mark read, read-all, events, planning-events, pending-requests | tagpoint_routes.py |

**Résultat** : L'app s'ouvre, affiche le feed, l'utilisateur navigue dans les SpotYou et reçoit ses notifications.

---

## BLOC 3 — SpotYou write + interactions (le cœur de l'app) — ~25 endpoints

**Justification** : Créer, rejoindre, inviter, voter — les interactions qui font vivre l'app.

| Slice | Domaine | Endpoints | Fichier |
|---|---|---|---|
| S29 | **TagPoints CRUD** | POST create, PUT update, PATCH new-date, save/unsave | tagpoint_routes.py |
| S30 | **TagPoints join/invite/approve** | join, cancel-request, leave, invite, accept/refuse invitation, join-requests, approve/reject | tagpoint_routes.py |
| S31 | **TagPoints vote + SpotYou routes** | vote, spot-you join/leave/going/activity/stats | tagpoint_routes.py, spot_you_routes.py |

**Résultat** : Le cycle SpotYou complet est opérationnel — c'est le moment où l'app devient utilisable.

---

## BLOC 4 — Services CRUD + Booking CREATE/PAY — ~15 endpoints

**Justification** : Les coaches créent des services, les utilisateurs réservent et paient. Complète le cycle transactionnel.

| Slice | Domaine | Endpoints | Fichier |
|---|---|---|---|
| S32 | **Services CRUD** | POST create, PUT/PATCH update, DELETE, mine, saved, deactivated, reactivate, save/unsave | service_routes.py |
| S33 | **Booking create + pay + preview** | POST /bookings/request, POST /bookings/{id}/pay, POST /bookings/price-preview | booking_routes.py |

**Résultat** : Le cycle complet coach→service→réservation→paiement est opérationnel.

---

## BLOC 5 — Chat + WebSocket — ~7 endpoints

**Justification** : Messagerie temps réel entre utilisateurs. Complexe (WebSocket), mais essentiel pour l'engagement.

| Slice | Domaine | Endpoints | Fichier |
|---|---|---|---|
| S34 | **Chat HTTP** | POST /conversations, GET list, GET messages, PUT read | chat_routes.py |
| S35 | **WebSocket** | WS /ws/chat, WS /ws/notifications, WS /ws/spot-you | chat_routes.py |

**Résultat** : L'app est fonctionnellement complète pour les utilisateurs.

---

## BLOC 6 — Compléments utilisateur — ~15 endpoints

**Justification** : Fonctionnalités secondaires mais attendues (reviews, activity feed, suggestions, soft-delete).

| Slice | Domaine | Endpoints | Fichier |
|---|---|---|---|
| S36 | **User extras** | reviews POST/PUT, activity-feed, suggestions, remove follower | user_routes.py |
| S37 | **Payments read** | GET /payments/me, GET /payments/{pid} | payment_routes.py |
| S38 | **Soft-delete / Rétention** | delete user/tagpoint, reactivate, deactivate, leave conv, delete msg, reactivatable | deletion_routes.py |

**Résultat** : Le front utilisateur est COMPLET.

---

## BLOC 7 — Products + Marketplace — ~10 endpoints

**Justification** : Domaine produit/marketplace. Moins prioritaire si le MVP se concentre sur les services.

| Slice | Domaine | Endpoints | Fichier |
|---|---|---|---|
| S39 | **Products CRUD** | mine, detail, create, delete, reactivate | product_creation_routes.py |
| S40 | **Marketplace + addresses** | GET /marketplace/products, CRUD addresses | marketplace_routes.py, address_routes.py |

---

## BLOC 8 — Admin complet — ~35 endpoints

**Justification** : Dashboard admin. Ne bloque pas le front utilisateur. Peut être migré en dernier ou géré via un proxy temporaire.

| Slice | Domaine | Endpoints | Fichier |
|---|---|---|---|
| S41 | **Admin users + stats** | stats, users list, role, verify-coach | admin_routes.py |
| S42 | **Admin config + pricing** | app-config GET/PUT, pricing-rules CRUD | admin_routes.py |
| S43 | **Admin referentiels** | domains/categories/tags CRUD admin, analytics | admin_routes.py, domain_routes.py |
| S44 | **Admin products** | pending, detail, approve, reject | admin_product_routes.py |
| S45 | **Admin payments** | list, stats, stripe update | payment_routes.py |
| S46 | **Admin purge + tagpoints** | purge/status, admin tagpoints list/delete | admin_routes.py |

---

## BLOC 9 — Workers background — 5 workers

| Worker | Priorité | Notes |
|---|---|---|
| SpotYouNotifWorker | P1 | Notifications périodiques SpotYou |
| MediaPurgeWorker | P2 | Purge médias J+90 |
| MediaNotifWorker | P2 | Notification J+83 |
| AdminProductReminderWorker | P3 | Rappels admin |
| AdminPurgeWorker | P3 | Purge admin |

---

## Timeline estimée

| Bloc | Slices | Endpoints | Effort estimé |
|---|---|---|---|
| 1 — Auth + profil + upload | S23–S25 | ~15 | MOYEN |
| 2 — Home + TagPoints read | S26–S28 | ~20 | ÉLEVÉ (PostGIS) |
| 3 — SpotYou write | S29–S31 | ~25 | ÉLEVÉ |
| 4 — Services + Booking create | S32–S33 | ~15 | ÉLEVÉ (pricing engine) |
| 5 — Chat + WebSocket | S34–S35 | ~7 | ÉLEVÉ (WS) |
| 6 — Compléments user | S36–S38 | ~15 | MOYEN |
| **→ Front user COMPLET** | | **~97** | |
| 7 — Products/Marketplace | S39–S40 | ~10 | FAIBLE |
| 8 — Admin complet | S41–S46 | ~35 | MOYEN |
| 9 — Workers | — | 5 workers | FAIBLE |
| **→ Migration 100%** | | **~140+5w** | |
