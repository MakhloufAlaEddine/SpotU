# SLICE_10_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation pour Cursor
> Basé sur `domain_routes.py:11–140`, `001_initial_schema.sql`, slices précédentes.
> Généré le 2026-02-XX.

---

## Structure recommandée Java/Spring Boot

```
src/main/java/com/spotu/
├── controller/
│   └── ReferentialController.java     ← GET /domains, GET /tags/categories, GET /tags
├── service/
│   └── ReferentialService.java        ← Logique de groupement tags/catégories
├── repository/
│   ├── DomainRepository.java          ← Requêtes SQL domains
│   ├── TagCategoryRepository.java     ← Requêtes SQL tag_categories
│   └── TagRepository.java             ← Requêtes SQL tags (3 branches)
└── dto/
    ├── DomainDto.java
    ├── TagCategoryDto.java            ← Contient List<TagDto> tags
    └── TagDto.java
```

---

## Controller

```java
// ReferentialController.java
@RestController
@RequestMapping("/api")
public class ReferentialController {

    @GetMapping("/domains")
    public ResponseEntity<List<DomainDto>> getDomains(
            @RequestParam(defaultValue = "false") boolean includeInactive) {
        return ResponseEntity.ok(referentialService.getDomains(includeInactive));
    }

    @GetMapping("/tags/categories")
    public ResponseEntity<List<TagCategoryDto>> getCategories(
            @RequestParam(required = false) String domainId,
            @RequestParam(required = false) String entityType) {
        return ResponseEntity.ok(referentialService.getCategoriesWithTags(domainId, entityType));
    }

    @GetMapping("/tags")
    public ResponseEntity<List<TagDto>> getTags(
            @RequestParam(required = false) String domainId,
            @RequestParam(required = false) String categoryId,
            @RequestParam(required = false) String entityType) {
        return ResponseEntity.ok(referentialService.getTags(domainId, categoryId, entityType));
    }
}
```

**Note :** Aucun `@PreAuthorize`, aucune vérification de sécurité — endpoints publics.

---

## DTOs

### DomainDto

```java
public record DomainDto(
    String domainId,        // "domain_id"
    String name,
    String labelFr,         // "label_fr"
    String labelEn,         // "label_en"
    String icon,
    String color,
    Boolean active,
    String createdAt        // "created_at" — ISO string
) {}
```

**Sérialisation JSON :** utiliser `@JsonProperty("domain_id")`, `@JsonProperty("label_fr")`, etc. pour correspondre exactement aux noms Python snake_case.

### TagCategoryDto

```java
public record TagCategoryDto(
    String categoryId,      // "category_id"
    String domainId,        // "domain_id" — nullable
    String entityType,      // "entity_type" — nullable
    String name,
    String labelFr,         // "label_fr"
    String labelEn,         // "label_en"
    String icon,
    Boolean active,
    String createdAt,       // "created_at"
    List<TagDto> tags       // enrichissement applicatif — jamais null, [] si vide
) {}
```

### TagDto

```java
public record TagDto(
    String tagId,           // "tag_id"
    String categoryId,      // "category_id" — nullable
    String domainId,        // "domain_id" — nullable
    String name,
    String labelFr,         // "label_fr"
    String labelEn,         // "label_en"
    String icon,            // nullable
    Boolean active,
    String createdAt        // "created_at"
    // NE PAS inclure linkedCategoryId — champ technique supprimé en Python
) {}
```

---

## Service — Logique de groupement getCategoriesWithTags()

```java
// ReferentialService.java
public List<TagCategoryDto> getCategoriesWithTags(String domainId, String entityType) {
    // Requête 1 — catégories
    List<TagCategoryRow> categories = tagCategoryRepository.findActive(domainId, entityType);
    if (categories.isEmpty()) return Collections.emptyList();

    // Requête 2 — tags liés (uniquement si catégories trouvées)
    List<String> categoryIds = categories.stream()
        .map(TagCategoryRow::categoryId)
        .toList();
    List<TagWithCategoryRow> tagRows = tagRepository.findByCategoryIds(categoryIds);

    // Groupement Java (reproduit tags_by_category Python)
    Map<String, List<TagDto>> tagsByCategory = new HashMap<>();
    for (TagWithCategoryRow row : tagRows) {
        TagDto dto = toTagDto(row);  // NE PAS inclure linkedCategoryId dans TagDto
        tagsByCategory
            .computeIfAbsent(row.linkedCategoryId(), k -> new ArrayList<>())
            .add(dto);
    }

    // Composition finale
    return categories.stream()
        .map(cat -> new TagCategoryDto(
            cat.categoryId(), cat.domainId(), cat.entityType(),
            cat.name(), cat.labelFr(), cat.labelEn(), cat.icon(),
            cat.active(), cat.createdAt(),
            tagsByCategory.getOrDefault(cat.categoryId(), Collections.emptyList())
        ))
        .toList();
}
```

---

## Repository — SQL natifs

### DomainRepository

```java
// Branche include_inactive=false (défaut)
@Query(value = "SELECT * FROM domains WHERE active = TRUE ORDER BY name", nativeQuery = true)
List<DomainRow> findActive();

// Branche include_inactive=true
@Query(value = "SELECT * FROM domains ORDER BY name", nativeQuery = true)
List<DomainRow> findAll();
```

### TagCategoryRepository

```java
// Requête dynamique selon filtres
// Note : utiliser JdbcTemplate ou QueryDSL pour la clause WHERE dynamique
// SQL de base :
"SELECT * FROM tag_categories tc WHERE tc.active = TRUE [AND tc.domain_id = ?] [AND tc.entity_type = ?] ORDER BY tc.name"

// Requête tags liés (batch)
"SELECT t.*, tcl.category_id as linked_category_id " +
"FROM tags t " +
"JOIN tag_category_links tcl ON t.tag_id = tcl.tag_id " +
"WHERE t.active = TRUE AND tcl.category_id = ANY(?) " +
"ORDER BY t.name"
// Note : ANY(?) avec un Array SQL — en Spring JDBC : new Array("text", categoryIds.toArray())
```

### TagRepository — 3 branches

```java
// Branche A — category_id et/ou entity_type présents
"SELECT DISTINCT t.* FROM tags t " +
"[JOIN tag_category_links tcl ON t.tag_id = tcl.tag_id]  " +  // si categoryId
"[JOIN tag_entity_type_links tetl ON t.tag_id = tetl.tag_id] " +  // si entityType
"WHERE t.active = TRUE " +
"[AND t.domain_id = ?] [AND tcl.category_id = ?] [AND tetl.entity_type = ?] " +
"ORDER BY t.name LIMIT 200"

// Branche B — domain_id seul
"SELECT * FROM tags t WHERE t.active = TRUE AND t.domain_id = ? ORDER BY t.name LIMIT 200"

// Branche C — aucun filtre
"SELECT * FROM tags WHERE active = TRUE ORDER BY name LIMIT 200"
```

**Recommandation :** Utiliser `JdbcTemplate` avec construction dynamique du SQL pour les branches A/B/C, car les conditions varient selon les paramètres reçus.

---

## Validations et erreurs

| Situation | Comportement Python | Comportement Java attendu |
|---|---|---|
| Aucun résultat | `[]` HTTP 200 | `ResponseEntity.ok(Collections.emptyList())` |
| Paramètre inconnu ignoré | FastAPI ignore les params non déclarés | Spring ignore aussi par défaut |
| `entity_type` invalide | Aucune erreur (query retourne []) | Idem — pas de validation côté Java |
| Token invalide | Ignoré (pas de lecture du token) | Pas de SecurityContext à vérifier |
| DB inaccessible | 500 non géré | Laisser remonter (pas de try/catch spécifique) |

---

## Critères de done (Definition of Done)

### GET /api/domains
- [ ] Sans param → uniquement `active=true`, trié par `name` ASC
- [ ] `?include_inactive=true` → tous les domaines (actifs et inactifs), trié par `name` ASC
- [ ] `?include_inactive=false` → identique au sans param
- [ ] Aucun 401/403 quel que soit le header Authorization
- [ ] JSON avec clés snake_case (`domain_id`, `label_fr`, `label_en`)
- [ ] Champ `color` présent même si null/défaut

### GET /api/tags/categories
- [ ] Sans param → toutes catégories actives avec leurs tags actifs imbriqués
- [ ] `?domain_id=X` → filtre catégories par `domain_id`
- [ ] `?entity_type=service|spotyou|product` → filtre par `entity_type`
- [ ] Filtres cumulables
- [ ] Catégorie sans tag actif → `"tags": []` (pas omis)
- [ ] `linked_category_id` absent de la réponse finale
- [ ] Tags triés par `name` ASC à l'intérieur de chaque catégorie
- [ ] Aucun 401/403

### GET /api/tags
- [ ] Sans param → tous tags actifs, LIMIT 200, trié par `name` ASC
- [ ] `?domain_id=X` → branche B (pas de JOIN, pas de DISTINCT)
- [ ] `?category_id=X` → branche A avec JOIN `tag_category_links` + DISTINCT
- [ ] `?entity_type=X` → branche A avec JOIN `tag_entity_type_links` + DISTINCT
- [ ] `?category_id=X&entity_type=Y` → double JOIN + DISTINCT
- [ ] Aucun doublon en branche A
- [ ] LIMIT 200 respecté dans toutes les branches
- [ ] Aucun 401/403

---

## Avertissements et incertitudes

| # | Avertissement | Niveau |
|---|---|---|
| W1 | `include_inactive=true` public — comportement exposé sans auth | CONFIRMÉ (code Python) |
| W2 | `ANY(?)` en JDBC pour tableau d'IDs — syntaxe dépendante du driver PostgreSQL | TECHNIQUE |
| W3 | Construction SQL dynamique (branche A/B/C) — utiliser JdbcTemplate, pas JPA Criteria (trop verbeux) | RECOMMANDATION |
| W4 | `SELECT *` retourne `created_at` — inclure dans tous les DTOs même si non utilisé côté frontend | CONFIRMÉ |
| W5 | `entity_type` non validé en Python (aucune erreur pour valeur inconnue) — ne pas ajouter de validation Java non présente en Python | CONFIRMÉ |
