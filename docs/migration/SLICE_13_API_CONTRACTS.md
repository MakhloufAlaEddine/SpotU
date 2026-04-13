# SLICE_13_API_CONTRACTS.md — Contrats d'API exacts
> Basé sur `booking_routes.py:401–552`, `_get_pay_now_minutes:56–66`.
> Généré le 2026-02-XX.

---

## ENDPOINT — POST /api/bookings/{booking_id}/accept

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `POST` |
| Chemin Python | `/api/bookings/{booking_id}/accept` |
| Chemin Java | `/api/bookings/{bookingId}/accept` |
| Auth | **STRICTE** — `require_auth` — receiver OU admin |
| Body | **AUCUN** corps JSON attendu |
| Idempotent | **OUI** — si déjà `awaiting_payment`, `accepted`, ou `confirmed` |
| Handler | `accept_booking()` — `booking_routes.py:402` |

---

## Paramètres

### Path

| Param | Type | Obligatoire | Description |
|---|---|---|---|
| `booking_id` | string | OUI | ID du booking à accepter |

**Query params : AUCUN. Body : AUCUN.**

---

## Logique complète

```python
# booking_routes.py:430–521

# 1. Lecture booking + service (JOIN)
row = await conn.fetchrow("""
    SELECT b.booking_id, b.status, b.receiver_user_id, b.slot_id, b.expires_at,
           b.user_id AS payer_user_id, b.service_id, b.payment_mode,
           s.pay_later_expiration_minutes, s.booking_approval_mode
    FROM bookings b
    JOIN services s ON s.service_id = b.service_id
    WHERE b.booking_id = $1
""", booking_id)

# 2. 404 si absent
if not row: raise HTTPException(404, "Réservation introuvable")

# 3. Accès : receiver OU admin
if bk["receiver_user_id"] != user["user_id"] and user.get("role") != "admin":
    raise HTTPException(403, "Seul le bénéficiaire peut accepter cette réservation")

# 4. Idempotence
if bk["status"] in ("awaiting_payment", "accepted", "confirmed"):
    return {"success": True, "status": bk["status"], "booking_id": booking_id, "idempotent": True}

# 5. Garde statut
if bk["status"] != "requested":
    raise HTTPException(409, f"Impossible d'accepter une réservation en état '{bk['status']}'")

# 6. Garde TTL (expires_at)
if expires_at and expires_at < now_utc:
    raise HTTPException(410, "Cette réservation a expiré — le créneau a été libéré")

# 7. Lecture payment (pré-transaction)
pay_row = await conn.fetchrow(
    "SELECT payment_id, stripe_payment_intent_id, status AS pay_status FROM payments WHERE booking_id=$1 LIMIT 1",
    booking_id,
)

# 8. Branchement Cas A ou Cas B selon (payment_mode, pay_status)
```

---

## Cas A — `payment_mode='pay_now'` ET `pay_status='authorized'`

### Transaction DB

```sql
-- UPDATE bookings (3 champs + updated_at)
UPDATE bookings
SET status = 'confirmed',
    payment_status = 'captured',
    expires_at = NULL,
    updated_at = NOW()
WHERE booking_id = $1

-- UPDATE payments (si payment_id non null)
UPDATE payments
SET status = 'captured', updated_at = NOW()
WHERE payment_id = $1  ← payment_id (pas booking_id)

-- UPDATE service_slots (si slot_id non null)
UPDATE service_slots
SET slot_status = 'booked'
WHERE slot_id = $1
  AND slot_status IN ('pending', 'available', 'reserved')
```

### Stripe (hors transaction)

```python
if do_capture and pi_id_to_capture:
    try:
        await stripe_service.capture_payment_intent(pi_id_to_capture)
    except Exception as exc:
        log.error(...)  # Erreur avalée — booking déjà confirmed en DB
```

**En Java v1 :** stub acceptable.

### Réponse Cas A — HTTP 200

```json
{
  "success": true,
  "status": "confirmed",
  "booking_id": "bk_abc123",
  "payment_mode": "pay_now",
  "payment_captured": true
}
```

### Push notification Cas A

```python
_push(pool, bk["payer_user_id"],
      title="Réservation confirmée !",
      body="Votre demande a été acceptée et votre paiement a été confirmé.",
      data={"type": "booking_confirmed", "bookingId": booking_id,
            "payment_captured": True, "action_text": "a accepté et confirmé votre réservation"},
      notif_type="booking_accepted")
```

---

## Cas B — Tous les autres cas

```python
# Calcul de l'expiry
payment_mode = bk.get("payment_mode") or "pay_now"

if payment_mode == "pay_now":
    pay_expiry_minutes = await _get_pay_now_minutes(conn)
    # → SELECT config_value FROM app_config WHERE config_key = 'pay_now_checkout_minutes'
    # → fallback 30 min (DEFAULT_PAY_NOW_CHECKOUT_MINUTES)
else:  # pay_later
    pay_expiry_minutes = int(bk.get("pay_later_expiration_minutes") or 1440)
    # → service.pay_later_expiration_minutes (du JOIN), fallback 1440 min (24h)

new_expires_at = datetime.now(timezone.utc) + timedelta(minutes=pay_expiry_minutes)
pay_expiry_interval = f"{pay_expiry_minutes} minutes"  # ← format string exact
```

### Transaction DB

```sql
-- UPDATE bookings
UPDATE bookings
SET status = 'awaiting_payment',
    expires_at = $2,                 ← new_expires_at calculé
    updated_at = NOW()
WHERE booking_id = $1

-- UPDATE service_slots (si slot_id non null)
UPDATE service_slots
SET slot_status = 'reserved'         ← 'reserved' (pas 'booked')
WHERE slot_id = $1
  AND slot_status IN ('pending', 'available')
```

**Note :** pas de `payment_status` mis à jour en Cas B. Pas d'UPDATE `payments` en Cas B.

### Réponse Cas B — HTTP 200

```json
{
  "success": true,
  "status": "awaiting_payment",
  "booking_id": "bk_abc123",
  "payment_mode": "pay_now",
  "pay_expiry_interval": "30 minutes"
}
```

### Push notification Cas B

```python
_push(pool, bk["payer_user_id"],
      title="Réservation acceptée — paiement requis",
      body=f"Votre demande a été acceptée. Vous avez {pay_expiry_minutes} min pour payer.",
      data={"type": "booking_accepted", "bookingId": booking_id,
            "requires_payment": True, "action_text": "a accepté votre demande"},
      notif_type="booking_accepted")
```

---

## Réponse idempotente — HTTP 200

```json
{
  "success": true,
  "status": "awaiting_payment",   ← valeur RÉELLE de bk["status"]
  "booking_id": "bk_abc123",
  "idempotent": true
}
```

**Note critique :** `status` = `bk["status"]` (état réel actuel, pas forcément `"awaiting_payment"`). Si le booking est en `confirmed` quand on rappelle `/accept`, la réponse idempotente retourne `"status": "confirmed"`.

---

## Toutes les réponses possibles

| Cas | Code HTTP | Corps réponse |
|---|---|---|
| Cas A nominal | 200 | `{success, status="confirmed", booking_id, payment_mode, payment_captured=true}` |
| Cas B nominal | 200 | `{success, status="awaiting_payment", booking_id, payment_mode, pay_expiry_interval}` |
| Idempotence | 200 | `{success, status=<état_actuel>, booking_id, idempotent=true}` |
| Token absent/invalide | 401 | `{"detail": "Non authentifié"}` |
| Non receiver + non admin | 403 | `{"detail": "Seul le bénéficiaire peut accepter cette réservation"}` |
| Booking inexistant | 404 | `{"detail": "Réservation introuvable"}` |
| Statut invalide | 409 | `{"detail": "Impossible d'accepter une réservation en état '<status>'"}` |
| Réservation expirée | 410 | `{"detail": "Cette réservation a expiré — le créneau a été libéré"}` |

---

## Effets de bord visibles

| Effet | Cas | Condition | Persistant |
|---|---|---|---|
| `bookings.status` → `confirmed` | A | Toujours | OUI |
| `bookings.payment_status` → `captured` | A | Toujours | OUI |
| `bookings.expires_at` → `NULL` | A | Toujours | OUI |
| `bookings.updated_at` → NOW() | A + B | Toujours | OUI |
| `bookings.status` → `awaiting_payment` | B | Toujours | OUI |
| `bookings.expires_at` → `NOW() + n min` | B | Toujours | OUI |
| `payments.status` → `captured` | A | Si `payment_id` non null | OUI |
| `service_slots.slot_status` → `booked` | A | Si `slot_id` non null | OUI |
| `service_slots.slot_status` → `reserved` | B | Si `slot_id` non null ET `IN ('pending','available')` | OUI |
| Stripe PI capturé | A | Si `pi_id_to_capture` non null | Externe |
| Push payer | A + B | Toujours (fire-and-forget) | Externe |
