# SLICE_14_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation pour Cursor
> Slice 14 : `POST /api/bookings/{bookingId}/complete`
> Source Python : `booking_routes.py:984–1028` (branche `elif new_status == "completed"`).
> Généré le 2026-02-XX.

---

## Architecture recommandée

```
BookingCompleteController
  └─ BookingCompleteService.completeBooking(bookingId, userId, userRole)
       └─ BookingCompleteRepository
            ├─ findReceiverById(bookingId)       → SELECT receiver_user_id
            ├─ markCompleted(conn, bookingId)     → UPDATE bookings
            ├─ markSlotCompleted(conn, bookingId) → UPDATE service_slots (via subquery)
            └─ capturePaymentIfAuthorized(conn, bookingId) → UPDATE payments
```

---

## Controller

### Fichier suggéré

`BookingCompleteController.java` (ou ajouter dans `BookingWriteController.java` avec `/refuse` et `/accept`)

### Endpoint

```java
@PostMapping("/bookings/{bookingId}/complete")
@ResponseStatus(HttpStatus.OK)
public ResponseEntity<Map<String, Object>> completeBooking(
    @PathVariable String bookingId,
    HttpServletRequest request) {

    // 1. Extraire l'utilisateur depuis le token JWT
    AuthUser user = authService.requireAuth(request);  // 401 si absent

    // 2. Appeler le service
    return ResponseEntity.ok(bookingCompleteService.completeBooking(bookingId, user));
}
```

---

## Service

### Fichier suggéré

`BookingCompleteService.java`

### Logique

```java
@Service
public class BookingCompleteService {

    @Autowired
    private BookingCompleteRepository repository;

    @Transactional
    public Map<String, Object> completeBooking(String bookingId, AuthUser user) {

        // ── Étape 1 : Lecture pour contrôle d'accès ────────────────────────
        String receiverUserId = repository.findReceiverById(bookingId);
        if (receiverUserId == null) {
            throw new NotFoundException("Réservation introuvable");  // HTTP 404
        }

        boolean isReceiver = receiverUserId.equals(user.getUserId());
        boolean isAdmin    = "admin".equals(user.getRole());

        if (!isReceiver && !isAdmin) {
            throw new ForbiddenException(  // HTTP 403
                "Seul le bénéficiaire peut marquer comme terminé");
        }

        // ── Étape 2 : Transaction atomique ─────────────────────────────────
        // (géré par @Transactional)
        repository.markCompleted(bookingId);
        repository.markSlotCompleted(bookingId);
        repository.capturePaymentIfAuthorized(bookingId);

        // ── Étape 3 : Réponse ──────────────────────────────────────────────
        // ⚠️ Pas de re-fetch DB — réponse hardcodée comme en Python
        return Map.of(
            "success",    true,
            "status",     "completed",
            "booking_id", bookingId
        );
    }
}
```

> ⚠️ **Pas de validation du statut courant** (BR-03) : ne pas ajouter `if (!currentStatus.equals("accepted"))` sans discussion préalable. Comportement Python : aucune garde.

> ⚠️ **Pas de push notification** (BR-07) : ne pas appeler le push service.

> ⚠️ **`@Transactional` englobe les 3 UPDATEs** mais PAS la lecture préalable (hors transaction).

---

## Repository

### Fichier suggéré

`BookingCompleteRepository.java`

### Méthodes

#### `findReceiverById`

```java
// booking_routes.py:1003–1004
// SELECT receiver_user_id FROM bookings WHERE booking_id = $1
String findReceiverById(String bookingId);
// Retourne null si non trouvé (→ 404 dans le service)
```

#### `markCompleted`

```java
// booking_routes.py:1010–1013
// UPDATE bookings SET status='completed', updated_at=NOW() WHERE booking_id=$1
@Modifying
@Query("""
    UPDATE bookings
    SET status = 'completed',
        updated_at = NOW()
    WHERE booking_id = :bookingId
    """)
void markCompleted(@Param("bookingId") String bookingId);
```

#### `markSlotCompleted`

```java
// booking_routes.py:1014–1018
// ⚠️ Sous-requête corrélée — reproduire exactement le comportement NULL
@Modifying
@Query("""
    UPDATE service_slots
    SET slot_status = 'completed'
    WHERE slot_id = (
        SELECT slot_id FROM bookings WHERE booking_id = :bookingId
    )
    AND slot_status = 'booked'
    """, nativeQuery = true)
void markSlotCompleted(@Param("bookingId") String bookingId);
// 0 lignes affectées si slot_id IS NULL → comportement normal, pas d'exception
```

#### `capturePaymentIfAuthorized`

```java
// booking_routes.py:1019–1022
// ⚠️ DB-only — AUCUN appel Stripe
@Modifying
@Query("""
    UPDATE payments
    SET status = 'captured',
        updated_at = NOW()
    WHERE booking_id = :bookingId
      AND status = 'authorized'
    """, nativeQuery = true)
void capturePaymentIfAuthorized(@Param("bookingId") String bookingId);
// 0 lignes affectées si non-authorized → comportement normal, pas d'exception
```

---

## Transaction

| Opération | Dans la transaction | Raison |
|---|---|---|
| `findReceiverById` (SELECT) | NON | Lecture seule, avant décision |
| `markCompleted` (UPDATE bookings) | OUI | |
| `markSlotCompleted` (UPDATE service_slots) | OUI | Atomique avec booking |
| `capturePaymentIfAuthorized` (UPDATE payments) | OUI | Atomique avec booking |
| Push notification | NON APPLICABLE | Absent du code Python |
| Stripe | NON APPLICABLE | Absent du code Python |

---

## Validation des erreurs

| Cas | Action |
|---|---|
| `booking_id` manquant ou vide | 400 (validation Spring automatique) |
| Booking non trouvé (`findReceiverById` → null) | 404 — `NotFoundException` |
| Ni receiver ni admin | 403 — `ForbiddenException` |
| Token absent | 401 — `UnauthorizedException` (via `authService.requireAuth`) |
| DB error | 500 — laisser propager |

---

## Points d'attention spécifiques à Java/Spring

### 1. Sous-requête corrélée et comportement NULL

```java
// En JDBC natif, la sous-requête retourne NULL si slot_id IS NULL dans bookings.
// Spring Data @Modifying avec nativeQuery=true reproduit ce comportement correctement.
// NE PAS ajouter de guard Java "if (slotId != null)" — cela sortirait du comportement Python.
```

### 2. @Transactional propagation

```java
// Utiliser @Transactional(propagation = Propagation.REQUIRED) par défaut.
// Toutes les opérations de la transaction partagent la même connexion DB.
// Si une exception est levée dans markSlotCompleted ou capturePaymentIfAuthorized,
// le rollback doit annuler AUSSI le markCompleted.
```

### 3. Pas d'early return pour idempotence

```java
// Python n'a pas de :
// if (currentStatus.equals("completed")) return earlyResponse;
// Java peut choisir d'en ajouter un (avec "idempotent": true), mais ce sera une divergence.
// Si ajouté, documenter dans KNOWN_GAPS_VS_PYTHON.md.
```

### 4. Réponse sans re-fetch DB

```java
// Python retourne directement {"success": true, "status": "completed"} sans SELECT post-UPDATE.
// Java peut faire pareil. Pas besoin de re-lire le booking après les UPDATEs.
```

---

## Critères de done (Definition of Done)

| # | Critère | Test |
|---|---|---|
| D1 | `POST /bookings/{id}/complete` fonctionne pour receiver | TC-01 |
| D2 | `POST /bookings/{id}/complete` fonctionne pour admin | TC-02 |
| D3 | 403 si payer essaie | TC-07 |
| D4 | 403 si tiers | TC-08 |
| D5 | 401 si token absent | TC-09 |
| D6 | 404 si booking inexistant | TC-11 |
| D7 | slot_id NULL → pas d'erreur | TC-03 |
| D8 | payment authorized → captured en DB (pas Stripe) | TC-01, TC-05 |
| D9 | Aucune push notification générée | TC-16 |
| D10 | Double appel → 200+200 (idempotence implicite) | TC-15 |
| D11 | Statut 'refused' → complete sans 409 (compat Python) | TC-12 |
| D12 | Transaction rollback si erreur DB | (test d'injection d'erreur) |

---

## Fichiers Java à créer / modifier

| Fichier | Action | Contenu |
|---|---|---|
| `BookingCompleteController.java` | CRÉER | Controller POST /complete |
| `BookingCompleteService.java` | CRÉER | Logique métier + @Transactional |
| `BookingCompleteRepository.java` | CRÉER (ou étendre BookingRepository) | 4 méthodes SQL |
| `BookingController.java` (si existant) | MODIFIER | Ajouter mapping `/complete` |
| `BookingRoutes.java` (routing config) | MODIFIER | Enregistrer la route |

---

## Relation avec les Slices précédentes

| Slice | Endpoint | Acteur | Stripe | Push | Guard statut |
|---|---|---|---|---|---|
| S12 | `/refuse` | Receiver seulement | Stub cancel (hors transaction) | OUI (payer) | OUI (`requested` uniquement) |
| S13 | `/accept` | Receiver OU admin | Stub capture (Cas A) | OUI (payer) | OUI (`requested` + idempotence) |
| **S14** | `/complete` | **Receiver OU admin** | **AUCUN** | **NON** | **NON** |

`/complete` est la slice la plus simple du domaine booking write — utiliser comme template
de référence pour tester l'infrastructure Java avant d'attaquer `/cancel` (plus complexe).
