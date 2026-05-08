# SLICE 46 — API Contracts (Save / Unsave Services)

> **Source** : `/app/backend/routes/service_routes.py` l. 1107–1132
> Endpoints préfixés par `/api`.

---

## 1. `POST /api/services/{service_id}/save` — Ajouter aux favoris

### Permissions
- JWT requis (`require_auth`) — sinon 401.
- Aucune vérification de rôle.

### Path parameter
- `service_id` : ID du service à sauvegarder.

### Body
- **Aucun** (POST sans body).

### Comportement Python (à reproduire)
```pseudo
1. user = require_auth(request, pool)              # 401 si KO
2. existing = SELECT 1 FROM services
              WHERE service_id = $1 AND active = TRUE
3. if not existing:
       raise HTTPException(404, "Service not found")
4. sid = new_id("svs")
5. INSERT INTO service_saves (save_id, service_id, user_id)
   VALUES ($1, $2, $3)
   ON CONFLICT DO NOTHING                            # idempotent
6. return {"success": True, "is_saved": True}
```

### Réponse `200 OK`
```json
{ "success": true, "is_saved": true }
```

### Erreurs
| Code | Cas | Body |
|------|-----|------|
| 401 | JWT manquant ou invalide | (par middleware auth) |
| 404 | Service inexistant **OU** `active=FALSE` | `{"detail":"Service not found"}` |

> ⚠️ **Important** : un service `active=FALSE` (désactivé manuellement) ou soft-deleted (`deleted_at NOT NULL`) répond **404**, même s'il existe. Le filtre est `active = TRUE`.

### Effets de bord
- Si pas déjà en favoris : `INSERT INTO service_saves` (1 ligne).
- Si déjà en favoris : aucun INSERT (ON CONFLICT DO NOTHING), pas de mise à jour de `saved_at`.
- Pas de notification, pas de log d'audit.

---

## 2. `DELETE /api/services/{service_id}/unsave` — Retirer des favoris

> ⚠️ **PATH ASYMÉTRIQUE** : le DELETE utilise `/unsave` (et non `/save`). À reproduire **strictement** côté Java.

### Permissions
- JWT requis (`require_auth`) — sinon 401.
- Aucune vérification de rôle.

### Path parameter
- `service_id` : ID du service à retirer des favoris.

### Body
- **Aucun**.

### Comportement Python (à reproduire)
```pseudo
1. user = require_auth(request, pool)              # 401 si KO
2. DELETE FROM service_saves
   WHERE service_id = $1 AND user_id = $2          # silent, idempotent
3. return {"success": True, "is_saved": False}
```

### Réponse `200 OK`
```json
{ "success": true, "is_saved": false }
```

### Erreurs
| Code | Cas |
|------|-----|
| 401 | JWT manquant ou invalide |

> ⚠️ **Aucun 404** : même si le `service_id` n'existe pas, ou si l'utilisateur n'avait jamais sauvegardé ce service, la réponse est **200 OK** silent. Iso Python.

### Effets de bord
- Si la ligne existe : DELETE 1 ligne.
- Si la ligne n'existe pas : aucun effet, réponse identique 200.
- Le DELETE filtre **uniquement** par `(service_id, user_id)` — un utilisateur ne peut désauvegarder que ses propres favoris (filtre `user_id = $2`).

---

## 3. Format réponse standard

```json
{ "success": true, "is_saved": true|false }
```

- Boolean `is_saved` reflète **toujours** l'état logique de la ligne (POST → true, DELETE → false), pas un read effectif.
- `success` toujours `true` (ou erreur HTTP avant).

---

## 4. Tableau récapitulatif HTTP

| Endpoint | 200 | 401 | 404 |
|----------|:---:|:---:|:---:|
| POST /services/{id}/save | ✅ | ✅ | ✅ (si inactif/inexistant) |
| DELETE /services/{id}/unsave | ✅ | ✅ | — (jamais 404) |

---

## 5. Cohérence avec `GET /services/saved` (S42)

> Migré en S42, format **plat** distinct (cf. PRD). Lecture seule.

```sql
SELECT json_build_object(
  'service_id', s.service_id,
  'title', s.title,
  ...
)
FROM service_saves ss
JOIN services s ON s.service_id = ss.service_id
WHERE ss.user_id = $1
  AND s.active = TRUE
ORDER BY ss.saved_at DESC
```

> ⚠️ **Asymétrie** : `GET /saved` filtre `s.active = TRUE` (cohérent avec POST /save).
> Mais le DELETE /unsave **ne filtre pas** sur `active`. Donc un favori peut être ajouté seulement si actif, mais désauvegardé même si inactif (utile pour purger des favoris devenus inactifs).
