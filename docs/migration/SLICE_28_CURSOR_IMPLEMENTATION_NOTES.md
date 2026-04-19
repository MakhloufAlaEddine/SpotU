# SLICE_28_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation Cursor
> Généré le 2026-04-19.

---

## 1. Architecture Java cible

```
src/main/java/com/spotu/
├── controller/
│   └── TagPointWriteController.java      ← 🔴 S28 (3 endpoints)
├── service/
│   └── TagPointWriteService.java         ← 🔴 S28 (logique CRUD + diff)
├── repository/
│   └── TagPointRepository.java           ← S26 existant — ajouter INSERT/UPDATE natifs
├── dto/
│   ├── CreateTagPointRequest.java        ← 🔴 S28
│   └── UpdateTagPointRequest.java        ← 🔴 S28
├── util/
│   └── GeoRandomizer.java               ← 🔴 S28 (randomize_for_storage)
```

---

## 2. PostGIS INSERT pattern Java

```java
@Modifying
@Query(value = """
    INSERT INTO tag_points
      (point_id, user_id, title, description,
       location, precision, tag_ids, domain_id,
       active, expires_at, event_date, event_end_date, event_schedule,
       images, minimum_participants, maximum_participants, address,
       visibility_type, join_mode, invite_permissions, max_community_members)
    VALUES (:id, :userId, :title, :desc,
            ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :precision,
            :tagIds::jsonb, :domainId,
            TRUE, :expiresAt, :eventDate, :eventEndDate, :eventSchedule::jsonb,
            :images::jsonb, :minP, :maxP, :address,
            :visType, :joinMode, :invPerms, :maxComm)
    """, nativeQuery = true)
void insertTagPoint(@Param("id") String id, @Param("userId") String userId, ...);
```

**PIÈGE `::jsonb`** : Named parameter `tag_ids` doit être passé comme String JSON. `ObjectMapper.writeValueAsString(list)` avant passage.

---

## 3. Update SQL dynamique en Java

```java
public void updateTagPoint(String pointId, Map<String, Object> fields,
                           Double lat, Double lng) {
    StringBuilder sql = new StringBuilder("UPDATE tag_points SET ");
    Map<String, Object> params = new HashMap<>();
    List<String> setClauses = new ArrayList<>();

    if (lat != null && lng != null) {
        setClauses.add("location = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)");
        params.put("lng", lng);
        params.put("lat", lat);
    }

    Set<String> JSONB_FIELDS = Set.of("tag_ids", "images", "event_schedule");
    for (var entry : fields.entrySet()) {
        String key = entry.getKey();
        if (entry.getValue() == null) {
            setClauses.add(key + " = NULL");
        } else if (JSONB_FIELDS.contains(key)) {
            setClauses.add(key + " = :" + key + "::jsonb");
            params.put(key, objectMapper.writeValueAsString(entry.getValue()));
        } else {
            setClauses.add(key + " = :" + key);
            params.put(key, entry.getValue());
        }
    }

    setClauses.add("updated_at = NOW()");
    params.put("pointId", pointId);
    sql.append(String.join(", ", setClauses));
    sql.append(" WHERE point_id = :pointId");

    namedJdbc.update(sql.toString(), params);
}
```

---

## 4. `_vals_equal` diff en Java

```java
private boolean valsEqual(Object newVal, Object oldVal) {
    if (newVal == null && oldVal == null) return true;
    if (newVal == null || oldVal == null) return false;
    // Timestamps → UTC comparison
    if (oldVal instanceof OffsetDateTime) {
        try { return ((OffsetDateTime)oldVal).toInstant().equals(
                      OffsetDateTime.parse(newVal.toString()).toInstant()); }
        catch (Exception e) { return String.valueOf(newVal).equals(String.valueOf(oldVal)); }
    }
    // Floats → tolerance
    if (newVal instanceof Number && oldVal instanceof Number) {
        return Math.abs(((Number)newVal).doubleValue() - ((Number)oldVal).doubleValue()) < 1e-7;
    }
    // JSONB → serialize and compare
    if (newVal instanceof List || newVal instanceof Map || oldVal instanceof List || oldVal instanceof Map) {
        return objectMapper.writeValueAsString(newVal)
               .equals(objectMapper.writeValueAsString(oldVal));
    }
    return newVal.equals(oldVal);
}
```

---

## 5. Pièges critiques

### P1 — Double offset GPS
```
Create : randomize_for_storage (random sans seed) → coords stockées brouillées
Read (S26) : apply_precision_offset (seed déterministe) → coords affichées doublement brouillées
Les 2 offsets sont INDÉPENDANTS — c'est voulu.
```

### P2 — JSONB `$N::jsonb` en Java
```
JPA named params + ::jsonb : passer la valeur comme String JSON.
Alternative : utiliser PgObject avec type="jsonb".
```

### P3 — Notification conditioned on `has_real_changes AND NOT cancelled`
```
Ne pas envoyer de notifications si :
- Aucun vrai changement détecté (même body reçu mais valeurs identiques)
- SpotYou annulé (cancelled=true)
```

---

## 6. Critères de done

| # | Critère | Tests |
|---|---|---|
| D1 | POST create avec PostGIS INSERT | TC-CR-01 |
| D2 | Auto-membership owner | TC-CR-02 |
| D3 | Validation tag_ids, images, min/max | TC-CR-03,04,05 |
| D4 | randomize_for_storage pour precision!=exact | TC-CR-08,09 |
| D5 | Défauts visibility/join/invite | TC-CR-10 |
| D6 | PUT update dynamique JSONB + location | TC-UP-01,08,09 |
| D7 | Owner/admin permission | TC-UP-02,14 |
| D8 | Images retirées supprimées | TC-UP-10 |
| D9 | Diff → notifications conditionnelles | TC-UP-11,12,13 |
| D10 | PATCH new-date toggle | TC-ND-01,02 |

---

## 7. Relation avec les Slices

| Slice | Interaction |
|---|---|
| S26 | build_point_response, TP_FIELDS — réutilisés pour la réponse create/update |
| S27 | spot_you_members — auto-membership (S28) alimente les données lues par S26/S27 |
| S24 | delete_upload_files — appelé par update pour les images retirées |
| S25 | Home feed — les nouveaux SpotYou créés apparaîtront dans le feed |
