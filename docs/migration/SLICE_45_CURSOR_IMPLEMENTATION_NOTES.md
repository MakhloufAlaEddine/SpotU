# SLICE 45 — Cursor Implementation Notes (Packages)

> S45 ne crée **aucun nouveau endpoint** ni controller. Elle complète la couche service de S43 par la persistance des packages et de leurs slots imbriqués.

---

## 1. Architecture Java

### 1.1 Pas de nouveau controller
- **Aucun** `PackagesController` ou équivalent.
- Les endpoints `POST/PUT/PATCH /api/services` (déjà créés en S43) restent les seules portes d'entrée.

### 1.2 Pas de nouveau DTO HTTP
- `ServicePackageItemDto` et `DaySlotPayloadDto` (déjà déclarés en S43, accepté mais traitement stub) deviennent **fonctionnels** dans S45.
- ⚠️ **`ServiceUpdateDto` ne doit PAS contenir `packages`** — asymétrie volontaire BR-45.12.

### 1.3 Service métier : enrichir `ServicesCoachService.create()`
Ajouter dans `com.spotyou.api.services.ServicesCoachService` :
```java
@Transactional
public Service create(ServiceCreateDto data, Principal principal) {
    // ... auth check S43 ...
    String serviceId = IdGenerator.newId("svc");

    // S45 — Calcul service_price si null
    BigDecimal servicePrice = data.price();
    if (servicePrice == null) {
        servicePrice = data.packages().stream()
            .map(ServicePackageItemDto::price)
            .min(Comparator.naturalOrder())
            .orElse(BigDecimal.ZERO);
    }

    // S43 — INSERT services
    insertService(conn, serviceId, data, servicePrice, ...);

    // S45 — INSERT packages + slots de packages
    for (ServicePackageItemDto pkg : data.packages()) {
        String packageId = IdGenerator.newId("pkg");
        packagesRepo.insert(packageId, serviceId, pkg);
        for (DaySlotPayloadDto slot : pkg.slots()) {
            String slotId = IdGenerator.newId("slot");
            slotsRepo.insertPackageSlot(slotId, serviceId, packageId, slot);
        }
    }

    // S43 — INSERT locations
    List<String> locIds = persistLocations(conn, serviceId, data.locations());

    // S44 — INSERT slots legacy
    if (data.slots() != null) {
        persistSlots(conn, serviceId, data.slots(), locIds);
    }

    // Read enrich → response
    return enrichService(conn, serviceId);
}
```

### 1.4 Repository : `ServicePackagesRepository`
```java
public interface ServicePackagesRepository {
    void insert(String packageId, String serviceId, ServicePackageItemDto pkg);
    // Pas de méthode update/delete : pas de chemin Python.
    // listByServiceId déjà géré par S42 (read).
}
```

### 1.5 Méthode dédiée sur `ServiceSlotsRepository` (extension S44)
```java
public interface ServiceSlotsRepository {
    // ... méthodes S44 ...

    /** S45 — INSERT slot de package (slot_type='single' literal). */
    void insertPackageSlot(String slotId, String serviceId, String packageId, DaySlotPayloadDto slot);
}
```

### 1.6 Entité `ServicePackage`
```java
public record ServicePackage(
    String packageId,
    String serviceId,
    String typeId,
    String typeLabel,
    Integer durationMin,    // default 60
    Integer maxParticipants, // default 1
    BigDecimal price,        // numeric(10,2), default 0.00
    Instant createdAt
) {}
```

> ⚠️ **`BigDecimal` obligatoire** pour `price` (NUMERIC(10,2)). Ne pas utiliser `Double` qui perd de la précision sur les centimes.

---

## 2. Logique de persistance (POST /services)

### 2.1 Ordre d'opérations strict
```
1. INSERT services             (S43)
2. INSERT service_packages × N (S45) ← BEFORE slots de packages
3.   INSERT service_slots × M  (S45, package_id set, slot_type='single')
4. INSERT service_locations    (S43)
5. INSERT service_slots legacy (S44, package_id NULL)
6. SELECT + enrich → response  (S42)
```

### 2.2 INSERT service_packages
```java
jdbc.update(
  "INSERT INTO service_packages " +
  "  (package_id, service_id, type_id, type_label, " +
  "   duration_min, max_participants, price) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?)",
  packageId,
  serviceId,
  pkg.typeId(),
  pkg.typeLabel(),
  pkg.durationMin() != null ? pkg.durationMin() : 60,
  pkg.maxParticipants() != null ? pkg.maxParticipants() : 1,
  pkg.price() != null ? pkg.price() : BigDecimal.ZERO
);
```

### 2.3 INSERT slot de package
```java
jdbc.update(
  "INSERT INTO service_slots " +
  "  (slot_id, service_id, package_id, slot_type, " +
  "   slot_date, start_time, end_time) " +
  "VALUES (?, ?, ?, 'single', ?, ?, ?)",   // 'single' literal
  slotId,
  serviceId,
  packageId,
  slot.slotDate(),
  slot.startTime(),
  slot.endTime()
);
// location_id, days_of_week, day_of_week, raw_schedule, slot_status
// → laissés au DEFAULT DB (NULL / '[]' / 'available')
```

> ⚠️ **NE PAS spécifier** `location_id`, `days_of_week`, `slot_status`. Iso Python.

---

## 3. Logique de non-modification (PUT/PATCH /services/{id})

### 3.1 DTO `ServiceUpdateDto` Java — règle absolue
```java
public record ServiceUpdateDto(
    Optional<String> title,
    // ... tous les champs S43/S44 ...
    Optional<List<ServiceSlotItemDto>> slots
    // ⚠️ ABSENCE VOLONTAIRE de packages — ne PAS l'ajouter
) {}
```

### 3.2 Configuration Jackson
```java
@JsonIgnoreProperties(ignoreUnknown = true)
public record ServiceUpdateDto(...) {}
```
- `ignoreUnknown=true` ⇒ si le client envoie `packages: [...]`, Jackson l'ignore silencieusement (parité Python `extra='ignore'`).
- ⚠️ **NE PAS** activer `failOnUnknownProperties` pour ce DTO.

### 3.3 Aucune méthode dans `ServicesCoachService.update()` ne touche aux packages
- Pas de `packagesRepo.deleteByServiceId(...)`.
- Pas de `packagesRepo.upsert(...)`.
- Pas de `packagesRepo.insert(...)`.

---

## 4. Calcul `service_price` (BigDecimal)

```java
BigDecimal servicePrice = data.price();
if (servicePrice == null) {
    servicePrice = data.packages() == null || data.packages().isEmpty()
        ? BigDecimal.ZERO
        : data.packages().stream()
            .map(p -> p.price() != null ? p.price() : BigDecimal.ZERO)
            .min(Comparator.naturalOrder())
            .orElse(BigDecimal.ZERO);
}
// Persisté tel quel dans services.price.
```

> ⚠️ **`data.price()=BigDecimal.ZERO` doit être respecté** (cf. TC-S45-1.5). Ne pas confondre avec `null`.

---

## 5. Transactions

- **`@Transactional`** déjà recommandé en S43. Couvre automatiquement S44 + S45.
- L'atomicité garantit : soit tout (service + packages + slots de packages + locations + slots legacy) est inséré, soit rien.

---

## 6. Erreurs

### 6.1 Erreurs propagées
- `ServicePackageItem.type_id` / `type_label` manquants → 422 (Pydantic-like / Bean Validation).
- `DaySlotPayload.slot_date` / `start_time` / `end_time` manquants → 422.
- Aucun autre check métier (price < 0, duration_min ≤ 0, etc.) — iso Python.
- Erreur SQL (FK violation, NUMERIC overflow) → 500.

### 6.2 Format erreur
- Réutiliser `@ControllerAdvice` global de S43.
- 422 avec liste d'erreurs Pydantic-like.

---

## 7. Pièges connus

| # | Piège | Mitigation |
|---|-------|------------|
| 1 | Ajouter `packages` à `ServiceUpdateDto` | Ne PAS le faire. Asymétrie volontaire BR-45.12. |
| 2 | Filtrer DELETE slots par `package_id IS NULL` | Ne PAS le faire (cf. BR-44.09 / BR-45.13). |
| 3 | Spécifier `slot_status` à l'INSERT slot de package | Ne PAS le faire. DEFAULT 'available'. |
| 4 | Oublier `slot_type='single'` literal | Hardcodé Python. À reproduire en Java (literal SQL). |
| 5 | Set `location_id` sur slots de packages | NE PAS le faire. Toujours NULL. |
| 6 | Utiliser `Double` pour `price` | Utiliser `BigDecimal`. Précision NUMERIC(10,2). |
| 7 | Recalculer `service.price` lors de PUT | Iso Python : `data.price` figé après création. |
| 8 | Trier les packages autrement que `created_at ASC` | Iso S42 helper. |
| 9 | Ajouter unicité `(service_id, type_id)` | Ne PAS le faire (BR-45.17). |
| 10 | Ajouter `updated_at` à `service_packages` | Ne PAS le faire (BR-45.16). |
| 11 | Valider `price >= 0` au niveau package | Ne PAS le faire (BR-45.04). Asymétrie vs `service.price`. |
| 12 | Insérer slots avant packages | FK violation. Toujours packages → slots (FK `package_id`). |
| 13 | Confondre slots legacy (S44) et slots de packages (S45) | `package_id NULL` vs `NOT NULL`. Filtres distincts en lecture. |
| 14 | Ignorer le calcul `min(packages.price)` quand `data.price=null` | Doit toujours s'exécuter, default `BigDecimal.ZERO`. |
| 15 | Ne pas cascader bien sur DELETE FROM services | FK CASCADE déjà en place. Vérifier en migration Java. |

---

## 8. Critères de Done

- [ ] Code Java compile, lint OK.
- [ ] `ServicesCoachService.create()` insère bien les packages **après** le service et **avant** les slots de packages.
- [ ] Pour chaque package, les slots sont insérés avec `slot_type='single'` literal et `package_id` set.
- [ ] `service_price` calculé : `data.price` si fourni, sinon `min(packages.price)`, sinon `BigDecimal.ZERO`.
- [ ] `ServiceUpdateDto` n'expose **PAS** `packages` (vérifié via test JSON binding).
- [ ] Tous les TC `SLICE_45_TEST_CASES.md` passent (≥ 25 cas critiques).
- [ ] La lecture (`GET /services/{id}`, `/services/mine`) reflète immédiatement les packages créés.
- [ ] Pricing engine (S30/S37) consomme correctement `service_packages.price` lors d'un booking.
- [ ] Aucun nouvel endpoint REST exposé.
- [ ] FK `service_packages.service_id → services` `ON DELETE CASCADE` appliquée par migration JDBC.
- [ ] FK `service_slots.package_id → service_packages` `ON DELETE SET NULL` appliquée.
- [ ] `BigDecimal` utilisé partout pour `price`.
- [ ] `@Transactional` couvre create.
- [ ] Documentation Javadoc référence Python source (lignes 794–811, 763–767).
- [ ] Code review : un dev senior valide la parité avec Python ligne-à-ligne.

---

## 9. Plan de cutover front

1. S45 mergée → le front continue d'envoyer `packages[]` au POST.
2. Smoke test : créer un service avec packages + slots → vérifier réservation possible (pricing engine, S30).
3. Surveiller logs Java pour erreurs 5xx pendant 24h.
4. **Front** : s'assurer que les écrans d'édition de service ne tentent **PAS** d'envoyer `packages` au PUT (sera ignoré silencieusement). Si l'UX exige une « édition » de packages, c'est une **évolution produit** (out of scope migration).

---

## 10. Références croisées

- **S30** (Booking create + pay) ✅ : pricing engine consomme `service_packages.price`.
- **S37** (Price preview) ✅ : lookup package_id pour calcul tarif.
- **S42** (Services Reads) ✅ : helpers `_get_service_packages` et batch `_fetch_packages`.
- **S43** (Services CRUD principal) ✅ : endpoints HTTP.
- **S44** (Slots legacy) ✅ : `service_slots` schéma et infra repository.

---

## 11. Note de cutover front (post-S45)

Avec S43+S44+S45 mergées, le **domaine Services Coach Writes est entièrement migré côté Java**. Le front peut switcher 100% des endpoints services vers Java en production sans perte fonctionnelle.

**Reste hors-domaine** :
- `POST /services/{id}/save` + `DELETE /unsave` → slice favoris (mineur).
- Buyer-side reservation/purchase UI (P2 backlog).
