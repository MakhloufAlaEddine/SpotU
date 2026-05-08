# SLICE_40_SCOPE.md — Cadrage de la Slice 40 (Marketplace — Lifecycle seller)
> Basé sur `routes/product_creation_routes.py:459–556` + `media_purge_worker.py:1–127` + migrations `009_pending_file_deletions.sql` & `011_pending_file_deletions_status.sql`.
> Généré le 2026-04-30.

---

## Endpoints choisis (2) — `routes/product_creation_routes.py`

| # | Méthode | Chemin API | Auth | Lignes | Complexité |
|---|---|---|---|---|---|
| 1 | **DELETE** | `/api/products/{product_id}` | `require_auth` (S23) — owner uniquement | 459–503 | MOYENNE |
| 2 | **POST** | `/api/products/{product_id}/reactivate` | `require_auth` — owner OU admin | 507–556 | MOYENNE |

> **Path réel** : `/api/products/{...}` (pas `/api/marketplace/products/...`). Le router est monté sans prefix dans `server.py:110`. Compat stricte = Java DOIT exposer `/api/products/{id}` et `/api/products/{id}/reactivate`.

### Composant additionnel à porter — `MediaPurgeWorker`

Le DELETE planifie une purge différée à J+90. Le worker `media_purge_worker.py:1–127` consomme cette planification :
- Cadence : `INTERVAL_SECS=3600` (toutes les heures)
- Scanne 4 tables (`tag_points`, `services`, `marketplace_products`, `users`) — S40 ne couvre QUE le scope `marketplace_products`
- Idempotence triple : `media_purged=FALSE`, `status='deleted'`, `(reactivated_at IS NULL OR reactivated_at < deleted_at)`
- Marque `media_purged=TRUE`, `media_purged_at=now()`, puis délègue à `admin_purge_worker.run_purge(retention_days=0)` pour la suppression physique R2

> ⚠️ **Le worker est partagé** entre 4 entités. Java doit le porter en mode **multi-entité** (1 scheduler, 4 specs) — ne pas créer 4 schedulers séparés.

---

## Auth & permissions

### DELETE
- `require_auth` obligatoire (401 si JWT absent)
- **Owner-only** : `WHERE seller_id = $user_id` (l. 470, 482)
- **Pas de bypass admin** sur DELETE (intentionnel — l'admin a son endpoint dédié `admin_product_routes.py`)
- 404 si non-owner / inexistant / déjà supprimé (anti-énumération)

### Reactivate
- `require_auth` obligatoire
- **Owner OU admin** : check explicite `if row["seller_id"] != user_id and not is_admin: raise 403` (l. 531–532)
- Permet à un admin de restaurer un produit supprimé même s'il n'en est pas propriétaire (cas support / annulation accidentelle)

---

## Dépendances (slices déjà documentées ou à venir)

| Dépendance | Slice | Usage |
|---|---|---|
| `require_auth` | **S23** | Auth JWT sur les 2 endpoints |
| `marketplace_products` schema (colonnes lifecycle) | **S39** | Réutilise `seller_id`, `image_urls`, `cover_image_url` |
| Table `pending_file_deletions` | **S40** (nouveau) | Cible de planification purge fichiers |
| Worker `MediaPurgeWorker` | **S40** (nouveau) | Scheduler horaire + délégation `admin_purge_worker.run_purge` |
| `admin_purge_worker.run_purge` | _(slice future)_ | Suppression physique R2 (HORS scope S40) |
| `marketplace_routes.py` GET public | **S38** | Filtre `status='active'` exclut automatiquement les `deleted` |
| `product_creation_routes.py` GET /mine | **S39** | Filtre `status != 'deleted'` |

---

## Périmètre fonctionnel exact

### DELETE — soft-delete + planification purge

1. SELECT existence + ownership + non-deleted (l. 469–472)
2. UPDATE `marketplace_products` : `status='deleted'`, `deleted_at`, `deleted_by`, `media_purge_scheduled_at = now() + 90 jours`, `updated_at` (l. 476–482)
3. Pour chaque URL d'image (cover et `image_urls[]`) → INSERT `pending_file_deletions` avec `entity_type='product'`, `entity_id=product_id`, `scheduled_at = now()+90j`, `ON CONFLICT DO NOTHING` (l. 492–498)
4. Réponse `{ok: true, media_purge_scheduled_at: "ISO"}` (l. 500–503)

### Reactivate — restauration + 2 modes médias

1. SELECT existence (sans filtre seller) (l. 522–526)
2. Validations : 404 si introuvable (l. 527–528), 409 si pas supprimé (l. 529–530), 403 si pas owner ET pas admin (l. 531–532)
3. **DELETE pending** : `DELETE FROM pending_file_deletions WHERE entity_id=$X AND status='pending'` (l. 535–538) — annule la purge si pas encore traitée
4. UPDATE `marketplace_products` : `status='active'`, `deleted_at=NULL`, `deleted_by=NULL`, `media_purge_scheduled_at=NULL`, `media_purge_notified_at=NULL`, `reactivated_at=now()`, `updated_at=now()` (l. 540–547)
5. Réponse `{ok, reactivated, product_id, media_purged, requires_media_reupload}` (l. 549–555)

> ⚠️ **2 modes implicites** :
> - **<90j** (`media_purged=FALSE`) : médias R2 encore intacts → restauration totale
> - **≥90j** (`media_purged=TRUE`) : médias R2 déjà purgés par le worker → produit restauré mais `requires_media_reupload=true` (le seller doit re-uploader les images via S24)

### `MediaPurgeWorker` (cycle horaire — déclenche à T+90j)

```
SELECT product_id FROM marketplace_products
WHERE media_purge_scheduled_at <= NOW()
  AND media_purged = FALSE
  AND deleted_at IS NOT NULL AND status = 'deleted'
  AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
```
→ UPDATE `media_purged=TRUE`, `media_purged_at=now()`
→ Délègue à `admin_purge_worker.run_purge(retention_days=0)` (HORS scope S40)

---

## Tables touchées

| Table | Op | Endpoint(s) |
|---|---|---|
| `marketplace_products` | UPDATE (soft-delete) | DELETE |
| `marketplace_products` | UPDATE (restauration) | Reactivate |
| `marketplace_products` | UPDATE (purge marquage) | Worker |
| `marketplace_products` | SELECT | DELETE + Reactivate + Worker |
| `pending_file_deletions` | INSERT (`ON CONFLICT DO NOTHING`) | DELETE (1 INSERT par image) |
| `pending_file_deletions` | DELETE (annulation purge) | Reactivate |

---

## Niveau de risque : **MOYEN-ÉLEVÉ**

| Facteur | Note |
|---|---|
| Soft-delete simple (UPDATE 4 colonnes) | 🟢 |
| Calcul `now() + 90 jours` (timezone-aware) | 🟡 |
| Boucle INSERT par image (N+1 acceptable car bornée par UI) | 🟢 |
| `ON CONFLICT DO NOTHING` sans contrainte UNIQUE explicite déclarée dans `009_*.sql` | 🔴 (à investiguer DDL) |
| `image_urls` stocké en `text[]` OU `jsonb` (string parsing fallback Python l. 487–491) | 🔴 |
| 2 modes reactivate (médias intacts vs purgés) | 🟡 |
| Worker scheduler (asyncio Python ↔ Spring `@Scheduled`) | 🟡 |
| Worker partagé 4 entités | 🟡 |
| Idempotence triple (skipped si reactivated_at >= deleted_at) | 🔴 |
| Permissions asymétriques (DELETE owner-only, Reactivate owner+admin) | 🟡 |

---

## Justification du choix de slice

| Critère | Justification |
|---|---|
| **Ferme le triptyque seller authoring** | S39 a couvert create/edit/draft → publish. **Sans S40, le seller ne peut jamais retirer un produit** (champ `status='deleted'` jamais settable côté API). Bloquant fonctionnel. |
| **L'audit confirme l'absence d'achat** | Le buyer-side n'existe pas en Python — il n'y a donc rien à migrer côté achat. Inutile d'attendre. |
| **Worker partagé déjà mature** | `MediaPurgeWorker` existe et fonctionne (logs supervisord OK). Porter la spec marketplace_products débloque aussi tag_points/services/users dans des slices ultérieures. |
| **Slice mono-fichier + 1 worker** | 2 endpoints + 1 worker class. Auto-suffisant. ~150 lignes Python. |
| **Risque maîtrisé** | Pas de Stripe, pas de notif push, pas de transaction multi-table complexe. Soft-delete = UPDATE ciblé. |
| **Cohérence UX** | Le front mobile a déjà des écrans "Supprimer" + "Restaurer" — ils appellent ces 2 endpoints aujourd'hui. Migrer les 2 ensemble = pas de désynchronisation. |

### Alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| Migrer S41 admin avant S40 | L'admin n'a pas d'urgence ; l'utilisateur final (seller) en a une (gérer son catalogue). |
| Migrer S40 sans le worker | Le worker est l'**autre moitié** du soft-delete — sans lui, les médias R2 ne sont jamais purgés (coût stockage qui dérive). |
| Inclure `admin_purge_worker.run_purge` (purge physique R2) | Slice trop large + dépend de la config Cloudflare R2 + retry logic + idempotence R2. → Slice dédiée. |
| Inclure les 4 entités du worker (`tag_points`, `services`, `users`) | Brise le focus marketplace. Les autres entités auront leur propre slice de lifecycle. |

---

## HORS scope (volontairement reporté)

| Composant | Raison | Slice future |
|---|---|---|
| `admin_purge_worker.run_purge(...)` (suppression physique R2) | Logique R2 complexe + retry + état machine (`processing/deleted/failed/skipped`) | S40-bis (purge physique) ou slice infra dédiée |
| `media_purge_notified_at` (notification au seller avant purge T+83j ?) | Le code DELETE met cette colonne à `NULL` mais la table reste avec ce champ — un autre worker (`media_notif_worker.py`) la peuple. | Slice notif différée |
| Routes admin produits (`admin_product_routes.py`) | Validation/rejet — flow distinct | S41 |
| Lifecycle `tag_points` / `services` / `users` | Patterns similaires mais entités distinctes | S42+ |

---

## Critère de fin de slice

- [ ] DELETE soft-delete fonctionnel (status, deleted_at, deleted_by, media_purge_scheduled_at à J+90)
- [ ] DELETE planifie une entrée `pending_file_deletions` par image (cover + image_urls[])
- [ ] DELETE 404 si non-owner / inexistant / déjà deleted (anti-énumération)
- [ ] Reactivate 404/409/403 sur les 3 cas distincts
- [ ] Reactivate annule les `pending_file_deletions` `status='pending'`
- [ ] Reactivate retourne `requires_media_reupload` cohérent avec `media_purged` DB
- [ ] `MediaPurgeWorker` Spring `@Scheduled(fixedDelay=3600000)` actif
- [ ] Worker filtre triple-idempotent (`media_purged=FALSE`, `status='deleted'`, `reactivated_at<deleted_at OR NULL`)
- [ ] Worker délègue à `admin_purge_worker.run_purge` ou stub équivalent (placeholder OK pour S40 — vraie purge en S40-bis)
- [ ] Tests régression S38 (catalogue exclut les `deleted`) + S39 (`/mine` exclut `deleted`) verts
