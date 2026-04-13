# SLICE_10_BUSINESS_RULES.md — Règles métier
> Basé sur `domain_routes.py:11–140`, `001_initial_schema.sql`.
> Généré le 2026-02-XX.

---

## RG-01 — Filtre `active = TRUE` par défaut sur tous les référentiels

**Source :** `domain_routes.py:15–18`, `44`, `110`

Les trois endpoints GET appliquent systématiquement `active = TRUE` comme condition de base :

| Endpoint | Condition active | Exception |
|---|---|---|
| `GET /domains` | `WHERE active = TRUE` | `include_inactive=true` désactive ce filtre |
| `GET /tags/categories` | `WHERE tc.active = TRUE` | Aucune |
| `GET /tags` | `WHERE t.active = TRUE` (toutes branches) | Aucune |

**En Java :** Toujours ajouter `active = true` dans les requêtes repositories, sauf pour `/domains` avec `includeInactive=true`.

---

## RG-02 — `include_inactive` public sur GET /domains

**Source :** `domain_routes.py:12–18`

```python
@router.get("/domains")
async def get_domains(include_inactive: bool = Query(False)):
```

Ce paramètre est **public** — aucune vérification de rôle, aucun token requis.
- `include_inactive=false` (défaut) → `WHERE active = TRUE`
- `include_inactive=true` → tous les domaines, y compris ceux avec `active = FALSE`

**Décision business :** Ce comportement peut sembler étrange (endpoint public qui expose des entités désactivées) mais est conforme au code Python. Le reproduire fidèlement en Java sans ajouter de protection.

---

## RG-03 — Hiérarchie domaine → catégorie → tag

**Source :** Schéma DB `001_initial_schema.sql`

La hiérarchie est :
```
domains
  └── tag_categories (domain_id FK)
        └── tag_category_links (many-to-many)
              └── tags (category_id FK + domain_id FK)
```

Un tag peut appartenir à :
- un `domain_id` direct (colonne `tags.domain_id`)
- une ou plusieurs catégories (via `tag_category_links`)
- un ou plusieurs types d'entités (via `tag_entity_type_links`)

**Note :** La relation domaine→tag via `tags.domain_id` est redondante avec la relation via catégorie. Le code Python utilise les deux selon le filtre appliqué.

---

## RG-04 — Filtrage tags/catégories par `entity_type`

**Source :** `domain_routes.py:49–51`, `119–127`, `tag_entity_type_links` CHECK constraint

Valeurs `entity_type` autorisées (vérifiées en DB via CHECK constraint) :
- `'spotyou'`
- `'service'`
- `'product'`

Ce filtre est appliqué sur :
- `tag_categories.entity_type` (colonne directe)
- `tag_entity_type_links.entity_type` (JOIN sur tags)

**Utilisation typique :**
- Formulaire création service → `GET /tags/categories?entity_type=service`
- Formulaire création SpotYou → `GET /tags/categories?entity_type=spotyou`
- Formulaire création produit → `GET /tags/categories?entity_type=product`

---

## RG-05 — Groupement côté application (pas côté DB)

**Source :** `domain_routes.py:73–84`

`GET /api/tags/categories` exécute **2 requêtes séquentielles** puis groupe en Python.
Le SQL ne retourne pas de résultat imbriqué — le JSON imbriqué est construit côté applicatif.

```python
# Python construit le groupement :
tags_by_category: dict = {}
for tag in tag_rows:
    t = row_to_dict(tag)
    cid = t.pop("linked_category_id", None)  # supprimé
    if cid:
        tags_by_category.setdefault(cid, []).append(t)
```

**En Java :** Reproduire avec `Map<String, List<TagDto>>` ou une requête SQL unique avec JOIN + `ResultSetExtractor`.

---

## RG-06 — `linked_category_id` supprimé avant réponse

**Source :** `domain_routes.py:76` — `t.pop("linked_category_id", None)`

La requête SQL de `GET /api/tags/categories` sélectionne `tcl.category_id as linked_category_id` comme champ technique pour le groupement Python. Ce champ est **supprimé** (`pop`) avant d'être ajouté dans `tags[]`.

Le client final ne voit jamais `linked_category_id` dans la réponse JSON.

**En Java :** Ne pas exposer ce champ dans le `TagDto` final.

---

## RG-07 — DISTINCT conditionnel dans GET /tags

**Source :** `domain_routes.py:129–136`

`DISTINCT` est ajouté **uniquement** en branche A (quand `category_id` ou `entity_type` est présent).

Sans DISTINCT, un tag associé à plusieurs catégories serait retourné plusieurs fois via le JOIN.

| Branche | DISTINCT | Raison |
|---|---|---|
| A (category_id ou entity_type) | **OUI** | JOIN `tag_category_links` peut dupliquer |
| B (domain_id seul) | NON | Pas de JOIN, pas de duplication possible |
| C (aucun filtre) | NON | SELECT direct sur `tags` |

---

## RG-08 — LIMIT 200 sur GET /tags uniquement

**Source :** `domain_routes.py:130`, `137`, `139`

`LIMIT 200` est présent dans **toutes les branches** de `GET /tags` mais **absent** de `GET /domains` et `GET /tags/categories`.

| Endpoint | LIMIT |
|---|---|
| GET /domains | Aucune |
| GET /tags/categories | Aucune (ni catégories, ni tags) |
| GET /tags | **200** (toutes branches) |

---

## RG-09 — Filtres cumulables dans GET /tags (branche A)

**Source :** `domain_routes.py:110–137`

Dans la branche A, les filtres `domain_id`, `category_id`, `entity_type` sont cumulables :
```python
conditions = ["t.active = TRUE"]
if domain_id:
    conditions.append(f"t.domain_id = ${len(params)}")
if category_id:
    join_clause += " JOIN tag_category_links tcl ON t.tag_id = tcl.tag_id"
    conditions.append(f"tcl.category_id = ${len(params)}")
if entity_type:
    join_clause += " JOIN tag_entity_type_links tetl ON t.tag_id = tetl.tag_id"
    conditions.append(f"tetl.entity_type = ${len(params)}")
```

Exemple : `?domain_id=dom_sport&category_id=cat_yoga&entity_type=service` → tous les filtres appliqués simultanément.

---

## RG-10 — Pas de 404 sur aucun des 3 endpoints

**Source :** `domain_routes.py:11–140`

Aucun handler de la Slice 10 ne lève de `HTTPException(404, ...)`.
Un filtre qui ne correspond à rien retourne toujours `[]` HTTP 200.

**En Java :** Ne jamais retourner 404 pour ces 3 endpoints — toujours HTTP 200 avec liste vide.

---

## Cohérence avec les slices précédentes

| Slice | Utilisation des tags/domaines |
|---|---|
| Slice 09 — `GET /api/services` | `services.tag_ids[]` → JOIN `tags` pour enrichir `tags[]` dans réponse |
| Slice 09 — `GET /api/services?domain_id=X` | Filtrage services par domaine |
| Slice 04 — Profil public | `users.coach_tags[]` contient des `tag_id` |
| Slice 10 | Source de vérité du référentiel lui-même |

**Note :** La Slice 10 est la "source de vérité" que les slices 04, 09 et futures slices (SpotYou, marketplace) consomment pour enrichir leurs réponses.

---

## Niveau de confiance global

| Règle | Confiance | Source |
|---|---|---|
| RG-01 active=TRUE | HAUTE | Code explicite lignes 15-18, 44, 110 |
| RG-02 include_inactive public | HAUTE | Pas de require_role, confirmé lecture complète |
| RG-03 Hiérarchie domaine→tag | HAUTE | Schéma DB 001_initial_schema.sql |
| RG-04 entity_type CHECK constraint | HAUTE | Contrainte DB confirmée |
| RG-05 Groupement côté app | HAUTE | Code Python lignes 73-84 |
| RG-06 linked_category_id supprimé | HAUTE | `pop()` explicite ligne 76 |
| RG-07 DISTINCT conditionnel | HAUTE | Code lignes 129-136 |
| RG-08 LIMIT 200 | HAUTE | SQL ligne 130, 137, 139 |
| RG-09 Filtres cumulables | HAUTE | Branche A du get_tags |
| RG-10 Jamais de 404 | HAUTE | Aucun raise HTTPException dans les GET |
