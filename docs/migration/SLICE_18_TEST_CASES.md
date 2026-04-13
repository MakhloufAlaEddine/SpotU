# SLICE_18_TEST_CASES.md — Cas de test de la Slice 18
> Worker : `ExpiryWorker` — `expiry_worker.py`.
> Référence Python : `tests/test_booking_expiry_v2.py`.
> Généré le 2026-02-XX.

---

## Légende

| Symbole | Signification |
|---|---|
| TC-xx | Identifiant du cas de test |
| ✅ | Comportement attendu (assertion Java) |
| ❌ | Comportement interdit |
| ⚠️ | Point d'attention |

---

## [1] Sélection des bookings candidats

### TC-01 — Booking `requested` expiré → sélectionné
**Setup :** `bookings.status='requested'`, `expires_at=NOW()-1h`
**Appel :** `processBatch(50)`
✅ Booking retourné dans la requête SELECT
✅ Booking traité (transitionné → `expired`)

### TC-02 — Booking `awaiting_payment` expiré → sélectionné
**Setup :** `bookings.status='awaiting_payment'`, `expires_at=NOW()-5min`
**Appel :** `processBatch(50)`
✅ Booking retourné et traité → `expired`

### TC-03 — Booking avec `expires_at` dans le futur → ignoré
**Setup :** `bookings.status='requested'`, `expires_at=NOW()+2h`
**Appel :** `processBatch(50)`
✅ Booking NON retourné
✅ `status` reste `'requested'` en DB

### TC-04 — Booking `confirmed` expiré → ignoré
**Setup :** `bookings.status='confirmed'`, `expires_at=NOW()-1h`
✅ Booking NON sélectionné (hors clause `WHERE status IN (...)`)
✅ `status` reste `'confirmed'`

### TC-05 — Booking sans `expires_at` (NULL) → ignoré
**Setup :** `bookings.status='requested'`, `expires_at=NULL`
✅ Booking NON sélectionné (clause `AND b.expires_at IS NOT NULL`)

---

## [2] Transition booking

### TC-06 — Transition `requested` → `expired`
**Setup :** booking `requested` expiré
**Appel :** `processBatch(50)`
✅ `bookings.status='expired'` après exécution
✅ `bookings.updated_at` mis à jour

### TC-07 — Transition `awaiting_payment` → `expired`
**Setup :** booking `awaiting_payment` expiré
✅ `bookings.status='expired'` après exécution

### TC-08 — Race condition : booking passé à `confirmed` entre SELECT et UPDATE
**Setup :** booking sélectionné par le worker ; une autre transaction le passe à `confirmed` avant l'UPDATE
✅ `UPDATE ... RETURNING` retourne 0 rows → booking **skipé**
✅ **Aucun** effet de bord : slot, payment, notifications non modifiés
✅ Aucune exception levée

---

## [3] Libération du slot

### TC-09 — Slot `pending` libéré pour booking `requested`
**Setup :** booking `requested` expiré, `slot_id` renseigné, `slot_type='single'`, `slot_status='pending'`
✅ `service_slots.slot_status='available'` après exécution

### TC-10 — Slot `reserved` libéré pour booking `awaiting_payment`
**Setup :** booking `awaiting_payment` expiré, `slot_type='specific'`, `slot_status='reserved'`
✅ `service_slots.slot_status='available'` après exécution

### TC-11 — Slot `recurring` NON libéré
**Setup :** booking `requested` expiré, `slot_type='recurring'`, `slot_status='pending'`
✅ `service_slots.slot_status` reste `'pending'`
❌ Le worker ne doit PAS libérer les slots récurrents

### TC-12 — Booking sans slot (`slot_id=NULL`) → aucun UPDATE service_slots
**Setup :** booking `requested` expiré, `slot_id=NULL`
✅ Aucune requête sur `service_slots`
✅ Aucune erreur

### TC-13 — Slot déjà `available` → no-op (idempotence)
**Setup :** slot `slot_status='available'` (déjà libéré auparavant)
✅ `service_slots.slot_status` reste `'available'`
✅ Aucune erreur

### TC-14 — Slot libéré puis re-réservable
**Post-condition de TC-09 :**
```sql
UPDATE service_slots SET slot_status='pending' WHERE slot_id=$1 AND slot_status='available'
RETURNING slot_id
```
✅ `RETURNING slot_id` retourne une valeur (slot re-réservable après libération)

---

## [4] Annulation du payment

### TC-15 — Payment `requires_authorization` → `cancelled`
**Setup :** payment `pay_status='requires_authorization'`, `stripe_payment_intent_id='pi_xxx'`
✅ `payments.status='cancelled'` après exécution

### TC-16 — Payment `authorized` → `cancelled`
**Setup :** payment `pay_status='authorized'`
✅ `payments.status='cancelled'` après exécution

### TC-17 — Payment `capture_pending` → `cancelled`
**Setup :** payment `pay_status='capture_pending'`
✅ `payments.status='cancelled'` après exécution

### TC-18 — Payment `captured` → inchangé
**Setup :** payment `pay_status='captured'` (état terminal)
✅ `payments.status` reste `'captured'`
❌ Le worker ne doit PAS annuler un payment déjà capturé

### TC-19 — Payment `pending` → inchangé
**Setup :** payment `pay_status='pending'` (pas encore autorisé)
✅ `payments.status` reste `'pending'`

### TC-20 — Booking sans payment (`LEFT JOIN` retourne NULL) → aucun UPDATE payments
**Setup :** aucun enregistrement dans `payments` pour ce `booking_id`
✅ Aucune requête UPDATE sur `payments`
✅ Transition booking et notifications se déroulent normalement

---

## [5] Notifications

### TC-21 — 2 notifications créées par booking expiré (payer + receiver)
**Setup :** booking `requested` expiré, `payer_user_id='u1'`, `receiver_user_id='u2'`
✅ 2 nouvelles lignes dans `notifications` après exécution
✅ Une pour `user_id='u1'` (payer), une pour `user_id='u2'` (receiver)
✅ `type='booking_expired'` pour les deux

### TC-22 — Texte notif payer : `awaiting_payment`
**Setup :** `booking_status='awaiting_payment'`
✅ `notifications.body` LIKE `'%délai de paiement dépassé%'`

### TC-23 — Texte notif payer : `requested`
**Setup :** `booking_status='requested'`
✅ `notifications.body` LIKE `'%n\'a pas reçu de réponse%'`

### TC-24 — Texte notif receiver : `awaiting_payment`
✅ `notifications.title = 'Réservation non payée'`
✅ `notifications.body` LIKE `'%client n\'a pas payé%'`

### TC-25 — Texte notif receiver : `requested`
✅ `notifications.title = 'Demande non traitée'`

### TC-26 — `data.payer_id` présent uniquement dans la notif receiver
✅ `notifications.data` du receiver contient `"payer_id": "{payer_user_id}"`
✅ `notifications.data` du payer **ne contient pas** `"payer_id"`

### TC-27 — `notif_id` au format `ntf_{12 hex chars}`
✅ `notif_id` matche regex `^ntf_[0-9a-f]{12}$`

### TC-28 — Service introuvable → fallback `"un service"` dans les messages
**Setup :** `service_id` inexistant en DB
✅ Notifications créées avec `service_title="un service"` dans le `body`
✅ Aucune exception levée

---

## [6] Stripe

### TC-29 — `cancel_payment_intent` appelé après COMMIT si conditions remplies
**Setup :** payment `requires_authorization`, `stripe_payment_intent_id='pi_xxx'`
⚠️ À vérifier via mock/spy Stripe : `cancel_payment_intent` appelé avec `reason='expired'`
✅ Appel Stripe fait **après** le COMMIT de la transaction DB
✅ DB déjà en `status='cancelled'` au moment de l'appel Stripe

### TC-30 — `cancel_payment_intent` NON appelé si `stripe_payment_intent_id=NULL`
**Setup :** payment `requires_authorization`, mais `stripe_payment_intent_id=NULL`
✅ Aucun appel Stripe
✅ Payment en DB → `cancelled` normalement (l'UPDATE DB n'est pas conditionné au `pi_id`)

### TC-31 — Erreur Stripe → log uniquement, booking reste `expired`
**Setup :** Stripe retourne une erreur (mock `StripeException`)
✅ `bookings.status='expired'` (inchangé après l'erreur)
✅ `payments.status='cancelled'` (inchangé après l'erreur)
✅ Aucune exception propagée au caller

---

## [7] Idempotence et batch

### TC-32 — Appel double sur un booking déjà expiré → no-op
**Setup :** booking déjà `status='expired'`
✅ Non sélectionné par la requête (exclu par `WHERE status IN ('requested','awaiting_payment')`)
✅ Aucun effet de bord
✅ Aucune notification dupliquée

### TC-33 — Batch plein (50 items) → while loop continue
**Setup :** 120 bookings expirés en DB
**Appel :** `expireStaleBookings()` (la fonction drain complète)
✅ `_expireBatch(50)` appelé 3 fois : 50 + 50 + 20
✅ Retour final = 120
✅ Tous les 120 bookings sont à `status='expired'`

### TC-34 — Batch vide → retour immédiat
**Setup :** aucun booking expiré en DB
**Appel :** `expireStaleBookings()`
✅ Retour = 0
✅ Aucune requête UPDATE exécutée

### TC-35 — Tick immédiat au démarrage
✅ Première exécution du scheduler se déclenche à `initialDelay=0`
✅ Les bookings expirés présents au démarrage sont traités dès le premier tick

---

## [8] Concurrent safety (SKIP LOCKED)

### TC-36 — 2 workers concurrents sur la même DB → aucun doublon
**Setup :** 2 instances du scheduler tournent simultanément (test de concurrence)
✅ Chaque booking expiré est traité **exactement une fois**
✅ Aucun deadlock
✅ Aucune notification dupliquée

> ⚠️ Ce test nécessite 2 threads/connexions en parallèle. En Java : 2 `CompletableFuture` appelant `processBatch()` simultanément sur le même DataSource.
