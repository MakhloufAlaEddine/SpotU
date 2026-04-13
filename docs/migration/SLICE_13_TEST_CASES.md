# SLICE_13_TEST_CASES.md — Cas de test
> Basé sur `booking_routes.py:401–552`.
> Généré le 2026-02-XX.

---

## Cas B — Acceptation standard (awaiting_payment)

### TC-01 — Nominal Cas B (pay_now, payment pending)
```
POST /api/bookings/<booking_requested_pay_now>/accept
Authorization: Bearer <token_receiver>
(booking en 'requested', payment_mode='pay_now', pay_status='pending')
→ HTTP 200
→ {"success": true, "status": "awaiting_payment", "booking_id": "...", "payment_mode": "pay_now", "pay_expiry_interval": "30 minutes"}
→ bookings.status = 'awaiting_payment' en DB
→ bookings.expires_at = NOW() + 30 min (ou config) en DB
```

### TC-02 — Cas B avec slot (slot → reserved)
```
(booking avec slot_id non null, slot_status='pending')
→ HTTP 200
→ service_slots.slot_status = 'reserved' en DB
```

### TC-03 — Cas B slot_status='available' (aussi libéré en reserved)
```
(slot_status='available')
→ HTTP 200
→ service_slots.slot_status = 'reserved' en DB
```

### TC-04 — Cas B slot_status='reserved' (non libéré)
```
(slot_status='reserved')
→ HTTP 200
→ service_slots.slot_status reste 'reserved' (filtre IN ('pending','available') ne match pas)
```

### TC-05 — Cas B pay_later (expiry = service.pay_later_expiration_minutes)
```
(booking payment_mode='pay_later', service.pay_later_expiration_minutes=2880)
→ HTTP 200
→ bookings.expires_at = NOW() + 2880 min en DB
→ pay_expiry_interval = "2880 minutes"
```

### TC-06 — Cas B pay_later fallback (pay_later_expiration_minutes = null)
```
(booking payment_mode='pay_later', service.pay_later_expiration_minutes=null)
→ HTTP 200
→ bookings.expires_at = NOW() + 1440 min en DB (DEFAULT_PAY_LATER_MINUTES)
→ pay_expiry_interval = "1440 minutes"
```

---

## Cas A — Acceptation + capture (confirmed)

### TC-07 — Nominal Cas A (pay_now + authorized → confirmed)
```
POST /api/bookings/<booking_authorized>/accept
Authorization: Bearer <token_receiver>
(booking 'requested', payment_mode='pay_now', payments.status='authorized')
→ HTTP 200
→ {"success": true, "status": "confirmed", "booking_id": "...", "payment_mode": "pay_now", "payment_captured": true}
→ bookings.status = 'confirmed' en DB
→ bookings.payment_status = 'captured' en DB
→ bookings.expires_at = NULL en DB
→ payments.status = 'captured' en DB
```

### TC-08 — Cas A avec slot (slot → booked)
```
(slot_status='pending')
→ service_slots.slot_status = 'booked' en DB
```

### TC-09 — Cas A slot_status='reserved' (aussi libéré en booked)
```
(slot_status='reserved')
→ service_slots.slot_status = 'booked' (IN inclut 'reserved' pour Cas A)
```

### TC-10 — Cas A sans payment (payment_id = null)
```
(aucune ligne dans payments)
→ HTTP 200
→ bookings.status = 'confirmed' (transaction ok)
→ Pas d'UPDATE payments (conditionnel sur payment_id)
→ Pas d'appel Stripe
```

---

## Idempotence

### TC-11 — Déjà awaiting_payment
```
POST /api/bookings/<booking_awaiting>/accept
→ HTTP 200
→ {"success": true, "status": "awaiting_payment", "booking_id": "...", "idempotent": true}
→ Aucune modification DB
```

### TC-12 — Déjà confirmed (Cas A rejoué)
```
POST /api/bookings/<booking_confirmed>/accept
→ HTTP 200
→ {"success": true, "status": "confirmed", "booking_id": "...", "idempotent": true}
→ status = "confirmed" (état réel, pas "awaiting_payment")
→ Aucune modification DB
```

### TC-13 — Déjà accepted (legacy)
```
POST /api/bookings/<booking_accepted>/accept
→ HTTP 200
→ {"success": true, "status": "accepted", "booking_id": "...", "idempotent": true}
```

---

## Contrôle d'accès

### TC-14 — Token absent
```
POST /api/bookings/<booking_id>/accept (sans Authorization)
→ HTTP 401
```

### TC-15 — Token invalide/expiré
```
Authorization: Bearer INVALID_TOKEN
→ HTTP 401
```

### TC-16 — Payer (pas receiver) tente d'accepter
```
Authorization: Bearer <token_payer>
→ HTTP 403
→ {"detail": "Seul le bénéficiaire peut accepter cette réservation"}
```

### TC-17 — Admin peut accepter
```
Authorization: Bearer <token_admin> (role='admin', pas receiver_user_id)
→ HTTP 200
→ Même comportement que le receiver
```

### TC-18 — Tiers non impliqué
```
Authorization: Bearer <token_tiers>
→ HTTP 403
```

---

## Booking introuvable

### TC-19 — booking_id inexistant
```
POST /api/bookings/bk_inexistant/accept
→ HTTP 404
→ {"detail": "Réservation introuvable"}
```

---

## Statuts invalides (409)

### TC-20 — Booking en refused
```
→ HTTP 409
→ {"detail": "Impossible d'accepter une réservation en état 'refused'"}
```

### TC-21 — Booking en cancelled
```
→ HTTP 409
→ {"detail": "Impossible d'accepter une réservation en état 'cancelled'"}
```

### TC-22 — Message 409 inclut l'état actuel
```
→ Vérifier que le message contient l'état exact entre guillemets simples
```

---

## Garde TTL (410)

### TC-23 — expires_at dans le passé
```
(booking.expires_at = NOW() - 1 heure)
→ HTTP 410
→ {"detail": "Cette réservation a expiré — le créneau a été libéré"}
```

### TC-24 — expires_at dans le futur (normal)
```
(booking.expires_at = NOW() + 1 heure)
→ Pas de 410 — continuer normalement
```

### TC-25 — expires_at null (booking requested sans expiry)
```
(booking.expires_at = null)
→ Pas de 410 — continuer normalement
→ La garde TTL est skippée si null
```

---

## Différences Cas A vs Cas B

### TC-26 — Cas A n'a pas pay_expiry_interval dans la réponse
```
(Cas A — payment_mode='pay_now', pay_status='authorized')
→ Réponse JSON : {"success": true, "status": "confirmed", "payment_captured": true}
→ PAS de "pay_expiry_interval" dans la réponse
→ Vérifier l'absence stricte du champ
```

### TC-27 — Cas B n'a pas payment_captured dans la réponse
```
(Cas B)
→ Réponse JSON : {"success": true, "status": "awaiting_payment", "pay_expiry_interval": "..."}
→ PAS de "payment_captured" dans la réponse
→ Vérifier l'absence stricte du champ
```

---

## Compatibilité Python

### TC-28 — Appel simultané Python vs Java
```
POST /accept avec le même token et même booking
→ Python et Java : réponse JSON identique (mêmes clés, mêmes valeurs)
```

### TC-29 — Format pay_expiry_interval
```
(app_config.pay_now_checkout_minutes = 45)
→ pay_expiry_interval = "45 minutes" (string avec espace)
→ Pas : 45, "45", "45min", {minutes: 45}
```
