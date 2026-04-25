# SLICE_33_CURSOR_IMPLEMENTATION_NOTES.md — Notes Java/Spring Boot Webhook Payment Handlers
> Basé sur `webhook_handlers.py:122–180, 185–453, 964–970, 1007–1027`, BR-33.01 à BR-33.19.
> Généré le 2026-04-25.
>
> ⚠️ **Reproduire 1:1 le comportement Python.** Pas de simplification ni de "fix" implicite des asymétries libellés/guards.

---

## 1. Structure Spring Boot (extension de S32)

```
src/main/java/com/spotu/webhook/
├── service/
│   ├── WebhookDispatcherService.java         ← (S32) — modifié pour activer payment branch
│   ├── PaymentResolverService.java           ← NEW : _resolve_payment_id
│   └── handlers/
│       └── PaymentEventHandler.java          ← NEW : 5 branches if/else _handle_payment_event
├── repository/
│   ├── PaymentRepository.java                ← NEW (transitions + lookups)
│   ├── BookingRepository.java                ← NEW (markConfirmedAndPaid + lookupStatus)
│   ├── ServiceRepository.java                ← NEW (findTitleByBookingId)
│   └── NotificationRepository.java           ← NEW (INSERT via NotificationService)
├── service/
│   └── NotificationService.java              ← NEW : storeNotification + WebSocket broadcast
└── dto/
    ├── ResolvedPayment.java                  ← record (paymentId, bookingId)
    └── PendingNotif.java                     ← (déjà créé en S32 — populé en S33)
```

---

## 2. Activation dans le Dispatcher (modif de S32)

```java
// WebhookDispatcherService.dispatch (modif S33)
public Map<String, Object> dispatch(String eventId, String eventType, Object obj) {
    String relatedId = null;
    List<PendingNotif> pendingNotifs = new ArrayList<>();

    boolean isNew = claimEventNewTx(eventId, eventType);
    if (!isNew) { ... return idempotent_skip ... }

    // ── 2. Résolution du payment_id (NEW S33)
    ResolvedPayment resolved = paymentResolver.resolve(eventType, obj);
    String paymentId = resolved.paymentId();
    String bookingId = resolved.bookingId();
    relatedId = paymentId;

    try {
        // S34 : if (CHARGE_EVENTS.contains(eventType)) { ... }

        // ── S33 — Activation branche payment
        if (PaymentEventHandler.PAYMENT_EVENTS.contains(eventType)) {
            if (paymentId != null) {
                paymentHandler.handle(eventType, obj, paymentId, bookingId, pendingNotifs);
            } else if (!"checkout.session.completed".equals(eventType)) {
                log.debug("Webhook payment sans payment_id : type={}", eventType);
            }
        }

        // S35 : if (SUBSCRIPTION_EVENTS.contains(eventType)) { ... }

        repo.markDone(eventId, "success", relatedId, null);
    } catch (Exception exc) {
        log.error("Erreur handler webhook event={} id={} : {}", eventType, eventId, exc.getMessage(), exc);
        repo.markDone(eventId, "error", relatedId, truncate(exc.getMessage(), 500));
    }

    // ── Envoi notifications hors transaction (compat S32)
    for (PendingNotif notif : pendingNotifs) {
        try {
            notifService.storeNotification(
                notif.userId(), notif.type(), notif.title(), notif.body(), notif.data()
            );
            log.info("Notification envoyée : type={} | user={}", notif.type(), notif.userId());
        } catch (Exception e) {
            log.warn("Erreur envoi notification type={} user={} : {}",
                     notif.type(), notif.userId(), e.getMessage());
        }
    }

    return Map.of("received", true);
}
```

> ⚠️ Note : la branche `if (paymentId != null)` est dans le **dispatcher**, PAS dans `PaymentEventHandler.handle`. Le handler suppose `paymentId != null` (assertion).

---

## 3. PaymentResolverService

```java
@Service
@RequiredArgsConstructor
public class PaymentResolverService {

    private final PaymentRepository paymentRepo;

    @SuppressWarnings("unchecked")
    public ResolvedPayment resolve(String eventType, Object obj) {
        Map<String, Object> map = (obj instanceof Map<?,?>) ? (Map<String,Object>) obj : objectToMap(obj);

        // Stratégie 1 : metadata.payment_id
        Map<String, Object> metadata = (Map<String, Object>) map.getOrDefault("metadata", Map.of());
        String paymentId      = (String) metadata.get("payment_id");
        String bookingIdMeta  = (String) metadata.get("booking_id");
        if (paymentId != null && !paymentId.isEmpty()) {
            return new ResolvedPayment(paymentId, bookingIdMeta);
        }

        // Détermination payment_intent_id selon event_type
        String eventPiId;
        if (eventType.contains("payment_intent")) {
            eventPiId = (String) map.get("id");
        } else {
            // checkout.session.completed, charge.refunded, refund.updated, autres
            eventPiId = (String) map.get("payment_intent");
        }

        // Stratégie 2 : stripe_payment_intent_id
        if (eventPiId != null && !eventPiId.isEmpty()) {
            Optional<PaymentLookupRow> r = paymentRepo.findByStripePaymentIntentId(eventPiId);
            if (r.isPresent()) {
                return new ResolvedPayment(r.get().paymentId(), r.get().bookingId());
            }
        }

        // Stratégie 3 : stripe_checkout_session_id (uniquement event checkout.session)
        if (eventType.contains("checkout.session")) {
            String csId = (String) map.get("id");
            if (csId != null && !csId.isEmpty()) {
                Optional<PaymentLookupRow> r = paymentRepo.findByStripeCheckoutSessionId(csId);
                if (r.isPresent()) {
                    return new ResolvedPayment(r.get().paymentId(), r.get().bookingId());
                }
            }
        }

        // Stratégie 4 : stripe_charge_id (uniquement si ch_*)
        Object chargeRaw = eventType.startsWith("charge.") ? map.get("id") : map.get("charge");
        if (chargeRaw instanceof String chargeId && chargeId.startsWith("ch_")) {
            Optional<PaymentLookupRow> r = paymentRepo.findByStripeChargeId(chargeId);
            if (r.isPresent()) {
                return new ResolvedPayment(r.get().paymentId(), r.get().bookingId());
            }
        }

        return new ResolvedPayment(null, null);
    }
}

public record ResolvedPayment(String paymentId, String bookingId) {}
public record PaymentLookupRow(String paymentId, String bookingId) {}
```

> ⚠️ **Court-circuit early-return**. Ne JAMAIS essayer toutes les stratégies en parallèle.

---

## 4. PaymentEventHandler

```java
@Component
@RequiredArgsConstructor
public class PaymentEventHandler {

    public static final Set<String> PAYMENT_EVENTS = Set.of(
        "checkout.session.completed",
        "payment_intent.amount_capturable_updated",
        "payment_intent.succeeded",
        "payment_intent.payment_failed",
        "payment_intent.canceled"
    );

    private final PaymentRepository paymentRepo;
    private final BookingRepository bookingRepo;
    private final ServiceRepository serviceRepo;
    private static final Logger log = LoggerFactory.getLogger(PaymentEventHandler.class);

    @Transactional
    public void handle(String eventType, Object obj, String paymentId, String bookingId,
                       List<PendingNotif> pendingNotifs) {
        Map<String, Object> map = (Map<String, Object>) obj;

        switch (eventType) {
            case "checkout.session.completed" -> handleCheckoutSessionCompleted(map, paymentId, bookingId, pendingNotifs);
            case "payment_intent.amount_capturable_updated" -> handleAmountCapturableUpdated(paymentId, bookingId, pendingNotifs);
            case "payment_intent.succeeded" -> handleSucceeded(map, paymentId, bookingId, pendingNotifs);
            case "payment_intent.payment_failed" -> handleFailed(paymentId, bookingId, pendingNotifs);
            case "payment_intent.canceled" -> handleCanceled(paymentId);
        }

        log.info("Payment event traité : type={} | payment={} | booking={}", eventType, paymentId, bookingId);
    }

    // ── Branch checkout.session.completed
    private void handleCheckoutSessionCompleted(Map<String,Object> obj, String paymentId, String bookingId,
                                                 List<PendingNotif> pendingNotifs) {
        String mode = (String) obj.getOrDefault("mode", "");
        if ("subscription".equals(mode)) return;

        String ps = (String) obj.getOrDefault("payment_status", "");

        if ("unpaid".equals(ps)) {
            // Lookup booking.status pour router Branch A vs B
            String bookingStatus = bookingId != null
                                   ? bookingRepo.findStatus(bookingId).orElse(null)
                                   : null;

            if ("awaiting_payment".equals(bookingStatus)) {
                // Branch A : capture immédiate
                int rowsUpdated = paymentRepo.markCapturedGuardA(paymentId);
                if (bookingId != null) {
                    bookingRepo.markConfirmedAndPaid(bookingId);
                }
                if (rowsUpdated > 0 && bookingId != null) {
                    appendBookingConfirmedNotifsBranchA(paymentId, bookingId, pendingNotifs);
                }
            } else {
                // Branch B : authorize seul
                int rowsUpdated = paymentRepo.markAuthorized(paymentId);
                if (rowsUpdated > 0) {
                    Optional<UserPair> users = paymentRepo.findReceiverOnly(paymentId);
                    users.ifPresent(u -> pendingNotifs.add(new PendingNotif(
                        u.receiverUserId(),
                        "payment_authorized",
                        "Paiement autorisé",
                        "Le paiement pour votre prestation a été autorisé.",
                        Map.of("type", "payment_authorized", "payment_id", paymentId,
                               "booking_id", bookingId != null ? bookingId : "")
                    )));
                }
            }
        } else if ("paid".equals(ps)) {
            // Branch C
            int rowsCaptured = paymentRepo.markCapturedGuardCAndSucceeded(paymentId);
            if (bookingId != null) {
                bookingRepo.markConfirmedAndPaid(bookingId);
            }
            if (rowsCaptured > 0 && bookingId != null) {
                appendBookingConfirmedNotifsBranchC(paymentId, bookingId, pendingNotifs);
            }
        }
        // Else : silent skip (no_payment_required, manual, etc.)
    }

    private void handleAmountCapturableUpdated(String paymentId, String bookingId, List<PendingNotif> pn) {
        int rows = paymentRepo.markAuthorized(paymentId);
        if (rows > 0) {
            paymentRepo.findReceiverOnly(paymentId).ifPresent(u -> pn.add(new PendingNotif(
                u.receiverUserId(),
                "payment_authorized",
                "Paiement autorisé",
                "Le paiement pour votre prestation est confirmé — vous pouvez procéder.",
                Map.of("type", "payment_authorized", "payment_id", paymentId,
                       "booking_id", bookingId != null ? bookingId : "")
            )));
        }
    }

    private void handleSucceeded(Map<String,Object> obj, String paymentId, String bookingId,
                                  List<PendingNotif> pn) {
        Object lc = obj.get("latest_charge");
        int rowsCaptured;
        if (lc instanceof String chargeId && chargeId.startsWith("ch_")) {
            rowsCaptured = paymentRepo.markCapturedWithCharge(paymentId, chargeId);
        } else {
            rowsCaptured = paymentRepo.markCapturedGuardCAndSucceeded(paymentId);
        }
        if (bookingId != null) {
            bookingRepo.markConfirmedAndPaid(bookingId);
        }
        if (rowsCaptured > 0 && bookingId != null) {
            String title = serviceRepo.findTitleByBookingId(bookingId).orElse("votre prestation");
            paymentRepo.findUserPair(paymentId).ifPresent(u -> {
                pn.add(new PendingNotif(
                    u.payerUserId(), "booking_confirmed",
                    "Réservation confirmée !",
                    "Votre réservation pour « " + title + " » est confirmée.",
                    Map.of("type", "booking_confirmed", "booking_id", bookingId, "payment_id", paymentId)
                ));
                pn.add(new PendingNotif(
                    u.receiverUserId(), "booking_confirmed",
                    "Nouvelle réservation !",
                    "Paiement capturé pour « " + title + " ». Votre planning a été mis à jour.",
                    Map.of("type", "booking_confirmed", "booking_id", bookingId, "payment_id", paymentId)
                ));
            });
        }
    }

    private void handleFailed(String paymentId, String bookingId, List<PendingNotif> pn) {
        int rows = paymentRepo.markFailed(paymentId);
        if (rows > 0) {
            paymentRepo.findPayerOnly(paymentId).ifPresent(u -> pn.add(new PendingNotif(
                u.payerUserId(),
                "payment_failed",
                "Paiement échoué",
                "Votre paiement n'a pas pu être traité. Veuillez vérifier votre moyen de paiement.",
                Map.of("type", "payment_failed", "payment_id", paymentId,
                       "booking_id", bookingId != null ? bookingId : "")
            )));
        }
    }

    private void handleCanceled(String paymentId) {
        paymentRepo.markCancelled(paymentId);
        // Aucune notif (BR-33.09)
    }

    // ── Helpers notifs Branch A (avec "À bientôt !")
    private void appendBookingConfirmedNotifsBranchA(String paymentId, String bookingId,
                                                     List<PendingNotif> pn) {
        String title = serviceRepo.findTitleByBookingId(bookingId).orElse("votre prestation");
        paymentRepo.findUserPair(paymentId).ifPresent(u -> {
            pn.add(new PendingNotif(u.payerUserId(), "booking_confirmed",
                "Réservation confirmée !",
                "Votre réservation pour « " + title + " » est confirmée. À bientôt !",
                Map.of("type", "booking_confirmed", "booking_id", bookingId, "payment_id", paymentId)));
            pn.add(new PendingNotif(u.receiverUserId(), "booking_confirmed",
                "Nouvelle réservation !",
                "Paiement reçu pour « " + title + " ». Votre planning a été mis à jour.",
                Map.of("type", "booking_confirmed", "booking_id", bookingId, "payment_id", paymentId)));
        });
    }

    // ── Helpers notifs Branch C (sans "À bientôt !", body receiver "reçu")
    private void appendBookingConfirmedNotifsBranchC(String paymentId, String bookingId,
                                                     List<PendingNotif> pn) {
        String title = serviceRepo.findTitleByBookingId(bookingId).orElse("votre prestation");
        paymentRepo.findUserPair(paymentId).ifPresent(u -> {
            pn.add(new PendingNotif(u.payerUserId(), "booking_confirmed",
                "Réservation confirmée !",
                "Votre réservation pour « " + title + " » est confirmée.",
                Map.of("type", "booking_confirmed", "booking_id", bookingId, "payment_id", paymentId)));
            pn.add(new PendingNotif(u.receiverUserId(), "booking_confirmed",
                "Nouvelle réservation !",
                "Paiement reçu pour « " + title + " ». Votre planning a été mis à jour.",
                Map.of("type", "booking_confirmed", "booking_id", bookingId, "payment_id", paymentId)));
        });
    }
}
```

---

## 5. PaymentRepository

```java
@Repository
public interface PaymentRepository {

    // ── Lookups _resolve_payment_id
    @Query(value = "SELECT payment_id, booking_id FROM payments WHERE stripe_payment_intent_id=:pi LIMIT 1", nativeQuery = true)
    Optional<PaymentLookupRow> findByStripePaymentIntentId(@Param("pi") String pi);

    @Query(value = "SELECT payment_id, booking_id FROM payments WHERE stripe_checkout_session_id=:cs LIMIT 1", nativeQuery = true)
    Optional<PaymentLookupRow> findByStripeCheckoutSessionId(@Param("cs") String cs);

    @Query(value = "SELECT payment_id, booking_id FROM payments WHERE stripe_charge_id=:ch LIMIT 1", nativeQuery = true)
    Optional<PaymentLookupRow> findByStripeChargeId(@Param("ch") String ch);

    // ── Lookups user pair pour notifs
    @Query(value = "SELECT payer_user_id, receiver_user_id FROM payments WHERE payment_id=:id", nativeQuery = true)
    Optional<UserPair> findUserPair(@Param("id") String paymentId);

    @Query(value = "SELECT payer_user_id, receiver_user_id FROM payments WHERE payment_id=:id", nativeQuery = true)
    Optional<UserPair> findReceiverOnly(@Param("id") String paymentId);  // alias même query

    @Query(value = "SELECT payer_user_id, receiver_user_id FROM payments WHERE payment_id=:id", nativeQuery = true)
    Optional<UserPair> findPayerOnly(@Param("id") String paymentId);

    // ── Transitions (chaque guard est différent !)
    @Modifying
    @Query(value = """
        UPDATE payments SET status='captured', updated_at=NOW()
        WHERE payment_id=:id AND status NOT IN ('captured','refunded','cancelled')
    """, nativeQuery = true)
    int markCapturedGuardA(@Param("id") String paymentId);  // Branch A : ps=unpaid+awaiting

    @Modifying
    @Query(value = """
        UPDATE payments SET status='authorized', updated_at=NOW()
        WHERE payment_id=:id AND status NOT IN ('authorized','captured','refunded','cancelled')
    """, nativeQuery = true)
    int markAuthorized(@Param("id") String paymentId);

    @Modifying
    @Query(value = """
        UPDATE payments SET status='captured', updated_at=NOW()
        WHERE payment_id=:id AND status NOT IN ('captured','refunded')
    """, nativeQuery = true)
    int markCapturedGuardCAndSucceeded(@Param("id") String paymentId);  // Branch C + PI succeeded sans charge

    @Modifying
    @Query(value = """
        UPDATE payments SET status='captured', stripe_charge_id=:ch, updated_at=NOW()
        WHERE payment_id=:id AND status NOT IN ('captured','refunded')
    """, nativeQuery = true)
    int markCapturedWithCharge(@Param("id") String paymentId, @Param("ch") String chargeId);

    @Modifying
    @Query(value = """
        UPDATE payments SET status='failed', updated_at=NOW()
        WHERE payment_id=:id AND status NOT IN ('captured','refunded','failed')
    """, nativeQuery = true)
    int markFailed(@Param("id") String paymentId);

    @Modifying
    @Query(value = """
        UPDATE payments SET status='cancelled', updated_at=NOW()
        WHERE payment_id=:id AND status NOT IN ('captured','refunded','cancelled')
    """, nativeQuery = true)
    int markCancelled(@Param("id") String paymentId);
}

public record UserPair(String payerUserId, String receiverUserId) {}
```

> ⚠️ Les 3 méthodes `findUserPair` / `findReceiverOnly` / `findPayerOnly` peuvent être **fusionnées** en une seule. Java sera plus DRY que Python ici. Mais conserver les sémantiques (le code Python fait 3 SELECTs distincts pour 3 use cases — une seule query suffit côté Java sans casser la compat).

---

## 6. BookingRepository

```java
@Repository
public interface BookingRepository {

    @Query(value = "SELECT status FROM bookings WHERE booking_id=:id", nativeQuery = true)
    Optional<String> findStatus(@Param("id") String bookingId);

    @Modifying
    @Query(value = """
        UPDATE bookings SET status='confirmed', payment_status='paid', updated_at=NOW()
        WHERE booking_id=:id AND status NOT IN ('confirmed','refused','cancelled','expired')
    """, nativeQuery = true)
    int markConfirmedAndPaid(@Param("id") String bookingId);
}
```

---

## 7. ServiceRepository

```java
@Repository
public interface ServiceRepository {
    @Query(value = """
        SELECT s.title FROM bookings b
        JOIN services s ON b.service_id = s.service_id
        WHERE b.booking_id=:id
    """, nativeQuery = true)
    Optional<String> findTitleByBookingId(@Param("id") String bookingId);
}
```

> Si le JOIN ne match pas (booking ou service supprimé), retourne `Optional.empty()` → fallback `"votre prestation"` côté handler.

---

## 8. NotificationService (réutilisé en S34/S35)

```java
@Service
@RequiredArgsConstructor
public class NotificationService {

    private final NotificationRepository notifRepo;
    private final WebSocketBroadcaster wsBroadcaster;

    public void storeNotification(String userId, String type, String title, String body, Map<String,Object> data) {
        String notifId = "notif_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);

        notifRepo.insert(notifId, userId, type, title, body, data);

        long unread = notifRepo.countUnread(userId);

        // Broadcast WS (compat S30/S31 chat_manager.notif_manager)
        wsBroadcaster.notify(userId, Map.of(
            "type", "new_notification",
            "notification", Map.of(
                "id", notifId, "type", type, "title", title, "body", body,
                "data", data, "read", false, "created_at", now.toString()
            )
        ));
        wsBroadcaster.notify(userId, Map.of("type", "unread_notif", "count", unread));
    }
}
```

---

## 9. Transactionnalité — résumé

| Branche | `@Transactional` |
|---|---|
| Branch A (CSC unpaid+awaiting) | OUI (payments + bookings atomiques) |
| Branch B (CSC unpaid+other) | NON (single UPDATE) |
| Branch C (CSC paid) | OUI |
| amount_capturable_updated | NON |
| PI succeeded (avec ou sans charge) | OUI |
| PI payment_failed | NON |
| PI canceled | NON |

Approche pragmatique Java : **mettre `@Transactional` sur `PaymentEventHandler.handle(...)` global**. Spring gère les branches sans-write proprement.

> ⚠️ **Le `pendingNotifs` doit être utilisé HORS @Transactional** (post-commit). Pattern : collecter dans la liste pendant la TX, exécuter `notifService.storeNotification` après le retour de `handle()` — c'est ce que fait le dispatcher S32 déjà.

---

## 10. Erreurs et exceptions

### Exceptions internes au handler
- Toute exception remonte au dispatcher S32 → log EXCEPTION + `markDone(error)` + 200 retourné.
- **Ne PAS catcher localement dans `handle()`** sauf cas explicite (Python ne catche pas).

### Cas `payment_id null`
- **Géré dans le dispatcher**, pas dans le handler. Le handler suppose `paymentId != null`.

### Cas `booking_id null`
- Géré **dans** chaque branche du handler via `if (bookingId != null)`.

---

## 11. Pièges à éviter

| # | Piège | Mitigation |
|---|---|---|
| 1 | Fusionner Branch A et Branch C (libellés / guards "presque pareils") | **NON**. Garder 2 helpers distincts avec libellés exacts (BR-33.04). |
| 2 | Body notif Branch B et `amount_capturable_updated` identique | **NON**. Bodies différents (BR-33.04). |
| 3 | Body receiver `payment_intent.succeeded` dit "reçu" au lieu de "capturé" | Doit dire **"capturé"** (BR-33.04). |
| 4 | Émettre une notif pour `payment_intent.canceled` "par cohérence" | **NON** (BR-33.09). |
| 5 | Émettre une notif au receiver pour `payment_intent.payment_failed` | **NON** (payer seulement). |
| 6 | Tester `latest_charge != null` au lieu de `instanceof String + startsWith("ch_")` | Reproduire le test strict (BR-33.08). |
| 7 | Émettre notif sans vérifier `rowsUpdated > 0` | **Cause de doublons à chaque retry Stripe**. Test strict (BR-33.06). |
| 8 | Inverser ordre de stratégies dans `_resolve_payment_id` | metadata → PI → CS → Charge. Court-circuit early return. |
| 9 | Lever exception si `payment_id` introuvable | NON, c'est un cas normal. log DEBUG + skip. |
| 10 | Mettre `@Transactional` sur la branche notifs | **NON**, notifs hors-TX. |
| 11 | Oublier le JOIN fallback `"votre prestation"` | Optional.orElse() obligatoire. |
| 12 | Logger `obj` Stripe complet (PII) | Logger uniquement `event_type`, `payment_id`, `booking_id`. |
| 13 | `bookingId == null` empty-string vs null | Java : utiliser `null`, **pas** empty string (sauf dans `data` Map.of où c'est dérangeant — utiliser HashMap). |
| 14 | Asserter le set `_PAYMENT_EVENTS` au runtime sans inclure `checkout.session.completed` | Inclure les 5 (BR-33.02). |
| 15 | Update `bookings.payment_status` sans update `bookings.status` | **TOUJOURS** les 2 ensemble dans le même UPDATE. |
| 16 | Faire un seul SELECT `findUserPair` pour Branch B (qui n'a besoin que du receiver) | OK techniquement, mais Python fait `SELECT receiver_user_id` ; cohérence : utiliser le DTO complet et picker `receiverUserId()`. Pas de risque sémantique. |

---

## 12. Critères de Done

| # | Critère | Test |
|---|---|---|
| 1 | `_PAYMENT_EVENTS` set contient EXACTEMENT 5 events | T33-34 |
| 2 | Branch A (CSC unpaid+awaiting) → captured + bookings.confirmed + 2 notifs | T33-01 |
| 3 | Branch B (CSC unpaid+other) → authorized + 1 notif receiver | T33-02 |
| 4 | Branch C (CSC paid) → captured + bookings.confirmed + 2 notifs | T33-03 |
| 5 | CSC mode=subscription → skip immédiat | T33-04 |
| 6 | amount_capturable_updated → authorized + 1 notif receiver (body différent) | T33-05 |
| 7 | PI succeeded avec latest_charge → captured + stripe_charge_id + 2 notifs | T33-06 |
| 8 | PI succeeded sans/expanded latest_charge → captured fallback | T33-07, T33-08 |
| 9 | PI payment_failed → failed + 1 notif payer | T33-09 |
| 10 | PI canceled → cancelled + 0 notif | T33-10 |
| 11 | Idempotence event-level (S32) | T33-11 |
| 12 | Idempotence handler-level (rows_updated == 0 → no notif) | T33-12, T33-25 à T33-27 |
| 13 | `_resolve_payment_id` 4 stratégies + early return | T33-19 à T33-24 |
| 14 | Libellés notifs EXACTS (Branch A vs C, "capturé" vs "reçu", body B vs amount_capturable_updated) | T33-29, T33-30, T33-31 |
| 15 | Concurrence S31 : pas de double notif | T33-13 |
| 16 | payment_id introuvable → log DEBUG + skip | T33-15 |
| 17 | booking_id absent → pas de bookings update + pas de notif | T33-17 |
| 18 | services JOIN fallback `"votre prestation"` | T33-38 |
| 19 | Logs format `|` séparateur | T33-33 |
| 20 | Atomicité TX payments+bookings | T33-36 |
| 21 | Charset UTF-8 / emojis dans title | T33-40 |
| 22 | Notif failure tolerated (HTTP 200 quand même) | T33-39 |

---

## 13. Validation finale

- [ ] 42 cas T33 passent
- [ ] Régression S30 : créer booking → checkout → recevoir webhook → vérifier transition complète
- [ ] Régression S31 : redirect → S31 set captured → webhook arrive → idempotence respectée (pas de double notif)
- [ ] Régression S32 : signature/raw body/idempotence event-level non régressés
- [ ] Aucune modification du contrat HTTP S32 (réponses identiques)
- [ ] `pending_notifs` envoyé hors-pool/transaction
- [ ] `stripe_webhook_events.related_id` populé avec `payment_id` (utile debug)
- [ ] WebSocket broadcast fonctionne (notif temps réel mobile)
- [ ] Test charge_id non-string → fallback OK
- [ ] **Préparation S34** : `_resolve_payment_id` est complet, `_handle_charge_event` peut l'utiliser tel quel

---

## 14. Roadmap S33 → S34 → S35

| Slice | Contenu | Modification de S33 |
|---|---|---|
| **S33 (cette slice)** | Set `_PAYMENT_EVENTS` + handler 5 branches + resolver complet | — |
| **S34** | Set `_CHARGE_EVENTS` + `ChargeEventHandler` (refunds) | Aucun changement de S33 (resolver est déjà compat charge_id) |
| **S35** | Set `_SUBSCRIPTION_EVENTS` + `SubscriptionEventHandler` | Aucun changement de S33 (CSC mode=subscription déjà skip) |

> **L'API S33 (PaymentEventHandler) ne devrait JAMAIS être modifiée par S34/S35** sauf bug. Contrat de stabilité.
