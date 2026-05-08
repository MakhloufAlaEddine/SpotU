# SLICE 43 — Business Rules (Services Coach CRUD)

> **Source** : `/app/backend/routes/service_routes.py` + `/app/backend/models.py`
> Toutes les règles ci-dessous DOIVENT être reproduites **à l'identique** côté Java.

---

## 1. Validations d'entrée (Pydantic → Java Bean Validation / manuelle)

### `ServiceCreate`
| Champ | Règle | Code erreur | Message exact |
|-------|-------|-------------|---------------|
| `title` | non vide après `trim()`, longueur ≥ 5 | 422 | `Le titre doit avoir au moins 5 caractères` |
| `images` | si présent et non null, taille ≤ 5 | 422 | `Maximum 5 images autorisées pour un service` |
| `price` | si présent et non null, ≥ 0 | 422 | `Le prix ne peut pas être négatif` |
| Tous les autres champs | passe-droit (defaults Pydantic) | — | — |

> Le `title` est **automatiquement trimmé** avant insertion (`return v.strip()` dans le validator).

### `ServiceUpdate`
- Aucune validation Pydantic supplémentaire au-delà des types.
- Tous les champs sont optionnels (`Optional[...] = None`).
- ⚠️ **Asymétrie** : pas de validation `title ≥ 5 chars` ni `images ≤ 5` ni `price ≥ 0` sur le PUT/PATCH (alors qu'elles existent sur POST). À reproduire à l'identique côté Java (NE PAS ajouter de validation manquante).

---

## 2. Permissions

### POST /services
- Auth requise.
- `user.role ∈ {coach, admin}` :
  - `role == 'user'` → `403 Coach role required`.

### PUT/PATCH /services/{id}
- Auth requise.
- `services.coach_id == user.user_id` **OU** `user.role == 'admin'`.
  - Sinon → `403 Not authorized`.
- Si service introuvable → `404 Service not found`.

### DELETE /services/{id}
- Auth requise.
- Owner OR admin (sinon `403 Not authorized`).
- Si service introuvable → `404 Service not found`.
- **Garde supplémentaire** : si `role != 'admin'`, blocage 409 si bookings actifs.

### POST /services/{id}/reactivate
- Auth requise.
- Owner OR admin (sinon `403 Non autorisé`).
- Si service introuvable → `404 Service introuvable`.
- Si déjà actif → `409 Ce service est déjà actif`.

> **Note importante** : les messages 403/404 du REACTIVATE sont en **français** dans le code Python (`Service introuvable`, `Non autorisé`), ceux de DELETE/UPDATE en **anglais** (`Service not found`, `Not authorized`). À reproduire **strictement** pour parité (le front peut les afficher tels quels).

---

## 3. Statut & lifecycle service

### États possibles
| État | `active` | `deleted_at` | `media_purged` | Description |
|------|----------|--------------|----------------|-------------|
| Brouillon créé | `TRUE` | `NULL` | `FALSE` | Juste après POST |
| Actif normal | `TRUE` | `NULL` | `FALSE` | État de service en service |
| Désactivé manuel (par UPDATE active=false) | `FALSE` | `NULL` | `FALSE` | UPDATE active=false par owner — **PAS** de soft delete |
| Soft-deleted (DELETE) | `FALSE` | `NOW()` | `FALSE` | < 90j, médias récupérables |
| Soft-deleted purgé | `FALSE` | `<90j+>` | `TRUE` | ≥ 90j, médias supprimés par worker |
| Réactivé < 90j | `TRUE` | `NULL` | `FALSE` | Restauration complète avec médias |
| Réactivé ≥ 90j | `TRUE` | `NULL` | `TRUE` | Restauration **sans** médias, front doit re-upload |

### Transitions
```
[Actif] --DELETE--> [Soft-deleted] --90j-> [Soft-deleted purgé]
                          ^                       |
                          |                       |
                          +-----REACTIVATE--------+
                                ↑
                                |
                         media_purge_scheduled_at = NULL
                         pending_file_deletions DELETED
```

> ⚠️ Distinction subtile : un UPDATE `active=false` **n'est pas** un soft-delete (pas de `deleted_at`, pas de purge programmée, pas de blocage bookings).

---

## 4. Lifecycle DELETE (soft delete + retention médias 90j)

### Constante
- `MEDIA_RETENTION_DAYS = 90` (hardcodée dans `delete_service`, l. 989).

### Effets atomiques
1. `services.active = FALSE`.
2. `services.deleted_at = NOW()`.
3. `services.deleted_by = user.user_id` (peut être admin si action admin).
4. `services.updated_at = NOW()` (= `deleted_at`).
5. `services.media_purge_scheduled_at = NOW() + 90 jours`.
6. `conversations.context_deleted = TRUE` pour toutes les convos liées (`context_id == service_id`).
7. Pour chaque image (parsed depuis `services.images` JSONB) :
   - `INSERT INTO pending_file_deletions(file_url, entity_type='service', entity_id, scheduled_at) ON CONFLICT DO NOTHING`.

### Garde « bookings actifs »
- Statuts considérés actifs : `pending`, `accepted`, `awaiting_payment`, `confirmed`.
- Si COUNT > 0 et user n'est **pas** admin → 409 (avec compteur dans le message).
- Admin **bypasse** la garde et peut supprimer même avec bookings actifs.

### Pas de suppression immédiate des fichiers
- Aucun appel à `delete_upload_files` lors du DELETE (contrairement à UPDATE).
- Les fichiers ne sont supprimés que par le worker `media_purge_worker` après 90j.

---

## 5. Lifecycle REACTIVATE

### Pré-condition forte
- 409 si `active=TRUE AND deleted_at IS NULL` (déjà actif).
- Accepté pour tout autre état (désactivé manuel, soft-deleted < 90j, soft-deleted purgé ≥ 90j).

### Effets atomiques
1. `DELETE FROM pending_file_deletions WHERE entity_id=service_id AND status='pending'`.
2. `services.active = TRUE`.
3. `services.deleted_at = NULL`.
4. `services.deleted_by = NULL`.
5. `services.updated_at = NOW()`.
6. `services.media_purge_scheduled_at = NULL`.
7. `services.media_purge_notified_at = NULL`.
8. `services.reactivated_at = NOW()`.
9. `conversations.context_deleted = FALSE` pour toutes les convos archivées du service.

### Réponse `requires_media_reupload`
- Lecture de `services.media_purged` **AVANT** l'UPDATE (mais c'est de la lecture, pas modifié).
- Si `media_purged == TRUE` → `requires_media_reupload: true`.
- Le champ `media_purged` reste `TRUE` après réactivation (le front sait alors qu'il doit ré-uploader).

> ⚠️ **PAS** de remise à `media_purged = FALSE` sur réactivation. Le champ reflète l'historique de la purge, pas l'état courant.

---

## 6. Médias / Images

### Source unique
- Stockage : Cloudflare R2 (prod) ou FS local (dev).
- Référencement : tableau JSONB `services.images` (URLs strings).
- Limite : **5 images max** (validation `ServiceCreate.images_max_count`).
- ⚠️ Pas de limite sur PUT/PATCH côté Pydantic (asymétrie).

### POST
- `images` du payload est inséré tel quel dans `services.images`.

### PUT/PATCH — Diff & purge **immédiate**
1. Récupérer `old_images` via `SELECT images FROM services WHERE service_id = $1`.
2. Parser : si string, `json.loads`; si liste, utiliser direct; sinon `[]`.
3. `new_images = data.images or []`.
4. `removed = [u for u in old_images if u not in new_images]`.
5. Si `removed` non vide → `delete_upload_files(removed)` (suppression **synchrone** R2/FS).
6. Push `images = new_images` en JSONB.

> ⚠️ **Distinction critique** : payload `images=null` (champ absent) → pas de touche. `images=[]` → toutes supprimées immédiatement. `images=[A,C]` alors qu'on avait `[A,B,C]` → B supprimé immédiatement.

### DELETE — Programmation 90j
- Voir §4 ci-dessus. Pas d'appel synchrone.

---

## 7. Normalisation booking config

### Source des flags
- Table `app_config`, lignes `enable_manual_approval_for_services` et `enable_pay_later_for_services`.
- Convention de stockage : `config_value` est un **string** ; flag actif ⇔ `config_value == 'true'`.

### Algorithme `_normalize_booking_config(mode, pay_later, expiry, flags)`
```pseudo
mode      = mode or 'instant_booking'   # never null
pay_later = pay_later
expiry    = expiry

if not flags.enable_manual_approval:
    mode = 'instant_booking'
if not flags.enable_pay_later:
    pay_later = False
    expiry    = None

return (mode, pay_later, expiry)
```

### Application sur POST
- `raw_mode = data.booking_approval_mode or 'manual_approval'`.
  > ⚠️ Note : ServiceCreate **n'expose pas** ce champ ; donc en pratique `getattr(data, 'booking_approval_mode', None)` est toujours `None`, donc `raw_mode = 'manual_approval'`.
- `raw_pay_later = data.allow_pay_later if not None else True` (default `True`).
- `raw_expiry = data.pay_later_expiration_minutes or 1440`.
- Normaliser via flags.
- Persister `expiry or 1440` (donc jamais NULL en DB).

### Application sur PUT/PATCH
- Si `booking_approval_mode` ou `allow_pay_later` dans `update_dict` :
  - Charger flags.
  - Normaliser avec defaults : `mode='instant_booking'`, `pay_later=False`, `expiry=1440`.
  - Réinjecter dans `update_dict` les champs présents.

### Asymétrie Python à conserver
- POST : default mode = `'manual_approval'`.
- PUT  : default mode = `'instant_booking'` dans la normalisation.
- C'est une **asymétrie réelle** dans le code Python — à reproduire côté Java pour iso-comportement.

---

## 8. Calcul du prix sur POST

```python
service_price = data.price
if service_price is None:
    service_price = min((p.price for p in data.packages), default=0.0)
```
- Si `price` fourni → utiliser tel quel (même 0).
- Si `price=null` ET `packages` non vide → min des prix de packages.
- Si `price=null` ET `packages` vide → `0.0`.

> Sur PUT/PATCH : le price n'est **jamais** recalculé depuis les packages. C'est uniquement sur création.

---

## 9. Conversations liées

### Critère de jointure
- `conversations.context_id = services.service_id`.
- Pas de filtre par `context_type` dans le code actuel (asymétrie potentielle si plusieurs entités partagent un même `context_id`, mais en pratique IDs préfixés `svc_*` donc pas de collision).

### DELETE → archive convos non archivées
```sql
UPDATE conversations SET context_deleted=TRUE
 WHERE context_id=$1 AND context_deleted=FALSE
```

### REACTIVATE → désarchive convos archivées
```sql
UPDATE conversations SET context_deleted=FALSE
 WHERE context_id=$1 AND context_deleted=TRUE
```

> Pas d'erreur si aucune convo n'est concernée — silent no-op acceptable.

---

## 10. Asymétries Python à conserver (NE PAS « corriger »)

| # | Asymétrie | Détail |
|---|-----------|--------|
| 1 | Validations partielles sur PUT | Pas de min length title, pas de cap images, pas de check price ≥ 0 sur PUT/PATCH. |
| 2 | Defaults booking diff POST/PUT | `manual_approval` (POST) vs `instant_booking` (PUT). |
| 3 | Champs booking absents de `ServiceCreate` Pydantic | Mais lus via `getattr` ; doivent être acceptés en body Java. |
| 4 | UPDATE images = purge sync ; DELETE service = purge programmée | Comportements différents pour le même type de fichier. |
| 5 | Pas de transaction explicite | Aucun `conn.transaction()` ; recommander `@Transactional` côté Java sans changer la sémantique fonctionnelle. |
| 6 | `media_purged` ne repasse pas à FALSE après réactivation | Garde l'historique. |
| 7 | `pay_later_expiration_minutes` jamais NULL en DB | Forcé à `1440` côté insertion/update si non fourni. |
| 8 | DELETE n'envoie pas de notif | Aucun appel à un service de notification dans le handler. |
| 9 | Reactivate ne re-publie pas le service ailleurs | Pas de réindexation, pas de webhook. |
| 10 | Pas de log d'audit explicite | Aucun INSERT dans une table d'audit. À garder identique. |

---

## 11. Compatibilité front (à conserver pour éviter régression)

- Réponses POST/PUT/PATCH : objet service complet enrichi (cf. S42).
- Réponse DELETE : `{success, media_purge_scheduled_at}` (ISO).
- Réponse REACTIVATE : `{success, reactivated, service_id, media_purged, requires_media_reupload}`.
- Messages français/anglais conservés.
- Codes 401/403/404/409/422 stricts.

---

## 12. Hors scope (à NE PAS implémenter dans S43)

- Persistance détaillée des `slots[]` (recurring/single/availability, days_of_week, location_index, raw_schedule) → **S44**.
- Persistance des `packages[]` et de leurs `slots[]` nested → **S45**.
- Endpoints `save/unsave` → slice favoris dédiée.
- Notifications email/push lors du DELETE/REACTIVATE → hors-périmètre actuel.
- Audit log → hors-périmètre actuel.
- Réindexation moteur de recherche → hors-périmètre.
