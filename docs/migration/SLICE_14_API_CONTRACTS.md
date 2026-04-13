# SLICE_14_API_CONTRACTS.md — Contrats API de la Slice 14
> Basé sur `booking_routes.py:984–1028`.
> Généré le 2026-02-XX.

---

## Vue d'ensemble

| # | Méthode Python | Chemin Python | Méthode Java | Chemin Java |
|---|---|---|---|---|
| 1 | PATCH | `/api/bookings/{booking_id}/status` | POST | `/api/bookings/{bookingId}/complete` |

> ℹ️ En Python, la logique `completed` est embarquée dans le dispatcher legacy `PATCH /status`.
> En Java, elle doit être exposée comme endpoint dédié `POST /bookings/{bookingId}/complete`,
> en accord avec l'architecture des Slices 12 (`/refuse`) et 13 (`/accept`).

---

## Endpoint 1 — Marquer une réservation comme terminée

### Définition

```
POST /api/bookings/{bookingId}/complete
```

### Authentification

| Propriété | Valeur |
|---|---|
| Méthode | Bearer token JWT |
| Claim extrait | `user_id` |
| Obligatoire | OUI — 401 si absent ou invalide |
| Restriction | Receiver (`receiver_user_id`) OU rôle `admin` |

### Paramètres

#### Path

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `bookingId` | string | OUI | Identifiant de la réservation |

#### Body

**Aucun body requis.** L'endpoint Python en entrée utilise `{"status": "completed"}` dans le body
du dispatcher, mais la version Java dédiée n'a pas besoin de body.

#### Query params

Aucun.

---

### Réponse succès

```
HTTP 200 OK
Content-Type: application/json
```

#### Python actuel

```json
{
  "success": true,
  "status": "completed"
}
```

#### Java recommandé

```json
{
  "success": true,
  "status": "completed",
  "booking_id": "bkg_abc123"
}
```

> ℹ️ Ajouter `booking_id` pour la cohérence avec `/refuse` et `/accept`.

---

### Codes d'erreur

| Code HTTP | Condition | Message Python |
|---|---|---|
| `401` | Token absent ou invalide | _(standard auth)_ |
| `403` | Ni receiver ni admin | `"Seul le bénéficiaire peut marquer comme terminé"` |
| `404` | `booking_id` inexistant | _(standard 404)_ |

> ⚠️ **Absence de 409** : Python ne lève PAS de 409 pour un statut courant invalide
> (ex: marking a `refused` booking as `completed`). Les UPDATEs s'exécutent sans erreur.
> Java doit reproduire ce comportement pour rester strictement compatible.

---

### Effets de bord

| Effet | Condition | Détail |
|---|---|---|
| `bookings.status` → `completed` | Toujours (si 200) | `updated_at = NOW()` mis à jour |
| `service_slots.slot_status` → `completed` | Si `slot_status = 'booked'` | Via sous-requête corrélée sur `booking_id` |
| `payments.status` → `captured` | Si `pay_status = 'authorized'` | DB uniquement — AUCUN appel Stripe |
| Push notification | **JAMAIS** | Absent du code Python — ne pas l'ajouter en Java |

---

### Exemples JSON

#### Requête nominale (receiver)

```
POST /api/bookings/bkg_abc123/complete
Authorization: Bearer eyJ...

(body vide)
```

#### Réponse succès

```json
{
  "success": true,
  "status": "completed",
  "booking_id": "bkg_abc123"
}
```

#### Réponse 403

```json
{
  "detail": "Seul le bénéficiaire peut marquer comme terminé"
}
```

#### Réponse 404

```json
{
  "detail": "Not found"
}
```

---

### Appel Python équivalent (pour tests de régression)

```bash
curl -X PATCH "$API_URL/api/bookings/bkg_abc123/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

---

## Comportement du dispatcher legacy Python

> ℹ️ Pour référence : le `PATCH /status` en Python est un dispatcher qui route selon la valeur de `status`.
> `completed` est l'une des 4 branches (`accepted`, `refused`, `cancelled`, `completed`).
> Les 3 premières sont déjà exposées comme endpoints dédiés en Python.
> `completed` est la seule sans endpoint dédié.

```python
# booking_routes.py:984–1028
@router.patch("/bookings/{booking_id}/status")
async def update_booking_status(booking_id: str, request: Request):
    body = await request.json()
    new_status = body.get("status")

    if new_status == "accepted":
        return await accept_booking(booking_id, request)          # → Slice 13
    elif new_status == "refused":
        return await refuse_booking(booking_id, request)          # → Slice 12
    elif new_status == "cancelled":
        return await cancel_booking(...)                           # → Future Slice
    elif new_status == "completed":
        # → LOGIQUE SLICE 14 (lignes 999–1026)
        ...
    else:
        raise HTTPException(400, f"Statut '{new_status}' invalide ou non supporté via cet endpoint")
```
