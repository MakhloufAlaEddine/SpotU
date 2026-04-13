# SLICE_15_API_CONTRACTS.md — Contrats API de la Slice 15
> Basé sur `booking_routes.py:754–977`, `models.py:337–339`.
> Généré le 2026-02-XX.

---

## Endpoint — Annuler une réservation

```
POST /api/bookings/{bookingId}/cancel
```

### Authentification

| Propriété | Valeur |
|---|---|
| Méthode | Bearer token JWT |
| Claim extrait | `user_id` |
| Obligatoire | OUI — 401 si absent ou invalide |
| Acteurs autorisés | Payer, Receiver (selon état), Admin |

---

### Paramètres

#### Path

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `bookingId` | string | OUI | Identifiant de la réservation |

#### Body (optionnel)

```json
{
  "reason": "string | null"
}
```

Le body est **entièrement optionnel**. Si absent (`null` ou body vide), `cancellation_reason` est enregistré comme `NULL` en DB.

```python
# models.py:337–339
class CancelRequest(BaseModel):
    reason: Optional[str] = None
```

#### Query params

Aucun.

---

### Réponse succès

```
HTTP 200 OK
Content-Type: application/json
```

```json
{
  "success": true,
  "status": "cancelled",
  "booking_id": "bkg_abc123",
  "payment_status": "cancelled",
  "cancelled_by": "usr_xyz789",
  "stripe_action": "pi_cancelled"
}
```

#### Champs de réponse

| Champ | Type | Description |
|---|---|---|
| `success` | boolean | Toujours `true` si HTTP 200 |
| `status` | string | Toujours `"cancelled"` |
| `booking_id` | string | ID de la réservation |
| `payment_status` | string | Nouveau statut payment : `"cancelled"`, `"refunded"`, ou valeur précédente si inchangée |
| `cancelled_by` | string | `user_id` de l'appelant |
| `stripe_action` | string\|null | `"pi_cancelled"`, `"refund_created"`, ou `null` si aucune action Stripe |

---

### Réponse idempotente (déjà annulé)

```
HTTP 200 OK
```

```json
{
  "success": true,
  "status": "cancelled",
  "idempotent": true
}
```

> ℹ️ Si le booking est **déjà** `cancelled`, retour immédiat sans ré-exécution des UPDATEs.
> Aucun champ `payment_status`, `cancelled_by` ou `stripe_action` dans cette réponse.

---

### Codes d'erreur

| Code HTTP | Condition | Message Python |
|---|---|---|
| `401` | Token absent ou invalide | _(standard auth)_ |
| `403` | Ni payer ni receiver ni admin | `"Vous n'êtes pas autorisé à annuler cette réservation"` |
| `403 via 409` | Receiver tente d'annuler `requested` | `"Le bénéficiaire peut annuler uniquement une réservation acceptée (état actuel : '...'). Pour refuser une demande en attente, utilisez /refuse."` — HTTP **409** |
| `404` | `booking_id` inexistant | _(standard 404)_ |
| `409` | Statut non annulable (`completed`, `refused`, `expired`) | `"Impossible d'annuler une réservation en état '...'"` |

> ⚠️ **Le message pour receiver sur état invalide est un HTTP 409, pas 403.**
> Même si c'est sémantiquement un problème d'état, Python lève `HTTPException(409, ...)` dans ce cas.

---

### Effets de bord

| Effet | Condition | Détail |
|---|---|---|
| `bookings.status` → `"cancelled"` | Toujours (si 200 non idempotent) | + `cancelled_by_user_id`, `cancellation_reason`, `updated_at` |
| `payments.status` → `"cancelled"` | Si `pay_status IN (requires_authorization, authorized, capture_pending)` | DB + Stripe PI cancel |
| `payments.status` → `"refunded"` | Si `pay_status = "captured"` | DB + Stripe create_refund (si charge_id présent) |
| `payments.status` inchangé | Si `pay_status` autre (pending, failed, null) | Pas de modification payment |
| `service_slots.slot_status` → `"available"` | Si `slot_id` non NULL ET `slot_status IN (pending, reserved, booked)` | Libération du créneau |
| Push → receiver | Si payer annule | Titre : "Réservation annulée par le client" |
| Push → payer | Si receiver annule | Titre : "Réservation annulée par le prestataire" (+ refund suffix si applicable) |
| Push → payer ET receiver | Si admin annule | Deux notifications distinctes |
| `stripe_service.cancel_payment_intent()` | Si PI cancel path | Hors transaction, try/except |
| `stripe_service.create_refund()` | Si refund path ET `charge_id` présent | Hors transaction, try/except |

---

### Exemples JSON

#### Requête nominale — payer annule avec raison

```
POST /api/bookings/bkg_abc123/cancel
Authorization: Bearer <payer_token>
Content-Type: application/json

{
  "reason": "Imprévu professionnel"
}
```

#### Réponse — paiement pas encore capturé (PI cancel)

```json
{
  "success": true,
  "status": "cancelled",
  "booking_id": "bkg_abc123",
  "payment_status": "cancelled",
  "cancelled_by": "usr_payer001",
  "stripe_action": "pi_cancelled"
}
```

#### Réponse — paiement capturé (refund)

```json
{
  "success": true,
  "status": "cancelled",
  "booking_id": "bkg_abc123",
  "payment_status": "refunded",
  "cancelled_by": "usr_payer001",
  "stripe_action": "refund_created"
}
```

#### Réponse — pas de Stripe (payment en pending/failed)

```json
{
  "success": true,
  "status": "cancelled",
  "booking_id": "bkg_abc123",
  "payment_status": "pending",
  "cancelled_by": "usr_payer001",
  "stripe_action": null
}
```

#### Réponse 409 — receiver tente d'annuler un booking `requested`

```json
{
  "detail": "Le bénéficiaire peut annuler uniquement une réservation acceptée (état actuel : 'requested'). Pour refuser une demande en attente, utilisez /refuse."
}
```

---

### Appel Python équivalent (pour tests de régression)

```bash
curl -X POST "$API_URL/api/bookings/bkg_abc123/cancel" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Imprévu"}'

# Sans body
curl -X POST "$API_URL/api/bookings/bkg_abc123/cancel" \
  -H "Authorization: Bearer $TOKEN"
```
