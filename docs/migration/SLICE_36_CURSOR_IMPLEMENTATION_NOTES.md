# SLICE_36_CURSOR_IMPLEMENTATION_NOTES.md — Notes Java/Spring Boot Booking Reads (Audit)
> Basé sur `routes/booking_routes.py:1035–1110`, `SLICE_11_CURSOR_IMPLEMENTATION_NOTES.md`.
> Généré le 2026-04-25.

---

## ⚠️ Document de référence : `SLICE_11_CURSOR_IMPLEMENTATION_NOTES.md`

L'implémentation Spring Boot complète des 3 endpoints booking read est documentée en S11. **S36 ne réécrit pas le squelette.** Cette doc liste uniquement :

1. **Si S11 n'a pas encore été implémenté** → suivre S11 strict, puis appliquer les régressions S36.
2. **Si S11 a été implémenté avant S30/S33/S35** → appliquer le **patch de régression** documenté ici.

---

## Vérification rapide : S11 implémenté ?

Si Cursor doute :

```bash
# Vérifier la présence des controllers Java
ls src/main/java/com/spotu/booking/controller/BookingReadController.java
```

Si présent : appliquer la régression S36. Sinon : implémenter S11 d'abord.

---

## Patch de régression S36 — checklist Spring Boot

### 1. Réutiliser la config Jackson de S34 (`PaymentJacksonConfig`)

S11 et S36 utilisent le **même** ObjectMapper que S34 :
- `PropertyNamingStrategies.SNAKE_CASE`
- `WRITE_BIGDECIMAL_AS_PLAIN`
- `OffsetDateTime` → format `+00:00`
- `JavaTimeModule`

Si Cursor avait fait un ObjectMapper séparé pour booking → **factoriser** dans une `JacksonConfig` globale.

### 2. Réutiliser `AuthService` de S34

`require_auth` (Bearer + cookie `winek_token`) doit être **un seul service Spring** partagé entre `PaymentReadController` (S34) et `BookingReadController` (S11/S36).

```java
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class BookingReadController {

    private final AuthService authService;  // ← réutilisé S34
    private final BookingReadService bookingService;

    @GetMapping({"/bookings/me", "/users/me/bookings"})  // alias dual
    public List<BookingMeDto> myBookings(HttpServletRequest req) {
        User user = authService.requireAuth(req);
        return bookingService.findMyBookings(user.userId());
    }

    @GetMapping({"/bookings/received", "/receiver/requests"})  // alias dual
    public List<BookingReceivedDto> receivedBookings(HttpServletRequest req) {
        User user = authService.requireAuth(req);
        return bookingService.findReceivedBookings(user.userId());
    }

    @GetMapping("/bookings/{bookingId}")
    public BookingDetailDto getBookingDetail(@PathVariable String bookingId,
                                              HttpServletRequest req) {
        User user = authService.requireAuth(req);
        return bookingService.findByIdWithPermissions(bookingId, user);
    }
}
```

### 3. Permissions 4-OR sur `/{id}` (BR-36.04)

```java
public BookingDetailDto findByIdWithPermissions(String bookingId, User user) {
    BookingDetailDto b = repo.findDetailById(bookingId)
        .orElseThrow(() -> new NotFoundException("Réservation introuvable"));

    Set<String> allowed = new HashSet<>();
    if (b.userId() != null)         allowed.add(b.userId());
    if (b.payerUserId() != null)    allowed.add(b.payerUserId());
    if (b.receiverUserId() != null) allowed.add(b.receiverUserId());
    if (b.coachId() != null)        allowed.add(b.coachId());

    if (!allowed.contains(user.userId()) && !"admin".equals(user.role())) {
        throw new ForbiddenException("Accès refusé");
    }
    return deserialize(b);
}
```

> ⚠️ **NE PAS** simplifier en `@PreAuthorize`. Logique applicative explicite (compat S11/S34).

### 4. Native queries avec COALESCE legacy (BR-36.09)

```java
@Query(value = """
    SELECT
        b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
        b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
        b.payment_status, b.payer_user_id, b.receiver_user_id,
        b.pricing_snapshot, b.idempotency_key, b.currency,
        b.created_at, b.updated_at, b.expires_at,
        b.cancelled_by_user_id, b.cancellation_reason,
        b.payment_mode,
        s.title AS service_title, s.address,
        u_recv.name AS receiver_name, u_recv.picture AS receiver_picture,
        sl.start_time AS slot_start_time, sl.end_time AS slot_end_time,
        sl.slot_date, sl.slot_type
      FROM bookings b
      LEFT JOIN services s ON s.service_id = b.service_id
      LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
      LEFT JOIN service_slots sl ON sl.slot_id = b.slot_id
     WHERE b.user_id = :uid
     ORDER BY b.created_at DESC
""", nativeQuery = true)
List<BookingMeDto> findMyBookings(@Param("uid") String userId);
```

> ⚠️ **3 native queries distinctes** (une par endpoint). Ne pas factoriser : projections différentes.

### 5. Désérialisation `pricing_snapshot` silencieuse (BR-36.08)

```java
private BookingDetailDto deserialize(BookingDetailDto b) {
    Object snap = b.pricingSnapshot();
    if (snap instanceof String s && !s.isEmpty()) {
        try {
            Object parsed = objectMapper.readValue(s, Object.class);
            return b.withPricingSnapshot(parsed);  // record copy
        } catch (IOException ignored) {
            // garde la string si parse échoue (compat Python)
        }
    }
    return b;
}
```

---

## Régressions à valider après ports précédents

### R1 — Vérifier que `bookings.payment_status` reflète l'état post-S33

Si l'on observe que `/api/bookings/me` retourne toujours `payment_status='unpaid'` alors que le webhook S33 a bien tourné :
- Vérifier que **MVCC PostgreSQL** est correctement configuré (default `READ COMMITTED` OK)
- Vérifier que le `@Transactional(readOnly=true)` Spring n'utilise pas un snapshot trop ancien
- Tester avec un `@Transactional(isolation=READ_COMMITTED)` explicite

### R2 — Aucun JOIN sur `payments`

Audit du code Java :
```bash
grep -rn "JOIN payments" src/main/java/com/spotu/booking/
```

→ Doit retourner **vide**. Si non vide → casser la compat → **retirer** le JOIN.

### R3 — Aliases routing testés en CI

Exécuter T36-18 et T36-19 (aliases identiques au principal).

### R4 — Datetime `+00:00` validé sur tous les champs date

Champs concernés :
- `created_at`, `updated_at`, `expires_at`, `scheduled_at` → TIMESTAMPTZ → `OffsetDateTime`
- `slot_date` → DATE → `LocalDate` (format `2026-04-20`)
- `slot_start_time`, `slot_end_time` → TIME → `LocalTime` (format `HH:MM:SS`)

> ⚠️ Configurer Jackson pour `LocalDate`/`LocalTime` séparément si nécessaire.

---

## Pièges à éviter

| # | Piège | Mitigation |
|---|---|---|
| 1 | Implémenter de nouveau les 3 endpoints sans relire S11 | Lire S11 d'abord ; ne pas duplique |
| 2 | Ajouter un JOIN `payments` "pour optimiser" | NON (BR-36.10). Compat stricte. |
| 3 | Permissions 3-OR (oubli de `coach_id` ou `user_id`) | 4-OR strict (BR-36.04) |
| 4 | Uniformiser les 3 projections | NON (BR-36.07). 3 DTOs distincts. |
| 5 | Oublier les aliases dual routing | 2 paths sur méthode (BR-36.06) |
| 6 | Désérialisation `pricing_snapshot` qui throw si JSON malformé | Try/catch silent (BR-36.08) |
| 7 | INNER JOIN au lieu de LEFT JOIN | LEFT obligatoire |
| 8 | Format datetime `Z` au lieu de `+00:00` | Configurer Jackson |
| 9 | Pagination ajoutée | NON. Compat stricte (idem S34/BR-34.05) |
| 10 | Filtre par `status` query param | NON. Compat stricte. |
| 11 | Wrapper `{data:[]}` au lieu de `[]` | Liste directe |
| 12 | Cache HTTP shared | NON. User-scope. |

---

## Critères de Done S36

| # | Critère | Test |
|---|---|---|
| 1 | Si S11 non implémenté : suivre S11 puis revenir | check `BookingReadController` exists |
| 2 | Si S11 implémenté : appliquer régressions T36 | T36-01 à T36-20 passent |
| 3 | Booking créé en S30 visible immédiatement | T36-01 |
| 4 | `payment_status='paid'` post-S33 visible | T36-07 |
| 5 | `bookings.status` inchangé après S35 refund | T36-11 |
| 6 | Pas de `refund_amount` dans la réponse | T36-11 (assertion `doesNotContain`) |
| 7 | Aliases dual fonctionnent | T36-18, T36-19 |
| 8 | Permissions 4-OR validées (coach_id, user_id) | T36-14, T36-15 |
| 9 | Datetime `+00:00` | R4 |
| 10 | Liste vide = `[]` | T36-20 |

---

## Roadmap S36 → S37 → S38+

| Slice | Contenu | Type |
|---|---|---|
| **S36 (cette slice)** | Audit + régressions booking reads | Doc only — pas de nouveau code |
| **S37** | `POST /bookings/price-preview` | Endpoint preview pricing |
| **S38** | `POST /bookings/request` (création) | Gros : Stripe + slot locks + workers |
| **S39** | `POST /bookings/{id}/cancel` | Cancel + refunds + notifs push |
| **S40** | `POST /bookings/{id}/refuse` | Petit |
| **S41** | `POST /bookings/{id}/accept` | Stripe payment intent |
| **S42** | `PATCH /bookings/{id}/status` | Admin |

> **Recommandation** : si l'objectif est cutover front, prioriser **S37 (preview pricing)** puis **S39 (cancel)** car ce sont des actions courantes du buyer. **S38 (request)** est le plus gros mais aussi le plus critique.
