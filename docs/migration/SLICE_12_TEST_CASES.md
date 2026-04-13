# SLICE_12_TEST_CASES.md — Cas de test
> Basé sur `booking_routes.py:675–747`.
> Généré le 2026-02-XX.

---

## Nominal

### TC-01 — Refus nominal (receiver, booking en requested)
```
POST /api/bookings/<booking_requested_id>/refuse
Authorization: Bearer <token_receiver>
(aucun body)
→ HTTP 200
→ {"success": true, "status": "refused", "booking_id": "<booking_requested_id>"}
→ bookings.status = 'refused' en DB
→ bookings.updated_at mis à jour
```

### TC-02 — Refus avec slot (slot_status='pending' libéré)
```
POST /api/bookings/<booking_avec_slot>/refuse
Authorization: Bearer <token_receiver>
(booking avec slot_id non null, slot_status='pending')
→ HTTP 200
→ service_slots.slot_status = 'available' en DB
```

### TC-03 — Refus avec payment (requires_authorization annulé)
```
POST /api/bookings/<booking_avec_payment>/refuse
Authorization: Bearer <token_receiver>
(booking avec payment.status = 'requires_authorization')
→ HTTP 200
→ payments.status = 'cancelled' en DB
```

### TC-04 — Refus sans slot (slot_id = null)
```
POST /api/bookings/<booking_sans_slot>/refuse
Authorization: Bearer <token_receiver>
(slot_id = null)
→ HTTP 200
→ Aucune modification service_slots (skip)
```

### TC-05 — Refus sans payment (aucune ligne dans payments)
```
POST /api/bookings/<booking_sans_payment>/refuse
Authorization: Bearer <token_receiver>
(aucune ligne dans payments pour ce booking_id)
→ HTTP 200
→ Aucune modification payments (0 ligne touchée — normal)
→ Pas d'appel Stripe (pi_row = null)
```

### TC-06 — Refus avec payment capturé (inchangé)
```
POST /api/bookings/<booking_capture>/refuse
Authorization: Bearer <token_receiver>
(payment.status = 'captured')
→ HTTP 200
→ payments.status reste 'captured' (filtre IN ne match pas)
```

---

## Idempotence

### TC-07 — Deuxième appel (déjà refused)
```
POST /api/bookings/<booking_already_refused>/refuse
Authorization: Bearer <token_receiver>
→ HTTP 200
→ {"success": true, "status": "refused", "idempotent": true}
→ PAS de "booking_id" dans la réponse
→ Aucune modification DB
```

### TC-08 — Troisième appel (triple retry)
```
3 appels successifs POST /refuse sur le même booking
→ Chaque appel retourne HTTP 200
→ 1er appel : réponse nominale avec booking_id
→ 2ème et 3ème : réponse idempotente avec "idempotent": true
```

---

## Contrôle d'accès

### TC-09 — Token absent
```
POST /api/bookings/<booking_id>/refuse
(sans Authorization)
→ HTTP 401
```

### TC-10 — Token invalide/expiré
```
POST /api/bookings/<booking_id>/refuse
Authorization: Bearer INVALID_TOKEN
→ HTTP 401
```

### TC-11 — Payer tente de refuser (403)
```
POST /api/bookings/<booking_id>/refuse
Authorization: Bearer <token_payer>  (user_id du booking, pas receiver_user_id)
→ HTTP 403
→ {"detail": "Seul le bénéficiaire peut refuser cette réservation"}
```

### TC-12 — Admin tente de refuser (403)
```
POST /api/bookings/<booking_id>/refuse
Authorization: Bearer <token_admin>  (role=admin, mais pas receiver_user_id du booking)
→ HTTP 403
→ Confirmation : pas d'exception admin sur /refuse
```

### TC-13 — Tiers non impliqué (403)
```
POST /api/bookings/<booking_id>/refuse
Authorization: Bearer <token_autre_user>  (aucun lien avec le booking)
→ HTTP 403
```

---

## Booking introuvable

### TC-14 — booking_id inexistant
```
POST /api/bookings/bk_inexistant/refuse
Authorization: Bearer <token_receiver>
→ HTTP 404
→ {"detail": "Réservation introuvable"}
```

---

## Statuts invalides (409)

### TC-15 — Booking en awaiting_payment
```
→ HTTP 409
→ {"detail": "Impossible de refuser une réservation en état 'awaiting_payment'"}
```

### TC-16 — Booking en confirmed
```
→ HTTP 409
→ {"detail": "Impossible de refuser une réservation en état 'confirmed'"}
```

### TC-17 — Booking en cancelled
```
→ HTTP 409
→ {"detail": "Impossible de refuser une réservation en état 'cancelled'"}
```

### TC-18 — Booking en expired
```
→ HTTP 409
→ {"detail": "Impossible de refuser une réservation en état 'expired'"}
```

### TC-19 — Booking en completed
```
→ HTTP 409
→ {"detail": "Impossible de refuser une réservation en état 'completed'"}
```

### TC-20 — Message 409 inclut l'état actuel
```
→ Vérifier que le message contient l'état exact entre guillemets simples
→ Ex : "Impossible de refuser une réservation en état 'confirmed'"
→ Pas : "Impossible de refuser" sans l'état
```

---

## Comportement Stripe (optionnel en v1)

### TC-21 — Stripe appel non bloquant (stub acceptable)
```
POST /api/bookings/<booking_avec_pi>/refuse
(booking avec payments.stripe_payment_intent_id rempli)
→ HTTP 200 retourné même si le stub Stripe ne fait rien
→ La réponse HTTP ne dépend pas du succès de l'appel Stripe
```

### TC-22 — Stripe indisponible (si implémenté)
```
(simuler une erreur Stripe)
→ HTTP 200 quand même
→ L'exception Stripe est avalée (log.error)
→ bookings.status = 'refused' en DB (la transaction a été committée avant)
```

---

## Compatibilité Python

### TC-23 — Appel simultané Python vs Java
```
POST /api/bookings/<booking_requested>/refuse avec le même token
→ Python : {"success": true, "status": "refused", "booking_id": "..."}
→ Java : réponse structurellement identique (mêmes clés, mêmes valeurs)
```

### TC-24 — Vérification réponse idempotente sans booking_id
```
(booking déjà refused)
Java retourne : {"success": true, "status": "refused", "idempotent": true}
Vérifier : pas de champ "booking_id" dans cette réponse
```

### TC-25 — Slot non libéré si slot_status='reserved'
```
(booking avec slot en état 'reserved')
POST /refuse
→ HTTP 200
→ service_slots.slot_status reste 'reserved' (pas 'available')
→ Confirme le filtre AND slot_status='pending'
```
