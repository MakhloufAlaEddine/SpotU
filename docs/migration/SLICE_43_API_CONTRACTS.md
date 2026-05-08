# SLICE 43 — API Contracts (Services Coach CRUD)

> **Source** : `/app/backend/routes/service_routes.py` l. 756–1104
> Tous les endpoints sont préfixés par `/api`.

---

## Conventions

- Auth : header `Authorization: Bearer <jwt>` requis.
- Content-Type : `application/json`.
- En cas d'erreur d'auth absente/invalide → `401` (par middleware `require_auth`).
- En cas de payload invalide Pydantic → `422` avec corps FastAPI standard.
- Champs nullables : explicitement notés `nullable: true` ci-dessous.

---

## 1. `POST /api/services` — Créer un service

### Permissions
- Auth requise.
- Rôle ∈ `{coach, admin}` → sinon `403 {"detail":"Coach role required"}`.

### Body (JSON)
```jsonc
{
  "title": "string (required, ≥ 5 caractères trimmed)",
  "description": "string|null",
  "address": "string|null",
  "price": "number|null  // si null → min(packages.price) ou 0",
  "duration_min": "integer (default 60)",
  "tag_ids": ["string"],                  // default []
  "domain_id": "string|null",
  "max_participants": "integer (default 1)",
  "images": ["string url"],               // default [], max 5
  "locations": [
    {
      "latitude": "number",
      "longitude": "number",
      "precision": "exact | district | city  (default exact)",
      "description": "string|null"
    }
  ],
  "packages": [ /* ⚠ deferred S45 — voir Scope §3 */ ],
  "slots":    [ /* ⚠ deferred S44 — voir Scope §3 */ ]
}
```

> **Note** : `ServiceCreate` Python n'expose **pas** les champs `booking_approval_mode`, `allow_pay_later`, `pay_later_expiration_minutes` mais le handler les lit via `getattr(...)` avec defaults `'manual_approval'` / `True` / `1440`. Pour parité, **Java doit accepter** ces champs optionnels dans le body et appliquer les mêmes defaults.

### Validations Pydantic (à reproduire)
| Champ | Règle | Erreur |
|-------|-------|--------|
| `title` | non vide, trimmed, ≥ 5 caractères | 422 « Le titre doit avoir au moins 5 caractères » |
| `images` | longueur ≤ 5 | 422 « Maximum 5 images autorisées pour un service » |
| `price` | si fourni, ≥ 0 | 422 « Le prix ne peut pas être négatif » |

### Réponse `200 OK`
```jsonc
{
  "service_id": "svc_xxxx",
  "coach_id": "usr_xxxx",
  "title": "...",
  "description": "...",
  "address": "...",
  "price": 50.0,
  "duration_min": 60,
  "tag_ids": ["..."],
  "domain_id": null,
  "location_description": null,
  "max_participants": 1,
  "active": true,
  "images": ["..."],
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "booking_approval_mode": "instant_booking | manual_approval",
  "allow_pay_later": true,
  "pay_later_expiration_minutes": 1440,
  // Champs enrichis par _enrich_service (cf. S42)
  "locations": [ ... ],
  "slots":     [ ... ],
  "packages":  [ ... ],
  "is_saved":  false
}
```

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant/invalide |
| 403 | Rôle ≠ coach/admin |
| 422 | Validation Pydantic |

### Effets de bord
1. `INSERT INTO services` (1 ligne, `active=TRUE`).
2. `INSERT INTO service_packages` × N (deferred S45).
3. `INSERT INTO service_slots` × M (deferred S44).
4. `INSERT INTO service_locations` × P (avec PostGIS `ST_SetSRID(ST_MakePoint(lon, lat), 4326)`).
5. Lecture `app_config` pour normaliser booking config.

---

## 2. `PUT /api/services/{service_id}` (idem `PATCH`) — Mettre à jour un service

> Les routes `PUT` et `PATCH` partagent **le même handler** Python. Les sémantiques sont identiques : tous les champs sont optionnels, `null` est ignoré (pas de RAZ), sauf cas explicites ci-dessous.

### Permissions
- Auth requise.
- Owner (`services.coach_id == user.user_id`) **OU** `role == 'admin'` → sinon `403 {"detail":"Not authorized"}`.

### Body (JSON, tous champs optionnels)
```jsonc
{
  "title": "string|null",
  "description": "string|null",
  "price": "number|null",
  "duration_min": "integer|null",
  "max_participants": "integer|null",
  "domain_id": "string|null",
  "tag_ids": ["string"]|null,            // null = ne pas toucher ; [] = vider
  "active": "boolean|null",
  "location_description": "string|null",
  "images": ["string"]|null,             // null = ne pas toucher ; [] = supprimer toutes ; liste = remplacer (suppression IMMÉDIATE des retirées)
  "locations": [LocationItem]|null,      // null = ne pas toucher ; [] = supprimer toutes ; liste = REMPLACER ENTIÈREMENT
  "slots": [SlotItem]|null,              // ⚠ deferred S44 — null tant que S44 non livrée
  "booking_approval_mode": "manual_approval|instant_booking",
  "allow_pay_later": "boolean|null",
  "pay_later_expiration_minutes": "integer|null"
}
```

### Sémantique critique
| Champ | `null`/absent | `[]` | Liste fournie |
|-------|---------------|------|---------------|
| `images` | non touché | toutes supprimées (sync R2) | retirées supprimées **immédiatement**, ajoutées conservées |
| `locations` | non touché | DELETE FROM service_locations WHERE service_id=$1 | DELETE puis INSERT pour chaque item |
| `slots` | non touché | DELETE FROM service_slots WHERE service_id=$1 | DELETE puis INSERT (deferred S44) |

> ⚠️ **Sémantique « None = keep »** : doit être **strictement** reproduite côté Java. Un payload partiel ne doit jamais effacer des données existantes par effet de bord.

### Champs scalaires acceptés (whitelist)
```
title, description, price, duration_min, active,
location_description, max_participants, domain_id,
booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
```
Tout autre champ scalaire doit être ignoré (pas d'erreur).

### Normalisation booking
Si `booking_approval_mode` ou `allow_pay_later` présent dans le payload :
- Charger flags via `app_config` (`enable_manual_approval_for_services`, `enable_pay_later_for_services`).
- Si flag global désactivé → forcer `mode='instant_booking'` / `pay_later=False`.
- Si `pay_later_expiration_minutes` fourni mais `enable_pay_later=false` → forcer à `None`, puis fallback `1440`.

### Réponse `200 OK`
Identique à la réponse de `POST` (objet `service` enrichi).

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant/invalide |
| 403 | Pas owner et pas admin |
| 404 | `service_id` inconnu |
| 422 | Validation Pydantic |

### Effets de bord
1. Suppression **immédiate** des images retirées via `delete_upload_files()` (R2 / local FS).
2. `UPDATE services SET <champs>, updated_at=NOW() WHERE service_id=$1`.
3. Si `locations` fourni → `DELETE FROM service_locations` + `INSERT` × N.
4. Si `slots` fourni → `DELETE FROM service_slots` + `INSERT` × M (deferred S44).
5. JSONB : `tag_ids` et `images` poussés avec cast `::jsonb`.

---

## 3. `DELETE /api/services/{service_id}` — Soft-delete

### Permissions
- Auth requise.
- Owner OR admin → sinon `403 {"detail":"Not authorized"}`.

### Garde « bookings actifs » (sauf admin)
```sql
SELECT COUNT(*) FROM bookings
WHERE service_id = $1
  AND status IN ('pending','accepted','awaiting_payment','confirmed')
```
Si `> 0` et `role != 'admin'` → **409**
```json
{ "detail": "Impossible de supprimer : N réservation(s) active(s) sur ce service. Annulez-les d'abord." }
```

### Réponse `200 OK`
```jsonc
{
  "success": true,
  "media_purge_scheduled_at": "ISO8601 (now + 90 jours)"
}
```

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant/invalide |
| 403 | Pas owner et pas admin |
| 404 | `service_id` inconnu |
| 409 | Bookings actifs (coach uniquement) |

### Effets de bord
1. `UPDATE services SET active=FALSE, deleted_at=NOW(), deleted_by=user_id, updated_at=NOW(), media_purge_scheduled_at=NOW()+90j WHERE service_id=$1`.
2. `UPDATE conversations SET context_deleted=TRUE WHERE context_id=$1 AND context_deleted=FALSE` (toutes les conversations du contexte service).
3. Pour chaque image dans `services.images` :
   ```sql
   INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at)
   VALUES (<url>, 'service', <service_id>, <media_purge_at>)
   ON CONFLICT DO NOTHING
   ```

> ⚠️ **Pas de suppression immédiate** : les images sont SEULEMENT programmées. Le worker `media_purge_worker` (déjà migré en S40) les supprimera après 90j.

---

## 4. `POST /api/services/{service_id}/reactivate` — Réactiver un service

### Permissions
- Auth requise.
- Owner OR admin → sinon `403 {"detail":"Non autorisé"}`.

### Pré-conditions
| État service | Comportement |
|--------------|--------------|
| Inexistant | `404 {"detail":"Service introuvable"}` |
| `active=TRUE AND deleted_at IS NULL` | `409 {"detail":"Ce service est déjà actif"}` |
| `active=FALSE` (peu importe `media_purged`) | OK, voir effets ci-dessous |

### Réponse `200 OK`
```jsonc
{
  "success": true,
  "reactivated": true,
  "service_id": "svc_xxxx",
  "media_purged": false | true,
  "requires_media_reupload": false | true   // == media_purged
}
```

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant/invalide |
| 403 | Pas owner et pas admin |
| 404 | `service_id` inconnu |
| 409 | Service déjà actif |

### Effets de bord
1. `DELETE FROM pending_file_deletions WHERE entity_id=$1 AND status='pending'` (annule la purge programmée).
2. ```sql
   UPDATE services
      SET active=TRUE,
          deleted_at=NULL,
          deleted_by=NULL,
          updated_at=NOW(),
          media_purge_scheduled_at=NULL,
          media_purge_notified_at=NULL,
          reactivated_at=NOW()
    WHERE service_id=$1
   ```
3. `UPDATE conversations SET context_deleted=FALSE WHERE context_id=$1 AND context_deleted=TRUE` (rouvre les convos archivées).

> ⚠️ **`media_purged=TRUE`** signifie que le worker a déjà purgé les fichiers (≥ 90j). Le service est réactivé **sans images**, et le front doit demander un nouvel upload (`requires_media_reupload: true`).

---

## 5. Format d'erreur standard FastAPI (à reproduire)

```json
{ "detail": "Message d'erreur" }
```

Pour les erreurs de validation Pydantic (`422`) :
```json
{
  "detail": [
    {
      "type": "value_error",
      "loc": ["body","title"],
      "msg": "Le titre doit avoir au moins 5 caractères",
      "input": "abc"
    }
  ]
}
```

---

## 6. Tableau récapitulatif HTTP

| Endpoint | 200 | 401 | 403 | 404 | 409 | 422 |
|----------|-----|-----|-----|-----|-----|-----|
| POST /services | ✅ | ✅ | ✅ (rôle) | — | — | ✅ |
| PUT/PATCH /services/{id} | ✅ | ✅ | ✅ (owner) | ✅ | — | ✅ |
| DELETE /services/{id} | ✅ | ✅ | ✅ (owner) | ✅ | ✅ (bookings) | — |
| POST /services/{id}/reactivate | ✅ | ✅ | ✅ (owner) | ✅ | ✅ (already active) | — |
