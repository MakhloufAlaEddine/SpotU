# SLICE_39_SCOPE.md — Cadrage de la Slice 39 (Marketplace — Création produit)
> Basé sur `routes/product_creation_routes.py:1–568` + montage `server.py:32,110`.
> Généré le 2026-04-29.

---

## ⚠️ ALERTE PATH — divergence prompt vs code réel

Le prompt utilisateur mentionne `POST /api/marketplace/products`. **Ce path n'existe PAS côté Python.** Le code réel expose :

| Path **demandé** prompt | Path **réel** Python | Source |
|---|---|---|
| `POST /api/marketplace/products` | **`POST /api/products`** | `server.py:110` (`include_router(product_creation_router)` SANS prefix `/products`) — le décorateur `@router.post("/products")` produit donc `/api/products` |

**Compat stricte : Java DOIT exposer `POST /api/products`. Ne pas inventer `POST /api/marketplace/products`.** Le prefix `/marketplace` est utilisé UNIQUEMENT par S38 (`GET /api/marketplace/products` lecture publique). Les writes côté seller vivent sur `/api/products`.

---

## Endpoints choisis (3) — tous dans `routes/product_creation_routes.py`

| # | Méthode | Chemin API | Auth | Lignes | Complexité |
|---|---|---|---|---|---|
| 1 | **POST** | `/api/products` | `require_auth` (any role) | 113–431 | **ÉLEVÉE** |
| 2 | GET | `/api/products/mine` | `require_auth` | 41–73 | FAIBLE |
| 3 | GET | `/api/products/{product_id}/detail` | `require_auth` (ownership) | 77–109 | FAIBLE |

### Pourquoi inclure les 2 GET ?

- **`GET /products/mine`** — alimente l'écran "Mes annonces" du seller. Sans lui, le seller ne peut pas savoir si son `POST /products` a réussi côté front (pas de listing).
- **`GET /products/{id}/detail`** — alimente le formulaire d'**édition** d'un brouillon. Sans lui, l'UPSERT côté `POST /products` (avec `body.product_id`) ne peut pas être déclenché (le front ne sait pas pré-remplir les 40+ champs).

Ces deux GET sont la **paire indissociable du POST** dans le flow d'authoring. Les exclure casserait le parcours seller en Java.

### Endpoints HORS S39 (volontairement reportés)

| Endpoint Python | Lignes | Pourquoi reporté |
|---|---|---|
| `DELETE /api/products/{product_id}` | 459–503 | Lifecycle (soft-delete + planification purge médias 90j + table `pending_file_deletions`). Couplé au `MediaPurgeWorker` — slice dédiée nécessaire. → **S40+** |
| `POST /api/products/{product_id}/reactivate` | 507–556 | Restauration post-suppression. Logique conditionnelle `media_purged`. → **S40+** |
| Routes admin produits (`admin_product_routes.py`, 206 lignes) | toutes | Workflow validation `pending_review → active/rejected`. → **S41+** |
| Notification `_notify_admins_new_product` (push réelle) | 434–455 | Push fire-and-forget — réutilise infra push S24 (déjà documentée). À mocker côté Java au cutover. |

---

## Auth & rôle requis

- **`require_auth(request, pool)`** (helper de `routes/auth_routes.py` documenté en **S23**). 401 si JWT absent/invalide.
- **AUCUN check de rôle seller/coach.** Tout utilisateur authentifié peut créer un produit. → Compat stricte : Java NE DOIT PAS ajouter `@PreAuthorize("hasRole('SELLER')")`.
- **Bypass admin** : `user.role == 'admin'` + `status='pending_review'` → publication directe (`status='active'`, pas de validation admin requise) — ligne 132–133.
- **Ownership** sur les 2 GET : `WHERE seller_id = $user_id` (lignes 64, 103). Pas d'admin override sur ces 2 routes (intentionnel — les admins utilisent `/admin/products/*` dédié).

---

## Dépendances (slices déjà documentées)

| Dépendance | Slice source | Usage en S39 |
|---|---|---|
| `require_auth` middleware | **S23** | Toutes les routes S39 |
| Upload images (URL R2/local) | **S24** | Le client envoie les `image_urls[]` déjà uploadées. **S39 ne fait PAS d'upload** — elle reçoit des URLs. |
| Push admins (`send_push_to_user`) | **S24** (push tokens) | `_notify_admins_new_product` (lignes 434–455) |
| Tags référentiel | **S10** | `body.tag_ids` validé côté front (existence non vérifiée backend) |
| `MediaPurgeWorker` | (à venir, hors S39) | Soft-delete consomme `pending_file_deletions` — pas dans S39 |

---

## Périmètre fonctionnel exact (POST /products)

L'endpoint est un **UPSERT** :
- Si `body.product_id` est fourni ET appartient à l'utilisateur → **UPDATE** du brouillon existant
- Sinon → **INSERT** d'un nouveau produit (id auto-généré `prod_<12 hex>`)

Statuts pilotés par `body.status` :
- `"draft"` (défaut) — sauvegarde en brouillon, **PAS** de validations métier complètes
- `"pending_review"` — soumission pour validation admin, **TOUTES** les validations métier appliquées (BR-39.06)
- `"pending_review"` + admin → auto-bumpé à `"active"` (publication directe — BR-39.05)

### Branchements clés

| Branche | Effet |
|---|---|
| `existing IS NOT NULL` (UPDATE) | Garde anti-régression : interdit de repasser en `draft` après soumission (lignes 244–248, HTTP 403) |
| `existing IS NULL` (INSERT) | Snapshot `seller_name`, `seller_picture_url` depuis `user` JWT (lignes 317–318) |
| `requested_status == 'pending_review'` | Bloc validation 5 erreurs communes + branchement `product_type` (sale vs rental) — 422 si erreurs |
| `requested_status == 'pending_review' AND not is_admin` | `_notify_admins_new_product` (push fire-and-forget) |

### Découpage des UPDATEs (anomalie Python documentée)

L'INSERT/UPDATE principal n'écrit PAS tous les champs en une seule requête. Suivi par **3 UPDATEs séquentiels** dans 3 connexions `pool.acquire()` distinctes (lignes 393–425) :
1. `price_per_session` (l. 399–402)
2. `brand`, `model`, `weight`, `stripe_product_id`, `stripe_price_id` (l. 405–417)
3. `location_address_raw` (l. 420–425)

> ⚠️ **Anomalie atomicité** : 4 transactions au total pour une seule "création". Si une UPDATE secondaire échoue, le produit est partiellement créé. Java DOIT préserver cette anomalie (compat stricte) ou la corriger explicitement (cf. CURSOR_NOTES). Ne pas refactorer en silence.

---

## Tables touchées

| Table | Op | Fréquence |
|---|---|---|
| `marketplace_products` | INSERT (création) **OU** UPDATE x4 (édition) | À chaque POST |
| `users` | SELECT (admins) | UNIQUEMENT si `pending_review` + `not is_admin` (notif) |
| `marketplace_products` | SELECT 2x (existence + status) | Sur UPDATE uniquement |

**AUCUNE table externe** (pas de `tags`, pas de `notifications` — la notif passe par `push_service` direct).

---

## Niveau de risque : **ÉLEVÉ**

| Facteur de risque | Note |
|---|---|
| Nombre de champs (~46 dans INSERT, ~41 dans UPDATE) | 🔴 |
| Validations conditionnelles (rental vs sale) | 🟡 |
| UPSERT avec garde anti-downgrade status | 🔴 |
| Atomicité fragmentée (4 transactions) | 🔴 |
| Snapshot dénormalisé (seller_name, seller_picture_url) | 🟡 |
| Champs JSONB-like (image_urls, pricing_modes, tag_ids, related_spotyou_ids, delivery_modes) — en réalité PostgreSQL `text[]`/`jsonb` selon colonne | 🔴 |
| Bypass admin auto-publish | 🟡 |
| Helper `_delivery_modes` (fallback côté serveur) | 🟢 |

---

## Justification du choix de slice

| Critère | Justification |
|---|---|
| **Suite logique de S38** | S38 a migré la lecture publique. Sans création, le marketplace Java reste vide (impossible de tester E2E). |
| **Cœur fonctionnel marketplace** | Sans S39, **AUCUN seller** ne peut publier en Java. Bloquant cutover absolu. |
| **Mono-fichier** | Tout dans `product_creation_routes.py` (568 lignes). Auto-suffisant. |
| **Réutilise S23 + S24** | `require_auth` (S23) + URLs d'images uploadées (S24). Pas de nouvelle infra. |
| **Slice fermée** | Les 3 endpoints couvrent le triptyque create/list/edit côté seller. Cohérent. |
| **Risque maîtrisé** | Pas de Stripe (les champs `stripe_product_id`/`stripe_price_id` sont NULL à la création — peuplés ultérieurement par admin/checkout). Pas de paiement. |

### Alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| Inclure DELETE + reactivate | Couple à `MediaPurgeWorker` (worker non documenté) + `pending_file_deletions` (table dédiée). Slice trop large. → S40+ |
| Inclure admin validation (`/admin/products/*`) | 206 lignes supplémentaires, workflow différent (review/reject). → S41+ |
| Faire uniquement POST sans GET | Casse le parcours édition (impossible de pré-remplir le formulaire pour modifier un brouillon). |
| Renommer le path en `/api/marketplace/products` | **Brise la compat front**. Le mobile/web actuel appelle `/api/products`. À ne pas faire. |

---

## Critère de fin de slice

- [ ] 3 endpoints Java fonctionnels avec parité 100% comportementale
- [ ] UPSERT correct (INSERT si nouveau, UPDATE si existant + ownership)
- [ ] Garde anti-downgrade status (403)
- [ ] Validations `pending_review` rental + sale (errors[0] + details[])
- [ ] Bypass admin (auto `active`)
- [ ] Notif push admins fire-and-forget
- [ ] Snapshot `seller_name`/`seller_picture_url` à l'INSERT
- [ ] Atomicité documentée (préservée OU corrigée explicitement)
- [ ] Helper `_delivery_modes` fallback (`local_pickup` par défaut)
