# SLICE_30_API_CONTRACTS.md — Contrats API Booking Create + Pay
> Basé sur `booking_routes.py:115–382, 558–670`, `models.py:326–343`.
> Généré le 2026-04-20.

---

## Endpoint 1 — `POST /api/bookings/price-preview`

### Auth : **STRICTE**

### Requête

```json
{ "service_id": "svc_abc123" }
```

| Champ | Type | Obligatoire | Source |
|---|---|---|---|
| `service_id` | string | oui | Body `dict = Body(...)` (pas de Pydantic model) |

### Flow

```
1. require_auth(request) → user
2. service_id requis → 400 si absent
3. SELECT service_id, coach_id, price FROM services WHERE service_id=$1 AND active=TRUE
   → 404 si absent
4. pricing_engine.compute_pricing(
     payer_user_id=user.user_id, receiver_user_id=svc.coach_id,
     product_type="service_booking", base_amount=svc.price, currency="EUR"
   )
5. return snap (voir Réponse)
```

### Réponse 200

```json
{
  "base_amount":                 50.00,
  "payer_fixed_fee":             0.50,
  "payer_percent_fee_amount":    1.25,
  "receiver_fixed_fee":          0.00,
  "receiver_percent_fee_amount": 2.50,
  "platform_total_fee":          4.25,
  "receiver_net_amount":         47.50,
  "payer_total_amount":          51.75,
  "currency":                    "EUR"
}
```

### Erreurs

| Code | Condition | Message |
|---|---|---|
| 401 | Pas authentifié | `"Unauthorized"` |
| 400 | `service_id` manquant | `"service_id requis"` |
| 404 | Service inactif ou inexistant | `"Service introuvable ou inactif"` |

### Effets de bord
Aucun. Lecture pure. Aucune modification DB. Aucune notification.

---

## Endpoint 2 — `POST /api/bookings/request` (+ alias `POST /api/bookings`)

### Auth : **STRICTE**

### Requête (`BookingRequest` Pydantic, `models.py:326`)

```json
{
  "service_id": "svc_abc123",
  "scheduled_at": "2026-05-10T14:00:00Z",
  "slot_id": "slot_xyz",
  "location_id": "loc_001",
  "notes": "Apportez votre tapis",
  "idempotency_key": "client-uuid-v4",
  "payment_mode": "pay_now"
}
```

| Champ | Type | Obligatoire | Valeurs autorisées |
|---|---|---|---|
| `service_id` | string | oui | FK services |
| `scheduled_at` | ISO-8601 datetime | non | Null si slot_id fourni et l'heure est dans le slot |
| `slot_id` | string | non | FK service_slots — déclenche le verrou NOWAIT si présent |
| `location_id` | string | non | FK locations |
| `notes` | string | non | Libre |
| `idempotency_key` | string | non | UUID recommandé — UNIQUE INDEX côté DB |
| `payment_mode` | string | non (défaut `"pay_now"`) | **`"pay_now"` OR `"pay_later"`** — sinon 400 |

### Flow — 4 flux selon config

| Flux | `booking_approval_mode` service | `payment_mode` body | Statut initial booking | Statut initial slot | expires_at |
|---|---|---|---|---|---|
| A | `instant_booking` | `pay_now` | `awaiting_payment` | `reserved` | NOW() + `pay_now_checkout_minutes` (défaut 30m) |
| B | `instant_booking` | `pay_later` | `awaiting_payment` | `reserved` | NOW() + `services.pay_later_expiration_minutes` (défaut 24h) |
| C | `manual_approval` | `pay_now` | `requested` | `pending` | NOW() + `BOOKING_EXPIRY_HOURS` (48h) |
| D | `manual_approval` | `pay_later` | `requested` | `pending` | NOW() + `BOOKING_EXPIRY_HOURS` (48h) |

### Pipeline exact

```
1. require_auth(request) → user
2. Validate payment_mode ∈ {"pay_now","pay_later"} → 400 si non
3. Ouvrir pool.acquire()
4. SELECT services (price, coach_id, booking_approval_mode, allow_pay_later, pay_later_expiration_minutes)
   WHERE service_id = $1 AND active = TRUE
   → 404 si absent

5. SELECT app_config flags globaux :
   - enable_manual_approval_for_services
   - enable_pay_later_for_services
   → cfg dict bool

6. pay_now_checkout_minutes = _get_pay_now_minutes()
   (SELECT app_config WHERE key='pay_now_checkout_minutes' → int ou défaut 30)

7. Normalisation :
   - approval_mode = services.booking_approval_mode OR 'manual_approval'
   - allow_pay_later = bool(services.allow_pay_later)
   - expiry_minutes = int(services.pay_later_expiration_minutes OR 1440)
   - Si !cfg.enable_manual_approval → approval_mode = 'instant_booking' (FORCE)
   - Si !cfg.enable_pay_later :
       allow_pay_later = False
       Si payment_mode == 'pay_later' → 409 "Le paiement différé n'est pas activé..."

8. Guards :
   - receiver_user_id == payer_user_id → 400 "Impossible de réserver son propre service"
   - payment_mode == 'pay_later' AND !allow_pay_later → 400 "Ce service ne permet pas le paiement différé"

9. Idempotence 1 — clé explicite :
   Si data.idempotency_key : SELECT booking_id FROM bookings WHERE idempotency_key=$1
     → Si existing : return _fetch_booking(existing.booking_id) (200, fin du flow)

10. Idempotence 2 — (slot_id, user_id) :
    Si data.slot_id : SELECT booking_id FROM bookings
      WHERE slot_id=$1 AND user_id=$2 AND status NOT IN ('refused','cancelled','expired')
      LIMIT 1
      → Si dup : return _fetch_booking(dup.booking_id)

11. base_amount = float(services.price)

12. Ouvrir conn.transaction() :
    a. Si data.slot_id :
       SELECT slot_id, slot_type, slot_status FROM service_slots
         WHERE slot_id=$1 FOR UPDATE NOWAIT
         → asyncpg.LockNotAvailableError → 409 "Ce créneau est en cours de réservation — réessayez"
         → Not found → 404 "Créneau introuvable"
         → slot_type ∈ ('single','specific') ET slot_status != 'available' → 409 "Créneau indisponible (état : X)"

    b. pricing_engine.compute_pricing(...) → PricingResult

    c. bid = new_id("bkg")  (ex: "bkg_" + uuid4)
       pid = new_id("pay")

    d. pd = pricing.to_payment_dict(payment_id=pid, payer_user_id, receiver_user_id,
                                    product_type='service_booking', product_id=service_id,
                                    booking_id=bid)
       pd['status'] = 'requires_authorization'

    e. Selon approval_mode :
       - instant_booking : initial_status='awaiting_payment', initial_slot_status='reserved',
                           expires_at = NOW() + (pay_now_checkout_minutes OR expiry_minutes) min
       - manual_approval : initial_status='requested', initial_slot_status='pending',
                           expires_at = NOW() + BOOKING_EXPIRY_HOURS hours

    f. INSERT bookings (18 colonnes — cf. DB_MAPPING)

    g. INSERT payments (20 colonnes — cf. DB_MAPPING)

    h. Si data.slot_id AND slot_type ∈ ('single','specific') :
       UPDATE service_slots SET slot_status=initial_slot_status WHERE slot_id=$1

    [fin transaction]

13. result = _fetch_booking(bid) → booking complet (projection BOOKING_FIELDS + s.title + s.address)

14. [Hors transaction] Push notif au receiver :
    - SELECT users.name WHERE user_id=payer_user_id
    - SELECT services.title WHERE service_id=$1
    - title/body selon initial_status (awaiting_payment vs requested)
    - data.type = 'booking_awaiting_payment' OR 'new_booking'
    - _push(pool, receiver_user_id, ...) (fire-and-forget)

15. log + return result
```

### Réponse 200 (nominal — nouveau booking)

```json
{
  "booking_id": "bkg_abc123",
  "service_id": "svc_xyz",
  "user_id": "usr_payer",
  "coach_id": "usr_coach",
  "status": "awaiting_payment",
  "scheduled_at": "2026-05-10T14:00:00+00:00",
  "slot_id": "slot_xyz",
  "location_id": "loc_001",
  "notes": "Apportez votre tapis",
  "amount": 51.75,
  "payment_status": "pending",
  "payer_user_id": "usr_payer",
  "receiver_user_id": "usr_coach",
  "pricing_snapshot": {
    "base_amount": 50.00,
    "payer_fixed_fee": 0.50,
    "payer_percent_fee_amount": 1.25,
    "receiver_fixed_fee": 0.00,
    "receiver_percent_fee_amount": 2.50,
    "platform_total_fee": 4.25,
    "receiver_net_amount": 47.50,
    "payer_total_amount": 51.75,
    "currency": "EUR",
    "product_type": "service_booking"
  },
  "idempotency_key": "client-uuid-v4",
  "currency": "EUR",
  "created_at": "2026-04-20T10:00:00+00:00",
  "updated_at": "2026-04-20T10:00:00+00:00",
  "expires_at": "2026-04-20T10:30:00+00:00",
  "cancelled_by_user_id": null,
  "cancellation_reason": null,
  "payment_mode": "pay_now",
  "service_title": "Cours de yoga",
  "address": "Parc Monceau, Paris"
}
```

### Réponse 200 (idempotent — retour existing)
**Même structure**, même champs. Indiscernable du nominal (pas de flag `idempotent`). Conséquence : le front ne peut pas savoir si c'est une création ou une reprise.

### Erreurs

| Code | Condition | Message |
|---|---|---|
| 401 | Pas authentifié | `"Unauthorized"` |
| 400 | `payment_mode` invalide | `"payment_mode doit être 'pay_now' ou 'pay_later'"` |
| 400 | Payer == receiver | `"Impossible de réserver son propre service"` |
| 400 | `pay_later` demandé mais service ne permet pas | `"Ce service ne permet pas le paiement différé"` |
| 404 | Service inactif/inexistant | `"Service introuvable ou inactif"` |
| 404 | `slot_id` fourni mais inexistant | `"Créneau introuvable"` |
| 409 | Slot locked (concurrence) | `"Ce créneau est en cours de réservation — réessayez"` |
| 409 | Slot indisponible (state) | `"Créneau indisponible (état : <status>)"` |
| 409 | `pay_later` interdit par flag global | `"Le paiement différé n'est pas activé sur cette plateforme — veuillez choisir 'pay_now'"` |

### Effets de bord

| Effet | Transactionnel | Réversible |
|---|---|---|
| INSERT bookings | OUI | via cancel (slice ult.) |
| INSERT payments | OUI | via cancel |
| UPDATE service_slots (si slot_id) | OUI | via cancel/refuse |
| Push notif au receiver | NON (fire-and-forget post-commit) | N/A |
| Log `Booking créé : bk=... | approval=... | payment=... | status=... | expiry=...` | NON | N/A |

---

## Endpoint 3 — `POST /api/bookings/{booking_id}/pay`

### Auth : **STRICTE** (payer OU admin)

### Paramètres

| Type | Nom | Obligatoire | Notes |
|---|---|---|---|
| Path | `booking_id` | oui | — |
| Header | `Authorization: Bearer <jwt>` | oui | — |
| Body (dict optionnel) | `origin_url` | non | URL de retour Stripe ; fallback `os.environ["APP_URL"]` si absent |

### Body

```json
{ "origin_url": "https://app.spotu.fr" }
```

### Flow

```
1. require_auth(request) → user
2. Parse body → raw.origin_url (ou fallback APP_URL env)
3. SELECT booking (booking_id, status, payer_user_id, user_id, expires_at, payment_mode)
   WHERE booking_id = $1
   → 404 si absent

4. Guards :
   - effective_payer = booking.payer_user_id OR booking.user_id  (fallback seed)
   - effective_payer != user.user_id AND role != 'admin' → 403 "Seul le payeur peut initier le paiement"
   - booking.status != 'awaiting_payment' → 409 "Le paiement n'est disponible que pour les réservations en attente de paiement (statut actuel : 'X')"
   - expires_at < NOW() (UTC) → 410 "Le délai de paiement a expiré — réservation annulée"

5. SELECT payment (payment_id, payer_total_amount, currency, stripe_checkout_session_id)
   WHERE booking_id = $1 LIMIT 1
   → 500 "Enregistrement de paiement manquant pour cette réservation" si absent

6. Idempotence Stripe :
   Si payment.stripe_checkout_session_id existe :
     try :
       session = stripe_service.retrieve_checkout_session(existing_id)
       Si session.status == 'open' :
         return { url, checkout_url, session_id, reused: true }  ← 200
     except : pass  (session expirée → on en crée une nouvelle)

7. [Hors transaction DB, appel Stripe externe]
   amount_cents = int(round(payment.payer_total_amount * 100))
   currency     = payment.currency.lower() OR 'eur'
   success_url  = f"{origin_url}/payment-success?session_id={{CHECKOUT_SESSION_ID}}&booking_id={booking_id}"
   cancel_url   = f"{origin_url}/bookings"
   session = stripe_service.create_checkout_session(
       amount_cents, currency, success_url, cancel_url,
       metadata={"payment_id": payment.payment_id, "booking_id": booking_id},
       idempotency_key=payment.payment_id    ← réutilise payment_id comme clé d'idempotence Stripe
   )

8. Ouvrir pool.acquire() + conn.transaction() :
   a. pi_id = session.payment_intent si isinstance(str) else None
      UPDATE payments SET
        stripe_checkout_session_id=$1,
        stripe_payment_intent_id=COALESCE($2, stripe_payment_intent_id),
        status=CASE WHEN status NOT IN ('requires_authorization','authorized','captured')
                    THEN 'requires_authorization' ELSE status END,
        updated_at=NOW()
      WHERE payment_id=$3
   b. UPDATE bookings SET payment_status='requires_authorization', updated_at=NOW()
      WHERE booking_id=$1
        AND payment_status NOT IN ('authorized','captured','paid')

9. return { url, checkout_url, session_id }   ← 200
```

### Réponse 200 (nouvelle session)

```json
{
  "url":          "https://checkout.stripe.com/c/pay/cs_test_...",
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_...",
  "session_id":   "cs_test_abc123"
}
```

### Réponse 200 (session réutilisée, idempotent)

```json
{
  "url":          "https://checkout.stripe.com/...",
  "checkout_url": "https://checkout.stripe.com/...",
  "session_id":   "cs_test_abc123",
  "reused":       true
}
```

> ⚠️ `url` == `checkout_url` (même valeur dupliquée). Les deux clés sont nécessaires pour compat front (certains écrans lisent `url`, d'autres `checkout_url`).

### Erreurs

| Code | Condition | Message |
|---|---|---|
| 401 | Pas authentifié | `"Unauthorized"` |
| 404 | Booking inexistant | `"Réservation introuvable"` |
| 403 | Pas le payer ni admin | `"Seul le payeur peut initier le paiement"` |
| 409 | Statut != `awaiting_payment` | `"Le paiement n'est disponible que pour les réservations en attente de paiement (statut actuel : 'X')"` |
| 410 | `expires_at < NOW()` | `"Le délai de paiement a expiré — réservation annulée"` |
| 500 | Pas de payment lié | `"Enregistrement de paiement manquant pour cette réservation"` |
| 502 (à ajouter Java) | Stripe API down | Libre — Python laisse remonter l'exception → 500. Java peut mapper en 502 mais **Python actuel = 500**. **Compat stricte = 500.** |

### Effets de bord

| Effet | Transactionnel | Réversible |
|---|---|---|
| Appel Stripe `create_checkout_session` | **NON** (externe) | Session Stripe expire automatiquement |
| UPDATE payments (stripe_checkout_session_id, stripe_payment_intent_id, status, updated_at) | OUI | OUI |
| UPDATE bookings (payment_status, updated_at) | OUI | OUI |
| Pas de notification push | — | — |

---

## Codes de statut communs

| Code | Contexte |
|---|---|
| 200 | Succès |
| 400 | Payload invalide / violation de règle métier non-conflit |
| 401 | Auth manquante |
| 403 | Pas autorisé |
| 404 | Booking/service/slot introuvable |
| 409 | Conflit d'état (déjà payé, slot pris, etc.) |
| 410 | TTL expiré |
| 500 | Erreur serveur (incl. Stripe crash) |

---

## Headers

| Header | Valeur | Obligatoire |
|---|---|---|
| `Authorization` | `Bearer <jwt>` | oui |
| `Content-Type` | `application/json` | oui (tous endpoints prennent du JSON) |

---

## Hors périmètre de cette slice

| Endpoint | Slice future |
|---|---|
| `POST /bookings/{id}/accept` | Slice booking lifecycle owner-side |
| `POST /bookings/{id}/refuse` | idem |
| `POST /bookings/{id}/cancel` | idem |
| `PATCH /bookings/{id}/status` | idem |
| `GET /bookings/me`, `GET /bookings/received`, `GET /bookings/{id}` | Slice booking reads |
| `POST /webhook/stripe` | Slice webhooks Stripe (critique mais indépendante) |
| `GET /payments/me`, `GET /payments/{id}` | Slice payments reads |
