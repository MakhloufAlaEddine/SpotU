# SLICE_36_DB_MAPPING.md — Mapping DB Booking Reads (Audit)
> Basé sur `routes/booking_routes.py:1035–1110, 69–77`, `SLICE_11_DB_MAPPING.md`.
> Généré le 2026-04-25.

---

## ⚠️ Document de référence : `SLICE_11_DB_MAPPING.md`

Le mapping DB complet est dans S11. Cette doc S36 récapitule + identifie les évolutions DB introduites par S30/S33/S35 qui pourraient impacter les booking reads.

---

## Tables impliquées (4 — toutes lecture seule)

| Table | Rôle | Endpoints |
|---|---|---|
| `bookings` | Source principale (BOOKING_FIELDS 22 colonnes) | les 3 |
| `services` | LEFT JOIN — title, address, images, description | les 3 |
| `users` | LEFT JOIN x1 ou x2 — name + picture | `/me`, `/received`, `/{id}` |
| `service_slots` | LEFT JOIN — slot times | `/me`, `/{id}` (PAS `/received`) |

> Aucune écriture. Aucun lock. Pas de `@Transactional` write.

---

## BOOKING_FIELDS (22 colonnes) — référence canonique

```sql
b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
b.payment_status, b.payer_user_id, b.receiver_user_id,
b.pricing_snapshot, b.idempotency_key, b.currency,
b.created_at, b.updated_at, b.expires_at,
b.cancelled_by_user_id, b.cancellation_reason,
b.payment_mode
```

> **Identique à S11** (vérifié dans le code Python ligne 69–77 le 2026-04-25). Aucune nouvelle colonne ajoutée depuis S11.

---

## Évolutions DB depuis S11 (impact booking reads)

### Colonnes `bookings` mutées par les slices migrées

| Slice | Mutation `bookings` | Impact booking reads |
|---|---|---|
| **S30** (booking pay) | INSERT nouvelle row + UPDATE `expires_at`, `payment_status='unpaid'` | Lecture cohérente ✅ |
| **S31** (checkout status) | UPDATE `payment_status` best-effort post-redirect | Lecture cohérente ✅ |
| **S33** (webhook payment) | UPDATE `status='confirmed'`, `payment_status='paid'` | Lecture cohérente ✅ |
| **S35** (refund webhook) | **AUCUNE** modification de `bookings` (BR-35.12) | Pas d'impact ; `bookings.status` reste `confirmed` même après refund |

### Colonnes `payments` mutées par les slices migrées

| Slice | Mutation `payments` | Impact booking reads |
|---|---|---|
| **S33** | `status='captured'`, `stripe_charge_id` | **Aucun** (booking reads ne JOIN pas payments) |
| **S35** | `status='refunded'`, `refund_amount`, `refund_status` | **Aucun** ; le front doit appeler `/payments/{id}` (S34) pour les voir |

> ⚠️ **Confirmation critique** : booking reads **ne JOINent pas** `payments`. Le front doit faire 2 appels distincts pour avoir booking + payment refund info. **Ne pas "améliorer" en ajoutant un JOIN payments en Java**. Compat stricte.

---

## Permissions

### `/bookings/me`
**Filtrage WHERE SQL** (pas applicatif) :
```sql
WHERE b.user_id = $1
```

> ⚠️ Filtre uniquement sur `b.user_id`, **pas** `payer_user_id` (asymétrie vs `payments` S34 qui filtrait sur `payer OR receiver`).

### `/bookings/received`
```sql
WHERE b.receiver_user_id = $1
```

> ⚠️ Filtre uniquement sur `receiver_user_id`. Pas de `coach_id`. **Asymétrie** avec la permission `/{id}` (qui inclut `coach_id`).

### `/bookings/{booking_id}` — permissions 4-OR applicatives

```python
allowed = {d.user_id, d.payer_user_id, d.receiver_user_id, d.coach_id}
if uid not in allowed and user.role != "admin":
    raise HTTPException(403, "Accès refusé")
```

> ⚠️ Le set `{...}` Python peut contenir des `None` (si certains champs sont NULL). Python `None in {None, "x"}` = True, donc un user avec `user_id=None` matcherait — mais `require_auth` garantit que `user.user_id` est non-null. **OK.**

> Java :
> ```java
> Set<String> allowed = new HashSet<>();
> if (b.userId() != null)         allowed.add(b.userId());
> if (b.payerUserId() != null)    allowed.add(b.payerUserId());
> if (b.receiverUserId() != null) allowed.add(b.receiverUserId());
> if (b.coachId() != null)        allowed.add(b.coachId());
>
> if (!allowed.contains(uid) && !"admin".equals(user.role())) {
>     throw new ForbiddenException("Accès refusé");
> }
> ```
>
> ⚠️ Inclure les non-null seulement (sinon `Set.of()` Java throw NPE).

---

## Sérialisation (compat S34)

| Type Postgres | Type Java | Sérialisation Jackson |
|---|---|---|
| TEXT | `String` | string |
| NUMERIC (`amount`) | `BigDecimal` | number JSON (`WRITE_BIGDECIMAL_AS_PLAIN`) |
| TIMESTAMPTZ (`created_at`, `updated_at`, `expires_at`, `scheduled_at`) | `OffsetDateTime` | string ISO 8601 `+00:00` |
| DATE (`slot_date`) | `LocalDate` | string `YYYY-MM-DD` |
| TIME (`slot_start_time`, `slot_end_time`) | `LocalTime` | string `HH:MM:SS` |
| JSONB (`pricing_snapshot`) | `Map<String,Object>` ou `Object` | object (avec `_deserialize` conditionnel si TEXT) |
| TEXT[] / JSONB (`service_images`) | `List<String>` | array |

> ⚠️ Configuration Jackson identique à S34 (snake_case, `+00:00`, BigDecimal-as-plain). **Réutiliser le même `ObjectMapper`** côté Java.

---

## Index recommandés

```sql
-- /me
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, created_at DESC);

-- /received
CREATE INDEX IF NOT EXISTS idx_bookings_receiver ON bookings(receiver_user_id, created_at DESC);

-- /{id}
-- (PRIMARY KEY suffit)
```

> **À VALIDER** côté schéma existant (S11 le mentionnait). Aucune migration créée par S36.

---

## Concurrence avec écritures

| Scénario | Comportement attendu |
|---|---|
| Lecture booking en cours pendant webhook S33 commit `status='confirmed'` | MVCC PostgreSQL : snapshot isolation. Lecture voit l'état au début de la query. |
| Lecture booking en cours pendant cancel S41 (future) | Idem |
| Lecture booking pendant ExpiryWorker mute `status='expired'` | Idem |

> Pas de blocage, pas de désync. Comportement standard MVCC.

---

## Incertitudes / zones grises

| Zone | Question | Action |
|---|---|---|
| Type colonne `pricing_snapshot` | TEXT (string JSON) ou JSONB (parsed) ? | Tester `pg_typeof`. Si TEXT → désérialiser via `_deserialize`. |
| `service_images` type colonne | TEXT[], JSONB array, ou TEXT JSON ? | Vérifier le schéma. Si JSONB → asyncpg décode auto. Java : configurer Hibernate pour le bon type. |
| `slot_date`, `slot_start_time` peuvent être NULL si `slot_id=NULL` | LEFT JOIN service_slots → null | OK |
| `scheduled_at` vs `slot_date+slot_start_time` | Redondance ? | Pas notre problème : reproduire les 2 champs tels quels |
| Liens entre `coach_id` (legacy) et `receiver_user_id` (récent) | Migration en cours ? | COALESCE dans les JOINs gère. Reproduire identique. |
