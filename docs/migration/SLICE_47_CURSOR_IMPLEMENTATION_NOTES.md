# SLICE 47 — Cursor Implementation Notes (Notifications inbox)

> 3 endpoints, 1 table, dépendance WS stubable. Petite slice ciblée.

---

## 1. Architecture Java

### 1.1 Controller dédié
`com.spotyou.api.notifications.NotificationsController`

```java
@RestController
@RequestMapping("/api/users/me/notifications")
public class NotificationsController {

    @GetMapping
    public List<NotificationDto> list(
        @RequestParam(defaultValue = "50") @Min(1) @Max(200) int limit,
        Principal principal
    ) { ... }

    @PatchMapping("/{notifId}/read")
    public Map<String, Object> markRead(
        @PathVariable String notifId,
        Principal principal
    ) { ... }

    @PatchMapping("/read-all")
    public Map<String, Object> markAllRead(Principal principal) { ... }
}
```

> ⚠️ **Note d'architecture** : côté Python, ces endpoints sont dans `tagpoint_routes.py` (legacy regroupement). Côté Java, créer un controller **dédié** `NotificationsController`.

### 1.2 Service métier
`com.spotyou.api.notifications.NotificationsService`

```java
public List<NotificationDto> list(String userId, int limit);
public MarkReadResult markRead(String userId, String notifId);
public void markAllRead(String userId);
```

### 1.3 Repository
`com.spotyou.api.notifications.NotificationsRepository`

```java
public interface NotificationsRepository {
    List<NotificationRow> findByUserOrderByCreatedDesc(String userId, int limit);
    int markRead(String notifId, String userId);
    long countUnread(String userId);
    int markAllRead(String userId);
}
```

JdbcTemplate — Exemples :
```java
@Override
public List<NotificationRow> findByUserOrderByCreatedDesc(String userId, int limit) {
    return jdbc.query(
      "SELECT n.notif_id, n.type, n.title, n.body, n.data, n.read, n.created_at, " +
      "       u.picture as sender_current_picture " +
      "  FROM notifications n " +
      "  LEFT JOIN users u ON u.user_id = (n.data->>'sender_id') " +
      " WHERE n.user_id = ? " +
      " ORDER BY n.created_at DESC " +
      " LIMIT ?",
      notificationRowMapper(), userId, limit
    );
}
```

### 1.4 DTO
```java
public record NotificationDto(
    String id,                 // mapped from notif_id
    String type,
    String title,
    String body,
    JsonNode data,             // ObjectNode après override sender_picture
    boolean read,
    String createdAt           // ISO 8601 ou null
) {}
```

> ⚠️ **`@JsonProperty` mapping** : `id` (pas `notifId`), `created_at` (snake_case).

### 1.5 Service `NotifBroadcaster` (stub WS)
```java
@Service
public class NotifBroadcaster {
    /**
     * [STUB] Pending Chat/WebSocket slice migration.
     * Python equivalent: chat_manager.notif_manager.notify(user_id, payload).
     */
    public void notify(String userId, Map<String, Object> payload) {
        // No-op until WS slice is merged.
    }
}
```

---

## 2. Logique métier

### 2.1 GET inbox
```java
public List<NotificationDto> list(String userId, int limit) {
    List<NotificationRow> rows = repo.findByUserOrderByCreatedDesc(userId, limit);
    return rows.stream()
        .map(this::toDto)
        .toList();
}

private NotificationDto toDto(NotificationRow row) {
    JsonNode data = parseData(row.data());  // dual parsing
    if (row.senderCurrentPicture() != null && data.isObject()) {
        ((ObjectNode) data).put("sender_picture", row.senderCurrentPicture());
    }
    return new NotificationDto(
        row.notifId(),
        row.type(),
        row.title(),
        row.body(),
        data,
        row.read(),
        row.createdAt() != null ? row.createdAt().toInstant().toString() : null
    );
}

private JsonNode parseData(Object raw) {
    if (raw == null) return mapper.createObjectNode();
    try {
        if (raw instanceof String s) {
            if (s.isEmpty()) return mapper.createObjectNode();
            JsonNode parsed = mapper.readTree(s);
            return parsed.isObject() ? parsed : mapper.createObjectNode();
        }
        return mapper.valueToTree(raw);
    } catch (Exception e) {
        return mapper.createObjectNode();
    }
}
```

### 2.2 PATCH single read
```java
public Map<String, Object> markRead(String userId, String notifId) {
    repo.markRead(notifId, userId);  // silent — no check on rows affected
    long unread = repo.countUnread(userId);
    broadcaster.notify(userId, Map.of("type", "unread_notif", "count", (int) unread));
    return Map.of("success", true, "unread_notif", (int) unread);
}
```

### 2.3 PATCH read-all
```java
public Map<String, Object> markAllRead(String userId) {
    repo.markAllRead(userId);  // silent
    broadcaster.notify(userId, Map.of("type", "unread_notif", "count", 0));
    return Map.of("success", true);
}
```

> ⚠️ **Asymétrie BR-47.10** : `markAllRead` retourne SANS `unread_notif`. Iso Python.

---

## 3. JSON binding

- `id` (camelCase impossible, snake_case ici car Python utilise `id`).
- `created_at` (snake_case).
- `data` : ObjectNode sérialisé tel quel.
- `read` : boolean (`Boolean` → JSON true/false).
- `unread_notif` : int.

### Configuration Jackson recommandée
```java
@Configuration
public class JacksonConfig {
    @Bean
    public ObjectMapper objectMapper() {
        ObjectMapper m = new ObjectMapper();
        m.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        m.registerModule(new JavaTimeModule());
        m.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        return m;
    }
}
```

---

## 4. Auth

- `Principal principal` injecté par Spring Security (filtre JWT global S1+).
- `principal.getName()` → `user_id`.
- Si JWT manquant/invalide → 401 avant d'atteindre le controller.

---

## 5. Erreurs

### Codes
- 401 par filtre auth.
- 422 par Bean Validation `@Min(1) @Max(200)` sur `limit`.
- Pas de 404 (silent PATCH).
- Pas de 500 sur data malformé (fallback `{}`).

### `@ControllerAdvice`
- Réutiliser la config globale.
- Format `{"detail": "..."}`.

---

## 6. Transactions

### `@Transactional` recommandé sur PATCH single
```java
@Transactional
public Map<String, Object> markRead(...) { ... }
```
- Couvre l'UPDATE + le SELECT COUNT atomiquement.
- Évite la race avec un INSERT concurrent (le COUNT post-UPDATE reste cohérent dans la transaction).

### Pas obligatoire sur GET ni PATCH all
- 1 seule requête dans chaque cas.

---

## 7. Pièges connus

| # | Piège | Mitigation |
|---|-------|------------|
| 1 | Renvoyer 404 sur PATCH si notif inexistante | NE PAS le faire (BR-47.08). Silent. |
| 2 | Vérifier ownership AVANT UPDATE puis si !owner → 403 | NE PAS le faire. Filtre `WHERE user_id=?` suffit. |
| 3 | Convertir `data=null` en `null` JSON | Toujours objet `{}`. |
| 4 | Ne pas faire l'override `sender_picture` | Reproduire (BR-47.07). |
| 5 | Override `sender_picture` même si `users.picture` est NULL | NE PAS (cf. TC-S47-1.15). Conditionnel `IS NOT NULL`. |
| 6 | Renvoyer `unread_notif` dans markAllRead | NE PAS (asymétrie BR-47.10). |
| 7 | Faire un SELECT COUNT après markAllRead | NE PAS. Hardcoder count=0 dans le broadcast. |
| 8 | Bloquer la réponse HTTP sur `notify` failure | Stub no-op ou capture exception. |
| 9 | Ajouter `?type=...` filter | NE PAS. Iso strict. |
| 10 | Ajouter offset/cursor pagination | NE PAS. LIMIT seul. |
| 11 | Mapper `notif_id` direct au JSON | Renommer en `id`. |
| 12 | DateTimeFormatter par défaut Java | Utiliser ISO 8601 explicite. |
| 13 | Strict JSON binding `@JsonIgnoreProperties(ignoreUnknown=false)` | OK pour input, mais GET response : pas de strict mode requis. |
| 14 | LIMIT 1000 par défaut côté Java pour "facilité" | Iso : default 50, max 200. Hors range = 422. |

---

## 8. Critères de Done

- [ ] Code Java compile, lint OK.
- [ ] `NotificationsController` expose les 3 endpoints sur `/api/users/me/notifications/*`.
- [ ] GET retourne max `limit` notifs ordonnées DESC.
- [ ] LEFT JOIN users via `data->>'sender_id'` correctement reproduit.
- [ ] Override `data.sender_picture` conditionnel (`IS NOT NULL`).
- [ ] Parsing `data` dual avec fallback `{}` silencieux.
- [ ] PATCH single 200 silent si pas owner.
- [ ] PATCH single retourne `{success, unread_notif}` recalculé.
- [ ] PATCH all retourne `{success}` strict (pas `unread_notif`).
- [ ] WS broadcast `notify(userId, {type, count})` appelé (stub no-op tant que slice WS pas mergée).
- [ ] Validation `limit` Bean Validation `@Min(1) @Max(200)` → 422 hors range.
- [ ] Tous les TC `SLICE_47_TEST_CASES.md` passent (≥ 30 cas).
- [ ] Aucun cache front bypass (lecture DB live).
- [ ] Index `idx_notifications_user(user_id, created_at DESC)` confirmé en migration.
- [ ] `@Transactional` sur markRead.
- [ ] Documentation Javadoc référence Python source (lignes 1350–1425).

---

## 9. Plan de cutover front

1. S47 mergée → switcher les 3 endpoints front vers Java.
2. Smoke test : ouvrir la cloche notifications → liste s'affiche.
3. Mark single → badge décrémente (via `unread_notif` retourné).
4. Mark all → badge passe à 0.
5. Vérifier que les notifs **insérées par les workers Python** (booking, payment, spot_you) apparaissent toujours dans l'inbox Java (DB partagée).
6. Surveiller logs Java 24h.

---

## 10. Références croisées

- **S∞ Chat/WebSocket** (slice future) : implémentation réelle de `NotifBroadcaster.notify` via WS `/ws/notifications`.
- **S48 Planning/Agenda** (slice suivante) : `GET /users/me/planning-events` + `GET /users/me/events`.
- **S49 Activity Feed** : `GET /users/me/activity-feed`.
- **Slice push tokens** (mineure, à planifier) : `POST /push-token` + `DELETE /push-token`.
- **Workers Python actifs** (writers de notifs, hors scope) : `media_notif_worker`, `spot_you_notif_worker`, `admin_product_reminder_worker`, `webhook_handlers`, `push_service`.

---

## 11. Note de migration progressive

Tant que les **writers Python** (workers + endpoints booking/payment/services) ne sont pas migrés, ils continueront à insérer dans la table `notifications`. Côté Java, S47 lit cette table en live — pas de désynchro.

La migration des writers se fera **slice par slice** dans chaque domaine (chaque endpoint Java qui déclenche une notif l'insérera lui-même, et n'aura plus besoin du worker Python correspondant). Ce sera traité au cas par cas, en dehors de S47.
