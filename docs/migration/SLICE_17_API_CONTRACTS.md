# SLICE_17_API_CONTRACTS.md — Contrats API de la Slice 17
> Source : `payment_routes.py:83–351`.
> Généré le 2026-02-XX.

---

## Endpoint 1 — Créer une session Checkout Stripe

```
POST /api/payments/checkout/session
```

### Authentification

| Propriété | Valeur |
|---|---|
| Méthode | Bearer token JWT |
| Obligatoire | OUI — 401 si absent |
| Restriction | Payer uniquement (`payer_user_id = user_id`) |

### Body

```json
{
  "booking_id": "bkg_abc123",
  "origin_url": "https://app.spotu.fr"
}
```

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `booking_id` | string | OUI | ID de la réservation à payer |
| `origin_url` | string | NON | Base URL de l'app — utilisée pour `success_url` et `cancel_url`. Défaut : `""` |

### Validation

```python
# payment_routes.py:103
if not booking_id:
    raise HTTPException(status_code=400, detail="booking_id requis")
```

```python
# payment_routes.py:118–119
if payment.get("status") == "captured":
    raise HTTPException(status_code=400, detail="Ce paiement est déjà complété")
```

### Réponse succès — nouvelle session

```
HTTP 200 OK
```

```json
{
  "url": "https://checkout.stripe.com/pay/cs_test_xxx",
  "session_id": "cs_test_xxx"
}
```

### Réponse succès — session existante réutilisée (idempotence)

```
HTTP 200 OK
```

```json
{
  "url": "https://checkout.stripe.com/pay/cs_test_existant",
  "session_id": "cs_test_existant"
}
```

> ℹ️ Si un `stripe_checkout_session_id` est déjà en DB ET que la session Stripe est encore `open`,
> la session existante est réutilisée sans recréation.

### Codes d'erreur

| Code | Condition | Message |
|---|---|---|
| `401` | Token absent ou invalide | _(standard auth)_ |
| `400` | `booking_id` manquant | `"booking_id requis"` |
| `404` | Paiement non trouvé OU l'appelant n'est pas le payer | `"Paiement non trouvé"` |
| `400` | Paiement déjà capturé | `"Ce paiement est déjà complété"` |

### Effets de bord

| Effet | Condition | Détail |
|---|---|---|
| `payments.stripe_checkout_session_id` | Toujours (si nouvelle session) | ID de la Checkout Session Stripe |
| `payments.stripe_payment_intent_id` | Si `session.payment_intent` est une string | ID du PaymentIntent créé automatiquement |
| `payments.status` | Si statut pas déjà avancé | CASE → `requires_authorization` |
| `bookings.payment_status` | Idem | CASE → `requires_authorization` |
| `stripe_service.create_checkout_session()` | Toujours (si pas de session open) | Crée une Checkout Session Stripe |

### URLs construites

```python
# payment_routes.py:138–145
success_url = f"{origin_url}/payment-success?session_id={{CHECKOUT_SESSION_ID}}&booking_id={booking_id}"
cancel_url  = f"{origin_url}/booking/confirm?serviceId={payment.get('product_id', '')}"
```

> ⚠️ `{{CHECKOUT_SESSION_ID}}` est un placeholder **littéral Stripe** — il apparaît tel quel
> dans l'URL envoyée à Stripe qui le remplace automatiquement. Ne pas interpoler en Java.

### Metadata envoyée à Stripe

```python
# payment_routes.py:147–151
meta = {
    "payment_id":    payment_id,
    "booking_id":    booking_id,
    "payer_user_id": user["user_id"],
}
```

---

## Endpoint 2 — Vérifier le statut d'une session Checkout

```
GET /api/payments/checkout/status/{session_id}
```

### Authentification

| Propriété | Valeur |
|---|---|
| Méthode | Bearer token JWT |
| Obligatoire | **NON — optionnelle** |
| Comportement | `try: user = require_auth(...)` / `except: user = None` |

> ℹ️ Cet endpoint est appelé depuis le redirect Stripe (`success_url`). À ce moment, le token
> peut ne pas être disponible (redirect navigateur web). Le `session_id` Stripe est suffisant.

### Path parameters

| Paramètre | Type | Description |
|---|---|---|
| `session_id` | string | Stripe session ID (`cs_...`) OU payment_intent ID (`pi_...`) |

> ℹ️ Le DB lookup cherche les deux champs :
> `WHERE stripe_checkout_session_id=$1 OR stripe_payment_intent_id=$1`

### Réponse succès — cas nominal (payment capturé)

```
HTTP 200 OK
```

```json
{
  "payment_id": "pay_abc123",
  "booking_id": "bkg_xyz789",
  "session_id": "cs_test_xxx",
  "status": "complete",
  "payment_status": "captured",
  "stripe_status": "paid",
  "amount": 50.00,
  "currency": "eur"
}
```

### Champs de réponse

| Champ | Source | Description |
|---|---|---|
| `payment_id` | DB | ID interne du paiement |
| `booking_id` | DB | ID de la réservation |
| `session_id` | path param | session_id passé en paramètre (pas le cs_ réel) |
| `status` | Stripe `session.status` | `"open"` / `"complete"` / `"expired"` |
| `payment_status` | DB (après mutation éventuelle) | Statut interne : `"authorized"` / `"captured"` / etc. |
| `stripe_status` | Stripe `session.payment_status` | `"paid"` / `"unpaid"` / `"no_payment_required"` |
| `amount` | Stripe `session.amount_total / 100` ou DB | Montant en euros |
| `currency` | Stripe ou DB | Code devise |

### Réponse si Stripe injoignable (graceful)

```json
{
  "payment_id": "pay_abc123",
  "booking_id": "bkg_xyz789",
  "session_id": "cs_test_xxx",
  "status": "unknown",
  "payment_status": "requires_authorization",
  "amount": 50.0,
  "currency": "EUR"
}
```

### Codes d'erreur

| Code | Condition |
|---|---|
| `404` | Aucun payment trouvé pour ce session_id (ni cs_ ni pi_) |

### Effets de bord selon état Stripe

| Condition Stripe | Mutation DB | Push |
|---|---|---|
| `s_status='complete' + ps='unpaid' + booking='awaiting_payment'` | payments→captured, bookings→confirmed+paid | payer + receiver |
| `s_status='complete' + ps='unpaid' + booking='requested'` | payments→authorized, bookings.payment_status→authorized | NON |
| `stripe_ps='paid'` | payments→captured, bookings→confirmed+paid | NON |
| `s_status='expired' + db_status='authorized'` | payments→cancelled | NON |
| Aucune condition remplie | Aucune mutation | NON |

---

## Exemples

### Appel POST — créer une session checkout

```bash
curl -X POST "$API_URL/api/payments/checkout/session" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"booking_id": "bkg_abc123", "origin_url": "https://app.spotu.fr"}'
```

**Réponse :**

```json
{
  "url": "https://checkout.stripe.com/pay/cs_test_xxx",
  "session_id": "cs_test_xxx"
}
```

### Appel GET — vérifier le statut après redirect

```bash
# Appelé depuis le navigateur après redirect Stripe
curl "$API_URL/api/payments/checkout/status/cs_test_xxx"
# Pas de header Authorization nécessaire (auth optionnelle)
```
