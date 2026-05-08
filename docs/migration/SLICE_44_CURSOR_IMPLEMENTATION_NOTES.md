# SLICE 44 — Cursor Implementation Notes (Slots / Disponibilités)

> S44 ne crée **aucun nouveau endpoint** ni controller. Elle complète la couche service de S43 par la persistance des slots.

---

## 1. Architecture Java

### 1.1 Pas de nouveau controller
- **Aucun** `SlotsController` ou équivalent.
- Les endpoints `POST/PUT/PATCH /api/services` (déjà créés en S43) restent les seules portes d'entrée.

### 1.2 Pas de nouveau DTO HTTP
- `ServiceSlotItemDto` (déjà déclaré en S43, accepté mais traitement stub) devient **fonctionnel** dans S44.
- Pas d'endpoint REST exposant directement `ServiceSlotItemDto`.

### 1.3 Service métier : enrichir `ServicesCoachService`
Ajouter dans `com.spotyou.api.services.ServicesCoachService` :
```java
// Méthodes privées appelées par create() et update()
private void persistSlots(Connection conn, String serviceId, List<ServiceSlotItemDto> slots, List<String> locIdList);
private List<String> resolveLocationIds(Connection conn, String serviceId, List<String> newLocIds, boolean locationsProvided);
```

### 1.4 Repository : `ServiceSlotsRepository`
```java
public interface ServiceSlotsRepository {
    void deleteByServiceId(String serviceId);
    void insert(ServiceSlot entity);
}
```

### 1.5 Entité `ServiceSlot`
Mapper exactement les colonnes :
```java
public record ServiceSlot(
    String slotId,
    String serviceId,
    String locationId,    // nullable
    String packageId,     // null pour S44 legacy slots
    String slotType,      // recurring | single | availability
    String slotStatus,    // 'available' DEFAULT, ne pas le set
    String slotDate,      // 'YYYY-MM-DD' string, nullable
    String startTime,     // 'HH:MM' string
    String endTime,       // 'HH:MM' string
    Integer dayOfWeek,    // 0-6 nullable (legacy)
    List<Integer> daysOfWeek, // jsonb
    Map<String,Object> rawSchedule  // jsonb, NULL en S44 (asymétrie)
) {}
```

> ⚠️ Garder `slot_date`, `start_time`, `end_time` en `String` (pas `LocalDate`/`LocalTime`). Le code Python les manipule comme strings et le SQL `(slot_date || ' ' || start_time)::timestamp` dépend de cette concaténation textuelle.

---

## 2. Logique de persistance

### 2.1 Sur `create_service()` (POST /services)
Après l'insertion des locations (ordre crucial) :
```java
@Transactional
public Service create(ServiceCreateDto data, Principal principal) {
    // ... S43 service insert ...
    // ... S43 packages insert (S45 stub) ...

    List<String> locIds = persistLocations(conn, sid, data.locations());

    // S44 — persist slots
    if (data.slots() != null) {
        for (ServiceSlotItemDto slot : data.slots()) {
            insertSlot(conn, sid, null /* package_id legacy */, slot, locIds);
        }
    }
    // ... return enriched ...
}
```

### 2.2 Sur `update_service()` (PUT/PATCH /services/{id})
```java
@Transactional
public Service update(String serviceId, ServiceUpdateDto data, Principal principal) {
    // ... S43 auth, scalar updates, locations replace ...
    List<String> newLocIds = ...; // populated only if data.locations() != null

    // S44 — slots replace strategy (None=keep, []=wipe, [...]=replace)
    if (data.slots() != null) {
        slotsRepo.deleteByServiceId(serviceId);
        List<String> locIdList = newLocIds.isEmpty()
            ? locationsRepo.listIdsOrderedByCreatedAt(serviceId)
            : newLocIds;
        for (ServiceSlotItemDto slot : data.slots()) {
            insertSlot(conn, serviceId, null, slot, locIdList);
        }
    }
    // ... return enriched ...
}
```

> ⚠️ **Important** : `data.slots()` doit retourner `Optional<List<...>>` ou `JsonNullable` afin de distinguer `null` (champ absent) de `[]` (vide explicite). Ne jamais convertir au binding.

### 2.3 `insertSlot` helper
```java
private void insertSlot(Connection conn, String serviceId, String packageId,
                        ServiceSlotItemDto slot, List<String> locIdList) {
    // Resolve days
    List<Integer> days = slot.daysOfWeek() != null
        ? slot.daysOfWeek()
        : (slot.dayOfWeek() != null ? List.of(slot.dayOfWeek()) : List.of());

    // Resolve location_id
    String resolvedLocId;
    if (slot.locationIndex() != null && slot.locationIndex() >= 0
            && slot.locationIndex() < locIdList.size()) {
        resolvedLocId = locIdList.get(slot.locationIndex());
    } else {
        resolvedLocId = locIdList.isEmpty() ? null : locIdList.get(0);
    }

    String slotId = IdGenerator.newId("slot");

    jdbc.update(
      "INSERT INTO service_slots " +
      "  (slot_id, service_id, location_id, slot_type, " +
      "   days_of_week, day_of_week, start_time, end_time, slot_date) " +
      "VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?)",
      slotId,
      serviceId,
      resolvedLocId,
      slot.slotType() != null ? slot.slotType() : "recurring",
      objectMapper.writeValueAsString(days),
      days.isEmpty() ? null : days.get(0),
      slot.startTime() != null ? slot.startTime() : "00:00",
      slot.endTime() != null ? slot.endTime() : "00:00",
      slot.slotDate()
    );
    // package_id reste NULL pour S44.
    // raw_schedule reste NULL (asymétrie volontaire — Python ne le persiste pas).
}
```

> ⚠️ **NE PAS écrire `raw_schedule`** même si le DTO le contient. Iso Python.

---

## 3. Transactions

- Utiliser **`@Transactional`** sur les méthodes `create()` et `update()` de `ServicesCoachService` (déjà recommandé en S43).
- Le DELETE + INSERT du replace doit être atomique. `@Transactional` couvre ça naturellement.

> Python actuel n'a PAS de transaction explicite (asymétrie). Java impose `@Transactional` comme amélioration de robustesse documentée.

---

## 4. JSONB côté Java

### 4.1 `days_of_week`
```java
String json = objectMapper.writeValueAsString(daysList);
preparedStatement.setObject(idx, json, Types.OTHER);
// SQL : VALUES (?::jsonb)
```

### 4.2 `raw_schedule`
- Ne **JAMAIS** persister. Toujours envoyer `NULL` (équivalent `?` non-set ou `setNull(idx, Types.OTHER)`).

### 4.3 Lecture `days_of_week`
- Côté GET (S42, déjà migré) : parser le résultat JSONB en `List<Integer>`.

---

## 5. Concurrence

- **Aucun lock** à ajouter sur `service_slots` lors de POST/PUT.
- Les locks `FOR UPDATE NOWAIT` sont gérés par le service `BookingsService` (S30, déjà migré).
- Si un PUT replace concurrent à un booking est possible, ne PAS ajouter de garde — c'est l'asymétrie BR-44.14.

---

## 6. Erreurs

### 6.1 Erreurs propagées
- Validation Pydantic Java ⇒ 422 (mais `ServiceSlotItem` n'a aucune validation, donc impossible en pratique).
- Erreur SQL CHECK CONSTRAINT (`day_of_week BETWEEN 0 AND 6`) ⇒ remonter en 500 (iso Python).
- Erreur SQL FK (improbable avec `service_id` fraîchement inséré dans la même transaction) ⇒ 500.

### 6.2 Format erreur
- Réutiliser le `@ControllerAdvice` global de S43.
- `{ "detail": "..." }` pour les erreurs métier.

---

## 7. Pièges connus

| # | Piège | Mitigation |
|---|-------|------------|
| 1 | `null` vs `[]` sur `slots` | Utiliser `JsonNullable<List<>>` ou `Optional<List<>>`. Ne jamais convertir. |
| 2 | `location_index` hors borne | Fallback silencieux sur `loc_ids[0]` ou null. NE PAS lever d'erreur. |
| 3 | `raw_schedule` accepté mais non persisté | Asymétrie volontaire. Documenter en Javadoc. |
| 4 | `location_id` direct ignoré | Le DTO l'expose pour compat read mais ignorer en write. |
| 5 | Replace truncate global (slot_id package compris) | Iso Python. NE PAS filtrer par `package_id IS NULL`. |
| 6 | `slot_status` non spécifié | Laisser le DEFAULT DB `'available'`. NE PAS le passer en INSERT. |
| 7 | `day_of_week` legacy auto-rempli | `days[0] if days else NULL`. Reproduire. |
| 8 | `slot_date` string non parsée | Ne PAS parser en `LocalDate`. Stocker comme `String`. |
| 9 | `start_time`/`end_time` strings | Idem. Le filtre lecture utilise concat string ⇒ doit rester string. |
| 10 | Cascade FK `service_locations → SET NULL` | Iso ; les slots non touchés peuvent perdre leur `location_id`. |
| 11 | JSONB cast `::jsonb` | Toujours sur `days_of_week`. Sans cast → erreur PostgreSQL. |
| 12 | Booking pointant slot supprimé | Iso Python. NE PAS valider. |
| 13 | `slot_type='specific'` jamais créé en write | Mais accepté en read (S30 mutate). NE PAS l'introduire en write. |
| 14 | DELETE order vs INSERT order | DELETE en premier, puis INSERT. Sinon FK potentiel. Atomicité par `@Transactional`. |

---

## 8. Critères de Done

- [ ] Code Java compile, lint OK.
- [ ] `ServicesCoachService.create()` insère bien les slots après les locations.
- [ ] `ServicesCoachService.update()` applique la sémantique tri-état (`null`/`[]`/`list`) sur `data.slots`.
- [ ] La résolution `location_index` utilise les **nouvelles** locations si `data.locations != null`, sinon les existantes triées par `created_at`.
- [ ] Tous les TC `SLICE_44_TEST_CASES.md` passent (≥ 30 cas).
- [ ] La lecture (`GET /services/{id}`, S42) reste cohérente après création/update.
- [ ] `slot_status` reste à `'available'` après écriture (pas d'override).
- [ ] `raw_schedule` n'est jamais persisté (asymétrie respectée).
- [ ] Aucun nouvel endpoint REST exposé.
- [ ] `@Transactional` couvre create/update.
- [ ] Documentation Javadoc référence Python source (lignes 826–842, 949–977).
- [ ] Code review : un dev senior valide la parité avec Python ligne-à-ligne.

---

## 9. Plan de cutover front

1. S44 mergée → le front continue d'envoyer `slots[]` comme avant.
2. Smoke test : créer un service avec slots → vérifier réservation possible (POST /bookings/request avec un `slot_id` retourné par GET /services/{id}).
3. Surveiller logs Java pour erreurs 5xx pendant 24h.
4. Si OK → étendre à S45 (packages).

---

## 10. Références croisées

- **S30** (Booking create + pay) ✅ : state machine `slot_status`, lock `FOR UPDATE NOWAIT`.
- **S33** (expiry worker) ✅ : retour `slot_status → available`.
- **S42** (Services Reads) ✅ : helper `_get_service_slots`.
- **S43** (Services CRUD principal) ✅ : endpoints HTTP, locations.
- **S45** (à venir) : packages + slots de packages.

---

## 11. Note de migration progressive

Tant que S44 n'est pas mergée, le front **ne doit pas** envoyer `slots[]` aux endpoints Java en production (sinon ils seront ignorés silencieusement, créant des services « inchargeables »). Cf. `BLOCKERS_BEFORE_FRONT_SWITCH.md`.

Après S44 :
- Le front peut switcher `POST/PUT/PATCH /api/services` vers Java en toute sécurité.
- Reste le risque packages (cf. S45) — tant qu'un service crée des packages, le payload doit aller chez Python.
