# SLICE_10_DB_MAPPING.md — Mapping base de données
> Basé sur `domain_routes.py:11–140`, `001_initial_schema.sql:94–514`.
> Généré le 2026-02-XX.

---

## Tables impliquées

| Table | Rôle | Endpoints concernés |
|---|---|---|
| `domains` | Référentiel principal des domaines | GET /domains |
| `tag_categories` | Catégories de tags, liées aux domaines | GET /tags/categories |
| `tags` | Tags individuels, liés aux catégories et domaines | GET /tags/categories + GET /tags |
| `tag_category_links` | Table de liaison many-to-many tag ↔ catégorie | GET /tags/categories + GET /tags (branche A) |
| `tag_entity_type_links` | Liaison tag ↔ type d'entité | GET /tags (branche A, si entity_type) |

---

## Schémas des tables

### Table `domains`

```sql
CREATE TABLE public.domains (
    domain_id   text NOT NULL,           -- PK
    name        text NOT NULL,           -- clé interne
    label_fr    text NOT NULL,
    label_en    text NOT NULL,
    icon        text NOT NULL,
    color       text DEFAULT '#1DBF73',
    active      boolean DEFAULT true,
    created_at  timestamp with time zone DEFAULT now()
);
-- PK : domains_pkey (domain_id)
```

**Colonnes retournées :** TOUTES (SELECT *)

### Table `tag_categories`

```sql
CREATE TABLE public.tag_categories (
    category_id  text NOT NULL,          -- PK
    domain_id    text,                   -- FK → domains.domain_id (nullable)
    entity_type  text,                   -- 'spotyou' | 'service' | 'product' | null
    name         text NOT NULL,
    label_fr     text NOT NULL,
    label_en     text NOT NULL,
    icon         text NOT NULL,
    active       boolean DEFAULT true,
    created_at   timestamp with time zone DEFAULT now()
);
-- PK : tag_categories_pkey (category_id)
-- Index : idx_tag_categories_entity_type (entity_type)
```

**Colonnes retournées :** TOUTES (SELECT *)

### Table `tags`

```sql
CREATE TABLE public.tags (
    tag_id      text NOT NULL,           -- PK
    category_id text,                   -- FK → tag_categories.category_id (nullable)
    domain_id   text,                   -- FK → domains.domain_id (nullable)
    name        text NOT NULL,
    label_fr    text NOT NULL,
    label_en    text NOT NULL,
    icon        text,                   -- nullable
    active      boolean DEFAULT true,
    created_at  timestamp with time zone DEFAULT now()
);
-- PK : tags_pkey (tag_id)
```

**Colonnes retournées :** `t.*` (toutes)

### Table `tag_category_links`

```sql
CREATE TABLE public.tag_category_links (
    tag_id      text NOT NULL,           -- FK → tags.tag_id ON DELETE CASCADE
    category_id text NOT NULL,           -- FK → tag_categories.category_id ON DELETE CASCADE
    -- PK composite : (tag_id, category_id)
);
-- Index : idx_tag_category_links_cat (category_id)
```

**Colonnes retournées :** `tcl.category_id as linked_category_id` (colonne auxiliaire, supprimée avant réponse)

### Table `tag_entity_type_links`

```sql
CREATE TABLE public.tag_entity_type_links (
    tag_id      text NOT NULL,           -- FK → tags.tag_id ON DELETE CASCADE
    entity_type text NOT NULL,           -- CHECK IN ('spotyou', 'service', 'product')
    -- PK composite : (tag_id, entity_type)
);
-- Index : idx_tag_entity_type_links_type (entity_type)
-- Contrainte CHECK : entity_type IN ('spotyou', 'service', 'product')
```

---

## Requêtes SQL exactes par endpoint

### GET /api/domains

#### Sans filtre (défaut `include_inactive=false`)
```sql
SELECT * FROM domains
WHERE active = TRUE
ORDER BY name
-- Pas de LIMIT
```

#### Avec `include_inactive=true`
```sql
SELECT * FROM domains
ORDER BY name
-- Pas de LIMIT, pas de filtre active
```

**Mapping réponse :**
```
domains.domain_id  → "domain_id"
domains.name       → "name"
domains.label_fr   → "label_fr"
domains.label_en   → "label_en"
domains.icon       → "icon"
domains.color      → "color"
domains.active     → "active"
domains.created_at → "created_at"
```

---

### GET /api/tags/categories

#### Requête 1 — catégories (toujours exécutée)
```sql
SELECT * FROM tag_categories tc
WHERE tc.active = TRUE
  [AND tc.domain_id = $1]       -- si domain_id fourni
  [AND tc.entity_type = $N]     -- si entity_type fourni
ORDER BY tc.name
-- Pas de LIMIT
```

#### Requête 2 — tags liés (exécutée uniquement si requête 1 retourne des résultats)
```sql
SELECT t.*, tcl.category_id as linked_category_id
FROM tags t
JOIN tag_category_links tcl ON t.tag_id = tcl.tag_id
WHERE t.active = TRUE
  AND tcl.category_id = ANY($1)  -- $1 = tableau des category_id de la requête 1
ORDER BY t.name
-- Pas de LIMIT
```

**Note :** `ANY($1)` avec un tableau de text IDs — en Java utiliser `IN` ou `= ANY(?)` en SQL natif.

#### Groupement Python (à reproduire en Java)
```
tags_by_category = Map<category_id, List<Tag>>

Pour chaque tag :
  - supprimer linked_category_id
  - ajouter tag dans la liste de sa catégorie

Pour chaque catégorie :
  - ajouter champ "tags" = tags_by_category.getOrDefault(category_id, [])
```

**Mapping réponse catégorie :**
```
tag_categories.category_id  → "category_id"
tag_categories.domain_id    → "domain_id"
tag_categories.entity_type  → "entity_type"
tag_categories.name         → "name"
tag_categories.label_fr     → "label_fr"
tag_categories.label_en     → "label_en"
tag_categories.icon         → "icon"
tag_categories.active       → "active"
tag_categories.created_at   → "created_at"
[calculé Python]            → "tags"  ← liste de TagDto
```

**Mapping réponse tag (dans tags[]) :**
```
tags.tag_id      → "tag_id"
tags.category_id → "category_id"
tags.domain_id   → "domain_id"
tags.name        → "name"
tags.label_fr    → "label_fr"
tags.label_en    → "label_en"
tags.icon        → "icon"
tags.active      → "active"
tags.created_at  → "created_at"
[linked_category_id]  → SUPPRIMÉ avant réponse (ne pas exposer)
```

---

### GET /api/tags

#### Branche A — `category_id` et/ou `entity_type` présent
```sql
SELECT DISTINCT t.*
FROM tags t
  [JOIN tag_category_links tcl ON t.tag_id = tcl.tag_id]   -- si category_id
  [JOIN tag_entity_type_links tetl ON t.tag_id = tetl.tag_id]  -- si entity_type
WHERE t.active = TRUE
  [AND t.domain_id = $1]           -- si domain_id aussi fourni
  [AND tcl.category_id = $N]       -- si category_id
  [AND tetl.entity_type = $N]      -- si entity_type
ORDER BY t.name
LIMIT 200
```

**Note critique :** `DISTINCT` obligatoire ici (JOINs peuvent multiplier les lignes).

#### Branche B — `domain_id` seul (sans category_id ni entity_type)
```sql
SELECT * FROM tags t
WHERE t.active = TRUE
  AND t.domain_id = $1
ORDER BY t.name
LIMIT 200
-- Pas de DISTINCT, pas de JOIN
```

#### Branche C — aucun filtre
```sql
SELECT * FROM tags
WHERE active = TRUE
ORDER BY name
LIMIT 200
```

**Mapping réponse tag (plate) :**
```
tags.tag_id      → "tag_id"
tags.category_id → "category_id"
tags.domain_id   → "domain_id"
tags.name        → "name"
tags.label_fr    → "label_fr"
tags.label_en    → "label_en"
tags.icon        → "icon"
tags.active      → "active"
tags.created_at  → "created_at"
```

---

## Tris

| Endpoint | Colonne | Ordre |
|---|---|---|
| GET /domains | `domains.name` | ASC |
| GET /tags/categories (catégories) | `tag_categories.name` | ASC |
| GET /tags/categories (tags dans chaque cat) | `tags.name` | ASC |
| GET /tags | `tags.name` | ASC |

---

## Limites (LIMIT)

| Endpoint | LIMIT |
|---|---|
| GET /domains | **Aucune** |
| GET /tags/categories (requête catégories) | **Aucune** |
| GET /tags/categories (requête tags) | **Aucune** |
| GET /tags | **200** (hardcodé dans toutes les branches) |
