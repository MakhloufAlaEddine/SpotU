# SLICE_41_TEST_CASES.md — Cas de test Marketplace admin moderation
> Basé sur `routes/admin_product_routes.py:1–207` + `admin_product_reminder_worker.py:1–104` + BUSINESS_RULES.
> Généré le 2026-04-30.

---

## Convention IDs

- `T41-PND-NN` = GET pending
- `T41-DET-NN` = GET detail
- `T41-APP-NN` = approve
- `T41-REJ-NN` = reject
- `T41-WRK-NN` = AdminProductReminderWorker
- `T41-INT-NN` = Intégration / régression cross-slice

---

## Endpoint 1 — `GET /api/admin/products/pending`

### Nominal

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T41-PND-01** | Liste vide | aucun row pending_review | 200 ; `{"products":[], "count":0}` |
| **T41-PND-02** | 1 produit pending | 1 row status=pending_review, seller=u1 | 200 ; `count:1` ; `seller_name`, `seller_picture`, `quality_score` présents |
| **T41-PND-03** | FIFO ordering | 3 rows pending, created_at = t1 < t2 < t3 | 200 ; ordre array = [t1, t2, t3] (`ASC`) |
| **T41-PND-04** | Mix de statuts | 1 pending + 1 active + 1 draft | 200 ; `count:1` (filtre strict pending_review) |
| **T41-PND-05** | quality_score min (0/100) | row sans cover, sans description, lat=NULL, price=0, etc. | 200 ; `quality_score:0` |
| **T41-PND-06** | quality_score max (100/100) | row avec cover, image_urls≥3, title≥25, desc≥150, price>0, pickup, lat | 200 ; `quality_score:100` |
| **T41-PND-07** | quality_score intermédiaire | row avec cover (20) + title=15 (15) + desc=60 (10) | 200 ; `quality_score:45` |
| **T41-PND-08** | `image_urls` est jsonb | row image_urls=["a","b","c","d"] (4 entrées) | 200 ; `quality_score` inclut +10 (≥3) ; pas de crash `jsonb_array_length` |
| **T41-PND-09** | `image_urls` NULL | row image_urls=NULL | 200 ; `quality_score` n'inclut PAS le +10 (`COALESCE` retourne `[]` jsonb, length=0) |
| **T41-PND-10** | Champ `admin_reminder_sent_at` | row avec admin_reminder_sent_at=t1 | 200 ; champ présent (ISO ou null) |

### JOIN strict (anomalie compat)

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T41-PND-11** | Seller orphelin (user supprimé) | 1 row pending, seller_id pointe vers users.user_id absent | 200 ; **produit ABSENT du listing** (JOIN strict masque). Anomalie compat — Java doit reproduire ou utiliser LEFT JOIN. |

### Erreurs

| ID | Cas | Attendu |
|---|---|---|
| **T41-PND-20** | Sans Authorization | **401** (S23) |
| **T41-PND-21** | JWT user normal (role=user) | **403** ; `{"detail":"Admin only"}` |
| **T41-PND-22** | JWT user coach | **403** (role != admin) |
| **T41-PND-23** | JWT admin valide | 200 |

---

## Endpoint 2 — `GET /api/admin/products/{product_id}`

### Nominal

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T41-DET-01** | Detail pending | row pending_review | 200 ; `SELECT p.*` + seller_name, seller_picture, **seller_email**, quality_score |
| **T41-DET-02** | Detail active | row active | 200 ; même format (pas de filtre status) |
| **T41-DET-03** | Detail rejected | row rejected | 200 ; `rejection_reason`, `admin_comment` présents |
| **T41-DET-04** | Detail deleted | row deleted | 200 ; même format (pas de filtre `status != 'deleted'`) |
| **T41-DET-05** | Drift schéma | row avec nouvelle colonne (ex: `experimental_field='x'`) | 200 ; nouvelle colonne présente automatiquement (drift volontaire) |
| **T41-DET-06** | seller_email présent (vs pending) | endpoint detail seul | 200 ; `seller_email` présent (asymétrie vs endpoint pending) |
| **T41-DET-07** | quality_score calculé | row complet | 200 ; même formule que pending |

### Erreurs

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T41-DET-20** | Sans Authorization | — | **401** |
| **T41-DET-21** | Non-admin | — | **403** ; `{"detail":"Admin only"}` |
| **T41-DET-22** | Produit inexistant | id `prod_xyz` absent | **404** ; **`{"error":"Produit introuvable."}`** (clé `error`, PAS `detail`) |
| **T41-DET-23** | Format datetime | row created_at=2026-04-29 | 200 ; `created_at` au format ISO 8601 avec offset |

---

## Endpoint 3 — `POST /api/admin/products/{product_id}/approve`

### Nominal

| ID | Cas | Setup | Body | Attendu |
|---|---|---|---|---|
| **T41-APP-01** | Approve nominal pending → active | row status=pending_review | `{"comment":"OK ça passe"}` | 200 ; `{"ok":true,"status":"active"}` ; UPDATE row → status=active, in_stock=TRUE, admin_validated_by, admin_validated_at, admin_comment="OK ça passe", updated_at ; **push notif `product_approved`** au seller |
| **T41-APP-02** | Approve sans comment | row pending | `{}` ou body vide | 200 ; admin_comment=NULL en DB |
| **T41-APP-03** | Approve avec comment whitespace | — | `{"comment":"   "}` | 200 ; admin_comment=NULL (strip→empty→null, BR-41.10) |
| **T41-APP-04** | Approve avec emojis | — | `{"comment":"👍 Top"}` | 200 ; admin_comment="👍 Top" préservé |
| **T41-APP-05** | Approve idempotent (déjà active) | row status=active | `{}` | 200 ; UPDATE re-écrase admin_validated_at ; push renvoyé (BR-41.07) |
| **T41-APP-06** | Approve d'un rejected (override) | row status=rejected, rejection_reason="X" | `{}` | 200 ; status=active ; rejection_reason **NON touché** (reste "X") |
| **T41-APP-07** | Approve d'un draft | row status=draft | `{}` | 200 ; status=active (skip review — anomalie compat) |
| **T41-APP-08** | Approve d'un deleted (ZOMBIE) | row status=deleted, deleted_at=NOT NULL | `{}` | 200 ; status=active ; **zombie ressuscité** ; `deleted_at` reste NOT NULL (UPDATE ne le touche pas — anomalie majeure) |

### Push approve

| ID | Cas | Vérification |
|---|---|---|
| **T41-APP-10** | Push title | `"Produit publié !"` (3 mots, espaces exacts, `!` final) |
| **T41-APP-11** | Push body avec guillemets typographiques | `"Ton annonce « X » a été validée et est maintenant visible dans la boutique."` (« et » FR, PAS `"..."`) |
| **T41-APP-12** | Push data | `{"type":"product_approved", "product_id":"...", "action":"/products/my-products"}` |
| **T41-APP-13** | Push notif_type | `"product_approved"` |
| **T41-APP-14** | Push si seller orphelin | seller_id pointe vers user supprimé → push échoue silencieusement, UPDATE quand même committed |

### Erreurs

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T41-APP-20** | Sans Authorization | — | **401** |
| **T41-APP-21** | Non-admin | — | **403** ; `{"detail":"Admin only"}` |
| **T41-APP-22** | Produit inexistant | id absent | **404** ; `{"error":"Produit introuvable."}` |
| **T41-APP-23** | Body absent (pas JSON) | request sans body | 422 (FastAPI default) ou 400 selon Spring |
| **T41-APP-24** | Comment non-string (`{"comment":123}`) | — | Python : 500 (TypeError sur `.strip()`). Java : choix — soit reproduit (préserver), soit normalise (Long.toString → "123") |

---

## Endpoint 4 — `POST /api/admin/products/{product_id}/reject`

### Nominal

| ID | Cas | Setup | Body | Attendu |
|---|---|---|---|---|
| **T41-REJ-01** | Reject avec commentaire | row pending | `{"comment":"Photo trop floue"}` | 200 ; `{"ok":true,"status":"rejected"}` ; UPDATE row → status=rejected, in_stock=FALSE, admin_validated_by, admin_validated_at, **rejection_reason="Photo trop floue" ET admin_comment="Photo trop floue"** (DUPLIQUÉ — BR-41.09) ; push `product_rejected` |
| **T41-REJ-02** | Reject sans commentaire | row pending | `{}` | 200 ; rejection_reason=NULL, admin_comment=NULL en DB ; **push.data.admin_comment = ""** (string vide, PAS null — BR-41.13) |
| **T41-REJ-03** | Reject d'un active (rétro) | row status=active | `{"comment":"Plus en stock"}` | 200 ; status=rejected, in_stock=FALSE |
| **T41-REJ-04** | Reject idempotent (déjà rejected) | row rejected, rejection_reason="A" | `{"comment":"B"}` | 200 ; rejection_reason="B" (re-écrasé) ; admin_comment="B" |
| **T41-REJ-05** | Reject d'un deleted | row status=deleted | `{"comment":"X"}` | 200 ; status=rejected (anomalie zombie) |

### Push reject

| ID | Cas | Vérification |
|---|---|---|
| **T41-REJ-10** | Push title | `"Annonce refusée"` |
| **T41-REJ-11** | Push body | `"Ton annonce « X » n'a pas été validée. Clique pour voir les corrections à apporter."` |
| **T41-REJ-12** | Push data avec deeplink edit | `{"type":"product_rejected", "product_id":"...", "admin_comment":"<comment>", "action":"/products/create?productId=<id>&mode=edit"}` |
| **T41-REJ-13** | Push notif_type | `"product_rejected"` |
| **T41-REJ-14** | data.admin_comment vide vs null | body sans comment → `data.admin_comment=""` (PAS null — BR-41.13) |

### Erreurs

| ID | Cas | Attendu |
|---|---|---|
| **T41-REJ-20** | Sans Authorization | **401** |
| **T41-REJ-21** | Non-admin | **403** ; `{"detail":"Admin only"}` |
| **T41-REJ-22** | Produit inexistant | **404** ; `{"error":"Produit introuvable."}` |

---

## Worker `AdminProductReminderWorker`

### Nominal

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T41-WRK-01** | Cycle nominal — 1 produit ancien | row pending_review, created_at=now-3h, admin_reminder_sent_at=NULL ; 2 admins | UPDATE admin_reminder_sent_at=now ; **2 push** (1 par admin) ; logger.info "1 rappel(s) envoyé(s)." |
| **T41-WRK-02** | Cycle vide — pas de pending ancien | rows pending mais tous <2h | 0 UPDATE ; 0 push ; `return 0` |
| **T41-WRK-03** | Cycle — produit déjà rappelé récemment | row pending, admin_reminder_sent_at=now-1h (récent) | 0 UPDATE ; 0 push (filtre `< now-2h`) |
| **T41-WRK-04** | Cycle — produit rappelé il y a >2h | row pending, admin_reminder_sent_at=now-3h | UPDATE + push (re-rappel) |
| **T41-WRK-05** | Cycle multi-produits | 3 rows ancients, 2 admins | UPDATE batch 3 product_ids ; **6 push** (3×2) |
| **T41-WRK-06** | LIMIT 50 | 60 rows ancients pending | UPDATE 50 rows max ; 10 restent pour cycle suivant |
| **T41-WRK-07** | Cycle horaire | mesure interval entre 2 cycles | ≈ 600s (10 min) |
| **T41-WRK-08** | Aucun admin enregistré | rows pending mais users.role=admin → 0 résultat | UPDATE rien ; `return 0` (l. 49–50 early return) |

### Idempotence + ordre

| ID | Cas | Setup | Attendu |
|---|---|---|---|
| **T41-WRK-10** | UPDATE BEFORE push | mock push raises pour 1 admin | UPDATE déjà committed ; push échoue silencieusement (boucle ne retry pas) ; 2 push tentés sur 2 (le 2e échoue) |
| **T41-WRK-11** | Push rate limit Expo | mock 429 | log error worker `AdminProductReminderWorker erreur:...` ; cycle suivant retentera |
| **T41-WRK-12** | DB error pendant SELECT | mock fetch raise | log error ; sleep 600s ; cycle suivant retentera (boucle while True robuste) |

### Push worker

| ID | Cas | Vérification |
|---|---|---|
| **T41-WRK-20** | Push title | `"Rappel : annonce en attente"` |
| **T41-WRK-21** | Push body | `"L'annonce « X » attend votre validation depuis 2h."` (interpolation REMINDER_DELAY_HOURS) |
| **T41-WRK-22** | Push data | `{"type":"admin_product_reminder", "product_id":"...", "action":"/admin?tab=products"}` |
| **T41-WRK-23** | notif_type | `"admin_product_reminder"` |

---

## Régressions cross-slice

| ID | Cas | Vérification |
|---|---|---|
| **T41-INT-01** | Approve → S38 catalogue | Après approve → `GET /marketplace/products` (S38) inclut le produit |
| **T41-INT-02** | Approve → S39 `/mine` | Après approve → `GET /products/mine` (S39) montre status='active' + admin_comment |
| **T41-INT-03** | Reject → S38 catalogue | Après reject → `GET /marketplace/products` n'inclut PAS le produit |
| **T41-INT-04** | Reject → S39 `/mine` | Après reject → `GET /products/mine` montre status='rejected' + rejection_reason |
| **T41-INT-05** | Reject → S39 `/detail` | `GET /products/{id}/detail` retourne `rejection_reason` ET `admin_comment` (les 2 colonnes !) |
| **T41-INT-06** | Reject puis re-soumission seller | Reject → seller fait POST /products avec status=pending_review (S39) → notif admins via S39 push (BR-39.14) → S41 reminder worker peut re-rappeler après 2h |
| **T41-INT-07** | Approve puis DELETE seller | Approve → DELETE (S40) status='deleted' → produit invisible côté S38 et S39 ; admin_validated_at préservé en DB |
| **T41-INT-08** | DELETE puis approve admin (anomalie zombie) | row deleted → admin appelle approve → status='active' (zombie) ; le produit est de nouveau visible mais `deleted_at` reste NOT NULL (incohérence) |
| **T41-INT-09** | Reject puis Reactivate seller (S40) | Reject status='rejected' → DELETE (S40) → Reactivate (S40) → **status='active'** (BR-40.07) → rejection_reason perdu en DB (UPDATE Reactivate force status mais ne touche pas rejection_reason — vérifier !) |
| **T41-INT-10** | Compat S39 push admin (BR-39.14) avec S41 reminder | seller soumet pending_review → S39 push admins → 2h+ → S41 worker re-push admins. Vérifier que les 2 fonctionnent en parallèle sans dédoublonnage. |

> ⚠️ T41-INT-09 — vérifier en regardant code S40 BR-40.07 : Reactivate UPDATE = `SET status='active', deleted_at=NULL, deleted_by=NULL, ..., reactivated_at=$1`. **Ne touche PAS `rejection_reason` ni `admin_comment`**. Donc rejection_reason reste affiché à l'écran si le seller consulte `/detail` (UX confuse — le produit est active mais montre une raison de rejet). À documenter comme anomalie compat.

---

## Cas limites

| ID | Cas | Attendu |
|---|---|---|
| **T41-EDGE-01** | Approve produit avec 0 image | 200 OK ; quality_score sans le +20 cover |
| **T41-EDGE-02** | quality_score description NULL | row description=NULL → COALESCE('','') length=0 → 0 points description |
| **T41-EDGE-03** | quality_score title="aaa" (3 chars) | length<10 → 0 points title |
| **T41-EDGE-04** | quality_score title=24 chars | length≥10 (15 pts) ; length<25 → +0 ; total title=15 |
| **T41-EDGE-05** | quality_score title=25 chars exactement | length≥10 (15) + length≥25 (5) = 20 |
| **T41-EDGE-06** | quality_score description=49 chars | <50 → 0 desc |
| **T41-EDGE-07** | quality_score description=50 chars exactement | ≥50 (10) ; <150 → +0 ; total desc=10 |
| **T41-EDGE-08** | quality_score description=150 chars exactement | ≥50 (10) + ≥150 (10) = 20 |
| **T41-EDGE-09** | image_urls = `["a","b"]` (2 entrées) | `<3` → +0 |
| **T41-EDGE-10** | image_urls = `["a","b","c"]` (3 entrées) | `≥3` → +10 |
| **T41-EDGE-11** | Reject avec comment 1000 chars | 200 OK ; DB stocke 1000 chars (TEXT illimité) |
| **T41-EDGE-12** | 100 produits pending simultanés | GET pending retourne 100 produits (pas de pagination — performance OK) |
| **T41-EDGE-13** | 1000 produits pending | GET pending retourne 1000 (acceptable — admin filtre côté UI) |
| **T41-EDGE-14** | Worker — 0 admin | `return 0` early ; pas de push tenté |
| **T41-EDGE-15** | Worker — 51 produits ancients | LIMIT 50 → 50 traités, 1 reste pour cycle+1 |

---

## Couverture totale

- **77+ cas de test** — total ~92 (PND: 13, DET: 7, APP: 14, REJ: 11, WRK: 16, INT: 10, EDGE: 15)
- **Régressions S23** : T41-PND-20-23, T41-DET-20-21, T41-APP-20-21, T41-REJ-20-21 (auth + admin role)
- **Régressions S24** : T41-APP-10-13, T41-REJ-10-13, T41-WRK-20-23 (push notif format compat)
- **Régressions S38** : T41-INT-01, T41-INT-03 (visibilité catalogue selon status)
- **Régressions S39** : T41-INT-02, T41-INT-04, T41-INT-05, T41-INT-06 (`/mine` + `/detail` cohérents)
- **Régressions S40** : T41-INT-07, T41-INT-08, T41-INT-09 (DELETE/Reactivate + zombie)

---

## Test d'intégration end-to-end (smoke)

```
1. POST /products (S39) avec status=pending_review → push S39 BR-39.14 envoyé aux admins
2. GET /admin/products/pending (S41) → produit présent avec quality_score
3. GET /admin/products/{id} (S41) → SELECT p.* + seller_email retournés
4. (attendre 2h) → AdminProductReminderWorker cycle → push reminder aux admins
5. POST /admin/products/{id}/approve (S41) avec comment="OK" → status=active, in_stock=TRUE
6. Push product_approved au seller reçue
7. GET /marketplace/products (S38) → produit visible
8. GET /products/mine (S39) → produit avec status=active, admin_comment="OK"
```

Validation E2E du flow complet : **submit → admin pending → reminder → approve → publish → seller notified → catalogue visible**.

```
Variant reject :
5b. POST /admin/products/{id}/reject avec comment="photo floue"
6b. status=rejected, in_stock=FALSE ; rejection_reason="photo floue" ET admin_comment="photo floue"
7b. Push product_rejected au seller avec deeplink édition
8b. GET /marketplace/products (S38) → produit absent
9b. GET /products/{id}/detail (S39) → seller voit rejection_reason="photo floue"
10b. seller corrige → POST /products avec product_id existant + status=pending_review (re-soumission via UPSERT S39)
11b. Cycle peut recommencer (T41-WRK reminder à T+2h après re-soumission)
```
