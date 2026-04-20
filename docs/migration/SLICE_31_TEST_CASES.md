# SLICE_31_TEST_CASES.md — Cas de test Checkout Status
> Basé sur `payment_routes.py:195–351`, règles BR-31.01 à BR-31.19.
> Généré le 2026-04-20.

---

## Convention : `T31-<CASE>`

---

## 🟢 Nominal — Branche 1-A (instant_booking → captured)

### T31-01 — Paiement instant capturé avec push

**Pré-conditions**
- Payment : `status='requires_authorization'`, `stripe_checkout_session_id='cs_abc'`, `booking_id='bkg_xyz'`
- Booking : `status='awaiting_payment'`
- Service : `title="Cours yoga"`
- Stripe session mocké : `status='complete'`, `payment_status='unpaid'`, `amount_total=5175`, `currency='eur'`

**Action** : `GET /api/payments/checkout/status/cs_abc` + Authorization OK

**Résultat HTTP 200**
```json
{
  "payment_id": "pay_...",
  "booking_id": "bkg_xyz",
  "session_id": "cs_abc",
  "status": "complete",
  "payment_status": "captured",
  "stripe_status": "unpaid",
  "amount": 51.75,
  "currency": "eur"
}
```

**Assertions DB**
- `payments.status='captured'`, `updated_at` ≈ NOW()
- `bookings.status='confirmed'`, `payment_status='paid'`, `updated_at` ≈ NOW()

**Assertions push**
- 2 appels `sendPushToUser` :
  - Payer : title=`"Réservation confirmée !"`, body=`'Votre réservation pour « Cours yoga » est confirmée. À bientôt !'`
  - Receiver : title=`"Nouvelle réservation !"`, body=`'Paiement reçu pour « Cours yoga ». Votre planning a été mis à jour.'`
- Les 2 `await` — pas de fire-and-forget

---

## 🟢 Nominal — Branche 1-B (manual_approval → authorized)

### T31-02 — Paiement autorisé, attente acceptation coach

**Pré-conditions**
- Payment : `status='requires_authorization'`
- Booking : `status='requested'` (manual_approval)
- Stripe : `status='complete'`, `payment_status='unpaid'`

**Résultat HTTP 200**
```json
{
  "payment_id": "...",
  "booking_id": "...",
  "session_id": "cs_abc",
  "status": "complete",
  "payment_status": "authorized",
  "stripe_status": "unpaid",
  "amount": 51.75,
  "currency": "eur"
}
```

**Assertions DB**
- `payments.status='authorized'`
- `bookings.payment_status='authorized'` (status **inchangé** — reste 'requested')

**Assertions push**
- **Aucun** push envoyé.

---

## 🟢 Nominal — Branche 2 (auto-capture Stripe)

### T31-03 — Stripe payment_status=paid directement

**Pré-conditions**
- Payment : `status='requires_authorization'`
- Stripe : `status='complete'`, `payment_status='paid'` (pas `unpaid`)

**Résultat HTTP 200** : `payment_status='captured'`, `stripe_status='paid'`.

**Assertions DB**
- `payments.status='captured'`
- `bookings.status='confirmed'`, `payment_status='paid'` (guardé par WHERE NOT IN)

**Assertions push**
- **Aucun** push (branche 2 n'envoie pas).

---

## 🟢 Nominal — Branche 3 (session expirée)

### T31-04 — Session Stripe expirée → cancelled

**Pré-conditions**
- Payment : `status='authorized'` (user avait autorisé mais n'a pas finalisé)
- Stripe : `status='expired'`, `payment_status='unpaid'`

**Résultat HTTP 200** : `payment_status='cancelled'`.

**Assertions DB**
- `payments.status='cancelled'`, `updated_at=NOW()`
- `bookings` : **inchangé** (pas de UPDATE booking en branche 3)

---

## 🟢 Nominal — Branche 5 (aucune transition)

### T31-05 — Paiement déjà captured, re-appel

**Pré-conditions**
- Payment : `status='captured'`
- Stripe : `status='complete'`, `payment_status='paid'`
- Booking : `status='confirmed'`

**Résultat HTTP 200** : payment_status='captured', stripe_status='paid'.

**Assertions DB**
- `payments` : **aucun UPDATE** (updated_at inchangé)
- `bookings` : **aucun UPDATE** (check `db_status not in ('captured',)` est False → elif 3 skip)

**Assertions push**
- **Aucun** push (pas de transition).

### T31-06 — Paiement déjà authorized, re-appel

**Pré-conditions**
- Payment : `status='authorized'`
- Stripe : `status='complete'`, `payment_status='unpaid'`

**Résultat HTTP 200** : payment_status='authorized'.

**Assertions**
- Branche 1 : `if db_status NOT IN ('authorized','captured','paid')` → False → skip
- Pas d'UPDATE, pas de push.

---

## 🔐 Auth OPTIONNELLE

### T31-07 — Sans Authorization header → 200

**Action** : `GET /api/payments/checkout/status/cs_abc` **sans** header Authorization.

**Résultat** : HTTP 200 (pas 401), même comportement que nominal.

### T31-08 — Authorization invalide → 200

**Action** : Header `Authorization: Bearer invalid.token`.

**Résultat** : HTTP 200. Le user est `null` en interne mais ça ne change rien au comportement (user n'est pas utilisé pour permissions).

### T31-09 — Authorization expirée → 200

**Résultat** : HTTP 200. Idem.

### T31-10 — Authorization valide → 200

**Résultat** : HTTP 200. Identique mais `user` est populé (pour logs éventuels).

> **Assertion transversale** : ces 4 cas doivent produire **exactement la même réponse JSON** et les mêmes side-effects DB.

---

## 🟠 404 — Payment non trouvé

### T31-11 — session_id inconnu

**Action** : `GET /api/payments/checkout/status/cs_inexistant`.

**Résultat** : HTTP 404, `{"detail": "Session de paiement non trouvée"}`.

**Assertions**
- **Aucun** appel Stripe retrieve (le 404 se déclenche avant).
- **Aucun** UPDATE DB.

### T31-12 — Lookup par payment_intent_id (rétrocompat)

**Pré-conditions** : payment avec `stripe_payment_intent_id='pi_abc'`, `stripe_checkout_session_id=NULL`.

**Action** : `GET /api/payments/checkout/status/pi_abc`.

**Assertions**
- Le SELECT matche via OR clause → payment trouvé.
- `real_session_id = payment.stripe_checkout_session_id (NULL) OR session_id (pi_abc) = "pi_abc"`
- Stripe retrieve avec `pi_abc` → **throw** (pas un cs_ ID) → fallback "unknown"

---

## 🟡 Fallback Stripe down

### T31-13 — Stripe API throw → fallback unknown

**Simulation** : mock `retrieveCheckoutSession` pour throw `StripeException` ("connection refused").

**Pré-conditions** : payment existant, `status='authorized'`.

**Résultat HTTP 200** :
```json
{
  "payment_id": "...",
  "booking_id": "...",
  "session_id": "cs_abc",
  "status": "unknown",
  "payment_status": "authorized",
  "amount": 51.75,
  "currency": "EUR"
}
```

**Assertions**
- Pas de clé `stripe_status` dans la réponse
- `amount` = `float(payment.payer_total_amount)`
- `currency` = `payment.currency OR "EUR"`
- **Aucun UPDATE DB**
- Log warning : `"Impossible de récupérer la session Stripe %s : %s"`

### T31-14 — Stripe timeout → fallback

**Simulation** : `retrieveCheckoutSession` throw `TimeoutException` (wrapped).

**Résultat** : idem T31-13 (try/except Exception catch tout).

---

## 🔵 Idempotence (rejouabilité)

### T31-15 — Double appel rapide (idempotent par gardes Python)

**Action**
1. Premier `GET cs_abc` → 200, payment→captured, push × 2
2. Deuxième `GET cs_abc` (immédiat) → 200, pas d'UPDATE (db_status='captured' now), pas de push

**Assertions**
- 2 UPDATE au total (seulement le 1er appel) sur payments.
- 2 push au total.
- Réponses identiques sur les 2 appels.

### T31-16 — Race : 2 appels concurrents (limite connue)

**Setup** : 2 GET cs_abc en parallèle strict.

**Résultat possible** :
- 2 UPDATE payments (peut-être, selon timing)
- **4 push** (si les 2 passent le `if db_status NOT IN (...)` ensemble)

**Acceptance** : c'est une **limitation connue** du Python. Java doit reproduire sans ajouter de lock.

> Marquer comme "known limitation" dans les tests, ne pas bloquer.

---

## 🟤 Edge cases amount/currency

### T31-17 — `session.amount_total = None`

**Pré-conditions** : Stripe session sans `amount_total` (rare mais possible).

**Action** : `amount = session.amount_total / 100 if session.amount_total else float(payment.payer_total_amount)`.

**Résultat** : `amount = float(payment.payer_total_amount)` (fallback DB).

### T31-18 — `session.amount_total = 0`

**Pré-conditions** : `amount_total=0`.

**Action** : `0` est falsy → fallback DB.

**Résultat** : `amount = float(payment.payer_total_amount)`, pas `0.0`.

### T31-19 — `session.currency = None`

**Pré-conditions** : Stripe returns `currency=None`.

**Résultat** : `currency = payment.currency OR "EUR"`.

### T31-20 — Currency casse hétérogène

**Pré-conditions** : `session.currency='eur'` (lowercase Stripe).

**Résultat** : réponse contient `"currency": "eur"` (lowercase, compat stricte).

---

## 🟣 booking_id NULL (payment sans booking)

### T31-21 — Payment subscription (pas de booking)

**Pré-conditions** : payment avec `booking_id=NULL`, Stripe `status='complete' AND payment_status='unpaid'`, `db_status='requires_authorization'`.

**Action** : GET checkout/status.

**Assertions**
- Pas de SELECT sur `bookings`
- `bk_row = None` → `is_instant = False` → branche 1-B (manual path)
- UPDATE payments → authorized
- **Pas** d'UPDATE bookings (check `if payment.get("booking_id")`)
- `payment_status = "authorized"` dans réponse, `booking_id = null`

---

## 🟣 Cas limites bookings

### T31-22 — Booking refused entre pay et check

**Pré-conditions**
- Booking : `status='refused'` (coach a refusé pendant que user était sur Stripe)
- Payment : `status='requires_authorization'`
- Stripe : `status='complete'`, `payment_status='unpaid'`

**Action** : GET checkout/status par le user (qui ignore que c'est refused).

**Assertions branche 1 instant path** :
- `bk_row.status='refused'` → `is_instant = False` → branche 1-B
- UPDATE payments → authorized
- UPDATE bookings `payment_status='authorized'` : **pas de garde WHERE status NOT IN** → **le refused voit son payment_status passer à 'authorized'**
- État résultant : booking refused + payment authorized (incohérent mais compat stricte Python)

> ⚠️ **Asymétrie documentée** : la branche 1-B UPDATE bookings N'A PAS le garde. Compat stricte.

### T31-23 — Booking confirmed (déjà traité par webhook)

**Pré-conditions**
- Booking : `status='confirmed'`, `payment_status='paid'`
- Payment : `status='captured'`
- Stripe : `status='complete'`, `payment_status='paid'`

**Assertions**
- Branche 2 : `db_status != 'captured'` → False → skip
- Pas d'UPDATE, pas de push
- Réponse : `payment_status='captured'`, `stripe_status='paid'`

---

## 🟤 Compatibilité stricte Python

### T31-24 — Messages d'erreur exacts

| Code | Message |
|---|---|
| 404 | `"Session de paiement non trouvée"` |

### T31-25 — Format réponse nominal

Ordre des clés (recommandé) : `payment_id, booking_id, session_id, status, payment_status, stripe_status, amount, currency`.

Toutes les clés présentes. `booking_id=null` si absent.

### T31-26 — Format réponse fallback

Ordre des clés : `payment_id, booking_id, session_id, status, payment_status, amount, currency`.

**Pas de clé `stripe_status`**.

### T31-27 — Push payload exact

```json
{
  "type":       "booking_confirmed",
  "booking_id": "bkg_xyz"
}
```

⚠️ `booking_id` snake_case (pas `bookingId` comme S30).

### T31-28 — Guillemets français dans push body

Body payer : `'Votre réservation pour « Cours yoga » est confirmée. À bientôt !'`

⚠️ Caractères Unicode : `«` (U+00AB), `»` (U+00BB), `À` (U+00C0), `é` (U+00E9). Encoding UTF-8 strict.

### T31-29 — Log warning exact

```
Impossible de récupérer la session Stripe cs_abc : <exception message>
```

---

## 🟢 Cas service.title fallback

### T31-30 — Service title absent → fallback

**Pré-conditions** : JOIN bookings + services ne retourne rien (edge case booking orphelin).

**Assertions**
- `title = "votre prestation"` (fallback)
- Push body : `'Votre réservation pour « votre prestation » est confirmée. À bientôt !'`

---

## Matrice de couverture

| Axe | Cas |
|---|---|
| Branche 1-A (instant captured) | T31-01, T31-30 |
| Branche 1-B (manual authorized) | T31-02, T31-21, T31-22 |
| Branche 2 (stripe paid direct) | T31-03 |
| Branche 3 (session expired) | T31-04 |
| Branche 5 (no transition) | T31-05, T31-06, T31-23 |
| Auth optionnelle | T31-07..10 |
| 404 | T31-11 |
| Rétrocompat PI lookup | T31-12 |
| Fallback Stripe down | T31-13, T31-14 |
| Idempotence | T31-15, T31-16 |
| Edge amount | T31-17, T31-18 |
| Edge currency | T31-19, T31-20 |
| Compat stricte | T31-24..29 |

**Total : 30 cas de test.**

---

## Notes pour le runner de tests Java

- **Testcontainers PostgreSQL** + migrations.
- **WireMock** ou **Stripe-mock** pour `retrieveCheckoutSession` avec réponses programmables.
- **Mock PushService** pour capturer les appels (count + payload).
- **Tester strictement l'ordre des tables updated** via query logs.
- **JSONAssert STRICT** pour comparer les réponses bit-pour-bit.
- **Tester l'encoding UTF-8** des guillemets français dans les push body.
- **Seed minimal** : 1 user payer, 1 coach, 1 service (title), 1 booking (awaiting_payment / requested / refused / confirmed selon cas), 1 payment lié.
