# SLICE_15_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation pour Cursor
> Slice 15 : `POST /api/bookings/{bookingId}/cancel`
> Source Python : `booking_routes.py:754–977`.
> Généré le 2026-02-XX.

---

## Architecture recommandée

```
BookingCancelController
  └─ BookingCancelService.cancelBooking(bookingId, userId, userRole, reason)
       ├─ BookingCancelRepository.findForCancel(bookingId)
       ├─ [Guards] access check, idempotence, non-cancellable states
       ├─ [Transaction @Transactional]
       │    ├─ BookingCancelRepository.markCancelled(bookingId, cancelledBy, reason)
       │    ├─ BookingCancelRepository.updatePaymentStatus(paymentId, newStatus)  [conditionnel]
       │    └─ BookingCancelRepository.releaseSlot(slotId)                         [conditionnel]
       ├─ [Post-transaction] StripeService.cancelPaymentIntent(piId)    [conditionnel]
       ├─ [Post-transaction] StripeService.createRefund(chargeId, ...)  [conditionnel]
       └─ [Post-transaction] PushService.send(...)                       [1–2 notifications]
```

---

## Controller

### Fichier suggéré

`BookingCancelController.java` (ou ajouter dans `BookingWriteController.java`)

```java
@PostMapping("/bookings/{bookingId}/cancel")
@ResponseStatus(HttpStatus.OK)
public ResponseEntity<Map<String, Object>> cancelBooking(
    @PathVariable String bookingId,
    @RequestBody(required = false) CancelRequest body,
    HttpServletRequest request) {

    AuthUser user = authService.requireAuth(request);  // 401 si absent
    String reason = (body != null) ? body.getReason() : null;

    return ResponseEntity.ok(
        bookingCancelService.cancelBooking(bookingId, user, reason)
    );
}
```

### Modèle body

```java
public class CancelRequest {
    @JsonProperty("reason")
    private String reason;  // Optional<String>, peut être null
    // getter/setter
}
```

---

## Service

### Fichier suggéré

`BookingCancelService.java`

```java
@Service
public class BookingCancelService {

    @Autowired private BookingCancelRepository repository;
    @Autowired private StripeService stripeService;
    @Autowired private PushService pushService;

    public Map<String, Object> cancelBooking(String bookingId, AuthUser user, String reason) {

        // ── Étape 1 : Lecture avec LEFT JOIN payments ─────────────────────
        BookingCancelView bk = repository.findForCancel(bookingId);
        if (bk == null) throw new NotFoundException("Réservation introuvable");  // 404

        // ── Étape 2 : Contrôle d'accès ────────────────────────────────────
        String uid      = user.getUserId();
        boolean isAdmin    = "admin".equals(user.getRole());
        // ⚠️ Double champ legacy : vérifier user_id ET payer_user_id
        boolean isPayer    = uid.equals(bk.getUserId()) || uid.equals(bk.getPayerUserId());
        boolean isReceiver = uid.equals(bk.getReceiverUserId());

        if (!isPayer && !isReceiver && !isAdmin) {
            throw new ForbiddenException("Vous n'êtes pas autorisé à annuler cette réservation");  // 403
        }

        // ⚠️ Receiver : uniquement sur 'accepted' (HTTP 409, pas 403)
        if (isReceiver && !isPayer && !isAdmin) {
            if (!"accepted".equals(bk.getStatus())) {
                throw new ConflictException(
                    "Le bénéficiaire peut annuler uniquement une réservation acceptée " +
                    "(état actuel : '" + bk.getStatus() + "'). " +
                    "Pour refuser une demande en attente, utilisez /refuse."
                );
            }
        }

        // ── Étape 3 : Idempotence ─────────────────────────────────────────
        if ("cancelled".equals(bk.getStatus())) {
            return Map.of("success", true, "status", "cancelled", "idempotent", true);
        }

        // ── Étape 4 : États non annulables ────────────────────────────────
        if (List.of("completed", "refused", "expired").contains(bk.getStatus())) {
            throw new ConflictException(
                "Impossible d'annuler une réservation en état '" + bk.getStatus() + "'"
            );
        }

        // ── Étape 5 : Matrice payment ─────────────────────────────────────
        String payStatus = bk.getPayStatus() != null ? bk.getPayStatus() : "";
        String newPayStatus;
        if (List.of("requires_authorization", "authorized", "capture_pending").contains(payStatus)) {
            newPayStatus = "cancelled";
        } else if ("captured".equals(payStatus)) {
            newPayStatus = "refunded";
        } else {
            newPayStatus = payStatus;  // inchangé
        }

        // ── Étape 6 : Transaction atomique ───────────────────────────────
        executeTransaction(bk, uid, reason, newPayStatus, payStatus);

        // ── Étape 7 : Stripe hors transaction ────────────────────────────
        String stripeAction = executeStripe(bk, newPayStatus, bookingId);

        // ── Étape 8 : Notifications push ─────────────────────────────────
        sendPushNotifications(bk, uid, isPayer, isReceiver, isAdmin, newPayStatus, bookingId);

        // ── Étape 9 : Réponse ─────────────────────────────────────────────
        return Map.of(
            "success",        true,
            "status",         "cancelled",
            "booking_id",     bookingId,
            "payment_status", newPayStatus,
            "cancelled_by",   uid,
            "stripe_action",  stripeAction  // null si aucune action
        );
    }

    @Transactional
    private void executeTransaction(BookingCancelView bk, String uid, String reason,
                                    String newPayStatus, String oldPayStatus) {
        repository.markCancelled(bk.getBookingId(), uid, reason);

        if (bk.getPaymentId() != null && !newPayStatus.equals(oldPayStatus)) {
            repository.updatePaymentStatus(bk.getPaymentId(), newPayStatus);
        }

        if (bk.getSlotId() != null) {
            repository.releaseSlot(bk.getSlotId());
        }
    }

    private String executeStripe(BookingCancelView bk, String newPayStatus, String bookingId) {
        if ("cancelled".equals(newPayStatus) && bk.getStripePaymentIntentId() != null) {
            try {
                stripeService.cancelPaymentIntent(bk.getStripePaymentIntentId(), "cancelled");
                return "pi_cancelled";
            } catch (Exception e) {
                log.error("Erreur annulation PI : {}", e.getMessage());
            }
        } else if ("refunded".equals(newPayStatus)) {
            if (bk.getStripeChargeId() != null) {
                try {
                    stripeService.createRefund(bk.getStripeChargeId(),
                        "requested_by_customer", bookingId /* idempotency_key */);
                    return "refund_created";
                } catch (Exception e) {
                    log.error("Erreur remboursement Stripe : {}", e.getMessage());
                }
            } else {
                log.warn("Paiement capturé sans stripe_charge_id — remboursement manuel requis (booking={})", bookingId);
            }
        }
        return null;
    }
}
```

---

## Repository

### Fichier suggéré

`BookingCancelRepository.java`

#### `findForCancel`

```java
// booking_routes.py:800–809
// SELECT b.booking_id, b.status, b.user_id, b.slot_id,
//        b.payer_user_id, b.receiver_user_id, b.service_id,
//        p.status AS pay_status, p.payment_id,
//        p.stripe_payment_intent_id, p.stripe_charge_id
// FROM bookings b
// LEFT JOIN payments p ON p.booking_id = b.booking_id
// WHERE b.booking_id = $1 LIMIT 1
BookingCancelView findForCancel(String bookingId);
// Retourne null si non trouvé
```

> ⚠️ **LEFT JOIN** — `pay_status`, `payment_id`, `stripe_*` peuvent être NULL si aucun paiement.

#### `markCancelled`

```java
// booking_routes.py:855–863
// UPDATE bookings SET status='cancelled', cancelled_by_user_id=$2,
//   cancellation_reason=$3, updated_at=NOW() WHERE booking_id=$1
@Modifying
void markCancelled(String bookingId, String cancelledBy, String reason);
```

#### `updatePaymentStatus`

```java
// booking_routes.py:865–868
// UPDATE payments SET status=$1, updated_at=NOW() WHERE payment_id=$2
// ⚠️ Par payment_id (PK), pas par booking_id
@Modifying
void updatePaymentStatus(String paymentId, String newStatus);
```

#### `releaseSlot`

```java
// booking_routes.py:870–874
// UPDATE service_slots SET slot_status='available'
//   WHERE slot_id=$1 AND slot_status IN ('pending','reserved','booked')
@Modifying
void releaseSlot(String slotId);
// ⚠️ 3 états source (plus large que /refuse qui ne libère que 'pending')
```

### Projection `BookingCancelView`

```java
public class BookingCancelView {
    private String bookingId;
    private String status;
    private String userId;          // legacy payer field
    private String payerUserId;     // payer actuel
    private String receiverUserId;
    private String serviceId;
    private String slotId;          // nullable
    // ── depuis payments (LEFT JOIN) ──
    private String payStatus;       // nullable
    private String paymentId;       // nullable
    private String stripePaymentIntentId;  // nullable
    private String stripeChargeId;         // nullable
}
```

---

## Gestion des erreurs

| Cas | Exception Java | Code HTTP |
|---|---|---|
| Token absent | `UnauthorizedException` | 401 |
| Ni payer ni receiver ni admin | `ForbiddenException` | 403 |
| Receiver sur état != accepted | `ConflictException` | 409 |
| Statut completed/refused/expired | `ConflictException` | 409 |
| booking_id inexistant | `NotFoundException` | 404 |

---

## Points d'attention Java/Spring

### 1. `@Transactional` scope

```java
// La transaction doit englober les 3 UPDATEs (booking + payment + slot).
// Elle NE doit PAS englober les appels Stripe ou push.
// → Utiliser @Transactional sur la méthode executeTransaction()
//   ou extraire dans un composant @Transactional séparé.
```

### 2. Ordre des guards (OBLIGATOIRE)

```
1. Authentication (401)
2. Fetch booking (404)
3. Access control — isPayer/isReceiver/isAdmin (403)
4. Receiver state check (409)
5. Idempotence si déjà cancelled (early return)
6. Non-cancellable states (409)
7. Payment matrix
8. DB Transaction
9. Stripe (hors transaction)
10. Push (hors transaction)
```

### 3. `stripe_action` dans la réponse

```java
// Le champ stripe_action doit apparaître dans la réponse JSON, même s'il est null.
// Utiliser Map.of() ne gère pas les valeurs null en Java standard.
// Utiliser LinkedHashMap ou une classe de réponse dédiée :
Map<String, Object> response = new LinkedHashMap<>();
response.put("success", true);
response.put("stripe_action", stripeAction);  // null accepté
```

### 4. `payment_status` avec valeur inchangée

```java
// Si new_pay_status == old_pay_status (branche else), la réponse retourne
// le statut payment inchangé (ex: "pending", "failed", ou "" si null).
// Le champ payment_status dans la réponse reflète TOUJOURS le new_pay_status calculé.
```

---

## Critères de done (Definition of Done)

| # | Critère | Test |
|---|---|---|
| D1 | Payer annule requested → 200 + PI cancel | TC-01 |
| D2 | Payer annule confirmed → 200 + refund | TC-03 |
| D3 | Receiver annule accepted → 200 | TC-05 |
| D4 | Admin annule → 200 + 2 pushes | TC-07 |
| D5 | 403 si tiers | TC-08 |
| D6 | 401 si token absent | TC-09 |
| D7 | Receiver sur requested → 409 | TC-10 |
| D8 | completed/refused/expired → 409 | TC-12/13/14 |
| D9 | Idempotence si déjà cancelled | TC-16 |
| D10 | captured sans charge_id → refunded DB, stripe_action=null | TC-17 |
| D11 | Slot released (pending+reserved+booked) | TC-21 |
| D12 | slot_id NULL → pas d'erreur | TC-22 |
| D13 | reason=null (body absent) → cancellation_reason=NULL en DB | TC-04 |

---

## Relation avec les Slices précédentes

| Slice | Endpoint | Stripe | Push | Acteurs | Guard statut |
|---|---|---|---|---|---|
| S12 | `/refuse` | Stub cancel (hors tx) | OUI (payer) | Receiver seulement | `requested` uniquement |
| S13 | `/accept` | Stub capture (Cas A) | OUI (payer) | Receiver OU admin | `requested` + idempotence |
| S14 | `/complete` | **AUCUN** | **NON** | Receiver OU admin | **AUCUNE** |
| **S15** | `/cancel` | **Cancel + Refund** | **OUI (3 patterns)** | **Payer + Receiver + Admin** | **5 états** |

`/cancel` est la slice booking write la plus complexe documentée à ce stade — elle clôt le cycle complet côté utilisateur.
