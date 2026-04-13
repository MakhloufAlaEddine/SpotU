# SLICE_10_TEST_CASES.md — Cas de test
> Basé sur `domain_routes.py:11–140`.
> Généré le 2026-02-XX.

---

## GET /api/domains

### TC-D01 — Nominal (défaut)
```
GET /api/domains
→ HTTP 200
→ Liste de domaines avec active=true uniquement
→ Tous les champs présents : domain_id, name, label_fr, label_en, icon, color, active, created_at
→ Triés par name ASC
```

### TC-D02 — Liste vide
```
GET /api/domains
(si aucun domaine actif en base)
→ HTTP 200
→ []
```

### TC-D03 — include_inactive=false (comportement explicite)
```
GET /api/domains?include_inactive=false
→ HTTP 200
→ Identique à TC-D01 (active=true uniquement)
→ Aucun domaine avec active=false dans la liste
```

### TC-D04 — include_inactive=true
```
GET /api/domains?include_inactive=true
→ HTTP 200
→ Contient AUSSI les domaines avec active=false
→ Triés par name ASC
→ Pas de token requis — aucun 401/403
```

### TC-D05 — Token invalide (ignoré)
```
GET /api/domains
Authorization: Bearer INVALID_TOKEN_123
→ HTTP 200
→ Même réponse qu'un appel sans token (l'endpoint ignore tout header auth)
```

### TC-D06 — Compatibilité champs Python
```
Vérifier que la réponse Java contient exactement les mêmes champs que Python :
domain_id, name, label_fr, label_en, icon, color, active, created_at
Pas de champ supplémentaire (ex: pas de "id" en doublon de "domain_id")
```

---

## GET /api/tags/categories

### TC-C01 — Nominal sans filtre
```
GET /api/tags/categories
→ HTTP 200
→ Liste de catégories avec active=true
→ Chaque catégorie contient "tags": [] ou une liste de tags actifs
→ Triées par name ASC
→ Tags dans chaque catégorie triés par name ASC
```

### TC-C02 — Liste vide (aucune catégorie active)
```
GET /api/tags/categories
(si aucune catégorie active)
→ HTTP 200
→ []
```

### TC-C03 — Filtre domain_id valide
```
GET /api/tags/categories?domain_id=dom_sport
→ HTTP 200
→ Uniquement les catégories avec domain_id = "dom_sport" ET active=true
→ Tags imbriqués correspondants
```

### TC-C04 — Filtre domain_id inconnu
```
GET /api/tags/categories?domain_id=dom_inexistant
→ HTTP 200
→ []
```

### TC-C05 — Filtre entity_type valide
```
GET /api/tags/categories?entity_type=service
→ HTTP 200
→ Catégories avec entity_type = "service" ET active=true
→ Tags liés à ces catégories dans tags[]
```

### TC-C06 — Filtres cumulés domain_id + entity_type
```
GET /api/tags/categories?domain_id=dom_sport&entity_type=service
→ HTTP 200
→ Catégories avec domain_id=dom_sport ET entity_type=service ET active=true
```

### TC-C07 — Catégorie active mais aucun tag actif lié
```
GET /api/tags/categories
→ La catégorie apparaît dans la liste avec "tags": []
→ Pas d'omission de la catégorie si elle a 0 tags actifs
```

### TC-C08 — linked_category_id absent de la réponse
```
GET /api/tags/categories
→ Aucun champ "linked_category_id" dans les objets tags
→ Vérification stricte de l'absence de ce champ
```

### TC-C09 — Compatibilité champs catégorie Python
```
Champs catégorie attendus : category_id, domain_id, entity_type, name, label_fr, label_en, icon, active, created_at, tags
Champs tag attendus dans tags[] : tag_id, category_id, domain_id, name, label_fr, label_en, icon, active, created_at
```

---

## GET /api/tags

### TC-T01 — Nominal sans filtre (branche C)
```
GET /api/tags
→ HTTP 200
→ Tous les tags actifs, max 200
→ Triés par name ASC
→ Réponse plate (pas de tags[]) — liste directe de TagDto
```

### TC-T02 — Liste vide
```
GET /api/tags
(si aucun tag actif)
→ HTTP 200
→ []
```

### TC-T03 — Filtre domain_id seul (branche B)
```
GET /api/tags?domain_id=dom_sport
→ HTTP 200
→ Tags avec domain_id = "dom_sport" ET active=true
→ Pas de DISTINCT (pas de JOIN)
→ Triés par name ASC, max 200
```

### TC-T04 — Filtre category_id seul (branche A)
```
GET /api/tags?category_id=cat_yoga
→ HTTP 200
→ Tags liés à cat_yoga via tag_category_links ET active=true
→ DISTINCT appliqué
→ Pas de doublon même si un tag est lié à plusieurs catégories
```

### TC-T05 — Filtre entity_type seul (branche A)
```
GET /api/tags?entity_type=service
→ HTTP 200
→ Tags liés à "service" via tag_entity_type_links ET active=true
→ DISTINCT appliqué
```

### TC-T06 — Filtres cumulés (branche A)
```
GET /api/tags?domain_id=dom_sport&category_id=cat_yoga&entity_type=service
→ HTTP 200
→ Tags satisfaisant les 3 conditions ET active=true
→ DISTINCT appliqué
```

### TC-T07 — category_id inexistant
```
GET /api/tags?category_id=cat_inexistant
→ HTTP 200
→ []
```

### TC-T08 — LIMIT 200 respecté
```
GET /api/tags
(si > 200 tags actifs en base)
→ HTTP 200
→ Exactement 200 tags retournés (jamais plus)
```

### TC-T09 — Compatibilité champs Python
```
Champs attendus : tag_id, category_id, domain_id, name, label_fr, label_en, icon, active, created_at
Pas de "linked_category_id" dans la réponse plate
```

### TC-T10 — Réponse plate (pas d'imbrication)
```
GET /api/tags
→ Tableau plat de TagDto
→ Pas de structure imbriquée (contrairement à GET /tags/categories)
```

---

## Cas de test transversaux

### TC-X01 — Aucun endpoint ne retourne de 401 ou 403
```
Pour les 3 endpoints, avec n'importe quelle combinaison de params :
- Sans header Authorization
- Avec Authorization: Bearer invalid_token
- Avec Authorization: Bearer expired_token
→ Toujours HTTP 200 (jamais 401, jamais 403)
```

### TC-X02 — Réponses identiques entre Python et Java
```
Appel simultané à Python et Java avec mêmes paramètres :
GET /api/domains
GET /api/tags/categories?entity_type=service
GET /api/tags?domain_id=X
→ JSON structurellement identique (mêmes clés, mêmes valeurs, même ordre de tri)
```

### TC-X03 — Tri alphabétique respecté
```
GET /api/domains → order by name ASC vérifié
GET /api/tags/categories → catégories en order by name ASC ET tags internes en order by name ASC
GET /api/tags → order by name ASC
```
