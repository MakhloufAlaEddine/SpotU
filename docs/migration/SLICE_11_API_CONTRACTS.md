# SLICE_11_API_CONTRACTS.md — Contrats d'API exacts
> Basé sur `booking_routes.py:1035–1110`, `BOOKING_FIELDS:69–77`.
> Généré le 2026-02-XX.

---

## Projection partagée — BOOKING_FIELDS

Utilisée par les 3 endpoints. Source : `booking_routes.py:69–77`.

```python
BOOKING_FIELDS = """
    b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
    b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
    b.payment_status, b.payer_user_id, b.receiver_user_id,
    b.pricing_snapshot, b.idempotency_key, b.currency,
    b.created_at, b.updated_at, b.expires_at,
    b.cancelled_by_user_id, b.cancellation_reason,
    b.payment_mode
"""
```

**22 champs** de la table `bookings`.

---

## ENDPOINT 1 — GET /api/bookings/me

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin principal | `/api/bookings/me` |
| Alias Python | `/api/users/me/bookings` (les deux actifs en prod) |
| Auth | **STRICTE** — `require_auth` — 401 si token absent ou invalide |
| Pagination | **NON** — liste complète, pas de LIMIT |
| Tri | `ORDER BY b.created_at DESC` (plus récent en premier) |
| Handler | `my_bookings()` — `booking_routes.py:1037` |

### Paramètres

Aucun query param, aucun path param.

### Logique de filtrage

```python
# booking_routes.py:1052
WHERE b.user_id = $1   # ← user_id du token courant (rôle payer)
```

Retourne uniquement les bookings où l'utilisateur est le **payer** (`b.user_id`).

### SQL exact

```sql
SELECT
    b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
    b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
    b.payment_status, b.payer_user_id, b.receiver_user_id,
    b.pricing_snapshot, b.idempotency_key, b.currency,
    b.created_at, b.updated_at, b.expires_at,
    b.cancelled_by_user_id, b.cancellation_reason,
    b.payment_mode,
    s.title AS service_title, s.address,
    u_recv.name AS receiver_name, u_recv.picture AS receiver_picture,
    sl.start_time AS slot_start_time, sl.end_time AS slot_end_time,
    sl.slot_date, sl.slot_type
FROM bookings b
LEFT JOIN services s ON s.service_id = b.service_id
LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
LEFT JOIN service_slots sl ON sl.slot_id = b.slot_id
WHERE b.user_id = $1
ORDER BY b.created_at DESC
```

### Structure réponse — HTTP 200

```json
[
  {
    "booking_id": "bk_abc123",
    "service_id": "svc_xyz",
    "user_id": "usr_me",
    "coach_id": "usr_coach",
    "status": "confirmed",
    "scheduled_at": "2026-03-15T10:00:00+00:00",
    "slot_id": "slot_001",
    "location_id": "loc_001",
    "notes": "Je suis débutant",
    "amount": 60.00,
    "payment_status": "paid",
    "payer_user_id": "usr_me",
    "receiver_user_id": "usr_coach",
    "pricing_snapshot": {
      "base_price": 60.0,
      "commission_rate": 0.1,
      "total": 66.0
    },
    "idempotency_key": "idem_abc123",
    "currency": "EUR",
    "created_at": "2026-03-10T08:00:00+00:00",
    "updated_at": "2026-03-10T09:00:00+00:00",
    "expires_at": null,
    "cancelled_by_user_id": null,
    "cancellation_reason": null,
    "payment_mode": "pay_now",
    "service_title": "Yoga Hatha débutant",
    "address": "12 rue de la Paix, Paris",
    "receiver_name": "Marie Coach",
    "receiver_picture": "https://cdn.spotu.app/p/marie.jpg",
    "slot_start_time": "10:00",
    "slot_end_time": "11:00",
    "slot_date": "2026-03-15",
    "slot_type": "specific"
  }
]
```

### Champs retournés (tous)

| Champ | Source | Type | Nullable |
|---|---|---|---|
| `booking_id` | `bookings.booking_id` | string | NON |
| `service_id` | `bookings.service_id` | string | OUI |
| `user_id` | `bookings.user_id` | string | OUI |
| `coach_id` | `bookings.coach_id` | string | OUI |
| `status` | `bookings.status` | string | OUI |
| `scheduled_at` | `bookings.scheduled_at` | string ISO\|null | OUI |
| `slot_id` | `bookings.slot_id` | string\|null | OUI |
| `location_id` | `bookings.location_id` | string\|null | OUI |
| `notes` | `bookings.notes` | string\|null | OUI |
| `amount` | `bookings.amount` | number | OUI |
| `payment_status` | `bookings.payment_status` | string | OUI |
| `payer_user_id` | `bookings.payer_user_id` | string\|null | OUI |
| `receiver_user_id` | `bookings.receiver_user_id` | string\|null | OUI |
| `pricing_snapshot` | `bookings.pricing_snapshot` | object\|null | OUI |
| `idempotency_key` | `bookings.idempotency_key` | string\|null | OUI |
| `currency` | `bookings.currency` | string | OUI (défaut `EUR`) |
| `created_at` | `bookings.created_at` | string ISO | OUI |
| `updated_at` | `bookings.updated_at` | string ISO | OUI |
| `expires_at` | `bookings.expires_at` | string ISO\|null | OUI |
| `cancelled_by_user_id` | `bookings.cancelled_by_user_id` | string\|null | OUI |
| `cancellation_reason` | `bookings.cancellation_reason` | string\|null | OUI |
| `payment_mode` | `bookings.payment_mode` | string | OUI (défaut `pay_now`) |
| `service_title` | `services.title` | string\|null | OUI (si service supprimé) |
| `address` | `services.address` | string\|null | OUI |
| `receiver_name` | `users.name` (COALESCE receiver\|coach) | string\|null | OUI |
| `receiver_picture` | `users.picture` (COALESCE receiver\|coach) | string\|null | OUI |
| `slot_start_time` | `service_slots.start_time` | string\|null | OUI (si slot null) |
| `slot_end_time` | `service_slots.end_time` | string\|null | OUI (si slot null) |
| `slot_date` | `service_slots.slot_date` | string\|null (TEXT) | OUI |
| `slot_type` | `service_slots.slot_type` | string\|null | OUI |

### Codes d'erreur

| Code | Condition |
|---|---|
| 200 | Toujours — `[]` si aucun booking |
| 401 | Token absent, invalide, ou user désactivé |
| 500/503 | Erreur DB |

---

## ENDPOINT 2 — GET /api/bookings/received

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin principal | `/api/bookings/received` |
| Alias Python | `/api/receiver/requests` (les deux actifs en prod) |
| Auth | **STRICTE** — `require_auth` — 401 si absent/invalide |
| Pagination | **NON** |
| Tri | `ORDER BY b.created_at DESC` |
| Handler | `received_bookings()` — `booking_routes.py:1061` |

### Logique de filtrage

```python
# booking_routes.py:1073
WHERE b.receiver_user_id = $1   # ← user_id du token courant (rôle receiver/coach)
```

Retourne uniquement les bookings où l'utilisateur est le **bénéficiaire** (`b.receiver_user_id`).

### SQL exact

```sql
SELECT
    b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
    b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
    b.payment_status, b.payer_user_id, b.receiver_user_id,
    b.pricing_snapshot, b.idempotency_key, b.currency,
    b.created_at, b.updated_at, b.expires_at,
    b.cancelled_by_user_id, b.cancellation_reason,
    b.payment_mode,
    s.title AS service_title,
    u_pay.name AS payer_name
FROM bookings b
LEFT JOIN services s ON s.service_id = b.service_id
LEFT JOIN users u_pay ON u_pay.user_id = b.payer_user_id
WHERE b.receiver_user_id = $1
ORDER BY b.created_at DESC
```

**Différences vs `/bookings/me` :**
- Filtre sur `receiver_user_id` (pas `user_id`)
- Enrichissements : `payer_name` uniquement (pas `payer_picture`, `receiver_name`, `receiver_picture`)
- Pas de JOIN `service_slots` → pas de `slot_start_time`, `slot_end_time`, `slot_date`, `slot_type`
- JOIN `users` sur `b.payer_user_id` directement (pas de COALESCE)

### Champs retournés (par rapport à /me)

| Champ | Présent dans /received ? | Différence |
|---|---|---|
| Tous les 22 champs BOOKING_FIELDS | ✅ Identiques | — |
| `service_title` | ✅ | Identique |
| `address` | ❌ | **ABSENT** dans /received |
| `receiver_name` | ❌ | **ABSENT** |
| `receiver_picture` | ❌ | **ABSENT** |
| `payer_name` | ✅ | **PRÉSENT** (absent dans /me) |
| `payer_picture` | ❌ | **ABSENT** (présent uniquement dans /détail) |
| `slot_start_time` | ❌ | **ABSENT** |
| `slot_end_time` | ❌ | **ABSENT** |
| `slot_date` | ❌ | **ABSENT** |
| `slot_type` | ❌ | **ABSENT** |

### Codes d'erreur

| Code | Condition |
|---|---|
| 200 | Toujours — `[]` si aucun booking reçu |
| 401 | Token absent, invalide, ou user désactivé |

---

## ENDPOINT 3 — GET /api/bookings/{booking_id}

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin Python | `/api/bookings/{booking_id}` |
| Chemin Java | `/api/bookings/{bookingId}` |
| Alias | Aucun |
| Auth | **STRICTE** — `require_auth` |
| Pagination | N/A (objet unique) |
| Handler | `get_booking_detail()` — `booking_routes.py:1081` |

### Logique de contrôle d'accès (critique)

```python
# booking_routes.py:1107-1109
allowed = {d.get("user_id"), d.get("payer_user_id"), d.get("receiver_user_id"), d.get("coach_id")}
if uid not in allowed and user.get("role") != "admin":
    raise HTTPException(403, "Accès refusé")
```

Un utilisateur peut voir le détail si son `user_id` est dans **l'un des 4 champs** : `user_id`, `payer_user_id`, `receiver_user_id`, `coach_id`.  
Un `admin` voit tous les bookings.

### SQL exact

```sql
SELECT
    b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
    b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
    b.payment_status, b.payer_user_id, b.receiver_user_id,
    b.pricing_snapshot, b.idempotency_key, b.currency,
    b.created_at, b.updated_at, b.expires_at,
    b.cancelled_by_user_id, b.cancellation_reason,
    b.payment_mode,
    s.title AS service_title, s.address,
    s.images AS service_images,
    s.description AS service_description,
    u_recv.name AS receiver_name, u_recv.picture AS receiver_picture,
    u_pay.name AS payer_name, u_pay.picture AS payer_picture,
    sl.start_time AS slot_start_time, sl.end_time AS slot_end_time,
    sl.slot_date, sl.slot_type
FROM bookings b
LEFT JOIN services s ON s.service_id = b.service_id
LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
LEFT JOIN users u_pay ON u_pay.user_id = COALESCE(b.payer_user_id, b.user_id)
LEFT JOIN service_slots sl ON sl.slot_id = b.slot_id
WHERE b.booking_id = $1
```

**Champs supplémentaires vs /me :**
- `service_images` (JSONB)
- `service_description`
- `payer_name`, `payer_picture`
- COALESCE sur payer : `COALESCE(b.payer_user_id, b.user_id)` (absent dans /received)

### Réponse — HTTP 200

Identique à /me pour les 22 + 8 champs communs, avec en plus :

| Champ | Source | Nullable |
|---|---|---|
| `service_images` | `services.images` (JSONB array) | OUI |
| `service_description` | `services.description` | OUI |
| `payer_name` | `users.name` (COALESCE payer\|user) | OUI |
| `payer_picture` | `users.picture` (COALESCE payer\|user) | OUI |

### Codes d'erreur

| Code | Condition |
|---|---|
| 200 | Booking trouvé et accès autorisé |
| 401 | Token absent, invalide, ou user désactivé |
| 403 | `{"detail": "Accès refusé"}` — user non membre du booking et non admin |
| 404 | `{"detail": "Réservation introuvable"}` — booking_id inexistant |
