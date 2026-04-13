# SLICE_12_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation pour Cursor
> Basé sur `booking_routes.py:675–747`.
> Généré le 2026-02-XX.

---

## Structure recommandée Java/Spring Boot

```
src/main/java/com/spotu/
├── controller/
│   └── BookingController.java         ← POST /bookings/{bookingId}/refuse (+ Slice 11 GETs)
├── service/
│   ├── BookingReadService.java        ← Slice 11 (GET)
│   └── BookingWriteService.java       ← Slice 12 (POST refuse) — nouveau
├── repository/
│   ├── BookingRepository.java         ← findById pour lecture + update
│   └── BookingRefuseRepository.java   ← ou méthodes dans BookingRepository
└── dto/
    └── BookingRefuseResponseDto.java  ← Réponse refuse (nominal + idempotent)
```

---

## Controller

```java
// BookingController.java
@PostMapping("/bookings/{bookingId}/refuse")
public ResponseEntity<BookingRefuseResponseDto> refuseBooking(
        @PathVariable String bookingId,
        @RequestHeader(name = "Authorization", required = false) String authHeader) {
    UserContext user = authService.requireAuth(authHeader);  // 401 si absent/invalide
    BookingRefuseResponseDto response = bookingWriteService.refuseBooking(bookingId, user);
    return ResponseEntity.ok(response);
}
```

**Note :** pas de `@RequestBody` — l'endpoint ne lit aucun corps.

---

## DTOs

### BookingRefuseResponseDto

```java
// Réponse nominale
public record BookingRefuseResponseDto(
    @JsonProperty("success")    boolean success,
    @JsonProperty("status")     String status,
    @JsonProperty("booking_id") String bookingId,  // nullable — absent si idempotent
    @JsonProperty("idempotent") Boolean idempotent  // nullable — absent si nominal
) {}
```

**Sérialisation :** utiliser `@JsonInclude(JsonInclude.Include.NON_NULL)` sur le record pour omettre les champs null.

Réponse nominale :
```json
{"success": true, "status": "refused", "booking_id": "bk_abc"}
```

Réponse idempotente :
```json
{"success": true, "status": "refused", "idempotent": true}
```

---

## Service — Logique complète

```java
@Service
@RequiredArgsConstructor
public class BookingWriteService {

    @Transactional
    public BookingRefuseResponseDto refuseBooking(String bookingId, UserContext user) {
        // 1. Lecture booking
        BookingRow bk = bookingRepository.findForRefuse(bookingId)
            .orElseThrow(() -> new ApiNotFoundException("Réservation introuvable"));

        // 2. Contrôle accès — receiver uniquement (pas d'exception admin)
        if (!user.userId().equals(bk.receiverUserId())) {
            throw new AccessForbiddenException("Seul le bénéficiaire peut refuser cette réservation");
        }

        // 3. Idempotence
        if ("refused".equals(bk.status())) {
            return new BookingRefuseResponseDto(true, "refused", null, true);
        }

        // 4. Garde statut
        if (!"requested".equals(bk.status())) {
            throw new BookingStatusConflictException(
                "Impossible de refuser une réservation en état '" + bk.status() + "'"
            );
        }

        // 5. Lecture PI Stripe avant transaction
        String piId = bookingRepository.findPaymentIntentId(bookingId);

        // 6. Transaction atomique (méthode annotée @Transactional)
        bookingRepository.updateStatusRefused(bookingId);
        bookingRepository.cancelPaymentForRefuse(bookingId);
        if (bk.slotId() != null) {
            bookingRepository.freeSlotIfPending(bk.slotId());
        }

        // 7. Stripe HORS transaction (après commit)
        stripeService.cancelPaymentIntentIfPresent(piId, "refused");

        // 8. Push notification fire-and-forget
        pushService.sendAsync(bk.payerUserId(),  // = bookings.user_id (legacy alias)
            "Réservation refusée",
            "Votre demande de réservation n'a pas pu être acceptée.",
            Map.of("type", "booking_refused", "bookingId", bookingId, "action_text", "a refusé votre demande"),
            "booking_refused"
        );

        return new BookingRefuseResponseDto(true, "refused", bookingId, null);
    }
}
```

**Point critique @Transactional :** les appels Stripe (étape 7) et push (étape 8) doivent être APRÈS le commit de la transaction. Pour garantir cela, déplacer ces appels dans un `@TransactionalEventListener(phase = AFTER_COMMIT)` ou simplement les extraire dans une méthode non-transactionnelle appelée après le retour de la méthode `@Transactional`.

---

## Repository — SQL natifs

```java
// Requête 1 — Lecture booking pour /refuse
@Query(nativeQuery = true, value = """
    SELECT booking_id, status, receiver_user_id, slot_id, user_id AS payer_user_id
    FROM bookings WHERE booking_id = ?
    """)
Optional<BookingRow> findForRefuse(String bookingId);

// Requête 2 — Lecture PI Stripe
@Query(nativeQuery = true, value = """
    SELECT stripe_payment_intent_id FROM payments WHERE booking_id = ? LIMIT 1
    """)
String findPaymentIntentId(String bookingId);

// UPDATE 1 — Booking → refused
@Modifying
@Query(nativeQuery = true, value = """
    UPDATE bookings SET status = 'refused', updated_at = NOW()
    WHERE booking_id = ?
    """)
void updateStatusRefused(String bookingId);

// UPDATE 2 — Payment → cancelled (conditionnel)
@Modifying
@Query(nativeQuery = true, value = """
    UPDATE payments SET status = 'cancelled', updated_at = NOW()
    WHERE booking_id = ?
      AND status IN ('requires_authorization', 'authorized')
    """)
void cancelPaymentForRefuse(String bookingId);

// UPDATE 3 — Slot → available (conditionnel)
@Modifying
@Query(nativeQuery = true, value = """
    UPDATE service_slots SET slot_status = 'available'
    WHERE slot_id = ?
      AND slot_status = 'pending'
    """)
void freeSlotIfPending(String slotId);
```

---

## Stripe Service (stub v1)

```java
@Service
public class StripeService {
    private static final Logger log = LoggerFactory.getLogger(StripeService.class);

    public void cancelPaymentIntentIfPresent(String piId, String reason) {
        if (piId == null || piId.isBlank()) return;
        try {
            // TODO Slice Stripe : implémenter l'appel réel Stripe
            log.info("[STUB] Stripe cancel PI piId={} reason={}", piId, reason);
        } catch (Exception e) {
            log.error("Erreur annulation Stripe pi={} : {}", piId, e.getMessage());
            // Erreur avalée intentionnellement — comportement Python reproduit
        }
    }
}
```

---

## Gestion des erreurs

| Exception Java | Code HTTP | Corps JSON |
|---|---|---|
| `ResponseStatusException(401)` | 401 | `{"detail": "Non authentifié"}` |
| `AccessForbiddenException` (ou `ResponseStatusException(403)`) | 403 | `{"detail": "Seul le bénéficiaire peut refuser cette réservation"}` |
| `ApiNotFoundException` | 404 | `{"detail": "Réservation introuvable"}` |
| `BookingStatusConflictException` (ou `ResponseStatusException(409)`) | 409 | `{"detail": "Impossible de refuser une réservation en état 'X'"}` |
| `DataAccessException` → GlobalExceptionHandler | 503 | `{"detail": "Service temporairement indisponible"}` |

**Format des messages 409 :** reproduire exactement `"Impossible de refuser une réservation en état '` + statut + `'"`.

---

## Séquence complète (garantie de cohérence)

```
Requête POST →
  1. requireAuth(authHeader)         → 401 si invalide
  2. findForRefuse(bookingId)        → 404 si absent
  3. check receiverUserId            → 403 si non receiver
  4. check status == "refused"       → 200 idempotent si oui
  5. check status != "requested"     → 409 si statut invalide
  6. findPaymentIntentId(bookingId)  → piId (nullable)
  7. BEGIN TRANSACTION
     updateStatusRefused
     cancelPaymentForRefuse
     if slotId != null: freeSlotIfPending
  8. COMMIT
  9. cancelPaymentIntentIfPresent(piId)  [hors transaction]
  10. pushService.sendAsync(...)         [fire-and-forget]
  11. return 200 {"success": true, "status": "refused", "booking_id": bookingId}
```

---

## Validations

| Validation | Où | Condition |
|---|---|---|
| Auth présente et valide | Avant logique | `requireAuth()` → 401 |
| Booking existe | Dans service | `findForRefuse()` → 404 |
| user = receiver_user_id | Dans service | Strict, pas de COALESCE ni d'exception admin |
| Status = "requested" | Dans service | 409 sinon (sauf "refused" → idempotent) |
| Body JSON | Aucun | L'endpoint ne lit pas de body |

---

## Critères de done

- [ ] `POST /api/bookings/{bookingId}/refuse` actif et retourne 200
- [ ] 401 si token absent — 401 si token invalide
- [ ] 403 si user != receiver_user_id — message exact Python
- [ ] 403 si admin (pas d'exception admin ici)
- [ ] 404 si booking inexistant — message exact Python
- [ ] 409 si status != requested/refused — message inclut l'état actuel
- [ ] Idempotence : statut `refused` → `{"success": true, "status": "refused", "idempotent": true}` sans `booking_id`
- [ ] Transaction atomique (bookings + payments + service_slots)
- [ ] UPDATE payments conditionnel `IN ('requires_authorization', 'authorized')`
- [ ] UPDATE service_slots conditionnel `slot_status = 'pending'` ET `slot_id != null`
- [ ] Stripe appel HORS transaction (stub ou réel)
- [ ] Push notification fire-and-forget (non bloquant)
- [ ] Réponse nominale : `{"success": true, "status": "refused", "booking_id": "..."}`
- [ ] Tests d'intégration passing (`mvn test`)
