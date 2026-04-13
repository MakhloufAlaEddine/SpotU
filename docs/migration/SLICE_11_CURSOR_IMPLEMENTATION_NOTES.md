# SLICE_11_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation pour Cursor
> Basé sur `booking_routes.py:1035–1110`, `BOOKING_FIELDS`, `_deserialize()`, `require_auth`.
> Généré le 2026-02-XX.

---

## Structure recommandée Java/Spring Boot

```
src/main/java/com/spotu/
├── controller/
│   └── BookingController.java        ← 3 GET + doubles routes
├── service/
│   └── BookingReadService.java       ← Logique auth + accès + désérialisation
├── repository/
│   └── BookingRepository.java        ← 3 requêtes SQL natives
└── dto/
    ├── BookingMeDto.java             ← /me : 22 + service + receiver + slot
    ├── BookingReceivedDto.java       ← /received : 22 + service_title + payer_name
    └── BookingDetailDto.java         ← /détail : 22 + tout le reste
```

---

## Controller

```java
@RestController
@RequestMapping("/api")
public class BookingController {

    @GetMapping({"/bookings/me", "/users/me/bookings"})
    public ResponseEntity<List<BookingMeDto>> myBookings(
            @RequestHeader("Authorization") String authHeader) {
        UserContext user = bookingReadService.authenticate(authHeader);
        return ResponseEntity.ok(bookingReadService.getMyBookings(user.userId()));
    }

    @GetMapping({"/bookings/received", "/receiver/requests"})
    public ResponseEntity<List<BookingReceivedDto>> receivedBookings(
            @RequestHeader("Authorization") String authHeader) {
        UserContext user = bookingReadService.authenticate(authHeader);
        return ResponseEntity.ok(bookingReadService.getReceivedBookings(user.userId()));
    }

    @GetMapping("/bookings/{bookingId}")
    public ResponseEntity<BookingDetailDto> getBookingDetail(
            @PathVariable String bookingId,
            @RequestHeader("Authorization") String authHeader) {
        UserContext user = bookingReadService.authenticate(authHeader);
        return ResponseEntity.ok(bookingReadService.getBookingDetail(bookingId, user));
    }
}
```

**Note auth :** Les 3 handlers doivent retourner 401 si le header `Authorization` est absent ou si `authenticate()` échoue. Utiliser `@RequestHeader(required = false)` pour intercepter l'absence et lever manuellement le 401.

---

## Service — Logique métier

```java
@Service
public class BookingReadService {

    public List<BookingMeDto> getMyBookings(String userId) {
        List<Map<String, Object>> rows = bookingRepository.findByUserId(userId);
        return rows.stream()
            .map(r -> mapToMeDto(r))
            .toList();
    }

    public List<BookingReceivedDto> getReceivedBookings(String userId) {
        List<Map<String, Object>> rows = bookingRepository.findByReceiverUserId(userId);
        return rows.stream()
            .map(r -> mapToReceivedDto(r))
            .toList();
    }

    public BookingDetailDto getBookingDetail(String bookingId, UserContext user) {
        Map<String, Object> row = bookingRepository.findById(bookingId)
            .orElseThrow(() -> new ApiNotFoundException("Réservation introuvable"));

        // Contrôle d'accès — 4 champs + admin (RG-04)
        Set<Object> allowed = new HashSet<>(Arrays.asList(
            row.get("user_id"),
            row.get("payer_user_id"),
            row.get("receiver_user_id"),
            row.get("coach_id")
        ));
        if (!allowed.contains(user.userId()) && !"admin".equals(user.role())) {
            throw new AccessDeniedException("Accès refusé");
        }

        return mapToDetailDto(row);
    }

    // Désérialisation pricing_snapshot (RG-07)
    private Object deserializePricingSnapshot(Object raw) {
        if (raw instanceof String s && !s.isBlank()) {
            try {
                return objectMapper.readValue(s, Object.class);
            } catch (JsonProcessingException e) {
                return raw;  // fallback : retourner la string si parsing échoue
            }
        }
        return raw;  // null ou déjà un objet Jackson
    }
}
```

---

## Repository — SQL natifs

### findByUserId (GET /bookings/me)

```java
public List<Map<String, Object>> findByUserId(String userId) {
    return jdbcTemplate.queryForList("""
        SELECT
            b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
            b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
            b.payment_status, b.payer_user_id, b.receiver_user_id,
            b.pricing_snapshot::text AS pricing_snapshot,
            b.idempotency_key, b.currency,
            b.created_at, b.updated_at, b.expires_at,
            b.cancelled_by_user_id, b.cancellation_reason,
            b.payment_mode,
            s.title AS service_title,
            s.address,
            u_recv.name AS receiver_name,
            u_recv.picture AS receiver_picture,
            sl.start_time AS slot_start_time,
            sl.end_time AS slot_end_time,
            sl.slot_date,
            sl.slot_type
        FROM bookings b
        LEFT JOIN services s ON s.service_id = b.service_id
        LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
        LEFT JOIN service_slots sl ON sl.slot_id = b.slot_id
        WHERE b.user_id = ?
        ORDER BY b.created_at DESC
        """, userId);
}
```

### findByReceiverUserId (GET /bookings/received)

```java
public List<Map<String, Object>> findByReceiverUserId(String userId) {
    return jdbcTemplate.queryForList("""
        SELECT
            b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
            b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
            b.payment_status, b.payer_user_id, b.receiver_user_id,
            b.pricing_snapshot::text AS pricing_snapshot,
            b.idempotency_key, b.currency,
            b.created_at, b.updated_at, b.expires_at,
            b.cancelled_by_user_id, b.cancellation_reason,
            b.payment_mode,
            s.title AS service_title,
            u_pay.name AS payer_name
        FROM bookings b
        LEFT JOIN services s ON s.service_id = b.service_id
        LEFT JOIN users u_pay ON u_pay.user_id = b.payer_user_id
        WHERE b.receiver_user_id = ?
        ORDER BY b.created_at DESC
        """, userId);
}
```

**Note :** `b.payer_user_id` direct (pas de COALESCE pour /received — voir RG-06).

### findById (GET /bookings/{booking_id})

```java
public Optional<Map<String, Object>> findById(String bookingId) {
    List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
        SELECT
            b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
            b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
            b.payment_status, b.payer_user_id, b.receiver_user_id,
            b.pricing_snapshot::text AS pricing_snapshot,
            b.idempotency_key, b.currency,
            b.created_at, b.updated_at, b.expires_at,
            b.cancelled_by_user_id, b.cancellation_reason,
            b.payment_mode,
            s.title AS service_title,
            s.address,
            s.images::text AS service_images,
            s.description AS service_description,
            u_recv.name AS receiver_name,
            u_recv.picture AS receiver_picture,
            u_pay.name AS payer_name,
            u_pay.picture AS payer_picture,
            sl.start_time AS slot_start_time,
            sl.end_time AS slot_end_time,
            sl.slot_date,
            sl.slot_type
        FROM bookings b
        LEFT JOIN services s ON s.service_id = b.service_id
        LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
        LEFT JOIN users u_pay ON u_pay.user_id = COALESCE(b.payer_user_id, b.user_id)
        LEFT JOIN service_slots sl ON sl.slot_id = b.slot_id
        WHERE b.booking_id = ?
        """, bookingId);
    return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
}
```

**Note JDBC + JSONB :** Utiliser `::text` pour extraire `pricing_snapshot` et `service_images` comme String — puis désérialiser en Java avec `ObjectMapper`.

---

## DTOs

### BookingMeDto (GET /bookings/me)

```java
public record BookingMeDto(
    @JsonProperty("booking_id")     String bookingId,
    @JsonProperty("service_id")     String serviceId,
    @JsonProperty("user_id")        String userId,
    @JsonProperty("coach_id")       String coachId,
    String status,
    @JsonProperty("scheduled_at")   String scheduledAt,
    @JsonProperty("slot_id")        String slotId,
    @JsonProperty("location_id")    String locationId,
    String notes,
    BigDecimal amount,
    @JsonProperty("payment_status") String paymentStatus,
    @JsonProperty("payer_user_id")  String payerUserId,
    @JsonProperty("receiver_user_id") String receiverUserId,
    @JsonProperty("pricing_snapshot") Object pricingSnapshot,
    @JsonProperty("idempotency_key") String idempotencyKey,
    String currency,
    @JsonProperty("created_at")     String createdAt,
    @JsonProperty("updated_at")     String updatedAt,
    @JsonProperty("expires_at")     String expiresAt,
    @JsonProperty("cancelled_by_user_id") String cancelledByUserId,
    @JsonProperty("cancellation_reason")  String cancellationReason,
    @JsonProperty("payment_mode")   String paymentMode,
    @JsonProperty("service_title")  String serviceTitle,
    String address,
    @JsonProperty("receiver_name")  String receiverName,
    @JsonProperty("receiver_picture") String receiverPicture,
    @JsonProperty("slot_start_time") String slotStartTime,
    @JsonProperty("slot_end_time")   String slotEndTime,
    @JsonProperty("slot_date")       String slotDate,
    @JsonProperty("slot_type")       String slotType
) {}
```

### BookingReceivedDto (GET /bookings/received)

Identique aux 22 champs BOOKING_FIELDS + :
```java
    @JsonProperty("service_title")  String serviceTitle,
    @JsonProperty("payer_name")     String payerName
    // address, receiver_*, payer_picture, slot_* : ABSENTS du DTO
```

### BookingDetailDto (GET /bookings/{id})

Identique à BookingMeDto + :
```java
    @JsonProperty("service_images")      Object serviceImages,     // JSONB parsé
    @JsonProperty("service_description") String serviceDescription,
    @JsonProperty("payer_name")          String payerName,
    @JsonProperty("payer_picture")       String payerPicture
```

---

## Gestion des erreurs

| Situation | Exception Java | Code HTTP |
|---|---|---|
| Token absent | `ResponseStatusException(401)` | 401 |
| Token invalide/expiré | `ResponseStatusException(401)` | 401 |
| Booking introuvable | `ApiNotFoundException` | 404 |
| Accès refusé | `AccessDeniedException` | 403 |
| Erreur DB | `DataAccessException` → GlobalExceptionHandler | 503 |

Format des erreurs Python à respecter :
```json
{"detail": "Réservation introuvable"}
{"detail": "Accès refusé"}
{"detail": "Non authentifié"}
```

---

## Avertissements et incertitudes

| # | Avertissement | Niveau |
|---|---|---|
| W1 | `pricing_snapshot::text` en JDBC — JSONB envoyé comme text, à désérialiser en Java | CONFIRMÉ |
| W2 | `service_images::text` idem | CONFIRMÉ |
| W3 | `slot_date` est TEXT en base — ne pas caster en `LocalDate` en Java | CONFIRMÉ |
| W4 | Les 22 champs BOOKING_FIELDS ne contiennent pas `payment_provider` ni `payment_intent_id` — ne pas les exposer | CONFIRMÉ |
| W5 | `AccessDeniedException` dans Spring Security → peut retourner 403 différemment du GlobalExceptionHandler — vérifier le format du corps | TECHNIQUE |
| W6 | Doublons de routes (`@GetMapping({"...", "..."})`) — s'assurer que Spring Boot ne lève pas d'ambiguïté | TECHNIQUE |

---

## Critères de done (Definition of Done)

### GET /api/bookings/me
- [ ] Alias `/users/me/bookings` actif (même réponse)
- [ ] Filtre sur `b.user_id` (pas `payer_user_id`)
- [ ] `COALESCE(receiver_user_id, coach_id)` dans JOIN receiver
- [ ] `pricing_snapshot` retourné comme objet JSON (pas string)
- [ ] `slot_date` retourné comme string TEXT
- [ ] Trié par `created_at DESC`
- [ ] Aucun LIMIT
- [ ] 401 sans token, 401 token invalide

### GET /api/bookings/received
- [ ] Alias `/receiver/requests` actif
- [ ] Filtre sur `b.receiver_user_id` (pas COALESCE dans WHERE)
- [ ] JOIN payer sur `b.payer_user_id` directement (pas COALESCE)
- [ ] Champs `address`, `receiver_*`, `slot_*` absents du DTO (pas null — absents)
- [ ] Trié par `created_at DESC`
- [ ] 401 sans token

### GET /api/bookings/{bookingId}
- [ ] 404 si booking introuvable — `{"detail": "Réservation introuvable"}`
- [ ] 403 si uid ∉ {user_id, payer_user_id, receiver_user_id, coach_id} ET role ≠ admin
- [ ] admin voit tous les bookings
- [ ] `COALESCE(receiver_user_id, coach_id)` pour JOIN receiver
- [ ] `COALESCE(payer_user_id, user_id)` pour JOIN payer
- [ ] `service_images` parsé comme JSONB (pas string)
- [ ] 401 sans token
