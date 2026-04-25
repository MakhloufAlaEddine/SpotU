# SLICE_33_TEST_CASES.md — Cas de test Webhook Payment Handlers
> Basé sur `webhook_handlers.py:122–180, 185–453`, BR-33.01 à BR-33.19.
> Généré le 2026-04-25.

---

## Convention : `T33-<CASE>`

Tests numérotés par catégorie. Total **42 cas**.

---

## 🟢 Nominal — `checkout.session.completed`

### T33-01 — CSC mode=payment, ps=unpaid, booking awaiting_payment (Branch A — instant_booking)

**Pré-conditions** :
- `payments` row : `payment_id='pay_001'`, `status='pending'`, `stripe_checkout_session_id='cs_001'`, `payer_user_id='u_payer'`, `receiver_user_id='u_recv'`, `booking_id='bkg_001'`
- `bookings` row : `booking_id='bkg_001'`, `status='awaiting_payment'`, `service_id='svc_001'`
- `services` row : `service_id='svc_001'`, `title='Coaching footing'`

**Action** : webhook `checkout.session.completed` avec :
```json
{
  "id": "evt_001",
  "type": "checkout.session.completed",
  "data": {"object": {
    "id": "cs_001", "mode": "payment", "payment_status": "unpaid",
    "metadata": {"payment_id": "pay_001", "booking_id": "bkg_001"}
  }}
}
```

**Résultat HTTP 200** : `{"received": true}`.

**Assertions DB** :
- `payments.status='captured'`, `updated_at` ~NOW()
- `bookings.status='confirmed'`, `bookings.payment_status='paid'`, `updated_at` ~NOW()

**Assertions notifications** (table `notifications` + WebSocket) :
- 2 rows insérées
- Row 1 : `user_id='u_payer'`, `type='booking_confirmed'`, `title='Réservation confirmée !'`, body contient `« Coaching footing » est confirmée. À bientôt !`
- Row 2 : `user_id='u_recv'`, `type='booking_confirmed'`, `title='Nouvelle réservation !'`, body contient `Paiement reçu pour « Coaching footing »`
- `data` JSON pour chaque : `{type, booking_id: 'bkg_001', payment_id: 'pay_001'}`

**Assertions logs** :
- INFO `"Payment event traité : type=checkout.session.completed | payment=pay_001 | booking=bkg_001"`
- 2× INFO `"Notification envoyée : type=booking_confirmed | user=..."`

### T33-02 — CSC mode=payment, ps=unpaid, booking status=`requested` (Branch B — manual_approval)

**Pré-conditions** : booking.status='requested' (pas `awaiting_payment`).

**Résultat DB** :
- `payments.status='authorized'` (PAS `captured`)
- `bookings` **NON modifiée** (toujours `requested`)

**Notifs** :
- 1 seule notif vers `receiver_user_id` : `payment_authorized`, body `"Le paiement pour votre prestation a été autorisé."`
- **Aucune notif** au `payer_user_id`.

### T33-03 — CSC mode=payment, ps=paid (Branch C — capture immédiate Stripe)

**Pré-conditions** : booking.status='requested' ou autre.

**Résultat DB** :
- `payments.status='captured'`
- `bookings.status='confirmed'`, `payment_status='paid'`

**Notifs** :
- 2 notifs `booking_confirmed`
- Body payer : `"Votre réservation pour « ... » est confirmée."` ← **PAS de "À bientôt !"** (différencie de T33-01)
- Body receiver : `"Paiement reçu pour « ... »"` (identique à T33-01)

### T33-04 — CSC mode=subscription → skip immédiat

**Pré-conditions** : `obj.mode='subscription'`.

**Résultat** :
- HTTP 200
- Aucune transition `payments` ou `bookings`
- Aucune notification émise par S33
- (S35 traitera dans le `_handle_subscription_event`, hors scope S33)

---

## 🟢 Nominal — `payment_intent.*`

### T33-05 — `payment_intent.amount_capturable_updated`

**Action** : event avec `type='payment_intent.amount_capturable_updated'`, metadata `payment_id` valide.

**Résultat** :
- `payments.status='authorized'`
- 1 notif `payment_authorized` au `receiver_user_id`
- Body : `"Le paiement pour votre prestation est confirmé — vous pouvez procéder."` ← **différent** de T33-02

### T33-06 — `payment_intent.succeeded` avec `latest_charge`

**Action** :
```json
{"type":"payment_intent.succeeded", "data":{"object":{
  "id":"pi_001",
  "latest_charge":"ch_001",
  "metadata":{"payment_id":"pay_001","booking_id":"bkg_001"}
}}}
```

**Résultat DB** :
- `payments.status='captured'`, **`payments.stripe_charge_id='ch_001'`**, `updated_at` updated
- `bookings.status='confirmed'`, `bookings.payment_status='paid'`

**Notifs** :
- 2 notifs `booking_confirmed`
- Body receiver : `"Paiement capturé pour « ... »"` ← **"capturé"** (différent de T33-01 / T33-03)

### T33-07 — `payment_intent.succeeded` SANS `latest_charge`

**Action** : `latest_charge` absent ou `null`.

**Résultat DB** :
- `payments.status='captured'`, `stripe_charge_id` **NON modifié** (reste tel quel)
- `bookings.status='confirmed'`

### T33-08 — `payment_intent.succeeded` avec `latest_charge` non-string (objet expanded)

**Action** : `latest_charge: {"id":"ch_001", "object":"charge"}` (Stripe API expand).

**Résultat** :
- Branche fallback (sans set `stripe_charge_id`)
- `payments.status='captured'`
- Reproduire le test `isinstance(str)` strict.

### T33-09 — `payment_intent.payment_failed`

**Action** : event PI failed avec metadata.payment_id valide.

**Résultat DB** :
- `payments.status='failed'`
- `bookings` **NON modifiée**

**Notifs** :
- 1 notif `payment_failed` au `payer_user_id` (PAS receiver)
- Body : `"Votre paiement n'a pas pu être traité. Veuillez vérifier votre moyen de paiement."`

### T33-10 — `payment_intent.canceled`

**Action** : event PI canceled.

**Résultat DB** :
- `payments.status='cancelled'`

**Notifs** :
- **AUCUNE** (asymétrie volontaire)

---

## 🔵 Idempotence — retry Stripe sur même event_id

### T33-11 — Re-livraison `payment_intent.succeeded` (same event_id)

**Setup** : T33-06 déjà exécuté (`payments.status='captured'`).

**Action** : POST identique avec même `id='evt_006'`.

**Résultat** :
- HTTP 200, body `{"received": true, "idempotent_skip": true}`
- **Aucun** UPDATE additionnel (S32 short-circuite)
- **Aucune** notif émise

### T33-12 — Re-livraison avec event_id différent (Stripe pourrait envoyer 2 events distincts pour même PI)

**Setup** : T33-06 (`payments.status='captured'`).

**Action** : NOUVEAU event `evt_006_bis` avec même PI/payment_id, type `payment_intent.succeeded`.

**Résultat** :
- HTTP 200 `{"received": true}` (passe S32 idempotence event-level)
- L'UPDATE payments est exécuté MAIS **`rows_updated=0`** (status déjà `captured`)
- L'UPDATE bookings : exécuté mais **`rows=0`** (status déjà `confirmed`)
- **Aucune** notif émise (guard `rows_updated > 0`)
- `stripe_webhook_events.status='success'` quand même

---

## 🟠 Concurrence avec S31

### T33-13 — S31 a déjà set `captured` avant le webhook

**Setup** : Buyer revient via redirect Stripe → S31 fait UPDATE `status='captured'` best-effort. Puis Stripe envoie webhook PI succeeded.

**Action** : webhook arrive avec `payments.status` déjà = `captured`.

**Résultat** :
- UPDATE rows=0 (guard bloque)
- **Aucune notif émise par S33** ← **trou fonctionnel** documenté en BR-33.16
- Booking peut rester en `confirmed` si S31 l'a déjà set (rare car S31 ne touche pas bookings)

> ⚠️ Si bookings.status pas `confirmed` (S31 ne le fait pas), S33 le fait quand même via UPDATE bookings sans guard sur payments. **Mais sans notif** (rows_updated payments = 0).

### T33-14 — Webhook arrive AVANT le redirect buyer (cas normal)

**Setup** : payment vient d'être créé via S30, status='pending'. Stripe envoie webhook avant que le buyer ne revienne sur l'app.

**Action** : webhook PI succeeded.

**Résultat** : T33-06 normal.

Quand le buyer arrive ensuite et déclenche S31, S31 voit `status='captured'` (rows=0 dans son UPDATE) → idempotent.

---

## 🔴 Cas d'erreur — payment introuvable

### T33-15 — `payment_id` absent dans metadata + PI introuvable en DB

**Setup** : Webhook avec `metadata: {}` et `obj.id='pi_unknown'` non présent dans `payments`.

**Action** : event `payment_intent.succeeded`.

**Résultat** :
- `_resolve_payment_id` retourne `(None, None)`
- Dispatcher : log DEBUG `"Webhook payment sans payment_id : type=payment_intent.succeeded"`
- `_handle_payment_event` **NON appelé**
- `stripe_webhook_events.status='success'` (pas error — c'est un cas normal)
- HTTP 200

### T33-16 — `payment_id` dans metadata mais payment supprimé en DB

**Setup** : metadata `payment_id='pay_deleted'` mais row supprimée.

**Action** : event PI succeeded.

**Résultat** :
- `_resolve_payment_id` retourne `('pay_deleted', booking_id_meta)` (court-circuit metadata)
- `_handle_payment_event` est appelé
- UPDATE payments WHERE payment_id='pay_deleted' → rows=0 (row absente)
- Aucune notif (`rows_updated > 0` faux)
- HTTP 200, status='success'

### T33-17 — `booking_id` absent (paiement orphelin)

**Setup** : payment sans booking_id (NULL).

**Action** : event PI succeeded.

**Résultat** :
- UPDATE payments → rows=1, status=captured
- `if booking_id:` faux → pas d'UPDATE bookings
- `if rows_updated > 0 and booking_id:` faux → **aucune notif**
- HTTP 200

### T33-18 — `booking_id` présent mais booking supprimé

**Setup** : `payments.booking_id='bkg_deleted'`, mais bookings row absente.

**Action** : event PI succeeded.

**Résultat** :
- UPDATE payments → rows=1
- UPDATE bookings → rows=0 (silent)
- JOIN services → 0 row → fallback `"votre prestation"`
- Notifs émises avec title=`"votre prestation"`

---

## 🟣 Lookup `_resolve_payment_id` — toutes stratégies

### T33-19 — Strat. 1 : `metadata.payment_id`

**Action** : event avec `metadata.payment_id='pay_meta'`.

**Résultat** : retourne directement `('pay_meta', metadata.booking_id)` sans aller en DB.

### T33-20 — Strat. 2 : `stripe_payment_intent_id` lookup

**Action** : event sans metadata.payment_id, `obj.id='pi_xxx'` présent dans `payments.stripe_payment_intent_id`.

**Résultat** : SELECT trouve, retourne `(payment_id, booking_id)`.

### T33-21 — Strat. 3 : `stripe_checkout_session_id` lookup

**Action** : event `checkout.session.completed`, sans metadata, `obj.id='cs_xxx'` présent dans `payments.stripe_checkout_session_id`.

**Résultat** : Strat. 2 vide (pas de PI). Strat. 3 match.

### T33-22 — Strat. 4 : `stripe_charge_id` lookup

**Action** : event `charge.refunded` (S34) avec `obj.id='ch_xxx'` présent dans `payments.stripe_charge_id`.

> Bien que `_handle_charge_event` soit hors S33, `_resolve_payment_id` doit gérer ce cas pour cohérence.

**Résultat** : Strat. 2/3 vides → Strat. 4 match si `ch_*`.

### T33-23 — Strat. 4 : charge_id NON `ch_*` (ex: format Stripe alternatif)

**Action** : `obj.charge='py_xxx'` (test ne commence pas par `ch_`).

**Résultat** : Strat. 4 ignorée → retourne `(None, None)`.

> ⚠️ Test critique : reproduire le `startswith("ch_")` Python.

### T33-24 — Toutes stratégies vides

**Action** : event sans metadata, sans PI, sans CS, sans charge connu.

**Résultat** : `(None, None)` → log DEBUG → skip handler.

---

## 🟡 Idempotence handler-level (rows_updated)

### T33-25 — Re-traitement event avec status déjà `failed`

**Setup** : `payments.status='failed'`.

**Action** : event `payment_intent.succeeded` (cas normal après retry buyer succeed).

**Résultat** :
- Guard `WHERE status NOT IN ('captured','refunded')` → autorise (failed n'est pas dans la liste)
- UPDATE rows=1, status=captured
- Notifs envoyées normalement

> ⚠️ Test important : un PI peut transitionner `failed → captured` en cas de retry. Le guard l'autorise.

### T33-26 — Tentative `failed` après `captured`

**Setup** : `payments.status='captured'`.

**Action** : event `payment_intent.payment_failed` (rare mais possible — Stripe peut retry et échouer après une réussite annulée).

**Résultat** :
- Guard `WHERE status NOT IN ('captured','refunded','failed')` → bloque
- rows=0
- Pas de notif

### T33-27 — Tentative `cancelled` après `captured`

**Setup** : `payments.status='captured'`.

**Action** : event PI canceled.

**Résultat** :
- Guard bloque, rows=0
- Pas d'effet (la canceled tardive est ignorée)

---

## 🟤 Compat stricte Python

### T33-28 — Format réponse identique à S32

`{"received": true}` ou `{"received": true, "idempotent_skip": true}`. **Pas** d'autres clés.

### T33-29 — Libellés notifs EXACTS Branch A

Test bit-pour-bit les 4 strings (title + body) pour Branch A et Branch C. Voir BR-33.04.

### T33-30 — Libellé notif Branch B vs amount_capturable_updated

Body **différent** :
- Branch B : `"Le paiement pour votre prestation a été autorisé."`
- amount_capturable_updated : `"Le paiement pour votre prestation est confirmé — vous pouvez procéder."`

Tester les 2 séparément.

### T33-31 — Body receiver `payment_intent.succeeded` dit "capturé" pas "reçu"

Test critique : `"Paiement capturé pour « ... »"` (PI succeeded) vs `"Paiement reçu pour « ... »"` (CSC paid).

### T33-32 — `data` payload de notif

Tester que `data` contient :
```json
{"type": "<notif_type>", "booking_id": "<bkg_id>", "payment_id": "<pay_id>"}
```

Le `type` à l'intérieur de `data` duplique le `type` de la notif.

### T33-33 — Logs format exact

```
INFO Payment event traité : type=payment_intent.succeeded | payment=pay_001 | booking=bkg_001
DEBUG Webhook payment sans payment_id : type=payment_intent.succeeded
INFO Notification envoyée : type=booking_confirmed | user=u_payer
```

Reproduire les espaces autour de `|`.

### T33-34 — `_PAYMENT_EVENTS` set EXACTEMENT 5 events

Aucun event hors-set ne déclenche `_handle_payment_event`. Liste exacte : voir BR-33.02.

### T33-35 — `payment_intent.canceled` AUCUNE notif

Aucune row insérée dans `notifications` pour cet event. Test critique d'asymétrie.

### T33-36 — Atomicité TX payments+bookings

Forcer un crash entre UPDATE payments et UPDATE bookings (mock SQL exception sur bookings) → la TX rollback → payments **retour à pending** (pas captured persisté).

---

## 🟦 Cas robustesse

### T33-37 — `bookings.status` lookup retourne 0 row (booking introuvable mais booking_id set)

**Setup** : metadata `booking_id='bkg_orphan'` mais row absente.

**Action** : CSC mode=payment, ps=unpaid.

**Résultat Python** :
- `bk_row` = None
- Branche prise = Branch B (authorize) car `bk_row.status` n'est pas `awaiting_payment`
- payments → authorized
- 1 notif `payment_authorized` au receiver

> ⚠️ Reproduire ce comportement exact : booking introuvable = traité comme manual_approval.

### T33-38 — `services` JOIN retourne 0 row

**Setup** : booking valide mais service supprimé.

**Action** : event PI succeeded.

**Résultat** : title fallback = `"votre prestation"`.

### T33-39 — Notif `store_notification` throw (DB down)

**Setup** : mock `notifications` INSERT throw `SQLException`.

**Action** : event PI succeeded.

**Résultat** :
- payments+bookings UPDATE OK (TX commit avant la notif)
- Dispatcher S32 catch l'exception (boucle `pending_notifs`) → log WARNING
- HTTP 200 quand même (notif loss tolerated)
- `stripe_webhook_events.status='success'` (la notif n'est pas dans le scope error)

### T33-40 — Charset UTF-8 dans `services.title`

**Setup** : `title='Coaching « yoga 🧘 » avancé'`.

**Action** : event PI succeeded.

**Résultat** : body de notif contient les emojis et guillemets sans corruption.

---

## 🟧 Régression S30/S31

### T33-41 — Compat S30 : metadata.payment_id présent au format S30

**Setup** : payment créé via S30, metadata Stripe checkout session = `{payment_id: "pay_xxx", booking_id: "bkg_xxx"}`.

**Action** : webhook `checkout.session.completed`.

**Résultat** : Strat. 1 match → flow nominal.

### T33-42 — Compat S31 : webhook arrive après S31 a déjà set captured

**Setup** : Buyer arrive via redirect → S31 set `captured`. Puis webhook arrive.

**Résultat** : voir T33-13. **Trou fonctionnel** documenté.

---

## Matrice de couverture

| Axe | Cas |
|---|---|
| Nominal CSC | T33-01, T33-02, T33-03, T33-04 |
| Nominal PI | T33-05 à T33-10 |
| Idempotence | T33-11, T33-12 |
| Concurrence S31 | T33-13, T33-14 |
| Payment introuvable | T33-15 à T33-18 |
| Resolver stratégies | T33-19 à T33-24 |
| Idempotence handler-level | T33-25 à T33-27 |
| Compat strict Python | T33-28 à T33-36 |
| Robustesse | T33-37 à T33-40 |
| Régression S30/S31 | T33-41, T33-42 |

**Total : 42 cas de test minimum.**

---

## Notes runner Java

- **Testcontainers PostgreSQL** + migration créant `payments`, `bookings`, `services`, `notifications`.
- **Stripe Webhook Signature Test Helper** (de S32) pour générer des signatures valides en test.
- **Mock NotificationService** pour intercepter les `pendingNotifs` et asserter title/body/data byte-pour-byte.
- **Vérifier guards** : seeder un payment en chaque status (`pending`, `authorized`, `captured`, `failed`, `cancelled`, `refunded`) et envoyer chaque event → vérifier rows_updated et l'absence de transition régressive.
- **JSONAssert STRICT** pour comparer les bodies de notifs.
- **Test concurrence** S31↔S33 : utiliser `CompletableFuture.allOf` avec un patch sur S31 simulant l'UPDATE captured juste avant l'arrivée du webhook.
- **Test charge_id non-string** : créer un mock `Map` avec `latest_charge: Map.of("id","ch_x","object","charge")` et vérifier branche fallback.
- **Test logs** : utiliser `MemoryAppender` SLF4J pour asserter format `|` exact.
