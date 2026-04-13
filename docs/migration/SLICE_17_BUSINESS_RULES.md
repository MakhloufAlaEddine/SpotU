# SLICE_17_BUSINESS_RULES.md — Règles métier de la Slice 17
> Source : `payment_routes.py:83–351`.
> Généré le 2026-02-XX.

---

## POST /payments/checkout/session

### BR-01 — Auth stricte — payer uniquement

```python
# payment_routes.py:97–98
user = await require_auth(request, pool)
```

```python
# payment_routes.py:106–113
pay_row = await conn.fetchrow(
    """SELECT p.*, b.service_id FROM payments p
       LEFT JOIN bookings b ON b.booking_id = p.booking_id
       WHERE p.booking_id = $1 AND p.payer_user_id = $2""",
    booking_id, user["user_id"],
)
if not pay_row:
    raise HTTPException(status_code=404, detail="Paiement non trouvé")
```

Le contrôle d'accès est implicitement dans le `WHERE p.payer_user_id = $2`. Si l'appelant n'est pas le payer → 404 (pas 403). **Java doit reproduire ce comportement : 404 si pas payer, pas 403.**

---

### BR-02 — Guard "déjà payé"

```python
# payment_routes.py:118–119
if payment.get("status") == "captured":
    raise HTTPException(status_code=400, detail="Ce paiement est déjà complété")
```

Vérifie uniquement `status == 'captured'`. Les autres statuts avancés (`authorized`, `requires_authorization`) ne bloquent pas la création d'une nouvelle session (le payer peut recommencer si la session précédente a expiré).

---

### BR-03 — Idempotence session Stripe

```python
# payment_routes.py:122–130
if payment.get("stripe_checkout_session_id"):
    existing = await stripe_service.retrieve_checkout_session(payment["stripe_checkout_session_id"])
    if existing.status == "open":
        return {"url": existing.url, "session_id": existing.id}
```

- Si session existante ET encore `open` → réutiliser (éviter de créer des sessions orphelines)
- Si `retrieve` échoue (exception) → log warning, continuer vers création nouvelle session
- Si session `complete` ou `expired` → ignorer, créer une nouvelle session

---

### BR-04 — Montant depuis snapshot (immuable)

```python
# payment_routes.py:133–135
amount_cents = int(round(float(payment["payer_total_amount"]) * 100))
currency     = (payment.get("currency") or "EUR").lower()
```

**Règle absolue** : Le montant de la Checkout Session est TOUJOURS pris depuis `payments.payer_total_amount`. Jamais recalculé depuis le service. La devise par défaut est `EUR` si absente.

---

### BR-05 — URLs de redirection construites dynamiquement

```python
# payment_routes.py:138–145
success_url = f"{origin_url}/payment-success?session_id={{CHECKOUT_SESSION_ID}}&booking_id={booking_id}"
cancel_url  = f"{origin_url}/booking/confirm?serviceId={payment.get('product_id', '')}"
```

- `{{CHECKOUT_SESSION_ID}}` : placeholder **Stripe** (double accolade Python pour ne pas interpoler) — Stripe le remplace par le vrai `cs_...` dans la redirect URL
- `origin_url` peut être vide → `success_url` = `/payment-success?...`
- `product_id` peut être absent → `cancel_url` = `{origin_url}/booking/confirm?serviceId=`

---

### BR-06 — `idempotency_key` de la session Stripe

```python
# payment_routes.py:159
idempotency_key=payment_id,
# → stripe_service: kwargs["idempotency_key"] = f"cs_{payment_id}"
```

L'`idempotency_key` est `"cs_{payment_id}"`. Si la création Stripe échoue et est réessayée avec le même `payment_id`, Stripe retourne la même session (sans doubler).

---

### BR-07 — UPDATE CASE idempotent

```python
# payment_routes.py:170–177
status = CASE
    WHEN status NOT IN ('requires_authorization','authorized','captured')
    THEN 'requires_authorization'
    ELSE status
END
```

Si le webhook est passé avant ce POST (cas rare de race condition) et a déjà mis `status='authorized'` ou `'captured'`, le CASE ne régresse pas le statut. **Reproduire exactement en Java (CASE SQL natif).**

---

## GET /payments/checkout/status/{session_id}

### BR-08 — Auth optionnelle (redirect web)

```python
# payment_routes.py:202–207
user = None
try:
    user = await require_auth(request, pool)
except Exception:
    pass
```

Le `user` peut être None pour tout le reste de la fonction. Aucun contrôle d'accès basé sur `user` n'est effectué dans cet endpoint.

---

### BR-09 — Lookup double clé

```python
# payment_routes.py:210–217
pay_row = await conn.fetchrow(
    """SELECT * FROM payments
       WHERE stripe_checkout_session_id = $1
          OR stripe_payment_intent_id   = $1
       LIMIT 1""",
    session_id,
)
```

Le `session_id` path param peut être `cs_...` ou `pi_...`. Les deux colonnes sont testées. **Java : ne pas simplifier ce lookup.**

---

### BR-10 — `real_session_id` pour retrieve Stripe

```python
# payment_routes.py:224
real_session_id = payment.get("stripe_checkout_session_id") or session_id
```

Stripe ne peut récupérer une Checkout Session que via son ID `cs_...`. Si le param est un `pi_...`, le `real_session_id` est lu depuis la DB. **Ne jamais appeler `retrieve_checkout_session(pi_id)`.**

---

### BR-11 — Graceful failure sur Stripe retrieve

```python
# payment_routes.py:225–237
try:
    session = await stripe_service.retrieve_checkout_session(real_session_id)
except Exception as exc:
    log.warning(...)
    return {
        "payment_id": payment["payment_id"],
        "booking_id": payment.get("booking_id"),
        "session_id": session_id,
        "status": "unknown",
        "payment_status": payment.get("status", "unknown"),
        "amount": float(payment["payer_total_amount"]),
        "currency": payment.get("currency", "EUR"),
    }
```

Si Stripe est injoignable → retourner les données DB avec `status="unknown"`. **Ne jamais lever d'exception vers le client.**

---

### BR-12 — Logique de transition (duplication webhook S16)

> ⚠️ **ATTENTION — Duplication intentionnelle** : Les transitions DB de `GET /status` sont les mêmes que celles du webhook `checkout.session.completed` (S16). C'est voulu : le polling HTTP est la confirmation synchrone immédiate, le webhook est la confirmation asynchrone authoritative.

**Règle de convergence** : Si le webhook (S16) a DÉJÀ traité l'event avant que `GET /status` soit appelé, les guards (`status NOT IN ('captured','authorized')`) garantissent qu'il n'y a pas de régression.

#### Conditions de transition (ordre d'évaluation)

```python
# payment_routes.py:253–336

# Condition 1 — complete + unpaid (capture_method=manual)
if s_status == "complete" and stripe_ps == "unpaid":
    if db_status not in ("authorized", "captured", "paid"):
        # → Lire booking.status → 2 branches (instant vs manual)

# Condition 2 — direct paid (capture_method=automatic)
elif stripe_ps == "paid" and db_status not in ("captured",):
    # → captured + confirmed directement

# Condition 3 — session expirée
elif s_status == "expired" and db_status == "authorized":
    # → cancelled
```

---

### BR-13 — Notifications push dans GET /status (instant_booking uniquement)

```python
# payment_routes.py:273–300
# Uniquement si instant_booking + transition vers 'captured'
await send_push_to_user(pool, payer_uid, "Réservation confirmée !", ...)
await send_push_to_user(pool, receiver_uid, "Nouvelle réservation !", ...)
```

**Règle :** Push uniquement pour la branche instant_booking. La branche manual_approval et la branche `stripe_ps='paid'` **ne génèrent pas de push** dans `GET /status`. Les notifications de ces branches arrivent via le webhook (S16).

---

## Résumé des règles

| # | Règle | Criticité |
|---|---|---|
| BR-01 | Auth stricte POST — 404 si pas payer (pas 403) | CRITIQUE |
| BR-02 | Guard `captured` → 400 | OBLIGATOIRE |
| BR-03 | Idempotence session open → réutiliser | OBLIGATOIRE |
| BR-04 | Montant depuis snapshot — JAMAIS recalculer | CRITIQUE |
| BR-05 | `{{CHECKOUT_SESSION_ID}}` = placeholder Stripe | PIÈGE |
| BR-06 | `idempotency_key = "cs_{payment_id}"` | OBLIGATOIRE |
| BR-07 | UPDATE CASE idempotent pour statut | CRITIQUE |
| BR-08 | Auth optionnelle GET — user peut être None | CRITIQUE |
| BR-09 | Lookup double clé cs_ et pi_ | OBLIGATOIRE |
| BR-10 | `real_session_id` = stripe_checkout_session_id de la DB | OBLIGATOIRE |
| BR-11 | Graceful failure Stripe retrieve → "unknown" | OBLIGATOIRE |
| BR-12 | 3 conditions de transition dans GET /status | CRITIQUE |
| BR-13 | Push uniquement branche instant_booking | OBLIGATOIRE |

---

## Hors scope Slice 17

| Élément | Scope |
|---|---|
| Abonnements Stripe | Slice 20+ |
| `GET /payments/me`, `GET /payments/{id}` | Slice 18 (read) |
| `PATCH /payments/{id}/stripe` | Slice 18 (internal) |
| Workers d'expiry | Hors scope utilisateur |
