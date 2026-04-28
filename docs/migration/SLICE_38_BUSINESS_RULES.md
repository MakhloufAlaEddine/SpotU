# SLICE_38_BUSINESS_RULES.md — Règles métier Marketplace Products
> Basé sur `routes/marketplace_routes.py:1–267`.
> Généré le 2026-04-28.

---

## BR-38.01 — Endpoint PUBLIC (pas d'auth)

### Règle
Aucun `require_auth`. Endpoint accessible sans JWT ni cookie.

### Java
```java
// SecurityConfig
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/api/marketplace/products").permitAll()
    .anyRequest().authenticated())
```

> ⚠️ Premier endpoint marketplace public. Prudence : ne JAMAIS exposer ici de champs sensibles (PII users autres que `name`/`picture`, etc.).

---

## BR-38.02 — Visibilité : `status='active'` produits, `active=TRUE` services

### Règle
- `marketplace_products` : SELECT WHERE `status='active'` (pas `'draft'`, `'sold'`, `'archived'`)
- `services` : SELECT WHERE `active=TRUE` (boolean)

### Java
Filtre dans la query native. Reproduire les 2 syntaxes (`status='active'` text vs `active=TRUE` bool).

---

## BR-38.03 — Mode "feed" par défaut (sans paramètres)

### Règle
Sans `tag_ids` ni `spotyou_id` :
- 20 produits actifs récents
- **Aucun service** (asymétrie : services apparaissent uniquement avec tags)
- Tri `created_at DESC`
- Pas de calcul distance, pas de badges

```sql
SELECT ... WHERE p.status='active' ORDER BY p.created_at DESC LIMIT 20
```

> ⚠️ **Asymétrie volontaire** : services masqués sans filtre tags. Reproduire.

---

## BR-38.04 — Branchement `tag_ids` et `spotyou_id`

### Logique (lignes 40–67)

```python
filter_requested = bool(tag_ids or spotyou_id)
tags = parse_csv(tag_ids) if tag_ids else []

if spotyou_id:
    row = SELECT tag_points WHERE point_id=$1
    if row:
        owner_id = row.user_id
        spotyou_lat = row.slat
        spotyou_lng = row.slng
        if not tags:
            tags = parse(row.tag_ids)  # JSON or array
```

### Cas combinés

| `tag_ids` | `spotyou_id` valide | Comportement |
|---|---|---|
| absent | absent | Mode feed (BR-38.03) |
| `tag1,tag2` | absent | Filtre tags `[tag1, tag2]`, owner_id=null, no GPS |
| absent | `pt_xxx` (existe) | Filtre tags = tag_points.tag_ids, owner_id=tag_points.user_id, GPS récupéré |
| absent | `pt_invalid` (n'existe pas) | tags=[], owner_id=null, GPS=null → si `filter_requested=True` ET tags=[] → **renvoie []** |
| `tag1,tag2` | `pt_xxx` valide | Tags utilisateur prioritaires (pas écrasés par tag_points), owner_id et GPS du SpotYou récupérés |

### Java
```java
boolean filterRequested = tagIds != null || spotyouId != null;
List<String> tags = parseCsv(tagIds);
String ownerId = null; Double slat = null, slng = null;

if (spotyouId != null) {
    Optional<TagPointRow> row = repo.findTagPoint(spotyouId);
    if (row.isPresent()) {
        ownerId = row.get().userId();
        slat = row.get().slat();
        slng = row.get().slng();
        if (tags.isEmpty()) {
            tags = parseTags(row.get().rawTagIds());
        }
    }
}
```

---

## BR-38.05 — Filtre tags vide après resolve → liste vide

### Règle (lignes 103–104)
```python
elif filter_requested:
    prows = []
```

Si filter_requested ET tags vide → **pas** de SELECT, retourne directement liste vide.

### Justification
Empêche un SELECT sans WHERE qui retournerait tout le marketplace si l'utilisateur a passé un `spotyou_id` invalide.

### Java
```java
if (tags.isEmpty()) {
    if (filterRequested) {
        // skip both products and services queries
        products = List.of();
        services = List.of();
    } else {
        products = repo.findFeed(20);   // mode feed
    }
} else {
    products = repo.findByTags(tags, ownerId);
    services = repo.findServicesByTags(tags, ownerId);
}
```

---

## BR-38.06 — Owner-first sorting (SQL + applicatif)

### Règle SQL
```sql
ORDER BY CASE WHEN seller_id = $2 THEN 0 ELSE 1 END, created_at DESC
```

### Règle applicative (post-merge products+services)

```python
all_items = filtered_products + services
owner_items = [x for x in all_items if x["badge_type"] == "owner"]
other_items = [x for x in all_items if x["badge_type"] != "owner"]
items = owner_items + other_items
```

### Pourquoi 2 niveaux
1. **SQL** : trie chaque liste (products, services) avec owner-first.
2. **Applicatif** : après merge, re-fait owner-first sur la liste fusionnée pour que **tous** les items owner (products + services confondus) viennent en premier.

### Java
```java
List<Map<String,Object>> allItems = new ArrayList<>();
allItems.addAll(productsEnriched);
allItems.addAll(servicesEnriched);

List<Map<String,Object>> ownerItems = allItems.stream()
    .filter(i -> "owner".equals(i.get("badge_type"))).toList();
List<Map<String,Object>> otherItems = allItems.stream()
    .filter(i -> !"owner".equals(i.get("badge_type"))).toList();
List<Map<String,Object>> items = new ArrayList<>(ownerItems);
items.addAll(otherItems);
```

---

## BR-38.07 — Badges `owner` / `other`

### Règle (lignes 137–142, 171–176)

```python
if owner_id and item.seller_id == owner_id:
    badge_type  = "owner"
    badge_label = "Créateur du SpotYou"
else:
    badge_type  = "other"
    badge_label = item.seller_name or "SpotU"     # products
    # ou
    badge_label = item.coach_name  or "Coach"     # services
```

### Asymétrie default label

| Item | Default label si seller/coach name null |
|---|---|
| product | `"SpotU"` |
| service | `"Coach"` |

> ⚠️ **À reproduire**.

---

## BR-38.08 — Calcul distance Haversine

### Règle (lignes 14–22)

```python
def haversine(lat1, lon1, lat2, lon2):
    R = 6371   # rayon Terre km
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat/2)² + cos(rad(lat1)) * cos(rad(lat2)) * sin(dlon/2)²
    return round(R * 2 * asin(sqrt(a)), 1)
```

### Java
```java
public static double haversineKm(double lat1, double lon1, double lat2, double lon2) {
    double R = 6371;
    double dlat = Math.toRadians(lat2 - lat1);
    double dlon = Math.toRadians(lon2 - lon1);
    double a = Math.pow(Math.sin(dlat/2), 2)
             + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
             * Math.pow(Math.sin(dlon/2), 2);
    return Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 10) / 10.0;  // 1 decimal
}
```

> ⚠️ **R=6371** (pas 6378). Round à **1 décimale**. Test : Paris (48.8566, 2.3522) → Lyon (45.7640, 4.8357) ≈ **391.5 km**.

---

## BR-38.09 — `is_physical` détection

### Règle
- `product.lat IS NOT NULL` ET `product.lng IS NOT NULL` → `is_physical=true`
- `product.lat IS NULL` OU `product.lng IS NULL` → `is_physical=false`
- `service` → toujours `is_physical=false` (BR-38.10)

### Effet
Si `is_physical=true` ET GPS SpotYou disponible → calcule `dist_from_spotyou` + `dist_from_spotyou_fmt`.
Si `is_physical=true` ET `user_lat/user_lng` fournis → calcule `dist_from_user` + `dist_from_user_fmt`.

> ⚠️ Les 2 calculs sont **indépendants**. On peut avoir l'un sans l'autre.

---

## BR-38.10 — Services toujours `is_physical=false`

### Règle (ligne 164)
```python
s["is_physical"] = False
```

Pas de calcul de distance pour les services (même s'ils ont une `address`). Asymétrie volontaire avec products.

> ⚠️ Si le front veut afficher la distance pour un service avec adresse → **demande produit hors-scope**. Compat stricte = pas de distance.

---

## BR-38.11 — Format `fmt_dist`

```python
def fmt_dist(km):
    if km < 1:
        return f"{int(km * 1000)} m"     # ex: "300 m"
    return f"{km:.1f} km"                 # ex: "1.2 km"
```

### Cas limites
- `km=0.999` → `int(999.0)=999` → `"999 m"`
- `km=1.0` → not `<1` → `"1.0 km"`
- `km=0.0` → `int(0)=0` → `"0 m"`

### Java
```java
public static String fmtDist(double km) {
    if (km < 1) return ((int)(km * 1000)) + " m";
    return String.format(Locale.ROOT, "%.1f km", km);
}
```

> ⚠️ Locale.ROOT pour `.` décimal.

---

## BR-38.12 — Désérialisation services `images` et `tag_ids`

### Règle (lignes 167–170)
```python
raw_imgs = s.get("images")
s["images"] = json.loads(raw_imgs) if isinstance(raw_imgs, str) else (raw_imgs or [])
raw_ti = s.get("tag_ids")
s["tag_ids"] = json.loads(raw_ti) if isinstance(raw_ti, str) else (raw_ti or [])
```

### Cas
- string JSON `'["a","b"]'` → `["a","b"]`
- list déjà `["a","b"]` → inchangé
- null → `[]` (pas null!)

### Java
```java
private List<String> deserializeStringList(Object raw) throws IOException {
    if (raw == null) return List.of();
    if (raw instanceof String s && !s.isEmpty()) {
        return objectMapper.readValue(s, new TypeReference<>() {});
    }
    if (raw instanceof List<?> l) return (List<String>) l;
    return List.of();
}
```

---

## BR-38.13 — Pas de pagination côté tags

### Règle
Quand `tag_ids` présent, **aucun `LIMIT`** côté products. Mode feed = `LIMIT 20`. Services = `LIMIT 20`.

| Cas | Limit |
|---|---|
| Mode feed (sans paramètre) | LIMIT 20 |
| Avec `tag_ids` ou `spotyou_id` (products) | **AUCUN LIMIT** |
| Avec `tag_ids` ou `spotyou_id` (services) | LIMIT 20 |

> ⚠️ Asymétrie : services toujours `LIMIT 20`, products non-limité quand tags. Reproduire **strictement**.

---

## BR-38.14 — `seller_picture` ET `seller_picture_url` (doublon legacy)

### Règle (ligne 90–91)
```sql
u.picture AS seller_picture, u.picture AS seller_picture_url
```

### Justification
Compatibilité front : ancienne clé `seller_picture`, nouvelle clé `seller_picture_url`. Les 2 doivent être présentes (legacy).

### Java
Reproduire dans le DTO :
```java
@JsonProperty("seller_picture")     String sellerPicture;
@JsonProperty("seller_picture_url") String sellerPictureUrl;  // identique
```

---

## BR-38.15 — `seller_stats` 4 SELECT parallèles

### Règle (lignes 184–265)
- 4 SELECT exécutés en parallèle via `asyncio.gather`
- Chaque SELECT ouvre **sa propre connexion** du pool
- Attache `seller_stats` à chaque item
- Si seller_id/coach_id absent → defaults `{rating_avg:null, rating_count:0, products_count:0, services_count:0, spotyou_count:0}`

### Détail par stat

| Stat | Source | Filtre |
|---|---|---|
| `rating_avg` | `reviews.AVG(rating)` ROUND 1 | `reviewee_id IN (...)` |
| `rating_count` | `reviews.COUNT(*)` | idem |
| `products_count` | `marketplace_products.COUNT(*)` | `seller_id IN (...)` (**pas** de filtre status) |
| `services_count` | `services.COUNT(*)` | `coach_id IN (...) AND active=TRUE` |
| `spotyou_count` | `tag_points.COUNT(*)` | `user_id IN (...)` |

### Java parallélisme
```java
ExecutorService executor = ...;  // configurer
CompletableFuture<List<RatingRow>> fR = CompletableFuture.supplyAsync(() -> repo.findRatings(sids), executor);
CompletableFuture<List<CountRow>>  fP = CompletableFuture.supplyAsync(() -> repo.countProducts(sids), executor);
CompletableFuture<List<CountRow>>  fS = CompletableFuture.supplyAsync(() -> repo.countServices(sids), executor);
CompletableFuture<List<CountRow>>  fT = CompletableFuture.supplyAsync(() -> repo.countSpotyou(sids), executor);
CompletableFuture.allOf(fR, fP, fS, fT).join();
// merge dans maps puis attacher à chaque item
```

---

## BR-38.16 — Distance MAX 40 km (constante non utilisée)

### Règle (ligne 11)
```python
MAX_DIST_KM = 40
```

> ⚠️ **Constante définie mais NON utilisée dans le code actuel** (vérifié en grep). Probablement legacy ou usage futur. **Ne pas ajouter de filtrage applicatif** côté Java basé sur cette constante. Compat stricte = ne rien faire.

---

## BR-38.17 — Asymétries à préserver

| Aspect | Comportement Python | Java doit reproduire |
|---|---|---|
| Endpoint PUBLIC | OUI | ✅ |
| Wrapper `{products, count}` | OUI | ✅ |
| Mode feed sans services | OUI | ✅ |
| `tag_ids` products `&&` array, services `?|` JSONB | OUI | ✅ |
| Owner-first (SQL + applicatif) | OUI | ✅ 2 niveaux |
| `is_physical=false` toujours pour services | OUI | ✅ |
| `seller_picture` ET `seller_picture_url` | OUI | ✅ doublon |
| Default badge_label "SpotU" / "Coach" | OUI | ✅ asymétrie |
| `LIMIT 20` services mais pas products avec tags | OUI | ✅ |
| `MAX_DIST_KM=40` non utilisé | OUI | ✅ ne pas appliquer |
| `products_count` sans filtre status | OUI | ✅ vs services_count avec active=TRUE |
| `filter_requested + tags vide → []` | OUI | ✅ short-circuit |

---

## BR-38.18 — Limitations connues (à NE PAS corriger)

| Limitation | Reproduire ? |
|---|---|
| Pas de pagination products | OUI |
| Pas de filtre par catégorie/prix/etc. | OUI (compat stricte ; demande produit pour filtres avancés) |
| Pas de cache HTTP | OUI |
| Pas de rate limiting visible | OUI (à confirmer côté gateway) |
| Distances calculées même hors `MAX_DIST_KM=40` | OUI |
| Items owner peuvent être > 20 (no limit avec tags) | OUI |
| Pas d'authentification → impossible de personnaliser (favoris, etc.) | OUI compat stricte |
| `seller_stats` peut être lent si beaucoup de sellers | OUI (parallélisme aide) |
