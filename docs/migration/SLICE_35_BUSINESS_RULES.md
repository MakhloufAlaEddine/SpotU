# SLICE_35_BUSINESS_RULES.md — Règles métier Webhook Charge/Refund Handlers
> Basé sur `webhook_handlers.py:458–582, 973–976, 1013–1015`.
> Généré le 2026-04-25.

---

## BR-35.01 — Set `_CHARGE_EVENTS` exact (2 events)

### Règle (lignes 973–976)

```python
_CHARGE_EVENTS = frozenset({
    "charge.refunded",
    "refund.updated",
})
```

### Java
```java
public static final Set<String> CHARGE_EVENTS = Set.of(
    "charge.refunded",
    "refund.updated"
);
```

> ⚠️ Pas de `charge.dispute.*`, pas de `payment_intent.refunded`. **Compat stricte.**

---

## BR-35.02 — `charge.refunded` : full vs partial via boolean `refunded`

### Règle (lignes 492–495)

```python
fully_refunded = bool(_get(obj, "refunded", False))
new_status     = "refunded" if fully_refunded else "partially_refunded"
```

### Java
```java
boolean fullyRefunded = Boolean.TRUE.equals(obj.get("refunded"));
String newStatus = fullyRefunded ? "refunded" : "partially_refunded";
```

> ⚠️ **NE PAS** comparer `amount_refunded == amount` pour détecter full. Toujours utiliser le boolean Stripe.

---

## BR-35.03 — Conversion centimes → euros (round 2)

### Règle (ligne 491)

```python
amount_refunded = round(amount_refunded_cents / 100, 2)
```

### Java
```java
BigDecimal amountRefunded = BigDecimal.valueOf(centsLong)
    .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
```

> ⚠️ Ne **JAMAIS** faire `cents / 100` en int. La précision est critique pour les notifs ("vous avez été remboursé de 51.75 €" vs "51.00 €").

### Cas spécial 0
Si `amount_refunded` absent → default 0 → `BigDecimal.valueOf(0).divide(100, 2)` = `0.00`. Notif émise avec montant 0.00 (rare mais possible).

---

## BR-35.04 — `charge.refunded` UPDATE avec COALESCE

### Règle (lignes 498–509)

```sql
UPDATE payments
   SET status=$1,
       refund_amount=$2,
       refund_status=$3,
       stripe_charge_id=COALESCE(stripe_charge_id, $4),
       updated_at=NOW()
 WHERE payment_id=$5
   AND status NOT IN ('refunded')
```

### Pourquoi COALESCE
Le `stripe_charge_id` peut déjà être set par S33 (`payment_intent.succeeded`). On ne veut pas l'écraser si présent. Le COALESCE garantit qu'on ne le set que s'il est null.

### Java (native query)
```java
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
int markRefunded(@Param("status") String status, ...);
```

---

## BR-35.05 — `charge.refunded` : lookup fallback par charge_id

### Règle (lignes 476–488)

```python
if not payment_id:
    charge_id = _get(obj, "id")
    if charge_id:
        row = await conn.fetchrow(
            "SELECT payment_id FROM payments WHERE stripe_charge_id=$1 LIMIT 1",
            charge_id,
        )
        if row:
            payment_id = row["payment_id"]
    if not payment_id:
        log.debug("charge.refunded : payment_id introuvable (charge=%s)", _get(obj, "id"))
        return
```

### Notes
- Cette logique **duplique** la stratégie 4 de `_resolve_payment_id` (déjà portée en S33).
- Le code Python le refait **localement** dans `_handle_charge_event` comme **fallback de sécurité**.
- **Question** : doit-on le reproduire en Java ou se reposer uniquement sur le resolver S33 ?

### Recommandation
**Reproduire localement** (compat stricte). Cas où c'est utile :
- `obj.id` ne commence pas par `"ch_"` (le resolver S33 strat. 4 filtre par `startsWith("ch_")` ; le fallback local n'a pas ce filtre — accepte n'importe quel id).
- Si Stripe envoie un format alternatif → le fallback rattrape.

> ⚠️ **Asymétrie subtile** : le fallback local **n'utilise pas** `startsWith("ch_")`. Le resolver S33 oui. **Reproduire** sans le startsWith dans le fallback local.

---

## BR-35.06 — `charge.refunded` notification UNIQUEMENT si `rows_updated > 0`

### Règle (lignes 514–536)

```python
if _rows(res) > 0:
    row = await conn.fetchrow("SELECT payer_user_id FROM payments WHERE payment_id=$1", payment_id)
    if row:
        if fully_refunded:
            title = "Remboursement effectué"
            body  = f"Vous avez été remboursé de {amount_refunded:.2f} €."
        else:
            title = "Remboursement partiel"
            body  = f"Un remboursement partiel de {amount_refunded:.2f} € a été initié."
        pending_notifs.append({...})
```

### Java
```java
int rows = paymentRepo.markRefunded(...);
if (rows > 0) {
    String payerId = paymentRepo.findPayerUserId(paymentId).orElse(null);
    if (payerId != null) {
        String title, body;
        String amountFmt = String.format(Locale.FRANCE, "%.2f", amountRefunded);  // virgule décimale FR ?
        // ⚠️ Python utilise format `:.2f` qui produit toujours un POINT décimal (locale-independent)
        // Donc Java doit utiliser Locale.US ou Locale.ROOT pour reproduire
        amountFmt = String.format(Locale.ROOT, "%.2f", amountRefunded);
        if (fullyRefunded) {
            title = "Remboursement effectué";
            body  = "Vous avez été remboursé de " + amountFmt + " €.";
        } else {
            title = "Remboursement partiel";
            body  = "Un remboursement partiel de " + amountFmt + " € a été initié.";
        }
        pendingNotifs.add(new PendingNotif(payerId, "payment_refunded", title, body, Map.of(
            "type", "payment_refunded",
            "payment_id", paymentId,
            "refund_amount", amountRefunded,
            "fully_refunded", fullyRefunded
        )));
    }
}
```

> ⚠️ **Format float** : Python `:.2f` produit `51.75` (point décimal). Java `String.format(Locale.FRANCE, "%.2f", 51.75)` produit `51,75` (virgule). **Utiliser `Locale.ROOT`** pour produire `51.75` identique.

---

## BR-35.07 — Notif `charge.refunded` payload `data` exact

### Structure (lignes 530–535)

```python
"data": {
    "type": "payment_refunded",
    "payment_id": payment_id,
    "refund_amount": amount_refunded,    # float
    "fully_refunded": fully_refunded,    # bool
}
```

### Java
```java
Map.of(
    "type", "payment_refunded",
    "payment_id", paymentId,
    "refund_amount", amountRefunded,    // BigDecimal → number JSON
    "fully_refunded", fullyRefunded     // boolean
)
```

> ⚠️ Pas de `booking_id` dans `data` (asymétrie avec S33). Reproduire exactement.

---

## BR-35.08 — `refund.updated` Phase 1 : edge case full-refund avec early return

### Règle (lignes 546–567)

```python
if not payment_id and charge_id:
    row = await conn.fetchrow(
        "SELECT payment_id, payer_total_amount FROM payments WHERE stripe_charge_id=$1 LIMIT 1",
        charge_id,
    )
    if row:
        payment_id = row["payment_id"]
        total = float(row["payer_total_amount"] or 0)
        if refund_status == "succeeded" and abs(amount - total) < 0.02:
            await conn.execute(
                """UPDATE payments
                   SET refund_status=$1, refund_amount=$2,
                       status='refunded', updated_at=NOW()
                   WHERE payment_id=$3 AND status != 'refunded'""",
                refund_status, amount, payment_id,
            )
            log.info("refund.updated → remboursement complet confirmé : refund=%s | payment=%s", refund_id, payment_id)
            return  # ← EARLY RETURN
```

### Conditions cumulées (toutes nécessaires)
1. `payment_id` initialement non résolu (resolver S33 a échoué)
2. `charge_id` présent dans `obj.charge`
3. SELECT trouve un payment via `stripe_charge_id`
4. `refund_status == 'succeeded'`
5. `abs(amount - total) < 0.02` (tolérance 2 centimes)

### Si l'une des conditions échoue
- Le `payment_id` est mis à jour (depuis le SELECT) MAIS pas le full-refund
- Tombe en **Phase 2** (UPDATE simple `refund_status`)

### Java
```java
if (paymentId == null && chargeId != null) {
    Optional<RefundLookupRow> row = paymentRepo.findByChargeIdWithTotal(chargeId);
    if (row.isPresent()) {
        paymentId = row.get().paymentId();
        BigDecimal total = row.get().payerTotalAmount() != null
            ? row.get().payerTotalAmount()
            : BigDecimal.ZERO;

        if ("succeeded".equals(refundStatus)
            && amount.subtract(total).abs().compareTo(new BigDecimal("0.02")) < 0) {
            paymentRepo.markFullRefundEdgeCase(paymentId, refundStatus, amount);
            log.info("refund.updated → remboursement complet confirmé : refund={} | payment={}", refundId, paymentId);
            return;  // EARLY RETURN
        }
    }
}
```

---

## BR-35.09 — `refund.updated` Phase 2 : sync `refund_status` simple

### Règle (lignes 569–579)

```python
if payment_id:
    await conn.execute(
        """UPDATE payments
           SET refund_status=$1, updated_at=NOW()
           WHERE payment_id=$2""",
        refund_status, payment_id,
    )
    log.info("refund.updated : refund=%s | status=%s | payment=%s", refund_id, refund_status, payment_id)
else:
    log.debug("refund.updated : payment introuvable (refund=%s charge=%s)", refund_id, charge_id)
```

### Notes
- **Pas de guard** sur `status` → UPDATE inconditionnel.
- **Pas de notification.**
- Si `payment_id` toujours None après Phase 1 → log DEBUG + skip.

---

## BR-35.10 — `refund.updated` AUCUNE notification

### Règle (commentaire ligne 473)
*"Pas de notification supplémentaire (charge.refunded l'a déjà envoyée)."*

### Java
**NE PAS** émettre de notif dans `refund.updated`, ni Phase 1 ni Phase 2.

> ⚠️ Asymétrie volontaire. Si Stripe envoie uniquement `refund.updated` sans `charge.refunded` (rare), le payer ne reçoit PAS de notif. **Trou fonctionnel documenté** mais à reproduire.

---

## BR-35.11 — Logs format exact (compat stricte)

| Niveau | Message exact |
|---|---|
| INFO | `"Remboursement : payment=%s | amount=%.2f€ | full=%s → status=%s"` |
| INFO | `"refund.updated → remboursement complet confirmé : refund=%s | payment=%s"` |
| INFO | `"refund.updated : refund=%s | status=%s | payment=%s"` |
| DEBUG | `"charge.refunded : payment_id introuvable (charge=%s)"` |
| DEBUG | `"refund.updated : payment introuvable (refund=%s charge=%s)"` |

### Java SLF4J
```java
log.info("Remboursement : payment={} | amount={}€ | full={} → status={}",
         paymentId, String.format(Locale.ROOT, "%.2f", amount), fullyRefunded, newStatus);
log.info("refund.updated → remboursement complet confirmé : refund={} | payment={}", refundId, paymentId);
log.info("refund.updated : refund={} | status={} | payment={}", refundId, refundStatus, paymentId);
log.debug("charge.refunded : payment_id introuvable (charge={})", chargeId);
log.debug("refund.updated : payment introuvable (refund={} charge={})", refundId, chargeId);
```

> ⚠️ Le `€` (Unicode U+20AC) doit être écrit littéral. Le format `%.2f€` (point + 2 décimales + €) doit être bit-pour-bit. Locale.ROOT obligatoire pour produire `.` et pas `,`.

---

## BR-35.12 — Pas d'UPDATE `bookings` (asymétrie vs S33)

### Règle implicite

`_handle_charge_event` ne touche **JAMAIS** à `bookings`. Le booking reste en `'confirmed'` même après remboursement.

### Justification produit
La logique de "réservation annulée" suite à un refund est **dans le booking lifecycle** (endpoint `cancel`), pas dans le webhook. Le booking peut rester `confirmed` techniquement même si payment refundé (cas business : remboursement gracieux post-prestation).

### Java
**Ne PAS** ajouter d'UPDATE bookings. **Asymétrie volontaire**.

---

## BR-35.13 — Interaction avec slices migrées

| Slice | Interaction |
|---|---|
| **S30** (booking pay) | Crée payment avec `stripe_checkout_session_id`, `metadata.payment_id` |
| **S32** (webhook infra) | Endpoint, signature, idempotence event-level |
| **S33** (webhook payment handlers) | `_resolve_payment_id` (réutilisé), `NotificationService` (réutilisé), set `stripe_charge_id` (utilisé par S35 fallback) |
| **S34** (payment reads) | Affiche `status='refunded'` / `'partially_refunded'`, `refund_amount`, `refund_status` au front |

### Cas concurrence S33↔S35
- S33 set `payments.stripe_charge_id='ch_xxx'` (PI succeeded)
- S35 reçoit `charge.refunded` → COALESCE garde le `ch_xxx` existant ✅

### Cas où S35 vient avant S33 (rare)
- Si pour une raison X, `charge.refunded` arrive avant `payment_intent.succeeded`
- S35 set le `stripe_charge_id` (COALESCE écrit puisque null) + status='refunded'
- S33 PI succeeded arrive ensuite : guard `WHERE status NOT IN ('captured','refunded')` bloque → rows=0 → pas d'écrasement ✅

---

## BR-35.14 — Asymétries à préserver

| Aspect | Comportement Python | Java doit reproduire |
|---|---|---|
| `charge.refunded` notif **payer** seul (pas receiver) | OUI | ✅ |
| `refund.updated` AUCUNE notif | OUI | ✅ |
| Pas d'UPDATE `bookings` | OUI | ✅ |
| `COALESCE(stripe_charge_id, $4)` (préserve l'existant) | OUI | ✅ |
| `WHERE status NOT IN ('refunded')` vs `WHERE status != 'refunded'` (Phase 1) | OUI | ✅ même comportement, syntaxe différente |
| Phase 2 sans guard sur status | OUI | ✅ |
| Tolérance 0.02 (pas 0.01 ni 0.03) | OUI | ✅ |
| Locale-independent format `.2f` (point décimal) | OUI | ✅ Locale.ROOT |
| Boolean `refunded` (pas comparaison montants) | OUI | ✅ |
| Fallback local SELECT charge_id sans `startsWith("ch_")` | OUI | ✅ asymétrie vs resolver S33 |
| Pas de notif si Phase 1 (full edge case) | OUI | ✅ trou fonctionnel volontaire |

---

## BR-35.15 — Limitations connues (à NE PAS corriger)

| Limitation | Reproduire ? |
|---|---|
| Trou fonctionnel : `refund.updated` Phase 1 sans notif | OUI |
| Pas de gestion `charge.dispute.*` | OUI (compat stricte) |
| Pas de notification au `receiver` (coach) du refund | OUI |
| `refund_amount` peut être 0 si Stripe envoie 0 (incohérent mais accepté) | OUI |
| `refund_status` accepté tel quel sans validation enum | OUI |
| Phase 2 UPDATE sans guard → peut écraser `refund_status='succeeded'` par `'failed'` (rare) | OUI (suit le cycle Stripe) |
| Pas de re-tentative côté handler en cas de DB timeout | OUI (Stripe retry via webhook) |
