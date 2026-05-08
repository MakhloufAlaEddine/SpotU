# SLICE 43 — Cursor Implementation Notes (Services Coach CRUD)

> Notes d'implémentation côté **Java/Spring Boot**. À lire avant d'écrire la moindre ligne de code.

---

## 1. Découpage Spring (controller / service / repository)

### 1.1 Controller
`com.spotyou.api.services.ServicesCoachController`

```
POST   /api/services                       → createService(@RequestBody ServiceCreateDto, Principal)
PUT    /api/services/{serviceId}           → updateService(...)
PATCH  /api/services/{serviceId}           → updateService(...)   // mêmes mappings
DELETE /api/services/{serviceId}           → deleteService(...)
POST   /api/services/{serviceId}/reactivate → reactivateService(...)
```

> ⚠️ **Mapper PUT et PATCH sur la même méthode** : `@RequestMapping(method = {RequestMethod.PUT, RequestMethod.PATCH}, path="/api/services/{id}")`. Pas de divergence sémantique côté Python ⇒ pas côté Java non plus.

### 1.2 Service (couche métier)
`com.spotyou.api.services.ServicesCoachService` :
- `create(...)`, `update(...)`, `softDelete(...)`, `reactivate(...)`.
- Centralise la **normalisation booking** (lecture `app_config`).
- Centralise le **diff images** sur update (appel à `MediaStorageService.deleteSync(urls)`).
- Délègue les opérations DB au repository.

### 1.3 Repositories
- `ServicesRepository` (table `services`).
- `ServiceLocationsRepository` (PostGIS).
- `ServiceSlotsRepository` (deferred S44 — stub OK).
- `ServicePackagesRepository` (deferred S45 — stub OK).
- `PendingFileDeletionsRepository` (déjà migré en S40 — réutiliser).
- `ConversationsRepository` (déjà migré — méthode update context_deleted).
- `AppConfigRepository` (lecture flags).
- `BookingsRepository` (méthode `countActiveByServiceId(serviceId)`).

### 1.4 DTOs
Reproduire exactement les modèles Pydantic :
- `ServiceCreateDto` (= ServiceCreate Python).
- `ServiceUpdateDto` (= ServiceUpdate Python).
- `ServiceLocationItemDto` (= ServiceLocationItem).
- `ServiceSlotItemDto` (= ServiceSlotItem) — accepté mais traité en S44.
- `ServicePackageItemDto` + `DaySlotPayloadDto` — acceptés mais traités en S45.

> ⚠️ **Important** : ajouter `booking_approval_mode`, `allow_pay_later`, `pay_later_expiration_minutes` dans `ServiceCreateDto` côté Java (alors qu'ils sont absents de `ServiceCreate` Pydantic). Cela ne casse pas la parité **comportementale** car le code Python les lit via `getattr` ; côté Java, l'exposition explicite est plus propre et garde le même comportement utilisateur.

### 1.5 Mapping vers `Service` (entité de réponse)
- Réutiliser le mapper de S42 (`build_service` + `_enrich_service`). C'est la **même** sortie pour POST/PUT/PATCH.
- L'enrichissement (locations + slots + packages + is_saved) est obligatoire.

---

## 2. Transaction & cohérence

### 2.1 Imposer `@Transactional`
> Le code Python n'utilise pas de transaction explicite (asymétrie #5 de `BUSINESS_RULES.md`). Côté Java, **on doit imposer `@Transactional`** sur les 4 méthodes du service :
- `create`, `update`, `softDelete`, `reactivate`.

C'est une amélioration de robustesse **sans impact métier**. Documenter dans le code :
```java
/**
 * Override Python: handler not transactional in legacy.
 * We wrap in @Transactional for atomicity. No business behavior change.
 */
```

### 2.2 Ordre des opérations à respecter strictement
Voir `SLICE_43_DB_MAPPING.md` §12. Toute déviation peut rompre la parité (ex. UPDATE conversations doit être après UPDATE services dans DELETE).

### 2.3 Lock optimiste / pessimiste
- Aucun mécanisme de lock Python actuellement.
- **Ne PAS** ajouter de lock côté Java (out of scope).

---

## 3. PostGIS (`service_locations.location`)

### 3.1 Stratégie JDBC
- Utiliser **JDBC Template** ou JPA avec `@Convert` Hibernate Spatial.
- Préférer JDBC Template pour rester proche du SQL Python :
  ```java
  jdbc.update(
    "INSERT INTO service_locations (location_id, service_id, location, precision, description) " +
    "VALUES (?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326), ?, ?)",
    locationId, serviceId, longitude, latitude, precision, description
  );
  ```
- ⚠️ **Ordre crucial** : `ST_MakePoint(longitude, latitude)` (X, Y).

### 3.2 SRID
- Toujours `4326` (WGS-84). Ne jamais changer.

### 3.3 Lecture
- Out of scope (lecture migrée en S42).

---

## 4. JSONB (`tag_ids`, `images`)

### 4.1 INSERT (POST)
- Sérialiser la liste Java en JSON via Jackson.
- Passer la string JSON en paramètre, **avec cast `::jsonb`** :
  ```java
  jdbc.update(
    "INSERT INTO services (..., tag_ids, ..., images, ...) VALUES (..., ?::jsonb, ..., ?::jsonb, ...)",
    ..., toJsonString(tagIds), ..., toJsonString(images), ...
  );
  ```

### 4.2 UPDATE dynamique
- Construire le SQL `SET` dynamiquement comme en Python.
- Ne pas oublier `::jsonb` pour `tag_ids` et `images`.
- Ajouter en **dernier** la condition `WHERE service_id = ?`.

### 4.3 Lecture côté UPDATE images
- `SELECT images FROM services WHERE service_id = ?` retourne potentiellement :
  - String JSON → `jackson.readValue(..., List.class)`.
  - Tableau JDBC → conversion directe.
  - `null` → liste vide.
- Reproduire exactement le code Python (try/except → fallback `[]`).

---

## 5. Suppression d'images

### 5.1 Sur UPDATE (sync)
- Appel à `mediaStorageService.deleteUrls(removedUrls)`.
- Implémentation **synchrone** : R2 (S3 SDK) `deleteObjects`, ou suppression FS locale.
- En cas d'erreur sur un fichier : **logger + continuer** (ne pas faire échouer la requête HTTP). Comportement Python identique (boucle avec try/except au sein de `delete_upload_file`).

### 5.2 Sur DELETE service (async via worker)
- **Aucun appel** au service de stockage.
- INSERT lignes dans `pending_file_deletions` avec `entity_type='service'`, `scheduled_at = now + 90 jours`.
- Le worker (déjà migré S40) prendra la main.

### 5.3 Sur REACTIVATE
- DELETE des lignes `pending_file_deletions WHERE entity_id = serviceId AND status = 'pending'`.
- Pas de touche au stockage : les fichiers n'ont pas été supprimés (le worker n'a pas tourné si < 90j).

---

## 6. Normalisation booking (`app_config`)

### 6.1 Service utilitaire
Centraliser dans `BookingConfigNormalizer` :
```java
public record BookingConfig(String mode, boolean payLater, Integer expiryMinutes) {}

public BookingConfig normalize(String mode, boolean payLater, Integer expiry, AppFlags flags) {
    String m = (mode != null ? mode : "instant_booking");
    boolean pl = payLater;
    Integer ex = expiry;
    if (!flags.enableManualApproval()) m = "instant_booking";
    if (!flags.enablePayLater()) { pl = false; ex = null; }
    return new BookingConfig(m, pl, ex);
}
```

### 6.2 Defaults différents POST vs PUT (asymétrie à conserver)
- POST : `mode default = 'manual_approval'` (avant normalisation).
- PUT  : `mode default = 'instant_booking'` (avant normalisation).
- POST : `payLater default = true`, `expiry default = 1440`.
- PUT  : `payLater default = false`, `expiry default = 1440`.

### 6.3 Persistance `pay_later_expiration_minutes`
- Insertion / update : `expiry != null ? expiry : 1440`. Jamais NULL.

---

## 7. Gestion d'erreurs

### 7.1 ExceptionHandler dédié
Réutiliser `@ControllerAdvice` global déjà en place. Mapper :
- `EntityNotFoundException` → 404 avec message du Python (anglais ou français selon endpoint).
- `ForbiddenException` → 403 avec message exact.
- `ConflictException` → 409 avec message exact.
- `ConstraintViolationException` (Bean Validation) → 422 (forcer status 422, pas 400).

### 7.2 Format `{detail: "..."}`
Le front consomme `error.detail`. Forcer ce format dans tous les handlers :
```json
{ "detail": "Service not found" }
```

### 7.3 Messages exacts
- 403 POST : `Coach role required`.
- 403 PUT : `Not authorized`.
- 403 DELETE : `Not authorized`.
- 403 REACTIVATE : `Non autorisé`.
- 404 PUT : `Service not found`.
- 404 DELETE : `Service not found`.
- 404 REACTIVATE : `Service introuvable`.
- 409 DELETE : `Impossible de supprimer : N réservation(s) active(s) sur ce service. Annulez-les d'abord.`.
- 409 REACTIVATE : `Ce service est déjà actif`.
- 422 validations : reproduire les messages Pydantic.

### 7.4 Format 422 Pydantic
Recréer la structure FastAPI/Pydantic dans le `ConstraintViolationException` handler :
```json
{
  "detail": [
    { "type": "value_error", "loc": ["body","title"], "msg": "...", "input": "..." }
  ]
}
```

---

## 8. Sécurité / Auth

- Filtre JWT déjà en place (S1+). Récupérer `Principal` depuis `SecurityContext`.
- Tester `principal.role` pour le rôle (POST 403 et garde booking).
- Ne **pas** stocker de session — stateless.

---

## 9. Pièges connus à éviter

1. **`ServiceCreate` Pydantic n'a pas les champs booking_*** → côté Java, accepter ces champs explicitement dans le DTO mais conserver les **defaults Python** (`'manual_approval'`, `true`, `1440`).
2. **Inverser longitude/latitude** : `ST_MakePoint(longitude, latitude)` est l'ordre **X, Y**. Le payload front utilise `latitude` / `longitude` séparément.
3. **`images=null` vs `images=[]`** : différence cruciale (None=keep vs [] = wipe). En Java, ne jamais convertir `null → []` au binding du DTO. Utiliser `Optional<List<String>>` ou `JsonNullable<List<String>>`.
4. **`locations=null` vs `[]`** : idem.
5. **JSONB cast** : oublier `::jsonb` ⇒ erreur PostgreSQL.
6. **Garde booking active** : statuts à matcher `IN ('pending','accepted','awaiting_payment','confirmed')`. Aucun autre statut. Admin bypass.
7. **Conversations** : matching uniquement par `context_id` (pas de filtre par `context_type`). Iso Python.
8. **`media_purged` reste TRUE** après réactivation. Ne pas le réinitialiser.
9. **`ON CONFLICT DO NOTHING`** sur `pending_file_deletions` doit être conservé.
10. **Format ISO timestamp** : `media_purge_scheduled_at` et `reactivated_at` doivent être sérialisés en ISO-8601 (UTC). Ne pas utiliser le format Java par défaut (qui peut différer).
11. **Pas de transaction Python** : NE PAS chercher à reproduire l'absence de transaction côté Java. Imposer `@Transactional` (justifié comme amélioration de robustesse).
12. **Whitelist scalar PUT** : ne pas ajouter de champs (ex. `coach_id`, `created_at`). Iso Python.
13. **Pas de validation min length / max images sur PUT** : asymétrie volontaire à conserver.
14. **Defaults différents POST/PUT pour booking** : à conserver (asymétrie #2).

---

## 10. Critères de Done

- [ ] Code Java compile, lint OK.
- [ ] Tous les TC de `SLICE_43_TEST_CASES.md` passent (≥ 38 cas).
- [ ] Réponses HTTP iso-Python (status + body strictement identiques).
- [ ] Stockage R2/FS (sync) testé avec mock pour TC-2.7 et TC-2.8.
- [ ] Worker `pending_file_deletions` (S40) consomme bien les lignes créées par S43.
- [ ] Aucun appel à des endpoints Python depuis le front pour ces 5 routes (vérification réseau via `BLOCKERS_BEFORE_FRONT_SWITCH.md`).
- [ ] Logs structurés en place (level INFO sur DELETE/REACTIVATE).
- [ ] `@Transactional` sur les 4 méthodes service.
- [ ] Documentation Javadoc référence les fichiers Python source.
- [ ] Code review : un dev senior valide la parité avec Python ligne-à-ligne sur les 5 endpoints.

---

## 11. Plan de cutover front (post-merge)

1. Côté front, switcher la base URL **uniquement** pour ces 5 routes.
2. Smoke test manuel (créer service test, l'éditer, le supprimer, le réactiver).
3. Surveiller les logs Java pour erreurs 5xx pendant 24h.
4. Si OK → étendre à S44 (slots) puis S45 (packages).

---

## 12. Références croisées

- **S40** (Marketplace lifecycle) : worker `pending_file_deletions` réutilisable.
- **S42** (Services Reads) : `_enrich_service` mapper réutilisable.
- **S44** (à venir) : implémentation `service_slots` write.
- **S45** (à venir) : implémentation `service_packages` write.
- **Slice favoris** (à planifier) : `save/unsave service`.
