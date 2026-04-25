# SLICE_32_API_CONTRACTS.md — Contrats API Webhook Infrastructure
> Basé sur `payment_routes.py:356–405`, `webhook_handlers.py:979–1071`.
> Généré le 2026-04-20.

---

## Endpoint — `POST /api/webhook/stripe`

### Auth : **PAS d'auth utilisateur**
La sécurité repose **exclusivement** sur la **signature HMAC Stripe**, pas sur un JWT.

### Headers requis

| Header | Valeur | Obligatoire | Notes |
|---|---|---|---|
| `Stripe-Signature` | `t=<timestamp>,v1=<hex_hmac>` | **OUI en prod** | Lu via `request.headers.get("Stripe-Signature", "")`. Vide → si secret configuré → 400 "Signature invalide" |
| `Content-Type` | `application/json` | recommandé | Stripe envoie toujours JSON |

### Body : **JSON brut Stripe**
**Doit être lu en BYTES** (pas Jackson désérialisé) pour préserver l'intégrité HMAC.

```json
{
  "id": "evt_1NXXX",
  "object": "event",
  "type": "payment_intent.succeeded",
  "data": {
    "object": {
      "id": "pi_3NXXX",
      "metadata": { "payment_id": "pay_abc", "booking_id": "bkg_xyz" },
      "amount": 5175,
      "...": "..."
    }
  }
}
```

### Pipeline backend exact

```
1. body_bytes = await request.body()              ← raw bytes (CRITIQUE)
2. sig         = request.headers.get("Stripe-Signature", "")

3. SI STRIPE_WEBHOOK_SECRET (env) :
     try : event = stripe.Webhook.construct_event(body_bytes, sig, secret)
     except stripe.error.SignatureVerificationError as exc :
         log.warning("Signature webhook invalide : %s", exc)
         raise HTTPException(400, f"Signature invalide : {exc}")
   SINON (mode dev) :
     try : event = json.loads(body_bytes)
     except : raise HTTPException(400, "Body JSON invalide")

4. Extraction (compat dict OU stripe.Event objet) :
   if isinstance(event, dict):
     event_id   = event.get("id", "")
     event_type = event.get("type", "")
     obj        = event.get("data", {}).get("object", {})
   else:
     event_id   = event.id
     event_type = event.type
     obj        = event.data.object

5. Si NOT event_id OR NOT event_type :
     raise HTTPException(400, "event id/type manquant")

6. log.info("Webhook reçu : type=%s | id=%s", event_type, event_id)

7. result = await webhook_handlers.dispatch(pool, event_id, event_type, obj)
8. return result   ← {"received": True} OR {"received": True, "idempotent_skip": True}
```

### Pipeline `dispatch()` (Slice 32 squelette)

```
dispatch(pool, event_id, event_type, obj):
  related_id = None
  pending_notifs = []   # Toujours vide en S32 (handlers stub)

  async with pool.acquire() as conn:
    # ── Idempotence
    is_new = await _claim_event(conn, event_id, event_type)
    if not is_new:
        return {"received": True, "idempotent_skip": True}

    # ── Résolution payment_id (STUB en S32 — peut être appelé mais pas critique)
    payment_id, booking_id = (None, None)   # ← stub return

    # ── Dispatch (handlers stub → no-op)
    try:
        if event_type in _CHARGE_EVENTS:        # set() vide en S32
            pass
        if event_type in _PAYMENT_EVENTS:        # set() vide
            pass
        if event_type in _SUBSCRIPTION_EVENTS:   # set() vide
            pass
        await _mark_done(conn, event_id, "success", related_id=None)
    except Exception as exc:
        log.exception("Erreur handler webhook event=%s id=%s : %s", ...)
        await _mark_done(conn, event_id, "error", related_id=None,
                         error_message=str(exc)[:500])

  # ── Post-pool-release : envoi notifications
  if pending_notifs:    # toujours False en S32
      ...

  return {"received": True}
```

### Réponses

| Cas | HTTP | Body |
|---|---|---|
| Event nouveau (claim OK, handlers stub success) | 200 | `{"received": true}` |
| Event doublon (idempotent_skip) | 200 | `{"received": true, "idempotent_skip": true}` |
| Signature invalide (secret configuré) | **400** | `{"detail": "Signature invalide : <exception message>"}` |
| Body JSON invalide (mode dev sans secret) | 400 | `{"detail": "Body JSON invalide"}` |
| `event_id` ou `event_type` manquant | 400 | `{"detail": "event id/type manquant"}` |
| Exception handler (DB down, etc.) | **200** | `{"received": true}` (handler stub mais l'exception serait catchée) — `stripe_webhook_events.status='error'` en DB |
| Pool acquire crash (avant claim) | 500 | `{"detail": "<message>"}` (compat Python — le `async with` peut throw) |

### Effets de bord

| Effet | Conditions | Notes |
|---|---|---|
| INSERT `stripe_webhook_events` (event_id, event_type, status='processing', ...) | Toujours sauf 400 (signature/body invalide) | ON CONFLICT DO NOTHING |
| UPDATE `stripe_webhook_events` (status, related_id, error_message, updated_at) | Après claim réussi | `'success'` ou `'error'` selon try/except |
| Log `Webhook reçu : type=... | id=...` | Toujours après extraction OK | INFO |
| Log `Signature webhook invalide` | Si signature fail | WARNING |
| Log `Webhook doublon ignoré` | Si event_id déjà connu | DEBUG |
| Log `Erreur handler webhook` | Si handler throw (rare en S32) | EXCEPTION |
| Pas de transition `payments` / `bookings` | — | **Slice 32 = aucune écriture métier**. Domaine 100% sur `stripe_webhook_events` |

### Idempotence

- **Garantie par PRIMARY KEY** sur `stripe_webhook_events.event_id`.
- Re-livraison Stripe d'un même `event_id` → ON CONFLICT → claim renvoie `False` → réponse `{"received": true, "idempotent_skip": true}`.
- Pas de re-traitement, pas de double-INSERT.

---

## Format `Stripe-Signature` (référence)

```
t=1492774577,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd,v0=...
```

- `t=` timestamp Unix epoch
- `v1=` HMAC-SHA256 signature (hex)
- `v0=` legacy (peut être ignoré)

`stripe.Webhook.construct_event` parse le header, vérifie le HMAC sur `t.body`, et lève `SignatureVerificationError` si invalide ou si `t` est trop vieux (default tolerance: 5 min).

---

## Codes statut résumé

| Code | Cas |
|---|---|
| 200 | Tout succès, y compris `idempotent_skip` ET handler error catché |
| 400 | Signature invalide / body JSON invalide / event_id ou event_type manquant |
| 500 | Très rare (pool acquire crash hors try/except — exception non gérée du dispatcher AVANT le `async with`) |

---

## Hors périmètre Slice 32

| Hors scope | Slice future |
|---|---|
| `_PAYMENT_EVENTS` set populé + handler `_handle_payment_event` | Slice 33 |
| `_CHARGE_EVENTS` set populé + handler `_handle_charge_event` (refunds) | Slice 34 |
| `_SUBSCRIPTION_EVENTS` set populé + handlers `_handle_subscription_event`, `_dispatch_subscription` | Slice 35 |
| `_resolve_payment_id` complet (stub en S32) | Slice 33 |
| `pending_notifs` envoi `store_notification` | Slice 33 (premier handler qui populate) |

---

## ⚠️ Note critique sur `pending_notifs`

Le code Python implémente déjà la boucle d'envoi post-pool-release (`webhook_handlers.py:1049–1069`) **MÊME** quand handlers sont stub. Java doit reproduire la **structure** complète, mais avec `pending_notifs` toujours vide en S32 — la boucle ne sera jamais exécutée. **Garder le code de boucle** pour éviter une dette de migration en S33.
