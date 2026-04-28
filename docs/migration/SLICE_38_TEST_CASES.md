# SLICE_38_TEST_CASES.md — Cas de test Marketplace Products
> Basé sur `routes/marketplace_routes.py:1–267`, BR-38.01 à BR-38.18.
> Généré le 2026-04-28.

---

## Convention : `T38-<CASE>`

Total **30 cas**.

---

## 🟢 Nominal — Mode feed (sans paramètres)

### T38-01 — Pas de paramètre → 20 produits actifs récents

**Pré-conditions** : 25 produits actifs en DB, créés à des dates différentes.

**Action** : `GET /api/marketplace/products`.

**Résultat** :
- HTTP 200, `{"products": [...], "count": 20}`
- 20 items, tous `item_type="product"`
- Tri `created_at DESC`
- `seller_stats` présent pour chacun
- **Aucun service** dans la réponse

### T38-02 — Aucun produit actif → liste vide

**Setup** : seul des produits `status='draft'` ou `'sold'`.

**Résultat** : `{"products": [], "count": 0}`. HTTP 200.

### T38-03 — Mode feed sans badge owner

**Action** : T38-01.

**Assertion** : tous les `badge_type` = `"other"`. Aucun `"owner"`.

---

## 🟢 Nominal — Filtre tags

### T38-04 — `tag_ids=tag1,tag2` filtre array overlap

**Pré-conditions** :
- prod_A.tag_ids = `['tag1', 'tag3']` → match
- prod_B.tag_ids = `['tag2']` → match
- prod_C.tag_ids = `['tag9']` → ne match pas

**Action** : `GET /api/marketplace/products?tag_ids=tag1,tag2`.

**Résultat** : 2 items (prod_A, prod_B). prod_C absent.

### T38-05 — `tag_ids=tag1` retourne aussi services

**Pré-conditions** : svc_X.tag_ids JSONB = `["tag1"]`.

**Action** : `GET /api/marketplace/products?tag_ids=tag1`.

**Résultat** : products + services mélangés. svc_X présent avec `item_type="service"`.

### T38-06 — `tag_ids=` (vide) → équivalent à pas de tag_ids

**Action** : `GET /api/marketplace/products?tag_ids=`.

**Résultat** : mode feed (parsing CSV produit liste vide → `filter_requested=False` car `bool(None or "")` = False).

> ⚠️ Vérifier comportement exact : `tag_ids=""` peut activer `filter_requested=True` selon parsing FastAPI. **À tester précisément.**

### T38-07 — `tag_ids=tag1,,tag2` (vide intermédiaire)

**Action** : tag_ids = `"tag1,,tag2"`.

**Résultat** : Parsing trim+filter → `["tag1", "tag2"]`. Comportement T38-04.

---

## 🟢 Nominal — `spotyou_id`

### T38-08 — `spotyou_id` valide → resolve tags + GPS + owner

**Pré-conditions** :
- tag_points.point_id="pt_001", user_id="u_creator", location=(48.8, 2.3), tag_ids=`["sport"]`
- prod_A.tag_ids=`["sport"]`, seller_id="u_creator" → owner
- prod_B.tag_ids=`["sport"]`, seller_id="u_other"
- prod_C.tag_ids=`["other"]` → ne match pas

**Action** : `GET /api/marketplace/products?spotyou_id=pt_001`.

**Résultat** :
- 2 items (prod_A, prod_B)
- prod_A en première position avec `badge_type="owner"`, `badge_label="Créateur du SpotYou"`
- prod_B avec `badge_type="other"`
- prod_A et prod_B ont `dist_from_spotyou` et `dist_from_spotyou_fmt` si GPS présents

### T38-09 — `spotyou_id` invalide → liste vide

**Setup** : spotyou_id="pt_doesnt_exist".

**Action** : GET avec ce param.

**Résultat** : `tags=[]`, `filter_requested=True` → renvoie `{"products":[], "count":0}`. **Pas 404**.

### T38-10 — `tag_ids` + `spotyou_id` : tags utilisateur prioritaires

**Pré-conditions** : tag_points.tag_ids=`["sport"]`. Action avec `tag_ids=other`.

**Résultat** : utilise `["other"]` (priorité user), pas `["sport"]`. owner_id récupéré quand même de tag_points.

---

## 🟢 Nominal — Distances Haversine

### T38-11 — Distance Paris → Lyon ≈ 391.5 km

**Setup** : product.lat=45.764, lng=4.8357 (Lyon). user_lat=48.8566, user_lng=2.3522 (Paris).

**Action** : GET `/api/marketplace/products?tag_ids=t&user_lat=48.8566&user_lng=2.3522`.

**Assertion** : product.dist_from_user ≈ 391.5, dist_from_user_fmt = `"391.5 km"`.

### T38-12 — Distance < 1 km → format mètres

**Setup** : 0.3 km calculé.

**Assertion** : `dist_from_user_fmt = "300 m"` (int * 1000).

### T38-13 — Distance exactement 1.0 km

**Assertion** : `"1.0 km"` (pas `"1000 m"`).

### T38-14 — Pas de calcul si pas de GPS user

**Setup** : `user_lat=null, user_lng=null`. Product avec lat/lng.

**Assertion** : `dist_from_user` et `dist_from_user_fmt` **ABSENTS** de la réponse.

### T38-15 — `is_physical=false` si product sans lat/lng

**Setup** : product.lat=null, lng=null.

**Assertion** : `is_physical=false`. Aucun champ `dist_*`.

### T38-16 — Service toujours `is_physical=false` (asymétrie)

**Setup** : svc avec address mais pas de lat/lng (services n'a pas ces colonnes).

**Assertion** : `is_physical=false`. Pas de distance.

---

## 🟢 Nominal — Owner-first sorting

### T38-17 — Owner products + owner service viennent en premier

**Setup** :
- prod_owner (seller=u_creator), prod_other_1, prod_other_2
- svc_owner (coach=u_creator)

**Action** : avec `spotyou_id` qui résout `owner_id=u_creator`.

**Résultat ordre** : prod_owner, svc_owner, prod_other_1, prod_other_2 (ou inverse svc/prod selon création).

> ⚠️ Le re-tri post-merge applicatif assure que **tous** les owner viennent avant tous les other. Test critique BR-38.06.

---

## 🟢 Nominal — `seller_stats`

### T38-18 — Seller avec ratings et 5 produits

**Setup** :
- u_seller a 3 reviews (rating moyen 4.7), 5 produits, 0 services, 1 spotyou

**Action** : product de u_seller dans la réponse.

**Assertion `seller_stats`** :
```json
{ "rating_avg": 4.7, "rating_count": 3, "products_count": 5, "services_count": 0, "spotyou_count": 1 }
```

### T38-19 — Seller sans aucune review

**Setup** : u_seller sans review.

**Assertion** : `rating_avg: null`, `rating_count: 0`, `products_count` non-zero.

### T38-20 — Stats parallélisme : 4 SELECT exécutés simultanément

**Setup** : monitor SQL queries exécutées.

**Assertion** : Les 4 SELECT (ratings, prod_cnt, svc_cnt, spot_cnt) démarrent dans une fenêtre < 50ms (parallélisme effectif).

> Test perf, pas critique pour validité fonctionnelle.

---

## 🟢 Nominal — Désérialisation services

### T38-21 — Service `tag_ids` JSONB string

**Setup** : svc.tag_ids stocké comme `'["sport"]'` (TEXT JSON).

**Assertion réponse** : `tag_ids: ["sport"]` (parsed array, pas string).

### T38-22 — Service `images` JSONB string

**Setup** : svc.images = `'["url1","url2"]'`.

**Assertion** : `images: ["url1","url2"]`.

### T38-23 — Service `tag_ids` null → `[]`

**Assertion** : `tag_ids: []`. Pas null.

---

## 🔴 Cas robustesse / format

### T38-24 — Endpoint PUBLIC (pas de header Auth)

**Action** : GET sans `Authorization` ni cookie.

**Résultat** : 200, pas 401.

### T38-25 — Endpoint avec JWT valide → identique

**Action** : GET avec `Authorization: Bearer <jwt>`.

**Résultat** : 200, **mêmes données** que sans JWT (l'auth n'est pas utilisée).

### T38-26 — Format datetime `+00:00`

**Assertion** : tous les `created_at`, `updated_at` au format `2026-04-20T11:37:13.540123+00:00`. **Pas `Z`**.

### T38-27 — `price` number (pas string)

**Assertion** : `price` est number JSON, pas string. Compat S34.

### T38-28 — `seller_picture` ET `seller_picture_url` doublon présents

**Assertion** : les 2 clés présentes avec valeur identique (`u.picture`).

---

## 🔴 Compat stricte

### T38-29 — Wrapper `{products, count}` (pas array direct)

**Assertion** : body commence par `{`, contient `"products"` et `"count"` à la racine.

> ⚠️ Différent de S34/S11 qui retournaient des listes directes. Compat stricte.

### T38-30 — `count` = `len(products)` strict

**Assertion** : `body.count === body.products.length`.

---

## Matrice de couverture

| Axe | Cas |
|---|---|
| Mode feed | T38-01, T38-02, T38-03 |
| Filtre tags | T38-04 à T38-07 |
| spotyou_id | T38-08, T38-09, T38-10 |
| Distances Haversine | T38-11 à T38-16 |
| Owner-first | T38-17 |
| seller_stats | T38-18, T38-19, T38-20 |
| Désérialisation services | T38-21, T38-22, T38-23 |
| Public auth | T38-24, T38-25 |
| Format strict | T38-26 à T38-30 |

**Total : 30 cas.**

---

## Notes runner Java

- **Testcontainers PostgreSQL + extension PostGIS** :
  ```yaml
  image: postgis/postgis:14-3.3
  ```
- **Seeders** : products avec `tag_ids = ARRAY['sport']::text[]`, services avec `tag_ids = '["sport"]'::jsonb`
- **Asserter wrapper** :
  ```java
  JsonNode body = mapper.readTree(response);
  assertThat(body.get("products").isArray()).isTrue();
  assertThat(body.get("count").asInt()).isEqualTo(body.get("products").size());
  ```
- **Test Haversine** : Paris↔Lyon attendu 391.5±0.5
- **Test owner-first** :
  ```java
  List<JsonNode> items = StreamSupport.stream(body.get("products").spliterator(), false).toList();
  // Vérifier que tous les "owner" précèdent les "other"
  int firstOther = -1;
  for (int i = 0; i < items.size(); i++) {
      if ("other".equals(items.get(i).get("badge_type").asText())) { firstOther = i; break; }
  }
  for (int i = firstOther + 1; i < items.size(); i++) {
      assertThat(items.get(i).get("badge_type").asText()).isNotEqualTo("owner");
  }
  ```
- **Test parallélisme** : utiliser un `@Spy` sur le repo + `verify(...).called` pour valider les 4 calls
- **Test PostGIS** : seeder `INSERT INTO tag_points (location) VALUES (ST_SetSRID(ST_MakePoint(2.35, 48.85), 4326))` puis valider que slat/slng sont récupérés
