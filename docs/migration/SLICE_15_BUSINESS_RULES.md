# SLICE_15_BUSINESS_RULES.md — Règles métier de la Slice 15
> Basé sur `booking_routes.py:754–977`.
> Généré le 2026-02-XX.

---

## BR-01 — Authentification stricte

```
Condition : Token JWT Bearer obligatoire
Échec : HTTP 401
```

---

## BR-02 — Contrôle d'accès : 3 acteurs distincts

```python
# booking_routes.py:814–821
uid = user["user_id"]
is_admin    = user.get("role") == "admin"
is_payer    = uid in filter(None, [bk["user_id"], bk["payer_user_id"]])
is_receiver = uid == bk["receiver_user_id"]

if not (is_payer or is_receiver or is_admin):
    raise HTTPException(403, "Vous n'êtes pas autorisé à annuler cette réservation")
```

| Acteur | Condition | États annulables |
|---|---|---|
| **Payer** | `uid == user_id` OU `uid == payer_user_id` | `requested`, `awaiting_payment`, `accepted`, `confirmed` (tout sauf les non-annulables) |
| **Receiver** | `uid == receiver_user_id` | `accepted` uniquement (voir BR-03) |
| **Admin** | `role == "admin"` | Tous les états annulables |

> ⚠️ **Double champ `is_payer`** : les anciens bookings n'ont pas de `payer_user_id` (NULL), seulement `user_id`.
> La vérification `uid in filter(None, [bk["user_id"], bk["payer_user_id"]])` filtre les NULL.
> Java DOIT vérifier les deux champs.

---

## BR-03 — Restriction receiver : `accepted` uniquement

```python
# booking_routes.py:823–831
if is_receiver and not is_payer and not is_admin:
    if bk["status"] != "accepted":
        raise HTTPException(
            409,
            f"Le bénéficiaire peut annuler uniquement une réservation acceptée "
            f"(état actuel : '{bk['status']}'). "
            "Pour refuser une demande en attente, utilisez /refuse.",
        )
```

- Le receiver ne peut annuler QUE si `status = "accepted"`.
- Pour un booking `requested`, le receiver doit utiliser `/refuse` (Slice 12).
- **Erreur levée : HTTP 409** (pas 403) — noter le code HTTP exact.
- La condition est `is_receiver and not is_payer and not is_admin` : un utilisateur qui est à la fois payer ET receiver (cas edge impossible en prod mais géré) n'est pas bloqué.

---

## BR-04 — Idempotence : déjà cancelled

```python
# booking_routes.py:833–835
if bk["status"] == "cancelled":
    return {"success": True, "status": "cancelled", "idempotent": True}
```

- Si déjà `cancelled` : retour immédiat, **sans ré-exécuter les UPDATEs**.
- Réponse sans `payment_status`, `cancelled_by`, `stripe_action`.
- **Ordre d'exécution** : contrôle d'accès → idempotence → états non annulables.

---

## BR-05 — États non annulables

```python
# booking_routes.py:838–842
if bk["status"] in ("completed", "refused", "expired"):
    raise HTTPException(
        409,
        f"Impossible d'annuler une réservation en état '{bk['status']}'",
    )
```

| Statut | Annulable |
|---|---|
| `requested` | ✅ OUI (payer ou admin) |
| `awaiting_payment` | ✅ OUI (payer ou admin) |
| `accepted` | ✅ OUI (payer, receiver, admin) |
| `confirmed` | ✅ OUI (payer ou admin) |
| `cancelled` | idempotent (retour immédiat) |
| `completed` | ❌ NON — 409 |
| `refused` | ❌ NON — 409 |
| `expired` | ❌ NON — 409 |

---

## BR-06 — Matrice transitions payment

```python
# booking_routes.py:844–852
pay_status = bk.get("pay_status") or ""

if pay_status in ("requires_authorization", "authorized", "capture_pending"):
    new_pay_status = "cancelled"
elif pay_status == "captured":
    new_pay_status = "refunded"
else:
    new_pay_status = pay_status  # pending / failed / None → inchangé
```

- `pay_status` peut être `None` si aucun enregistrement `payments` (LEFT JOIN).
- `bk.get("pay_status") or ""` : le `or ""` normalise `None` en chaîne vide → branche `else`.

---

## BR-07 — Transaction atomique (3 UPDATEs)

Les 3 UPDATEs sont dans une seule transaction :
1. `UPDATE bookings SET status='cancelled', cancelled_by_user_id=$2, cancellation_reason=$3, updated_at=NOW()`
2. `UPDATE payments SET status=$1, updated_at=NOW() WHERE payment_id=$2` (conditionnel)
3. `UPDATE service_slots SET slot_status='available' WHERE slot_id=$1 AND slot_status IN (...)` (conditionnel)

**Condition UPDATE payments :** `bk.get("payment_id") AND new_pay_status != pay_status`
**Condition UPDATE service_slots :** `bk["slot_id"]` non NULL

---

## BR-08 — Stripe hors transaction

Les appels Stripe sont exécutés **après** la transaction DB :

### Branche PI cancel (`new_pay_status == "cancelled"`)
```python
if new_pay_status == "cancelled" and pi_id:
    await stripe_service.cancel_payment_intent(pi_id, reason="cancelled")
    stripe_action = "pi_cancelled"
```
- `reason="cancelled"` (valeur fixe)
- Si erreur Stripe → log ERROR, la DB reste `cancelled` (pas de rollback)

### Branche Refund (`new_pay_status == "refunded"`)
```python
elif new_pay_status == "refunded":
    if charge_id:
        await stripe_service.create_refund(
            charge_id=charge_id,
            reason="requested_by_customer",
            idempotency_key=booking_id,
        )
        stripe_action = "refund_created"
    else:
        log.warning("Paiement capturé sans stripe_charge_id — remboursement manuel requis")
```
- `reason="requested_by_customer"` (valeur fixe)
- `idempotency_key=booking_id` (prévient le double remboursement)
- Si `charge_id IS NULL` → AUCUNE action Stripe, juste un warning

---

## BR-09 — Push notifications : 3 patterns selon acteur

```python
# booking_routes.py:914–960
refund_suffix = " Un remboursement a été initié." if new_pay_status == "refunded" else ""
payer_uid    = bk.get("payer_user_id") or bk.get("user_id")
receiver_uid = bk.get("receiver_user_id")

if is_admin:
    _push(pool, payer_uid, ...)    # → payer
    _push(pool, receiver_uid, ...) # → receiver (2 notifications)

elif is_payer:
    _push(pool, receiver_uid, ...)  # → receiver uniquement

elif is_receiver:
    _push(pool, payer_uid, ...)     # → payer uniquement (+ refund_suffix si applicable)
```

#### Contenu des notifications

| Acteur qui annule | Destinataire | Titre | data.type |
|---|---|---|---|
| Admin | Payer | "Réservation annulée" | `booking_cancelled` + `cancelled_by: "admin"` |
| Admin | Receiver | "Réservation annulée" | `booking_cancelled` + `cancelled_by: "admin"` |
| Payer | Receiver | "Réservation annulée par le client" | `booking_cancelled_by_payer` |
| Receiver | Payer | "Réservation annulée par le prestataire" | `booking_cancelled_by_receiver` + `refund: bool` |

> ⚠️ `payer_uid = bk.get("payer_user_id") or bk.get("user_id")` — fallback legacy sur `user_id`.

---

## BR-10 — Colonnes de traçabilité

Deux nouvelles colonnes spécifiques à l'annulation :

```sql
bookings.cancelled_by_user_id  -- qui a annulé (FK users)
bookings.cancellation_reason   -- raison libre (nullable)
```

Ces colonnes ne sont pas modifiées par d'autres endpoints — exclusives à `/cancel`.

---

## Résumé des règles

| # | Règle | Criticité |
|---|---|---|
| BR-01 | Auth stricte — 401 | CRITIQUE |
| BR-02 | 3 acteurs avec droits asymétriques — 403 | CRITIQUE |
| BR-03 | Receiver : `accepted` uniquement — 409 | PIÈGE |
| BR-04 | Idempotence si déjà `cancelled` | OBLIGATOIRE |
| BR-05 | Non-annulables : completed/refused/expired — 409 | CRITIQUE |
| BR-06 | Matrice payment (4 branches) | CRITIQUE |
| BR-07 | Transaction atomique 3 UPDATEs | OBLIGATOIRE |
| BR-08 | Stripe hors transaction, try/except | OBLIGATOIRE |
| BR-09 | 3 patterns push selon acteur | OBLIGATOIRE |
| BR-10 | `cancelled_by_user_id` + `cancellation_reason` | OBLIGATOIRE |

---

## Ce qui est HORS scope

| Élément | Raison |
|---|---|
| Workers d'expiry | Non impactés directement par cancel |
| WebSockets | Non utilisés |
| Admin complet booking (dashboard) | Admin PEUT utiliser `/cancel`, mais pas de vue admin spécifique ici |
| Refund partiel | Non implémenté en Python (refund = toujours 100%) |
| Stripe webhook | Non concerné par cette route |
