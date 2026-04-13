# SLICE_12_BUSINESS_RULES.md — Règles métier
> Basé sur `booking_routes.py:675–747`.
> Généré le 2026-02-XX.

---

## RG-01 — Seul le receiver peut refuser

**Source :** `booking_routes.py:695–696`

```python
if bk["receiver_user_id"] != user["user_id"]:
    raise HTTPException(403, "Seul le bénéficiaire peut refuser cette réservation")
```

- Pas d'exception admin (contrairement à `cancel_booking` qui permet à l'admin)
- Pas de COALESCE sur `coach_id` — vérification stricte sur `receiver_user_id` uniquement

**Implication :** un admin ne peut pas refuser via cet endpoint — il doit passer par `/cancel`.

---

## RG-02 — Idempotence si déjà refused

**Source :** `booking_routes.py:697–698`

```python
if bk["status"] == "refused":
    return {"success": True, "status": "refused", "idempotent": True}
```

Si le booking est déjà en état `refused` (deuxième appel ou retry) :
- **Aucune modification DB**
- Réponse HTTP 200 immédiate avec `"idempotent": true`
- La réponse idempotente n'inclut **pas** `"booking_id"`

---

## RG-03 — Seul `requested` peut être refusé

**Source :** `booking_routes.py:699–700`

```python
if bk["status"] not in ("requested",):
    raise HTTPException(409, f"Impossible de refuser une réservation en état '{bk['status']}'")
```

Machine d'états autorisée :

| Statut actuel | Résultat |
|---|---|
| `requested` | ✅ → `refused` |
| `refused` | ✅ → idempotent (pas de modification) |
| `awaiting_payment` | ❌ 409 |
| `confirmed` | ❌ 409 |
| `cancelled` | ❌ 409 |
| `expired` | ❌ 409 |
| `completed` | ❌ 409 |

**Le message d'erreur 409 inclut l'état actuel entre quotes simples.** Reproduire ce format en Java.

---

## RG-04 — UPDATE payments conditionnel

**Source :** `booking_routes.py:713–716`

```sql
UPDATE payments SET status='cancelled' WHERE booking_id=$1 AND status IN ('requires_authorization','authorized')
```

Seuls les payments en état `requires_authorization` ou `authorized` sont annulés.

| Statut payment avant | Après UPDATE |
|---|---|
| `requires_authorization` | `cancelled` |
| `authorized` | `cancelled` |
| `pending` | **inchangé** (0 ligne touchée — normal) |
| `captured` | **inchangé** (ne pas rembourser via /refuse) |
| `cancelled` | **inchangé** (déjà annulé) |
| null / absent | **inchangé** (0 ligne touchée) |

---

## RG-05 — UPDATE slot conditionnel et limité à 'pending'

**Source :** `booking_routes.py:718–723`

```python
if bk["slot_id"]:
    await conn.execute(
        "UPDATE service_slots SET slot_status='available' WHERE slot_id=$1 AND slot_status='pending'",
        bk["slot_id"],
    )
```

- Exécuté **uniquement si** `slot_id` non null
- Libère uniquement les slots en état `'pending'` (pas `'reserved'`, `'booked'`)
- 0 ligne touchée si slot dans autre état → comportement normal, pas d'erreur

**Raison :** lors d'un refus, le slot est en `pending` (manual_approval). Un slot `reserved` ou `booked` correspond à des cas où le paiement a déjà eu lieu, traités par `/cancel`.

---

## RG-06 — Stripe hors transaction, erreur avalée

**Source :** `booking_routes.py:726–732`

```python
if pi_row and pi_row["stripe_payment_intent_id"]:
    try:
        await stripe_service.cancel_payment_intent(pi_id, reason="refused")
    except Exception as exc:
        log.error(...)  # Erreur avalée
```

Double condition :
1. `pi_row` non null (un payment existe pour ce booking)
2. `stripe_payment_intent_id` non null

Si ces conditions ne sont pas remplies → **aucun appel Stripe**.

Si l'appel Stripe échoue → **l'exception est avalée**, le booking reste `refused` en DB.

**Décision Java v1 :** ce bloc peut être un **no-op** (méthode vide) ou un stub loggé. À activer en Slice Stripe dédiée.

---

## RG-07 — Push notification — destinataire et contenu fixes

**Source :** `booking_routes.py:735–745`

Le push est envoyé **toujours** (hors idempotence) au `payer_user_id` = `bookings.user_id` (alias lu en SELECT).

```python
_push(
    pool,
    bk["payer_user_id"],        # bookings.user_id (legacy payer)
    title="Réservation refusée",
    body="Votre demande de réservation n'a pas pu être acceptée.",
    data={"type": "booking_refused", "bookingId": booking_id, "action_text": "a refusé votre demande"},
    notif_type="booking_refused",
)
```

**Fire-and-forget** : `_push()` est `asyncio.create_task()` — non bloquant, non attendu. Si le push échoue, l'endpoint retourne quand même 200.

---

## RG-08 — Pas de body JSON

**Source :** signature du handler `async def refuse_booking(booking_id: str, request: Request):`

L'endpoint n'attend **aucun corps JSON** dans la requête POST.

Pas de `reason` comme dans `/cancel`. Pas de paramètre de body. Juste le path param `booking_id`.

---

## RG-09 — Receiver via receiver_user_id uniquement (pas de COALESCE)

**Source :** `booking_routes.py:695` — `bk["receiver_user_id"] != user["user_id"]`

La vérification d'accès utilise uniquement `receiver_user_id` — pas de fallback sur `coach_id`.

Conséquence : un booking très ancien avec `receiver_user_id=null` et `coach_id=coach_xyz` → le coach verra un **403** sur `/refuse`.

**Comportement Python actuel — à reproduire fidèlement** sans COALESCE supplémentaire.

---

## Cohérence avec les slices précédentes

| Slice | Lien avec Slice 12 |
|---|---|
| Slice 11 — `GET /bookings/{id}` | Après un `/refuse`, le détail retourne `status=refused` |
| Slice 11 — `GET /bookings/received` | Le booking disparaît logiquement de la vue "en attente" du receiver |
| Slice 11 — `GET /bookings/me` | Le booking apparaît toujours dans `/me` (pas de filtre statut) |
| Slice 02 — `require_auth` | Même mécanisme JWT + DB lookup |

---

## Ce qui touche Stripe dans cette slice

| Interaction Stripe | Moment | Obligatoire en v1 |
|---|---|---|
| `cancel_payment_intent(pi_id, reason="refused")` | Hors transaction, après commit | **NON** — stub acceptable |

**Recommandation Java v1 :** implémenter un `StripeService.cancelPaymentIntent()` qui logue et retourne sans erreur. Activer l'appel réel en Slice Stripe.

---

## Niveau de confiance

| Règle | Confiance |
|---|---|
| RG-01 receiver only | HAUTE |
| RG-02 idempotence refused | HAUTE |
| RG-03 machine d'états | HAUTE |
| RG-04 payments filtre | HAUTE |
| RG-05 slot pending only | HAUTE |
| RG-06 Stripe hors transaction | HAUTE |
| RG-07 push fire-and-forget | HAUTE |
| RG-08 pas de body | HAUTE |
| RG-09 receiver_user_id strict | HAUTE |
