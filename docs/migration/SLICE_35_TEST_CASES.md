# SLICE_35_TEST_CASES.md — Cas de test Webhook Charge/Refund Handlers
> Basé sur `webhook_handlers.py:458–582`, BR-35.01 à BR-35.15.
> Généré le 2026-04-25.

---

## Convention : `T35-<CASE>`

Total **30 cas de test**.

---

## 🟢 Nominal — `charge.refunded`

### T35-01 — Full refund avec metadata.payment_id

**Pré-conditions** :
- `payments.pay_001` : status=`captured`, payer_user_id=`u_payer`, receiver_user_id=`u_recv`, payer_total_amount=51.75, stripe_charge_id=`ch_existing`, refund_amount=NULL, refund_status=NULL

**Action** :
```json
POST /api/webhook/stripe (signature valide)
{
  "id": "evt_001",
  "type": "charge.refunded",
  "data": {"object": {
    "id": "ch_001",
    "amount_refunded": 5175,
    "refunded": true,
    "metadata": {"payment_id": "pay_001"}
  }}
}
```

**Résultat HTTP 200** : `{"received": true}`.

**Assertions DB** :
- `payments.pay_001.status` = `'refunded'`
- `payments.pay_001.refund_amount` = `51.75`
- `payments.pay_001.refund_status` = `'succeeded'`
- `payments.pay_001.stripe_charge_id` = `'ch_existing'` ← inchangé (COALESCE)
- `updated_at` updated

**Assertions notifications** :
- 1 row insérée dans `notifications`
- `user_id` = `u_payer`
- `type` = `'payment_refunded'`
- `title` = `"Remboursement effectué"`
- `body` = `"Vous avez été remboursé de 51.75 €."` (point décimal)
- `data` = `{type:"payment_refunded", payment_id:"pay_001", refund_amount:51.75, fully_refunded:true}`

**Assertions logs** :
- INFO `"Remboursement : payment=pay_001 | amount=51.75€ | full=True → status=refunded"`

### T35-02 — Partial refund

**Pré-conditions** : `pay_001` (captured, total 51.75).

**Action** : `charge.refunded` avec `amount_refunded=2000, refunded=false`.

**Résultat DB** :
- `status='partially_refunded'`
- `refund_amount=20.00`

**Notif** :
- `title='Remboursement partiel'`
- `body='Un remboursement partiel de 20.00 € a été initié.'`
- `data.fully_refunded=false`

### T35-03 — Full refund avec stripe_charge_id NULL initialement (COALESCE)

**Pré-conditions** : `pay_001`.stripe_charge_id = NULL (cas où S33 PI succeeded n'a jamais set).

**Action** : `charge.refunded` avec `obj.id='ch_002'`.

**Résultat DB** : `stripe_charge_id='ch_002'` (set via COALESCE).

### T35-04 — Resolution via fallback charge_id (pas de metadata)

**Pré-conditions** :
- `pay_001`.stripe_charge_id=`ch_003`
- Webhook `charge.refunded` avec `metadata={}` mais `obj.id='ch_003'`

**Résultat** :
- Phase 1 resolver S33 échoue (pas de metadata)
- Fallback local `_handle_charge_event` SELECT par stripe_charge_id → trouve pay_001
- Procède normalement → status='refunded', notif émise

### T35-05 — Resolution complètement échouée

**Pré-conditions** : aucun payment avec `metadata.payment_id` ni `stripe_charge_id` correspondant.

**Action** : `charge.refunded`.

**Résultat** :
- log DEBUG `"charge.refunded : payment_id introuvable (charge=ch_xxx)"`
- early return
- `stripe_webhook_events.status='success'` (pas error)
- HTTP 200, **aucune** notif

### T35-06 — Format montant `:.2f` Locale-independent

**Action** : `amount_refunded=10075` (100.75 €).

**Assertion body** : `"Vous avez été remboursé de 100.75 €."` (point, pas virgule, **même si serveur en Locale.FRANCE**).

### T35-07 — `amount_refunded` absent (default 0)

**Action** : `charge.refunded` sans `amount_refunded`.

**Résultat** : `refund_amount=0.00`, notif body `"Un remboursement partiel de 0.00 € a été initié."` (refunded=false donc partial). Edge case rare.

### T35-08 — `refunded` absent (default false → partial)

**Action** : `charge.refunded` sans champ `refunded`.

**Résultat** : `bool(None)=False` → `status='partially_refunded'`.

---

## 🟢 Nominal — `refund.updated`

### T35-09 — Sync `refund_status='pending'`

**Pré-conditions** : `pay_001` avec metadata.payment_id résolu.

**Action** : `refund.updated` avec `obj.status='pending'`, `metadata.payment_id='pay_001'`.

**Résultat DB** :
- `payments.pay_001.refund_status='pending'`
- `payments.pay_001.status` **inchangé** (pas de transition)
- `updated_at` updated

**Notifs** : **AUCUNE**.

**Logs** : INFO `"refund.updated : refund=re_xxx | status=pending | payment=pay_001"`.

### T35-10 — Sync `refund_status='succeeded'` (sans Phase 1)

**Pré-conditions** : `pay_001` resolved via metadata, status=captured (pas refunded yet).

**Action** : `refund.updated` avec `obj.status='succeeded'`.

**Résultat** :
- `refund_status='succeeded'`
- `status` **inchangé** (pas de transition status)
- Pas de notif

> ⚠️ Test critique : `refund.updated` ne change **PAS** `status` (sauf Phase 1 edge case).

### T35-11 — Sync `refund_status='failed'`

**Action** : `obj.status='failed'`.

**Résultat** : `refund_status='failed'`.

### T35-12 — Sync `refund_status='canceled'`

**Action** : `obj.status='canceled'`.

**Résultat** : `refund_status='canceled'`.

### T35-13 — Phase 1 edge case : full refund via refund.updated

**Pré-conditions** :
- `pay_001`.payer_total_amount=51.75, status=`captured`
- `pay_001`.stripe_charge_id=`ch_005`
- Webhook `refund.updated` avec `metadata={}`, `obj.charge='ch_005'`, `obj.status='succeeded'`, `obj.amount=5175` (51.75 €)

**Résultat** :
- Resolver S33 échoue (pas de metadata, pas de PI lookup)
- Phase 1 lookup via charge_id trouve pay_001 + total=51.75
- Condition Phase 1 vérifiée : succeeded ET abs(51.75 - 51.75) < 0.02
- UPDATE `status='refunded'`, `refund_status='succeeded'`, `refund_amount=51.75`
- log INFO `"refund.updated → remboursement complet confirmé : refund=re_xxx | payment=pay_001"`
- **EARLY RETURN** — pas de Phase 2
- Pas de notif

### T35-14 — Phase 1 condition non remplie : amount ≠ total → tombe en Phase 2

**Pré-conditions** : payer_total_amount=51.75, refund.amount=2000 (20 €).

**Résultat** :
- Phase 1 : amount=20.00, total=51.75 → `abs(20-51.75)=31.75` ≥ 0.02 → condition fail
- Phase 1 set quand même `payment_id` (issu du SELECT) — c'est dans le if `if row:`
- Tombe en Phase 2 → UPDATE `refund_status='succeeded'` simple
- `status` **inchangé** (reste `captured`)

### T35-15 — Phase 1 tolerance 0.019 (juste sous le seuil)

**Pré-conditions** : payer_total_amount=51.75, refund.amount=5176 (51.76 €).

**Résultat** :
- abs(51.76 - 51.75) = 0.01 < 0.02 ✓ → Phase 1 trigger → `status='refunded'`

### T35-16 — Phase 1 tolerance 0.020 (exactement au seuil)

**Pré-conditions** : amount=51.77, total=51.75.

**Résultat** :
- abs(51.77 - 51.75) = 0.02 → comparaison `< 0.02` est False → Phase 1 ne trigger pas → tombe en Phase 2

> ⚠️ Test limite. `< 0.02` strict (pas `<= 0.02`).

### T35-17 — Phase 1 condition status≠succeeded → skip Phase 1

**Pré-conditions** : amount==total mais `obj.status='pending'`.

**Résultat** : Phase 1 skip → Phase 2 UPDATE refund_status='pending'.

### T35-18 — `refund.updated` payment introuvable

**Pré-conditions** : aucun payment correspondant.

**Résultat** :
- Phase 1 lookup vide → payment_id reste None
- `if payment_id:` Phase 2 skip
- log DEBUG `"refund.updated : payment introuvable (refund=re_xxx charge=ch_xxx)"`
- HTTP 200, aucun effet, aucune notif

### T35-19 — `refund.updated` payer_total_amount NULL

**Pré-conditions** : `pay_001`.payer_total_amount = NULL.

**Action** : `refund.updated` avec amount=5175.

**Résultat** :
- `total = float(None or 0) = 0.0`
- abs(51.75 - 0) = 51.75 ≥ 0.02 → Phase 1 skip
- Phase 2 UPDATE refund_status

---

## 🔵 Idempotence

### T35-20 — Re-livraison `charge.refunded` même event_id (S32)

**Setup** : T35-01 déjà exécuté.

**Action** : POST identique avec même `id='evt_001'`.

**Résultat** : HTTP 200, `{"received": true, "idempotent_skip": true}`. Pas de double-notif (S32 short-circuite).

### T35-21 — Event_id différent mais payment déjà refunded

**Setup** : T35-01 (status='refunded') déjà appliqué.

**Action** : POST `charge.refunded` avec event_id `evt_002` (différent), même metadata.payment_id.

**Résultat** :
- S32 idempotence passe (event_id nouveau)
- UPDATE rows=0 (guard `WHERE status NOT IN ('refunded')`)
- **Aucune notif** émise (rows_updated == 0)
- `stripe_webhook_events.status='success'` quand même

### T35-22 — `refund.updated` reçu APRÈS `charge.refunded` (cas concurrence)

**Setup** : T35-01 → status='refunded'.

**Action** : `refund.updated` event arrive ensuite.

**Résultat** :
- payment_id résolu via metadata
- Phase 1 condition `if not payment_id` fail (déjà résolu) → skip
- Phase 2 UPDATE `refund_status='succeeded'` (no-op, déjà succeeded)
- Pas de notif

### T35-23 — `refund.updated` reçu AVANT `charge.refunded` (cas inverse rare)

**Setup** : pay_001 status=`captured`, refund_amount=NULL.

**Action 1** : `refund.updated` (succeeded, full amount, no metadata, charge match) → Phase 1 trigger → `status='refunded'`, pas de notif.

**Action 2** : `charge.refunded` arrive ensuite.

**Résultat Action 2** :
- UPDATE rows=0 (guard bloque, déjà refunded)
- **Aucune notif émise** ← ⚠️ trou fonctionnel volontaire (BR-35.10/BR-35.15)
- HTTP 200

> ⚠️ Test documente le trou : si `refund.updated` Phase 1 trigger en premier, le payer ne reçoit pas de notif.

---

## 🔴 Cas erreur

### T35-24 — Handler exception (DB down)

**Setup** : mock `paymentRepo.markRefunded` throw `SQLException`.

**Action** : `charge.refunded`.

**Résultat** :
- Dispatcher S32 catch → log EXCEPTION → `stripe_webhook_events.status='error'` + `error_message`
- HTTP 200 (compat S32 always-200)
- Aucun crash serveur

### T35-25 — `obj.id` absent (`charge_id=None`) + pas de metadata

**Action** : `charge.refunded` avec body sans `id`.

**Résultat** :
- Resolver S33 strat. 4 échoue (charge_id None)
- Fallback local `_handle_charge_event` : `_get(obj, "id")` = None → skip lookup
- log DEBUG → return
- HTTP 200

---

## 🟤 Compatibilité stricte Python

### T35-26 — Format réponse identique à S32/S33

`{"received": true}` ou `{"received": true, "idempotent_skip": true}`.

### T35-27 — Libellés notif EXACTS

| Cas | title | body |
|---|---|---|
| Full refund | `Remboursement effectué` | `Vous avez été remboursé de {amt:.2f} €.` |
| Partial | `Remboursement partiel` | `Un remboursement partiel de {amt:.2f} € a été initié.` |

Test bit-pour-bit, y compris ponctuation finale (point pour full, point pour partial).

### T35-28 — `data` payload notif EXACT

```json
{
  "type": "payment_refunded",
  "payment_id": "pay_001",
  "refund_amount": 51.75,
  "fully_refunded": true
}
```

**Pas** de `booking_id` ni autre champ.

### T35-29 — Logs format `|` séparateur exact

```
INFO Remboursement : payment=pay_001 | amount=51.75€ | full=True → status=refunded
INFO refund.updated → remboursement complet confirmé : refund=re_xxx | payment=pay_001
INFO refund.updated : refund=re_xxx | status=succeeded | payment=pay_001
DEBUG charge.refunded : payment_id introuvable (charge=ch_xxx)
DEBUG refund.updated : payment introuvable (refund=re_xxx charge=ch_xxx)
```

> ⚠️ `True`/`False` Python (capitalisé). Java SLF4J `Boolean.toString()` produit `true`/`false` (minuscule). **Forcer la capitalisation** ou accepter cette divergence mineure.

### T35-30 — Pas d'UPDATE bookings

**Setup** : `pay_001` lié à `bkg_001` (status=`confirmed`).

**Action** : `charge.refunded` full.

**Résultat** :
- `payments.pay_001.status='refunded'`
- `bookings.bkg_001.status='confirmed'` ← **INCHANGÉ** (asymétrie volontaire BR-35.12)

---

## Matrice de couverture

| Axe | Cas |
|---|---|
| Nominal `charge.refunded` | T35-01 à T35-08 |
| Nominal `refund.updated` Phase 2 | T35-09 à T35-12 |
| `refund.updated` Phase 1 edge | T35-13 à T35-19 |
| Idempotence | T35-20, T35-21 |
| Concurrence inter-events | T35-22, T35-23 |
| Cas erreur | T35-24, T35-25 |
| Compat stricte | T35-26 à T35-30 |

**Total : 30 cas.**

---

## Régressions cross-slices

### T35-R1 — Régression S33 : `payment_intent.succeeded` puis `charge.refunded`

**Setup** :
1. S33 webhook PI succeeded → status=`captured`, stripe_charge_id=`ch_007`
2. S35 webhook `charge.refunded` (full) → status=`refunded`, stripe_charge_id=`ch_007` (préservé via COALESCE)

**Assertion** : stripe_charge_id n'a PAS été écrasé.

### T35-R2 — Régression S34 : `/payments/{id}` montre `refund_amount`

**Setup** : T35-01 done. GET `/payments/pay_001`.

**Assertion** : la réponse contient `"status": "refunded"`, `"refund_amount": 51.75`, `"refund_status": "succeeded"`.

### T35-R3 — Régression S32 : signature invalide bloque

**Action** : POST `charge.refunded` avec signature tampered.

**Résultat** : 400 (S32 reject). Aucun effet S35.

---

## Notes runner Java

- **Testcontainers PostgreSQL** + migration créant `payments` avec colonnes `refund_amount`, `refund_status`.
- **Stripe Webhook Signature Test Helper** (S32) pour générer des events signés.
- **Vérifier les logs format** :
  ```java
  // MemoryAppender Logback
  assertThat(appender.list).extracting(ILoggingEvent::getFormattedMessage)
      .contains("Remboursement : payment=pay_001 | amount=51.75€ | full=True → status=refunded");
  ```
- **Test Locale-independence** :
  ```java
  Locale.setDefault(Locale.FRANCE);  // forcer FR
  // exécuter le handler
  // asserter body contient "51.75 €" (point, pas virgule)
  ```
- **JSONAssert STRICT** sur les `data` de notifs.
- **Test concurrence** : `CompletableFuture.allOf` pour envoyer `charge.refunded` et `refund.updated` quasi-simultanés et vérifier état final.
- **Testcontainers + EXPLAIN ANALYZE** sur la query `SELECT ... WHERE stripe_charge_id=...` pour valider que l'index est bien utilisé.
