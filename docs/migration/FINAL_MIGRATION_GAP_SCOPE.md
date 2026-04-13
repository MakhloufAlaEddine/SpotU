# FINAL_MIGRATION_GAP_SCOPE.md — Inventaire complet des gaps
> Basé sur l'audit de 179 endpoints HTTP + 3 WebSockets + 6 workers Python.
> Croisé avec les Slices 01–22 déjà documentées.
> Généré le 2026-04-13.

---

## Bilan global

| Métrique | Valeur |
|---|---|
| **Endpoints HTTP Python total** | 179 (dont ~8 alias/doublons) |
| **WebSockets** | 3 |
| **Workers background** | 6 |
| **Endpoints documentés (S01–S22)** | ~39 (22%) |
| **Endpoints NON documentés** | ~140 (78%) |
| **Workers documentés** | 1/6 (ExpiryWorker — S18) |

---

## A. Domaines ENTIÈREMENT migrés (documentation complète)

| Domaine | Slices | Endpoints | Statut |
|---|---|---|---|
| Auth — lecture token | S02 | GET /auth/me | ✅ |
| User profil lecture | S03, S04 | GET /profile, GET /{uid}/public | ✅ |
| User social (follow/block) | S05, S06, S07 | 6 endpoints | ✅ |
| User reviews lecture | S08 | GET /{uid}/reviews | ✅ |
| Référentiels (domains/tags) lecture | S10 | 3 endpoints | ✅ |
| Services lecture | S09 | GET /services, GET /services/{id} | ✅ |
| Bookings lecture | S11 | 5 endpoints (3 uniques + 2 alias) | ✅ |
| Bookings write complet | S12–S15 | refuse, accept, complete, cancel | ✅ |
| Payments checkout | S17 | create session + status | ✅ |
| Webhook Stripe complet | S16, S20 | payments + subscriptions | ✅ |
| Stripe réseau réel | S19 | capture, cancel, refund | ✅ |
| ExpiryWorker | S18 | background worker | ✅ |
| Subscriptions complètes | S20–S22 | webhooks + user + admin | ✅ |

---

## B. Domaines PARTIELLEMENT migrés

| Domaine | Migré | Manquant | Impact front |
|---|---|---|---|
| **Bookings write** | accept, refuse, cancel, complete | `POST /bookings/request` (CRÉER), `POST /bookings/{id}/pay`, `POST /bookings/price-preview` | 🔴 BLOQUANT |
| **Payments** | checkout session/status, webhook | `GET /payments/me`, `GET /payments/{id}`, admin payments | 🟡 IMPORTANT |
| **Services** | list + detail (read) | CREATE, UPDATE, DELETE, mine, saved, deactivated, reactivate, save/unsave (10 endpoints) | 🔴 BLOQUANT |
| **Référentiels (domains/tags)** | lecture publique (3) | CRUD admin complet (12 endpoints) | 🟡 Admin only |
| **Auth** | GET /me | register, login, google, logout, change-password, native-callback (6) | 🔴 BLOQUANT |

---

## C. Domaines NON migrés

### 🔴 BLOQUANT pour le front

| Domaine | Fichier Python | Endpoints | Impact |
|---|---|---|---|
| **SpotYou / TagPoints** | `tagpoint_routes.py` | **28 endpoints** | Fonctionnalité cœur — liste, détail, CRUD, join, invite, approve/reject, vote, save, notifications, planning |
| **SpotYou — interactions** | `spot_you_routes.py` | **7 endpoints** | Join, leave, going, activity, completion stats |
| **Chat + WebSocket** | `chat_routes.py` | **4 HTTP + 3 WS** | Conversations, messages, temps réel |
| **Home feed** | `home_routes.py` | **2 endpoints** | Écran principal (nearest-sector + feed) |
| **Upload images** | `upload_routes.py` | **2 endpoints** | Upload média (Cloudflare R2) |
| **Notifications** | `tagpoint_routes.py` | **3 endpoints** | GET /me/notifications, mark read, read-all |
| **User planning** | `tagpoint_routes.py` | **2 endpoints** | GET /me/events, /me/planning-events |
| **User profile write** | `user_routes.py` | **5 endpoints** | PUT /profile, become-coach, cover, activity-feed, suggestions |
| **User reviews write** | `user_routes.py` | **2 endpoints** | POST + PUT reviews |
| **User search** | `user_routes.py` | **1 endpoint** | GET /search |
| **User remove follower** | `user_routes.py` | **1 endpoint** | DELETE /{uid}/followers/{fid} |
| **Push tokens** | `push_routes.py` | **2 endpoints** | Enregistrer/supprimer tokens FCM |

### 🟡 IMPORTANT mais contournable (admin ou secondaire)

| Domaine | Fichier Python | Endpoints | Impact |
|---|---|---|---|
| **Products / Marketplace** | `product_creation_routes.py`, `marketplace_routes.py` | **6 endpoints** | CRUD produits + marketplace list |
| **Admin products** | `admin_product_routes.py` | **4 endpoints** | Pending, detail, approve, reject |
| **Soft-delete / Rétention** | `deletion_routes.py` | **8 endpoints** | Delete user/tagpoint, reactivate, deactivate, leave conversation, delete message |
| **Addresses** | `address_routes.py` | **4 endpoints** | CRUD adresses |
| **Payments admin** | `payment_routes.py` | **3 endpoints** | Admin payments list, stats, stripe update |

### 🟢 Secondaire / Admin only / Hors front principal

| Domaine | Fichier Python | Endpoints | Impact |
|---|---|---|---|
| **Admin global** | `admin_routes.py` | **~15 endpoints** | Stats, users, tag-points, services, pricing-rules, domains analytics, app-config, purge |
| **Référentiels CRUD admin** | `domain_routes.py` | **12 endpoints** | CRUD domaines, catégories, tags (admin) |
| **Workers background** | Divers | **5 non documentés** | MediaPurge, MediaNotif, SpotYouNotif, AdminProductReminder, AdminPurge |

---

## D. Workers non documentés

| Worker | Fichier | Rôle | Impact front |
|---|---|---|---|
| `MediaPurgeWorker` | `media_purge_worker.py` | Purge médias J+90 | 🟢 Background, pas d'impact front direct |
| `MediaNotifWorker` | `media_notif_worker.py` | Notification J+83 avant purge | 🟢 Background |
| `SpotYouNotifWorker` | `spot_you_notif_worker.py`* | Notifications SpotYou | 🟡 Notifications temps réel |
| `AdminProductReminderWorker` | `admin_purge_worker.py` | Rappels admin produits | 🟢 Admin only |
| `AdminPurgeWorker` | `admin_purge_worker.py` | Purge admin | 🟢 Admin only |

---

## E. Comptage par priorité

| Priorité | Endpoints | % du total |
|---|---|---|
| ✅ Déjà documenté | ~39 | 22% |
| 🔴 Bloquant front | ~80 | 45% |
| 🟡 Important | ~25 | 14% |
| 🟢 Secondaire | ~35 | 19% |
