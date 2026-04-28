# SLICE_38_SCOPE.md — Cadrage de la Slice 38 (Marketplace — première slice)
> Basé sur `routes/marketplace_routes.py:1–267`.
> Généré le 2026-04-28.

---

## Endpoint choisi (1) — `GET /api/marketplace/products`

| # | Méthode | Chemin API | Auth | Complexité | Fichier : Lignes |
|---|---|---|---|---|---|
| 1 | GET | `/api/marketplace/products` | **PUBLIC** (pas de `require_auth`) | **MOYENNE-ÉLEVÉE** | `marketplace_routes.py` : 1–267 |

> **Note : c'est la première slice PUBLIQUE migrée.** Toutes les slices précédentes (S30, S31, S33, S34, S35, S11) exigeaient JWT. S38 est consultable sans token (front anonyme browse marketplace).

### Périmètre fonctionnel exact

L'endpoint retourne **un mélange** de :
1. **Produits** (`marketplace_products` table, `status='active'`)
2. **Services** (`services` table, `active=TRUE`) — UNIQUEMENT si tags fournis
3. **Enrichissements** : distance Haversine, badges `owner`/`other`, `seller_stats` (ratings + counts produits/services/spotyou)
4. **Tri** : owner-first (si `spotyou_id` ou `tag_ids`) puis `created_at DESC`

### Branchement par paramètres

| `tag_ids` | `spotyou_id` | Comportement |
|---|---|---|
| (absent) | (absent) | Mode "feed" : produits actifs LIMIT 20, sans services, sans owner |
| présent | absent | Filtre par tags (products `&&` array overlap, services `?|` JSONB) |
| absent | présent | Lookup `tag_points` → résout tags + owner_id + GPS du SpotYou |
| présent | présent | Tags utilisateur prioritaires, owner_id et GPS du SpotYou |
| (vide) | (vide) après resolve | Si `filter_requested=True` mais aucun tag → retourne `[]` |

### Endpoints HORS S38

| Endpoint Python | Lignes | Fichier | Slice future |
|---|---|---|---|
| Routes création produit | toutes | `routes/product_creation_routes.py` (567 lignes) | S39+ (writes) |
| Routes admin produits | toutes | `routes/admin_product_routes.py` (206 lignes) | S40+ (admin) |
| Détail produit single (`GET /products/{id}`) | **N'EXISTE PAS** publiquement | — | — |

> ⚠️ **Constat** : le code Python actuel **n'expose pas** d'endpoint `GET /api/marketplace/products/{product_id}` ni `GET /api/products/{product_id}` côté public. Le front travaille uniquement avec la liste enrichie. **Compat stricte = ne pas inventer cet endpoint.** Si le front a besoin du détail, c'est une demande produit hors-scope.

---

## Pourquoi cette slice — Justification

| Critère | Justification |
|---|---|
| **Premier endpoint marketplace utile au front** | C'est **le seul endpoint public marketplace**. Sans S38, le front n'affiche **rien** dans le marketplace côté Java. Bloqueur cutover. |
| **Public = simplifie auth** | Pas de gestion JWT pour cette slice. Configuration Spring `permitAll` suffit. **Bonne première slice marketplace** car aucune dépendance auth lourde. |
| **Mini-slice cohérente** | 1 endpoint, ~267 lignes Python, **tout dans un seul fichier**. Auto-suffisant. |
| **Combine plusieurs patterns réutilisables** | Filtre tags array/JSONB, JOIN seller, calcul Haversine, parallélisme `asyncio.gather` → `CompletableFuture`. Pattern réutilisable pour futures slices marketplace. |
| **Pas d'écriture, pas de Stripe** | Lecture pure. Risque métier minimal. |
| **Visible côté UX** | Le front affiche le marketplace en page d'accueil ou onglet dédié. Migrer S38 = écran complet fonctionnel. |

### Alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| **Détail produit `/products/{id}`** | N'existe pas publiquement côté Python. Inventer = casser compat. |
| **Routes création produit (`product_creation_routes.py`)** | 567 lignes, écriture, upload images, validation tags, conditions multi-modes. Trop gros pour première slice. |
| **Admin product routes** | Domaine admin séparé, peu prioritaire pour le front buyer. |
| **Bundle marketplace + services dédiés (`/api/services` séparé)** | Pas d'endpoint `/api/services` séparé en public ; les services sortent **uniquement** via `/marketplace/products` quand tags fournis. |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `routes/marketplace_routes.py` | 1–28 | Helpers `haversine`, `fmt_dist`, constante `MAX_DIST_KM` |
| `routes/marketplace_routes.py` | 31–145 | Endpoint + section produits (filtre tags + LEFT JOIN users + boucle enrichissement) |
| `routes/marketplace_routes.py` | 146–177 | Section services coach (uniquement si tags) |
| `routes/marketplace_routes.py` | 178–266 | Merge owner-first + 4 SELECT seller_stats parallèles |
| `database.py` | 68 (`rows_to_list`) | Conversion asyncpg Records → list[dict] |

---

## Dépendances

| Dépendance | Type | Obligatoire |
|---|---|---|
| Table `marketplace_products` | DB SELECT | OUI |
| Table `services` | DB SELECT | OUI (cas tags) |
| Table `users` | DB LEFT JOIN | OUI (seller/coach name+picture) |
| Table `tag_points` | DB SELECT | OUI (resolve `spotyou_id`) |
| Table `reviews` | DB SELECT | OUI (seller_stats) |
| **PostGIS** (`ST_Y`, `ST_X`) | extension | OUI (resolve GPS depuis `tag_points.location`) |
| Pas de Stripe | — | — |
| Pas de fichier .env spécifique | — | — |

---

## Niveau de risque

**MOYEN-ÉLEVÉ.**

| Point | Risque | Impact Java |
|---|---|---|
| **Endpoint PUBLIC** (pas de JWT) | MOYEN | Premier endpoint sans auth. Configurer Spring Security `permitAll` strict sur ce path. Pas de leak ; tous les filtres sont sur `status='active'`. |
| **Filtre tags : `&&` array vs `?|` JSONB** | ÉLEVÉ | `marketplace_products.tag_ids` = TEXT[] (`&&` opérateur array overlap). `services.tag_ids` = JSONB (`?|` contains-any). **Native query obligatoire** — JPQL ne supporte pas. Reproduire les 2 syntaxes distinctes. |
| **PostGIS `ST_Y(location::geometry)`** | ÉLEVÉ | `tag_points.location` est probablement `geography` PostGIS. Java/Hibernate-spatial ou native query avec `ST_Y` extract. **Vérifier le type de colonne**. |
| **`asyncio.gather` 4 SELECT parallèles** | MOYEN | Java : `CompletableFuture.allOf(...).join()` ou `@Async` Spring. **Performance critique** : sans parallélisme, l'endpoint est 4x plus lent. |
| **Calcul Haversine R=6371, round(.., 1)** | MOYEN | Formule à reproduire pour la précision UX. **Tester sur un point connu** (Paris ↔ Lyon ≈ 391.5 km). |
| **`fmt_dist` format string** | FAIBLE | `"300 m"` (< 1 km) ou `"1.2 km"`. Locale-independent (point décimal). |
| **Owner-first sorting** | MOYEN | `ORDER BY CASE WHEN seller_id=$2 THEN 0 ELSE 1 END, created_at DESC` — fonctionne SQL-side. Puis re-tri applicatif après merge products+services. **Reproduire les 2 niveaux**. |
| **Aucune pagination explicite si tags fournis** | MOYEN | Quand `tag_ids` présent, **pas** de LIMIT. Réponse peut être grosse. **Compat stricte = ne pas ajouter de pagination**. |
| **`filter_requested=True` + tags vide → `[]`** | MOYEN | Si `spotyou_id` invalide ou tag_points sans tag_ids → renvoie liste vide (pas 404). |
| **Conversion `Decimal('price')` → `float`** | FAIBLE | Reproduire (compat S34). |
| **`tag_ids` TEXT[] vs JSONB string** | MOYEN | `marketplace_products.tag_ids` est TEXT[] natif (pas string JSON). `services.tag_ids` peut être JSONB string ou parsed selon row. Code Python `json.loads if isinstance(str)` pour services. |
| **`images` services (string JSON ou list)** | FAIBLE | Idem `_deserialize` pattern (S11/S34). |

---

## Résumé ultra court

- **Endpoints choisis (1)** :
  - `GET /api/marketplace/products?tag_ids=...&spotyou_id=...&user_lat=...&user_lng=...` — **PUBLIC** (pas de JWT)
  - **Pas de `GET /products/{id}` détail** (n'existe pas en Python ; ne pas inventer)

- **Tables touchées (READ uniquement)** :
  - `marketplace_products` (SELECT avec filtre tags array `&&`)
  - `services` (SELECT avec filtre tags JSONB `?|`)
  - `users` (LEFT JOIN seller/coach)
  - `tag_points` (resolve `spotyou_id` + PostGIS GPS)
  - `reviews`, `marketplace_products` (count), `services` (count), `tag_points` (count) — 4 SELECT parallèles pour seller_stats

- **Top 3 pièges** :
  1. **Filtre tags 2 syntaxes différentes** : `tag_ids && $1::text[]` (array overlap) pour `marketplace_products` (TEXT[]) et `tag_ids ?| $1::text[]` (JSONB any-key) pour `services` (JSONB). **Native query obligatoire** ; ne pas tenter en JPQL/Criteria. Une syntaxe inversée = résultats vides ou erreurs SQL.
  2. **PostGIS `ST_Y` / `ST_X`** sur `tag_points.location` (type `geography`) pour récupérer `slat`/`slng` du SpotYou. Java : native query avec `ST_Y(location::geometry) AS slat`. **Hibernate-spatial** complique ; rester en native query.
  3. **Parallélisme `asyncio.gather` → `CompletableFuture`** : 4 SELECT seller_stats (ratings, products count, services count, spotyou count) doivent tourner en parallèle. Sinon endpoint 4x plus lent. Java : `CompletableFuture.allOf(f1, f2, f3, f4).thenApply(...)` ou `@Async` services.

- **Raison du choix** : C'est le **seul endpoint public marketplace** existant côté Python. Sans S38, le front n'a **rien** à afficher dans la section marketplace en mode Java. Première slice marketplace logique : **lecture pure, public (pas de JWT), 1 fichier, 267 lignes**. Pattern réutilisable (filtres tags array/JSONB, distance, owner-first, parallélisme stats) pour futures slices marketplace (writes, admin). **Bloqueur cutover front** : un buyer non connecté doit pouvoir browser le marketplace dès son premier écran.
