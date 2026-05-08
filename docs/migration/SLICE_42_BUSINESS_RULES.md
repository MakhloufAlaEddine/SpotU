# SLICE_42_BUSINESS_RULES.md — Règles métier Services Coach (lectures)
> Basé sur `routes/service_routes.py:1–754`.
> Généré le 2026-04-30.

---

## BR-42.01 — Auth selon endpoint

| Endpoint | Auth | 401 ? |
|---|---|---|
| `GET /services` | optional | non — silently ignore JWT errors (try/except l. 365–371) |
| `GET /services/{id}` | optional (`get_optional_auth`) | non |
| `GET /services/mine` | required | oui |
| `GET /services/saved` | required | oui |
| `GET /services/deactivated` | required | oui |

> ⚠️ `GET /services` et `GET /services/{id}` doivent rester accessibles **publiquement** (`permitAll` Spring Security pour ces 2 paths). Mine/saved/deactivated → `authenticated()`.

---

## BR-42.02 — Auto-exclusion services personnels (search uniquement)

### Règle (l. 365–371, 376–379)
Si JWT présent dans search → décode `current_user_id` → ajoute `coach_id != $current_user_id` au WHERE.

### Java
```java
String currentUserId = jwtService.tryExtractUserId(request);  // null si absent/invalide
if (currentUserId != null) {
    whereParts.add("coach_id != ?");
    params.add(currentUserId);
}
```

> ⚠️ Try/catch silencieux compat — un JWT pourri n'empêche pas la search de fonctionner (juste pas d'auto-exclusion).

---

## BR-42.03 — `LIMIT 100` hardcodé search

### Règle (l. 405)
Pas de pagination, pas d'OFFSET, pas de cursor. Front itère 100 max, le reste est invisible.

### Java
```java
"SELECT ... LIMIT 100"
```

> ⚠️ Recommandation Java post-cutover : ajouter pagination via `LIMIT ? OFFSET ?` ou cursor-based. **Hors scope S42.**

---

## BR-42.04 — Filtres dynamiques search composables

### Règle (l. 373–402)
- Base : `active = TRUE`
- + `coach_id != $current` si JWT
- + PostGIS `ST_DWithin` si `lat AND lng`
- + `coach_id = $X` si query `coach_id`
- + `domain_id = $X` si query `domain_id`

### Java
Builder pattern recommandé :
```java
StringBuilder sql = new StringBuilder("SELECT ... FROM services WHERE active = TRUE");
List<Object> params = new ArrayList<>();
if (currentUserId != null) { sql.append(" AND coach_id != ?"); params.add(currentUserId); }
if (lat != null && lng != null) { sql.append(" AND EXISTS (...)"); params.addAll(List.of(lng, lat, radius)); }
if (coachId != null) { sql.append(" AND coach_id = ?"); params.add(coachId); }
if (domainId != null) { sql.append(" AND domain_id = ?"); params.add(domainId); }
sql.append(" LIMIT 100");
```

---

## BR-42.05 — Filtre slots futurs + non-bookés

### Règle (l. 506–514, 546–554)
```sql
AND (slot_date IS NULL OR (slot_date || ' ' || start_time)::timestamp > NOW()::timestamp)
AND NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.slot_id = ss.slot_id
    AND b.status IN ('pending', 'accepted', 'awaiting_payment', 'confirmed')
)
```

### Java
SQL identique (préserver la concaténation string + cast). Les 4 statuts bookings (`pending`, `accepted`, `awaiting_payment`, `confirmed`) bloquent le slot. **Status `cancelled`, `refused`, `expired`, `completed`, `refunded`** libèrent.

> ⚠️ Liste des statuts MUST match S11+S13–S18 booking lifecycle. Vérifier cohérence.

---

## BR-42.06 — `_mask_address` selon precision

### Règle
| Précision | Comportement |
|---|---|
| `exact` (default) | description brute |
| `100m` | retire numéro de rue (regex `^\d+\s*`) |
| `1000m` | conserve seulement city/district (skip `france`/`francia`/`frankreich`/`fr`) |

### Java port
Lire le code Python (l. 68–112) et porter octet-pour-octet incluant le `_COUNTRY_NAMES` set.

> ⚠️ **Pour non-owner uniquement** : `original_description` retiré du payload. Pour owner : exposé.

---

## BR-42.07 — `is_owner` détection

### Règle (l. 735)
```python
is_owner = viewer is not None AND (viewer.user_id == coach_id OR viewer.role == 'admin')
```

### Java
```java
boolean isOwner = viewer != null
    && (Objects.equals(viewer.userId(), svc.coachId()) || "admin".equals(viewer.role()));
```

> ⚠️ **Admin a `is_owner=true`** côté detail — voit `original_address` + `original_description`. Compat à préserver.

---

## BR-42.08 — Suppression champs sensibles non-owner (detail)

### Règle (l. 749–752)
```python
if not is_owner:
    result.pop("original_address", None)
    for loc in result.get("locations", []):
        loc.pop("original_description", None)
```

### Java
```java
if (!isOwner) {
    result.remove("original_address");
    if (result.get("locations") instanceof List<?> locs) {
        for (Object loc : locs) {
            if (loc instanceof Map<?,?> m) ((Map<String,Object>)m).remove("original_description");
        }
    }
}
```

---

## BR-42.09 — Search vue light (pas de slots/packages)

### Règle (l. 343–346)
```python
svc["slots"]    = []     # toujours [] en search
svc["packages"] = []     # toujours [] en search
svc["is_owner"] = False  # toujours False en search
```

### Java
Préserver — Java DOIT retourner `slots: []`, `packages: []`, `is_owner: false` pour search **toujours**, même si techniquement les données existent en DB.

> Justification : performance UX — la liste de search ne charge pas les détails.

---

## BR-42.10 — Mine vue owner complète

### Règle
Mine = same comme detail mais sans is_owner check (toujours owner). Slots + packages chargés. `original_address`/`original_description` exposés systématiquement.

---

## BR-42.11 — Saved format plat distinct

### Règle (l. 645–684)
Format DIVERGENT du search/mine : pas de `tag_ids`, pas de `coach.is_coach_verified`, pas de `tags[]`, pas de `slots[]`, latitude/longitude **plates** (première location).

### Java
DTO distinct `SavedServiceDto` ≠ `ServiceDto`. NE PAS factoriser ces 2 formats.

---

## BR-42.12 — `available_slots` count saved

### Règle (l. 657–660)
Compte slots `slot_status='available'` ET `slot_date >= TO_CHAR(NOW(), 'YYYY-MM-DD')`.

> ⚠️ **PAS de filtre booking** ici (vs BR-42.05 qui filtre via NOT EXISTS). C'est une asymétrie : un slot booké peut être compté comme `available` côté saved si `slot_status` n'a pas été MAJ. Compat à préserver (probable optimisation perf).

### Java
SQL identique.

---

## BR-42.13 — `days_until_media_purge` calcul applicatif

### Règle (l. 707–712)
```python
mpsa = row["media_purge_scheduled_at"]
if mpsa:
    delta = (mpsa.replace(tzinfo=utc) if mpsa.tzinfo is None else mpsa) - now_utc
    days_left = max(0, delta.days)
else:
    days_left = None
```

### Java
```java
Long daysLeft = null;
if (row.getMediaPurgeScheduledAt() != null) {
    OffsetDateTime mpsa = row.getMediaPurgeScheduledAt();  // déjà UTC si Java côté repo
    long days = Duration.between(now, mpsa).toDays();
    daysLeft = Math.max(0, days);
}
```

> ⚠️ **`delta.days`** en Python est l'attribut entier ; en Java `Duration.toDays()` arrondi vers le bas. Vérifier comportement bordure (1.5 jours → 1).

---

## BR-42.14 — Detail sans filtre `active` ni `deleted_at`

### Règle (l. 725)
```sql
SELECT {SVC_FIELDS} FROM services WHERE service_id = $1
```

### Java
**Pas de filtre lifecycle** — détail consultable même si `active=FALSE` ou `deleted_at NOT NULL`.

> ⚠️ Compat permissive : un service supprimé reste consultable par son owner ET par n'importe qui qui connaît son `service_id`. Anomalie compat **à préserver**. Slice future pourrait restreindre.

---

## BR-42.15 — `_fetch_pkg_slots` séquentiel post-packages

### Règle
Les 6 queries enrich owner sont parallèles, MAIS `_fetch_pkg_slots` ne peut s'exécuter qu'après avoir les `package_ids` issus de `_fetch_packages`.

### Java
```java
CompletableFuture<...> coaches = CompletableFuture.supplyAsync(...);
// ... 5 autres
CompletableFuture.allOf(coaches, locations, reviews, tags, slots, packages).join();
List<String> pkgIds = packagesResult.stream().map(Package::id).toList();
// Query séquentielle après
List<PackageSlot> pkgSlots = pkgIds.isEmpty() ? List.of() : repo.findSlotsByPackageIds(pkgIds);
```

---

## BR-42.16 — `images` parsing dual

Cf. helper `build_service`. Java :
```java
public List<String> parseImages(Object raw) { ... }
```

---

## BR-42.17 — `tag_ids` parsing dual

### Règle (l. 446–456, 627–633)
```python
raw = svc.get("tag_ids")
if isinstance(raw, str):
    try: raw = json.loads(raw)
    except: raw = []
```

Préserver. Idem `images`.

---

## BR-42.18 — Coach JSON inline (saved)

### Règle (l. 654)
Saved utilise `json_build_object('user_id', ..., 'name', ..., 'picture', ...)` côté SQL → coach embarqué directement dans la query.

### Java
Récupérer la string JSON puis `mapper.readValue(...)` côté Java OU utiliser `JdbcTemplate` row mapper. **Pas de batch enrich** ici.

---

## Récapitulatif

| ID | Règle | Niveau |
|---|---|---|
| BR-42.01 | Auth selon endpoint (5 niveaux) | 🔴 Critique |
| BR-42.02 | Auto-exclusion services personnels search | 🟡 Important |
| BR-42.03 | LIMIT 100 hardcodé | 🟢 Mineur |
| BR-42.04 | Filtres dynamiques composables | 🟡 Important |
| BR-42.05 | Filtre slots futurs + NOT EXISTS bookings | 🔴 Critique |
| BR-42.06 | Mask address selon precision | 🔴 Critique |
| BR-42.07 | is_owner détection (coach OR admin) | 🔴 Critique |
| BR-42.08 | Suppression champs sensibles non-owner | 🔴 Critique |
| BR-42.09 | Search vue light (slots=packages=[]) | 🟡 Important |
| BR-42.10 | Mine vue owner complète | 🟡 Important |
| BR-42.11 | Saved format plat distinct | 🔴 Critique |
| BR-42.12 | `available_slots` count sans filtre booking | 🟡 Important |
| BR-42.13 | `days_until_media_purge` calcul UTC-aware | 🟡 Important |
| BR-42.14 | Detail sans filtre lifecycle | 🟡 Important |
| BR-42.15 | _fetch_pkg_slots séquentiel post-packages | 🔴 Critique |
| BR-42.16 | `images` parsing dual jsonb/text | 🟡 Important |
| BR-42.17 | `tag_ids` parsing dual | 🟡 Important |
| BR-42.18 | Coach JSON inline saved (json_build_object) | 🟢 Mineur |
