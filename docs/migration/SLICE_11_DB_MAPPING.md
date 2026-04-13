# SLICE_11_DB_MAPPING.md — Mapping base de données
> Basé sur `booking_routes.py:69–100`, `001_initial_schema.sql:42–67`, `001_initial_schema.sql:316–331`.
> Généré le 2026-02-XX.

---

## Tables impliquées

| Table | Rôle | Endpoints |
|---|---|---|
| `bookings` | Table principale — 22 colonnes | Les 3 |
| `services` | Enrichissement titre + adresse + images + description | Les 3 (LEFT JOIN) |
| `users` (x2) | Enrichissement noms + photos payer et/ou receiver | /me (x1), /received (x1), /détail (x2) |
| `service_slots` | Enrichissement créneau (horaires, date, type) | /me, /détail (absent de /received) |

---

## Schéma de la table `bookings`

```sql
CREATE TABLE public.bookings (
    booking_id              text NOT NULL,                         -- PK
    service_id              text,                                  -- FK services
    user_id                 text,                                  -- = payer historique
    coach_id                text,                                  -- = receiver historique
    status                  text DEFAULT 'pending',
    scheduled_at            timestamp with time zone,
    notes                   text,
    amount                  numeric(10,2),
    created_at              timestamp with time zone DEFAULT now(),
    updated_at              timestamp with time zone DEFAULT now(),
    slot_id                 text,                                  -- FK service_slots (nullable)
    location_id             text,                                  -- FK service_locations (nullable)
    payer_user_id           text,                                  -- colonne explicite payer (post-migration)
    receiver_user_id        text,                                  -- colonne explicite receiver (post-migration)
    payment_status          text DEFAULT 'pending',
    payment_provider        text,                                  -- non exposé dans BOOKING_FIELDS
    payment_intent_id       text,                                  -- non exposé dans BOOKING_FIELDS
    pricing_snapshot        jsonb,                                 -- JSONB ou string legacy
    currency                text DEFAULT 'EUR',
    idempotency_key         text,
    expires_at              timestamp with time zone,
    cancelled_by_user_id    text,
    cancellation_reason     text,
    payment_mode            text DEFAULT 'pay_now'
);
-- PK : bookings_pkey (booking_id)
-- Index : idx_bookings_coach_id (coach_id)
-- Index : idx_bookings_service_id (service_id)
-- Index : idx_bookings_status (status) [partiels sur expires_at]
```

**Colonnes NON exposées dans BOOKING_FIELDS :**
- `payment_provider` — champ interne Stripe
- `payment_intent_id` — champ interne Stripe

---

## Valeurs de statuts

| Statut | Signification | Transitions depuis |
|---|---|---|
| `requested` | Demande créée (manual_approval) | initial |
| `awaiting_payment` | Accepté, en attente de paiement Stripe | `requested` → accept, ou `initial` si instant_booking |
| `accepted` | [état legacy ou spécifique] | — |
| `confirmed` | Paiement reçu ou pay_later validé | `awaiting_payment` |
| `refused` | Refusé par le coach | `requested` |
| `cancelled` | Annulé (par payer ou receiver) | tout état |
| `expired` | Expiré (worker expiry) | `requested`, `awaiting_payment` |
| `completed` | Prestation terminée | `confirmed` |
| `pending` | Défaut DB — jamais utilisé en pratique (legacy) | initial |

**Valeurs payment_mode :** `'pay_now'` \| `'pay_later'`

---

## Requêtes SQL par endpoint

### GET /bookings/me

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
    s.address,
    u_recv.name AS receiver_name,
    u_recv.picture AS receiver_picture,
    sl.start_time AS slot_start_time,
    sl.end_time AS slot_end_time,
    sl.slot_date,
    sl.slot_type
FROM bookings b
LEFT JOIN services s ON s.service_id = b.service_id
LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
LEFT JOIN service_slots sl ON sl.slot_id = b.slot_id
WHERE b.user_id = $1
ORDER BY b.created_at DESC
-- Pas de LIMIT
```

**Paramètre :** `$1` = `user["user_id"]` (courant)

**Mapping réponse :**
```
bookings.* → (voir BOOKING_FIELDS mapping tableau API_CONTRACTS)
services.title → "service_title"
services.address → "address"
users.name (u_recv) → "receiver_name"
users.picture (u_recv) → "receiver_picture"
service_slots.start_time → "slot_start_time"
service_slots.end_time → "slot_end_time"
service_slots.slot_date → "slot_date"   ← TEXT, pas de conversion
service_slots.slot_type → "slot_type"
```

---

### GET /bookings/received

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
-- Pas de LIMIT
```

**Paramètre :** `$1` = `user["user_id"]` (courant comme receiver)

**Note :** `u_pay` joint sur `b.payer_user_id` directement — **pas de COALESCE** ici (contrairement à /me et /détail pour le receiver).

**Champs absents de la réponse (vs /me) :**
- `address` — non sélectionné
- `receiver_name` / `receiver_picture` — pas de JOIN user receiver
- `slot_*` — pas de JOIN service_slots
- `payer_picture` — non sélectionné (seulement `payer_name`)

---

### GET /bookings/{booking_id}

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
    s.address,
    s.images AS service_images,
    s.description AS service_description,
    u_recv.name AS receiver_name,
    u_recv.picture AS receiver_picture,
    u_pay.name AS payer_name,
    u_pay.picture AS payer_picture,
    sl.start_time AS slot_start_time,
    sl.end_time AS slot_end_time,
    sl.slot_date,
    sl.slot_type
FROM bookings b
LEFT JOIN services s ON s.service_id = b.service_id
LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
LEFT JOIN users u_pay ON u_pay.user_id = COALESCE(b.payer_user_id, b.user_id)
LEFT JOIN service_slots sl ON sl.slot_id = b.slot_id
WHERE b.booking_id = $1
```

**Paramètre :** `$1` = `booking_id` (path param)

**Note COALESCE double :**
- `u_recv` : `COALESCE(b.receiver_user_id, b.coach_id)` → fallback sur `coach_id` si `receiver_user_id` null
- `u_pay` : `COALESCE(b.payer_user_id, b.user_id)` → fallback sur `user_id` si `payer_user_id` null

---

## `pricing_snapshot` — gestion JSONB/string legacy

```python
# booking_routes.py:80-87
def _deserialize(d: dict) -> dict:
    """Désérialise pricing_snapshot si c'est une chaîne JSON."""
    if d and isinstance(d.get("pricing_snapshot"), str):
        try:
            d["pricing_snapshot"] = json.loads(d["pricing_snapshot"])
        except Exception:
            pass
    return d
```

**Comportement :**
- Si `pricing_snapshot` est déjà un dict (JSONB natif PostgreSQL → asyncpg) → retourné tel quel
- Si `pricing_snapshot` est une string (anciens bookings) → `json.loads()` appliqué
- Si parsing échoue → string originale conservée (sans lever d'exception)
- Si `pricing_snapshot` est null → null retourné

**En Java (Jackson) :**
```java
// Dans BookingRowMapper ou le service
Object raw = rs.getObject("pricing_snapshot");
if (raw instanceof String s) {
    try {
        dto.setPricingSnapshot(objectMapper.readTree(s));  // JsonNode
    } catch (JsonProcessingException e) {
        dto.setPricingSnapshot(objectMapper.valueToTree(s));  // fallback: string dans JsonNode
    }
} else if (raw != null) {
    // asyncpg/JDBC retourne directement une Map ou PGobject
    dto.setPricingSnapshot(objectMapper.valueToTree(raw));
}
```

---

## Mapping synthétique colonnes → réponse (tableau)

| Colonne DB | Alias réponse | Présent /me | Présent /received | Présent /détail |
|---|---|---|---|---|
| BOOKING_FIELDS x22 | identique | ✅ | ✅ | ✅ |
| `services.title` | `service_title` | ✅ | ✅ | ✅ |
| `services.address` | `address` | ✅ | ❌ | ✅ |
| `services.images` | `service_images` | ❌ | ❌ | ✅ |
| `services.description` | `service_description` | ❌ | ❌ | ✅ |
| `users.name` (receiver) | `receiver_name` | ✅ | ❌ | ✅ |
| `users.picture` (receiver) | `receiver_picture` | ✅ | ❌ | ✅ |
| `users.name` (payer) | `payer_name` | ❌ | ✅ | ✅ |
| `users.picture` (payer) | `payer_picture` | ❌ | ❌ | ✅ |
| `service_slots.start_time` | `slot_start_time` | ✅ | ❌ | ✅ |
| `service_slots.end_time` | `slot_end_time` | ✅ | ❌ | ✅ |
| `service_slots.slot_date` | `slot_date` | ✅ | ❌ | ✅ |
| `service_slots.slot_type` | `slot_type` | ✅ | ❌ | ✅ |

---

## Tris et limites

| Endpoint | Tri | LIMIT |
|---|---|---|
| GET /bookings/me | `b.created_at DESC` | **Aucune** |
| GET /bookings/received | `b.created_at DESC` | **Aucune** |
| GET /bookings/{id} | N/A (unique) | N/A |
