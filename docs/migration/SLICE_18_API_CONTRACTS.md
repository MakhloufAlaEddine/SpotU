# SLICE_18_API_CONTRACTS.md — Contrat d'exécution du worker Slice 18
> Worker : `ExpiryWorker` — `expiry_worker.py` (aucun endpoint HTTP exposé).
> Généré le 2026-02-XX.

---

## Nature du composant

Ce composant est un **worker de fond asyncio** — il n'expose aucun endpoint HTTP.
Le "contrat" ci-dessous décrit le contrat d'exécution du scheduler : entrées, sorties, effets de bord observables et garanties comportementales.

---

## Contrat d'exécution — `expire_stale_bookings(pool)`

### Entrée (implicite — requête DB interne)

```sql
-- expiry_worker.py:59–82
SELECT
    b.booking_id,
    b.status   AS booking_status,
    b.slot_id,
    b.payer_user_id,
    b.receiver_user_id,
    b.service_id,
    p.payment_id,
    p.status  AS pay_status,
    p.stripe_payment_intent_id,
    p.stripe_checkout_session_id
FROM bookings b
LEFT JOIN payments p ON p.booking_id = b.booking_id
WHERE b.status IN ('requested', 'awaiting_payment')
  AND b.expires_at IS NOT NULL
  AND b.expires_at < NOW()
ORDER BY b.expires_at ASC
LIMIT 50
FOR UPDATE OF b SKIP LOCKED
```

**Critères de sélection :**
- `status` : `'requested'` OU `'awaiting_payment'` uniquement
- `expires_at` : non NULL ET déjà dépassé (`< NOW()`)
- Lock : `FOR UPDATE OF b SKIP LOCKED` — lock sur `bookings` uniquement (pas sur `payments`)
- Ordre : `expires_at ASC` — les plus anciens traités en premier
- Batch : 50 max par appel interne

---

## Contrat d'exécution — Effets de bord par booking traité

### Effet 1 — `bookings` : transition → `expired`

```sql
-- expiry_worker.py:103–109
UPDATE bookings
SET status = 'expired', updated_at = NOW()
WHERE booking_id = $1 AND status IN ('requested', 'awaiting_payment')
RETURNING booking_id
```

- Guard : `RETURNING booking_id` — si NULL (booking déjà changé de statut par race condition), le booking est **skipé** (pas d'erreur)
- Statuts source acceptés : `requested`, `awaiting_payment` uniquement

---

### Effet 2 — `service_slots` : libération → `available` (conditionnel)

```sql
-- expiry_worker.py:115–122
UPDATE service_slots
SET slot_status = 'available'
WHERE slot_id = $1
  AND slot_status IN ('pending', 'reserved')
  AND slot_type IN ('single', 'specific')
```

**Conditions d'exécution :**
- `booking.slot_id IS NOT NULL`
- `slot_type IN ('single', 'specific')` — les slots `recurring` **ne sont jamais libérés**
- `slot_status IN ('pending', 'reserved')` — pas d'UPDATE si déjà `available` ou `booked`

---

### Effet 3 — `payments` : annulation → `cancelled` (conditionnel)

```sql
-- expiry_worker.py:128–133
UPDATE payments
SET status = 'cancelled', updated_at = NOW()
WHERE payment_id = $1
```

**Conditions d'exécution :**
- `payment_id IS NOT NULL` (payment existe via LEFT JOIN)
- `pay_status IN ('requires_authorization', 'authorized', 'capture_pending')`
- Statuts exclus (laissés intacts) : `'pending'`, `'captured'`, `'cancelled'`, `'refunded'`, tout autre statut

---

### Effet 4 — `notifications` : insertion (2 par booking, toujours)

```sql
-- expiry_worker.py:199–202 (_insert_notif)
INSERT INTO notifications (notif_id, user_id, type, title, body, data)
VALUES ($1, $2, $3, $4, $5, $6)
```

**Notification payer :**
| Champ | Valeur si `awaiting_payment` | Valeur si `requested` |
|---|---|---|
| `type` | `"booking_expired"` | `"booking_expired"` |
| `title` | `"Demande expirée"` | `"Demande expirée"` |
| `body` | `"Votre réservation pour « {svc_title} » a expiré (délai de paiement dépassé)."` | `"Votre demande pour « {svc_title} » n'a pas reçu de réponse et a expiré."` |
| `data` | `{"type":"booking_expired","bookingId":"{bid}","service_id":"{sid}","service_title":"{title}"}` | idem |

**Notification receiver :**
| Champ | Valeur si `awaiting_payment` | Valeur si `requested` |
|---|---|---|
| `type` | `"booking_expired"` | `"booking_expired"` |
| `title` | `"Réservation non payée"` | `"Demande non traitée"` |
| `body` | `"Le client n'a pas payé dans les délais pour « {svc_title} » — créneau libéré."` | `"Une demande de réservation pour « {svc_title} » a expiré sans avoir été traitée."` |
| `data` | `{"type":"booking_expired","bookingId":"{bid}","service_id":"{sid}","service_title":"{title}","payer_id":"{pid}"}` | idem |

> ℹ️ Le `data.payer_id` est présent uniquement dans la notification du receiver.
> ℹ️ `notif_id` = `new_id("ntf")` = `"ntf_" + uuid4().hex[:12]` — format à reproduire exactement.
> ⚠️ **Aucun push FCM/APNs** — uniquement INSERT en table `notifications`.

---

### Effet 5 — Stripe `cancel_payment_intent` (conditionnel, HORS TRANSACTION)

```python
# expiry_worker.py:173–179
await stripe_service.cancel_payment_intent(pi_id, reason="expired")
# → stripe_service.py:166–186
# → stripe.PaymentIntent.cancel(intent_id, cancellation_reason="abandoned")
```

**Conditions d'exécution :**
- `stripe_payment_intent_id IS NOT NULL`
- `pay_status IN ('requires_authorization', 'authorized', 'capture_pending')`
- **APRÈS le COMMIT de la transaction DB**

**Comportement sur erreur Stripe :**
- Exception catchée → `log.error(...)` uniquement
- Le booking reste `expired` en DB (la transaction DB est déjà commitée)
- Pas de rollback, pas de retry

---

## Valeur de retour

| Fonction | Retour |
|---|---|
| `_expire_batch(pool, batch_size)` | `int` — nombre de bookings expirés dans ce batch |
| `expire_stale_bookings(pool)` | `int` — total de bookings expirés (tous batches) |
| `ExpiryWorker._tick()` | `None` — log si `n > 0` |

---

## Ordre d'exécution dans `_expire_batch` — séquence exacte

```
Pour chaque booking dans le batch :
  1. BEGIN TRANSACTION
     a. UPDATE bookings → expired  (RETURNING — skip si 0 rows)
     b. UPDATE service_slots → available  (si slot_id + slot_type correct)
     c. UPDATE payments → cancelled  (si payment_id + pay_status correct)
     d. SELECT services.title  (pour messages notif)
     e. INSERT notifications  (payer)
     f. INSERT notifications  (receiver)
  2. COMMIT
  3. [hors transaction] stripe_service.cancel_payment_intent()  (si pi_id + pay_status correct)
  4. log.info(...)
```

> ⚠️ Les inserts de notifications sont **DANS** la transaction — si la transaction rollback (exception inattendue), les notifications ne sont pas créées.
> ⚠️ L'appel Stripe est **HORS** transaction — si l'appel Stripe échoue, le booking est quand même `expired`.

---

## Configuration Spring (équivalent de `server.py`)

```java
// Équivalent de server.py:278–285
@Configuration
@EnableScheduling
public class WorkerConfig {

    @Bean
    public ExpiryWorkerService expiryWorkerService(DataSource ds) {
        return new ExpiryWorkerService(ds);
    }
}

// Équivalent de ExpiryWorker._run()
@Service
public class ExpiryWorkerService {

    // Déclenché toutes les EXPIRY_WORKER_INTERVAL_SECS secondes
    // + initialDelay=0 pour tick immédiat au démarrage (comme Python)
    @Scheduled(
        fixedDelayString = "${expiry.worker.interval.secs:60}000",
        initialDelay = 0
    )
    @Async("workerExecutor")
    public void tick() {
        int total = 0;
        int count;
        do {
            count = processBatch(EXPIRY_BATCH_SIZE);  // ← DRAIN LOOP
            total += count;
        } while (count >= EXPIRY_BATCH_SIZE);
        if (total > 0) log.info("ExpiryWorker : {} booking(s) expiré(s) ce tick", total);
    }
}
```
