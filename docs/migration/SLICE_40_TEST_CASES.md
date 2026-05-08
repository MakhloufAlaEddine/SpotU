# SLICE_40_TEST_CASES.md — Cas de test Marketplace lifecycle seller
> Basé sur `routes/product_creation_routes.py:459–556` + `media_purge_worker.py:1–127` + BUSINESS_RULES.
> Généré le 2026-04-30.

---

## Convention IDs

- `T40-DEL-NN` = DELETE
- `T40-REA-NN` = Reactivate
- `T40-WRK-NN` = Worker `MediaPurgeWorker`
- `T40-INT-NN` = Intégration / régression cross-slice

---

## Endpoint 1 — `DELETE /api/products/{product_id}`

### Nominal

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T40-DEL-01** | Delete d'un produit `active` (owner) | row status=active, seller=ME, image_urls=["u1","u2","u3"] | 200 ; `{ok:true, media_purge_scheduled_at: ISO}` ; row UPDATE → status="deleted", deleted_at=now, deleted_by=ME, media_purge_scheduled_at=now+90j ; 3 INSERT pending_file_deletions |
| **T40-DEL-02** | Delete d'un produit `draft` (owner) | row status=draft, seller=ME | 200 ; même comportement |
| **T40-DEL-03** | Delete d'un produit `pending_review` (owner) | row status=pending_review, seller=ME | 200 ; même comportement (pas de garde sur statut antérieur) |
| **T40-DEL-04** | Delete d'un produit `rejected` (owner) | row status=rejected, seller=ME | 200 ; même comportement |
| **T40-DEL-05** | Delete d'un produit avec 0 image | image_urls=[] | 200 ; **0 INSERT** pending_file_deletions ; UPDATE OK |
| **T40-DEL-06** | Delete d'un produit avec 20 images | image_urls=20 URLs | 200 ; **20 INSERTs** séquentiels (boucle) |
| **T40-DEL-07** | Delete d'un produit avec image_urls=NULL | row image_urls IS NULL | 200 ; boucle vide (`row["image_urls"] or []`) |
| **T40-DEL-08** | Delete avec `cover_image_url` HORS `image_urls[]` | cover="x", image_urls=["a","b"] | 200 ; **2 INSERTs** (a, b) ; cover "x" **NON** purgée (BR-40.04 anomalie) |
| **T40-DEL-09** | Delete avec URLs vides ou null dans le tableau | image_urls=["a", "", null, "b"] | 200 ; **2 INSERTs** (a, b) — filtre `if url:` |
| **T40-DEL-10** | Delete avec `image_urls` stocké en string JSON | row image_urls="[\"a\",\"b\"]" (legacy) | 200 ; parse `json.loads` → 2 INSERTs |
| **T40-DEL-11** | Delete avec `image_urls` stocké en string non-JSON | row image_urls="malformed" | 200 ; fallback try/except → 0 INSERT |

### Erreurs / non-owner

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T40-DEL-20** | Sans Authorization | — | **401** |
| **T40-DEL-21** | JWT expiré | — | **401** |
| **T40-DEL-22** | Delete d'un produit autre user | row seller=OTHER, status=active | **404** ; `{"error":"Produit introuvable ou non autorisé."}` (clé `error`, pas `detail`) |
| **T40-DEL-23** | Delete d'un produit inexistant | id `prod_xyz` non DB | **404** ; même message |
| **T40-DEL-24** | 2e Delete consécutif (idempotence) | row déjà status="deleted" | **404** ; même message (BR-40.10) |
| **T40-DEL-25** | Delete par admin sur produit d'un autre user | user.role=admin, seller=OTHER | **404** (pas de bypass admin sur DELETE — BR-40.02) |

### Effets de bord

| ID | Cas | Vérification |
|---|---|---|
| **T40-DEL-30** | Visibilité S38 | Après DELETE → `GET /marketplace/products` n'affiche plus le produit |
| **T40-DEL-31** | Visibilité S39 `/mine` | Après DELETE → `GET /products/mine` n'affiche plus le produit (filtre `status != 'deleted'`) |
| **T40-DEL-32** | Visibilité S39 `/detail` | Après DELETE → `GET /products/{id}/detail` retourne 404 (filtre `status != 'deleted'`) |
| **T40-DEL-33** | `media_purge_scheduled_at` exact | Vérifier `(now + 90j)` à la microseconde près (sauf marge ~1s pour test execution) |
| **T40-DEL-34** | `pending_file_deletions` `entity_type='product'` | Vérifier que toutes les rows insérées ont `entity_type='product'` |
| **T40-DEL-35** | `ON CONFLICT DO NOTHING` | Pas de crash si deuxième INSERT avec mêmes (file_url, entity_id) |

---

## Endpoint 2 — `POST /api/products/{product_id}/reactivate`

### Nominal — restauration totale (<90j)

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T40-REA-01** | Reactivate owner, médias intacts | row status=deleted, deleted_at=now-7j, media_purged=false, seller=ME | 200 ; `{ok:true, reactivated:true, product_id, media_purged:false, requires_media_reupload:false}` ; row UPDATE → status="active", deleted_at=NULL, deleted_by=NULL, media_purge_scheduled_at=NULL, media_purge_notified_at=NULL, reactivated_at=now |
| **T40-REA-02** | Reactivate owner, pending_file_deletions annulées | row + 3 entries pending_file_deletions status=pending | 200 ; **3 rows DELETEd** de pending_file_deletions |
| **T40-REA-03** | Reactivate owner, mix pending + processing | row + 2 pending + 1 processing dans pending_file_deletions | 200 ; **2 rows DELETEd** (pending only — BR-40.06) ; 1 processing reste |
| **T40-REA-04** | Reactivate par admin sur produit autre user | row deleted seller=OTHER, user.role=admin | 200 ; restauration OK (bypass admin — BR-40.05) |

### Nominal — restauration partielle (≥90j, médias purgés)

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T40-REA-05** | Reactivate après purge worker | row status=deleted, media_purged=true, media_purged_at=now-1j | 200 ; `{..., media_purged:true, requires_media_reupload:true}` ; UPDATE OK ; **`media_purged` reste TRUE** (BR-40.08) |
| **T40-REA-06** | Reactivate après purge — image_urls non vidées | row image_urls=["url1","url2"] (orphelines), media_purged=true | 200 ; row.image_urls reste `["url1","url2"]` (BR-40.09 — front gère 404) |
| **T40-REA-07** | Reactivate après purge owner sans admin | row media_purged=true, seller=ME | 200 ; bypass purge_worker compatible |

### Status transitions

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T40-REA-10** | Reactivate produit qui était `draft` | (ANOMALIE compat BR-40.07) avant DELETE row était draft | 200 ; row.status = **`active`** (pas restauré à `draft`) |
| **T40-REA-11** | Reactivate produit qui était `pending_review` | avant DELETE row était pending_review | 200 ; row.status = **`active`** (court-circuit modération — anomalie compat) |
| **T40-REA-12** | Reactivate produit qui était `rejected` | avant DELETE row était rejected | 200 ; row.status = **`active`** (BR-40.07) |

### Erreurs

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T40-REA-20** | Sans Authorization | — | **401** |
| **T40-REA-21** | Reactivate produit inexistant | id absent DB | **404** ; `{"detail":"Produit introuvable"}` (clé `detail`) |
| **T40-REA-22** | Reactivate produit non supprimé (status=active) | row status=active, deleted_at=NULL | **409** ; `{"detail":"Ce produit n'est pas supprimé"}` |
| **T40-REA-23** | Reactivate produit non supprimé (status=draft) | row status=draft | **409** ; même message |
| **T40-REA-24** | Reactivate produit en cours de purge | row deleted_at=now-89j, status=deleted, media_purged=false | 200 (encore <90j → restauration totale possible si on agit avant le worker) |
| **T40-REA-25** | 2e Reactivate consécutif | row déjà reactivated (status=active après 1er reactivate) | **409** (BR-40.11) |
| **T40-REA-26** | Reactivate non-owner non-admin | seller=OTHER, user.role=user | **403** ; `{"detail":"Non autorisé"}` |
| **T40-REA-27** | Reactivate avec `deleted_at IS NULL` mais `status='deleted'` | (incohérence DB rare) | **409** (la condition OR couvre) |

### Effets de bord

| ID | Cas | Vérification |
|---|---|---|
| **T40-REA-30** | Visibilité S38 | Après Reactivate → `GET /marketplace/products` ré-affiche le produit (status=active) |
| **T40-REA-31** | Visibilité S39 `/mine` | Après Reactivate → `GET /products/mine` ré-affiche le produit |
| **T40-REA-32** | Visibilité S39 `/detail` | Après Reactivate → `GET /products/{id}/detail` retourne 200 |
| **T40-REA-33** | `reactivated_at` peuplé | Vérifier `reactivated_at = now` (timestamp du reactivate, pas reset par DELETE ultérieur) |
| **T40-REA-34** | `pending_file_deletions` partiel | Si purge déjà en `processing`, ces rows ne sont PAS supprimées par Reactivate |

### Format JSON

| ID | Cas | Vérification |
|---|---|---|
| **T40-REA-40** | Format succès | `{"ok": true, "reactivated": true, "product_id": "...", "media_purged": bool, "requires_media_reupload": bool}` — 5 clés exactes |
| **T40-REA-41** | Format erreur | `{"detail": "..."}` (PAS `error`) |
| **T40-REA-42** | `requires_media_reupload == media_purged` | Toujours égaux (alias) |

---

## Worker `MediaPurgeWorker`

### Nominal

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T40-WRK-01** | Cycle horaire | row deleted_at=now-91j, media_purge_scheduled_at=now-1j, media_purged=false | UPDATE row.media_purged=TRUE, media_purged_at=now ; appel `run_purge(retention_days=0)` |
| **T40-WRK-02** | Skip media_purged déjà TRUE | row media_purged=true | UPDATE 0 row (idempotence) |
| **T40-WRK-03** | Skip status non-deleted | row status=active, deleted_at=NULL | UPDATE 0 row |
| **T40-WRK-04** | Skip reactivated_at >= deleted_at | row deleted_at=t1, reactivated_at=t2 (t2>t1) | UPDATE 0 row (idempotence triple) |
| **T40-WRK-05** | Process reactivated_at < deleted_at (re-DELETE après reactivate) | DELETE→REACTIVATE→DELETE : `reactivated_at=t2 < deleted_at=t3` | UPDATE row.media_purged=TRUE (worker traite la re-suppression) |
| **T40-WRK-06** | Cycle vide | aucun row éligible | UPDATE 0 row ; pas d'appel `run_purge` |
| **T40-WRK-07** | Cycle multi-rows | 5 rows éligibles | UPDATE 5 rows en 1 batch (`= ANY($2::text[])`) |

### Idempotence

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T40-WRK-10** | 2e cycle après 1er | rows déjà processed → media_purged=TRUE | 2e cycle UPDATE 0 row (filtre `media_purged=FALSE`) |
| **T40-WRK-11** | Reactivate entre 2 cycles | cycle1 marque media_purged=TRUE → reactivate → cycle2 | cycle2 ignore (BR-40.08 — media_purged reste TRUE après reactivate, donc filtre exclut) |

### Robustesse

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T40-WRK-20** | `run_purge` lève une exception | mock `run_purge` raise | **Pas de crash worker** ; log warning ; `media_purged=TRUE` quand même persisté (UPDATE déjà commit avant `run_purge`) — BR-40.14 |
| **T40-WRK-21** | DB error pendant SELECT | mock pool.fetch raise | log error ; pas de crash boucle ; cycle suivant retentera |
| **T40-WRK-22** | Stop signal | `worker.stop()` pendant cycle | Cycle en cours s'achève proprement ; pas de cycle suivant |
| **T40-WRK-23** | Cadence 3600s | mesurer interval entre 2 cycles | ≈ 3600s ± 1s |

---

## Régressions cross-slice

| ID | Cas | Vérification |
|---|---|---|
| **T40-INT-01** | DELETE → S38 catalogue masque | `GET /marketplace/products` n'affiche plus le produit (filtre `status='active'`) |
| **T40-INT-02** | DELETE → S39 `/mine` masque | `GET /products/mine` n'affiche plus le produit (filtre `status != 'deleted'`) |
| **T40-INT-03** | Reactivate → S38 catalogue ré-affiche | `GET /marketplace/products` ré-inclut le produit |
| **T40-INT-04** | Reactivate → S39 `/mine` ré-affiche | `GET /products/mine` ré-inclut le produit |
| **T40-INT-05** | DELETE puis tentative POST `body.product_id` (S39) | `POST /products` avec product_id supprimé → SELECT existence l. 233 retourne null (filtre WHERE seller_id KO ? **ATTENTION** : ce SELECT n'a PAS le filtre `status != 'deleted'` — pourrait permettre UPDATE d'un produit deleted) ; **bug latent à valider** : Java doit décider si autoriser ou bloquer. Compat = autoriser (mais alors DELETE peut être annulé sans Reactivate, contournant la planification purge). |
| **T40-INT-06** | DELETE compatible avec S39 anti-downgrade | DELETE puis Reactivate → produit en active ; tentative S39 POST avec body.status=draft → **403** (anti-downgrade BR-39.08 fonctionne sur le produit reactivated) |
| **T40-INT-07** | Soumission pending_review puis DELETE | row status=pending_review → DELETE 200 → notif admin obsolète (push S39 déjà envoyée) ; pas de mécanisme de "rappel" la notif (compat) |
| **T40-INT-08** | Worker → S38 catalogue inchangé | Worker marque `media_purged=TRUE` MAIS le produit était déjà `status='deleted'` donc déjà exclu du catalogue. Worker ne change PAS la visibilité S38. |

---

## Cas limites

| ID | Cas | Attendu |
|---|---|---|
| **T40-EDGE-01** | DELETE puis REACTIVATE puis DELETE puis REACTIVATE en boucle rapide | Toutes les opérations 200 ; row.reactivated_at progresse ; `pending_file_deletions` annulées à chaque Reactivate ; cycle propre |
| **T40-EDGE-02** | DELETE pendant que Worker tourne (race) | Worker peut soit traiter soit ignorer (filtre `media_purge_scheduled_at <= NOW()` exclut les J+90 récents). Pas de race destructive. |
| **T40-EDGE-03** | Reactivate pendant que Worker tourne (race) | Worker peut UPDATE `media_purged=TRUE` AVANT Reactivate UPDATE → Reactivate retourne `media_purged=true` lu en début ; cohérent. |
| **T40-EDGE-04** | DELETE après une suppression admin (S41) | Si admin a déjà supprimé → seller voit 404 (status=deleted, filtre exclut) |
| **T40-EDGE-05** | Reactivate après 1 an (admin doit purger long-after) | si rows physiques R2 supprimées il y a 9 mois, image_urls pointe vers du vide → restauration partielle attendue avec re-upload requis |
| **T40-EDGE-06** | Produit avec `media_purge_scheduled_at` dans le passé MAIS `media_purged=false` (worker en retard) | Worker traitera au prochain cycle ; pas de bug |
| **T40-EDGE-07** | Reactivate par admin d'un produit dont seller_id pointe vers un user supprimé | 200 OK (pas de check intégrité FK applicatif) ; produit ré-actif avec seller_id orphelin |
| **T40-EDGE-08** | DELETE avec image_urls = ["http://very/long/url" * 100] (URL géante) | 200 OK ; INSERT pending_file_deletions accepte n'importe quelle longueur (TEXT PostgreSQL) |

---

## Couverture totale

- **48+ cas de test** (DEL: 19, REA: 22, WRK: 11, INT: 8, EDGE: 8) — total ~68
- **Régressions S38** : T40-DEL-30, T40-INT-01, T40-INT-03, T40-INT-08
- **Régressions S39** : T40-DEL-31, T40-DEL-32, T40-INT-02, T40-INT-04, T40-INT-05, T40-INT-06, T40-INT-07
- **Régressions S23** : T40-DEL-20, T40-DEL-21, T40-REA-20

---

## Test d'intégration end-to-end (smoke)

```
1. POST /products (S39) → product_id=X, status=draft
2. POST /products avec product_id=X, status=pending_review (S39) → status=pending_review
3. (admin valide en S41 → status=active) — simulation DB
4. GET /marketplace/products (S38) → contient X
5. DELETE /products/X (S40) → 200 ; media_purge_scheduled_at = now+90j
6. GET /marketplace/products (S38) → ne contient PAS X
7. GET /products/mine (S39) → ne contient PAS X
8. POST /products/X/reactivate (S40) → 200 ; status=active ; requires_media_reupload=false
9. GET /marketplace/products (S38) → contient X
10. (Simulation) Forcer media_purge_scheduled_at = now-1s + worker cycle → media_purged=true
11. POST /products/X/reactivate après re-DELETE → 200 ; requires_media_reupload=true
```

Validation E2E du flow complet : **create → publish → list → delete → reactivate → re-delete → purge → reactivate-partiel**.
