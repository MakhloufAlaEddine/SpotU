# SLICE_19_TEST_CASES.md — Cas de tests
> Basé sur `stripe_service.py:136–237`, `booking_routes.py:524–912`, `expiry_worker.py:173–179`.
> Référence : `tests/test_cancellation_policy_iter55.py` (tests unitaires existants).
> Généré le 2026-02-XX.

---

## Méthodologie

Chaque méthode du StripeService est testée isolément (tests unitaires avec mock Stripe SDK)
puis en intégration avec les callers (tests E2E simulant le flux complet).

---

## A. Tests unitaires — `capturePaymentIntent`

### TC-CAP-01 — Capture nominale (full amount)

```
GIVEN : un PaymentIntent pi_test_001 en status=requires_capture
WHEN  : capturePaymentIntent("pi_test_001", null)
THEN  : Stripe PaymentIntent.capture("pi_test_001") est appelé SANS amount_to_capture
AND   : retourne PaymentIntent avec status="succeeded"
AND   : log.info contient "PaymentIntent capturé"
```

### TC-CAP-02 — Capture avec montant partiel

```
GIVEN : un PaymentIntent pi_test_002 en status=requires_capture, amount=5000
WHEN  : capturePaymentIntent("pi_test_002", 3000L)
THEN  : Stripe PaymentIntent.capture("pi_test_002", {amount_to_capture: 3000}) est appelé
AND   : retourne PaymentIntent avec amount_captured=3000
NOTE  : Non utilisé dans le code actuel mais le service le supporte.
```

### TC-CAP-03 — Capture d'un PI déjà captured → StripeException

```
GIVEN : un PaymentIntent pi_test_003 déjà en status=succeeded (captured)
WHEN  : capturePaymentIntent("pi_test_003", null)
THEN  : StripeException levée (InvalidRequestError: "This PaymentIntent has already been captured")
AND   : le caller doit catch et log.error (BR-02)
```

### TC-CAP-04 — Capture d'un PI cancelled → StripeException

```
GIVEN : un PaymentIntent pi_test_004 en status=canceled
WHEN  : capturePaymentIntent("pi_test_004", null)
THEN  : StripeException levée (InvalidRequestError)
AND   : le caller doit catch et log.error
```

### TC-CAP-05 — Capture réseau timeout → StripeException

```
GIVEN : un PaymentIntent valide mais réseau Stripe indisponible
WHEN  : capturePaymentIntent("pi_test_005", null)
THEN  : StripeException (ApiConnectionException) levée
AND   : le caller doit catch et log.error (la DB reste en status='captured')
```

---

## B. Tests unitaires — `cancelPaymentIntent`

### TC-CAN-01 — Cancel nominal avec raison "refused"

```
GIVEN : un PaymentIntent pi_test_010 en status=requires_payment_method
WHEN  : cancelPaymentIntent("pi_test_010", "refused")
THEN  : Stripe PaymentIntent.cancel("pi_test_010", {cancellation_reason: "abandoned"}) est appelé
AND   : retourne PaymentIntent avec status="canceled"
AND   : log.info contient "PaymentIntent annulé" et "reason=abandoned"
```

### TC-CAN-02 — Cancel avec raison "expired"

```
GIVEN : un PaymentIntent pi_test_011 en status=requires_capture
WHEN  : cancelPaymentIntent("pi_test_011", "expired")
THEN  : cancellation_reason envoyé = "abandoned" (mapping _CANCEL_REASONS)
```

### TC-CAN-03 — Cancel avec raison "cancelled"

```
GIVEN : un PaymentIntent pi_test_012 en status=requires_capture
WHEN  : cancelPaymentIntent("pi_test_012", "cancelled")
THEN  : cancellation_reason envoyé = "abandoned"
```

### TC-CAN-04 — Cancel avec raison inconnue → fallback "abandoned"

```
GIVEN : un PaymentIntent pi_test_013
WHEN  : cancelPaymentIntent("pi_test_013", "unknown_reason")
THEN  : cancellation_reason envoyé = "abandoned" (fallback)
AND   : PAS d'erreur — le mapping utilise getOrDefault
```

### TC-CAN-05 — Cancel d'un PI déjà cancelled → idempotent

```
GIVEN : un PaymentIntent pi_test_014 déjà en status=canceled
WHEN  : cancelPaymentIntent("pi_test_014", "refused")
THEN  : Stripe retourne le PI avec status="canceled" SANS erreur
AND   : le service retourne normalement (pas d'exception)
```

### TC-CAN-06 — Cancel d'un PI déjà captured → StripeException

```
GIVEN : un PaymentIntent pi_test_015 en status=succeeded (captured)
WHEN  : cancelPaymentIntent("pi_test_015", "cancelled")
THEN  : StripeException levée (InvalidRequestError: "You cannot cancel this PaymentIntent because it has a status of succeeded")
AND   : le caller doit catch et log.error
```

### TC-CAN-07 — Cancel avec raison "duplicate" → passé tel quel

```
GIVEN : un PaymentIntent pi_test_016
WHEN  : cancelPaymentIntent("pi_test_016", "duplicate")
THEN  : cancellation_reason envoyé = "duplicate" (pas de mapping, valeur directe)
```

### TC-CAN-08 — Cancel avec raison "fraudulent" → passé tel quel

```
GIVEN : un PaymentIntent pi_test_017
WHEN  : cancelPaymentIntent("pi_test_017", "fraudulent")
THEN  : cancellation_reason envoyé = "fraudulent"
```

---

## C. Tests unitaires — `createRefund`

### TC-REF-01 — Refund complet nominal

```
GIVEN : une charge ch_test_020 capturée, amount=5000
WHEN  : createRefund("ch_test_020", null, "requested_by_customer", "bkg_001")
THEN  : Stripe Refund.create({charge: "ch_test_020", reason: "requested_by_customer"})
        avec idempotency_key="rf_bkg_001"
AND   : retourne Refund avec status="succeeded"
AND   : log.info contient "Remboursement créé" et "amount=full"
```

### TC-REF-02 — Refund partiel

```
GIVEN : une charge ch_test_021 capturée, amount=5000
WHEN  : createRefund("ch_test_021", 2000L, "requested_by_customer", "bkg_002")
THEN  : Stripe Refund.create({charge: "ch_test_021", amount: 2000, reason: "requested_by_customer"})
AND   : retourne Refund avec amount=2000
NOTE  : Non utilisé actuellement — toujours full refund.
```

### TC-REF-03 — Refund avec raison invalide → fallback

```
GIVEN : une charge ch_test_022
WHEN  : createRefund("ch_test_022", null, "bad_reason", null)
THEN  : reason envoyé = "requested_by_customer" (fallback)
AND   : PAS d'erreur
```

### TC-REF-04 — Refund sans idempotency_key

```
GIVEN : une charge ch_test_023
WHEN  : createRefund("ch_test_023", null, "requested_by_customer", null)
THEN  : Stripe Refund.create SANS idempotency_key dans RequestOptions
AND   : le refund est créé normalement
```

### TC-REF-05 — Refund double avec même idempotency_key → idempotent

```
GIVEN : un premier refund créé avec idempotency_key="rf_bkg_003"
WHEN  : createRefund("ch_test_024", null, "requested_by_customer", "bkg_003")
THEN  : Stripe retourne le refund EXISTANT (pas de double remboursement)
AND   : PAS d'erreur
```

### TC-REF-06 — Refund d'une charge déjà remboursée → StripeException

```
GIVEN : une charge ch_test_025 déjà fully refunded (SANS même idempotency_key)
WHEN  : createRefund("ch_test_025", null, "requested_by_customer", "bkg_NEW")
THEN  : StripeException levée (InvalidRequestError: "Charge has already been refunded")
AND   : le caller doit catch et log.error
```

### TC-REF-07 — Refund d'une charge inexistante → StripeException

```
GIVEN : charge_id = "ch_nonexistent"
WHEN  : createRefund("ch_nonexistent", null, "requested_by_customer", null)
THEN  : StripeException levée (InvalidRequestError: "No such charge")
```

### TC-REF-08 — Refund montant > charge → StripeException

```
GIVEN : une charge ch_test_026 capturée, amount=5000
WHEN  : createRefund("ch_test_026", 9999L, "requested_by_customer", null)
THEN  : StripeException levée (InvalidRequestError: "Refund amount exceeds charge")
```

---

## D. Tests unitaires — Infrastructure

### TC-INIT-01 — Init avec clé valide

```
GIVEN : STRIPE_API_KEY = "sk_test_abc123"
WHEN  : StripeService est initialisé (@PostConstruct)
THEN  : Stripe.apiKey = "sk_test_abc123"
AND   : Stripe.apiBase NON modifié (par défaut api.stripe.com)
```

### TC-INIT-02 — Init avec clé Emergent → proxy

```
GIVEN : STRIPE_API_KEY = "sk_test_emergent_xyz"
WHEN  : StripeService est initialisé
THEN  : Stripe.apiKey = "sk_test_emergent_xyz"
AND   : Stripe.overrideApiBase("https://integrations.emergentagent.com/stripe")
AND   : log.info contient "proxy Emergent"
```

### TC-INIT-03 — Init sans clé → warning

```
GIVEN : STRIPE_API_KEY = "" (vide)
WHEN  : StripeService est initialisé
THEN  : Stripe.apiKey = ""
AND   : log.warning contient "STRIPE_API_KEY non configurée"
```

### TC-RET-01 — retrievePaymentIntent nominal

```
GIVEN : un PaymentIntent pi_test_030 existant
WHEN  : retrievePaymentIntent("pi_test_030")
THEN  : Stripe PaymentIntent.retrieve("pi_test_030") est appelé
AND   : retourne le PaymentIntent complet
```

---

## E. Tests d'intégration caller — Compatibilité Python

### TC-INT-01 — Accept Cas A → capture + DB cohérent

```
GIVEN : booking bkg_int_01 en status=requested, payment status=authorized, pi_id=pi_test_040
WHEN  : POST /api/bookings/bkg_int_01/accept (receiver auth)
THEN  : DB: booking.status='confirmed', payment.status='captured', slot.slot_status='booked'
AND   : Stripe capture appelé avec pi_test_040
AND   : réponse HTTP 200 avec payment_captured=true
```

### TC-INT-02 — Accept Cas A + capture Stripe échoue → DB inchangé (confirmed)

```
GIVEN : booking bkg_int_02, pi_id=pi_test_041, MAIS Stripe réseau down
WHEN  : POST /api/bookings/bkg_int_02/accept
THEN  : DB: booking.status='confirmed', payment.status='captured' (COMMIT réussi)
AND   : Stripe capture échoue → log.error
AND   : réponse HTTP 200 (pas de 500)
AND   : webhook ne sera pas déclenché → état Stripe incohérent (acceptable)
```

### TC-INT-03 — Refuse → cancel PI + DB cohérent

```
GIVEN : booking bkg_int_03, status=requested, pi_id=pi_test_042
WHEN  : POST /api/bookings/bkg_int_03/refuse
THEN  : DB: booking.status='refused', payment.status='cancelled'
AND   : Stripe cancel appelé avec pi_test_042, reason="refused"→"abandoned"
AND   : réponse HTTP 200
```

### TC-INT-04 — Cancel (pre-capture) → cancel PI

```
GIVEN : booking bkg_int_04, status=accepted, payment status=authorized, pi_id=pi_test_043
WHEN  : POST /api/bookings/bkg_int_04/cancel (payer auth)
THEN  : DB: booking.status='cancelled', payment.status='cancelled'
AND   : Stripe cancel appelé avec pi_test_043, reason="cancelled"→"abandoned"
AND   : stripe_action="pi_cancelled" dans réponse
```

### TC-INT-05 — Cancel (post-capture) → refund

```
GIVEN : booking bkg_int_05, status=accepted, payment status=captured, charge_id=ch_test_044
WHEN  : POST /api/bookings/bkg_int_05/cancel (payer auth)
THEN  : DB: booking.status='cancelled', payment.status='refunded'
AND   : Stripe refund appelé avec ch_test_044, reason="requested_by_customer", idempotency_key="bkg_int_05"
AND   : stripe_action="refund_created" dans réponse
```

### TC-INT-06 — Cancel (captured, charge_id NULL) → pas de refund Stripe

```
GIVEN : booking bkg_int_06, payment status=captured, charge_id=NULL
WHEN  : POST /api/bookings/bkg_int_06/cancel
THEN  : DB: booking.status='cancelled', payment.status='refunded'
AND   : Stripe refund NON appelé
AND   : log.warning "stripe_charge_id absent — remboursement manuel requis"
AND   : stripe_action=null dans réponse
```

### TC-INT-07 — ExpiryWorker → cancel PI

```
GIVEN : booking bkg_int_07, status=awaiting_payment, expires_at < NOW(),
        pi_id=pi_test_045, pay_status=authorized
WHEN  : ExpiryWorker tick exécuté
THEN  : DB: booking.status='expired', payment.status='cancelled', slot='available'
AND   : Stripe cancel appelé avec pi_test_045, reason="expired"→"abandoned"
AND   : 2 notifications DB insérées (payer + receiver)
```

### TC-INT-08 — ExpiryWorker + cancel Stripe échoue → DB expiré quand même

```
GIVEN : booking bkg_int_08, pi_id=pi_test_046, réseau Stripe down
WHEN  : ExpiryWorker tick exécuté
THEN  : DB: booking.status='expired' (COMMIT réussi)
AND   : Stripe cancel échoue → log.error
AND   : booking traité comme expiré (pas de retry automatique)
```

---

## F. Tests de non-régression

### TC-REG-01 — Cancel d'un booking sans payment → pas d'appel Stripe

```
GIVEN : booking sans payment row (LEFT JOIN null)
WHEN  : ExpiryWorker traite ce booking
THEN  : DB: booking.status='expired'
AND   : AUCUN appel Stripe (guard: payment_id is null)
```

### TC-REG-02 — Cancel d'un booking avec payment status="pending" → pas d'appel Stripe

```
GIVEN : booking avec payment status="pending" (pas d'autorisation Stripe)
WHEN  : POST /cancel
THEN  : DB: booking.status='cancelled', payment.status inchangé ("pending")
AND   : AUCUN appel Stripe (guard: status not in authorized/requires_auth/capture_pending/captured)
```

### TC-REG-03 — Webhook post-capture ne régresse pas un refund

```
GIVEN : payment en status='refunded' (cancel + refund déjà fait)
WHEN  : webhook payment_intent.succeeded arrive (retardé)
THEN  : UPDATE payments ... WHERE status NOT IN ('captured','refunded') → 0 rows
AND   : payment reste 'refunded' (pas régressé à 'captured')
```

---

## Résumé des cas de test

| Catégorie | Nombre | Couverture |
|---|---|---|
| A. Capture unitaire | 5 | Nominal, partial, déjà captured, cancelled, timeout |
| B. Cancel unitaire | 8 | 3 raisons métier, inconnu, idempotent, déjà captured, duplicate, fraudulent |
| C. Refund unitaire | 8 | Full, partial, raison invalide, sans clé, idempotent, déjà refunded, inexistant, overflow |
| D. Infrastructure | 4 | Init clé, proxy, warning, retrieve |
| E. Intégration callers | 8 | Accept capture, refuse cancel, cancel pre/post capture, charge_id NULL, expiry, réseau down |
| F. Non-régression | 3 | Sans payment, status pending, webhook retardé |
| **TOTAL** | **36** | |
