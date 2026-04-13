# SLICE_16_BUSINESS_RULES.md — Règles métier de la Slice 16
> Sources : `payment_routes.py:354–405`, `webhook_handlers.py:1–583`.
> Généré le 2026-02-XX.

---

## BR-01 — Vérification de signature Stripe (prod uniquement)

```python
# payment_routes.py:376–387
if STRIPE_WEBHOOK_SECRET:
    try:
        event = stripe_service.parse_webhook_event(body_bytes, sig)
    except stripe.error.SignatureVerificationError as exc:
        raise HTTPException(status_code=400, detail=f"Signature invalide : {exc}")
else:
    event = json.loads(body_bytes)
```

- En production : **STRIPE_WEBHOOK_SECRET obligatoire** → `stripe.Webhook.construct_event(body_bytes, sig, secret)`
- En dev/test : si `STRIPE_WEBHOOK_SECRET` est vide → parse JSON brut (pas de vérification)
- Le secret est disponible dans le Dashboard Stripe sous "Webhooks → Endpoint → Signing secret"

> ⚠️ Java DOIT appliquer la même logique : signature requise si `STRIPE_WEBHOOK_SECRET` présent.

---

## BR-02 — Réponse 200 inconditionnelle (CRITIQUE)

```python
# webhook_handlers.py:1035–1044
except Exception as exc:
    log.exception(...)
    await _mark_done(conn, event_id, "error", ...)
    # On ne relève PAS l'exception : Stripe doit recevoir 200
```

**Stripe réessaie les webhooks non-200 pendant 72h avec backoff exponentiel.**
Java ne doit **JAMAIS** retourner 500 sur ce endpoint. Toute exception interne est :
1. Loggée
2. Enregistrée dans `stripe_webhook_events.status = 'error'`
3. Résultat de `{"received": true}` retourné

---

## BR-03 — Idempotence via `stripe_webhook_events`

```python
# webhook_handlers.py:90–101
result = await conn.execute(
    "INSERT INTO stripe_webhook_events ... ON CONFLICT (event_id) DO NOTHING",
    event_id, event_type,
)
inserted = result.split()[-1] == "1"
if not inserted:
    return {"received": True, "idempotent_skip": True}
```

**Mécanisme :**
1. Chaque `event_id` Stripe est inséré avec statut `'processing'`
2. Si conflit → doublon → return 200 immédiatement sans retraitement
3. À la fin du traitement → UPDATE → `'success'` ou `'error'`
4. Si le process crash ENTRE l'INSERT et l'UPDATE → event reste en `'processing'` (peut être retraité manuellement)

> ⚠️ Java : utiliser `INSERT ... ON CONFLICT (event_id) DO NOTHING` natif PostgreSQL (pas un UPSERT, pas un SELECT avant INSERT).

---

## BR-04 — Routing par event_type (`checkout.session.completed`)

`checkout.session.completed` est le seul event partagé entre paiements et abonnements.
Le routage se fait sur le champ `obj.mode` :

```python
# webhook_handlers.py:205–208
if event_type == "checkout.session.completed":
    mode = _get(obj, "mode", "")
    if mode == "subscription":
        return  # → _handle_subscription_event (Slice 18)
```

**Règle :** Si `mode = "subscription"` → sortir immédiatement de `_handle_payment_event`.
En Java, le dispatcher doit tester `mode` AVANT d'appeler le handler paiement.

---

## BR-05 — Sous-règle de `checkout.session.completed` (mode=payment)

Deux branches selon `payment_status` :
- `ps = "unpaid"` (capture_method=manual → requires_capture) → sous-règle sur `booking.status`
- `ps = "paid"` (capture immédiate) → directement `captured`

### Sous-branche `ps="unpaid"` :

```python
# webhook_handlers.py:213–287
if bk_row and bk_row["status"] == "awaiting_payment":
    # instant_booking + pay_now : auto-confirmer (capture virtuelle)
    → payments.status = 'captured'
    → bookings.status = 'confirmed', payment_status = 'paid'
    → Notifications payer + receiver
else:
    # manual_approval + pay_now (booking.status = 'requested')
    → payments.status = 'authorized'
    → Notification receiver seulement
```

> ⚠️ La distinction `awaiting_payment` vs `requested` dans `bookings` est la clé du routing.
> Java doit faire un SELECT sur `bookings.status` AVANT de décider de la transition payment.

---

## BR-06 — Guards anti-régression sur les UPDATEs

Tous les UPDATEs `payments.status` incluent une clause `WHERE status NOT IN (...)` :

| Update cible | Guard |
|---|---|
| `→ authorized` | `NOT IN ('authorized','captured','refunded','cancelled')` |
| `→ captured` | `NOT IN ('captured','refunded')` |
| `→ failed` | `NOT IN ('captured','refunded','failed')` |
| `→ cancelled` | `NOT IN ('captured','refunded','cancelled')` |
| `→ refunded` | `NOT IN ('refunded')` |

**Objectif :** Empêcher toute régression d'état (ex: un `payment_intent.canceled` ne doit pas passer un paiement `captured` en `cancelled`).

---

## BR-07 — `stripe_charge_id` stocké dans `payment_intent.succeeded`

```python
# webhook_handlers.py:357–359
charge_id = _get(obj, "latest_charge")
if isinstance(charge_id, str) and charge_id.startswith("ch_"):
    # UPDATE payments SET stripe_charge_id=$1 ...
```

- `latest_charge` est le champ de l'objet PaymentIntent qui contient l'ID de la charge (`ch_...`).
- Ce `stripe_charge_id` est **requis pour les remboursements** (Slice 15 : `create_refund(charge_id=...)`).
- Si `latest_charge` est absent ou ne commence pas par `"ch_"` → UPDATE sans `stripe_charge_id`.

---

## BR-08 — `charge.refunded` — Lookup par charge_id si metadata vide

```python
# webhook_handlers.py:476–488
if not payment_id:
    charge_id = _get(obj, "id")
    if charge_id:
        row = await conn.fetchrow(
            "SELECT payment_id FROM payments WHERE stripe_charge_id=$1 LIMIT 1",
            charge_id,
        )
```

Les events `charge.refunded` n'ont souvent pas de `metadata.payment_id` si le remboursement est déclenché depuis le Dashboard Stripe. Le fallback par `stripe_charge_id` est obligatoire.

---

## BR-09 — `refund.updated` — Détection remboursement complet via amount

```python
# webhook_handlers.py:552–560
total = float(row["payer_total_amount"] or 0)
if refund_status == "succeeded" and abs(amount - total) < 0.02:
    # → status = 'refunded' (remboursement complet confirmé)
```

**Tolérance 0.02€** pour les arrondis de conversion centimes→euros. Reproduire exactement.

---

## BR-10 — Notifications envoyées HORS transaction

```python
# webhook_handlers.py:1047–1069
# (APRÈS le bloc async with pool.acquire())
for notif in pending_notifs:
    await store_notification(pool, ...)
```

**Règle :** Les notifications ne sont pas dans la transaction DB. Elles sont envoyées :
1. APRÈS la fermeture de la connexion DB
2. Uniquement si `rows_updated > 0` (vraie transition)
3. Via `store_notification()` (table DB + WebSocket — hors scope Slice 16)

En Java : utiliser `@Async` ou un thread séparé pour les notifications, séparé du `@Transactional`.

---

## BR-11 — Mode dev sans secret

```python
# payment_routes.py:383–387
else:
    try:
        event = json.loads(body_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail="Body JSON invalide")
```

Si `STRIPE_WEBHOOK_SECRET` est absent (env vide) → parse JSON directement sans signature.
**Ne jamais utiliser en production.** Java doit reproduire exactement ce comportement pour faciliter les tests locaux.

---

## Résumé des règles

| # | Règle | Criticité |
|---|---|---|
| BR-01 | Signature HMAC obligatoire en prod | CRITIQUE |
| BR-02 | Toujours retourner 200 | CRITIQUE |
| BR-03 | Idempotence INSERT ON CONFLICT | CRITIQUE |
| BR-04 | `checkout.session.completed` dual routing sur `mode` | CRITIQUE |
| BR-05 | `checkout.session` : 3 branches (awaiting/requested/paid) | CRITIQUE |
| BR-06 | Guards anti-régression sur tous les UPDATEs | OBLIGATOIRE |
| BR-07 | `stripe_charge_id` depuis `latest_charge` (payment_intent.succeeded) | OBLIGATOIRE |
| BR-08 | `charge.refunded` fallback par charge_id | OBLIGATOIRE |
| BR-09 | `refund.updated` tolérance 0.02€ | OBLIGATOIRE |
| BR-10 | Notifications hors transaction DB | OBLIGATOIRE |
| BR-11 | Mode dev sans secret | DÉVELOPPEMENT |

---

## Hors scope Slice 16

| Élément | Slice |
|---|---|
| `_handle_subscription_event` | 18 |
| `_dispatch_subscription` | 18 |
| `checkout.session.completed` mode=subscription | 18 |
| `customer.subscription.*` | 18 |
| `invoice.paid / invoice.payment_failed` | 18 |
| `GET /payments/checkout/status/{id}` | 17 |
| `POST /payments/checkout/session` | 17 |
| `GET /payments/me`, `GET /payments/{id}` | (read — déjà couvert ou faible priorité) |
| `PATCH /payments/{id}/stripe` | 17 |
