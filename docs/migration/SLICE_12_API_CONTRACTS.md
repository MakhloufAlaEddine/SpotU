# SLICE_12_API_CONTRACTS.md — Contrats d'API exacts
> Basé sur `booking_routes.py:675–747`.
> Généré le 2026-02-XX.

---

## ENDPOINT — POST /api/bookings/{booking_id}/refuse

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `POST` |
| Chemin Python | `/api/bookings/{booking_id}/refuse` |
| Chemin Java | `/api/bookings/{bookingId}/refuse` |
| Auth | **STRICTE** — `require_auth` — 401 si token absent ou invalide |
| Body | **AUCUN** — pas de corps JSON attendu |
| Idempotent | **OUI** — si déjà `refused` : retour immédiat avec `"idempotent": true` |
| Handler | `refuse_booking()` — `booking_routes.py:676` |

---

## Paramètres

### Path

| Param | Type | Obligatoire | Description |
|---|---|---|---|
| `booking_id` | string | OUI | ID du booking à refuser |

### Query params : AUCUN

### Body : AUCUN

L'endpoint Python est `@router.post("/bookings/{booking_id}/refuse")` sans paramètre Body.  
Ne pas attendre de JSON entrant en Java.

---

## Logique complète

```python
# booking_routes.py:686-700
# 1. Lecture du booking (SELECT)
row = await conn.fetchrow(
    "SELECT booking_id, status, receiver_user_id, slot_id, user_id AS payer_user_id FROM bookings WHERE booking_id=$1",
    booking_id,
)
if not row:
    raise HTTPException(404, "Réservation introuvable")

# 2. Contrôle accès receiver
if bk["receiver_user_id"] != user["user_id"]:
    raise HTTPException(403, "Seul le bénéficiaire peut refuser cette réservation")

# 3. Idempotence
if bk["status"] == "refused":
    return {"success": True, "status": "refused", "idempotent": True}

# 4. Garde statut
if bk["status"] not in ("requested",):
    raise HTTPException(409, f"Impossible de refuser une réservation en état '{bk['status']}'")

# 5. Lecture PI Stripe avant transaction
pi_row = await conn.fetchrow(
    "SELECT stripe_payment_intent_id, status AS pay_status FROM payments WHERE booking_id=$1 LIMIT 1",
    booking_id,
)
```

---

## Transaction DB

```python
# booking_routes.py:708-723
async with conn.transaction():
    # Mise à jour booking
    await conn.execute(
        "UPDATE bookings SET status='refused', updated_at=NOW() WHERE booking_id=$1",
        booking_id,
    )
    # Mise à jour payments (conditionnel)
    await conn.execute(
        """UPDATE payments SET status='cancelled', updated_at=NOW()
           WHERE booking_id=$1 AND status IN ('requires_authorization','authorized')""",
        booking_id,
    )
    # Libération slot (conditionnel)
    if bk["slot_id"]:
        await conn.execute(
            """UPDATE service_slots SET slot_status='available'
               WHERE slot_id=$1 AND slot_status='pending'""",
            bk["slot_id"],
        )
```

---

## Stripe (hors transaction)

```python
# booking_routes.py:725-732
if pi_row and pi_row["stripe_payment_intent_id"]:
    try:
        await stripe_service.cancel_payment_intent(pi_id, reason="refused")
    except Exception as exc:
        log.error(...)  # Erreur avalée — booking déjà refused en DB
```

**En Java v1 :** ce bloc peut être **stubbé** (no-op) ou désactivé via un feature flag. La logique DB doit être complète, l'appel Stripe est optionnel pour cette slice.

---

## Push notification (fire-and-forget)

```python
# booking_routes.py:735-745
_push(
    pool, bk["payer_user_id"],         # ← user_id (alias payer) lu en SELECT
    title="Réservation refusée",
    body="Votre demande de réservation n'a pas pu être acceptée.",
    data={"type": "booking_refused", "bookingId": booking_id, "action_text": "a refusé votre demande"},
    notif_type="booking_refused",
)
```

`_push()` est `asyncio.create_task(send_push_to_user(...))` — non bloquant.

**En Java v1 :** implémenter avec `@Async` ou ignorer si le système de push n'est pas encore en place.

---

## Réponses

### HTTP 200 — Succès nominal

```json
{
  "success": true,
  "status": "refused",
  "booking_id": "bk_abc123"
}
```

### HTTP 200 — Idempotence (déjà refused)

```json
{
  "success": true,
  "status": "refused",
  "idempotent": true
}
```

**Note :** la réponse idempotente n'inclut pas `"booking_id"`. Reproduire exactement.

### HTTP 401 — Token absent ou invalide

```json
{"detail": "Non authentifié"}
```

### HTTP 403 — Pas le receiver

```json
{"detail": "Seul le bénéficiaire peut refuser cette réservation"}
```

### HTTP 404 — Booking introuvable

```json
{"detail": "Réservation introuvable"}
```

### HTTP 409 — Statut invalide

```json
{"detail": "Impossible de refuser une réservation en état 'confirmed'"}
```

(Le message Python inclut l'état actuel entre quotes simples.)

---

## Effets de bord visibles

| Effet | Condition | Persistant |
|---|---|---|
| `bookings.status` → `'refused'` | Toujours (si nominal) | OUI |
| `bookings.updated_at` → NOW() | Toujours | OUI |
| `payments.status` → `'cancelled'` | Si payment existe ET status IN ('requires_authorization','authorized') | OUI |
| `service_slots.slot_status` → `'available'` | Si `slot_id` non null ET slot_status était `'pending'` | OUI |
| Stripe PI annulé | Si PI ID existe — peut échouer silencieusement | Externe |
| Push notification → payer | Toujours (fire-and-forget) | Externe |
