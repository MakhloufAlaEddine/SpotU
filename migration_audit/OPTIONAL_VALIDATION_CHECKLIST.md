# OPTIONAL_VALIDATION_CHECKLIST.md

Checklist **courte** avant démarrage effectif de la migration Spring. Cocher au fur et à mesure.  
**Légende** : **certain** = vérifiable dans le repo · **déduit** = à confirmer par exécution / tests · **recommandé** = bonne pratique.

---

## Collisions

- [ ] **`GET /api/admin/subscriptions`** : confirmer par **test HTTP** ou introspection routes que le handler exécuté est bien **`admin_subscriptions`** (`payment_routes.py`) — **déduit** aujourd’hui ; sinon ajuster ARB-001.
- [ ] **`GET /api/admin/subscription-plans`** : confirmer que le handler exécuté est bien **`list_subscription_plans`** (`admin_routes.py`) — **déduit** ; sinon ajuster ARB-002.
- [ ] Vérifier qu’aucun **doublon** `@GetMapping` / `@RequestMapping` équivalent n’est généré en Spring pour ces chemins (**recommandé**).

---

## Auth

- [ ] Relire les handlers marqués **auth (incertain)** dans `ENDPOINTS_CANONICAL_LIST.md` (liste des **26** restants après heuristique — **certain** chiffre dans `ENDPOINTS_RECONCILIATION.md`).
- [ ] **JWT classique** : header `Authorization` là où `require_auth` / `require_role` s’appliquent — aligner filtres Spring Security (**recommandé**).
- [ ] **WebSocket** : handshake **`{ "token": "<jwt>" }`** après connexion, pour les 3 canaux — **certain** (`chat_routes.py`, ARB-010).

---

## Uploads

- [ ] Cartographier **écriture** (`upload_routes.py`, `UPLOADS_DIR = /app/backend/uploads`) vs **lecture statique** (`server.py`, `ROOT_DIR / "uploads"` sous `/api/uploads`) — **certain** ; décision infra ARB-009.
- [ ] Volumes Docker / K8s : même répertoire physique visible par l’app **et** par le serveur de fichiers statiques — **recommandé**.
- [ ] **R2** (si `R2_PUBLIC_URL`) : parcours suppression / URL publique — **recommandé** relecture `upload_routes.py` + `r2_storage`.

---

## Webhooks

- [ ] **`POST /api/webhook/stripe`** : idempotence, signature, codes d’erreur — aligner avec `@`/`WebhookController` Spring (**recommandé** + tests Stripe CLI).
- [ ] Handlers subscription/payment invoqués **depuis** le webhook (hors route HTTP) : voir audits « side effects » si présents.

---

## Workers

- [ ] Lister les **@app.on_event("startup")** workers dans `server.py` (expiry, SpotYou notif, rappels admin produits, purge médias, etc.) — **certain** fichier.
- [ ] Pour chaque worker : équivalent **@Scheduled** / queue / service externe en Spring — **recommandé** (hors scope strict « endpoints » mais bloquant prod).

---

## Infra endpoints

- [ ] **`GET /api/liveness`** / **`GET /api/readiness`** : codes **200** / **503** readiness — parité avec sondes K8s (**certain** sémantique commentée dans `server.py`).
- [ ] **`GET /api/config/booking`** et **`GET /api/config/commission`** : dépendance DB — **certain**.

---

## Exclusions

- [ ] **`POST /api/upload-image/debug-422`** : absent du déploiement Spring prod si exclusion ARB-008 respectée — **recommandé**.
- [ ] Aucune route Spring pour **`get_spot_you_members`** tant que le Python n’expose pas la fonction — **certain**.

---

## Aliases

- [ ] **Quatre** chemins GET booking (deux paires) mappés en Spring — **certain** (`booking_routes.py`).
- [ ] Tests de non-régression client sur **`/api/users/me/bookings`** et **`/api/receiver/requests`** — **recommandé**.

---

## Synthèse « gate » avant code Spring massif

| Zone | Bloquant si non validé ? |
|------|---------------------------|
| Collisions + test HTTP | **Oui** (comportement API) |
| Uploads chemins | **Oui** en prod (fichiers invisibles) |
| Webhook Stripe | **Oui** si paiement en prod |
| Workers | **Oui** pour parité fonctionnelle |
| Auth incertain (26) | **Recommandé** (sécurité) |
| WS handshake | **Oui** si clients WS existants |
