# MIGRATION_SLICES_PROPOSAL.md

Objectif : **slices verticales** derrière un proxy ou un préfixe `/api` partagé, avec **tests de contrat** sur chaque slice avant bascule de trafic.

**Principe** : commencer par **lecture seule**, **sans auth complexe**, **sans effet de bord externe** ; remonter vers **écriture**, **auth**, **Stripe**, **WS**.

---

## Phase 0 — Socle (sans métier métier)

1. **`GET /api/liveness`**, **`GET /api/readiness`** — valident process + DB.
2. **`GET /api/config/booking`**, **`GET /api/config/commission`** — public, SQL simple, contrat JSON stable.

**Pourquoi en premier** : déjà utilisés par l’infra ; zéro auth ; peu de tables.

---

## Phase 1 — Taxonomie lecture seule

3. **`GET /api/domains`**, **`GET /api/tags`**, **`GET /api/tags/categories`** (+ variantes query) — public ou auth légère selon endpoint exact.

**Éviter en premier** : `POST/PUT/DELETE` tags/domains (admin / effets cascade).

---

## Phase 2 — Catalogue « contenu » lecture

4. **`GET /api/home/nearest-sector`**, **`GET /api/home/feed`** — dépendances géo + scoring (lire `home_routes.py` en détail avant).

5. **`GET /api/marketplace/products`**.

6. **`GET /api/services`**, **`GET /api/services/{id}`** (modes public / enrichissement).

**Attention** : PostGIS + perfs ; prévoir jeux de tests géo.

---

## Phase 3 — Utilisateur authentifié « profil »

7. **`GET /api/auth/me`**, **`GET /api/users/profile`**, **`PUT /api/users/profile`** — nécessitent **JWT identique** (secret, claims, durée).

8. **`GET /api/addresses`** CRUD — surface réduite, tables dédiées.

**Condition** : slice **auth** stable (au minimum validation JWT + chargement `users`).

---

## Phase 4 — Push & fichiers « non financiers »

9. **`POST/DELETE /api/users/push-token`** — Expo Push, table `push_tokens`.

10. **`POST /api/upload-image`** — R2/disque ; limites taille ; **après** stabilisation auth.

---

## Phase 5 — Tag points / SpotYou (HTTP avant WS)

11. Endpoints **GET** tag-points / saved / mine / détail.

12. Puis mutations **join / save / vote** (sans invitations si trop imbriqué).

13. **`spot_you_routes`** (join/leave/going) — fortement couplé à `tag_points`.

**WebSocket** : **slice séparée** après HTTP stable (`/api/ws/...`).

---

## Phase 6 — Services coach

14. CRUD services + slots + packages + saves — dépend de `users` coach + `app_config`.

---

## Phase 7 — Chat (HTTP puis WS)

15. `POST/GET /api/conversations`, messages, read — puis **WebSockets**.

---

## Phase 8 — Réservations (sans webhook d’abord en intégration)

16. `price-preview`, `bookings/me`, `GET` détail.

17. Puis flux `request` → `accept` / `refuse` / `cancel` — **couplage Stripe** à traiter tôt en parallèle **sandbox**.

---

## Phase 9 — Paiements & Stripe

18. **`POST /api/payments/checkout/session`**, status polling.

19. **`POST /api/webhook/stripe`** — **dernier bloc critique** ; nécessite environnement Stripe identique + table `stripe_webhook_events`.

**Ne pas** déplacer le webhook avant d’avoir **idempotence** et **tests événements** reproduits.

---

## Phase 10 — Abonnements

20. Plans publics + `subscriptions/me` + checkout + **réutiliser** la même logique webhook (déjà couplée).

---

## Phase 11 — Admin & suppression

21. `admin_routes` (stats, users, pricing, purge).

22. `deletion_routes` + `admin_purge_worker` — **forte responsabilité légale**.

---

## Phase 12 — Marketplace produits

23. `product_creation_routes` + `admin_product_routes` — validations riches, Stripe product/price IDs.

---

## Ordre **à éviter** en tout premier

- Webhook Stripe seul sans monolithe adjacent testé.
- WebSockets sans auth claire.
- `deletion_routes` sans sauvegarde DB + plan rollback.

---

## Validation continue

- Pour chaque slice : extraire **OpenAPI** depuis FastAPI (`/openapi.json`) et comparer réponses **JSON** (status, champs) sur jeux de tests `backend/tests` pertinents.
