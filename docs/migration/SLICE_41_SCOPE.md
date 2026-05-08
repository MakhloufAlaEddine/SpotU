# SLICE_41_SCOPE.md — Cadrage de la Slice 41 (Marketplace — Admin moderation)
> Basé sur `routes/admin_product_routes.py:1–207` + `admin_product_reminder_worker.py:1–104`.
> Généré le 2026-04-30.

---

## Endpoints choisis (4) — `routes/admin_product_routes.py`

| # | Méthode | Chemin API | Auth | Lignes | Complexité |
|---|---|---|---|---|---|
| 1 | GET | `/api/admin/products/pending` | `_require_admin` | 43–80 | MOYENNE (calcul `quality_score`) |
| 2 | GET | `/api/admin/products/{product_id}` | `_require_admin` | 84–111 | MOYENNE (`SELECT p.*`) |
| 3 | **POST** | `/api/admin/products/{product_id}/approve` | `_require_admin` | 115–157 | MOYENNE |
| 4 | **POST** | `/api/admin/products/{product_id}/reject` | `_require_admin` | 161–206 | MOYENNE |

> **Path réel** : router monté **avec** prefix `/admin` côté `server.py` ? Non — vérifier : le code utilise `@router.get("/admin/products/...")` directement, donc le router est monté **sans prefix** dans server.py. Cohérence avec server.py:111 `api_router.include_router(admin_product_router, tags=["admin-products"])` (sans `prefix=`). Path final = `/api/admin/products/...`.

### Composant additionnel à porter — `AdminProductReminderWorker`

`admin_product_reminder_worker.py:1–104` :
- Cadence `REMINDER_INTERVAL_SECS=600` (10 minutes)
- Détecte produits `pending_review` créés il y a >2h sans rappel récent
- Met à jour `admin_reminder_sent_at` puis push à tous les admins
- Champ DB `admin_reminder_sent_at` lu par S41 endpoint #1 (`list_pending_products`)

---

## Auth & permissions

### Helper local `_require_admin` (lignes 30–34)

```python
async def _require_admin(request, pool):
    user = await require_auth(request, pool)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user
```

> ⚠️ **Wrapper applicatif sur S23** — pas un middleware Spring Security. Java DOIT répliquer la logique :
> 1. `require_auth` (S23) → 401 si JWT KO
> 2. Check `user.role == 'admin'` → 403 sinon avec `{"detail": "Admin only"}`
>
> **Format erreur 403** : clé `detail` (HTTPException) — PAS `error`.

### Spring Security alternative

Plutôt que reproduire le helper applicatif, utiliser :
```java
.requestMatchers("/api/admin/**").hasRole("ADMIN")
```
**MAIS** : compat front stricte impose le body `{"detail": "Admin only"}` (pas le default Spring) → custom `AccessDeniedHandler` requis.

---

## Dépendances (slices déjà documentées)

| Dépendance | Slice | Usage en S41 |
|---|---|---|
| `require_auth` (JWT) | **S23** | Toutes les routes |
| `send_push_to_user` (Expo Push) | **S24** | approve / reject (notif seller) |
| `marketplace_products` colonnes lifecycle | **S39** + **S40** | `status`, `admin_validated_by`, `admin_validated_at`, `admin_comment`, `rejection_reason`, `in_stock` |
| Snapshot seller (`u.name`, `u.picture`) | **S39** | JOIN users dans le SELECT pending |
| Workflow `pending_review` initiation | **S39** | C'est S39 qui pose `status='pending_review'` ; S41 le résout vers `active` ou `rejected` |
| Worker `AdminProductReminderWorker` | **S41** (nouveau) | Lit `admin_reminder_sent_at`, push admins |

---

## Périmètre fonctionnel exact

### Endpoint 1 — `GET /admin/products/pending`

Liste TOUS les produits en `status='pending_review'` triés par `created_at ASC` (FIFO). JOIN avec `users` pour récupérer `seller_name`, `seller_picture`. **Calcul de `quality_score`** (0–100) côté SQL via 9 expressions `CASE WHEN`. Pas de pagination.

### Endpoint 2 — `GET /admin/products/{product_id}`

Détail d'un produit (peu importe son statut). `SELECT p.*` (TOUTES les colonnes — superset détail). JOIN users avec `seller_email` en bonus (vs endpoint #1). Même calcul `quality_score`. 404 si introuvable.

### Endpoint 3 — `POST /admin/products/{product_id}/approve`

Body : `{"comment": string?}` (optionnel).
1. SELECT `seller_id, title` (404 si introuvable — **pas de check de status courant**)
2. UPDATE : `status='active'`, `in_stock=TRUE`, `admin_validated_by`, `admin_validated_at`, `admin_comment`, `updated_at`
3. Push notif `product_approved` au seller

### Endpoint 4 — `POST /admin/products/{product_id}/reject`

Body : `{"comment": string?}` (optionnel mais "recommandé").
1. SELECT `seller_id, title` (404 si introuvable)
2. UPDATE : `status='rejected'`, `in_stock=FALSE`, `admin_validated_by`, `admin_validated_at`, `rejection_reason=comment`, `admin_comment=comment` (**dupliqué dans 2 colonnes**), `updated_at`
3. Push notif `product_rejected` au seller avec deeplink édition

> ⚠️ **Asymétrie approve/reject** :
> - approve : `in_stock=TRUE` ; reject : `in_stock=FALSE`
> - approve : seul `admin_comment` peuplé ; reject : `rejection_reason` ET `admin_comment` peuplés avec **la même valeur** (anomalie compat — Java doit préserver)
> - Notif data : approve → `action: "/products/my-products"` ; reject → `action: "/products/create?productId=X&mode=edit"` + `admin_comment` dans data
> - Aucun guard métier sur le statut courant : un admin peut approve/reject un produit déjà active/rejected/draft (état machine permissive)

---

## Tables touchées

| Table | Op | Endpoint(s) |
|---|---|---|
| `marketplace_products` | SELECT (LIMIT none) | GET pending |
| `marketplace_products` | SELECT (`SELECT p.*`) | GET detail |
| `marketplace_products` | SELECT puis UPDATE 5 colonnes | approve |
| `marketplace_products` | SELECT puis UPDATE 6 colonnes | reject |
| `users` | JOIN (lecture `name`, `picture`, `email`) | GET pending + GET detail |
| `users` | SELECT `WHERE role='admin'` | Worker reminder |

> Aucune table externe (`notifications` non utilisée — push direct via `push_service`).

---

## Niveau de risque : **MOYEN**

| Facteur | Note |
|---|---|
| 4 endpoints simples | 🟢 |
| Calcul `quality_score` SQL (9 CASE WHEN, dont `jsonb_array_length`) | 🟡 |
| `SELECT p.*` (drift schéma — toutes les colonnes futures remontées automatiquement) | 🔴 |
| `admin_comment` dupliqué avec `rejection_reason` côté reject | 🟡 |
| Pas de guard `status='pending_review'` sur approve/reject (état machine permissive) | 🔴 |
| Push notif synchrone (pas fire-and-forget — bloque réponse HTTP si push API lente) | 🟡 |
| Worker reminder (Spring `@Scheduled` 600s) | 🟢 |
| `jsonb_array_length(COALESCE(p.image_urls, '[]'::jsonb))` — confirme `image_urls` est `jsonb` | 🔴 (résout l'incertitude de S39/S40 !) |
| Pas de pagination sur GET pending | 🟡 (acceptable car volume admin faible) |

---

## ⚠️ DÉCOUVERTE CRITIQUE — `image_urls` est `jsonb` (PAS `text[]`)

L'endpoint pending (l. 65) utilise `jsonb_array_length(COALESCE(p.image_urls, '[]'::jsonb))`. Cette syntaxe **prouve que la colonne `image_urls` est de type `jsonb`** (sinon `jsonb_array_length` lèverait `function does not exist`).

**Impact rétrospectif** sur S39 et S40 :
- S39 (création produit) : Java doit utiliser `PGobject(type="jsonb", value=ObjectMapper.writeValueAsString(list))` pour `image_urls` (PAS `Connection.createArrayOf("text", ...)`)
- S40 (DELETE — boucle INSERT pending_file_deletions) : la lecture `row.image_urls` retourne une string JSON ou un objet jsonb selon le driver (le fallback Python `if isinstance(imgs, str): json.loads(imgs)` confirme ce dual return)

> 🔴 **À reporter dans les SCOPE/DB_MAPPING de S39 et S40** lors de la prochaine itération de consolidation. Pour l'instant : note présente ici dans S41.

> ❓ **Question ouverte** sur les autres champs array : `pricing_modes`, `tag_ids`, `related_spotyou_ids`, `delivery_modes`. Pas d'usage `jsonb_*` visible dans S41. À investiguer DDL Supabase exhaustivement (chaque colonne pourrait être différente).

---

## Justification du choix de slice

| Critère | Justification |
|---|---|
| **Ferme le workflow Marketplace seller** | S39 produit → `pending_review` ; S40 supprime/restaure ; **S41 résout** `pending_review → active/rejected`. Sans S41, **AUCUN produit ne peut être validé en Java** → marketplace bloqué (les sellers peuvent soumettre mais rien ne passe en `active`). |
| **Slice mono-fichier + 1 worker** | 4 endpoints + 1 worker rappel. ~310 lignes Python total. Auto-suffisant. |
| **Réutilise S23, S24, S39, S40** | Aucune nouvelle infra requise. |
| **Pré-requis cutover marketplace** | S38+S39+S40+S41 = bloc complet permettant un cutover marketplace partiel (achat reste à concevoir mais c'est hors migration). |
| **Risque maîtrisé** | Pas de Stripe, pas de FK complexe, pas de transaction multi-table, push existant. |
| **Découverte schéma JSONB confirmée** | Réduit l'incertitude planant sur S39/S40 (`image_urls` = jsonb confirmé). |

### Alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| Migrer S40-bis (purge physique R2) avant S41 | Le STUB S40 est acceptable temporairement ; débloquer la modération produit a plus de valeur business immédiate. |
| Inclure `AdminProductReminderWorker` dans une slice séparée | Trop petit pour être seul (~100 lignes, 1 query). Naturellement couplé à `admin_reminder_sent_at` qui est lu par S41 endpoint #1. |
| Inclure les routes `admin_routes.py` (autres `/admin/*`) | HORS scope marketplace. Slice admin générale plus large à découper différemment. |
| Migrer le check role admin via S23 réutilisable | Le helper `_require_admin` est local et léger ; pas la peine de le globaliser. Spring Security `hasRole("ADMIN")` suffit, mais alors body 403 doit être customisé. |

---

## HORS scope (volontairement reporté)

| Composant | Raison | Slice future |
|---|---|---|
| Routes `admin_routes.py` génériques (autres `/admin/*` non-marketplace) | Domaine admin global — slice dédiée | S-Admin |
| Edition admin d'un produit (équivalent `PUT /admin/products/{id}`) | **N'EXISTE PAS** dans le code Python (vérifié) — pas de migration possible | — |
| Suppression admin d'un produit (`DELETE /admin/products/{id}`) | **N'EXISTE PAS** — l'admin doit utiliser `DELETE /api/products/{id}` (S40) qui est owner-only ; il ne peut donc pas supprimer un produit qu'il ne possède pas. **Anomalie produit** documentée mais pas une slice de migration. | — |
| Bulk approve / bulk reject | **N'EXISTE PAS** | — |
| Historique des modérations | **N'EXISTE PAS** (pas de table `moderation_history`) | — |
| `admin_purge_worker.run_purge` (purge physique R2) | Reporté de S40 | S40-bis |
| `media_notif_worker.py` (notif T+83j avant purge) | Reporté de S40 | Slice notif différée |

---

## Critère de fin de slice

- [ ] 4 endpoints Java fonctionnels avec parité 100% comportementale
- [ ] Auth admin (401 + 403 avec `{"detail": "Admin only"}`)
- [ ] `quality_score` calculé en SQL (PAS en Java) — préserver formule exacte
- [ ] GET pending liste tous les `pending_review` triés `created_at ASC`, avec `seller_name`/`seller_picture`/`admin_reminder_sent_at`
- [ ] GET detail retourne `SELECT p.*` + JOIN seller (incl. `seller_email`)
- [ ] approve : UPDATE 5 colonnes (`status='active'`, `in_stock=TRUE`, `admin_validated_by`, `admin_validated_at`, `admin_comment`, `updated_at`)
- [ ] reject : UPDATE 6 colonnes (`status='rejected'`, `in_stock=FALSE`, `admin_validated_by`, `admin_validated_at`, `rejection_reason=comment`, `admin_comment=comment` — **dupliqué**, `updated_at`)
- [ ] Push notif au seller (synchrone, hors transaction préférable)
- [ ] PAS de guard `status='pending_review'` sur approve/reject (compat permissive)
- [ ] Format réponse `{"ok": true, "status": "active"|"rejected"}`
- [ ] Format erreur 404 `{"error": "Produit introuvable."}` (PAS `detail`)
- [ ] `AdminProductReminderWorker` Spring `@Scheduled(fixedDelay=600000)` actif
- [ ] Worker filtre `pending_review` AND `created_at < NOW() - 2h` AND (`admin_reminder_sent_at IS NULL OR < NOW() - 2h`)
- [ ] Worker UPDATE batch `admin_reminder_sent_at = $now WHERE product_id = ANY($ids)`
- [ ] Worker push à tous les admins par produit (matrice `count(produits) × count(admins)`)
- [ ] Régressions S38 (catalogue affiche les `active`) + S39 (pending_review apparaît dans `/mine`) + S40 (DELETE possible avant validation) vertes
