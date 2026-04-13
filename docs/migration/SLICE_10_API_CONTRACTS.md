# SLICE_10_API_CONTRACTS.md — Contrats d'API exacts
> Basé sur `domain_routes.py:11–140`.
> Généré le 2026-02-XX.

---

## ENDPOINT 1 — GET /api/domains

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin Python | `/api/domains` |
| Chemin Java | `/api/domains` |
| Auth | **AUCUNE** — endpoint totalement public |
| Pagination | **NON** — pas de LIMIT |
| Tri | `ORDER BY name ASC` |
| Handler | `get_domains()` — `domain_routes.py:11–19` |

### Query Parameters

| Param | Type | Obligatoire | Défaut | Description |
|---|---|---|---|---|
| `include_inactive` | `boolean` | NON | `false` | Si `true` → retourne TOUS les domaines y compris inactifs |

### Comportement exact

```python
# domain_routes.py:14-18
if include_inactive:
    rows = await conn.fetch("SELECT * FROM domains ORDER BY name")
else:
    rows = await conn.fetch("SELECT * FROM domains WHERE active = TRUE ORDER BY name")
```

- `include_inactive=false` (défaut) → filtre `active = TRUE`
- `include_inactive=true` → aucun filtre, tous les domaines retournés
- Ce paramètre est **public** — aucune vérification de rôle

### Réponse — HTTP 200

```json
[
  {
    "domain_id": "dom_sport",
    "name": "sport",
    "label_fr": "Sport & Fitness",
    "label_en": "Sport & Fitness",
    "icon": "dumbbell",
    "color": "#1DBF73",
    "active": true,
    "created_at": "2026-01-01T00:00:00.000000+00:00"
  }
]
```

### Schéma d'un domaine

| Champ | Type JSON | Java | Nullable | Source |
|---|---|---|---|---|
| `domain_id` | string | String | NON | PK `domains.domain_id` |
| `name` | string | String | NON | `domains.name` |
| `label_fr` | string | String | NON | `domains.label_fr` |
| `label_en` | string | String | NON | `domains.label_en` |
| `icon` | string | String | NON | `domains.icon` |
| `color` | string | String | OUI (défaut `#1DBF73`) | `domains.color` |
| `active` | boolean | boolean | OUI (défaut true) | `domains.active` |
| `created_at` | string ISO | String | OUI | `domains.created_at` |

### Codes d'erreur

| Code | Condition |
|---|---|
| 200 | Toujours — liste vide `[]` si aucun domaine actif |
| 500 | DB inaccessible (non géré) |

---

## ENDPOINT 2 — GET /api/tags/categories

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin Python | `/api/tags/categories` |
| Chemin Java | `/api/tags/categories` |
| Auth | **AUCUNE** — endpoint totalement public |
| Pagination | **NON** — pas de LIMIT |
| Tri | `ORDER BY tc.name ASC` (catégories) + `ORDER BY t.name ASC` (tags) |
| Handler | `get_categories()` — `domain_routes.py:36–85` |

### Query Parameters

| Param | Type | Obligatoire | Défaut | Description |
|---|---|---|---|---|
| `domain_id` | string | NON | `null` | Filtre catégories par domaine |
| `entity_type` | string | NON | `null` | Filtre catégories par type d'entité (`spotyou`, `service`, `product`) |

### Comportement exact

```python
# domain_routes.py:43-51
conditions = ["tc.active = TRUE"]
params = []
if domain_id:
    params.append(domain_id)
    conditions.append(f"tc.domain_id = ${len(params)}")
if entity_type:
    params.append(entity_type)
    conditions.append(f"tc.entity_type = ${len(params)}")
where = " AND ".join(conditions)
```

**Requête 1 — catégories :**
```sql
SELECT * FROM tag_categories tc WHERE tc.active = TRUE [AND tc.domain_id = $1] [AND tc.entity_type = $N] ORDER BY tc.name
```

**Requête 2 — tags liés (si catégories trouvées) :**
```sql
SELECT t.*, tcl.category_id as linked_category_id
FROM tags t
JOIN tag_category_links tcl ON t.tag_id = tcl.tag_id
WHERE t.active = TRUE AND tcl.category_id = ANY($1)
ORDER BY t.name
```

Si la requête 1 ne retourne aucune catégorie → `tag_rows = []` (pas de requête 2).

**Groupement Python :**
```python
tags_by_category: dict = {}
for tag in tag_rows:
    t = row_to_dict(tag)
    cid = t.pop("linked_category_id", None)  # ← champ auxiliaire supprimé de la réponse
    if cid:
        tags_by_category.setdefault(cid, []).append(t)

result = []
for cat in cat_rows:
    c = row_to_dict(cat)
    c["tags"] = tags_by_category.get(c["category_id"], [])
    result.append(c)
```

- `linked_category_id` est **retiré** (`pop`) de chaque tag dans la réponse finale
- Catégories sans aucun tag actif reçoivent `"tags": []`

### Réponse — HTTP 200

```json
[
  {
    "category_id": "cat_yoga",
    "domain_id": "dom_sport",
    "entity_type": "service",
    "name": "yoga",
    "label_fr": "Yoga",
    "label_en": "Yoga",
    "icon": "lotus",
    "active": true,
    "created_at": "2026-01-01T00:00:00.000000+00:00",
    "tags": [
      {
        "tag_id": "tag_hatha",
        "category_id": "cat_yoga",
        "domain_id": "dom_sport",
        "name": "hatha",
        "label_fr": "Hatha Yoga",
        "label_en": "Hatha Yoga",
        "icon": "leaf",
        "active": true,
        "created_at": "2026-01-02T00:00:00.000000+00:00"
      }
    ]
  }
]
```

### Schéma d'une catégorie

| Champ | Type JSON | Java | Nullable | Source |
|---|---|---|---|---|
| `category_id` | string | String | NON | PK `tag_categories.category_id` |
| `domain_id` | string\|null | String | OUI | `tag_categories.domain_id` |
| `entity_type` | string\|null | String | OUI | `tag_categories.entity_type` |
| `name` | string | String | NON | `tag_categories.name` |
| `label_fr` | string | String | NON | `tag_categories.label_fr` |
| `label_en` | string | String | NON | `tag_categories.label_en` |
| `icon` | string | String | NON | `tag_categories.icon` |
| `active` | boolean | boolean | OUI | `tag_categories.active` |
| `created_at` | string ISO | String | OUI | `tag_categories.created_at` |
| `tags` | array | List\<TagDto\> | NON ([] si vide) | Enrichissement Python |

### Schéma d'un tag (dans `tags[]`)

| Champ | Type JSON | Java | Nullable | Source |
|---|---|---|---|---|
| `tag_id` | string | String | NON | PK `tags.tag_id` |
| `category_id` | string\|null | String | OUI | `tags.category_id` |
| `domain_id` | string\|null | String | OUI | `tags.domain_id` |
| `name` | string | String | NON | `tags.name` |
| `label_fr` | string | String | NON | `tags.label_fr` |
| `label_en` | string | String | NON | `tags.label_en` |
| `icon` | string\|null | String | OUI | `tags.icon` |
| `active` | boolean | boolean | OUI | `tags.active` |
| `created_at` | string ISO | String | OUI | `tags.created_at` |

**Note :** `linked_category_id` est présent dans le SELECT SQL mais **supprimé** avant sérialisation — ne pas l'exposer en Java.

### Codes d'erreur

| Code | Condition |
|---|---|
| 200 | Toujours — liste vide `[]` si aucune catégorie active |
| 500 | DB inaccessible (non géré) |

---

## ENDPOINT 3 — GET /api/tags

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin Python | `/api/tags` |
| Chemin Java | `/api/tags` |
| Auth | **AUCUNE** — endpoint totalement public |
| Pagination | **NON** — LIMIT 200 hardcodé (sauf branche sans filtre) |
| Tri | `ORDER BY t.name ASC` (ou `ORDER BY name ASC`) |
| Handler | `get_tags()` — `domain_routes.py:102–140` |

### Query Parameters

| Param | Type | Obligatoire | Défaut | Description |
|---|---|---|---|---|
| `domain_id` | string | NON | `null` | Filtre par domaine |
| `category_id` | string | NON | `null` | Filtre par catégorie (via JOIN `tag_category_links`) |
| `entity_type` | string | NON | `null` | Filtre par type d'entité (via JOIN `tag_entity_type_links`) |

### Comportement exact — 3 branches SQL

```python
# domain_routes.py:122-140
if category_id or entity_type:
    # BRANCHE A — JOINs conditionnels
    join_clause = ""
    if category_id:
        join_clause += " JOIN tag_category_links tcl ON t.tag_id = tcl.tag_id"
    if entity_type:
        join_clause += " JOIN tag_entity_type_links tetl ON t.tag_id = tetl.tag_id"
    where = " AND ".join(conditions)
    rows = await conn.fetch(
        f"SELECT DISTINCT t.* FROM tags t{join_clause} WHERE {where} ORDER BY t.name LIMIT 200",
        *params
    )
elif domain_id:
    # BRANCHE B — Filtre direct sur domain_id
    rows = await conn.fetch(
        "SELECT * FROM tags t WHERE t.active = TRUE AND t.domain_id = $1 ORDER BY t.name LIMIT 200",
        domain_id
    )
else:
    # BRANCHE C — Tous les tags actifs
    rows = await conn.fetch("SELECT * FROM tags WHERE active = TRUE ORDER BY name LIMIT 200")
```

**Important :** `DISTINCT` est ajouté uniquement dans la branche A.

### Réponse — HTTP 200

```json
[
  {
    "tag_id": "tag_hatha",
    "category_id": "cat_yoga",
    "domain_id": "dom_sport",
    "name": "hatha",
    "label_fr": "Hatha Yoga",
    "label_en": "Hatha Yoga",
    "icon": "leaf",
    "active": true,
    "created_at": "2026-01-02T00:00:00.000000+00:00"
  }
]
```

### Schéma d'un tag (réponse plate — pas d'imbrication)

Identique au schéma des tags dans `GET /api/tags/categories` **sans** le champ `linked_category_id`.

| Champ | Type JSON | Java | Nullable |
|---|---|---|---|
| `tag_id` | string | String | NON |
| `category_id` | string\|null | String | OUI |
| `domain_id` | string\|null | String | OUI |
| `name` | string | String | NON |
| `label_fr` | string | String | NON |
| `label_en` | string | String | NON |
| `icon` | string\|null | String | OUI |
| `active` | boolean | boolean | OUI |
| `created_at` | string ISO | String | OUI |

### Codes d'erreur

| Code | Condition |
|---|---|
| 200 | Toujours — liste vide `[]` si aucun tag correspondant |
| 500 | DB inaccessible (non géré) |
