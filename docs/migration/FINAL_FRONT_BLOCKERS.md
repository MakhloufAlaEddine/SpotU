# FINAL_FRONT_BLOCKERS.md — Blockers réels pour front full-Java
> Généré le 2026-04-13.

---

## Définition : "Blocker front"

Un blocker est un endpoint/service **appelé directement par le frontend** dans le parcours utilisateur principal, dont l'absence empêche la bascule complète vers le backend Java.

---

## BLOCKER 1 — Auth (6 endpoints)

**Sans auth, RIEN ne fonctionne.**

| Endpoint | Fichier | Criticité |
|---|---|---|
| `POST /auth/register` | `auth_routes.py:26` | P0 — Inscription |
| `POST /auth/login` | `auth_routes.py:45` | P0 — Connexion |
| `POST /auth/google` | `auth_routes.py:60` | P0 — Google OAuth |
| `POST /auth/logout` | `auth_routes.py:98` | P1 — Déconnexion |
| `PUT /auth/change-password` | `auth_routes.py:105` | P1 — Sécurité |
| `GET /auth/native-callback` | `auth_routes.py:14` | P2 — Deep link OAuth |

---

## BLOCKER 2 — SpotYou / TagPoints (35 endpoints)

**Fonctionnalité cœur de l'application.** Le plus gros bloc non migré.

### Lecture + navigation (10)
| Endpoint | Criticité |
|---|---|
| `GET /tag-points` (liste avec filtres) | P0 |
| `GET /tag-points/mine` | P0 |
| `GET /tag-points/saved` | P0 |
| `GET /tag-points/{id}` (détail) | P0 |
| `GET /tag-points/{id}/similar` | P1 |
| `GET /tag-points/{id}/participants` | P0 |
| `GET /users/me/events` | P0 |
| `GET /users/me/planning-events` | P0 |
| `GET /tag-points/{id}/my-vote` | P1 |
| `GET /tag-points/{id}/votes` | P1 |

### Écriture + interactions (18)
| Endpoint | Criticité |
|---|---|
| `POST /tag-points` (créer) | P0 |
| `PUT /tag-points/{id}` (modifier) | P0 |
| `PATCH /tag-points/{id}/new-date` | P1 |
| `POST /tag-points/{id}/save` | P0 |
| `DELETE /tag-points/{id}/unsave` | P0 |
| `POST /tag-points/{id}/join` | P0 |
| `DELETE /tag-points/{id}/cancel-request` | P0 |
| `DELETE /tag-points/{id}/leave` | P0 |
| `POST /tag-points/{id}/invite` | P0 |
| `GET /users/me/spotyou-invitations` | P0 |
| `POST /tag-points/{id}/invitations/accept` | P0 |
| `POST /tag-points/{id}/invitations/refuse` | P0 |
| `GET /tag-points/{id}/join-requests` | P0 |
| `POST /tag-points/{id}/members/{mid}/approve` | P0 |
| `POST /tag-points/{id}/members/{mid}/reject` | P0 |
| `GET /users/me/pending-requests` | P0 |
| `POST /tag-points/{id}/vote` | P1 |
| spot_you_routes.py (7 endpoints — join/leave/going/activity) | P0 |

---

## BLOCKER 3 — Booking CREATE + PAY (3 endpoints)

**Le cœur transactionnel. Les reads sont migrés (S11), les writes partiels (S12–S15), mais la CRÉATION et le PAIEMENT manquent.**

| Endpoint | Fichier | Criticité |
|---|---|---|
| `POST /bookings/request` (+ alias POST /bookings) | `booking_routes.py:165–383` | P0 — Créer une réservation |
| `POST /bookings/{id}/pay` | `booking_routes.py:558–670` | P0 — Payer une réservation |
| `POST /bookings/price-preview` | `booking_routes.py:115–158` | P1 — Aperçu prix avant réservation |

---

## BLOCKER 4 — Services CRUD (10 endpoints)

**Les reads sont migrés (S09), mais les coaches ne peuvent ni créer ni gérer leurs services.**

| Endpoint | Fichier | Criticité |
|---|---|---|
| `POST /services` (créer) | `service_routes.py:756` | P0 |
| `PUT /services/{id}` (modifier) | `service_routes.py:852` | P0 |
| `DELETE /services/{id}` | `service_routes.py:986` | P0 |
| `GET /services/mine` | `service_routes.py:416` | P0 |
| `GET /services/saved` | `service_routes.py:645` | P1 |
| `GET /services/deactivated` | `service_routes.py:687` | P1 |
| `POST /services/{id}/reactivate` | `service_routes.py:1051` | P1 |
| `POST /services/{id}/save` | `service_routes.py:1107` | P1 |
| `DELETE /services/{id}/unsave` | `service_routes.py:1123` | P1 |
| `PATCH /services/{id}` (alias PUT) | `service_routes.py:853` | P1 |

---

## BLOCKER 5 — Chat + WebSocket (7 endpoints)

**Messagerie temps réel entre utilisateurs.**

| Endpoint | Fichier | Criticité |
|---|---|---|
| `POST /conversations` | `chat_routes.py:227` | P0 |
| `GET /conversations` | `chat_routes.py:349` | P0 |
| `GET /conversations/{id}/messages` | `chat_routes.py:389` | P0 |
| `PUT /conversations/{id}/read` | `chat_routes.py:438` | P0 |
| `WS /ws/chat/{conv_id}` | `chat_routes.py:459` | P0 — Temps réel chat |
| `WS /ws/notifications` | `chat_routes.py:606` | P0 — Notifications push WS |
| `WS /ws/spot-you/{point_id}` | `chat_routes.py:666` | P1 — Live SpotYou |

---

## BLOCKER 6 — Home feed (2 endpoints)

**L'écran d'accueil de l'app.**

| Endpoint | Fichier | Criticité |
|---|---|---|
| `GET /home/feed` | `home_routes.py:152` | P0 |
| `GET /home/nearest-sector` | `home_routes.py:30` | P0 |

---

## BLOCKER 7 — Notifications (3 endpoints)

| Endpoint | Fichier | Criticité |
|---|---|---|
| `GET /users/me/notifications` | `tagpoint_routes.py:1350` | P0 |
| `PATCH /users/me/notifications/{id}/read` | `tagpoint_routes.py:1394` | P0 |
| `PATCH /users/me/notifications/read-all` | `tagpoint_routes.py:1413` | P0 |

---

## BLOCKER 8 — User profile write + extras (8 endpoints)

| Endpoint | Fichier | Criticité |
|---|---|---|
| `PUT /users/profile` | `user_routes.py:33` | P0 |
| `POST /users/become-coach` | `user_routes.py:84` | P0 |
| `PATCH /users/{uid}/cover` | `user_routes.py:525` | P1 |
| `GET /users/me/activity-feed` | `user_routes.py:377` | P1 |
| `GET /users/{uid}/suggestions` | `user_routes.py:667` | P1 |
| `GET /users/search` | `user_routes.py:798` | P0 |
| `POST /users/{uid}/reviews` | `user_routes.py:310` | P1 |
| `PUT /users/{uid}/reviews/{rid}` | `user_routes.py:262` | P2 |

---

## BLOCKER 9 — Upload (2 endpoints)

| Endpoint | Fichier | Criticité |
|---|---|---|
| `POST /upload-image` | `upload_routes.py:125` | P0 |
| `POST /upload-image/debug-422` | `upload_routes.py:114` | P2 (debug) |

---

## BLOCKER 10 — Push tokens (2 endpoints)

| Endpoint | Fichier | Criticité |
|---|---|---|
| `POST /push-token` | `push_routes.py:15` | P0 |
| `DELETE /push-token` | `push_routes.py:57` | P1 |

---

## NON-BLOCKERS pour le front (admin / secondaire)

| Domaine | Endpoints | Raison |
|---|---|---|
| Admin global (stats, users, config) | ~15 | Interface admin séparée |
| Admin products (approve/reject) | 4 | Admin uniquement |
| Admin payments (list, stats) | 3 | Dashboard admin |
| Référentiels CRUD admin | 12 | Gestion admin des domaines/tags |
| Addresses CRUD | 4 | Fonctionnalité secondaire |
| Soft-delete / Rétention | 8 | Gestion compte, contournable temporairement |
| Products / Marketplace | 6 | Domaine secondaire |
| Workers background (5) | — | Fonctionnent côté Python en parallèle |
| DELETE /{uid}/followers/{fid} | 1 | Interaction rare |

---

## Résumé blockers

| # | Blocker | Endpoints | P0 |
|---|---|---|---|
| 1 | Auth | 6 | 3 |
| 2 | SpotYou / TagPoints | 35 | ~25 |
| 3 | Booking CREATE + PAY | 3 | 2 |
| 4 | Services CRUD | 10 | 4 |
| 5 | Chat + WebSocket | 7 | 5 |
| 6 | Home feed | 2 | 2 |
| 7 | Notifications | 3 | 3 |
| 8 | User profile write | 8 | 3 |
| 9 | Upload | 2 | 1 |
| 10 | Push tokens | 2 | 1 |
| **TOTAL** | | **78** | **~49** |
