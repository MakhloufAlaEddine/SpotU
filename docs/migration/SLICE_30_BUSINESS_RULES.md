# SLICE_30_BUSINESS_RULES.md — Règles métier Booking Create + Pay
> Basé sur `booking_routes.py:115–382, 558–670`.
> Généré le 2026-04-20.

---

## BR-30.01 — Permissions

| Endpoint | Qui peut appeler ? |
|---|---|
| `POST /bookings/price-preview` | Tout utilisateur authentifié |
| `POST /bookings/request` (+ alias) | Tout utilisateur authentifié (ne peut pas être le coach du service) |
| `POST /bookings/{id}/pay` | Le **payer** du booking (`booking.payer_user_id` ou fallback `booking.user_id`) **OU** un admin plateforme (`role='admin'`) |

### Détails guards request
- `receiver_user_id == payer_user_id` → **400** `"Impossible de réserver son propre service"`
- Pas de check "user bloqué", "user non-vérifié", etc. Actuellement **permissif**.

### Détails guards pay
- `effective_payer = booking.payer_user_id OR booking.user_id` (fallback pour bookings seedés avant que `payer_user_id` n'existe).
- `effective_payer != caller.user_id AND role != 'admin'` → **403** `"Seul le payeur peut initier le paiement"`.
- Un admin peut initier le paiement pour un autre user (support client).

---

## BR-30.02 — Les 4 flux de création

Matrice `booking_approval_mode` × `payment_mode` (après normalisation par flags globaux) :

| # | approval | payment | Booking status | Slot status | Expiration |
|---|---|---|---|---|---|
| A | `instant_booking` | `pay_now` | `awaiting_payment` | `reserved` | `pay_now_checkout_minutes` (défaut 30) |
| B | `instant_booking` | `pay_later` | `awaiting_payment` | `reserved` | `services.pay_later_expiration_minutes` (défaut 1440 = 24h) |
| C | `manual_approval` | `pay_now` | `requested` | `pending` | `BOOKING_EXPIRY_HOURS` (env, défaut 48h) |
| D | `manual_approval` | `pay_later` | `requested` | `pending` | `BOOKING_EXPIRY_HOURS` (48h) |

### Effet des flags globaux `app_config`

| Flag | Valeur `'false'` → effet |
|---|---|
| `enable_manual_approval_for_services` | Tous services forcés en `instant_booking`, même si `services.booking_approval_mode='manual_approval'` |
| `enable_pay_later_for_services` | `allow_pay_later` forcé à FALSE. Demande `pay_later` → **409** `"Le paiement différé n'est pas activé sur cette plateforme — veuillez choisir 'pay_now'"` |

> **Ordre de vérification** : le flag global prime sur la config du service (défense en profondeur).

---

## BR-30.03 — Idempotence triple (request)

| # | Clé | SQL | Comportement |
|---|---|---|---|
| 1 | `body.idempotency_key` (UNIQUE INDEX) | `SELECT booking_id FROM bookings WHERE idempotency_key=$1` | Si hit → return booking existant (200, indiscernable) |
| 2 | `(slot_id, user_id)` tuple logique | `SELECT booking_id WHERE slot_id=$1 AND user_id=$2 AND status NOT IN ('refused','cancelled','expired') LIMIT 1` | Si hit → return booking existant |
| 3 | — | (transaction SQL ouvrira ici si pas de hit) | |

> **Aucun flag `idempotent` dans la réponse** — le front ne peut pas distinguer une création d'une reprise. Compat stricte : ne pas ajouter ce flag en Java.

### Pourquoi 3 niveaux ?
- **(1) `idempotency_key`** : double-click protection côté front.
- **(2) `(slot_id, user_id)`** : un même utilisateur ne peut pas créer 2 bookings actifs pour le même créneau (ex: oubli de stocker l'idempotency_key).
- **(3) Row-level lock NOWAIT** : empêche 2 users différents de réserver le même créneau en simultané (renvoi 409 au second).

---

## BR-30.04 — Row-level lock NOWAIT (concurrence slot)

### Règle
Uniquement si `body.slot_id` est fourni. Pas de lock sur les bookings sans slot (ex: coaching libre sur rendez-vous).

### SQL
```sql
SELECT slot_id, slot_type, slot_status
  FROM service_slots
 WHERE slot_id = $1
   FOR UPDATE NOWAIT
```

### Comportement
- Si le slot est déjà verrouillé par une autre transaction → **`asyncpg.LockNotAvailableError`** (SQLState PostgreSQL `55P03`) → **409** `"Ce créneau est en cours de réservation — réessayez"`.
- **Pas de retry automatique côté backend** — le client doit réessayer.
- Le verrou est relâché au commit (succès ou rollback).

### Vérification d'état **après** lock
Uniquement pour `slot_type ∈ ('single','specific')` :
- `slot_status != 'available'` → **409** `"Créneau indisponible (état : <status>)"`

### Slots recurring
Pas de check `slot_status`. Pas de transition (`UPDATE service_slots`). Capacité illimitée logique (plusieurs bookings partagent le même slot recurring).

---

## BR-30.05 — Idempotence pay (Stripe session)

### Règle
Si `payment.stripe_checkout_session_id` existe :
1. `stripe.retrieve_checkout_session(existing_id)`
2. Si `session.status == 'open'` → return la session existante (avec flag `reused: true`).
3. Si `status != 'open'` (expired, complete, canceled) → créer une nouvelle session (silencieusement).
4. Si l'appel Stripe throw → **try/except silencieux** → créer une nouvelle session.

### Format réponse idempotent
```json
{ "url": "...", "checkout_url": "...", "session_id": "cs_...", "reused": true }
```

vs nominal :
```json
{ "url": "...", "checkout_url": "...", "session_id": "cs_..." }
```

> Le flag `reused` **n'est présent que** dans le cas de reprise. Absent en création. Le front peut se baser dessus.

---

## BR-30.06 — Prix calculé côté serveur uniquement

### Règle
**Aucun calcul de prix côté client n'est accepté**. Le backend ignore tout champ `amount` qui serait dans le body. Le pricing est recalculé entièrement via `pricing_engine.compute_pricing(...)`.

### Motivation métier
Sécurité — un attaquant ne peut pas envoyer un prix truqué.

### Pricing Result (structure)
8 champs numériques + currency + product_type. Snapshot stocké dans :
- `bookings.pricing_snapshot` (JSONB, sérialisé via `json.dumps(snap)`)
- `payments.pricing_rule_snapshot` (JSONB, règle tarifaire utilisée)

Et éclaté en colonnes individuelles sur `payments` (`base_amount`, `payer_fixed_fee`, etc.).

---

## BR-30.07 — TTL (expires_at) et comportement worker

### Rôle
Le worker `expiry_worker.py` (interval 60s, batch 50) scan les bookings où `expires_at < NOW()` et :
- `requested` + ttl passé → `expired`, slot `pending` → `available`
- `awaiting_payment` + ttl passé → `cancelled`/`expired`, slot `reserved` → `available`, payment `cancelled`

### Conséquence pour Slice 30
- **request** : l'endpoint CRÉE `expires_at`.
- **pay** : l'endpoint LIT `expires_at` pour la garde **410** `"Le délai de paiement a expiré — réservation annulée"`.
- **Le worker est hors périmètre Slice 30** mais la colonne `expires_at` doit être écrite correctement pour que le worker fonctionne.

### Code 410 "Gone" (et pas 409)
Choix sémantique Python : `expires_at < NOW()` = ressource expirée (Gone), pas un conflit d'état. **Garder 410 en Java**.

---

## BR-30.08 — Machine d'états (transitions écrites par cette slice)

### Booking
```
(absent)          → requested | awaiting_payment              [request, INSERT]
awaiting_payment  → awaiting_payment (idempotent/no-op)       [pay, mais payment_status=requires_authorization]
```

### Slot
```
available  → pending       (manual_approval + slot présent)    [request]
available  → reserved      (instant_booking + slot présent)    [request]
```

### Payment
```
(absent)                → requires_authorization              [request, INSERT]
* (sauf auth/cap)       → requires_authorization              [pay, UPDATE avec CASE]
```

> **Pas de transition** `requires_authorization → authorized` ou `→ captured` dans cette slice. Ces transitions sont faites par les webhooks Stripe (slice webhook future) et `/bookings/{id}/accept` (slice booking lifecycle).

---

## BR-30.09 — Amount Stripe en centimes

### Règle
`amount_cents = int(round(float(payment.payer_total_amount) * 100))`

### Détails
- **`round()` avant `int()`** : gère les flottants (50.005 → 5001, pas 5000).
- **Float précision** : si `payer_total_amount` est BigDecimal/Numeric côté DB, attention au round-trip. Java : `BigDecimal.multiply(100).setScale(0, RoundingMode.HALF_UP).intValueExact()`.

### Currency
`currency = payment.currency.lower() OR 'eur'` — lowercase imposé par Stripe.

### Stripe idempotency_key
`idempotency_key = payment.payment_id` — réutilisable indéfiniment, même Stripe session retournée si même key.

---

## BR-30.10 — URL de retour Stripe

### Résolution
```python
origin_url = body.get('origin_url', '') OR os.environ.get('APP_URL', '')
```

### URLs construites
- `success_url = f"{origin_url}/payment-success?session_id={{CHECKOUT_SESSION_ID}}&booking_id={booking_id}"`
- `cancel_url  = f"{origin_url}/bookings"`

### ⚠️ Piège
Le literal `{CHECKOUT_SESSION_ID}` (avec accolades) est un **token Stripe** remplacé côté Stripe lors de la redirection. **NE PAS URL-encode** les `{` `}` (sinon Stripe ne reconnaît pas le token).

Java : utiliser `String.format(...)` pur, pas de `URLEncoder.encode`.

---

## BR-30.11 — Fallback `payer_user_id` NULL

### Règle (pay uniquement)
```python
effective_payer = booking.payer_user_id OR booking.user_id
```

### Contexte
Certains bookings seedés dans les environnements de test n'ont pas `payer_user_id` renseigné (colonne ajoutée en migration ultérieure). Le code fallback sur `user_id` (le legacy alias).

### Java
Utiliser `COALESCE(payer_user_id, user_id)` dans la requête SQL OU gérer côté service avec `Optional.ofNullable()`.

---

## BR-30.12 — Notifications push

### Règle (uniquement request, pas pay)
Après COMMIT de la transaction, envoyer 1 push au `receiver_user_id` (coach) :

| initial_status | title | body | data.type | notif_type |
|---|---|---|---|---|
| `awaiting_payment` | `"Créneau réservé (paiement en attente)"` | `f"{user_name} a réservé un créneau : {svc_name}"` | `"booking_awaiting_payment"` | `"new_booking"` |
| `requested` | `"Nouvelle demande de réservation"` | `f"{user_name} souhaite réserver : {svc_name}"` | `"new_booking"` | `"new_booking"` |

### `data` payload complet
```json
{
  "type":       "<booking_awaiting_payment|new_booking>",
  "bookingId":  "<bid>",
  "service_id": "<service_id>",
  "sender_id":  "<payer_user_id>",
  "sender_name":"<caller.name or ''>"
}
```

### Fallbacks
- `user_name = users.name OR "Un utilisateur"`
- `svc_name = services.title OR "votre service"`

### Java
`@TransactionalEventListener(phase=AFTER_COMMIT)`.

---

## BR-30.13 — Asymétries à préserver (ne PAS harmoniser)

| Aspect | Comportement Python | Java doit répéter |
|---|---|---|
| Response `url` vs `checkout_url` (même valeur dupliquée) | Les 2 clés retournées à chaque fois | ✅ |
| Flag `reused: true` présent uniquement en idempotent pay | Absent en nominal | ✅ |
| Aucun flag `idempotent` en response request idempotent | Réponse indiscernable | ✅ |
| `payment_status` littéral `'pending'` à l'INSERT booking | ≠ valeur `PaymentStatus.PENDING` enum potentiel | ✅ |
| `currency` littéral `'EUR'` à l'INSERT booking | Dur-codé, pas paramétré | ✅ |
| `try/except` silencieux sur `stripe.retrieve_checkout_session` | Erreur → créer nouvelle session silencieusement | ✅ |
| `pay_later` rejeté : 400 si service ne permet pas, 409 si flag global off | **Deux codes différents** pour la même intention | ✅ |
| `expires_at` : 410 sur pay, mais pas de garde expires_at sur request | Cohérent avec sémantique (reservation nouvelle vs paiement différé) | ✅ |

---

## BR-30.14 — Validation payload request

| Champ | Type | Défaut | Validation |
|---|---|---|---|
| `service_id` | string | — | Requis (Pydantic) |
| `scheduled_at` | ISO-8601 | None | Optionnel. Pas de check "dans le futur" côté endpoint. |
| `slot_id` | string | None | Optionnel. Si présent : guard FOR UPDATE NOWAIT + status. |
| `location_id` | string | None | Optionnel. Pas de check FK côté endpoint (erreur PG remontera). |
| `notes` | string | None | Libre, pas de max length côté endpoint. |
| `idempotency_key` | string | None | Optionnel mais **fortement recommandé**. |
| `payment_mode` | `"pay_now"` OR `"pay_later"` | `"pay_now"` (Pydantic default) | Whitelist stricte sinon 400. |

### Pas de validation sémantique croisée
- `scheduled_at` sans `slot_id` → accepté (coaching rendez-vous libre).
- `slot_id` sans `scheduled_at` → accepté (slot fixe).
- `location_id` invalide → FK violation PG → remonte en 500 (compat).

---

## BR-30.15 — Interactions avec slices déjà migrées

| Slice | Dépendance | Risque régression |
|---|---|---|
| **S23 Auth** | `require_auth` utilisé partout | Si champ `caller.name` ou `caller.role` absent → push payload incomplet ou check admin cassé |
| **S26 Home feed** | Lecture `tag_points` — aucune interaction directe | Nulle |
| **S27 TagPoints reads** | Aucune interaction | Nulle |
| **S28 TagPoints CRUD** | Aucune interaction | Nulle |
| **S29 SpotYou Soft-Delete** | Aucune interaction | Nulle |
| **Services CRUD (non migré)** | `SELECT services` côté Java doit filtrer `active=TRUE` — **identique au Python** | Si un service est soft-deleted (futur Slice services), la condition `active=TRUE` filtre correctement |

### Dépendance circulaire à surveiller
Le booking référence `services.service_id`. Si Slice "Services CRUD" est migrée APRÈS S30, alors le Java doit lire des `services` depuis la même DB que le Python. **C'est OK** tant que la DB est partagée pendant la phase de migration progressive.

---

## BR-30.16 — Dépendances Stripe

### Service `stripe_service.create_checkout_session` (signature)
```python
async def create_checkout_session(
    amount_cents: int,
    currency:     str,        # lowercase ISO 4217 (e.g. 'eur')
    success_url:  str,
    cancel_url:   str,
    metadata:     dict,       # { "payment_id": ..., "booking_id": ... }
    idempotency_key: str,     # = payment_id pour idempotence Stripe
) -> stripe.checkout.Session
```

### Service `stripe_service.retrieve_checkout_session`
```python
async def retrieve_checkout_session(session_id: str) -> stripe.checkout.Session
```
- Throw si session inconnue.
- Caller (pay endpoint) catch en try/except silencieux → crée nouvelle.

### Mode Stripe
`mode = "payment"` (auth + capture en une fois) — cf. `stripe_service.py` (à confirmer lors de l'implémentation Java). Le flow "authorize-then-capture" est géré **par ailleurs** dans `/bookings/{id}/accept` via `capture_payment_intent`.

### Test keys
`STRIPE_API_KEY` (secret) + `STRIPE_PUBLISHABLE_KEY` dans `.env`. **Une clé test est fournie par la plateforme Emergent pour dev**.

---

## BR-30.17 — Logging (traces obligatoires à reproduire)

### Request (fin de flow)
```
log.info("Booking créé : bk=%s | approval=%s | payment=%s | status=%s | expiry=%s",
         bid, approval_mode, payment_mode, initial_status, expires_interval)
```

### Pay (pas de log particulier dans le nominal)
Mais l'erreur capture PaymentIntent (dans `accept` — hors périmètre) logue `PaymentIntent capturé...` / `Erreur capture PI...`.

### Java
Utiliser le même format MDC/SLF4J avec les mêmes clés.

---

## BR-30.18 — Timezone

Tout en **UTC**. `datetime.now(timezone.utc)`. Colonnes DB `TIMESTAMPTZ`. `expires_at` comparaisons systématiques avec `tzinfo=timezone.utc` forcé si la row revient en naive (defensive Python) — Java : `Instant` natif, pas de soucis.
