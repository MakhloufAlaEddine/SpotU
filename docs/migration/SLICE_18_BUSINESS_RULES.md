# SLICE_18_BUSINESS_RULES.md — Règles métier de la Slice 18
> Source : `expiry_worker.py` (intégral) + `booking_routes.py:48–50` + `server.py:281–282`.
> Généré le 2026-02-XX.

---

## BR-01 — Statuts sources éligibles à l'expiration

```python
# expiry_worker.py:74
WHERE b.status IN ('requested', 'awaiting_payment')
```

**Règle :** Seuls les bookings avec `status='requested'` OU `status='awaiting_payment'` sont candidats à l'expiration. Tout autre statut (`confirmed`, `accepted`, `expired`, `refused`, `cancelled`, `completed`) est **hors scope**.

---

## BR-02 — Condition temporelle obligatoire

```python
# expiry_worker.py:75–76
AND b.expires_at IS NOT NULL
AND b.expires_at < NOW()
```

**Règle :** Un booking éligible doit avoir `expires_at` non NULL ET déjà dépassé. Un booking `requested` sans `expires_at` (cas anormaux) n'est jamais expiré par le worker.

---

## BR-03 — Locking anti-race condition : `SELECT FOR UPDATE OF b SKIP LOCKED`

```python
# expiry_worker.py:79
FOR UPDATE OF b SKIP LOCKED
```

**Règle :** Le lock est posé sur `bookings` uniquement (`OF b`), pas sur `payments`. Si un autre worker/transaction a déjà locké une ligne → elle est ignorée (`SKIP LOCKED`), pas d'attente, pas de deadlock.

> ⚠️ **Piège Java** : JPA/JPQL ne supporte pas `FOR UPDATE SKIP LOCKED` nativement. Utiliser une **requête native** (`@Query(value="...", nativeQuery=true)` ou `EntityManager.createNativeQuery()`).

---

## BR-04 — Guard de transition atomique : `RETURNING booking_id`

```python
# expiry_worker.py:103–111
updated = await conn.fetchval(
    """UPDATE bookings
       SET status = 'expired', updated_at = NOW()
       WHERE booking_id = $1 AND status IN ('requested', 'awaiting_payment')
       RETURNING booking_id""",
    bid,
)
if not updated:
    continue
```

**Règle :** Si `RETURNING` retourne NULL (le booking a été modifié entre le SELECT et l'UPDATE par une autre transaction), le booking est **silencieusement skipé**. Aucun effet de bord (slot, payment, notifs) n'est déclenché.

> ℹ️ Ce guard est la deuxième ligne de défense après `SKIP LOCKED`. Les deux ensemble garantissent une idempotence totale.

---

## BR-05 — Libération du slot : filtre `slot_type`

```python
# expiry_worker.py:114–122
if slot_id:
    await conn.execute(
        """UPDATE service_slots
           SET slot_status = 'available'
           WHERE slot_id = $1
             AND slot_status IN ('pending', 'reserved')
             AND slot_type IN ('single', 'specific')""",
        slot_id,
    )
```

**Règle :** Le slot n'est libéré QUE si :
1. `booking.slot_id IS NOT NULL`
2. `slot_type IN ('single', 'specific')` — les slots `recurring` ne sont **jamais** libérés
3. `slot_status IN ('pending', 'reserved')` — si déjà `available` ou `booked`, aucun changement (idempotent)

**Correspondance booking_status → slot_status avant expiration :**
| `booking.status` | `slot_status` attendu |
|---|---|
| `requested` | `pending` |
| `awaiting_payment` | `reserved` |

---

## BR-06 — Annulation du payment : filtre `pay_status`

```python
# expiry_worker.py:125–133
if payment_id and pay_status in (
    "requires_authorization", "authorized", "capture_pending"
):
    await conn.execute(
        """UPDATE payments SET status = 'cancelled', updated_at = NOW()
           WHERE payment_id = $1""",
        payment_id,
    )
```

**Règle :** Le payment est annulé UNIQUEMENT si `pay_status IN ('requires_authorization', 'authorized', 'capture_pending')`.

**Statuts laissés intacts (règle d'exclusion) :**
| `pay_status` | Action worker |
|---|---|
| `requires_authorization` | → `cancelled` ✅ |
| `authorized` | → `cancelled` ✅ |
| `capture_pending` | → `cancelled` ✅ |
| `pending` | **inchangé** (pas encore autorisé) |
| `captured` | **inchangé** (déjà capturé — état terminal) |
| `cancelled` | **inchangé** (déjà annulé) |
| `refunded` | **inchangé** (déjà remboursé — état terminal) |
| `NULL` (pas de payment) | **ignoré** (LEFT JOIN null) |

> ⚠️ L'UPDATE payments n'a pas de `RETURNING` ni de guard supplémentaire — c'est voulu. Le booking est déjà locké en étape précédente.

---

## BR-07 — Textes de notification asymétriques selon `booking_status`

```python
# expiry_worker.py:153–170
```

Les messages de notification varient selon le statut initial du booking :

**Pour le payer :**
| `booking_status` | `body` |
|---|---|
| `awaiting_payment` | "Votre réservation pour « {svc_title} » a expiré (délai de paiement dépassé)." |
| `requested` | "Votre demande pour « {svc_title} » n'a pas reçu de réponse et a expiré." |

**Pour le receiver :**
| `booking_status` | `title` | `body` |
|---|---|---|
| `awaiting_payment` | "Réservation non payée" | "Le client n'a pas payé dans les délais pour « {svc_title} » — créneau libéré." |
| `requested` | "Demande non traitée" | "Une demande de réservation pour « {svc_title} » a expiré sans avoir été traitée." |

> ⚠️ `svc_title` est lu depuis `services.title` via `SELECT title FROM services WHERE service_id=$1`. Si le service est introuvable → `svc_title = "un service"` (fallback hardcodé).

---

## BR-08 — Stripe `cancel_payment_intent` : hors transaction, conditionnel

```python
# expiry_worker.py:173–179
if pi_id and pay_status in ("requires_authorization", "authorized", "capture_pending"):
    try:
        await stripe_service.cancel_payment_intent(pi_id, reason="expired")
    except Exception as stripe_exc:
        log.error("Erreur Stripe annulation pi=%s : %s", pi_id, stripe_exc)
```

**Règle :** L'appel Stripe est exécuté **après le COMMIT** de la transaction DB.
- Condition : `stripe_payment_intent_id IS NOT NULL` ET `pay_status IN (...)` (mêmes conditions que BR-06)
- `reason="expired"` → mappé vers `cancellation_reason="abandoned"` dans `stripe_service.py:160–164`
- Erreur Stripe : log uniquement, **aucun rollback DB**, le booking reste `expired`
- Le `stripe_checkout_session_id` est LU depuis la DB mais **non utilisé** par le worker (la session n'est pas annulée séparément — Stripe expire les sessions automatiquement)

---

## BR-09 — Idempotence complète

**Règle :** Le worker est entièrement idempotent via une cascade de guards :
1. `WHERE b.status IN ('requested', 'awaiting_payment') AND expires_at < NOW()` → les bookings `expired` ne sont jamais re-sélectionnés
2. `FOR UPDATE SKIP LOCKED` → pas de double traitement concurrent
3. `RETURNING booking_id` + `if not updated: continue` → race condition gérée si un changement concurrent a eu lieu
4. `slot_status IN ('pending','reserved')` → slot déjà libéré → no-op
5. `pay_status IN (...)` → payment déjà annulé → no-op

> Un appel à `expire_stale_bookings()` sur une DB sans bookings expirés retourne `0` sans aucun effet.

---

## BR-10 — Pattern "drain" : traitement de tous les bookings expirés en un tick

```python
# expiry_worker.py:39–45
async def expire_stale_bookings(pool) -> int:
    total = 0
    while True:
        count = await _expire_batch(pool, EXPIRY_BATCH_SIZE)
        total += count
        if count < EXPIRY_BATCH_SIZE:
            break
    return total
```

**Règle :** Un seul tick traite **TOUS** les bookings expirés, pas seulement les 50 premiers. La boucle while continue tant que `count == 50` (batch plein → potentiellement d'autres bookings). Elle s'arrête quand `count < 50` (batch partiel → rien de plus à traiter).

> ⚠️ **Piège critique** : si Java ne reproduit que `processBatch(50)` sans la boucle while, un backlog de 200 bookings expirés serait traité en 4 ticks (4 × 60s) au lieu d'un seul.

---

## BR-11 — Tick immédiat au démarrage

```python
# expiry_worker.py:239–240
async def _run(self):
    await self._tick()         # ← tick immédiat AVANT le premier sleep
    while True:
        await asyncio.sleep(self._interval)
        await self._tick()
```

**Règle :** Le worker exécute un premier tick dès le démarrage de l'application, sans attendre le premier intervalle. Cela permet de traiter le backlog accumulé pendant un éventuel downtime.

> Java : `initialDelay = 0` dans `@Scheduled`.

---

## Résumé des règles

| # | Règle | Criticité |
|---|---|---|
| BR-01 | Statuts sources : `requested` ou `awaiting_payment` uniquement | OBLIGATOIRE |
| BR-02 | `expires_at IS NOT NULL AND expires_at < NOW()` | OBLIGATOIRE |
| BR-03 | `FOR UPDATE OF b SKIP LOCKED` — requête native Java | CRITIQUE |
| BR-04 | Guard `RETURNING booking_id` — skip si race condition | CRITIQUE |
| BR-05 | Slot libéré uniquement si `slot_type IN ('single','specific')` | CRITIQUE |
| BR-06 | Payment annulé si `pay_status IN (requires_authorization, authorized, capture_pending)` | OBLIGATOIRE |
| BR-07 | Textes notif asymétriques selon `booking_status` | OBLIGATOIRE |
| BR-08 | Stripe hors transaction, erreur Stripe = log uniquement | CRITIQUE |
| BR-09 | Idempotence totale (5 guards cascadés) | OBLIGATOIRE |
| BR-10 | Pattern drain (while loop multi-batch) par tick | CRITIQUE |
| BR-11 | Tick immédiat au démarrage (`initialDelay=0`) | OBLIGATOIRE |

---

## Hors scope Slice 18

| Élément | Scope |
|---|---|
| Push FCM/APNs | NON — uniquement INSERT en table `notifications` |
| Annulation `stripe_checkout_session_id` | NON — Stripe expire les sessions automatiquement |
| Abonnements Stripe | Slice 21+ |
| `MediaPurgeWorker` | Hors cycle booking |
| `SpotYouNotifWorker` | Hors cycle booking |
