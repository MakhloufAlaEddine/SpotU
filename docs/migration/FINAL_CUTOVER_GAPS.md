# FINAL_CUTOVER_GAPS.md — Gaps avant cutover front full-Java
> Généré le 2026-04-30. Audit effectué après S41 (dernière slice migrée).
> Sources : Python `/app/backend/routes/*.py` + `server.py` ; PRD.md slices S10–S41 ; grep frontend `/app/frontend/{app,components,utils,lib,hooks}` (calls via `lib/api.ts`).

---

## Méthodologie

### Endpoints Python détectés
**128 endpoints HTTP** répartis sur **18 fichiers `routes/*.py`**.

### Slices Java migrés (S10 → S41 — extracts PRD)
| Domaine | Slices | Couverture |
|---|---|---|
| Foundations / infra | S01–S09 | PostgreSQL, PostGIS, JWT (avant audit) |
| Référentiels (domains/tags reads) | S10 | 3 endpoints publics |
| Booking reads | S11 | 3 endpoints |
| Booking writes (accept/refuse/complete/cancel) | S13–S15 | 4 endpoints |
| Stripe webhooks paiements | S16, S33, S35 | 1 endpoint + 10 events |
| Payment checkout + status | S17 | 2 endpoints |
| ExpiryWorker (booking timeout) | S18 | Worker `@Scheduled` |
| StripePaymentService (capture/cancel/refund) | S19 | Service infra |
| Subscription webhooks | S20 | 6 events |
| Subscription user cycle | S21 | 6 endpoints |
| Admin subscriptions + plans CRUD | S22 | 6 endpoints |
| Auth complet (register/login/google/me/logout/change-pwd) | S23 | 5 endpoints + JWT/OAuth infra |
| Profile write + upload image + push tokens | S24 | 7 endpoints |
| Home feed | S25 | 2 endpoints (PostGIS) |
| SpotYou reads | S26 | 7 endpoints |
| SpotYou membership lifecycle | S27 | 11 endpoints |
| SpotYou CRUD writes | S28 | 3 endpoints |
| Payment reads | S34 | 3 endpoints |
| Marketplace lecture publique | S38 | 1 endpoint |
| Marketplace seller authoring | S39 | 3 endpoints |
| Marketplace lifecycle (DELETE/Reactivate + MediaPurgeWorker) | S40 | 2 endpoints + worker |
| Marketplace admin moderation (+ ReminderWorker) | S41 | 4 endpoints + worker |

**Total endpoints couverts (estimation)** : ~80 endpoints sur 128 ≈ **62 %**.

### Frontend appels API détectés (`grep api.{get,post,put,patch,delete}`)
~80 chemins distincts détectés dans le code applicatif (hors `node_modules`).

---

## 1. Endpoints **NON MIGRÉS** — domaines entiers manquants

### 1.1 🔴 P0 — `chat_routes.py` (Chat / Conversations) — **4 endpoints**

| # | Méthode | Chemin | Lignes | Front utilise ? |
|---|---|---|---|---|
| 1 | POST | `/conversations` | 227 | ✅ détecté |
| 2 | GET | `/conversations` | 349 | ✅ détecté |
| 3 | GET | `/conversations/{conv_id}/messages` | 389 | ✅ détecté |
| 4 | PUT | `/conversations/{conv_id}/read` | 438 | ✅ détecté |

**Impact** : écran Chat complet inopérant en mode full-Java. **Bloquant cutover absolu.**

### 1.2 🔴 P0 — `service_routes.py` (Services coach — location/prestations) — **11 endpoints**

| # | Méthode | Chemin | Lignes | Front utilise ? |
|---|---|---|---|---|
| 5 | GET | `/services` (search) | 352 | ✅ détecté |
| 6 | GET | `/services/mine` | 416 | ✅ détecté |
| 7 | GET | `/services/saved` | 645 | ✅ détecté |
| 8 | GET | `/services/deactivated` | 687 | partiel |
| 9 | GET | `/services/{service_id}` | 718 | inféré |
| 10 | POST | `/services` (create) | 756 | inféré |
| 11 | PUT/PATCH | `/services/{service_id}` | 852/853 | inféré |
| 12 | DELETE | `/services/{service_id}` | 986 | inféré |
| 13 | POST | `/services/{service_id}/reactivate` | 1051 | inféré |
| 14 | POST | `/services/{service_id}/save` | 1107 | inféré |
| 15 | DELETE | `/services/{service_id}/unsave` | 1123 | inféré |

**Impact** : domaine "réservation de services" entièrement non migré. C'est **le pendant marketplace côté coach** — aussi critique que S38–S41 le sont pour le marketplace produit. **Bloquant cutover absolu** (les bookings S11–S15 dépendent de l'existence de services côté DB, mais sans endpoint de création/listing en Java les coachs ne peuvent pas publier).

### 1.3 🟡 P1 — `address_routes.py` (Adresses utilisateur) — **4 endpoints**

| # | Méthode | Chemin | Lignes | Front utilise ? |
|---|---|---|---|---|
| 16 | GET | `/addresses` | 35 | ✅ détecté |
| 17 | POST | `/addresses` | 53 | ✅ détecté |
| 18 | PUT | `/addresses/{address_id}` | 77 | ✅ détecté |
| 19 | DELETE | `/addresses/{address_id}` | 99 | ✅ détecté |

**Impact** : carnet d'adresses (livraison/déplacement) inopérant.

### 1.4 🟡 P1 — `user_routes.py` social (follow/reviews/suggestions/search) — **~13 endpoints**

| # | Méthode | Chemin | Lignes | Front utilise ? |
|---|---|---|---|---|
| 20 | GET | `/users/{uid}/reviews` | 238 | inféré (page profil) |
| 21 | PUT | `/users/{uid}/reviews/{rid}` | 262 | inféré |
| 22 | POST | `/users/{uid}/reviews` | 310 | inféré |
| 23 | GET | `/users/me/activity-feed` | 377 | ✅ détecté |
| 24 | POST | `/users/{uid}/follow` | 494 | inféré |
| 25 | DELETE | `/users/{uid}/follow` | 512 | inféré |
| 26 | GET | `/users/{uid}/followers` | 568 | inféré |
| 27 | GET | `/users/{uid}/following` | 592 | inféré |
| 28 | DELETE | `/users/{uid}/followers/{fid}` | 616 | inféré |
| 29 | POST | `/users/{uid}/block` | 632 | inféré |
| 30 | DELETE | `/users/{uid}/block` | 654 | inféré |
| 31 | GET | `/users/{uid}/suggestions` | 667 | inféré |
| 32 | GET | `/users/search` | 798 | ✅ détecté |
| 33 | GET | `/users/{uid}/public` | 99 | inféré |

**Impact** : graph social (follow/block/reviews/suggestions) inopérant. **Profil public dégradé.** S23+S24 ne couvrent que register/login/me/profile/cover/become-coach.

### 1.5 🟡 P1 — `deletion_routes.py` (Suppressions/réactivations) — **8 endpoints**

| # | Méthode | Chemin | Lignes | Front utilise ? |
|---|---|---|---|---|
| 34 | DELETE | `/users/{user_id}` | 97 | inféré |
| 35 | DELETE | `/tag-points/{point_id}` | 260 | inféré (suppression SpotYou) |
| 36 | POST | `/tag-points/{point_id}/reactivate` | 351 | inféré |
| 37 | DELETE | `/messages/{message_id}` | 436 | inféré (chat) |
| 38 | PATCH | `/conversations/{conv_id}/leave` | 481 | inféré |
| 39 | PATCH | `/users/{user_id}/deactivate` | 522 | inféré |
| 40 | POST | `/users/{user_id}/reactivate` | 624 | inféré |
| 41 | GET | `/users/me/reactivatable` | 681 | ✅ détecté |

**Impact** : RGPD / lifecycle compte utilisateur inopérant. **DELETE SpotYou et Reactivate doublons** avec routes alternatives possibles — auditer pour clarifier la canonical route.

### 1.6 🟡 P1 — `admin_routes.py` (Admin général hors marketplace) — **~22 endpoints**

| # | Méthode | Chemin | Lignes | Couverture S41 ? |
|---|---|---|---|---|
| 42 | GET | `/admin/stats` | 11 | ❌ |
| 43 | GET | `/admin/users` | 53 | ❌ |
| 44 | PUT | `/admin/users/{uid}/role` | 75 | ❌ |
| 45 | PUT | `/admin/users/{uid}/verify-coach` | 93 | ❌ |
| 46 | GET | `/admin/tag-points` | 107 | ❌ |
| 47 | DELETE | `/admin/tag-points/{point_id}` | 118 | ❌ (n'est PAS S40 owner-only) |
| 48 | GET | `/admin/services` | 127 | ❌ |
| 49 | GET | `/admin/pricing-rules` | 138 | ❌ |
| 50 | POST | `/admin/pricing-rules` | 149 | ❌ |
| 51 | PUT | `/admin/pricing-rules/{rule_id}` | 176 | ❌ |
| 52 | DELETE | `/admin/pricing-rules/{rule_id}` | 199 | ❌ |
| 53 | GET | `/admin/subscription-plans` | 210 | ✅ S22 (DUPLICATION ! même path dans 2 fichiers) |
| 54 | POST | `/admin/subscription-plans` | 221 | ✅ S22 |
| 55 | PUT | `/admin/subscription-plans/{plan_id}` | 252 | ✅ S22 |
| 56 | DELETE | `/admin/subscription-plans/{plan_id}` | 277 | ✅ S22 |
| 57 | GET | `/admin/domains` | 286 | ❌ |
| 58 | GET | `/admin/tags-analytics` | 295 | ✅ détecté front |
| 59 | GET | `/admin/all-domains` | 385 | ✅ détecté front |
| 60 | GET | `/admin/all-categories` | 394 | ✅ détecté front |
| 61 | GET | `/admin/all-tags` | 408 | ✅ détecté front |
| 62 | GET | `/admin/app-config` | 440 | ✅ détecté front |
| 63 | POST | `/admin/purge` | 451 | ❌ |
| 64 | GET | `/admin/purge/status` | 495 | ❌ |
| 65 | PUT | `/admin/app-config` | 539 | ❌ |

**Impact** : tableau de bord admin inopérant. **Front admin a 7 calls détectés** : `stats`, `app-config`, `tags-analytics`, `all-domains`, `all-categories`, `all-tags`, `payments`, `pricing-rules`, `subscription-plans` → seuls S22 (subscription-plans) sont migrés.

### 1.7 🟡 P1 — `domain_routes.py` writes (Admin référentiels) — **~10 endpoints**

S10 ne couvre QUE les 3 reads publics (`GET /domains`, `GET /tags/categories`, `GET /tags`). Les 10 écritures admin sont non migrées :

| # | Méthode | Chemin | Lignes |
|---|---|---|---|
| 66 | POST | `/domains` | 22 |
| 67 | PUT | `/domains/{domain_id}` | 174 |
| 68 | GET | `/domains/{domain_id}/usage` | 200 |
| 69 | DELETE | `/domains/{domain_id}` | 222 |
| 70 | POST | `/tags/categories` | 88 |
| 71 | PUT | `/tags/categories/{category_id}` | 244 |
| 72 | GET | `/tags/categories/{category_id}/usage` | 273 |
| 73 | DELETE | `/tags/categories/{category_id}` | 297 |
| 74 | POST | `/tags` | 143 |
| 75 | PUT | `/tags/{tag_id}` | 323 |
| 76 | GET | `/tags/{tag_id}/usage` | 343 |
| 77 | DELETE | `/tags/{tag_id}` | 359 |

**Impact** : impossible pour un admin de créer/modifier des domaines/catégories/tags depuis Java. Front admin a 4 calls détectés (`domains`, `tags/categories`, `tags`) → reads publics couverts par S10 mais les writes non.

### 1.8 🔴 P0 — `spot_you_routes.py` (RSVP / "Going") — **7 endpoints**

S26–S28 couvrent `tagpoint_routes.py` mais PAS le fichier distinct `spot_you_routes.py` (RSVP attendance).

| # | Méthode | Chemin | Lignes | Front utilise ? |
|---|---|---|---|---|
| 78 | POST | `/spot-you/{point_id}/join` | 132 | ⚠️ collision avec S27 ? |
| 79 | DELETE | `/spot-you/{point_id}/leave` | 212 | ⚠️ collision avec S27 ? |
| 80 | POST | `/spot-you/{point_id}/going` | 289 | inféré |
| 81 | DELETE | `/spot-you/{point_id}/going` | 400 | inféré |
| 82 | GET | `/spot-you/my-completion-stats` | 461 | ✅ détecté |
| 83 | GET | `/spot-you/{point_id}/activity` | 495 | inféré |
| 84 | GET | `/spot-you/{point_id}/going` | 627 | inféré |

> 🔴 **À INVESTIGUER** : `/spot-you/{point_id}/join` (l. 132) vs `/tag-points/{point_id}/join` de S27 — possible doublon ou alias. Auditer avant cutover pour éviter dual-routing accidentel.

**Impact** : compteur de présence (RSVP "j'y vais") + activity feed SpotYou + stats complétion **non migrés**. Affichage live des participants à un événement KO.

### 1.9 🟡 P1 — `tagpoint_routes.py` non couvert par S26–S28 — **~14 endpoints**

S26 = reads, S27 = membership, S28 = CRUD owner. Ce qui reste **non migré** :

| # | Méthode | Chemin | Lignes | Front utilise ? |
|---|---|---|---|---|
| 85 | POST | `/tag-points/{id}/invite` | 862 | inféré (couvert ? S27 list dit "invite") — **à confirmer** |
| 86 | POST | `/tag-points/{id}/invitations/accept` | 1007 | partiel S27 (à confirmer) |
| 87 | POST | `/tag-points/{id}/invitations/refuse` | 1059 | partiel S27 |
| 88 | DELETE | `/tag-points/{id}/cancel-request` | 833 | partiel S27 |
| 89 | GET | `/users/me/spotyou-invitations` | 966 | ✅ détecté |
| 90 | GET | `/users/me/notifications` | 1350 | ✅ détecté |
| 91 | PATCH | `/users/me/notifications/{nid}/read` | 1394 | ✅ détecté |
| 92 | PATCH | `/users/me/notifications/read-all` | 1413 | ✅ détecté |
| 93 | GET | `/users/me/events` | 1428 | ✅ détecté |
| 94 | GET | `/users/me/planning-events` | 1462 | ✅ détecté |
| 95 | GET | `/tag-points/{id}/my-vote` | 1703 | inféré |
| 96 | POST | `/tag-points/{id}/vote` | 1719 | inféré |
| 97 | GET | `/tag-points/{id}/votes` | 1791 | inféré |

> 🔴 **Notifications inbox + planning-events + activity feed = écran central de l'app**. Sans migration, **pas de notifications utilisateur** côté Java.

**Impact** : centre de notifications + agenda + votes SpotYou inopérants.

### 1.10 🟢 P2 — `payment_routes.py` admin — **3 endpoints**

| # | Méthode | Chemin | Lignes | Front utilise ? |
|---|---|---|---|---|
| 98 | PATCH | `/payments/{payment_id}/stripe` | 410 | rare admin |
| 99 | GET | `/admin/payments` | 452 | ✅ détecté |
| 100 | GET | `/admin/payments/stats` | 471 | inféré |
| 101 | GET | `/admin/subscriptions` | 497 | ✅ S22 (collision admin_routes — DUPLICATION) |

### 1.11 🟢 P2 — `home_routes.py` — déjà couvert par S25 (`feed`, `nearest-sector`)

✅ COUVERT.

### 1.12 🟢 P2 — `upload_routes.py` — couvert par S24

| # | Endpoint | Statut |
|---|---|---|
| 102 | POST `/upload-image` | ✅ S24 |
| 103 | POST `/upload-image/debug-422` | ✅ S24 |

### 1.13 🟢 P2 — `push_routes.py` — couvert par S24

| # | Endpoint | Statut |
|---|---|---|
| 104 | POST `/push-token` | ✅ S24 |
| 105 | DELETE `/push-token` | ✅ S24 |

---

## 2. Endpoints **MIGRÉS avec écart** (drift documenté à valider)

| Slice | Endpoint Java | Écart documenté | Action requise |
|---|---|---|---|
| S22 | `GET /admin/subscription-plans` | **DUPLICATION** — même path dans `admin_routes.py:210` ET `subscription_routes.py:151` (Python). Les 2 retournent des shapes différents. | Choisir 1 implémentation Java unique ; documenter quelle source de vérité côté front. |
| S22 | `GET /admin/subscriptions` | DUPLICATION même path dans `payment_routes.py:497` ET `subscription_routes.py:453` | Idem. |
| S39/S40 | INSERT/UPDATE `image_urls` | Initial : `text[]` vs `jsonb` incertain. **S41 a CONFIRMÉ `jsonb`** via `jsonb_array_length`. | Valider que l'implé Java utilise `PGobject(type="jsonb")` partout. |
| S40 | DELETE `/products/{id}` boucle INSERT pending_file_deletions | Anomalie compat : `cover_image_url` non incluse si hors `image_urls[]` | Préserver compat ; documenter dette technique. |
| S40 | Reactivate force `status='active'` | Anomalie compat : perte du statut antérieur (draft/pending_review/rejected) | Préserver ; slice future correctrice. |
| S40 | `MediaPurgeWorker` délègue `admin_purge_worker.run_purge` | **STUB** — purge physique R2 non implémentée | S40-bis nécessaire avant prod. |
| S41 | approve/reject sans guard statut courant | Anomalie zombie : peut ressusciter `deleted → active` | Logger WARN ; préserver. |
| S41 | reject `data.admin_comment` peut être `""` | Divergence DB null vs push payload `""` | Préserver bit-pour-bit. |
| S15 | DELETE booking partial | Le payment cancellation Stripe est en stub | S19 a fini les stubs — vérifier intégration. |

---

## 3. Endpoints Python **non utilisés par le front** (candidats au drop)

À auditer dans le code mobile/web pour confirmation. Candidats détectés (aucun call grep visible) :

| Endpoint | Hypothèse |
|---|---|
| `POST /upload-image/debug-422` | Endpoint debug — supprimable |
| `GET /auth/native-callback` | Deeplink Expo OAuth uniquement — utilisé par framework Expo, pas par code app |
| `GET /admin/all-domains` / `all-categories` / `all-tags` | Possibles endpoints admin internes, vérifier usage |
| `GET /admin/purge` / `purge/status` | Admin maintenance — peu utilisé |

---

## 4. Endpoints critiques manquants (récap P0)

| # | Endpoint | Domaine | Justification P0 |
|---|---|---|---|
| 1 | POST/GET/PUT `/conversations*` (4 endpoints) | Chat | Front Chat appelle directement, écran complet KO |
| 2 | GET/POST/PUT/DELETE `/services*` (11 endpoints) | Services coach | Pendant marketplace coach, dépendance booking S11-S15 |
| 3 | POST `/spot-you/{id}/going` + GET `my-completion-stats` (7 endpoints) | SpotYou RSVP | Front utilise `my-completion-stats` directement |
| 4 | GET/PATCH `/users/me/notifications*` (3 endpoints) | Notifications | Front utilise massivement, écran inbox KO |
| 5 | GET `/users/me/planning-events` + `/events` | Agenda | Front utilise directement, écran agenda KO |
| 6 | GET/POST/PUT/DELETE `/addresses` (4 endpoints) | Adresses | Front utilise massivement, checkout/livraison KO |
| 7 | GET `/users/search` | Recherche utilisateur | Front utilise directement, search bar KO |

**Total P0 manquant** : ~30 endpoints critiques sur ~48 encore non migrés.

---

## 5. Synthèse comptable

| Catégorie | Compte |
|---|---|
| Endpoints Python totaux | ~128 |
| Endpoints Java migrés (slices S10–S41) | ~80 |
| Endpoints Java avec écart documenté à valider | ~9 |
| Endpoints **non migrés** (incluant duplications Python) | ~48 |
| Endpoints **non migrés P0** (bloquants) | ~30 |
| Endpoints **non migrés P1** (importants) | ~15 |
| Endpoints **non migrés P2/P3** (admin/peu utilisés) | ~3 |

**Couverture endpoints** : **~62 %**.
**Couverture pondérée par usage front** (basée sur grep) : estimée **~70 %** (les endpoints non migrés incluent beaucoup de routes admin secondaires, mais Chat et Services sont des bloquants majeurs).
