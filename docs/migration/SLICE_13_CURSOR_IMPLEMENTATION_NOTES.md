# SLICE_13_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation pour Cursor
> Basé sur `booking_routes.py:401–552`, `_get_pay_now_minutes:56–66`.
> Généré le 2026-02-XX.

---

## Structure recommandée Java/Spring Boot

```
src/main/java/com/spotu/
├── controller/
│   └── BookingController.java           ← ajouter POST /bookings/{id}/accept
├── service/
│   └── BookingWriteService.java         ← ajouter acceptBooking() (+ refuse de Slice 12)
├── repository/
│   └── BookingRepository.java           ← ajouter requêtes accept
└── dto/
    ├── BookingAcceptCasAResponseDto.java
    ├── BookingAcceptCasBResponseDto.java
    └── BookingAcceptIdempotentDto.java
    (ou un seul BookingAcceptResponseDto avec champs nullable + @JsonInclude(NON_NULL))
```

---

## Controller

```java
@PostMapping("/bookings/{bookingId}/accept")
public ResponseEntity<?> acceptBooking(
        @PathVariable String bookingId,
        @RequestHeader(name = "Authorization", required = false) String authHeader) {
    UserContext user = authService.requireAuth(authHeader);
    Object response = bookingWriteService.acceptBooking(bookingId, user);
    return ResponseEntity.ok(response);
}
```

**Pas de `@RequestBody`.**

---

## DTO unique avec champs nullable

```java
@JsonInclude(JsonInclude.Include.NON_NULL)
public record BookingAcceptResponseDto(
    @JsonProperty("success")           boolean success,
    @JsonProperty("status")            String status,
    @JsonProperty("booking_id")        String bookingId,
    @JsonProperty("payment_mode")      String paymentMode,
    @JsonProperty("payment_captured")  Boolean paymentCaptured,    // Cas A seulement
    @JsonProperty("pay_expiry_interval") String payExpiryInterval, // Cas B seulement
    @JsonProperty("idempotent")        Boolean idempotent           // Idempotence seulement
) {}
```

`@JsonInclude(NON_NULL)` assure l'omission des champs null — comportement identique à Python.

---

## Service — Logique complète

```java
@Service
@RequiredArgsConstructor
public class BookingWriteService {

    public BookingAcceptResponseDto acceptBooking(String bookingId, UserContext user) {
        // 1. Lecture booking + service JOIN
        BookingServiceRow bk = bookingRepository.findForAccept(bookingId)
            .orElseThrow(() -> new ApiNotFoundException("Réservation introuvable"));

        // 2. Contrôle accès : receiver OU admin
        if (!user.userId().equals(bk.receiverUserId()) && !"admin".equals(user.role())) {
            throw new AccessForbiddenException("Seul le bénéficiaire peut accepter cette réservation");
        }

        // 3. Idempotence
        if (List.of("awaiting_payment", "accepted", "confirmed").contains(bk.status())) {
            return new BookingAcceptResponseDto(true, bk.status(), bookingId, null, null, null, true);
        }

        // 4. Garde statut
        if (!"requested".equals(bk.status())) {
            throw new BookingStatusConflictException(
                "Impossible d'accepter une réservation en état '" + bk.status() + "'");
        }

        // 5. Garde TTL
        if (bk.expiresAt() != null) {
            ZonedDateTime expiresAt = bk.expiresAt().atZone(ZoneOffset.UTC);
            if (expiresAt.isBefore(ZonedDateTime.now(ZoneOffset.UTC))) {
                throw new BookingExpiredException("Cette réservation a expiré — le créneau a été libéré");
            }
        }

        // 6. Lecture payment
        PaymentRow payRow = bookingRepository.findPaymentForAccept(bookingId);
        String payStatus = payRow != null ? payRow.payStatus() : null;
        String piId     = payRow != null ? payRow.stripePaymentIntentId() : null;
        String paymentId = payRow != null ? payRow.paymentId() : null;

        // 7. Branchement Cas A / Cas B
        String paymentMode = bk.paymentMode() != null ? bk.paymentMode() : "pay_now";

        if ("pay_now".equals(paymentMode) && "authorized".equals(payStatus)) {
            return acceptCasA(bookingId, bk, paymentId, piId, paymentMode);
        } else {
            return acceptCasB(bookingId, bk, paymentMode);
        }
    }

    @Transactional
    private BookingAcceptResponseDto acceptCasA(String bookingId, BookingServiceRow bk,
            String paymentId, String piId, String paymentMode) {
        // Transaction
        bookingRepository.updateCasA(bookingId);
        if (paymentId != null) bookingRepository.capturePayment(paymentId);
        if (bk.slotId() != null) bookingRepository.markSlotBooked(bk.slotId());

        // Stripe hors transaction
        stripeService.capturePaymentIntentIfPresent(piId);

        // Push
        pushService.sendAsync(bk.payerUserId(), "Réservation confirmée !",
            "Votre demande a été acceptée et votre paiement a été confirmé.",
            Map.of("type", "booking_confirmed", "bookingId", bookingId,
                   "payment_captured", true, "action_text", "a accepté et confirmé votre réservation"),
            "booking_accepted");

        return new BookingAcceptResponseDto(true, "confirmed", bookingId, paymentMode, true, null, null);
    }

    @Transactional
    private BookingAcceptResponseDto acceptCasB(String bookingId, BookingServiceRow bk, String paymentMode) {
        // Calcul expiry
        int payExpiryMinutes;
        if ("pay_now".equals(paymentMode)) {
            payExpiryMinutes = bookingRepository.findPayNowMinutes();  // SELECT app_config
        } else {
            payExpiryMinutes = bk.payLaterExpirationMinutes() != null
                ? bk.payLaterExpirationMinutes() : 1440;
        }
        ZonedDateTime newExpiresAt = ZonedDateTime.now(ZoneOffset.UTC)
            .plusMinutes(payExpiryMinutes);
        String payExpiryInterval = payExpiryMinutes + " minutes";

        // Transaction
        bookingRepository.updateCasB(bookingId, newExpiresAt.toInstant());
        if (bk.slotId() != null) bookingRepository.markSlotReserved(bk.slotId());

        // Push
        pushService.sendAsync(bk.payerUserId(),
            "Réservation acceptée — paiement requis",
            "Votre demande a été acceptée. Vous avez " + payExpiryMinutes + " min pour payer.",
            Map.of("type", "booking_accepted", "bookingId", bookingId,
                   "requires_payment", true, "action_text", "a accepté votre demande"),
            "booking_accepted");

        return new BookingAcceptResponseDto(true, "awaiting_payment", bookingId, paymentMode, null, payExpiryInterval, null);
    }
}
```

**Note `@Transactional` :** les méthodes `acceptCasA` et `acceptCasB` sont annotées `@Transactional`. L'appel Stripe dans `acceptCasA` doit être APRÈS le commit → utiliser `@TransactionalEventListener(AFTER_COMMIT)` ou appeler Stripe dans la méthode non-transactionnelle après le retour.

---

## Repository — SQL natifs

```java
// Requête 1 — Booking + service JOIN
Optional<BookingServiceRow> findForAccept(String bookingId);
// SQL: SELECT ... FROM bookings b JOIN services s ON s.service_id=b.service_id WHERE b.booking_id=?

// Requête 2 — Payment
PaymentRow findPaymentForAccept(String bookingId);
// SQL: SELECT payment_id, stripe_payment_intent_id, status AS pay_status FROM payments WHERE booking_id=? LIMIT 1

// Requête 3 — app_config
int findPayNowMinutes();
// SQL: SELECT config_value FROM app_config WHERE config_key='pay_now_checkout_minutes' — fallback 30

// UPDATE Cas A — bookings (3 champs + updated_at)
@Modifying
void updateCasA(String bookingId);
// SQL: UPDATE bookings SET status='confirmed', payment_status='captured', expires_at=NULL, updated_at=NOW() WHERE booking_id=?

// UPDATE Cas A — payments
@Modifying
void capturePayment(String paymentId);
// SQL: UPDATE payments SET status='captured', updated_at=NOW() WHERE payment_id=?

// UPDATE Cas A — service_slots (3 états acceptés)
@Modifying
void markSlotBooked(String slotId);
// SQL: UPDATE service_slots SET slot_status='booked' WHERE slot_id=? AND slot_status IN ('pending','available','reserved')

// UPDATE Cas B — bookings (expires_at calculé)
@Modifying
void updateCasB(String bookingId, Instant newExpiresAt);
// SQL: UPDATE bookings SET status='awaiting_payment', expires_at=?, updated_at=NOW() WHERE booking_id=?

// UPDATE Cas B — service_slots (2 états acceptés)
@Modifying
void markSlotReserved(String slotId);
// SQL: UPDATE service_slots SET slot_status='reserved' WHERE slot_id=? AND slot_status IN ('pending','available')
```

---

## Gestion des erreurs

| Exception | Code HTTP | Corps JSON |
|---|---|---|
| `ResponseStatusException(401)` | 401 | `{"detail": "Non authentifié"}` |
| `AccessForbiddenException` | 403 | `{"detail": "Seul le bénéficiaire peut accepter cette réservation"}` |
| `ApiNotFoundException` | 404 | `{"detail": "Réservation introuvable"}` |
| `BookingStatusConflictException` | 409 | `{"detail": "Impossible d'accepter une réservation en état '<status>'"}` |
| `BookingExpiredException` | 410 | `{"detail": "Cette réservation a expiré — le créneau a été libéré"}` |
| `DataAccessException` → GlobalExceptionHandler | 503 | `{"detail": "Service temporairement indisponible"}` |

**HTTP 410** : utiliser `ResponseStatus(HttpStatus.GONE)` ou `ResponseStatusException(HttpStatus.GONE, "...")`.

---

## Stripe Service (stub Cas A)

```java
public void capturePaymentIntentIfPresent(String piId) {
    if (piId == null || piId.isBlank()) return;
    try {
        // TODO Slice Stripe : stripe.paymentIntents().capture(piId)
        log.info("[STUB] Stripe capture PI piId={}", piId);
    } catch (Exception e) {
        log.error("Erreur capture Stripe pi={} : {}", piId, e.getMessage());
        // Erreur avalée — booking déjà confirmed en DB
    }
}
```

---

## Critères de done

### Cas B
- [ ] `POST /api/bookings/{id}/accept` retourne 200 avec `status=awaiting_payment`
- [ ] `bookings.status = 'awaiting_payment'` + `expires_at` calculé
- [ ] `pay_expiry_interval` = `"{n} minutes"` (format string exact)
- [ ] Expiry pay_now : lecture `app_config.pay_now_checkout_minutes` + fallback 30
- [ ] Expiry pay_later : `service.pay_later_expiration_minutes` + fallback 1440
- [ ] Slot → `reserved` uniquement si IN ('pending','available')
- [ ] Aucun UPDATE payments en Cas B

### Cas A
- [ ] Status `confirmed` + `payment_status=captured` + `expires_at=NULL`
- [ ] `payment_captured=true` dans la réponse
- [ ] UPDATE payments sur `payment_id` (PK) — pas sur booking_id
- [ ] Slot → `booked` si IN ('pending','available','reserved') — 3 états
- [ ] Stripe capture HORS transaction (stub acceptable)

### Commun
- [ ] Admin peut accepter (en plus du receiver)
- [ ] 401 si token absent/invalide
- [ ] 403 si ni receiver ni admin
- [ ] 404 si booking inexistant
- [ ] 409 si statut invalide (message inclut l'état)
- [ ] 410 si expires_at dans le passé
- [ ] Idempotence : 3 statuts → retour état réel + `"idempotent": true`
- [ ] Champs absents en Cas A : pas de `pay_expiry_interval`
- [ ] Champs absents en Cas B : pas de `payment_captured`
- [ ] Tests d'intégration passing (`mvn test`)
