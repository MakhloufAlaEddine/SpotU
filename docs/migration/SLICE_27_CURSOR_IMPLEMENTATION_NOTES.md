# SLICE_27_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation Cursor
> Généré le 2026-04-15.

---

## 1. Architecture Java cible

```
src/main/java/com/spotu/
├── controller/
│   └── SpotYouMembershipController.java   ← 🔴 S27 (11 endpoints)
├── service/
│   ├── SpotYouMembershipService.java      ← 🔴 S27 (logique membership)
│   └── PushNotificationService.java       ← 🔴 S27 (fire-and-forget push)
├── repository/
│   ├── SpotYouMemberRepository.java       ← S26 (existant — à étendre)
│   └── TagPointSaveRepository.java        ← 🔴 S27
```

---

## 2. ON CONFLICT DO UPDATE WHERE — Pattern Java

```java
// PostgreSQL spécifique — pas JPA standard
@Modifying
@Query(value = """
    INSERT INTO spot_you_members (id, spot_you_id, user_id, status, requested_by)
    VALUES (:id, :spotId, :userId, :status, :requestedBy)
    ON CONFLICT (spot_you_id, user_id) DO UPDATE
    SET status = :status, requested_by = EXCLUDED.requested_by
    WHERE spot_you_members.status = 'rejected'
    """, nativeQuery = true)
void upsertMembership(@Param("id") String id, @Param("spotId") String spotId,
                       @Param("userId") String userId, @Param("status") String status,
                       @Param("requestedBy") String requestedBy);
```

**PIÈGE** : Le `WHERE` dans `ON CONFLICT DO UPDATE` porte sur la ligne **existante** (pas sur une clause WHERE globale). Si la ligne existante a un status != 'rejected', le UPDATE ne s'applique PAS et l'INSERT est silencieusement ignoré (ON CONFLICT → no-op). Cela rend le join IDEMPOTENT pour les statuts non-rejected.

---

## 3. PushNotificationService — @Async fire-and-forget

```java
@Slf4j
@Service
public class PushNotificationService {

    @Async
    public void sendPush(String pool, String userId, String title, String body,
                         Map<String, Object> data, String notifType) {
        try {
            // 1. INSERT INTO notifications (notif_id, user_id, type, title, body, data)
            // 2. Chercher push tokens actifs pour ce user
            // 3. Envoyer via Expo Push API
        } catch (Exception e) {
            log.warn("Push notification failed for user={}: {}", userId, e.getMessage());
            // Fire-and-forget — ne PAS propager l'exception
        }
    }
}
```

**Config requise** :
```java
@Configuration
@EnableAsync
public class AsyncConfig {
    @Bean
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setThreadNamePrefix("push-notif-");
        executor.initialize();
        return executor;
    }
}
```

---

## 4. Pièges critiques

### P1 — ON CONFLICT DO UPDATE WHERE vs ON CONFLICT DO NOTHING

```
Save utilise ON CONFLICT DO NOTHING (idempotence simple).
Join utilise ON CONFLICT DO UPDATE WHERE status='rejected' (re-join sélectif).
NE PAS confondre les deux patterns.
```

### P2 — Leave = DELETE physique, Cancel = DELETE conditionnel

```
leave → DELETE FROM spot_you_members WHERE spot_you_id=$1 AND user_id=$2 (inconditionnel)
cancel → DELETE ... WHERE ... AND status='pending' (seulement pending)
Le leave supprime TOUT membership (même accepted).
```

### P3 — Asymétrie approve vs reject permissions

```
approve : owner OU membres (si members_approval) — MVĐ 1 acceptation suffit
reject : owner SEUL (ou admin plateforme)
NE PAS donner le droit de reject aux membres — c'est intentionnel.
```

### P4 — Race condition capacité max

```
Le check capacité (COUNT >= max) n'est PAS protégé par un lock.
2 users peuvent joindre simultanément et dépasser la limite de 1.
Acceptable pour MVP — une contrainte CHECK en DB serait plus robuste.
```

### P5 — Notification data pattern standardisé

```
Chaque push inclut : {type, point_id, sender_id, sender_name, sender_picture,
                      action_text, content_title, image_url}
Ce pattern est attendu par le front pour afficher les notifications.
En Java : créer un DTO NotificationData standard.
```

---

## 5. Critères de done

| # | Critère | Tests |
|---|---|---|
| D1 | Save ON CONFLICT DO NOTHING (idempotent) | TC-SV-01, 03 |
| D2 | Unsave sans erreur si non sauvegardé | TC-SV-05 |
| D3 | Join open → accepted direct + push owner | TC-JN-01 |
| D4 | Join admin_approval → pending + push owner | TC-JN-02 |
| D5 | Join members_approval → pending + push membres | TC-JN-03 |
| D6 | Join private → 403 | TC-JN-04 |
| D7 | Join idempotent (accepted, pending, invited) | TC-JN-06, 07, 08 |
| D8 | Re-join après reject → ON CONFLICT DO UPDATE | TC-JN-09 |
| D9 | Capacité max → 409 | TC-JN-10 |
| D10 | Cancel pending uniquement | TC-CR-01, 02 |
| D11 | Leave même inactif + DELETE physique | TC-LV-01, 02 |
| D12 | Invite : permissions admin_only vs admin_and_members | TC-IV-01, 02, 03 |
| D13 | Invite anti-doublon par status | TC-IV-07, 08, 09, 10 |
| D14 | Accept/refuse invitation status='invited' | TC-AI-01, TC-RI-01 |
| D15 | Approve : owner + membres (si applicable) | TC-AP-01 |
| D16 | Reject : owner seul | TC-RJ-01, 02 |
| D17 | Push notifications @Async fire-and-forget | Tous les endpoints avec push |

---

## 6. Relation avec les Slices

| Slice | Interaction |
|---|---|
| S26 | SpotYou lectures — le détail affiche is_member, is_saved, join_status (lus par S26, modifiés par S27) |
| S28 (futur) | SpotYou CRUD — création utilise la même table tag_points |
| S29 (futur) | SpotYou vote + attendance — même domaine mais table différente |
| S25 | Home feed — le scoring bonus membre utilise spot_you_members (lu, jamais modifié par S25) |
