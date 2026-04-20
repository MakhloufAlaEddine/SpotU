# SLICE_30_TEST_CASES.md — Cas de test Booking Create + Pay
> Basé sur `booking_routes.py:115–382, 558–670`, règles BR-30.01 à BR-30.18.
> Généré le 2026-04-20.

---

## Convention de naming : `T30-<ENDPOINT>-<CASE>`

- `PRV` = POST /bookings/price-preview
- `REQ` = POST /bookings/request (+alias)
- `PAY` = POST /bookings/{id}/pay

---

## 🟢 Nominal — price-preview

### T30-PRV-01 — Preview pour service actif

**Pré-conditions** : service `svc_abc` actif, price=50€. Règle pricing : fixed_fee payer 0.50€ + 2.5% payer, 0% fixed coach + 5% coach.

**Action** : `POST /api/bookings/price-preview` body `{"service_id":"svc_abc"}` + token

**Résultat attendu HTTP 200**
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

### T30-PRV-02 — Service inactif

**Pré-conditions** : `services.active=FALSE` OR inexistant.

**Résultat** : HTTP 404, `{"detail": "Service introuvable ou inactif"}`.

### T30-PRV-03 — Body sans service_id

**Action** : body `{}`.

**Résultat** : HTTP 400, `{"detail": "service_id requis"}`.

### T30-PRV-04 — Sans token

**Résultat** : HTTP 401.

---

## 🟢 Nominal — request

### T30-REQ-01 — Flux A : instant_booking + pay_now (le plus courant)

**Pré-conditions**
- Service `svc_abc` : `booking_approval_mode='instant_booking'`, `allow_pay_later=FALSE`
- Slot `slot_xyz` : `slot_type='single'`, `slot_status='available'`
- Flags globaux : les 2 à TRUE
- `app_config.pay_now_checkout_minutes = 30`

**Action**
```
POST /api/bookings/request
Body: {
  "service_id": "svc_abc",
  "slot_id": "slot_xyz",
  "scheduled_at": "2026-05-10T14:00:00Z",
  "payment_mode": "pay_now",
  "idempotency_key": "c1-uuid"
}
```

**Résultat HTTP 200** : booking complet (cf. SLICE_30_API_CONTRACTS.md §Endpoint 2 Réponse 200).

**Assertions DB**
- `bookings` : nouveau row, `status='awaiting_payment'`, `payment_status='pending'`, `expires_at ≈ NOW()+30min`, `idempotency_key='c1-uuid'`, `pricing_snapshot` JSONB valide, `payment_mode='pay_now'`
- `payments` : nouveau row, `status='requires_authorization'`, tous les montants calculés, `booking_id` FK
- `service_slots.slot_xyz.slot_status` : `'available'` → `'reserved'`
- Push notif envoyée à `receiver_user_id` (coach) avec title `"Créneau réservé (paiement en attente)"`

---

### T30-REQ-02 — Flux C : manual_approval + pay_now

**Pré-conditions**
- Service `svc_mcl` : `booking_approval_mode='manual_approval'`
- Slot présent + `'available'`
- Flag `enable_manual_approval_for_services=TRUE`

**Assertions**
- `bookings.status='requested'`, `expires_at ≈ NOW()+48h`
- `slots.slot_status='pending'`
- Push title `"Nouvelle demande de réservation"`

---

### T30-REQ-03 — Flux B : instant_booking + pay_later

**Pré-conditions**
- Service `allow_pay_later=TRUE`, `pay_later_expiration_minutes=60` (1h)
- Flag `enable_pay_later_for_services=TRUE`

**Assertions**
- `bookings.status='awaiting_payment'`, `expires_at ≈ NOW()+60min`, `payment_mode='pay_later'`
- `slots.slot_status='reserved'`

---

### T30-REQ-04 — Flux D : manual_approval + pay_later

**Pré-conditions** : service manual + pay_later, tous flags globaux ON.

**Assertions**
- `bookings.status='requested'`, `expires_at ≈ NOW()+48h` (**pas** `pay_later_expiration_minutes` ici — c'est `BOOKING_EXPIRY_HOURS` car on est en requested, pas awaiting_payment)
- `slots.slot_status='pending'`

---

### T30-REQ-05 — Sans slot_id (coaching rendez-vous libre)

**Pré-conditions** : service sans slot prérequis.

**Body** : `{"service_id": "svc", "payment_mode": "pay_now"}` (pas de slot_id)

**Assertions**
- Pas de SELECT FOR UPDATE NOWAIT.
- `bookings.slot_id=NULL`, `status='awaiting_payment'` (si instant) OU `'requested'` (si manual).
- Pas d'UPDATE `service_slots`.

---

### T30-REQ-06 — Slot recurring : pas de check status

**Pré-conditions** : slot `slot_rec` type `'recurring'` — `slot_status='available'` (ou toute valeur).

**Assertions**
- SELECT FOR UPDATE NOWAIT **OK** (lock quand même acquis).
- Pas de check `slot_status != 'available'` pour recurring.
- Pas d'UPDATE `slot_status` (recurring reste tel quel).
- Booking créé normalement.

---

## 🔵 Idempotence — request

### T30-REQ-07 — Idempotency key hit

**Setup** : booking existant avec `idempotency_key='c1-uuid'`.

**Action** : POST /bookings/request avec **même** `idempotency_key`.

**Résultat HTTP 200** : le booking existant (indiscernable de la nominal — pas de flag).

**Assertions**
- Aucun nouveau row `bookings` créé.
- Aucun nouveau `payments` créé.
- Slot inchangé.
- Pas de push (déjà envoyé à la première création).

---

### T30-REQ-08 — Idempotence (slot_id, user_id)

**Setup** : booking existant `status='awaiting_payment'` pour slot_xyz + user1.

**Action** : POST /bookings/request par user1 avec `slot_id='slot_xyz'` **sans** idempotency_key (ou avec une autre clé).

**Résultat** : 200 + booking existant (même short-circuit).

### T30-REQ-09 — Idempotence (slot_id, user_id) filtre status

**Setup** : booking **refused** pour (slot_xyz, user1).

**Action** : user1 re-POST pour slot_xyz.

**Résultat** : **nouveau** booking créé (refused exclu du filtre `status NOT IN ('refused','cancelled','expired')`).

---

## 🔴 Payload invalide — request

### T30-REQ-10 — `payment_mode` invalide

**Body** : `{"service_id":"svc","payment_mode":"bitcoin"}`.

**Résultat** : HTTP 400, `{"detail": "payment_mode doit être 'pay_now' ou 'pay_later'"}`.

### T30-REQ-11 — Payer == receiver

**Pré-condition** : `svc.coach_id == caller.user_id`.

**Résultat** : HTTP 400, `{"detail": "Impossible de réserver son propre service"}`.

### T30-REQ-12 — `pay_later` sur service qui ne l'autorise pas

**Pré-condition** : `services.allow_pay_later=FALSE`, flag global ON.

**Résultat** : HTTP 400, `{"detail": "Ce service ne permet pas le paiement différé"}`.

### T30-REQ-13 — `pay_later` interdit par flag global

**Pré-condition** : service `allow_pay_later=TRUE`, mais flag global `enable_pay_later_for_services='false'`.

**Résultat** : HTTP **409**, `{"detail": "Le paiement différé n'est pas activé sur cette plateforme — veuillez choisir 'pay_now'"}`.

> ⚠️ **409 et pas 400** — asymétrie à préserver.

---

## 🟡 Concurrence & états — request

### T30-REQ-14 — Slot verrouillé par une autre transaction

**Simulation** : 2 requêtes parallèles sur le même `slot_id`.

**Résultat**
- La 1re → 200 (réserve).
- La 2e (avant commit de la 1re) → HTTP 409, `{"detail": "Ce créneau est en cours de réservation — réessayez"}`.

### T30-REQ-15 — Slot inexistant

**Body** : `slot_id='slot_inexistant'`.

**Résultat** : HTTP 404, `{"detail": "Créneau introuvable"}`.

### T30-REQ-16 — Slot indisponible

**Pré-condition** : `slot_status='booked'` (déjà pris).

**Résultat** : HTTP 409, `{"detail": "Créneau indisponible (état : booked)"}`.

### T30-REQ-17 — Service inactif

**Pré-condition** : `services.active=FALSE`.

**Résultat** : HTTP 404, `{"detail": "Service introuvable ou inactif"}`.

### T30-REQ-18 — Flag manual_approval OFF → forcé en instant_booking

**Pré-condition** : `services.booking_approval_mode='manual_approval'`, flag `enable_manual_approval_for_services='false'`.

**Action** : POST /bookings/request avec `payment_mode='pay_now'`.

**Résultat** : 200, **`bookings.status='awaiting_payment'`** (pas `requested`). Slot → `reserved`.

---

## 🟢 Nominal — pay

### T30-PAY-01 — Pay initial (création session Stripe)

**Pré-conditions**
- Booking `bkg_abc`, `status='awaiting_payment'`, `expires_at > NOW()`
- Payment lié avec `stripe_checkout_session_id=NULL`
- Caller = payer

**Action** : POST /api/bookings/bkg_abc/pay + body `{"origin_url":"https://app.spotu.fr"}`

**Résultat HTTP 200**
```json
{
  "url": "https://checkout.stripe.com/c/pay/cs_...",
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_...",
  "session_id": "cs_..."
}
```

**Assertions DB**
- `payments` : `stripe_checkout_session_id=<new_id>`, `stripe_payment_intent_id` (peut être NULL ou set selon Stripe), `status='requires_authorization'`, `updated_at=NOW()`
- `bookings` : `payment_status='requires_authorization'`, `updated_at=NOW()`

**Assertions Stripe**
- 1 appel `create_checkout_session` avec :
  - `amount_cents = round(payer_total_amount * 100)`
  - `currency='eur'`
  - `success_url='https://app.spotu.fr/payment-success?session_id={CHECKOUT_SESSION_ID}&booking_id=bkg_abc'`
  - `cancel_url='https://app.spotu.fr/bookings'`
  - `metadata={"payment_id":"<pid>","booking_id":"bkg_abc"}`
  - `idempotency_key=<payment_id>`

---

### T30-PAY-02 — Pay idempotent (session existante réutilisée)

**Pré-conditions**
- Booking en `awaiting_payment`
- Payment `stripe_checkout_session_id='cs_existing'`
- Stripe retrieve renvoie `session.status='open'`

**Résultat HTTP 200**
```json
{
  "url": "https://checkout.stripe.com/...cs_existing...",
  "checkout_url": "https://checkout.stripe.com/...cs_existing...",
  "session_id": "cs_existing",
  "reused": true
}
```

**Assertions**
- **Aucun** appel `create_checkout_session`.
- 1 appel `retrieve_checkout_session('cs_existing')`.
- Pas de UPDATE DB (retour avant les UPDATE).

---

### T30-PAY-03 — Session Stripe expirée → nouvelle

**Pré-conditions** : `payment.stripe_checkout_session_id='cs_old'`, Stripe retrieve renvoie `status='expired'`.

**Assertions**
- 1 `retrieve_checkout_session('cs_old')`
- 1 `create_checkout_session` (nouvelle)
- UPDATE payments avec **nouveau** `stripe_checkout_session_id` (écrase l'ancien)

---

### T30-PAY-04 — retrieve throw → fallback silencieux

**Pré-conditions** : `payment.stripe_checkout_session_id='cs_legacy'`, Stripe retrieve throw `stripe.error.InvalidRequestError`.

**Assertions**
- 1 `retrieve_checkout_session` (throw)
- Try/except silencieux
- 1 `create_checkout_session` (nouvelle)
- Pas d'erreur remontée au client (HTTP 200)

---

### T30-PAY-05 — origin_url absent → fallback APP_URL env

**Pré-conditions** : `os.environ.APP_URL='https://fallback.spotu.fr'`

**Body** : `{}` (ou absent)

**Assertions**
- `success_url` starts with `https://fallback.spotu.fr/payment-success?...`

---

### T30-PAY-06 — Admin paye pour un autre user

**Pré-conditions** : caller.role='admin', bookings.payer_user_id != caller.user_id.

**Assertions** : 200 (admin autorisé).

---

### T30-PAY-07 — Fallback `payer_user_id=NULL`

**Pré-conditions** : bookings seedé avec `payer_user_id=NULL`, `user_id='uid_123'`. Caller = `'uid_123'`.

**Assertions** : 200 (fallback sur user_id).

---

## 🔴 Erreurs — pay

### T30-PAY-08 — Booking inexistant

**Résultat** : HTTP 404, `{"detail": "Réservation introuvable"}`.

### T30-PAY-09 — Pas autorisé

**Pré-conditions** : caller != payer, caller.role='user'.

**Résultat** : HTTP 403, `{"detail": "Seul le payeur peut initier le paiement"}`.

### T30-PAY-10 — Statut != awaiting_payment

**Pré-conditions** : `bookings.status='requested'`.

**Résultat** : HTTP 409, `{"detail": "Le paiement n'est disponible que pour les réservations en attente de paiement (statut actuel : 'requested')"}`.

**Test autres statuts** : `confirmed`, `refused`, `cancelled`, `expired`, `completed` → tous 409 avec le status dans le message.

### T30-PAY-11 — TTL expiré

**Pré-conditions** : `expires_at < NOW() - 1min`.

**Résultat** : HTTP **410**, `{"detail": "Le délai de paiement a expiré — réservation annulée"}`.

> ⚠️ **410 Gone** et pas 409.

### T30-PAY-12 — Payment manquant (état corrompu)

**Pré-conditions** : booking existe mais pas de row `payments` lié (seed inconsistant).

**Résultat** : HTTP 500, `{"detail": "Enregistrement de paiement manquant pour cette réservation"}`.

### T30-PAY-13 — Stripe create_checkout_session down (API Stripe crash)

**Simulation** : mock `create_checkout_session` pour throw `stripe.error.APIConnectionError`.

**Résultat** : HTTP 500 (compat Python — pas de try/except global).

**Assertions**
- **Aucun** UPDATE DB (l'erreur remonte avant).
- Payment reste inchangé.

---

## 🔐 Auth — tous endpoints

### T30-AUTH-01 — Pas de token

**Tous les endpoints** : HTTP 401.

### T30-AUTH-02 — Token expiré

**Tous** : HTTP 401.

---

## 🟤 Compatibilité stricte Python

### T30-COMPAT-01 — Messages d'erreur bit-pour-bit

| Code | Endpoint | Message |
|---|---|---|
| 400 | preview | `"service_id requis"` |
| 404 | preview | `"Service introuvable ou inactif"` |
| 400 | request | `"payment_mode doit être 'pay_now' ou 'pay_later'"` |
| 400 | request | `"Impossible de réserver son propre service"` |
| 400 | request | `"Ce service ne permet pas le paiement différé"` |
| 404 | request | `"Service introuvable ou inactif"` |
| 404 | request | `"Créneau introuvable"` |
| 409 | request | `"Ce créneau est en cours de réservation — réessayez"` |
| 409 | request | `"Créneau indisponible (état : X)"` |
| 409 | request | `"Le paiement différé n'est pas activé sur cette plateforme — veuillez choisir 'pay_now'"` |
| 404 | pay | `"Réservation introuvable"` |
| 403 | pay | `"Seul le payeur peut initier le paiement"` |
| 409 | pay | `"Le paiement n'est disponible que pour les réservations en attente de paiement (statut actuel : 'X')"` |
| 410 | pay | `"Le délai de paiement a expiré — réservation annulée"` |
| 500 | pay | `"Enregistrement de paiement manquant pour cette réservation"` |

### T30-COMPAT-02 — Format réponse pay

- **`url`** et **`checkout_url`** : **même valeur** (pas un bug)
- **`reused: true`** présent uniquement en idempotent, absent sinon
- Ordre des clés (optionnel pour JSON mais conseillé) : `url, checkout_url, session_id[, reused]`

### T30-COMPAT-03 — Format réponse request

- Même structure que GET /bookings/{id} (slice future)
- `pricing_snapshot` : JSONB **désérialisé en objet JSON** (pas string) grâce à `_deserialize()` côté Python — Java : utiliser un type JSON natif dans la sérialisation
- Timestamps ISO-8601 avec `+00:00` (pas `Z`)

### T30-COMPAT-04 — `amount_cents` rounding

Tester les valeurs limite :
- `50.00` → `5000` cents
- `50.005` → `5001` cents (HALF_UP ou bankers, à tester contre le `round()` Python)
- `50.004` → `5000` cents

> **Python `round()` utilise banker's rounding (ROUND_HALF_EVEN)** pour certains cas. Java `BigDecimal.setScale(0, RoundingMode.HALF_UP)` peut diverger. **Tester explicitement** et aligner si besoin.

### T30-COMPAT-05 — Currency lowercase Stripe

Tester que la currency passée à Stripe est **toujours lowercase** :
- `payments.currency='EUR'` → Stripe reçoit `'eur'`
- `payments.currency='eur'` → Stripe reçoit `'eur'`

### T30-COMPAT-06 — success_url token non-encodé

Tester que `{CHECKOUT_SESSION_ID}` est passé **littéralement** :
```
https://app.spotu.fr/payment-success?session_id={CHECKOUT_SESSION_ID}&booking_id=bkg_abc
```
**pas** :
```
https://app.spotu.fr/payment-success?session_id=%7BCHECKOUT_SESSION_ID%7D&booking_id=bkg_abc  ❌
```

---

## 🟡 Cas limites / stress

### T30-STRESS-01 — 100 POST /bookings/request concurrents sur le même slot

**Résultat attendu**
- 1 succès (200)
- 99 échecs : mix de 409 "Ce créneau est en cours de réservation" (si arrivent pendant le lock) et 409 "Créneau indisponible (état : reserved)" (si arrivent après commit)
- Aucun double booking en DB (contrainte de cohérence)

### T30-STRESS-02 — Même idempotency_key sur 10 requêtes

**Résultat** : les 10 → 200, un seul booking créé. 9 short-circuits.

### T30-STRESS-03 — Pay après expires_at

**Timeline** :
- T0 : POST /request → booking expires_at=T0+30min
- T+31min : POST /pay → **410**

### T30-STRESS-04 — Amount très grand

**Pré-conditions** : service price = 99999.99€.

**Assertions**
- `payer_total_amount ≈ 103499.99` (avec fees)
- `amount_cents = 10349999` (int)
- Stripe session créée OK (limite Stripe : 99999999 cents par défaut)

### T30-STRESS-05 — Amount très petit (< min Stripe)

**Pré-conditions** : service price = 0.01€.

**Assertions**
- Pricing engine calcule fees sur 0.01€
- Stripe `create_checkout_session` **peut rejeter** (minimum 0.50€ en EUR)
- Python laisse remonter l'erreur → HTTP 500

> Java compat : ne PAS ajouter de guard côté serveur — laisser Stripe décider.

---

## Matrice de couverture

| Endpoint | Nominal | Idempotence | Payload | Concurrence | Auth | Compat |
|---|---|---|---|---|---|---|
| preview | T30-PRV-01 | — | T30-PRV-03 | — | T30-PRV-04 | T30-COMPAT-01 |
| request | T30-REQ-01..06 | T30-REQ-07,08,09 | T30-REQ-10..13 | T30-REQ-14..18, T30-STRESS-01,02 | T30-AUTH-01,02 | T30-COMPAT-01,03,04 |
| pay | T30-PAY-01..07 | T30-PAY-02 | — | T30-PAY-13 | T30-AUTH-01,02 | T30-COMPAT-01,02,05,06 |

**Total : 45 cas de test minimum.**

---

## Notes pour le runner de tests Java

- **Testcontainers PostgreSQL** + migrations DB chargées.
- **WireMock** ou **Stripe Mock** pour les appels Stripe. Clé test : `sk_test_...` fournie.
- **Tester la concurrence** avec deux threads simultanés (CompletableFuture.allOf ou Vert.x).
- **MockMvc** / **WebTestClient** pour l'HTTP.
- **Seed commun** : 1 user payer, 1 user coach, 1 service actif avec variantes (manual/instant, pay_now_only, pay_later_ok), 3 slots (single/specific/recurring).
- **Transactional rollback** entre chaque test.
- **Assertions JSON** via JSONAssert STRICT pour garantir les clés + ordre.
