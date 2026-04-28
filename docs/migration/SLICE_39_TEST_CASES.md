# SLICE_39_TEST_CASES.md — Cas de test Marketplace création produit
> Basé sur `routes/product_creation_routes.py:1–568` + `SLICE_39_BUSINESS_RULES.md`.
> Généré le 2026-04-29.

---

## Convention IDs

- `T39-NN` = test case
- Préfixes : `POS` (POST), `MIN` (GET /mine), `DET` (GET /detail)

---

## Endpoint 1 — `POST /api/products`

### Nominal — création

| ID | Cas | Body | Attendu |
|---|---|---|---|
| **T39-POS-01** | Création minimale brouillon (rental) | `{title:"X", description:"<30+ chars>", product_type:"rental"}` | 200 ; `{product_id:"prod_...", status:"draft"}` ; INSERT row avec defaults (currency=EUR, available_quantity=1, condition_label="good", location_privacy="100m", radius_km=0.1, status="draft", skill_level="tous") |
| **T39-POS-02** | Création minimale brouillon (sale) | `{title:"X", description:"<30+>", product_type:"sale"}` | 200 ; row insérée avec `product_type="sale"` |
| **T39-POS-03** | Création complète draft (45+ champs) | tous champs valides | 200 ; tous les champs persistés correctement (incluant arrays `tag_ids`, `image_urls`, `pricing_modes`) |
| **T39-POS-04** | Création directe en `pending_review` (rental valide) | tous champs requis BR-39.06 communs + rental | 200 ; `status:"pending_review"` ; **push admins envoyé** (vérifier mock) |
| **T39-POS-05** | Création directe en `pending_review` (sale valide) | tous champs requis BR-39.06 communs + sale | 200 ; `status:"pending_review"` ; push admins |
| **T39-POS-06** | Admin crée en `pending_review` | user.role=admin + body.status=pending_review | 200 ; **`status:"active"`** (BR-39.05) ; **AUCUN push admin** |
| **T39-POS-07** | Création avec `price = "12,50"` (virgule) | `{price:"12,50",...}` | 200 ; `price = 12.50` en base (BR-39.11) |
| **T39-POS-08** | Création avec `available_quantity = 0` | `{available_quantity:0,...}` | 200 ; row avec `available_quantity = 1` (max(1,0), BR-39.12) |
| **T39-POS-09** | Création avec `cover_image_url` absent + `image_urls=["a","b"]` | — | 200 ; `cover_image_url = "a"` (fallback BR-39.13) |
| **T39-POS-10** | Création avec `delivery_modes` absent + `pickup_type="local_pickup"` | — | 200 ; `delivery_modes = ["local_pickup"]` (helper) |
| **T39-POS-11** | Création avec `delivery_modes` absent + `pickup_type="creator_handoff"` | — | 200 ; `delivery_modes = ["creator_handoff"]` |
| **T39-POS-12** | Création avec `delivery_modes` absent + `pickup_type=null` | — | 200 ; `delivery_modes = ["local_pickup"]` (default) |
| **T39-POS-13** | Création snapshot seller_name (full_name présent) | user.full_name="Jean", user.username="jean42" | INSERT `seller_name="Jean"` |
| **T39-POS-14** | Création snapshot seller_name (full_name vide) | user.full_name=null, user.username="jean42" | INSERT `seller_name="jean42"` |
| **T39-POS-15** | Création snapshot seller_name (les deux vides) | user.full_name=null, user.username=null | INSERT `seller_name="Utilisateur"` |
| **T39-POS-16** | Création avec `body.product_id` fourni (id absent en DB) | `{product_id:"prod_custom123",...}` | 200 ; INSERT avec ce product_id custom |

### Nominal — édition

| ID | Cas | Setup | Body | Attendu |
|---|---|---|---|---|
| **T39-POS-20** | UPDATE brouillon (owner) | row existe seller_id=ME, status=draft | `{product_id:..., title:"new"}` | 200 ; UPDATE appliqué |
| **T39-POS-21** | UPDATE pending_review → reste pending_review | row status=pending_review | `{product_id:..., status:"pending_review", title:"new"}` | 200 ; UPDATE OK ; **push admins ré-envoyé** (le code ne dédupe pas) |
| **T39-POS-22** | UPDATE active → reste active (admin) | row status=active, user=admin | `{product_id:..., status:"pending_review",...}` | 200 ; status reste "active" (auto-bumpé) |
| **T39-POS-23** | UPDATE atomicité — `price_per_session` | row existe | `{product_id:..., price_per_session:"15,00"}` | 200 ; UPDATE séparé applique 15.0 |
| **T39-POS-24** | UPDATE atomicité — `brand/model/weight` | — | `{product_id:..., brand:"Trek", model:"Domane"}` | 200 ; UPDATE séparé applique |
| **T39-POS-25** | UPDATE atomicité — `location_address_raw` | — | `{product_id:..., location_address_raw:" 12 rue X "}` | 200 ; row avec `"12 rue X"` (strip) |
| **T39-POS-26** | UPDATE — `location_address_raw=""` | — | `{product_id:..., location_address_raw:""}` | 200 ; row avec `null` |

### Erreurs validation minimale (400)

| ID | Cas | Body | Attendu |
|---|---|---|---|
| **T39-POS-30** | `title` vide | `{title:"", description:"<30+>", product_type:"rental"}` | **400** ; `{"error":"Le titre est obligatoire."}` |
| **T39-POS-31** | `title` whitespace | `{title:"   ",...}` | **400** ; même message |
| **T39-POS-32** | `title` absent | `{description:"<30+>", product_type:"rental"}` | **400** ; même message |
| **T39-POS-33** | `product_type` invalide | `{title:"X", description:"<30+>", product_type:"foo"}` | **400** ; `{"error":"Type de produit invalide. Types supportés : rental, sale."}` |
| **T39-POS-34** | `description` < 30 chars | `{title:"X", description:"trop court", product_type:"rental"}` | **400** ; `{"error":"La description est obligatoire (minimum 30 caractères)."}` |
| **T39-POS-35** | `description` whitespace seulement | `{description:"     ",...}` | **400** ; même message |

### Erreurs validation pending_review (422)

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T39-POS-40** | `pending_review` sans `category` (rental) | tous valides sauf `category=""` | **422** ; `{"error":"La catégorie du matériel est obligatoire.","details":["La catégorie..."]}` |
| **T39-POS-41** | `pending_review` sans `tag_ids` | tous valides sauf `tag_ids=[]` | **422** ; "Sélectionne au moins un tag pour publier le produit." |
| **T39-POS-42** | `pending_review` sans `condition_label` | tous valides sauf `condition_label=""` | **422** ; "L'état du matériel est obligatoire." |
| **T39-POS-43** | `pending_review` sans `image_urls` | tous valides sauf `image_urls=[]` | **422** ; "Au moins une photo est requise." |
| **T39-POS-44** | `pending_review` rental sans price | `price=0` | **422** ; "Le prix doit être supérieur à 0." |
| **T39-POS-45** | `pending_review` rental sans `pickup_type` | — | **422** ; "Le mode de remise du matériel est obligatoire." |
| **T39-POS-46** | `pending_review` rental session sans spotyou | `pricing_modes=["session"]`, `related_spotyou_ids=[]` | **422** ; "La tarification par séance nécessite de sélectionner au moins un SpotYou." |
| **T39-POS-47** | `pending_review` rental deposit sans amount | `deposit_required=true`, `deposit_amount=null` | **422** ; "Le montant de la caution est obligatoire si une caution est requise." |
| **T39-POS-48** | `pending_review` rental deposit avec amount=0 | `deposit_required=true`, `deposit_amount=0` | **422** ; même message |
| **T39-POS-49** | `pending_review` sale sans price | `product_type=sale`, `price=0` | **422** ; "Le prix de vente doit être supérieur à 0." |
| **T39-POS-50** | `pending_review` sale sans pickup | `product_type=sale`, `pickup_type=""` | **422** ; "Le mode de remise est obligatoire." (libellé sale ≠ rental) |
| **T39-POS-51** | `pending_review` sale `available_quantity = 0` | — | **422** ; "La quantité disponible doit être au minimum 1." OU pas — vérifier ordre (Python force `max(1,...)`) |
| **T39-POS-52** | `pending_review` 5 erreurs simultanées | category="", tags=[], cond="", desc<30, images=[] | **422** ; `error` = première (catégorie) ; `details` = 5 entrées dans l'ordre exact |

> ⚠️ Test T39-POS-52 : préserver l'**ordre exact** des messages (BR-39.06).

### Erreurs auth (401) & ownership (403)

| ID | Cas | Attendu |
|---|---|---|
| **T39-POS-60** | Sans Authorization header | **401** |
| **T39-POS-61** | JWT expiré | **401** |
| **T39-POS-62** | JWT autre user (UPDATE d'un produit non-owner) | INSERT silencieux (existing=null car SELECT ownership KO) — comportement compat à préserver |
| **T39-POS-63** | UPDATE d'un produit `status="active"` avec `body.status="draft"` | **403** ; `{"detail":"Impossible de repasser en brouillon : ce produit a déjà été soumis ou validé."}` (clé `detail`, pas `error` !) |
| **T39-POS-64** | UPDATE d'un produit `status="rejected"` avec `body.status="draft"` | **403** (rejected ∉ {draft, NULL}) |
| **T39-POS-65** | UPDATE d'un produit `status="pending_review"` avec `body.status="pending_review"` | **200** (pas de downgrade) |
| **T39-POS-66** | UPDATE d'un produit `status="draft"` avec `body.status="draft"` | **200** (draft → draft autorisé) |

### Effets de bord

| ID | Cas | Vérification |
|---|---|---|
| **T39-POS-70** | Push admins envoyé en `pending_review` non-admin | Mock `send_push_to_user` appelé N fois (N = nb admins) |
| **T39-POS-71** | Push admins NON envoyé en draft | Mock `send_push_to_user` jamais appelé |
| **T39-POS-72** | Push admins NON envoyé si user=admin | Mock jamais appelé |
| **T39-POS-73** | Atomicité — INSERT principal échoue | Aucun row inséré (transaction principale rollback) |
| **T39-POS-74** | Atomicité — UPDATE annexe `price_per_session` échoue | Row existe avec champs principaux (anomalie compat — Java doit décider) |

---

## Endpoint 2 — `GET /api/products/mine`

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T39-MIN-01** | User sans produit | aucun row seller_id=ME | 200 ; `{products:[], count:0}` |
| **T39-MIN-02** | User avec 3 produits actifs | 3 rows status=active | 200 ; `count:3` ; ordre `created_at DESC` |
| **T39-MIN-03** | Mix draft + active + pending_review | 1 draft + 1 active + 1 pending | 200 ; 3 produits remontés |
| **T39-MIN-04** | Produit deleted exclu | 1 active + 1 deleted | 200 ; `count:1` (deleted filtré) |
| **T39-MIN-05** | Produit `product_type` autre exclu | 1 rental + 1 type="service" legacy | 200 ; `count:1` (service filtré, BR-39.17) |
| **T39-MIN-06** | Sans Authorization | — | **401** |
| **T39-MIN-07** | JWT autre user | seller_id=OTHER 5 rows | 200 ; `count:0` (filtre `seller_id=ME`) |
| **T39-MIN-08** | Champs sérialisés | row avec timestamps | 200 ; `created_at`, `updated_at` au format ISO 8601 (`_clean()`) |
| **T39-MIN-09** | Wrapper format | — | 200 ; clé racine `products`, clé `count` (pas array racine direct, BR-39.18) |
| **T39-MIN-10** | Champs **non** retournés | — | Pas de `lat`, `lng`, `pickup_notes`, `included_items`, `size_dimensions`, `return_rules`, `cancellation_rules`, `availability_note`, `location_address_raw`, `tag_ids` (subset volontaire) |

---

## Endpoint 3 — `GET /api/products/{product_id}/detail`

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T39-DET-01** | Détail produit owner | row existe seller_id=ME | 200 ; tous les 44 champs présents |
| **T39-DET-02** | Détail produit autre user | row seller_id=OTHER | **404** ; `{"error":"Produit introuvable ou accès refusé."}` |
| **T39-DET-03** | Détail produit deleted | row status=deleted seller_id=ME | **404** (filtre `status != 'deleted'`) |
| **T39-DET-04** | Produit inexistant | id `prod_xxx` non DB | **404** |
| **T39-DET-05** | Sans Authorization | — | **401** |
| **T39-DET-06** | Format réponse direct (pas wrapper) | row existe | 200 ; clé racine = `product_id`, `title`, ... (PAS `{product:{...}}`) |
| **T39-DET-07** | Champs édition présents | row avec lat/lng/tag_ids/etc | 200 ; tous champs édition retournés (lat, lng, pickup_notes, tag_ids, location_address_raw...) |
| **T39-DET-08** | Datetime sérialisé ISO | — | `created_at` au format ISO 8601 avec timezone |

---

## Cas limites & pièges

| ID | Cas | Attendu |
|---|---|---|
| **T39-EDGE-01** | `body` JSON vide `{}` | **400** ; "Le titre est obligatoire." |
| **T39-EDGE-02** | `body` invalide (pas JSON) | 400/422 selon FastAPI default ; Java doit retourner 400 |
| **T39-EDGE-03** | `tag_ids` avec doublons `["t1","t1","t2"]` | 200 ; persisté tel quel (pas de dedup côté serveur) |
| **T39-EDGE-04** | `image_urls` avec 50 entrées | 200 ; persisté tel quel (pas de limite côté serveur — limite UX front) |
| **T39-EDGE-05** | `price = "1e10"` | 200 ; `price = 10000000000.0` (float parse OK) |
| **T39-EDGE-06** | `price = "abc"` | 200 ; `price = 0.0` (fallback) ; **MAIS** échouera validation `pending_review` "Le prix doit être > 0." |
| **T39-EDGE-07** | `available_quantity = "12.5"` | 200 ; `available_quantity = 1` (int() raise → fallback) |
| **T39-EDGE-08** | `available_quantity = -5` | 200 ; `available_quantity = max(1, -5) = 1` |
| **T39-EDGE-09** | `currency = "ZAR"` | 200 ; persisté (pas de whitelist) |
| **T39-EDGE-10** | `radius_km = 0` | 200 ; persisté tel quel |
| **T39-EDGE-11** | UPSERT avec `body.product_id` d'un produit autre user | INSERT silencieux (le SELECT existence avec `seller_id=ME` ne trouve rien) — un nouveau row est créé pour ME avec ce product_id ! ⚠️ **collision PK probable** ; Java doit gérer (UNIQUE constraint → 409 ou rollback) |
| **T39-EDGE-12** | UPSERT avec `body.product_id` malformé `"foo"` (sans préfixe `prod_`) | 200 ; INSERT créé tel quel (pas de validation préfixe) |
| **T39-EDGE-13** | Body `description` exactement 30 chars | 200 ; pas d'erreur (`>= 30`) |
| **T39-EDGE-14** | Body `description` 29 chars | 400 ; "minimum 30 caractères" |

> ⚠️ T39-EDGE-11 : ce cas révèle une **vulnérabilité Python** (pas un problème Java). Si user A connaît le `product_id` de user B et l'envoie en POST avec ses propres données, Python crée un nouveau row pour A avec **le même `product_id`** que B. Cela violerait `PRIMARY KEY` → la DB rejette. Java doit traduire l'erreur SQL en **409 Conflict**.

---

## Tests d'intégration / E2E

| ID | Cas | Setup |
|---|---|---|
| **T39-INT-01** | Flow complet : POST draft → GET /mine → GET /detail → POST update → POST submit pending_review | Vérifier cohérence des 4 étapes |
| **T39-INT-02** | Flow admin : POST pending_review → produit visible dans `/api/marketplace/products` (S38) | Auto-publish vérifié end-to-end |
| **T39-INT-03** | Flow validation : POST pending_review (non-admin) → notif push → GET /mine retourne `status:"pending_review"` | Push admin reçu |
| **T39-INT-04** | Flow images : `image_urls=["url1","url2","url3"]` → `cover_image_url` auto-fixé à url1 | — |
| **T39-INT-05** | Flow URL marketplace : POST + S38 GET → produit apparaît avec `seller_name` snapshot | Cohérence cross-slice |

---

## Couverture totale

- **65+ cas de test** (POS: 50, MIN: 10, DET: 8, EDGE: 14, INT: 5)
- **Régressions S38** : T39-INT-02 et T39-INT-05 valident la cohérence avec la slice précédente.
- **Régressions S23** : T39-POS-60 et T39-POS-61 valident `require_auth`.
- **Régressions S24** : T39-INT-04 valide la consommation des URLs uploadées.
