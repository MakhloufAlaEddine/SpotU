# SLICE_13_BUSINESS_RULES.md — Règles métier
> Basé sur `booking_routes.py:401–552`.
> Généré le 2026-02-XX.

---

## RG-01 — Receiver OU admin peuvent accepter

**Source :** `booking_routes.py:444–445`

```python
if bk["receiver_user_id"] != user["user_id"] and user.get("role") != "admin":
    raise HTTPException(403, "Seul le bénéficiaire peut accepter cette réservation")
```

**Différence majeure avec `/refuse` (Slice 12) :**

| Endpoint | Qui peut agir |
|---|---|
| `POST /refuse` | Receiver UNIQUEMENT (pas d'admin) |
| `POST /accept` | Receiver OU admin |

**Implication Java :** la condition d'accès est un OU logique : `userId.equals(receiverUserId) OR "admin".equals(role)`.

---

## RG-02 — Idempotence sur 3 statuts

**Source :** `booking_routes.py:448–449`

```python
if bk["status"] in ("awaiting_payment", "accepted", "confirmed"):
    return {"success": True, "status": bk["status"], "booking_id": booking_id, "idempotent": True}
```

Trois états déclenchent l'idempotence :
- `awaiting_payment` — accepté, en attente de paiement (Cas B)
- `accepted` — état legacy (avant refonte flux)
- `confirmed` — accepté et payé (Cas A)

**Piège clé :** `status` dans la réponse idempotente = `bk["status"]` (état réel), pas hardcodé. Un booking `confirmed` retourne `"status": "confirmed"`, pas `"awaiting_payment"`.

---

## RG-03 — Seul `requested` peut être accepté

**Source :** `booking_routes.py:451–452`

```python
if bk["status"] != "requested":
    raise HTTPException(409, f"Impossible d'accepter une réservation en état '{bk['status']}'")
```

| Statut actuel | Résultat |
|---|---|
| `requested` | ✅ → Cas A ou Cas B selon payment |
| `awaiting_payment` / `accepted` / `confirmed` | ✅ → idempotent (200) |
| `refused` | ❌ 409 |
| `cancelled` | ❌ 409 |
| `expired` | ❌ 409 |
| `completed` | ❌ 409 |

---

## RG-04 — Garde TTL : expires_at dans le passé → 410

**Source :** `booking_routes.py:455–461`

```python
if expires_at:
    now_utc = datetime.now(timezone.utc)
    if getattr(expires_at, 'tzinfo', None) is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now_utc:
        raise HTTPException(410, "Cette réservation a expiré — le créneau a été libéré")
```

**Détails :**
- Si `bk["expires_at"]` est null → pas de vérification TTL (normal pour `requested`)
- Si la date est naive (sans timezone) → Python ajoute UTC → à reproduire en Java (`ZonedDateTime.withZoneSameInstant(UTC)`)
- HTTP **410** Gone (pas 409) — code distinct

---

## RG-05 — Branchement Cas A/B sur (payment_mode, pay_status)

**Source :** `booking_routes.py:475`

```python
if payment_mode == "pay_now" and pay_status == "authorized":
    # Cas A
else:
    # Cas B
```

**Table de vérité :**

| payment_mode | pay_status | Cas |
|---|---|---|
| `pay_now` | `authorized` | **A** → confirmed |
| `pay_now` | `pending` | **B** → awaiting_payment |
| `pay_now` | `null` (pas de payment) | **B** → awaiting_payment |
| `pay_later` | n'importe quoi | **B** → awaiting_payment |

**Note :** `pay_status = null` (aucun payment) → Cas B. La condition `pay_status == "authorized"` est false pour null.

---

## RG-06 — Cas A : 3 champs modifiés dans bookings + expires_at=NULL

**Source :** `booking_routes.py:480–486`

```sql
UPDATE bookings
SET status = 'confirmed',
    payment_status = 'captured',
    expires_at = NULL,           ← important : remettre à null
    updated_at = NOW()
WHERE booking_id = $1
```

**3 colonnes métier modifiées :** `status`, `payment_status`, `expires_at`.
Ne pas oublier `expires_at = NULL` — c'est intentionnel pour indiquer qu'il n'y a plus de délai.

---

## RG-07 — Cas A : UPDATE payments sur payment_id (PK), conditionnel

**Source :** `booking_routes.py:488–492`

```python
if payment_id:
    await conn.execute(
        "UPDATE payments SET status='captured', updated_at=NOW() WHERE payment_id=$1",
        payment_id,
    )
```

- `payment_id` est lu dans la requête préalable (SELECT payments)
- Si `payment_id = None` (aucun payment en base) → skip total
- UPDATE sur `payment_id` (PK), pas sur `booking_id`
- Pas de filtre sur le statut courant du payment

---

## RG-08 — Cas A : slot → 'booked' avec 3 états acceptables

**Source :** `booking_routes.py:493–496`

```sql
UPDATE service_slots SET slot_status = 'booked'
WHERE slot_id = $1
  AND slot_status IN ('pending', 'available', 'reserved')
```

Accepte 3 états sources : `pending`, `available`, `reserved`.

**Différence vs Cas B et vs refuse :**
- `/refuse` : `AND slot_status = 'pending'` (1 seul état)
- Cas B `/accept` : `AND slot_status IN ('pending', 'available')` (2 états)
- Cas A `/accept` : `AND slot_status IN ('pending', 'available', 'reserved')` (3 états, incl. `reserved`)

---

## RG-09 — Cas B : expiry bipolaire selon payment_mode

**Source :** `booking_routes.py:502–504`

```python
if payment_mode == "pay_now":
    pay_expiry_minutes = await _get_pay_now_minutes(conn)
    # → SELECT app_config WHERE config_key = 'pay_now_checkout_minutes', fallback 30
else:
    pay_expiry_minutes = int(bk.get("pay_later_expiration_minutes") or DEFAULT_PAY_LATER_MINUTES)
    # → service.pay_later_expiration_minutes (du JOIN), fallback 1440
```

Le délai d'expiry est différent selon le mode de paiement :
- `pay_now` → config globale (app_config), défaut 30 min
- `pay_later` → config par service (service.pay_later_expiration_minutes), défaut 1440 min (24h)

---

## RG-10 — Cas B : slot → 'reserved' avec seulement 2 états acceptables

**Source :** `booking_routes.py:517–520`

```sql
UPDATE service_slots SET slot_status = 'reserved'
WHERE slot_id = $1
  AND slot_status IN ('pending', 'available')
```

Accepte 2 états sources : `pending`, `available`.
**Ne passe pas de `reserved` → `reserved`** (contrairement à Cas A qui accepte `reserved` → `booked`).

---

## RG-11 — Stripe Cas A hors transaction, erreur avalée

**Source :** `booking_routes.py:524–531`

- Appel Stripe uniquement en Cas A (`do_capture = True`)
- Conditionnel : `if do_capture and pi_id_to_capture`
- Hors de toute transaction DB
- try/except avale l'erreur → booking reste `confirmed` même si Stripe échoue

**En Java v1 :** stub acceptable — même comportement que Slice 12.

---

## RG-12 — Push notification différenciée selon le cas

**Source :** `booking_routes.py:532–548`

| Cas | Push envoyé |
|---|---|
| Cas A | `type=booking_confirmed`, title="Réservation confirmée !", `payment_captured=True` |
| Cas B | `type=booking_accepted`, title="Réservation acceptée — paiement requis", `requires_payment=True` |

Les deux pushes sont fire-and-forget (`asyncio.create_task`).

---

## RG-13 — `booking_approval_mode` lu mais non utilisé

**Source :** `booking_routes.py:434` (dans le SELECT) — jamais référencé dans la logique accept

`booking_approval_mode` est sélectionné dans le JOIN services mais **n'est jamais lu** dans la logique de `accept_booking`. Il sert dans d'autres handlers (notamment `/request`).

**En Java :** inclure dans la projection du JOIN mais ignorer la valeur dans le service.

---

## Cohérence avec les slices précédentes

| Slice | Lien avec Slice 13 |
|---|---|
| Slice 12 — `/refuse` | Paire avec accept : les 2 transitions depuis `requested` par le receiver |
| Slice 11 — `GET /bookings/received` | Le receiver voit le booking en `requested` → accepte → il passe en `awaiting_payment` ou `confirmed` |
| Slice 11 — `GET /bookings/{id}` | Après accept, le détail retourne le nouveau statut |
| Slice 01 — `GET /config/booking` | `app_config.pay_now_checkout_minutes` est la même config lue ici en Cas B |
| Slice 09 — `GET /services/{id}` | `services.pay_later_expiration_minutes` est la même colonne lue dans le JOIN |

---

## Niveau de confiance

| Règle | Confiance |
|---|---|
| RG-01 receiver + admin | HAUTE |
| RG-02 idempotence 3 statuts | HAUTE |
| RG-03 requested uniquement | HAUTE |
| RG-04 garde TTL → 410 | HAUTE |
| RG-05 branchement A/B | HAUTE |
| RG-06 Cas A 3 champs bookings | HAUTE |
| RG-07 Cas A UPDATE payment_id | HAUTE |
| RG-08 Cas A slot 3 états | HAUTE |
| RG-09 Cas B expiry bipolaire | HAUTE |
| RG-10 Cas B slot 2 états | HAUTE |
| RG-11 Stripe hors transaction | HAUTE |
| RG-12 push différencié | HAUTE |
| RG-13 booking_approval_mode ignoré | HAUTE |
