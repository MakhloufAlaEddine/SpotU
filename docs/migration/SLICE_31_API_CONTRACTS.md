# SLICE_31_API_CONTRACTS.md — Contrats API Checkout Status
> Basé sur `payment_routes.py:195–351`.
> Généré le 2026-04-20.

---

## Endpoint — `GET /api/payments/checkout/status/{session_id}`

### Auth : **OPTIONNELLE**

### Détail auth
```python
user = None
try:
    user = await require_auth(request, pool)
except Exception:
    pass
```

- Si un header `Authorization: Bearer <jwt>` valide est fourni → `user` est populé (pour logging éventuel).
- Sinon → `user = None`, le endpoint continue normalement.
- **Aucune erreur 401 n'est levée**, même si le token est expiré/invalide.
- Le `session_id` Stripe sert de secret d'accès (non-devinable, 24+ chars).

### Paramètres

| Type | Nom | Obligatoire | Notes |
|---|---|---|---|
| Path | `session_id` | oui | Stripe Checkout Session ID (`cs_test_...` ou `cs_live_...`) **OU** Stripe PaymentIntent ID (`pi_...`, rétrocompat) |
| Header | `Authorization: Bearer <jwt>` | non | Ignoré si absent/invalide |

### Body : **aucun** (GET)

### Flow complet

```
1. Auth tentée (try/except silencieux) → user ou None
2. Ouvrir pool.acquire()
3. SELECT * FROM payments
    WHERE stripe_checkout_session_id = $1 OR stripe_payment_intent_id = $1
    LIMIT 1
   → 404 "Session de paiement non trouvée" si absent
4. real_session_id = payment.stripe_checkout_session_id OR session_id
5. try : session = stripe.retrieve_checkout_session(real_session_id)
   except : return fallback "unknown" (voir §Réponse fallback)

6. db_status  = payment.status
   stripe_ps  = session.payment_status  # "paid" | "unpaid" | "no_payment_required"
   s_status   = session.status          # "open" | "complete" | "expired"

7. Si payment.booking_id : SELECT status FROM bookings WHERE booking_id=$1 → bk_row

8. Branching (ordre strict, if/elif/elif) :

   ── BRANCHE 1 : s_status=='complete' AND stripe_ps=='unpaid' ──
      (capture_method=manual → Stripe a authorisé sans capturer)
      Si db_status NOT IN ('authorized','captured','paid') :
         is_instant = bk_row AND bk_row.status == 'awaiting_payment'
         Si is_instant :
            ── Transaction ──
            UPDATE payments SET status='captured', updated_at=NOW() WHERE payment_id=$1
            UPDATE bookings SET status='confirmed', payment_status='paid', updated_at=NOW()
               WHERE booking_id=$1 AND status NOT IN ('confirmed','refused','cancelled','expired')
            ── Fin tx ──
            db_status = 'captured'
            SELECT payer_user_id, receiver_user_id FROM payments → row
            SELECT s.title FROM bookings JOIN services → title_row
            await push_service.send_push_to_user(payer_user_id, ...)  [title="Réservation confirmée !"]
            await push_service.send_push_to_user(receiver_user_id, ...) [title="Nouvelle réservation !"]
         Sinon (manual_approval + pay_now) :
            ── Transaction ──
            UPDATE payments SET status='authorized', updated_at=NOW() WHERE payment_id=$1
            Si booking_id : UPDATE bookings SET payment_status='authorized', updated_at=NOW()
            ── Fin tx ──
            db_status = 'authorized'

   ── BRANCHE 2 : stripe_ps=='paid' AND db_status != 'captured' ──
      (capture auto Stripe, pas manual)
      ── Transaction ──
      UPDATE payments SET status='captured', updated_at=NOW() WHERE payment_id=$1
      Si booking_id : UPDATE bookings SET status='confirmed', payment_status='paid', updated_at=NOW()
         WHERE booking_id=$1 AND status NOT IN ('confirmed','refused','cancelled','expired')
      ── Fin tx ──
      db_status = 'captured'

   ── BRANCHE 3 : s_status=='expired' AND db_status=='authorized' ──
      UPDATE payments SET status='cancelled', updated_at=NOW() WHERE payment_id=$1
      db_status = 'cancelled'

   ── Sinon : pas d'UPDATE (état déjà cohérent ou cas non-géré) ──

9. return JSON (voir §Réponse nominal)
```

### Réponse 200 — nominal

```json
{
  "payment_id":     "pay_abc123",
  "booking_id":     "bkg_xyz",
  "session_id":     "cs_test_original_input",
  "status":         "complete",
  "payment_status": "captured",
  "stripe_status":  "paid",
  "amount":         51.75,
  "currency":       "eur"
}
```

| Champ | Source | Type | Notes |
|---|---|---|---|
| `payment_id` | `payments.payment_id` | string | |
| `booking_id` | `payments.booking_id` | string OR null | null pour paiements hors booking (futur : abonnements) |
| `session_id` | **param path original** | string | ⚠️ Pas `real_session_id`, pas `session.id` — le **param input tel quel** |
| `status` | `session.status` Stripe | string | `"open"` / `"complete"` / `"expired"` |
| `payment_status` | `db_status` (après transitions) | string | `"requires_authorization"` / `"authorized"` / `"captured"` / `"cancelled"` etc. |
| `stripe_status` | `session.payment_status` Stripe | string | `"paid"` / `"unpaid"` / `"no_payment_required"` |
| `amount` | `session.amount_total / 100` OR fallback `payment.payer_total_amount` | float | **Division par 100** pour conversion cents→euros |
| `currency` | `session.currency` OR fallback `payment.currency` OR `"EUR"` | string | Lowercase si vient de Stripe, uppercase si vient de DB |

### Réponse 200 — fallback Stripe down

```json
{
  "payment_id":     "pay_abc123",
  "booking_id":     "bkg_xyz",
  "session_id":     "cs_test_...",
  "status":         "unknown",
  "payment_status": "authorized",
  "amount":         51.75,
  "currency":       "EUR"
}
```

> ⚠️ **Aucune clé `stripe_status`** dans le fallback (vs nominal). Clés présentes : `payment_id, booking_id, session_id, status="unknown", payment_status, amount, currency`.

### Erreurs

| Code | Condition | Message |
|---|---|---|
| 404 | Aucune ligne `payments` avec `stripe_checkout_session_id=$1 OR stripe_payment_intent_id=$1` | `"Session de paiement non trouvée"` |
| (pas de 401) | Token invalide | **Ignoré** — le endpoint continue en user=None |
| (pas de 500 direct) | Stripe down | **Retour fallback** `"status": "unknown"` |
| 500 indirect | Push notification échoue | Peut remonter (await non protégé) — cf. BR-31.05 |

### Effets de bord

| Effet | Conditions | Transactionnel ? |
|---|---|---|
| UPDATE payments (status, updated_at) | BRANCHE 1, 2, 3 | OUI (conn.transaction()) sauf BRANCHE 3 (UPDATE direct hors tx) |
| UPDATE bookings (status, payment_status, updated_at) | BRANCHE 1 (instant), BRANCHE 2 | OUI |
| UPDATE bookings (payment_status, updated_at) | BRANCHE 1 (manual_approval) | OUI |
| Push notification au payer | BRANCHE 1 instant_booking, transition vers captured | **SYNC `await`** (pas fire-and-forget) |
| Push notification au receiver | idem | **SYNC `await`** |

### Idempotence

- **Appels répétés safe** : les UPDATE ont des gardes `WHERE status NOT IN (...)` qui empêchent la régression.
- **Les push notifications ne sont PAS idempotents** — si la branche 1 instant est déclenchée 2 fois avant que le status ne passe à 'captured', 2 × 2 pushs sont envoyés. **Limitation connue du code Python.** À reproduire. Une mitigation serait possible (lock SELECT FOR UPDATE sur `payments` avant les UPDATE) mais le Python ne le fait pas → **ne pas "améliorer" en Java**.

---

## Codes de statut

| Code | Usage |
|---|---|
| 200 | Succès (nominal ou fallback "unknown") |
| 404 | Payment introuvable |
| 500 | Rare — push service throw ou autre exception non-catchée |

---

## Headers

| Header | Valeur | Obligatoire |
|---|---|---|
| `Authorization` | `Bearer <jwt>` | non — ignoré si invalide |
| `Content-Type` | — | non applicable (GET) |

---

## Comportement "lookup par session_id OR payment_intent_id"

### Motivation
Rétrocompat : certains flows anciens ne stockaient que `stripe_payment_intent_id`. Le front peut passer l'un ou l'autre.

### SQL exact
```sql
SELECT *
  FROM payments
 WHERE stripe_checkout_session_id = $1
    OR stripe_payment_intent_id   = $1
 LIMIT 1
```

### Java
```java
@Query(value = """
    SELECT *
      FROM payments
     WHERE stripe_checkout_session_id = :id
        OR stripe_payment_intent_id   = :id
     LIMIT 1
""", nativeQuery = true)
Optional<PaymentRow> findBySessionOrIntent(@Param("id") String id);
```

---

## Détail — `real_session_id` utilisé pour Stripe retrieve

Si le lookup DB retourne un payment avec `stripe_checkout_session_id` NULL (uniquement `stripe_payment_intent_id` set), le code fallback sur le param path :

```python
real_session_id = payment.get("stripe_checkout_session_id") or session_id
```

⚠️ **Attention** : appeler `retrieve_checkout_session(pi_...)` avec un PaymentIntent ID **échoue côté Stripe** (types différents). Dans ce cas, le `try/except` déclenchera le fallback "unknown". Compat : reproduire, ne pas modifier.

---

## Hors périmètre

| Endpoint | Slice future |
|---|---|
| `POST /webhook/stripe` (+ `webhook_handlers.dispatch`) | **Slice webhook Stripe dédiée** — gros package events multiples |
| `GET /payments/me` | Slice lectures paiements (historique utilisateur) |
| `GET /payments/{payment_id}` | Slice lectures paiements (détail) |
| `PATCH /payments/{payment_id}/stripe` | Slice admin Stripe |
| `GET /admin/payments` / `/admin/payments/stats` | Slice admin |
