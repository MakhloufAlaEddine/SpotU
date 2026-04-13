# SLICE_18_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation pour Cursor
> Slice 18 : `ExpiryWorker` — worker d'expiration automatique des bookings
> Source : `expiry_worker.py` (intégral) + `server.py:278–285`.
> Généré le 2026-02-XX.

---

## Architecture recommandée

```
ExpiryScheduler (@Scheduled, @Async)
  └─ ExpiryService.runTick()
       └─ [drain loop] ExpiryService.processBatch(50)
             ├─ BookingExpiryRepository.findExpiredBatch(50)     ← SELECT ... FOR UPDATE SKIP LOCKED
             ├─ [per booking]
             │    ├─ BookingExpiryRepository.transitionToExpired(bookingId)   ← RETURNING
             │    ├─ SlotRepository.releaseIfExpired(slotId, slotType)        ← conditionnel
             │    ├─ PaymentExpiryRepository.cancelIfExpired(paymentId, payStatus) ← conditionnel
             │    ├─ ServiceRepository.findTitleById(serviceId)               ← fallback "un service"
             │    ├─ NotificationRepository.insertExpiredNotif(payer, ...)    ← IN transaction
             │    └─ NotificationRepository.insertExpiredNotif(receiver, ...) ← IN transaction
             │
             └─ [hors @Transactional] StripeService.cancelPaymentIntent(piId, "expired")
```

---

## Scheduler

### Configuration

```java
// ExpirySchedulerConfig.java
@Configuration
@EnableScheduling
@EnableAsync
public class ExpirySchedulerConfig {

    @Bean("workerExecutor")
    public Executor workerExecutor() {
        ThreadPoolTaskExecutor exec = new ThreadPoolTaskExecutor();
        exec.setCorePoolSize(1);
        exec.setMaxPoolSize(1);
        exec.setThreadNamePrefix("expiry-worker-");
        exec.initialize();
        return exec;
    }
}
```

### Scheduler principal

```java
// ExpiryScheduler.java
@Component
public class ExpiryScheduler {

    @Autowired private ExpiryService expiryService;
    private static final Logger log = LoggerFactory.getLogger(ExpiryScheduler.class);

    // ⚠️ initialDelay=0 : tick immédiat au démarrage (comme Python)
    // ⚠️ fixedDelay (pas fixedRate) : le prochain tick commence APRÈS la fin du précédent
    @Scheduled(
        fixedDelayString = "${expiry.worker.interval.secs:60}000",
        initialDelay = 0
    )
    @Async("workerExecutor")
    public void tick() {
        try {
            int total = expiryService.drainExpiredBookings();
            if (total > 0) {
                log.info("ExpiryWorker : {} booking(s) expiré(s) ce tick", total);
            }
        } catch (Exception e) {
            log.error("ExpiryWorker : erreur inattendue lors du tick", e);
        }
    }
}
```

---

## Service

```java
// ExpiryService.java
@Service
public class ExpiryService {

    private static final int EXPIRY_BATCH_SIZE = 50;  // ← hardcodé comme Python

    @Autowired private BookingExpiryRepository bookingRepo;
    @Autowired private SlotRepository slotRepo;
    @Autowired private PaymentExpiryRepository paymentRepo;
    @Autowired private ServiceRepository serviceRepo;
    @Autowired private NotificationRepository notifRepo;
    @Autowired private StripeService stripeService;

    private static final Logger log = LoggerFactory.getLogger(ExpiryService.class);

    // ── Drain complet (comme expire_stale_bookings()) ─────────────────────────
    public int drainExpiredBookings() {
        int total = 0;
        int count;
        do {
            count = processBatch(EXPIRY_BATCH_SIZE);  // ← WHILE LOOP CRITIQUE
            total += count;
        } while (count >= EXPIRY_BATCH_SIZE);
        return total;
    }

    // ── Traitement d'un batch ──────────────────────────────────────────────────
    public int processBatch(int batchSize) {
        // 1. SELECT ... FOR UPDATE SKIP LOCKED (requête native obligatoire)
        List<ExpiredBookingRow> rows = bookingRepo.findExpiredBatch(batchSize);
        if (rows.isEmpty()) return 0;

        int processed = 0;
        for (ExpiredBookingRow bk : rows) {
            try {
                processOneBooking(bk);
                processed++;
            } catch (Exception e) {
                // ⚠️ Continuer sur le suivant (comme Python)
                log.error("Erreur expiration booking {} : {}", bk.getBookingId(), e.getMessage(), e);
            }
        }
        return processed;
    }

    // ── Traitement d'un booking (transaction DB) + Stripe hors transaction ─────
    @Transactional
    private void processOneBookingInTransaction(ExpiredBookingRow bk) {

        // a. Booking → expired (guard RETURNING)
        String updated = bookingRepo.transitionToExpired(bk.getBookingId());
        if (updated == null) return;  // ← race condition : skip silencieux

        // b. Slot → available (conditionnel)
        if (bk.getSlotId() != null) {
            slotRepo.releaseIfExpired(bk.getSlotId());
            // ⚠️ Le filtre slot_type IN ('single','specific') est dans la requête SQL
        }

        // c. Payment → cancelled (conditionnel)
        if (bk.getPaymentId() != null
            && isEligiblePayStatus(bk.getPayStatus())) {
            paymentRepo.cancelExpired(bk.getPaymentId());
        }

        // d. Titre service (fallback "un service")
        String svcTitle = serviceRepo.findTitleById(bk.getServiceId());
        if (svcTitle == null) svcTitle = "un service";

        // e. Notifications payer + receiver
        notifRepo.insertExpiredNotif(
            bk.getPayerUserId(), bk.getBookingId(), bk.getServiceId(),
            svcTitle, bk.getBookingStatus(), "payer"
        );
        notifRepo.insertExpiredNotif(
            bk.getReceiverUserId(), bk.getBookingId(), bk.getServiceId(),
            svcTitle, bk.getBookingStatus(), "receiver"
        );
    }

    // ── Appel Stripe HORS @Transactional ──────────────────────────────────────
    private void processOneBooking(ExpiredBookingRow bk) {
        // Étape DB (transactionnelle)
        processOneBookingInTransaction(bk);

        // Étape Stripe (hors transaction — après COMMIT)
        if (bk.getStripePaymentIntentId() != null
            && isEligiblePayStatus(bk.getPayStatus())) {
            try {
                stripeService.cancelPaymentIntent(bk.getStripePaymentIntentId(), "expired");
                log.info("Stripe annulation expiration : pi={} | booking={}",
                    bk.getStripePaymentIntentId(), bk.getBookingId());
            } catch (Exception e) {
                log.error("Erreur Stripe annulation pi={} : {}",
                    bk.getStripePaymentIntentId(), e.getMessage());
                // ⚠️ Pas de re-throw — la DB est déjà commitée
            }
        }
        log.info("Booking expiré : {} (prev={}, slot={}, pay={}→cancelled)",
            bk.getBookingId(), bk.getBookingStatus(), bk.getSlotId(), bk.getPayStatus());
    }

    private boolean isEligiblePayStatus(String payStatus) {
        return payStatus != null && List.of(
            "requires_authorization", "authorized", "capture_pending"
        ).contains(payStatus);
    }
}
```

---

## Repository

### `BookingExpiryRepository`

```java
// ⚠️ FOR UPDATE SKIP LOCKED : requête NATIVE obligatoire

@Repository
public interface BookingExpiryRepository extends JpaRepository<Booking, String> {

    // expiry_worker.py:59–82
    @Query(value = """
        SELECT
            b.booking_id,
            b.status       AS booking_status,
            b.slot_id,
            b.payer_user_id,
            b.receiver_user_id,
            b.service_id,
            p.payment_id,
            p.status       AS pay_status,
            p.stripe_payment_intent_id,
            p.stripe_checkout_session_id
        FROM bookings b
        LEFT JOIN payments p ON p.booking_id = b.booking_id
        WHERE b.status IN ('requested', 'awaiting_payment')
          AND b.expires_at IS NOT NULL
          AND b.expires_at < NOW()
        ORDER BY b.expires_at ASC
        LIMIT :batchSize
        FOR UPDATE OF b SKIP LOCKED
        """, nativeQuery = true)
    List<ExpiredBookingRow> findExpiredBatch(@Param("batchSize") int batchSize);

    // expiry_worker.py:103–109
    @Query(value = """
        UPDATE bookings
        SET status = 'expired', updated_at = NOW()
        WHERE booking_id = :bookingId
          AND status IN ('requested', 'awaiting_payment')
        RETURNING booking_id
        """, nativeQuery = true)
    String transitionToExpired(@Param("bookingId") String bookingId);
    // ⚠️ Retourne NULL si le booking a déjà changé de statut (race condition → skip)
}
```

### `SlotRepository` (extension)

```java
// expiry_worker.py:115–122
@Modifying
@Query(value = """
    UPDATE service_slots
    SET slot_status = 'available'
    WHERE slot_id = :slotId
      AND slot_status IN ('pending', 'reserved')
      AND slot_type IN ('single', 'specific')
    """, nativeQuery = true)
void releaseIfExpired(@Param("slotId") String slotId);
// ⚠️ Aucune exception si 0 rows → idempotent
// ⚠️ Le filtre slot_type est DANS la requête — ne pas le faire en Java applicatif
```

### `PaymentExpiryRepository` (extension)

```java
// expiry_worker.py:128–133
@Modifying
@Query(value = """
    UPDATE payments
    SET status = 'cancelled', updated_at = NOW()
    WHERE payment_id = :paymentId
    """, nativeQuery = true)
void cancelExpired(@Param("paymentId") String paymentId);
// ⚠️ Le guard pay_status est fait en Java avant d'appeler cette méthode (isEligiblePayStatus)
// ⚠️ Pas de RETURNING ici — la DB est déjà protégée par le lock sur bookings
```

### `NotificationRepository` (extension)

```java
// expiry_worker.py:194–202
@Modifying
@Query(value = """
    INSERT INTO notifications (notif_id, user_id, type, title, body, data)
    VALUES (:notifId, :userId, :type, :title, :body, CAST(:data AS jsonb))
    """, nativeQuery = true)
void insert(
    @Param("notifId") String notifId,      // "ntf_" + 12 hex chars
    @Param("userId") String userId,
    @Param("type") String type,
    @Param("title") String title,
    @Param("body") String body,
    @Param("data") String data             // JSON sérialisé
);
```

---

## Projection `ExpiredBookingRow`

```java
// Interface Spring Data Projection (ou record)
public interface ExpiredBookingRow {
    String getBookingId();
    String getBookingStatus();      // 'requested' | 'awaiting_payment'
    String getSlotId();             // nullable
    String getPayerUserId();
    String getReceiverUserId();
    String getServiceId();
    String getPaymentId();          // nullable
    String getPayStatus();          // nullable
    String getStripePaymentIntentId();   // nullable
    String getStripeCheckoutSessionId(); // nullable — non utilisé par le worker
}
```

---

## Génération des IDs de notification

```java
// models.py:8–10 : new_id("ntf") = "ntf_" + uuid4().hex[:12]
public static String newNotifId() {
    String hex = UUID.randomUUID().toString().replace("-", "");
    return "ntf_" + hex.substring(0, 12);
}
```

---

## Construction des messages de notification

```java
// expiry_worker.py:141–171
private NotifContent buildPayerNotif(String bookingStatus, String svcTitle, String bookingId, String serviceId) {
    String body = "awaiting_payment".equals(bookingStatus)
        ? "Votre réservation pour « " + svcTitle + " » a expiré (délai de paiement dépassé)."
        : "Votre demande pour « " + svcTitle + " » n'a pas reçu de réponse et a expiré.";
    Map<String,Object> data = Map.of(
        "type", "booking_expired",
        "bookingId", bookingId,
        "service_id", serviceId,
        "service_title", svcTitle
    );
    return new NotifContent("Demande expirée", body, data);
}

private NotifContent buildReceiverNotif(String bookingStatus, String svcTitle,
                                         String bookingId, String serviceId, String payerId) {
    String title = "awaiting_payment".equals(bookingStatus) ? "Réservation non payée" : "Demande non traitée";
    String body  = "awaiting_payment".equals(bookingStatus)
        ? "Le client n'a pas payé dans les délais pour « " + svcTitle + " » — créneau libéré."
        : "Une demande de réservation pour « " + svcTitle + " » a expiré sans avoir été traitée.";
    Map<String,Object> data = new LinkedHashMap<>();
    data.put("type", "booking_expired");
    data.put("bookingId", bookingId);
    data.put("service_id", serviceId);
    data.put("service_title", svcTitle);
    data.put("payer_id", payerId);  // ⚠️ payer_id uniquement dans la notif receiver
    return new NotifContent(title, body, data);
}
```

---

## Critères de done (Definition of Done)

| # | Critère | Test |
|---|---|---|
| D1 | Booking `requested` expiré → `expired` | TC-06 |
| D2 | Booking `awaiting_payment` expiré → `expired` | TC-07 |
| D3 | Race condition `RETURNING NULL` → skip silencieux | TC-08 |
| D4 | Slot `single`/`specific` libéré → `available` | TC-09, TC-10 |
| D5 | Slot `recurring` **non** libéré | TC-11 |
| D6 | Payment `requires_authorization` → `cancelled` | TC-15 |
| D7 | Payment `authorized` → `cancelled` | TC-16 |
| D8 | Payment `captured` → **inchangé** | TC-18 |
| D9 | 2 notifications par booking (payer + receiver) | TC-21 |
| D10 | Textes notif asymétriques selon `booking_status` | TC-22–TC-25 |
| D11 | `payer_id` uniquement dans data du receiver | TC-26 |
| D12 | Stripe `cancel_payment_intent` appelé après COMMIT | TC-29 |
| D13 | Erreur Stripe → log only, DB restée commitée | TC-31 |
| D14 | Drain loop : 120 bookings traités en 1 tick | TC-33 |
| D15 | `initialDelay=0` : tick au démarrage | TC-35 |
| D16 | 2 workers concurrents → aucun doublon (SKIP LOCKED) | TC-36 |

---

## Pièges récapitulatifs (top 7)

| # | Piège | Risque si oublié |
|---|---|---|
| P1 | `FOR UPDATE SKIP LOCKED` en requête native | Deadlocks + double traitement |
| P2 | Drain loop `while count >= BATCH_SIZE` | Backlog non traité au-delà de 50 items |
| P3 | Stripe **hors** `@Transactional` | Lock DB tenu pendant appel réseau → timeout |
| P4 | `slot_type IN ('single','specific')` dans SQL | Slots récurrents libérés à tort |
| P5 | Skip si `RETURNING booking_id` = NULL | Notifications dupliquées sur race condition |
| P6 | `payer_id` dans data receiver uniquement | Données frontend incorrectes |
| P7 | `initialDelay=0` dans `@Scheduled` | Backlog non traité au redémarrage |

---

## Relation avec les Slices précédentes

| Slice | Relation |
|---|---|
| S13 (`/accept`) | Crée `awaiting_payment` + `expires_at=NOW()+30min` → ExpiryWorker expire si non payé |
| S15 (`/cancel`) | Annulation manuelle — ExpiryWorker = annulation automatique par TTL |
| S16 (webhook) | Peut recevoir `payment_intent.canceled` après annulation Stripe par ExpiryWorker |
| S17 (`/checkout/session`) | Le payer appelle S17 avant que ExpiryWorker déclenche l'expiration |
| **S19** | Lecture paiements (`GET /payments/me`, `GET /payments/{id}`) |
