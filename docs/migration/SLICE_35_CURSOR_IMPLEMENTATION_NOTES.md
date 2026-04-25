# SLICE_35_CURSOR_IMPLEMENTATION_NOTES.md — Notes Java/Spring Boot Webhook Charge/Refund Handlers
> Basé sur `webhook_handlers.py:458–582, 973–976, 1013–1015`, BR-35.01 à BR-35.15.
> Généré le 2026-04-25.
>
> ⚠️ **Reproduire 1:1 le comportement Python.** Pas d'UPDATE bookings. Pas de notif sur `refund.updated`. Format `.2f` Locale-independent (point décimal).

---

## 1. Structure Spring Boot (extension de S32-S33)

```
src/main/java/com/spotu/webhook/
├── service/
│   ├── WebhookDispatcherService.java         ← (S32-S33) — modifié pour activer charge branch
│   └── handlers/
│       └── ChargeEventHandler.java           ← NEW : 2 branches charge.refunded + refund.updated
├── repository/
│   └── PaymentRepository.java                ← étendu (méthodes refund-specific)
└── dto/
    └── PendingNotif.java                     ← réutilisé S33
```

---

## 2. Activation dans le Dispatcher (modif de S32-S33)

```java
// WebhookDispatcherService.dispatch — modif S35
public Map<String, Object> dispatch(String eventId, String eventType, Object obj) {
    String relatedId = null;
    List<PendingNotif> pendingNotifs = new ArrayList<>();

    boolean isNew = claimEventNewTx(eventId, eventType);
    if (!isNew) { ... return idempotent_skip ... }

    ResolvedPayment resolved = paymentResolver.resolve(eventType, obj);
    String paymentId = resolved.paymentId();
    String bookingId = resolved.bookingId();
    relatedId = paymentId;

    try {
        // ── S35 — Activation branche charge
        if (ChargeEventHandler.CHARGE_EVENTS.contains(eventType)) {
            chargeHandler.handle(eventType, obj, paymentId, pendingNotifs);
            relatedId = paymentId;  // peut être mis à jour par chargeHandler si lookup local
        }

        // S33 — branche payment (déjà activée)
        if (PaymentEventHandler.PAYMENT_EVENTS.contains(eventType)) { ... }

        // S36+ : subscription branch

        repo.markDone(eventId, "success", relatedId, null);
    } catch (Exception exc) { ... }

    // Notifs hors transaction (compat S32)
    for (PendingNotif notif : pendingNotifs) { ... }

    return Map.of("received", true);
}
```

---

## 3. ChargeEventHandler

```java
@Component
@RequiredArgsConstructor
public class ChargeEventHandler {

    public static final Set<String> CHARGE_EVENTS = Set.of(
        "charge.refunded",
        "refund.updated"
    );

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final BigDecimal TOLERANCE = new BigDecimal("0.02");

    private final PaymentRepository paymentRepo;
    private static final Logger log = LoggerFactory.getLogger(ChargeEventHandler.class);

    @SuppressWarnings("unchecked")
    public void handle(String eventType, Object obj, String paymentId,
                       List<PendingNotif> pendingNotifs) {
        Map<String,Object> map = (Map<String,Object>) obj;

        switch (eventType) {
            case "charge.refunded" -> handleChargeRefunded(map, paymentId, pendingNotifs);
            case "refund.updated"  -> handleRefundUpdated(map, paymentId);
        }
    }

    // ── charge.refunded
    private void handleChargeRefunded(Map<String,Object> obj, String paymentId,
                                      List<PendingNotif> pendingNotifs) {
        // Fallback lookup local par charge_id si payment_id non résolu (BR-35.05)
        if (paymentId == null) {
            String chargeId = (String) obj.get("id");
            if (chargeId != null) {
                Optional<String> resolved = paymentRepo.findPaymentIdByChargeId(chargeId);
                if (resolved.isPresent()) {
                    paymentId = resolved.get();
                }
            }
            if (paymentId == null) {
                log.debug("charge.refunded : payment_id introuvable (charge={})", obj.get("id"));
                return;
            }
        }

        // Extraction
        long centsLong = ((Number) obj.getOrDefault("amount_refunded", 0)).longValue();
        BigDecimal amountRefunded = BigDecimal.valueOf(centsLong)
            .divide(HUNDRED, 2, RoundingMode.HALF_UP);
        boolean fullyRefunded = Boolean.TRUE.equals(obj.get("refunded"));
        String chargeId = (String) obj.get("id");

        String newStatus    = fullyRefunded ? "refunded" : "partially_refunded";
        String refundStatus = "succeeded";

        // UPDATE
        int rows = paymentRepo.markRefunded(
            newStatus, amountRefunded, refundStatus, chargeId, paymentId
        );

        log.info("Remboursement : payment={} | amount={}€ | full={} → status={}",
                 paymentId,
                 String.format(Locale.ROOT, "%.2f", amountRefunded),
                 fullyRefunded ? "True" : "False",  // compat capitalisation Python
                 newStatus);

        // Notif (BR-35.06)
        if (rows > 0) {
            paymentRepo.findPayerUserId(paymentId).ifPresent(payerId -> {
                String amountFmt = String.format(Locale.ROOT, "%.2f", amountRefunded);
                String title = fullyRefunded ? "Remboursement effectué" : "Remboursement partiel";
                String body  = fullyRefunded
                    ? "Vous avez été remboursé de " + amountFmt + " €."
                    : "Un remboursement partiel de " + amountFmt + " € a été initié.";

                Map<String,Object> data = new LinkedHashMap<>();
                data.put("type", "payment_refunded");
                data.put("payment_id", paymentId);
                data.put("refund_amount", amountRefunded);
                data.put("fully_refunded", fullyRefunded);

                pendingNotifs.add(new PendingNotif(payerId, "payment_refunded", title, body, data));
            });
        }
    }

    // ── refund.updated (Phase 1 + Phase 2)
    private void handleRefundUpdated(Map<String,Object> obj, String paymentId) {
        String refundId     = (String) obj.get("id");
        String refundStatus = (String) obj.getOrDefault("status", "");
        String chargeId     = (String) obj.get("charge");
        long centsLong      = ((Number) obj.getOrDefault("amount", 0)).longValue();
        BigDecimal amount   = BigDecimal.valueOf(centsLong).divide(HUNDRED, 2, RoundingMode.HALF_UP);

        // ── Phase 1 : edge case full-refund early return (BR-35.08)
        if (paymentId == null && chargeId != null) {
            Optional<RefundLookupRow> row = paymentRepo.findByChargeIdWithTotal(chargeId);
            if (row.isPresent()) {
                paymentId = row.get().paymentId();
                BigDecimal total = row.get().payerTotalAmount() != null
                    ? row.get().payerTotalAmount()
                    : BigDecimal.ZERO;

                if ("succeeded".equals(refundStatus)
                    && amount.subtract(total).abs().compareTo(TOLERANCE) < 0) {
                    paymentRepo.markFullRefundEdgeCase(refundStatus, amount, paymentId);
                    log.info("refund.updated → remboursement complet confirmé : refund={} | payment={}",
                             refundId, paymentId);
                    return;  // EARLY RETURN
                }
            }
        }

        // ── Phase 2 : sync simple (BR-35.09)
        if (paymentId != null) {
            paymentRepo.updateRefundStatus(refundStatus, paymentId);
            log.info("refund.updated : refund={} | status={} | payment={}",
                     refundId, refundStatus, paymentId);
        } else {
            log.debug("refund.updated : payment introuvable (refund={} charge={})",
                      refundId, chargeId);
        }
        // PAS de notification (BR-35.10)
    }
}
```

> ⚠️ **Format `True`/`False` Python** : SLF4J `{}` avec un boolean Java produit `true`/`false`. Pour reproduire `True`/`False`, **convertir manuellement** au log statement (`fullyRefunded ? "True" : "False"`).

---

## 4. PaymentRepository — méthodes ajoutées en S35

```java
@Repository
public interface PaymentRepository {

    // ── (méthodes S33 existantes : markCaptured, findUserPair, etc.)

    // ── S35 : lookup
    @Query(value = "SELECT payment_id FROM payments WHERE stripe_charge_id=:ch LIMIT 1",
           nativeQuery = true)
    Optional<String> findPaymentIdByChargeId(@Param("ch") String chargeId);

    @Query(value = """
        SELECT payment_id, payer_total_amount
          FROM payments
         WHERE stripe_charge_id=:ch
         LIMIT 1
    """, nativeQuery = true)
    Optional<RefundLookupRow> findByChargeIdWithTotal(@Param("ch") String chargeId);

    @Query(value = "SELECT payer_user_id FROM payments WHERE payment_id=:id",
           nativeQuery = true)
    Optional<String> findPayerUserId(@Param("id") String paymentId);

    // ── S35 : transitions refund
    @Modifying
    @Query(value = """
        UPDATE payments
           SET status=:status,
               refund_amount=:amount,
               refund_status=:refundStatus,
               stripe_charge_id=COALESCE(stripe_charge_id, :chargeId),
               updated_at=NOW()
         WHERE payment_id=:paymentId
           AND status NOT IN ('refunded')
    """, nativeQuery = true)
    int markRefunded(@Param("status") String status,
                     @Param("amount") BigDecimal amount,
                     @Param("refundStatus") String refundStatus,
                     @Param("chargeId") String chargeId,
                     @Param("paymentId") String paymentId);

    @Modifying
    @Query(value = """
        UPDATE payments
           SET refund_status=:refundStatus,
               refund_amount=:amount,
               status='refunded',
               updated_at=NOW()
         WHERE payment_id=:paymentId
           AND status != 'refunded'
    """, nativeQuery = true)
    int markFullRefundEdgeCase(@Param("refundStatus") String refundStatus,
                                @Param("amount") BigDecimal amount,
                                @Param("paymentId") String paymentId);

    @Modifying
    @Query(value = """
        UPDATE payments
           SET refund_status=:refundStatus,
               updated_at=NOW()
         WHERE payment_id=:paymentId
    """, nativeQuery = true)
    int updateRefundStatus(@Param("refundStatus") String refundStatus,
                            @Param("paymentId") String paymentId);
}

public record RefundLookupRow(String paymentId, BigDecimal payerTotalAmount) {}
```

> ⚠️ **3 méthodes UPDATE distinctes**, chacune avec son guard exact (BR-35.04, BR-35.08, BR-35.09).

---

## 5. Erreurs et exceptions

### Exceptions internes au handler
- Toute exception remonte au dispatcher S32 → `markDone(error)` + 200.
- Ne **PAS** catcher localement.

### Cas `payment_id` null après tous les fallbacks
- log DEBUG + return silent. Pas d'exception.

---

## 6. Transactionnalité

| Branche | `@Transactional` |
|---|---|
| `charge.refunded` | NON requis (1 UPDATE) — optionnel |
| `refund.updated` Phase 1 | NON requis |
| `refund.updated` Phase 2 | NON requis |

> Approche simple : **pas de `@Transactional`** sur le handler S35. Spring gère chaque UPDATE en autocommit.

> Si vous voulez `@Transactional` global (cohérence avec S33), c'est sans risque mais inutile.

---

## 7. Configuration logs

```yaml
logging:
  level:
    com.spotu.webhook.service.handlers.ChargeEventHandler: INFO
```

> ⚠️ Niveau DEBUG nécessaire pour voir les logs `payment introuvable`. En prod, INFO est suffisant.

---

## 8. Pièges à éviter

| # | Piège | Mitigation |
|---|---|---|
| 1 | `cents / 100` en int → 51 au lieu de 51.75 | `BigDecimal.divide(100, 2, HALF_UP)` (BR-35.03) |
| 2 | Comparer `amount_refunded == amount` pour détecter full | Utiliser le boolean `obj.refunded` (BR-35.02) |
| 3 | Format `Locale.FRANCE` `%.2f` produit `51,75` (virgule) | `Locale.ROOT` (BR-35.06) |
| 4 | Émettre une notif sur `refund.updated` "par cohérence" | NON (BR-35.10) |
| 5 | Émettre une notif au receiver | NON (payer seulement) |
| 6 | Mettre à jour `bookings.status` après refund | NON (BR-35.12) |
| 7 | Écraser `stripe_charge_id` existant | COALESCE obligatoire (BR-35.04) |
| 8 | Utiliser `<= 0.02` au lieu de `< 0.02` | Strict `<` (BR-35.08, T35-16) |
| 9 | Filtrer par `startsWith("ch_")` dans le fallback local | NON, asymétrie volontaire vs resolver S33 (BR-35.05) |
| 10 | Mettre à jour `status` dans `refund.updated` Phase 2 | NON, refund_status uniquement (BR-35.09) |
| 11 | Ajouter guard sur Phase 2 UPDATE | NON, sans guard (BR-35.09) |
| 12 | Utiliser `Optional<RefundLookupRow>` mais oublier de gérer `payerTotalAmount == null` | `null or BigDecimal.ZERO` fallback |
| 13 | Ne pas tester le path Phase 1 → Phase 2 (fallthrough) | Test T35-14 obligatoire |
| 14 | Logger `True`/`False` Java (true/false) au lieu de Python (`True`/`False`) | Capitalize manuellement au log statement |
| 15 | Ajouter `payer_id`/`receiver_id` dans `data` notif | NON, structure exacte BR-35.07 |
| 16 | Ajouter `booking_id` dans `data` notif | NON, asymétrie vs S33 (BR-35.07) |

---

## 9. Critères de Done

| # | Critère | Test |
|---|---|---|
| 1 | `_CHARGE_EVENTS` set EXACTEMENT 2 events | T35-26 |
| 2 | `charge.refunded` full → status=refunded + refund_amount + notif "effectué" | T35-01 |
| 3 | `charge.refunded` partial → status=partially_refunded + notif "partiel" | T35-02 |
| 4 | COALESCE préserve `stripe_charge_id` existant | T35-01 + T35-R1 |
| 5 | COALESCE set `stripe_charge_id` si null | T35-03 |
| 6 | Fallback local lookup par charge_id sans startsWith | T35-04 |
| 7 | Resolution échouée → log DEBUG + skip | T35-05 |
| 8 | Format `.2f` Locale-independent (point décimal) | T35-06 |
| 9 | `refund.updated` sync simple `refund_status` (Phase 2) | T35-09 à T35-12 |
| 10 | `refund.updated` Phase 1 edge full-refund + early return | T35-13 |
| 11 | Phase 1 → Phase 2 fallthrough si conditions partielles | T35-14 |
| 12 | Tolerance 0.02 strict (pas 0.019, pas 0.020) | T35-15, T35-16 |
| 13 | `refund.updated` AUCUNE notif | T35-09 + T35-13 |
| 14 | Idempotence event-level S32 | T35-20 |
| 15 | Idempotence handler-level (rows=0 si déjà refunded) | T35-21 |
| 16 | Trou fonctionnel cas inverse documenté | T35-23 |
| 17 | Pas d'UPDATE bookings | T35-30 |
| 18 | Logs format `|` séparateur + `€` Unicode | T35-29 |
| 19 | `data` notif exact (sans booking_id) | T35-28 |
| 20 | Régression S33 : stripe_charge_id préservé | T35-R1 |
| 21 | Régression S34 : `/payments/{id}` montre refund_amount | T35-R2 |
| 22 | Régression S32 : signature invalide bloque | T35-R3 |

---

## 10. Validation finale

- [ ] 30 cas T35 passent
- [ ] Régression S33 : flow PI succeeded → charge.refunded fonctionne bout-en-bout
- [ ] Régression S34 : `/payments/me` et `/{id}` affichent les statuts refund correctement
- [ ] Test charset UTF-8 (`€` symbol, accents dans body)
- [ ] Test concurrence `charge.refunded` + `refund.updated` quasi-simultanés
- [ ] Test Phase 1 / Phase 2 fallthrough
- [ ] Test Locale-independence (forcer `Locale.FRANCE` au runtime, vérifier `.` décimal)
- [ ] Stripe Dashboard webhook test → simuler refund → 200 + DB updated

---

## 11. Roadmap S35 → S36 → futur

| Slice | Contenu | Modification de S35 |
|---|---|---|
| **S35 (cette slice)** | Charge events refunds | — |
| **S36 (futur)** | Subscriptions (`_SUBSCRIPTION_EVENTS` + `_handle_subscription_event`) | Aucun changement S35 |
| **S37 (futur)** | Booking reads (`/bookings/me`, `/bookings/{id}`) | — |
| **S38+** | Disputes Stripe (s'ils sont ajoutés au backend Python — pas dans le scope S35) | extensible |

> **L'API S35 (ChargeEventHandler) ne devrait JAMAIS être modifiée par S36+** sauf bug. Contrat de stabilité.

---

## 12. Notes Stripe-spécifiques

### Différence `charge.refunded` vs `refund.updated`
- `charge.refunded` est **toujours** émis quand un refund est exécuté côté Stripe (création + statut succeeded)
- `refund.updated` peut être émis :
  - Avant `charge.refunded` (rare, mais possible avec capture asynchrone)
  - Après `charge.refunded` (sync de statut si le refund passe par des phases pending → succeeded)
  - Pour des `refund.status='failed'` ou `'canceled'` (refund rejeté par la banque)

### Tester avec Stripe CLI

```bash
stripe trigger charge.refunded
stripe trigger refund.updated
```

> ⚠️ Stripe CLI n'envoie pas toujours les `metadata` custom. **Tester manuellement avec un payload contenant metadata.payment_id** pour valider le path nominal.
