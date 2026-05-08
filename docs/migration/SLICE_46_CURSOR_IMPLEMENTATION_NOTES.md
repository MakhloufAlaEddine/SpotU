# SLICE 46 — Cursor Implementation Notes (Save / Unsave Services)

> Petite slice ciblée. Pas de complexité. Implémentation Spring directe.

---

## 1. Architecture Java

### 1.1 Controller dédié
`com.spotyou.api.services.ServiceSavesController`

```java
@RestController
@RequestMapping("/api/services")
public class ServiceSavesController {

    @PostMapping("/{serviceId}/save")
    public Map<String, Object> save(
        @PathVariable String serviceId,
        Principal principal
    ) {
        return serviceSavesService.save(serviceId, principal);
    }

    @DeleteMapping("/{serviceId}/unsave")  // ⚠️ /unsave, pas /save
    public Map<String, Object> unsave(
        @PathVariable String serviceId,
        Principal principal
    ) {
        return serviceSavesService.unsave(serviceId, principal);
    }
}
```

> ⚠️ **PATH ASYMÉTRIQUE** : POST `/save`, DELETE `/unsave`. Documenter dans le code Javadoc :
> ```java
> /**
>  * [LEGACY-PARITY] DELETE path is "/unsave" (not "/save").
>  * Python source: service_routes.py:1123
>  */
> ```

### 1.2 Service métier
`com.spotyou.api.services.ServiceSavesService` :

```java
public Map<String, Object> save(String serviceId, Principal principal) {
    String userId = principal.getName();  // user_id du JWT

    // Check service exists AND active
    boolean exists = servicesRepo.existsByIdAndActive(serviceId);
    if (!exists) {
        throw new EntityNotFoundException("Service not found");
    }

    String saveId = IdGenerator.newId("svs");
    savesRepo.insertOnConflictDoNothing(saveId, serviceId, userId);

    return Map.of("success", true, "is_saved", true);
}

public Map<String, Object> unsave(String serviceId, Principal principal) {
    String userId = principal.getName();
    savesRepo.deleteByServiceAndUser(serviceId, userId);  // silent
    return Map.of("success", true, "is_saved", false);
}
```

### 1.3 Repository
`com.spotyou.api.services.ServiceSavesRepository`

```java
public interface ServiceSavesRepository {
    void insertOnConflictDoNothing(String saveId, String serviceId, String userId);
    int deleteByServiceAndUser(String serviceId, String userId);
}
```

Implémentation JdbcTemplate :
```java
@Override
public void insertOnConflictDoNothing(String saveId, String serviceId, String userId) {
    jdbc.update(
      "INSERT INTO service_saves (save_id, service_id, user_id) " +
      "VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      saveId, serviceId, userId
    );
}

@Override
public int deleteByServiceAndUser(String serviceId, String userId) {
    return jdbc.update(
      "DELETE FROM service_saves WHERE service_id = ? AND user_id = ?",
      serviceId, userId
    );
    // Return value (rows affected) ignoré — réponse toujours 200.
}
```

### 1.4 ServicesRepository — méthode existsByIdAndActive
```java
@Override
public boolean existsByIdAndActive(String serviceId) {
    Integer count = jdbc.queryForObject(
      "SELECT 1 FROM services WHERE service_id = ? AND active = TRUE",
      Integer.class,
      serviceId
    );
    return count != null;
}
```
> ⚠️ Ne PAS filtrer par `deleted_at IS NULL` séparément — `active=TRUE` suffit (le soft delete S43 met `active=FALSE`).

### 1.5 Pas de DTO
- Pas de body request → pas de DTO input.
- Réponse simple `Map<String, Object>` ou record dédié `SaveResponse(boolean success, boolean isSaved)`.

> ⚠️ Si record : assurer le mapping JSON `is_saved` (snake_case) via `@JsonProperty("is_saved")` ou config globale Jackson.

---

## 2. Génération `save_id`

- Format Python : `new_id("svs")` → `svs_<random_hex>`.
- Côté Java : `IdGenerator.newId("svs")` (utility déjà créée pour S43+).

---

## 3. Auth

- Récupérer `Principal` depuis `SecurityContext` (filtre JWT déjà en place).
- `principal.getName()` → `user_id`.
- Si pas de Principal ⇒ filtre JWT renvoie 401 avant d'atteindre le controller.

---

## 4. Erreurs

### 4.1 ExceptionHandler global
- `EntityNotFoundException` → 404 avec `{"detail": "Service not found"}`.
- Pas d'autre exception métier.

### 4.2 Format réponse
```json
{ "detail": "Service not found" }
```

### 4.3 Pas de transaction explicite
- Pas de `@Transactional` (peu de valeur ajoutée). 1 SQL atomique par endpoint.
- Si appliqué pour cohérence avec le reste : OK, sans impact.

---

## 5. Pièges connus

| # | Piège | Mitigation |
|---|-------|------------|
| 1 | Symétriser le path DELETE en `/save` | NE PAS le faire. Iso Python = `/unsave`. |
| 2 | Filtrer `active=TRUE` sur DELETE | Iso Python : pas de filtre. Permet le cleanup. |
| 3 | Vérifier l'existence avant DELETE | Iso Python : DELETE silent toujours 200. |
| 4 | Renvoyer 404 sur DELETE service inexistant | NE PAS le faire (BR-46.03). |
| 5 | Re-fetch `is_saved` depuis DB | Iso : valeur logique (POST=true, DELETE=false), pas un read. |
| 6 | Mettre à jour `saved_at` sur ON CONFLICT | NE PAS (BR-46.06). Le timestamp original reste. |
| 7 | Rate-limiter | Hors scope. Iso. |
| 8 | Ajouter notification au coach | Iso : pas implémenté Python. |
| 9 | Logguer un audit de save | Iso : pas implémenté. |
| 10 | Utiliser EntityManager.persist + @Unique catch | Préférer SQL direct `ON CONFLICT DO NOTHING`. Plus performant. |
| 11 | Filtre `service_id` format prefix `svc_` | Iso : aucun check format Python. |
| 12 | JSON snake_case | `is_saved` (pas `isSaved`) — vérifier Jackson config. |
| 13 | Confondre POST 404 (filtre active=TRUE) avec « erreur générique » | Le 404 vise spécifiquement « service inexistant OU inactif » (BR-46.02). |
| 14 | DELETE fuite cross-user | Filtre `WHERE user_id = ?` impératif. Iso. |

---

## 6. Critères de Done

- [ ] Code Java compile, lint OK.
- [ ] Controller `ServiceSavesController` expose `/save` (POST) et `/unsave` (DELETE).
- [ ] Path **asymétrique** correctement implémenté.
- [ ] POST 404 si service inexistant ou `active=FALSE`.
- [ ] POST 200 idempotent (doubles calls = pas de doublon DB grâce à ON CONFLICT DO NOTHING).
- [ ] DELETE 200 silent (toujours 200, jamais 404).
- [ ] DELETE filtre par `(service_id, user_id)` — pas de fuite cross-user.
- [ ] `saved_at` jamais mis à jour en cas de re-save.
- [ ] Réponse JSON strictement `{success, is_saved}`.
- [ ] Format snake_case `is_saved` correct (vérifié via test JSON).
- [ ] Tous les TC `SLICE_46_TEST_CASES.md` passent.
- [ ] Cohérence vérifiée avec `GET /services/saved` (S42).
- [ ] FK CASCADE preserved en migration JDBC.
- [ ] Aucun rate-limit, aucune notification, aucun audit (iso Python).

---

## 7. Plan de cutover front

1. S46 mergée → switcher les 2 endpoints front vers Java.
2. Smoke test : sauvegarder/désauvegarder un service depuis le front.
3. Vérifier que le bouton « favoris » réagit correctement.
4. Vérifier que `GET /services/saved` (déjà sur Java S42) reflète immédiatement.
5. Surveiller logs Java 24h.

---

## 8. Références croisées

- **S42** (Services Reads) ✅ : `GET /services/saved` consume `service_saves` peuplée par S46.
- **S43** (Services CRUD principal) ✅ : soft delete impacte le filtre `active=TRUE` du POST.
- **S27** (SpotYou membership) ✅ : pattern similaire `tag_point_saves` (référence design).
- **Marketplace save/unsave products** : à confirmer si existant et migré (hors scope S46).

---

## 9. Mini-glossaire

- **save** : ajout aux favoris (POST).
- **unsave** : retrait des favoris (DELETE).
- **service_saves** : table de jointure user × service.
- **idempotence** : double appel sans effet de bord.
- **active=TRUE** : service réservable. `FALSE` = désactivé manuel ou soft-deleted.
