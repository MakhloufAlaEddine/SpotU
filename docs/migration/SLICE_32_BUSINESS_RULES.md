# SLICE_32_BUSINESS_RULES.md — Règles métier Webhook Infrastructure
> Basé sur `payment_routes.py:356–405`, `webhook_handlers.py:80–117, 979–1071`.
> Généré le 2026-04-20.

---

## BR-32.01 — Pas d'auth utilisateur, sécurité par signature HMAC

### Règle
Aucun `require_auth`. Aucune vérification JWT. La sécurité repose **exclusivement** sur :
1. La signature HMAC-SHA256 fournie dans le header `Stripe-Signature`
2. La connaissance partagée du secret `STRIPE_WEBHOOK_SECRET` (env)

### Java
- `SecurityConfig` : `permitAll()` sur `POST /api/webhook/stripe`
- Aucun `@PreAuthorize`
- Pas de filtre JWT ne doit s'appliquer

---

## BR-32.02 — Raw body OBLIGATOIRE

### Règle
```python
body_bytes = await request.body()
```
Le body **doit être lu en bytes bruts** avant toute désérialisation JSON. Stripe calcule le HMAC sur les bytes EXACTS envoyés.

### ⚠️ Piège Java/Spring
Spring Boot par défaut désérialise le body via Jackson (avec `@RequestBody Map`, etc.). Cela **consomme le stream** → la signature ne peut plus être vérifiée car les bytes ont été consommés et la re-sérialisation Jackson peut différer (espaces, ordre clés JSON).

### Solution Java
Utiliser `@RequestBody byte[] bodyBytes` :
```java
@PostMapping(value = "/webhook/stripe", consumes = MediaType.ALL_VALUE)
public Map<String,Object> webhook(
    @RequestBody byte[] bodyBytes,
    @RequestHeader(value = "Stripe-Signature", required = false) String signature
) { ... }
```

OU `HttpServletRequest.getInputStream()` + `IOUtils.toByteArray(...)`.

### Test critique
Re-sérialiser un objet JSON et calculer le HMAC : si la sérialisation diffère de Stripe (ex: trailing newline, ordre clés), la signature **ne match pas**. **Toujours** tester avec un payload Stripe réel.

---

## BR-32.03 — Vérification signature avec fallback dev

### Règle
```python
if STRIPE_WEBHOOK_SECRET:
    try : event = stripe.Webhook.construct_event(body_bytes, sig, secret)
    except SignatureVerificationError as exc :
        raise HTTPException(400, f"Signature invalide : {exc}")
else:
    try : event = json.loads(body_bytes)
    except : raise HTTPException(400, "Body JSON invalide")
```

### Mode prod (secret configuré)
- Signature stricte via `stripe.Webhook.construct_event(body, sig, secret)`
- Si HMAC invalide OU timestamp trop vieux (>5 min) → `SignatureVerificationError` → **400**
- Le message inclut le détail de l'exception : `f"Signature invalide : {exc}"`

### Mode dev (secret absent)
- Parse JSON brut sans vérification
- Si JSON invalide → 400 `"Body JSON invalide"`
- **Permet le dev sans Stripe CLI** (ex: postman direct)

### Java
```java
@Value("${stripe.webhook.secret:}")
private String webhookSecret;

if (webhookSecret != null && !webhookSecret.isEmpty()) {
    try {
        event = Webhook.constructEvent(new String(body, UTF_8), signature, webhookSecret);
    } catch (SignatureVerificationException e) {
        throw new BadRequestException("Signature invalide : " + e.getMessage());
    }
} else {
    try {
        event = objectMapper.readValue(body, Map.class);
    } catch (IOException e) {
        throw new BadRequestException("Body JSON invalide");
    }
}
```

> ⚠️ Note : `Webhook.constructEvent` (Stripe Java) prend une **String**, pas bytes. Convertir avec UTF-8 explicit.

---

## BR-32.04 — Extraction event_id/event_type/obj (compat dict OR Event)

### Règle
```python
if isinstance(event, dict):
    event_id   = event.get("id", "")
    event_type = event.get("type", "")
    obj        = event.get("data", {}).get("object", {})
else:
    event_id   = event.id
    event_type = event.type
    obj        = event.data.object
```

### Motivation
- Mode prod (signature OK) → `event` est un objet `stripe.Event` (attribute access)
- Mode dev (parse JSON brut) → `event` est un `dict`

### Java
Stripe Java `Webhook.constructEvent` retourne **toujours** un `com.stripe.model.Event` typé. **Pas de mode dict côté Java**. Sauf en mode dev : Java parse en `Map<String,Object>` → branchement instanceof.

```java
String eventId, eventType;
Object obj;
if (event instanceof com.stripe.model.Event stripeEvent) {
    eventId   = stripeEvent.getId();
    eventType = stripeEvent.getType();
    obj       = stripeEvent.getData().getObject();
} else if (event instanceof Map<?,?> map) {
    eventId   = (String) map.getOrDefault("id", "");
    eventType = (String) map.getOrDefault("type", "");
    Map<String,Object> data = (Map<String,Object>) map.getOrDefault("data", Map.of());
    obj       = data.getOrDefault("object", Map.of());
}
```

---

## BR-32.05 — event_id/event_type obligatoires

### Règle
```python
if not event_id or not event_type:
    raise HTTPException(400, "event id/type manquant")
```

### Java
Vérifier `eventId == null || eventId.isEmpty() || eventType == null || eventType.isEmpty()` → 400 avec message exact.

---

## BR-32.06 — Idempotence atomique via PRIMARY KEY

### Règle
```sql
INSERT INTO stripe_webhook_events (event_id, event_type, status, processed_at, updated_at)
VALUES ($1, $2, 'processing', NOW(), NOW())
ON CONFLICT (event_id) DO NOTHING
```

### Atomicité
La PRIMARY KEY sur `event_id` garantit qu'**un seul** INSERT réussit même en concurrence. Le second voit `ON CONFLICT DO NOTHING`.

### Détection insertion
```python
inserted = result.split()[-1] == "1"
```
- `"INSERT 0 1"` → inséré = True
- `"INSERT 0 0"` → inséré = False (conflict)

### Java
```java
@Modifying @Query(value = "...", nativeQuery = true)
int claimEvent(...);

boolean isNew = (repo.claimEvent(eventId, eventType) == 1);
```

### Si doublon
Return immédiat `{"received": true, "idempotent_skip": true}` — **pas de re-traitement**, **pas de notification**.

> ⚠️ Java : utiliser `@Transactional(propagation = REQUIRES_NEW)` sur `claimEvent` pour garantir la commit immédiate. Sinon en cas de retry quasi-simultané, les 2 transactions peuvent voir l'INSERT de l'autre comme non-commité.

---

## BR-32.07 — Always-200 sauf 400 signature/body

### Règle
| Cas | HTTP |
|---|---|
| Signature invalide | **400** |
| Body JSON invalide (mode dev) | **400** |
| event_id ou event_type manquant | **400** |
| Tout le reste (incl. handler exception, DB issue post-claim, etc.) | **200** |

### Motivation Stripe
Stripe retry les webhooks en cas de réponse non-2xx avec un backoff exponentiel sur **3 jours**. Un 5xx fait spammer Stripe → spam DB + alertes inutiles.

### Implémentation
```python
try:
    handlers...
    await _mark_done(success)
except Exception as exc:
    log.exception(...)
    await _mark_done(error)
    # Pas de re-raise
return {"received": True}
```

### Java
```java
try {
    // dispatch handlers
    repo.markDone(eventId, "success", relatedId, null);
} catch (Exception e) {
    log.error("Erreur handler webhook event={} id={}", eventType, eventId, e);
    repo.markDone(eventId, "error", relatedId, truncate(e.getMessage(), 500));
    // PAS de throw
}
return Map.of("received", true);
```

> ⚠️ Le `@RestControllerAdvice` global ne doit **PAS** intercepter les exceptions du handler webhook (pour ne pas convertir en 500). Soit le `@ControllerAdvice` exclut ce path, soit la méthode catch tout en interne.

---

## BR-32.08 — `_mark_done` UPDATE statut final

### Règle
```python
async def _mark_done(conn, event_id, status, related_id=None, error_message=None):
    await conn.execute("""
        UPDATE stripe_webhook_events
        SET status=$1, related_id=$2, error_message=$3, updated_at=NOW()
        WHERE event_id=$4
    """, status, related_id, error_message, event_id)
```

### Notes
- `error_message` tronqué : `str(exc)[:500]`
- `processed_at` **PAS** modifié (reste celui de l'INSERT initial)
- En Slice 32 : `status='success'` toujours (handlers stub)

---

## BR-32.09 — `pending_notifs` post-pool-release (structure à reproduire)

### Règle
```python
async with pool.acquire() as conn:
    ... (handlers populent pending_notifs en S33+) ...

# HORS du pool :
if pending_notifs:
    from push_service import store_notification
    for notif in pending_notifs:
        try:
            await store_notification(...)
        except Exception as exc:
            log.warning(...)
```

### Slice 32
`pending_notifs` toujours vide (handlers stub). La boucle ne s'exécute **jamais**, mais **garder la structure** pour S33.

### Java
```java
// hors @Transactional
for (PendingNotif notif : pendingNotifs) {  // toujours empty en S32
    try {
        pushService.storeNotification(...);
        log.info("Notification envoyée : type={} | user={}", notif.type(), notif.userId());
    } catch (Exception e) {
        log.warn("Erreur envoi notification type={} user={} : {}", notif.type(), notif.userId(), e.getMessage());
    }
}
```

---

## BR-32.10 — Logs requis (compat stricte)

| Niveau | Message exact |
|---|---|
| WARNING | `"Signature webhook invalide : %s"` (sig fail) |
| INFO | `"Webhook reçu : type=%s | id=%s"` (après extraction OK) |
| DEBUG | `"Webhook doublon ignoré : event_id=%s type=%s"` (idempotent_skip) |
| EXCEPTION | `"Erreur handler webhook event=%s id=%s : %s"` (catch-all) |

Java : SLF4J avec ces messages exacts (clé pour observabilité).

---

## BR-32.11 — Configuration env

| Variable | Usage | Défaut Python |
|---|---|---|
| `STRIPE_API_KEY` | Constructor `stripe.apiKey = ...` | `""` (vide → mode test) |
| `STRIPE_WEBHOOK_SECRET` | Vérification signature | `""` (vide → mode dev fallback JSON brut) |

Java :
```yaml
stripe:
  api:
    key: ${STRIPE_API_KEY:}
  webhook:
    secret: ${STRIPE_WEBHOOK_SECRET:}
```

---

## BR-32.12 — Interactions avec slices déjà migrées

| Slice | Dépendance | Risque régression |
|---|---|---|
| **S30 Booking pay** | Crée `payments` avec `stripe_checkout_session_id` + `metadata.payment_id`. Webhook réceptionne `checkout.session.completed` lié. | En S32 : pas d'impact (handler stub). En S33 : critique |
| **S31 Checkout status** | Fait des UPDATE concurrents sur `payments` | En S32 : pas d'impact (pas d'UPDATE payments). Concurrence gérée par S33. |

> Slice 32 est **complètement indépendante** des slices applicatives migrées — elle ne touche que `stripe_webhook_events`.

---

## BR-32.13 — Asymétries à préserver

| Aspect | Comportement Python | Java doit reproduire |
|---|---|---|
| Mode dev sans secret → JSON brut accepté | Oui | ✅ |
| `processed_at` set à INSERT, pas UPDATE | Oui | ✅ ne pas updater à mark_done |
| `error_message` tronqué à 500 chars | Oui | ✅ `Math.min(msg.length(), 500)` |
| `idempotent_skip: true` uniquement en doublon | Absent en flow normal | ✅ |
| Logs avec `|` séparateur exact | Oui | ✅ format SLF4J `{} | {}` |

---

## BR-32.14 — Limitations connues (à ne PAS corriger)

| Limitation | Reproduire |
|---|---|
| Pas de SELECT FOR UPDATE sur `stripe_webhook_events` | OUI — la PK suffit |
| Pas de retry handler local (Stripe gère) | OUI |
| Pas de dead-letter queue | OUI |
| `error_message` tronqué silencieusement | OUI |
| Mode dev sans secret = signature trustée | OUI (config-controlled) |

---

## BR-32.15 — Pas de validation event_type whitelist

### Slice 32
**Aucune** validation que `event_type` soit dans une whitelist. N'importe quel string passe (incluant des events que Stripe n'enverra jamais).

### Slice 33+
Le filtrage se fait via les sets `_PAYMENT_EVENTS`, `_CHARGE_EVENTS`, `_SUBSCRIPTION_EVENTS`. Un event hors whitelist tombe dans `else` du dispatch et est marqué `success` sans transition.

### Java S32
Ne pas ajouter de validation `event_type ∈ {...}`. Compat stricte.
