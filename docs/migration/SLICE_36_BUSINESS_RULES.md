# SLICE_36_BUSINESS_RULES.md — Règles métier Booking Reads (Audit + Régression)
> Basé sur `routes/booking_routes.py:1035–1110`, `SLICE_11_BUSINESS_RULES.md`.
> Généré le 2026-04-25.

---

## ⚠️ Document de référence : `SLICE_11_BUSINESS_RULES.md`

Toutes les règles métier détaillées sont dans S11. Cette doc S36 récapitule les règles **à revérifier** suite à la migration de S30/S31/S33/S35.

---

## BR-36.01 — Auth obligatoire (compat S11/S34)

Identique à BR-34.01. Pattern `require_auth` dual Bearer/cookie. Aucune divergence depuis S11.

---

## BR-36.02 — `/bookings/me` filtre user_id (asymétrie vs payments)

```sql
WHERE b.user_id = $1
```

> ⚠️ **Différent de `/payments/me`** qui filtre sur `payer_user_id OR receiver_user_id`.
> Booking : seulement `b.user_id` (le créateur de la demande).
> Le receiver utilise `/bookings/received`.

### Java
```java
@Query(value = "... WHERE b.user_id = :uid ORDER BY b.created_at DESC", nativeQuery = true)
List<BookingMeRow> findByUserId(@Param("uid") String uid);
```

---

## BR-36.03 — `/bookings/received` filtre receiver_user_id (pas coach_id)

```sql
WHERE b.receiver_user_id = $1
```

> ⚠️ **Asymétrie volontaire** : pas de `OR coach_id = $1`. Si un coach a uniquement `coach_id` (legacy) sans `receiver_user_id`, il **ne verra pas** ce booking via `/received`. Compat stricte.

---

## BR-36.04 — `/bookings/{id}` permissions 4-OR + admin

```python
allowed = {d.user_id, d.payer_user_id, d.receiver_user_id, d.coach_id}
if uid not in allowed and user.role != "admin":
    raise HTTPException(403, "Accès refusé")
```

| User est… | Accès |
|---|---|
| `user_id` (créateur de la demande) | 200 |
| `payer_user_id` | 200 |
| `receiver_user_id` | 200 |
| `coach_id` (legacy) | 200 |
| Admin (autre) | 200 |
| Aucun de ces rôles | 403 |

> ⚠️ **4 champs**, pas 3 (vs S34 payments qui était 3-OR). **Ne pas oublier `coach_id` ni `user_id`** lors du port Java.

### Java
```java
Set<String> allowed = new HashSet<>();
if (b.userId() != null)         allowed.add(b.userId());
if (b.payerUserId() != null)    allowed.add(b.payerUserId());
if (b.receiverUserId() != null) allowed.add(b.receiverUserId());
if (b.coachId() != null)        allowed.add(b.coachId());

if (!allowed.contains(user.userId()) && !"admin".equals(user.role())) {
    throw new ForbiddenException("Accès refusé");
}
```

---

## BR-36.05 — Ordre des erreurs : 401 → 404 → 403 (compat S34)

`require_auth` (401) → SELECT booking (404 si null) → permissions (403). Identique S34/BR-34.04.

---

## BR-36.06 — Aliases routing dual

| Path principal | Alias |
|---|---|
| `/bookings/me` | `/users/me/bookings` |
| `/bookings/received` | `/receiver/requests` |
| `/bookings/{id}` | (aucun) |

### Java
```java
@GetMapping({"/api/bookings/me", "/api/users/me/bookings"})
public List<BookingMeDto> myBookings(...) { ... }

@GetMapping({"/api/bookings/received", "/api/receiver/requests"})
public List<BookingReceivedDto> receivedBookings(...) { ... }
```

> ⚠️ **2 paths sur la même méthode**. Tester les 2 dans CI.

---

## BR-36.07 — Projection asymétrique entre les 3 endpoints

| Champ | `/me` | `/received` | `/{id}` |
|---|---|---|---|
| BOOKING_FIELDS (22 cols) | ✅ | ✅ | ✅ |
| `service_title` | ✅ | ✅ | ✅ |
| `address` | ✅ | ❌ | ✅ |
| `service_images` | ❌ | ❌ | ✅ |
| `service_description` | ❌ | ❌ | ✅ |
| `receiver_name` | ✅ | ❌ | ✅ |
| `receiver_picture` | ✅ | ❌ | ✅ |
| `payer_name` | ❌ | ✅ | ✅ |
| `payer_picture` | ❌ | ❌ | ✅ |
| `slot_*` | ✅ | ❌ | ✅ |

> ⚠️ **3 DTOs distincts** côté Java. Ne pas uniformiser. Le front consomme des projections adaptées par écran.

---

## BR-36.08 — `_deserialize(pricing_snapshot)` conditionnel (compat S34/BR-34.08)

```python
if d and isinstance(d.get("pricing_snapshot"), str):
    try:
        d["pricing_snapshot"] = json.loads(d["pricing_snapshot"])
    except Exception:
        pass
```

> ⚠️ Note : exception silencieuse (`except Exception: pass`). Si le JSON est mal formé, on garde la string. **Reproduire ce comportement** (pas de raise).

### Java
```java
Object snap = d.get("pricing_snapshot");
if (snap instanceof String s && !s.isEmpty()) {
    try {
        d.put("pricing_snapshot", objectMapper.readValue(s, Object.class));
    } catch (IOException ignored) {
        // garde la string si parse échoue
    }
}
```

---

## BR-36.09 — COALESCE dans JOINs users (legacy compat)

```sql
LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
LEFT JOIN users u_pay  ON u_pay.user_id  = COALESCE(b.payer_user_id, b.user_id)
```

### Justification
Migration historique : avant, on stockait `coach_id` et `user_id`. Maintenant `receiver_user_id` et `payer_user_id`. Le COALESCE permet la **rétro-compat** sur les anciennes rows.

> ⚠️ **Reproduire le COALESCE en Java native query**. Ne pas réécrire en Hibernate JPQL (plus difficile et risque de dégrader). Native query = sûr.

---

## BR-36.10 — Pas de JOIN sur `payments`

### Règle implicite

Aucun JOIN sur `payments` dans les 3 endpoints. Donc `refund_amount`, `refund_status`, `stripe_charge_id`, etc. (S33-S35) **ne sont pas remontés** via booking reads.

### Front
Le front doit faire **2 appels** :
1. `GET /api/bookings/{id}` → status, payment_status, etc.
2. `GET /api/payments/{id}` (si besoin) → refund_amount, etc.

> ⚠️ **Ne pas optimiser** en ajoutant un JOIN payments en Java. Compat stricte = même comportement Python.

---

## BR-36.11 — Interaction avec slices migrées

| Slice | Interaction avec booking reads | Validation S36 |
|---|---|---|
| **S30** (booking pay) | Crée `bookings` row visible immédiatement via `/me` | R1 |
| **S31** (checkout status) | UPDATE `payment_status` après redirect — visible via `/me` | R1 (cohérence MVCC) |
| **S33** (webhook payment) | UPDATE `status='confirmed'`, `payment_status='paid'` — visible | R1 (booking transition) |
| **S34** (payment reads) | Pattern auth + permissions identique | Aucun impact direct |
| **S35** (refund webhook) | Aucun UPDATE bookings (BR-35.12) — `bookings.status` reste `confirmed` même après refund | R3 (asymétrie volontaire) |

### Régression critique post-S35
Si un payment est refundé :
- `payments.status='refunded'` ✅ (visible via `/payments/{id}`)
- `bookings.status='confirmed'` (inchangé)
- `bookings.payment_status='paid'` (inchangé !)

> ⚠️ **Le front voit un booking "confirmé + payé" même si le payment associé est refundé**. C'est **volontaire** côté Python : la suppression/cancel du booking est une action **séparée** du refund. Le support client doit traiter manuellement si besoin.

---

## BR-36.12 — Asymétries à préserver

| Aspect | Comportement Python | Java doit reproduire |
|---|---|---|
| `/me` filtre `user_id`, pas payer/receiver | OUI | ✅ |
| `/received` filtre `receiver_user_id`, pas coach_id | OUI | ✅ |
| `/{id}` permissions **4-OR** (vs S34 3-OR) | OUI | ✅ ne pas oublier `coach_id` ni `user_id` |
| Aliases dual | OUI | ✅ |
| 3 projections distinctes (asymétriques) | OUI | ✅ ne pas uniformiser |
| COALESCE legacy `receiver_user_id|coach_id` et `payer_user_id|user_id` | OUI | ✅ native query |
| Pas de JOIN payments | OUI | ✅ |
| `pricing_snapshot` désérialisation conditionnelle silencieuse | OUI | ✅ try/catch silent |
| 404 avant 403 sur `/{id}` | OUI | ✅ |
| Liste vide = `[]` | OUI | ✅ |
| Datetime `+00:00` (pas `Z`) | OUI | ✅ |

---

## BR-36.13 — Limitations connues (à NE PAS corriger)

| Limitation | Reproduire ? |
|---|---|
| Booking refundé reste `confirmed/paid` côté `bookings` | OUI |
| Pas de pagination | OUI |
| Pas de filtre par `status` | OUI |
| `_deserialize` exception silencieuse | OUI |
| `service_images` peut être lourd (PHP-style array) sans compression | OUI |
| Asymétrie `/me` user_id vs `/received` receiver_user_id (pas symétrique) | OUI |
| Aucune notification quand booking est refundé | OUI (asymétrie S35) |
