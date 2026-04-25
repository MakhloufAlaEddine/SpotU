# SLICE_32_TEST_CASES.md — Cas de test Webhook Infrastructure
> Basé sur `payment_routes.py:356–405`, `webhook_handlers.py:80–117, 979–1071`, BR-32.01 à BR-32.15.
> Généré le 2026-04-20.

---

## Convention : `T32-<CASE>`

---

## 🟢 Nominal

### T32-01 — Event valide signé, premier reçu

**Pré-conditions** : `STRIPE_WEBHOOK_SECRET=whsec_test_xxx` configuré.

**Action** :
```http
POST /api/webhook/stripe
Stripe-Signature: t=<timestamp>,v1=<valid_hmac>
Content-Type: application/json

{
  "id": "evt_001",
  "type": "payment_intent.succeeded",
  "data": { "object": { "id": "pi_xxx", "metadata": {"payment_id": "pay_abc"} } }
}
```

**Résultat HTTP 200** : `{"received": true}`.

**Assertions DB**
- 1 row inséré dans `stripe_webhook_events` :
  - `event_id='evt_001'`
  - `event_type='payment_intent.succeeded'`
  - `status='processing'` puis flippé à `'success'`
  - `processed_at` ≈ NOW()
  - `updated_at` ≈ NOW()
  - `related_id=NULL` (handlers stub Slice 32)
  - `error_message=NULL`

**Assertions logs**
- INFO : `"Webhook reçu : type=payment_intent.succeeded | id=evt_001"`

### T32-02 — Mode dev sans secret, JSON brut accepté

**Pré-conditions** : `STRIPE_WEBHOOK_SECRET=""` (vide).

**Action** : POST sans header Stripe-Signature, body JSON brut valide.

**Résultat** : 200, comportement identique à T32-01.

---

## 🔵 Idempotence

### T32-03 — Doublon event_id → idempotent_skip

**Pré-conditions** : event `evt_001` déjà inséré (status='success' ou autre).

**Action** : POST identique avec même `id=evt_001`, signature valide.

**Résultat HTTP 200** : `{"received": true, "idempotent_skip": true}`.

**Assertions**
- **Aucun** UPDATE sur la row existante (pas même `updated_at`)
- **Aucun** doublon inséré (count `stripe_webhook_events WHERE event_id='evt_001'` = 1)
- DEBUG log : `"Webhook doublon ignoré : event_id=evt_001 type=..."`

### T32-04 — Concurrence : 2 livraisons quasi-simultanées

**Setup** : 2 POST identiques en parallèle.

**Résultat**
- Les 2 retournent 200
- 1 a `{"received": true}` (premier inséré)
- L'autre `{"received": true, "idempotent_skip": true}`
- Exactement 1 row en DB

---

## 🔴 Signature & body invalides

### T32-05 — Signature invalide (HMAC ne match pas)

**Pré-conditions** : secret configuré, header `Stripe-Signature` présent mais HMAC tampered.

**Action** : POST avec signature volontairement modifiée.

**Résultat HTTP 400** : `{"detail": "Signature invalide : <SignatureVerificationError msg>"}`.

**Assertions**
- **Aucun** INSERT dans `stripe_webhook_events`
- WARNING log : `"Signature webhook invalide : <exc>"`

### T32-06 — Header Stripe-Signature absent (mode prod)

**Pré-conditions** : secret configuré, pas de header.

**Action** : POST sans header.

**Résultat** : 400 (signature attendue mais absente).

### T32-07 — Timestamp Stripe trop vieux (>5 min)

**Pré-conditions** : signature avec `t=<timestamp -10min>`.

**Résultat** : 400 (Stripe rejette le timestamp).

### T32-08 — Body JSON invalide (mode dev sans secret)

**Pré-conditions** : `STRIPE_WEBHOOK_SECRET=""`.

**Action** : POST avec body `not-a-json{`.

**Résultat HTTP 400** : `{"detail": "Body JSON invalide"}`.

### T32-09 — event_id manquant

**Action** : POST avec body valide mais `{"type": "...", ...}` (pas de `id`).

**Résultat HTTP 400** : `{"detail": "event id/type manquant"}`.

### T32-10 — event_type manquant

**Action** : POST avec body `{"id": "evt_002", ...}` (pas de `type`).

**Résultat HTTP 400** : idem T32-09.

---

## 🟡 Event types divers (handlers stub Slice 32)

### T32-11 — Event payment_intent.succeeded

**Action** : T32-01 avec `type=payment_intent.succeeded`.

**Résultat** : 200, `status='success'` (handler stub no-op), pas d'UPDATE payments/bookings.

### T32-12 — Event checkout.session.completed (mode payment)

**Action** : POST avec `type=checkout.session.completed`, `obj.mode='payment'`.

**Résultat** : 200, status='success', pas de side-effects métier.

### T32-13 — Event checkout.session.completed (mode subscription)

**Action** : POST avec `type=checkout.session.completed`, `obj.mode='subscription'`.

**Résultat** : 200, status='success', pas de side-effects (sub handler hors S32).

### T32-14 — Event refund.updated

**Action** : POST avec `type=refund.updated`.

**Résultat** : 200, status='success'.

### T32-15 — Event customer.subscription.created

**Action** : POST avec `type=customer.subscription.created`.

**Résultat** : 200, status='success'.

### T32-16 — Event type inconnu (futur Stripe)

**Action** : POST avec `type=invoice.created` (pas dans aucun set en S32).

**Résultat** : 200, status='success' (tous events sont stub-success en S32).

---

## 🟠 Robustesse

### T32-17 — DB unavailable lors du claim

**Simulation** : mock `stripe_webhook_events` repo throw `SQLException("connection refused")` au moment de l'INSERT.

**Résultat possible** :
- Si l'exception remonte : HTTP 500 (compat Python — `pool.acquire()` peut throw)
- Pas de row insérée
- Stripe va retry → quand DB revient, traitement OK

> ⚠️ Java doit **laisser remonter** cette exception (= 500). Pas de catch global ici car l'event n'est pas claimé.

### T32-18 — Handler exception (simulé)

**Setup S32** : forcer un handler à throw (en S32 c'est artificiel — handlers stub). Test pour préparer S33.

**Résultat attendu** : 200, `stripe_webhook_events.status='error'`, `error_message=str(exc)[:500]`.

**Assertions**
- EXCEPTION log : `"Erreur handler webhook event=<type> id=<id> : <exc>"`
- **Pas de re-raise** vers le client → toujours 200

### T32-19 — error_message tronqué

**Setup** : forcer une exception avec message > 500 chars.

**Résultat** : `error_message` en DB = exactement les 500 premiers chars.

---

## 🟤 Compatibilité stricte Python

### T32-20 — Format réponse nominal

```json
{ "received": true }
```

Ordre clés (recommandé) : `received` seul. **Pas** de `success`, `status`, etc.

### T32-21 — Format réponse idempotent

```json
{ "received": true, "idempotent_skip": true }
```

### T32-22 — Messages d'erreur exacts

| Code | Message |
|---|---|
| 400 | `"Signature invalide : <stripe error msg>"` |
| 400 | `"Body JSON invalide"` |
| 400 | `"event id/type manquant"` |

Format Python : `{"detail": "..."}`.

### T32-23 — Logs format `|` séparateur

```
INFO Webhook reçu : type=payment_intent.succeeded | id=evt_001
```

Java SLF4J : `log.info("Webhook reçu : type={} | id={}", eventType, eventId);`

### T32-24 — `processed_at` non-modifié à mark_done

**Setup** : insérer event, attendre 1s, déclencher mark_done.

**Assertion** : `processed_at` (read avant et après mark_done) **identique**. Seul `updated_at` change.

### T32-25 — `related_id=NULL` en S32

Tous les events S32 → `related_id` reste NULL (handlers stub ne le populent pas).

---

## 🟣 Cas spécifiques Stripe

### T32-26 — body avec espaces / formatting variant

Stripe peut envoyer du JSON avec ou sans spaces, ordre clés variable. La signature couvre les bytes EXACTS.

**Test** : 2 bodies équivalents JSON mais bytes différents → si signature calculée sur l'un et envoyée avec l'autre → 400.

> Garantit que Java lit bien les bytes BRUTS sans re-sérialisation.

### T32-27 — Body très volumineux (1 MB)

**Setup** : event Stripe avec metadata énorme.

**Résultat** : doit fonctionner (limite FastAPI/Spring config).

### T32-28 — Charset UTF-8 dans event data

**Setup** : event avec champs contenant émojis/accents (`"name": "Café"`).

**Résultat** : signature OK (bytes UTF-8 préservés), event traité normalement.

---

## Matrice de couverture

| Axe | Cas |
|---|---|
| Nominal signed | T32-01 |
| Mode dev (no secret) | T32-02, T32-08 |
| Idempotence | T32-03, T32-04 |
| Signature invalide | T32-05, T32-06, T32-07 |
| Validation extraction | T32-09, T32-10 |
| Event types variés (tous stub) | T32-11 à T32-16 |
| Robustesse | T32-17, T32-18, T32-19 |
| Compat strict | T32-20 à T32-25 |
| Stripe-spécifique | T32-26 à T32-28 |

**Total : 28 cas de test minimum.**

---

## Notes runner Java

- **Testcontainers PostgreSQL** + migration créant `stripe_webhook_events`.
- **Stripe Webhook Signature Test Helper** : utiliser `Webhook.constructEvent` avec un secret de test connu pour générer des signatures valides en test.
- **Mock Stripe Java SDK** : pour tester signature invalide, utiliser un secret différent côté test que côté serveur.
- **Vérifier byte-for-byte** : générer le HMAC manuellement avec HMac SHA256 sur les bytes exacts du body et comparer.
- **Test concurrence** : `CompletableFuture.allOf(...)` avec 2 webhook calls strictement parallèles.
- **JSONAssert STRICT** pour comparer les réponses.
- **Tester avec un STRIPE_WEBHOOK_SECRET différent** entre prod-config et tests pour valider le mode dev.
