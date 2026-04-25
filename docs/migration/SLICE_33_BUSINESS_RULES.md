# SLICE_33_BUSINESS_RULES.md — Règles métier Webhook Payment Handlers
> Basé sur `webhook_handlers.py:122–180, 185–453, 1017–1027`.
> Généré le 2026-04-25.

---

## BR-33.01 — `_resolve_payment_id` ordre de lookup STRICT

### Règle (lignes 122–180)

```
1. metadata.payment_id          → priorité 1, court-circuit immédiat
2. stripe_payment_intent_id     → lookup payments WHERE stripe_payment_intent_id=$
3. stripe_checkout_session_id   → lookup payments WHERE stripe_checkout_session_id=$ (uniquement si event.type contient "checkout.session")
4. stripe_charge_id             → lookup payments WHERE stripe_charge_id=$ (uniquement si charge_id commence par "ch_")
```

Retour : `(payment_id, booking_id)` ou `(None, None)` si introuvable.

### Détermination de l'ID Stripe selon event_type

```python
if "payment_intent" in event_type:
    event_pi_id = obj.id            # PI lui-même
elif event_type in ("charge.refunded",):
    event_pi_id = obj.payment_intent
elif event_type in ("refund.updated",):
    event_pi_id = obj.payment_intent
else:
    event_pi_id = obj.payment_intent  # ex: checkout.session.completed
```

### Java
```java
public ResolvedPayment resolve(String eventType, Map<String,Object> obj) {
    Map<String,Object> metadata = (Map<String,Object>) obj.getOrDefault("metadata", Map.of());

    // Priorité 1
    String paymentId = (String) metadata.get("payment_id");
    String bookingIdMeta = (String) metadata.get("booking_id");
    if (paymentId != null) return new ResolvedPayment(paymentId, bookingIdMeta);

    // Priorité 2 — payment_intent_id
    String pi = (eventType.contains("payment_intent"))
                ? (String) obj.get("id")
                : (String) obj.get("payment_intent");
    if (pi != null) {
        Optional<PaymentRow> r = repo.findByStripePaymentIntentId(pi);
        if (r.isPresent()) return new ResolvedPayment(r.get().paymentId(), r.get().bookingId());
    }

    // Priorité 3 — checkout session
    if (eventType.contains("checkout.session")) {
        String csId = (String) obj.get("id");
        if (csId != null) {
            Optional<PaymentRow> r = repo.findByStripeCheckoutSessionId(csId);
            if (r.isPresent()) return new ResolvedPayment(r.get().paymentId(), r.get().bookingId());
        }
    }

    // Priorité 4 — charge_id
    Object chargeRaw = eventType.startsWith("charge.") ? obj.get("id") : obj.get("charge");
    if (chargeRaw instanceof String chargeId && chargeId.startsWith("ch_")) {
        Optional<PaymentRow> r = repo.findByStripeChargeId(chargeId);
        if (r.isPresent()) return new ResolvedPayment(r.get().paymentId(), r.get().bookingId());
    }

    return new ResolvedPayment(null, null);
}
```

> ⚠️ **Court-circuit early return** dès qu'un match est trouvé. Ne **JAMAIS** essayer toutes les stratégies en parallèle.

---

## BR-33.02 — Set `_PAYMENT_EVENTS` exact (5 events)

### Règle (lignes 964–970)

```python
_PAYMENT_EVENTS = frozenset({
    "checkout.session.completed",
    "payment_intent.amount_capturable_updated",
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "payment_intent.canceled",
})
```

### Java
```java
private static final Set<String> PAYMENT_EVENTS = Set.of(
    "checkout.session.completed",
    "payment_intent.amount_capturable_updated",
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "payment_intent.canceled"
);
```

> ⚠️ `checkout.session.completed` est aussi dans `_SUBSCRIPTION_EVENTS` — branchement par `obj.mode` à l'INTÉRIEUR du handler (BR-33.03).

---

## BR-33.03 — `checkout.session.completed` : routage par `mode` + `payment_status`

### Règle (lignes 205–333)

```
SI obj.mode == "subscription" :
    return  # géré par S35 _handle_subscription_event

SI obj.payment_status == "unpaid" :
    Lookup bookings.status WHERE booking_id=$1 (peut être NULL si booking_id absent)
    SI bookings.status == "awaiting_payment" :
        → Branch A : capture immédiate + bookings confirmed + 2 notifs
    SINON :
        → Branch B : authorize seulement + 1 notif receiver
SINON SI obj.payment_status == "paid" :
    → Branch C : capture + bookings confirmed + 2 notifs
```

### Asymétrie clé
- Branch A et Branch C ont des UPDATE payments avec **guards différents** (voir BR-33.05).
- Branch A (instant) génère 2 notifs avec libellés "À bientôt !".
- Branch C (paid Stripe direct) génère 2 notifs avec libellés sans "À bientôt".
- **Reproduire les libellés exacts** — voir BR-33.04.

---

## BR-33.04 — Libellés notifications EXACTS (compat stricte)

### `booking_confirmed` payer (Branch A — instant_booking)
```
title: "Réservation confirmée !"
body:  "Votre réservation pour « {title} » est confirmée. À bientôt !"
```

### `booking_confirmed` receiver (Branch A — instant_booking)
```
title: "Nouvelle réservation !"
body:  "Paiement reçu pour « {title} ». Votre planning a été mis à jour."
```

### `booking_confirmed` payer (Branch C — paid Stripe)
```
title: "Réservation confirmée !"
body:  "Votre réservation pour « {title} » est confirmée."   ← PAS de "À bientôt !"
```

### `booking_confirmed` receiver (Branch C — paid Stripe)
```
title: "Nouvelle réservation !"
body:  "Paiement reçu pour « {title} ». Votre planning a été mis à jour."   ← identique Branch A
```

### `booking_confirmed` payer (`payment_intent.succeeded`)
```
title: "Réservation confirmée !"
body:  "Votre réservation pour « {title} » est confirmée."
```

### `booking_confirmed` receiver (`payment_intent.succeeded`)
```
title: "Nouvelle réservation !"
body:  "Paiement capturé pour « {title} ». Votre planning a été mis à jour."   ← "capturé" pas "reçu"
```

### `payment_authorized` receiver (Branch B — manual_approval)
```
title: "Paiement autorisé"
body:  "Le paiement pour votre prestation a été autorisé."
```

### `payment_authorized` receiver (`payment_intent.amount_capturable_updated`)
```
title: "Paiement autorisé"
body:  "Le paiement pour votre prestation est confirmé — vous pouvez procéder."
```

> ⚠️ Body **différent** entre Branch B et `amount_capturable_updated`. À reproduire.

### `payment_failed` payer
```
title: "Paiement échoué"
body:  "Votre paiement n'a pas pu être traité. Veuillez vérifier votre moyen de paiement."
```

### `data` payload structurel (toutes notifs)
```json
{
  "type": "<notif_type>",
  "booking_id": "...",
  "payment_id": "..."
}
```

---

## BR-33.05 — Idempotence guards EXACTS par branche

### Tous les UPDATE payments portent un guard différencié

| Branche | UPDATE | Guard `WHERE status NOT IN (...)` |
|---|---|---|
| Branch A (CSC unpaid+awaiting) | `status='captured'` | `('captured','refunded','cancelled')` |
| Branch B (CSC unpaid+other) | `status='authorized'` | `('authorized','captured','refunded','cancelled')` |
| Branch C (CSC paid) | `status='captured'` | `('captured','refunded')` |
| amount_capturable_updated | `status='authorized'` | `('authorized','captured','refunded','cancelled')` |
| PI succeeded (avec charge) | `status='captured', stripe_charge_id=$` | `('captured','refunded')` |
| PI succeeded (sans charge) | `status='captured'` | `('captured','refunded')` |
| PI payment_failed | `status='failed'` | `('captured','refunded','failed')` |
| PI canceled | `status='cancelled'` | `('captured','refunded','cancelled')` |

> ⚠️ **Branch A vs Branch C : guards différents !** Branch A inclut `'cancelled'` dans NOT IN, Branch C non. C'est volontaire (Branch A vient d'un état `awaiting_payment` plus volatile).

### UPDATE bookings (3 branches : A, C, PI succeeded)

```sql
UPDATE bookings
   SET status='confirmed', payment_status='paid', updated_at=NOW()
 WHERE booking_id=$1
   AND status NOT IN ('confirmed','refused','cancelled','expired')
```

Guard **identique** dans les 3 cas.

---

## BR-33.06 — Notification émise UNIQUEMENT si `rows_updated > 0`

### Règle (universelle)

```python
res = await conn.execute("UPDATE payments ... AND status NOT IN (...)", ...)
if _rows(res) > 0:
    # SEULEMENT MAINTENANT, append à pending_notifs
    pending_notifs.append({...})
```

### Branche A et C (transaction)

Le code Python utilise `rows_updated` (Branch A) ou `rows_captured` (Branch C, PI succeeded) **mesuré sur l'UPDATE payments**. Le UPDATE bookings n'a **pas** son propre check de rows.

### Java
```java
int rows = paymentRepo.markCaptured(paymentId);
if (bookingId != null) {
    bookingRepo.markConfirmed(bookingId);
}
if (rows > 0 && bookingId != null) {
    pendingNotifs.add(...);
}
```

> ⚠️ Le check `bookingId != null` est **AUSSI** une condition (sinon notif sans contexte).

---

## BR-33.07 — `_rows(result)` parsing asyncpg → JPA

### Python
```python
def _rows(result: str) -> int:
    try:
        return int(result.strip().split()[-1])
    except (ValueError, IndexError):
        return 0
```

### Java
JPA `@Modifying @Query` retourne directement `int`. Pas de parsing nécessaire.

```java
@Modifying
@Query(value = "UPDATE payments SET status='captured', updated_at=NOW() WHERE payment_id=:id AND status NOT IN ('captured','refunded')", nativeQuery=true)
int markCaptured(@Param("id") String paymentId);
```

---

## BR-33.08 — `payment_intent.succeeded` : 2 sous-branches selon `latest_charge`

### Règle (lignes 357–391)

```python
charge_id = obj.latest_charge
if isinstance(charge_id, str) and charge_id.startswith("ch_"):
    # Branche avec stripe_charge_id
    UPDATE payments SET status='captured', stripe_charge_id=$1, updated_at=NOW()
                  WHERE payment_id=$2 AND status NOT IN ('captured','refunded')
else:
    # Branche sans stripe_charge_id
    UPDATE payments SET status='captured', updated_at=NOW()
                  WHERE payment_id=$1 AND status NOT IN ('captured','refunded')
```

### Asymétrie

- Si `latest_charge` est un **string** `"ch_..."` → set le `stripe_charge_id` (utile pour S34 refunds).
- Si **null** ou un **objet expanded** → fallback sans set.

### Java
```java
Object lc = pi.get("latest_charge");
if (lc instanceof String s && s.startsWith("ch_")) {
    paymentRepo.markCapturedWithCharge(paymentId, s);
} else {
    paymentRepo.markCaptured(paymentId);
}
```

> ⚠️ **Ne pas accepter `Charge` Stripe expanded comme valid charge_id**. Reproduire le test `instanceof String` strict.

---

## BR-33.09 — `payment_intent.canceled` : aucune notification

### Règle (ligne 442–448)

```python
elif event_type == "payment_intent.canceled":
    # Pas de notification : la réservation a déjà notifié via refuse/cancel
    await conn.execute(
        """UPDATE payments SET status='cancelled', updated_at=NOW()
           WHERE payment_id=$1 AND status NOT IN ('captured','refunded','cancelled')""",
        payment_id,
    )
```

### Justification
Le PI est annulé après que le booking ait été refusé/annulé via les endpoints REST. Ces endpoints émettent leur propre notif. Une notif webhook serait un doublon.

### Java
```java
case "payment_intent.canceled" -> {
    paymentRepo.markCancelled(paymentId);
    // PAS d'append à pendingNotifs
}
```

> ⚠️ Asymétrie volontaire. **Ne pas ajouter de notif "par cohérence".**

---

## BR-33.10 — Branche `payment_id` introuvable

### Règle (lignes 1017–1027)

```python
if event_type in _PAYMENT_EVENTS:
    if payment_id:
        await _handle_payment_event(...)
    elif event_type != "checkout.session.completed":
        log.debug("Webhook payment sans payment_id : type=%s", event_type)
```

### Comportement

| Cas | Action |
|---|---|
| `payment_id` trouvé | Traitement normal |
| `payment_id` introuvable + event = `checkout.session.completed` | Skip silencieux (peut être subscription → S35 traitera) |
| `payment_id` introuvable + autre event paiement | Log DEBUG + skip |

Dans tous les cas : `_mark_done(success)` côté dispatcher (S32). **Stripe reçoit 200**.

> ⚠️ Java : ne **PAS** lever d'exception si `payment_id` introuvable. C'est un cas normal (event Stripe non lié à notre DB, ex: paiement test, ancien paiement purgé).

---

## BR-33.11 — `booking_id` absent : pas d'UPDATE bookings ni de notif

### Règle (cumulée à travers les branches)

```python
if booking_id:
    await conn.execute("UPDATE bookings ...", booking_id)

if rows_updated > 0 and booking_id:   # ← AND booking_id obligatoire pour notifs
    pending_notifs.append(...)
```

### Justification
Un paiement sans booking est possible (ex: paiement direct service one-shot). Pas de booking → pas d'UPDATE bookings, pas de title à JOIN, pas de notif booking_confirmed.

> ⚠️ Java : ne **PAS** créer de booking factice ni générer de notif sans contexte.

---

## BR-33.12 — Atomicité payments + bookings (3 branches)

### Branches concernées

| Branche | Transaction obligatoire |
|---|---|
| `checkout.session.completed` (unpaid+awaiting → captured + bookings) | OUI |
| `checkout.session.completed` (paid → captured + bookings) | OUI |
| `payment_intent.succeeded` (avec ou sans charge) | OUI |

### Java
```java
@Transactional
public void handleSucceeded(String paymentId, String bookingId, ...) {
    int rows = paymentRepo.markCaptured(paymentId);
    if (bookingId != null) {
        bookingRepo.markConfirmedAndPaid(bookingId);
    }
    // collecte notifs hors-transaction (post-commit)
}
```

### Branches sans transaction

`Branch B`, `amount_capturable_updated`, `payment_failed`, `canceled` ne touchent que `payments`. Pas de `@Transactional` requis (mais possible).

---

## BR-33.13 — JOIN `services` pour title de notification

### Règle (réutilisée dans 3 branches)

```python
title_row = await conn.fetchrow(
    """SELECT s.title FROM bookings b
       JOIN services s ON b.service_id = s.service_id
       WHERE b.booking_id=$1""",
    booking_id,
)
title = title_row["title"] if title_row else "votre prestation"
```

### Cas non-trouvé
- Service supprimé : JOIN renvoie 0 row → fallback `"votre prestation"`.
- `booking_id` invalide : JOIN renvoie 0 row → fallback.

### Java
```java
String title = serviceRepo.findTitleByBookingId(bookingId).orElse("votre prestation");
```

---

## BR-33.14 — Notification `data` payload structurel

### Règle (toutes notifs)

```python
"data": {
    "type": "booking_confirmed" | "payment_authorized" | "payment_failed",
    "booking_id": booking_id,    # peut être null pour payment_authorized solo
    "payment_id": payment_id,
}
```

### Notes
- Le champ `type` à l'intérieur de `data` **duplique** le `type` de la notif. C'est volontaire pour le client mobile (legacy).
- `booking_id` peut être `null` pour Branch B (pas de booking pour authorize-only).

### Java
```java
Map<String,Object> data = Map.of(
    "type", notifType,
    "booking_id", bookingId != null ? bookingId : "",
    "payment_id", paymentId
);
```

> ⚠️ Si le champ accepte des `null`, utiliser `HashMap` plutôt que `Map.of()` (qui rejette null).

---

## BR-33.15 — Logs format `|` séparateur exact

### Règles

| Niveau | Message |
|---|---|
| INFO | `"Payment event traité : type=%s | payment=%s | booking=%s"` |
| DEBUG | `"Webhook payment sans payment_id : type=%s"` |
| INFO | `"Notification envoyée : type=%s | user=%s"` (depuis dispatcher S32) |

### Java SLF4J

```java
log.info("Payment event traité : type={} | payment={} | booking={}", eventType, paymentId, bookingId);
log.debug("Webhook payment sans payment_id : type={}", eventType);
```

> ⚠️ Reproduire les **espaces** autour de `|`.

---

## BR-33.16 — Interaction avec slices migrées

### Slice 30 (Booking pay)
S33 **lit** ce que S30 a écrit :
- `payments.stripe_checkout_session_id` (set par S30)
- `payments.stripe_payment_intent_id` (set après confirm Stripe en S30)
- `payments.metadata` n'existe **pas** côté DB ; le `metadata.payment_id` est dans le **payload Stripe**, set lors de la création du Checkout Session par S30.

### Slice 31 (Checkout status)
S31 fait des UPDATE concurrents sur `payments` (best-effort post-redirect). S33 reçoit le webhook ~quelques secondes après. **Concurrence possible** :
- Si S31 a déjà set `status='captured'` → guard `WHERE status NOT IN ('captured',...)` bloque S33 → `rows_updated=0` → pas de notif (la notif aurait dû être émise par S31, mais S31 ne stocke PAS de notif — ça reste un trou fonctionnel à noter).

> ⚠️ **Trou fonctionnel** identifié : si S31 capture avant S33, le buyer n'a pas de push. Stripe Connect compense en pratique via `payment_intent.succeeded` qui arrive en quelques secondes, mais en théorie c'est possible. **Reproduire ce comportement Python** — ne pas ajouter de notif compensatoire.

### Slice 34 (Refunds — futur)
S33 set `payments.stripe_charge_id` à `payment_intent.succeeded`. S34 lookera par `stripe_charge_id` pour les refunds. **Dépendance ascendante**.

### Slice 35 (Subscriptions — futur)
`checkout.session.completed` (mode=subscription) sera routé par S35. S33 doit retourner immédiatement dans ce cas sans toucher payments/bookings.

---

## BR-33.17 — Asymétries à préserver (récap)

| Aspect | Comportement Python | Java doit reproduire |
|---|---|---|
| `payment_intent.canceled` sans notif | OUI | ✅ |
| `payment_intent.payment_failed` notif **payer** seul, pas receiver | OUI | ✅ |
| `payment_intent.amount_capturable_updated` notif receiver seul | OUI | ✅ |
| Branch A vs Branch C : guards différents (Branch A inclut 'cancelled') | OUI | ✅ |
| Branch A vs Branch C : libellés notifs différents ("À bientôt !" vs sans) | OUI | ✅ |
| `payment_intent.succeeded` body receiver dit "capturé" pas "reçu" | OUI | ✅ |
| `amount_capturable_updated` body différent de Branch B | OUI | ✅ |
| `latest_charge` test `isinstance(str)` strict | OUI | ✅ |
| `_resolve_payment_id` strat. 4 (charge_id) early-return même pour PI events | OUI (générique) | ✅ |
| Pas de UPDATE bookings pour `failed`/`canceled`/`amount_capturable_updated` | OUI | ✅ |

---

## BR-33.18 — Limitations connues (à NE PAS corriger)

| Limitation | Reproduire ? |
|---|---|
| Pas de retry handler interne (Stripe gère via re-livraison) | OUI |
| Pas de DLQ pour events en erreur | OUI |
| `error_message` tronqué à 500 chars (S32) | OUI |
| Trou fonctionnel S31↔S33 (capture concurrente, pas de notif compensatoire) | OUI |
| Pas de validation amount/currency dans le webhook | OUI |
| Notif WebSocket peut échouer silencieusement (`log.warning` dans dispatcher S32) | OUI |
| Pas de notif pour booking sans booking_id | OUI |

---

## BR-33.19 — Cas `payment_status` autre que `unpaid`/`paid`

### Règle (analyse code)

Le code Python n'a **que** `if ps == "unpaid"` et `elif ps == "paid"`. Tout autre valeur (`"no_payment_required"`, `"manual"`, etc.) tombe dans **aucune branche** → handler retourne sans rien faire pour `checkout.session.completed`.

### Java
```java
case "checkout.session.completed" -> {
    String mode = (String) obj.getOrDefault("mode", "");
    if ("subscription".equals(mode)) return;
    String ps = (String) obj.getOrDefault("payment_status", "");
    if ("unpaid".equals(ps)) {
        // Branch A ou B
    } else if ("paid".equals(ps)) {
        // Branch C
    }
    // else : silent skip
}
```

> ⚠️ **Pas de log warning** pour ces cas. Reproduire le silence.
