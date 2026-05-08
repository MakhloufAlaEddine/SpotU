# SLICE_40_BUSINESS_RULES.md — Règles métier Marketplace lifecycle seller
> Basé sur `routes/product_creation_routes.py:459–556` + `media_purge_worker.py:1–127`.
> Généré le 2026-04-30.

---

## BR-40.01 — Auth obligatoire (DELETE + Reactivate)

### Règle
`require_auth` (S23) sur les 2 endpoints. 401 si JWT absent/invalide.

### Java
```java
.requestMatchers(HttpMethod.DELETE, "/api/products/{id}").authenticated()
.requestMatchers(HttpMethod.POST, "/api/products/{id}/reactivate").authenticated()
```

> Aucun check de rôle obligatoire — ni `seller`, ni `admin`. Les permissions sont applicatives (BR-40.02 + BR-40.05).

---

## BR-40.02 — DELETE : Owner-only, AUCUN bypass admin

### Règle (l. 469–472)
SELECT existence avec filtre `seller_id = $user_id AND status != 'deleted'`. Si non trouvé → 404.

### Java
```java
Optional<ProductLite> row = repo.findActiveByIdAndSellerId(productId, userId);
if (row.isEmpty()) throw new NotFoundException("Produit introuvable ou non autorisé.");
```

> ⚠️ **Asymétrie volontaire vs Reactivate** : DELETE n'a PAS de bypass admin. L'admin a son propre endpoint dans `admin_product_routes.py` (S41). Compat stricte = NE PAS ajouter `OR is_admin` côté Java.

> ⚠️ **Anti-énumération** : 404 dans 3 cas distincts (introuvable / autre user / déjà deleted). Java DOIT retourner le **même** message dans les 3 cas (`"Produit introuvable ou non autorisé."`).

---

## BR-40.03 — DELETE : Soft-delete + planification J+90

### Règle (l. 466, 476–482)
- `media_purge_at = now() + timedelta(days=90)`
- UPDATE `status='deleted'`, `deleted_at=now()`, `deleted_by=user_id`, `media_purge_scheduled_at=now()+90j`, `updated_at=now()`

### Java
```java
OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
OffsetDateTime mediaPurgeAt = now.plusDays(90);
repo.softDelete(productId, userId, now, mediaPurgeAt);
```

> ⚠️ **90 jours = `timedelta(days=90)`** (Python). Java : `Duration.ofDays(90)` ou `Period.ofDays(90)`. **Tester les bordures DST** — `Period.ofDays(90)` gère correctement les changements d'heure été/hiver, contrairement à `Duration.ofHours(90*24)`.

---

## BR-40.04 — DELETE : Planification purge fichiers (1 INSERT par image)

### Règle (l. 484–498)

```python
imgs = row["image_urls"] or []
if isinstance(imgs, str):
    try: imgs = json.loads(imgs)
    except: imgs = []
for url in imgs:
    if url:
        INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at)
        VALUES (url, 'product', product_id, media_purge_at)
        ON CONFLICT DO NOTHING
```

### Java

```java
List<String> imgs = parseImageUrls(row.getImageUrls()); // gère text[] ET string JSON
for (String url : imgs) {
    if (url != null && !url.isEmpty()) {
        repo.scheduleFileDeletion(url, "product", productId, mediaPurgeAt);
    }
}
```

> ⚠️ **`cover_image_url` NON traitée séparément** (BR-40.04 stricte). Si elle ne figure pas dans `image_urls[]`, elle ne sera jamais purgée. Compat = préserver.

> ⚠️ **`entity_type` HARDCODÉ `'product'`** — Java doit utiliser cette valeur exacte (string, pas enum, pour rester compatible avec les autres entités stockées dans la même table).

---

## BR-40.05 — Reactivate : Owner OU Admin

### Règle (l. 519–532)
- SELECT existence sans filtre user
- 404 si row absente
- 409 si `status != 'deleted'` OU `deleted_at IS NULL`
- 403 si `seller_id != user_id` AND `not is_admin`

### Java
```java
Product row = repo.findById(productId).orElseThrow(() -> new NotFoundException("Produit introuvable"));
if (!"deleted".equals(row.getStatus()) || row.getDeletedAt() == null)
    throw new ConflictException("Ce produit n'est pas supprimé");
if (!row.getSellerId().equals(userId) && !user.isAdmin())
    throw new ForbiddenException("Non autorisé");
```

> ⚠️ **Ordre des checks** : 404 → 409 → 403 (préserver — front s'appuie sur cet ordre pour afficher le bon message).

---

## BR-40.06 — Reactivate : Annulation des purges en attente

### Règle (l. 534–538)

```sql
DELETE FROM pending_file_deletions
WHERE entity_id = $1 AND status = 'pending'
```

> ⚠️ **`status='pending'` UNIQUEMENT**. Les rows déjà `processing/deleted/failed/skipped` ne sont PAS retouchées. **Conséquence** : si la purge a déjà commencé (`processing`) ou est terminée (`deleted`), reactivate ne peut rien annuler — les fichiers sont irrécupérables.

### Java
```java
@Modifying
@Query("DELETE FROM pending_file_deletions WHERE entity_id = ?1 AND entity_type = 'product' AND status = 'pending'")
int cancelPendingDeletions(String productId);
```

> 🔴 **Recommandation Java (rupture compat mineure)** : ajouter `AND entity_type='product'` pour fermer le piège DB-07. Aucun impact pratique (préfixes IDs distincts).

---

## BR-40.07 — Reactivate : Restauration → status='active' (PAS draft, PAS pending_review)

### Règle (l. 540–547)
UPDATE force `status = 'active'` peu importe le statut antérieur.

### Java
```java
repo.reactivate(productId, now);
// status='active', deleted_at=NULL, deleted_by=NULL,
// media_purge_scheduled_at=NULL, media_purge_notified_at=NULL,
// reactivated_at=now, updated_at=now
```

> ⚠️ **Anomalie compat documentée** :
> - Un produit qui était en `draft` avant DELETE → devient `active` (publication non voulue)
> - Un produit qui était en `pending_review` avant DELETE → devient `active` (modération court-circuitée)
>
> Java DOIT préserver. Une amélioration future (slice ultérieure) pourrait stocker le `status_before_delete` et le restaurer. **HORS scope S40**.

---

## BR-40.08 — Reactivate : `media_purged` NON modifié

### Règle (l. 540–547)
Le UPDATE Reactivate **ne touche PAS** `media_purged` ni `media_purged_at`.

### Conséquences

| État pré-Reactivate | Mode Reactivate |
|---|---|
| `media_purged=FALSE` (delete <90j) | **Restauration totale** — médias R2 encore intacts |
| `media_purged=TRUE` (delete ≥90j) | **Restauration partielle** — médias R2 supprimés ; le seller doit re-uploader |

### Java
La réponse Reactivate utilise `media_purged` LU avant le UPDATE (l. 549, 553) :

```java
boolean wasPurged = row.isMediaPurged();
repo.reactivate(productId, now);
return new ReactivateResponse(true, true, productId, wasPurged, wasPurged);
```

---

## BR-40.09 — Reactivate : Pas de purge des images orphelines en DB

### Règle observée
Si reactivate après purge médias (`media_purged=TRUE`), les URLs dans `image_urls[]` et `cover_image_url` **restent en DB** (elles pointent vers des fichiers R2 supprimés).

### Conséquence front
Le client doit gérer les 404 sur ces URLs ET prompter un re-upload (drivé par `requires_media_reupload=true`).

### Java
**Préserver le comportement** (compat stricte). Une slice future pourrait nettoyer les URLs lors du purge worker (vider `image_urls[]` quand `media_purged=TRUE`).

---

## BR-40.10 — Idempotence : 2e DELETE → 404

### Règle
Le filtre `status != 'deleted'` dans le SELECT initial fait que un 2e DELETE retourne 404 (pas 200, pas 409).

### Java
```java
Optional<ProductLite> row = repo.findActiveByIdAndSellerId(productId, userId);
if (row.isEmpty()) throw new NotFoundException("Produit introuvable ou non autorisé.");
```

> ⚠️ **Asymétrie vs Reactivate** : 2e Reactivate → **409** (pas 404). Compat stricte = préserver les 2 codes différents.

---

## BR-40.11 — Idempotence : 2e Reactivate → 409

### Règle (l. 529–530)
```python
if row["status"] != "deleted" or not row["deleted_at"]:
    raise HTTPException(409, "Ce produit n'est pas supprimé")
```

### Java
```java
if (!"deleted".equals(row.getStatus()) || row.getDeletedAt() == null)
    throw new ConflictException("Ce produit n'est pas supprimé");
```

---

## BR-40.12 — `MediaPurgeWorker` : Cadence et idempotence

### Règle (`media_purge_worker.py`)
- Cadence `INTERVAL_SECS=3600` (toutes les heures)
- Démarrage : `start()` → `asyncio.create_task(_run_loop)`
- Arrêt gracieux : `stop()` set `_stop_event` + cancel
- Trigger : `media_purge_scheduled_at <= NOW()`
- Triple idempotence : `media_purged=FALSE`, `status='deleted'` (pour marketplace_products), `(reactivated_at IS NULL OR reactivated_at < deleted_at)`

### Java
```java
@Component
public class MediaPurgeWorker {
    private final MarketplaceProductRepository repo;
    private final FilePurgeService filePurgeService; // wrapper admin_purge_worker

    @Scheduled(fixedDelayString = "${app.media-purge.interval-ms:3600000}")
    public void cycle() {
        try {
            int purged = repo.markMediaPurgedDue(OffsetDateTime.now(ZoneOffset.UTC));
            if (purged > 0) {
                filePurgeService.runPhysicalPurge(0); // retention_days=0
            }
        } catch (Exception e) {
            log.error("[PURGE-MEDIA] cycle failed", e);
        }
    }
}
```

> ⚠️ Pas de `initialDelay` requis (Python démarre immédiatement). Spring `@Scheduled` peut utiliser `fixedDelay` (équivalent à `asyncio.sleep` après le travail).

> ⚠️ **Worker partagé 4 entités** (BR-40.13) — la version Java doit traiter `tag_points`, `services`, `marketplace_products`, `users` dans le même cycle. S40 ne couvre que `marketplace_products` mais Java doit prévoir la généricité.

---

## BR-40.13 — Worker : 4 entités, 1 scheduler

### Règle (`media_purge_worker.py:85–90`)

```python
entity_specs = [
    ("tag_points",          "point_id",   "deleted_at IS NOT NULL AND active=FALSE"),
    ("services",            "service_id", "deleted_at IS NOT NULL AND active=FALSE"),
    ("marketplace_products","product_id", "deleted_at IS NOT NULL AND status='deleted'"),
    ("users",               "user_id",    "deleted_at IS NOT NULL"),
]
```

### Java — Approche recommandée

```java
public record EntitySpec(String table, String idCol, String deletedCheck, String statKey) {}

private static final List<EntitySpec> SPECS = List.of(
    new EntitySpec("tag_points", "point_id", "deleted_at IS NOT NULL AND active=FALSE", "tag_points"),
    new EntitySpec("services", "service_id", "deleted_at IS NOT NULL AND active=FALSE", "services"),
    new EntitySpec("marketplace_products", "product_id", "deleted_at IS NOT NULL AND status='deleted'", "products"),
    new EntitySpec("users", "user_id", "deleted_at IS NOT NULL", "users")
);
```

> 🔴 **PIÈGE-BR-13 — SQL dynamique** : le Python interpole `table` et `id_col` dans la string SQL (l. 96–104). Java doit utiliser `JdbcTemplate` avec **string concatenation contrôlée** (pas de `PreparedStatement` pour les noms de table). Whitelist stricte des tables/colonnes pour éviter SQL injection. **Ne PAS utiliser des paramètres `?` pour les noms de table/colonne** (PostgreSQL ne le permet pas).

> ⚠️ Pour S40, **seul le spec `marketplace_products` doit être actif**. Les 3 autres peuvent être documentés mais commentés (slices ultérieures S42+).

---

## BR-40.14 — Worker : Délégation `admin_purge_worker.run_purge`

### Règle (`media_purge_worker.py:118–124`)

```python
if counts["purged"] > 0:
    try:
        from admin_purge_worker import run_purge
        await run_purge(pool, retention_days=0, batch_size=500, dry_run=False)
    except Exception as exc:
        logger.warning("[PURGE-MEDIA] run_purge() a échoué : %s", exc)
```

### Java

> ⚠️ **HORS scope S40** : `admin_purge_worker.run_purge` (suppression physique R2) sera traité dans une slice infra dédiée. Pour S40, créer un **stub** :

```java
@Service
public class FilePurgeService {
    public void runPhysicalPurge(int retentionDays) {
        log.info("[PURGE-PHYSICAL] STUB — TODO slice infra dédiée (retention_days={})", retentionDays);
        // TODO: implémenter Cloudflare R2 deletion + state machine pending_file_deletions
    }
}
```

Le stub ne casse RIEN (le worker met `media_purged=TRUE` correctement, seules les images R2 ne sont pas effacées physiquement → coût stockage qui dérive jusqu'à la slice de purge physique).

> ⚠️ **Try/catch silencieux** : Python avale les erreurs de `run_purge` avec un `logger.warning`. Java DOIT préserver — une erreur de purge physique ne doit JAMAIS empêcher le UPDATE `media_purged=TRUE` (sinon le worker bouclerait sans fin).

---

## BR-40.15 — Format réponse asymétrique DELETE/Reactivate

### Règle observée

| Endpoint | Format succès |
|---|---|
| DELETE | `{"ok": true, "media_purge_scheduled_at": "ISO"}` |
| Reactivate | `{"ok": true, "reactivated": true, "product_id": "...", "media_purged": bool, "requires_media_reupload": bool}` |

| Endpoint | Format erreur |
|---|---|
| DELETE | `{"error": "..."}` (`JSONResponse`) |
| Reactivate | `{"detail": "..."}` (`HTTPException`) |

### Java
Préserver les 2 schémas distincts. Le front teste `error` pour DELETE et `detail` pour Reactivate.

---

## BR-40.16 — Datetime ISO format

### Règle (l. 502)
```python
"media_purge_scheduled_at": media_purge_at.isoformat()
```

Format Python par défaut : `2026-07-29T12:34:56.789012+00:00` (microsecondes + offset UTC).

### Java
```java
OffsetDateTime mediaPurgeAt = OffsetDateTime.now(ZoneOffset.UTC).plusDays(90);
// Sérialisation Jackson par défaut : "2026-07-29T12:34:56.789Z" OU avec offset
```

> ⚠️ Vérifier que Jackson sérialise avec **offset explicite** (`+00:00` ou `Z`), pas en local time. `JavaTimeModule` + `WRITE_DATES_AS_TIMESTAMPS=false` requis.

---

## BR-40.17 — Pas d'écriture concurrente protégée

### Règle observée
Aucun `SELECT ... FOR UPDATE`, aucun lock optimiste sur les 2 endpoints.

### Conséquence
Race condition théorique : 2 DELETE concurrents → le 2e fait UPDATE sur un row déjà supprimé (perte info `deleted_at` original, pas de double INSERT pending_file_deletions car `ON CONFLICT DO NOTHING`).

### Java
**Compat stricte** : préserver l'absence de lock. Risque négligeable (probabilité collision < seuil opérationnel).

**Amélioration optionnelle** : ajouter `AND status != 'deleted'` dans le UPDATE WHERE pour fermer (PIÈGE-DB-03).

---

## Récapitulatif des règles

| ID | Règle | Niveau |
|---|---|---|
| BR-40.01 | Auth obligatoire (DELETE + Reactivate) | 🔴 Critique |
| BR-40.02 | DELETE owner-only, AUCUN bypass admin | 🔴 Critique |
| BR-40.03 | DELETE soft + planification J+90 | 🔴 Critique |
| BR-40.04 | DELETE planifie 1 INSERT par image | 🟡 Important |
| BR-40.05 | Reactivate owner OU admin | 🔴 Critique |
| BR-40.06 | Reactivate annule pending purges (status=pending only) | 🟡 Important |
| BR-40.07 | Reactivate force status='active' | 🔴 Critique |
| BR-40.08 | Reactivate ne reset PAS media_purged | 🔴 Critique |
| BR-40.09 | Reactivate ne purge PAS image_urls[] orphelines | 🟢 Mineur |
| BR-40.10 | 2e DELETE → 404 | 🟡 Important |
| BR-40.11 | 2e Reactivate → 409 | 🟡 Important |
| BR-40.12 | Worker cadence 3600s + idempotence | 🔴 Critique |
| BR-40.13 | Worker 4 entités, 1 scheduler | 🟡 Important |
| BR-40.14 | Worker délégation `run_purge` (try/catch silencieux) | 🟡 Important |
| BR-40.15 | Format réponse asymétrique DELETE/Reactivate | 🟡 Important |
| BR-40.16 | Datetime ISO offset | 🟡 Important |
| BR-40.17 | Pas de lock concurrence (compat) | 🟢 Mineur |
