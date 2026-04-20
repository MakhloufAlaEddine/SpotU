# SLICE_31_BUSINESS_RULES.md — Règles métier Checkout Status
> Basé sur `payment_routes.py:195–351`.
> Généré le 2026-04-20.

---

## BR-31.01 — Auth OPTIONNELLE (pattern unique)

### Règle
```python
user = None
try:
    user = await require_auth(request, pool)
except Exception:
    pass
```

### Motivation
Après un paiement Stripe, l'utilisateur est redirigé vers `success_url` **depuis le domaine Stripe**. Sur mobile :
- Le token JWT peut avoir expiré pendant le temps passé sur Stripe Checkout
- Le user peut revenir depuis un autre device (ex: email de confirmation Stripe ouvert sur desktop alors qu'il a payé sur mobile)
- Le webview de l'app peut avoir perdu la session

Le `session_id` (format `cs_test_...` 56+ chars) sert de **secret d'accès suffisant** — non devinable, couplé à un paiement spécifique.

### Ce que Java doit faire
- Exposer l'endpoint avec `permitAll()` dans `SecurityConfig`
- Tenter de lire le JWT s'il est présent (pour logs/audit), mais ne **jamais** lever 401
- Ne pas attacher de `@PreAuthorize` sur la méthode

### Test de compat
`GET /api/payments/checkout/status/cs_xxx` **sans header Authorization** doit retourner 200 (ou 404 si session inconnue), **jamais 401**.

---

## BR-31.02 — Lookup `session_id` OR `payment_intent_id` (rétrocompat)

### Règle
```sql
SELECT * FROM payments
 WHERE stripe_checkout_session_id = $1
    OR stripe_payment_intent_id   = $1
 LIMIT 1
```

### Motivation
Certains flows anciens ne stockaient que le PaymentIntent (`pi_...`). Le param path `{session_id}` est dual-purpose.

### Conséquence
- Si le front passe un `pi_...`, Stripe retrieve échouera (throw) → fallback "unknown"
- Le `real_session_id` pour Stripe est `payment.stripe_checkout_session_id OR session_id` (fallback sur l'input)

### Ne PAS modifier en Java
- Ne pas tenter de deviner le type (`cs_` vs `pi_`)
- Laisser Stripe throw et tomber dans le fallback

---

## BR-31.03 — Matrice des transitions (ordre if/elif/elif strict)

### Variables d'état
- `s_status` = `session.status` Stripe ∈ `{"open", "complete", "expired"}`
- `stripe_ps` = `session.payment_status` Stripe ∈ `{"paid", "unpaid", "no_payment_required"}`
- `db_status` = `payments.status` DB ∈ `{"requires_authorization", "authorized", "captured", "cancelled", ...}`
- `bk_row.status` = `bookings.status` DB ∈ `{"awaiting_payment", "requested", "confirmed", ...}`

### Table de vérité

| # | Condition (ordre d'évaluation) | Action | Notifications |
|---|---|---|---|
| 1 | `s_status='complete' AND stripe_ps='unpaid' AND db_status NOT IN ('authorized','captured','paid')` AND `bk_row.status='awaiting_payment'` | payments→captured, bookings→confirmed+paid (guardé) | push × 2 (payer + receiver) |
| 2 | `s_status='complete' AND stripe_ps='unpaid' AND db_status NOT IN ('authorized','captured','paid')` AND **NOT** instant | payments→authorized, bookings.payment_status→authorized | aucune |
| 3 | `stripe_ps='paid' AND db_status != 'captured'` (indépendant de s_status) | payments→captured, bookings→confirmed+paid (guardé) | aucune |
| 4 | `s_status='expired' AND db_status='authorized'` | payments→cancelled | aucune |
| 5 | Sinon | **aucun UPDATE** | aucune |

### ⚠️ Ordre impératif (elif chain Python)

```python
if s_status == "complete" and stripe_ps == "unpaid":
    # Branche 1 ou 2
elif stripe_ps == "paid" and db_status not in ("captured",):
    # Branche 3
elif s_status == "expired" and db_status == "authorized":
    # Branche 4
```

**Ne pas swap les branches 1 et 3 en Java** : un cas `stripe_ps='paid'` alors que `s_status='complete'` et `db_status='requires_authorization'` doit être capturé par la branche 1 (pas la 3), car la branche 1 gagne (elif).

> En pratique, si `stripe_ps='paid'` alors `s_status='complete'` presque toujours. Mais si par un cas rare on a `s_status='open' AND stripe_ps='paid'` — seule la branche 3 matche. Ordre IMPORTANT.

---

## BR-31.04 — Garde anti-régression sur `bookings`

### Règle
L'UPDATE `bookings → confirmed/paid` (branches 1 et 3) est toujours gardé par :
```sql
WHERE booking_id = $1
  AND status NOT IN ('confirmed','refused','cancelled','expired')
```

### Motivation
- Ne pas écraser un booking qui a été annulé/refusé pendant que le user était sur Stripe
- Ne pas re-confirmer un booking déjà confirmé (idempotence)

### Conséquence
Si un booking est `refused` pendant la redirection Stripe, le paiement a déjà été autorisé/capturé par Stripe MAIS le booking reste `refused`. **Un cas limite à gérer** dans une slice ultérieure (remboursement automatique) mais **hors périmètre S31**.

### ⚠️ Asymétrie branche 1-B (manual → authorized)
L'UPDATE `bookings.payment_status='authorized'` (branche 1-B) n'a **PAS** ce garde. Un booking 'cancelled' pourrait voir son payment_status flippé. **Compat stricte** = reproduire sans ajout de garde.

---

## BR-31.05 — Push notifications SYNC (pas fire-and-forget)

### Règle
```python
await send_push_to_user(pool, payer_user_id, ...)
await send_push_to_user(pool, receiver_user_id, ...)
```

### ⚠️ Contraste avec S29/S30
- S29 DELETE SpotYou : `asyncio.create_task(...)` fire-and-forget
- S30 Booking request : `asyncio.create_task(...)` fire-and-forget
- **S31 Checkout status** : `await` synchrone

### Motivation (déductions)
- L'endpoint est appelé par le front immédiatement après redirect Stripe
- Le user attend une réponse de confirmation
- Les push sont considérés essentiels pour l'UX (notif mobile + badge)

### Conséquence
- Si `send_push_to_user` throw → l'erreur remonte, endpoint retourne 500
- Si `send_push_to_user` est lent → endpoint lent

### Java
**Ne pas utiliser `@Async` ni `@TransactionalEventListener(AFTER_COMMIT)` ici.** Appeler `pushService.sendPush(...)` directement et synchronement. Compat stricte.

### Risque race
Si le webhook Stripe arrive pendant qu'on est dans les 2 `await`, il peut lire `db_status='captured'` (la tx a commité) et ne rien faire. OK. Mais dans l'autre sens (webhook arrive AVANT le endpoint), notre `db_status` pré-check protège : `if db_status NOT IN ('authorized','captured','paid'):`.

---

## BR-31.06 — Payload des push

### Push au **payer** (branche 1-A instant)
| Champ | Valeur |
|---|---|
| `title` | `"Réservation confirmée !"` |
| `body` | `f"Votre réservation pour « {title} » est confirmée. À bientôt !"` (guillemets français `« »`) |
| `data.type` | `"booking_confirmed"` |
| `data.booking_id` | `payment.booking_id` |
| `notif_type` | `"booking_confirmed"` |

### Push au **receiver** (coach)
| Champ | Valeur |
|---|---|
| `title` | `"Nouvelle réservation !"` |
| `body` | `f"Paiement reçu pour « {title} ». Votre planning a été mis à jour."` |
| `data.type` | `"booking_confirmed"` |
| `data.booking_id` | `payment.booking_id` |
| `notif_type` | `"booking_confirmed"` |

### `title` (du service)
- Source : `SELECT s.title FROM bookings b JOIN services s ...`
- Fallback : `"votre prestation"`

### ⚠️ Asymétrie avec S30
S30 utilisait `data.bookingId` (camelCase). Ici : `data.booking_id` (snake_case). **Asymétrie à préserver.** Ne pas harmoniser.

---

## BR-31.07 — Fallback "unknown" si Stripe indisponible

### Règle
```python
try:
    session = await stripe_service.retrieve_checkout_session(real_session_id)
except Exception as exc:
    log.warning("Impossible de récupérer la session Stripe %s : %s", real_session_id, exc)
    return { ... fallback dict ... }
```

### Réponse fallback
```json
{
  "payment_id":     "...",
  "booking_id":     "...",
  "session_id":     "<param input>",
  "status":         "unknown",
  "payment_status": "<payment.status or 'unknown'>",
  "amount":         "<float(payment.payer_total_amount)>",
  "currency":       "<payment.currency or 'EUR'>"
}
```

### Clés manquantes par rapport au nominal
- **`stripe_status`** : absente dans le fallback (présente dans le nominal).

### Log requis
`log.warning` avec message exact : `"Impossible de récupérer la session Stripe %s : %s"`.

---

## BR-31.08 — `amount` — sérialisation float

### Règle
```python
amount = session.amount_total / 100 if session.amount_total else float(payment["payer_total_amount"])
```

### Cas `session.amount_total = 0`
- `0` est falsy en Python → branche `else` → fallback DB.
- Java **équivalent** : `amountTotal != null && amountTotal > 0 ? amountTotal / 100.0 : paymentDbAmount.doubleValue()`.

### Cas `session.amount_total = None`
- None falsy → branche else → fallback DB.

### Cas `session.amount_total = 5175`
- → `51.75` float.

### Java
Sérialiser en `double` (float JSON) OU `BigDecimal` avec `setScale(2, HALF_UP)` si on veut forcer 2 décimales. **Tester** : Python `51.75` sérialise en `51.75`, mais `51.7` sérialise en `51.7` (pas `51.70`). Java doit reproduire.

---

## BR-31.09 — `currency` — casse hétérogène

### Règle
```python
currency = session.currency or payment.get("currency", "EUR")
```

### Valeurs possibles en réponse
- `"eur"` (si Stripe valide — lowercase)
- `"EUR"` (si Stripe down et fallback DB — uppercase)
- `"EUR"` (si DB aussi NULL — littéral)

### Conséquence
Le front doit être **case-insensitive**. Java : **ne pas normaliser** la casse — garder la source exacte pour compat.

---

## BR-31.10 — Idempotence par gardes Python (pas SQL)

### Règle
Les UPDATE n'ont pas de garde `WHERE status NOT IN (...)` sur la table `payments`. L'idempotence est assurée par les `if db_status NOT IN (...)` **avant** l'UPDATE.

### Conséquence
- Un appel re-déclenché avec `db_status` déjà avancé → `if` échoue → pas d'UPDATE.
- Race condition possible : deux appels concurrents peuvent passer le `if` ensemble → deux UPDATE → double push.

### Java
- Reproduire le pattern Python (check avant UPDATE, pas de SELECT FOR UPDATE).
- **Ne pas ajouter** de guard SQL — compat stricte.
- Accepter le risque de double-push (limitation connue).

---

## BR-31.11 — Re-SELECT payments inutile (compat bit-pour-bit)

### Code Python branche 1-A
```python
# Après UPDATE payments + UPDATE bookings
row = await conn.fetchrow(
    "SELECT payer_user_id, receiver_user_id FROM payments WHERE payment_id=$1",
    payment["payment_id"],
)
```

### Analyse
Les valeurs `payer_user_id` et `receiver_user_id` sont **déjà dans `payment` dict** (lu au début). Cette re-lecture est **inutile**.

### Java
**Reproduire la re-lecture**. Raison : traces SQL / logs audit identiques. Optim = modif fonctionnelle silencieuse = risque de régression.

---

## BR-31.12 — Permissions

### Règle
**Aucune permission métier** — tout user (authentifié ou non) peut appeler ce endpoint.

### Sécurité
Le `session_id` Stripe est long (56+ chars), aléatoire et couplé 1-1 à un paiement. Non-devinable. Serve de secret d'accès.

### Attention
Ne PAS exposer les `session_id` dans les URLs publiques (logs nginx, Google Analytics, etc.). Le front doit les traiter comme des secrets.

---

## BR-31.13 — Timezone

Tous les `NOW()` en PostgreSQL renvoient en UTC (si `TIMESTAMPTZ`). Les `updated_at` sont UTC.

---

## BR-31.14 — Interactions avec slices déjà migrées

| Slice | Dépendance | Risque régression |
|---|---|---|
| **S23 Auth** | `require_auth` en try/except | Si `require_auth` change de signature → assertion silencieuse. **Tester le comportement try/except en Java SecurityConfig.** |
| **S30 Booking create+pay** | Booking en `awaiting_payment`, payment `requires_authorization` | Si S30 ne populait pas `stripe_checkout_session_id` → ce endpoint ne trouverait rien → 404. **Critique** : le lookup repose sur ce champ. |
| **Webhook Stripe (pas migré)** | Concurrent updates sur payments/bookings | **Race condition** mais idempotence Python la gère (gardes sur status). En Java, même comportement. |
| **S26–S29 SpotYou** | Aucune interaction | Nulle |

---

## BR-31.15 — Comportement particulier `booking_id` NULL

### Cas
Un payment sans booking (ex: abonnement, don futur, etc.) : `payments.booking_id = NULL`.

### Conséquence
- Le SELECT `bookings.status` **ne doit pas** être fait (check `if payment.booking_id`).
- `bk_row = None`.
- `is_instant = bk_row and bk_row["status"] == 'awaiting_payment'` → **False** (car `bk_row` est None, short-circuit `and`).
- Donc branche 1 va tomber dans `else` (manual_approval path) → UPDATE payments→authorized, **pas d'UPDATE bookings** (check `if payment.get("booking_id")`).

### Java
```java
if (payment.bookingId() != null) {
    // SELECT bookings.status
    // + UPDATE bookings
}
```

---

## BR-31.16 — Logs requis

### Compat stricte — messages à reproduire

| Condition | Log |
|---|---|
| Stripe retrieve throw | `log.warning("Impossible de récupérer la session Stripe %s : %s", real_session_id, exc)` |

Aucun autre log explicite dans ce endpoint (hors webhook + accept qui sont hors périmètre).

### Java
SLF4J `log.warn("Impossible de récupérer la session Stripe {} : {}", realSessionId, e.getMessage())`.

---

## BR-31.17 — Pas de push en branche 1-B (manual_approval)

### Règle
Seule la branche 1-A (instant_booking → captured) envoie des push. Les branches 1-B (manual → authorized), 2 (paid → captured), 3 (expired → cancelled) sont **silencieuses**.

### Motivation
- Branche 1-B : le booking n'est pas encore confirmé (attend l'accept du coach). Pas de signal final à envoyer.
- Branche 2 : cas rare de capture immédiate, la notif est gérée ailleurs (ou n'est pas considérée critique).
- Branche 3 : annulation silencieuse — le user verra l'état via l'écran.

### Java
**Ne pas ajouter** de push sur les branches 2/3/1-B même si ça semble logique. Compat stricte.

---

## BR-31.18 — Appel concurrent avec webhook Stripe

### Cas
Le webhook Stripe peut arriver **en parallèle** de cet endpoint (typique : user revient sur success_url en même temps que Stripe POST le webhook).

### Comportement actuel
- Les deux lisent payment en parallèle → peuvent voir le même `db_status` pré-update
- Les deux tentent l'UPDATE → Postgres gère l'ordre via MVCC mais pas de lock applicatif
- Deux push peuvent être envoyés (si webhook envoie aussi, ce qui est probable côté `webhook_handlers.py`)

### Compat stricte
- Ne pas ajouter de lock (`FOR UPDATE`) — Python ne le fait pas
- Accepter le risque de double-push connu

### Futur
Une slice ultérieure "Robustesse webhook + endpoint sync" pourra ajouter `SELECT FOR UPDATE` sur payments + idempotence via `stripe_webhook_events`. **Hors périmètre S31.**

---

## BR-31.19 — Pas de validation input

### `session_id` path
- Pas de validation format (pas de regex `cs_*` ni `pi_*`).
- Si inconnu → SELECT renvoie NULL → 404.
- Aucune limite de longueur.

### Java
Pas de `@Pattern` sur le `@PathVariable`. Accepter tout string non-vide.
