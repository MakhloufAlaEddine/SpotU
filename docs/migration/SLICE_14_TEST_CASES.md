# SLICE_14_TEST_CASES.md — Cas de test de la Slice 14
> Basé sur `booking_routes.py:984–1028`.
> Généré le 2026-02-XX.

---

## Cas nominaux

### TC-01 — Receiver marque son booking comme terminé

```
Préconditions :
  - Booking en état `accepted` (cas métier principal)
  - Slot en état `booked`
  - Payment en état `authorized`
  - Appelant = receiver_user_id du booking

Appel :
  POST /api/bookings/{booking_id}/complete
  Authorization: Bearer <receiver_token>

Résultat attendu :
  HTTP 200
  { "success": true, "status": "completed", "booking_id": "{id}" }

Vérifications DB :
  - bookings.status = 'completed'
  - bookings.updated_at a été mis à jour
  - service_slots.slot_status = 'completed'  (si slot existait et était 'booked')
  - payments.status = 'captured'  (si était 'authorized')
```

---

### TC-02 — Admin marque un booking comme terminé

```
Préconditions :
  - Booking existant
  - Appelant = user avec role='admin' (≠ receiver_user_id)

Appel :
  POST /api/bookings/{booking_id}/complete
  Authorization: Bearer <admin_token>

Résultat attendu :
  HTTP 200
  { "success": true, "status": "completed" }

Vérifications DB :
  - bookings.status = 'completed'
```

---

### TC-03 — Booking sans slot (slot_id NULL)

```
Préconditions :
  - Booking existant avec slot_id = NULL
  - Appelant = receiver

Appel :
  POST /api/bookings/{booking_id}/complete

Résultat attendu :
  HTTP 200
  { "success": true, "status": "completed" }

Vérifications DB :
  - bookings.status = 'completed'
  - Aucune erreur liée à service_slots (UPDATE silencieux)
  ⚠️ Aucune ligne de service_slots n'est modifiée — comportement normal.
```

---

### TC-04 — Slot existant mais pas en état `booked`

```
Préconditions :
  - Booking existant avec slot_id non NULL
  - service_slots.slot_status = 'reserved'  (pas 'booked')
  - Appelant = receiver

Résultat attendu :
  HTTP 200
  { "success": true, "status": "completed" }

Vérifications DB :
  - bookings.status = 'completed'
  - service_slots.slot_status = 'reserved'  (INCHANGÉ — UPDATE silencieux)
```

---

### TC-05 — Payment déjà `captured` (idempotence payment)

```
Préconditions :
  - Booking existant
  - payments.status = 'captured'  (déjà capturé)
  - Appelant = receiver

Résultat attendu :
  HTTP 200
  { "success": true, "status": "completed" }

Vérifications DB :
  - bookings.status = 'completed'
  - payments.status = 'captured'  (INCHANGÉ — UPDATE silencieux, pas de double-capture)
```

---

### TC-06 — Payment en état `requires_authorization`

```
Préconditions :
  - Booking en awaiting_payment
  - payments.status = 'requires_authorization'
  - Appelant = receiver

Résultat attendu :
  HTTP 200
  { "success": true, "status": "completed" }

Vérifications DB :
  - bookings.status = 'completed'
  - payments.status = 'requires_authorization'  (INCHANGÉ — condition 'authorized' non remplie)
  ⚠️ Aucun appel Stripe.
```

---

## Cas d'accès refusé

### TC-07 — Payer essaie de marquer comme terminé

```
Préconditions :
  - Booking existant
  - Appelant = payer_user_id ≠ receiver_user_id, role ≠ 'admin'

Résultat attendu :
  HTTP 403
  { "detail": "Seul le bénéficiaire peut marquer comme terminé" }

Vérifications DB :
  - bookings.status INCHANGÉ
```

---

### TC-08 — Tiers non impliqué

```
Préconditions :
  - Booking existant
  - Appelant = utilisateur ni payer ni receiver ni admin

Résultat attendu :
  HTTP 403
  { "detail": "Seul le bénéficiaire peut marquer comme terminé" }
```

---

### TC-09 — Token absent

```
Appel :
  POST /api/bookings/{booking_id}/complete
  (sans header Authorization)

Résultat attendu :
  HTTP 401
```

---

### TC-10 — Token invalide / expiré

```
Appel :
  POST /api/bookings/{booking_id}/complete
  Authorization: Bearer eyJ_TOKEN_INVALIDE

Résultat attendu :
  HTTP 401
```

---

## Cas booking introuvable

### TC-11 — booking_id inexistant

```
Préconditions :
  - Booking "bkg_inexistant" n'existe pas en DB
  - Appelant = utilisateur valide

Résultat attendu :
  HTTP 404
```

---

## Comportement sur statuts "absurdes" — Compatibilité Python stricte

> ⚠️ Ces tests vérifient que Java reproduit le comportement permissif de Python.
> En l'absence de garde, Python accepte de passer n'importe quel statut à `completed`.

### TC-12 — Booking en état `refused` → complete (pas de 409)

```
Préconditions :
  - booking.status = 'refused'
  - Appelant = receiver (ou admin)

Résultat attendu Python :
  HTTP 200
  { "success": true, "status": "completed" }
  bookings.status = 'completed'

⚠️ Comportement absurde métier mais conforme au code Python.
Si Java ajoute un 409, documenter comme divergence volontaire.
```

---

### TC-13 — Booking en état `requested` → complete

```
Préconditions :
  - booking.status = 'requested'
  - Appelant = receiver

Résultat attendu Python :
  HTTP 200
  { "success": true, "status": "completed" }

⚠️ Idem TC-12.
```

---

### TC-14 — Booking en état `cancelled` → complete

```
Préconditions :
  - booking.status = 'cancelled'
  - Appelant = receiver

Résultat attendu Python :
  HTTP 200
  { "success": true, "status": "completed" }

⚠️ Idem TC-12.
```

---

## Idempotence

### TC-15 — Double appel /complete (idempotence implicite)

```
Séquence :
  1. POST /complete → HTTP 200, status='completed'
  2. POST /complete (même booking, même token) → HTTP 200, status='completed'

Résultat attendu :
  Les deux appels retournent HTTP 200 sans erreur.

Vérifications DB après le 2e appel :
  - bookings.status = 'completed' (inchangé)
  - bookings.updated_at = horodatage du 2e appel (mis à jour à NOW() à chaque appel)
  - service_slots.slot_status inchangé (UPDATE silencieux)
  - payments.status inchangé (UPDATE silencieux)

⚠️ Comportement Python exact : pas d'early return, le 2e appel re-exécute les UPDATEs.
```

---

## Absence de push notification

### TC-16 — Aucun push envoyé après /complete

```
Séquence :
  POST /complete → HTTP 200

Vérification :
  - Aucune entrée dans la table `notifications` ou `push_notifications`
  - Aucun appel à `send_push_to_user()` en Python
  - Test de régression : aucune push notification reçue par payer ou receiver
```

---

## Tableau récapitulatif

| TC | Scénario | HTTP attendu | Critique |
|---|---|---|---|
| TC-01 | Receiver, slot booked, payment authorized | 200 | OUI |
| TC-02 | Admin | 200 | OUI |
| TC-03 | slot_id NULL | 200 (silencieux) | OUI |
| TC-04 | Slot non booked | 200 (slot inchangé) | OUI |
| TC-05 | Payment déjà captured | 200 (payment inchangé) | OUI |
| TC-06 | Payment requires_authorization | 200 (payment inchangé) | OUI |
| TC-07 | Payer essaie | 403 | OUI |
| TC-08 | Tiers | 403 | OUI |
| TC-09 | Token absent | 401 | OUI |
| TC-10 | Token invalide | 401 | OUI |
| TC-11 | booking_id inexistant | 404 | OUI |
| TC-12 | Status 'refused' → complete | 200 (compat Python) | MOYEN |
| TC-13 | Status 'requested' → complete | 200 (compat Python) | MOYEN |
| TC-14 | Status 'cancelled' → complete | 200 (compat Python) | MOYEN |
| TC-15 | Double appel (idempotence) | 200+200 | OUI |
| TC-16 | Pas de push envoyé | aucun push | OUI |
