# SLICE_36_API_CONTRACTS.md — Contrats API Booking Reads (Audit + Régression)
> Basé sur `routes/booking_routes.py:1035–1110`, `SLICE_11_API_CONTRACTS.md` (référence canonique).
> Généré le 2026-04-25.

---

## ⚠️ Document de référence : `SLICE_11_API_CONTRACTS.md`

S36 **ne redéfinit pas** les contrats API. Tous les détails (méthode, path, auth, params, body, headers, format de réponse) sont dans `SLICE_11_API_CONTRACTS.md`. **Cette doc S36 ne contient que les delta/régressions à valider depuis S11.**

---

## Récapitulatif des 3 endpoints (référence S11)

| # | Méthode | Path | Alias | Auth | Réponse |
|---|---|---|---|---|---|
| 1 | GET | `/api/bookings/me` | `/api/users/me/bookings` | JWT (`require_auth`) | `List[Booking]` ordre `created_at DESC` |
| 2 | GET | `/api/bookings/received` | `/api/receiver/requests` | JWT | `List[Booking]` ordre `created_at DESC` |
| 3 | GET | `/api/bookings/{booking_id}` | (aucun) | JWT + permissions 4-OR | `Booking` (404 si absent, 403 si pas autorisé) |

### Codes statut (compat S11)

| Code | Cas | Endpoints |
|---|---|---|
| 200 | Succès (liste ou objet) | tous |
| 401 | Token absent / invalide / user supprimé | tous |
| 403 | User n'est pas dans `{user_id, payer_user_id, receiver_user_id, coach_id}` ET n'est pas admin | only `/{id}` |
| 404 | `booking_id` introuvable | only `/{id}` |

> ⚠️ Ordre **404 avant 403** (idem S34/BR-34.04). Reproduire à l'identique.

---

## Champs JOINs par endpoint (référence S11)

### `GET /bookings/me` — JOINs

```sql
LEFT JOIN services s ON s.service_id = b.service_id
LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
LEFT JOIN service_slots sl ON sl.slot_id = b.slot_id
```

**Champs additionnels** retournés en plus de `BOOKING_FIELDS` (22 colonnes) :
- `service_title`, `address` (services)
- `receiver_name`, `receiver_picture` (users via COALESCE receiver/coach)
- `slot_start_time`, `slot_end_time`, `slot_date`, `slot_type` (service_slots)

### `GET /bookings/received` — JOINs

```sql
LEFT JOIN services s ON s.service_id = b.service_id
LEFT JOIN users u_pay ON u_pay.user_id = b.payer_user_id
```

**Champs additionnels** :
- `service_title` (services — **PAS** d'`address` ici, asymétrie volontaire S11)
- `payer_name` (users) — **PAS** de `payer_picture`
- **PAS** de slots (asymétrie S11)

### `GET /bookings/{booking_id}` — JOINs (le plus complet)

```sql
LEFT JOIN services s ON s.service_id = b.service_id
LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
LEFT JOIN users u_pay ON u_pay.user_id = COALESCE(b.payer_user_id, b.user_id)
LEFT JOIN service_slots sl ON sl.slot_id = b.slot_id
```

**Champs additionnels** :
- `service_title`, `address`, `service_images`, `service_description` (services — **plus** que `/me`)
- `receiver_name`, `receiver_picture`
- `payer_name`, `payer_picture`
- `slot_start_time`, `slot_end_time`, `slot_date`, `slot_type`

> ⚠️ **3 endpoints, 3 projections distinctes**. Ne pas uniformiser. Chaque endpoint expose volontairement un sous-ensemble adapté à son use case.

---

## Régressions à valider après S30/S31/S33/S35

### R1 — `bookings.payment_status='paid'` visible après webhook S33

**Setup** :
1. Buyer crée booking + paie (S30)
2. Webhook `payment_intent.succeeded` (S33) → `UPDATE bookings SET payment_status='paid', status='confirmed'`

**Action** : `GET /api/bookings/me` Java.

**Assertion** :
- Le booking apparaît avec `"payment_status": "paid"` et `"status": "confirmed"`
- Pas avec `payment_status='unpaid'` (qui aurait dit "S33 n'a pas updaté correctement")

### R2 — `bookings.status='cancelled'` ou `'refused'` visible

**Setup** : booking annulé via endpoint `cancel` (S41 future) ou refusé.

**Action** : `GET /api/bookings/me`.

**Assertion** : `"status": "cancelled"` ou `"refused"` correctement remonté.

### R3 — `refund_amount`/`refund_status` NON visibles via booking reads

**Setup** : payment refundé via webhook S35 → `payments.refund_amount=51.75`.

**Action** : `GET /api/bookings/{id}`.

**Assertion** :
- La réponse **NE contient PAS** `refund_amount` ni `refund_status` (ces champs sont sur `payments`, pas `bookings`).
- **Compat stricte** : ne **PAS** ajouter de JOIN sur payments en Java. **Le front doit appeler `/payments/{id}` (S34) pour ces champs.**

> ⚠️ Tentation d'ajouter un JOIN `LEFT JOIN payments p ON p.booking_id = b.booking_id` côté Java pour "améliorer". **NON.** Compat stricte avec Python.

### R4 — Format datetime `+00:00` (compat S34)

**Action** : `GET /api/bookings/me`.

**Assertion** : `created_at`, `updated_at`, `expires_at`, `slot_date`, `scheduled_at` sont au format `2026-04-20T11:37:13.540123+00:00` (pas `Z`).

### R5 — `pricing_snapshot` désérialisé en object

**Setup** : booking avec `pricing_snapshot` stocké comme string JSON en DB.

**Assertion** : la réponse contient `pricing_snapshot` comme **object** (parsed), pas comme string.

> ⚠️ Identique à `pricing_rule_snapshot` (S34/BR-34.08). **Logique conditionnelle** sur `instanceof String`.

### R6 — Permissions 4-OR `/{id}` strict

**Cas** :
- User est `payer_user_id` → 200 ✅
- User est `receiver_user_id` → 200 ✅
- User est `coach_id` → 200 ✅ ← **vérifier ce cas**
- User est `user_id` (legacy, peut différer de payer_user_id) → 200 ✅ ← **vérifier**
- User admin → 200 ✅
- Autre user → 403 ✅

> ⚠️ Le set `{user_id, payer_user_id, receiver_user_id, coach_id}` peut contenir des **valeurs identiques** (ex: `user_id == payer_user_id`). C'est OK : le `in` Python accepte les doublons.

### R7 — Aliases routing actifs

| Path principal | Alias | Status attendu |
|---|---|---|
| `GET /api/bookings/me` | `GET /api/users/me/bookings` | Identique 200 |
| `GET /api/bookings/received` | `GET /api/receiver/requests` | Identique 200 |

> ⚠️ Spring : 2 `@GetMapping({"/path1", "/path2"})` sur la **même** méthode. Asserter via 2 tests MockMvc distincts.

### R8 — Liste vide = `[]` (compat S34/BR-34.11)

**Setup** : user sans booking.

**Action** : `GET /api/bookings/me`.

**Assertion** : HTTP 200, body `[]`. Pas 404, pas wrapper `{data:[]}`.

---

## Effets de bord

**AUCUN.** Lecture pure. Idem S11 / idem S34.

---

## Cas limites à valider

| Cas | Comportement attendu (compat Python) |
|---|---|
| Booking avec `slot_id=NULL` | LEFT JOIN service_slots → `slot_*` champs sont `null` |
| Booking avec `service_id` pointant vers un service supprimé | LEFT JOIN services → `service_title=null` |
| Booking avec `coach_id=NULL` mais `receiver_user_id` set | COALESCE → joint sur `receiver_user_id` |
| Booking avec `payer_user_id=NULL` mais `user_id` set (legacy) | `/{id}` : COALESCE pour `u_pay` join |
| User est dans 2 rôles (ex: payer_user_id == coach_id) | Toujours 200 ; pas de duplication de la row |

---

## Compat strict — checklist (pour Java)

- [ ] HTTP 200 + body `[]` si vide (pas 404)
- [ ] Ordre `created_at DESC`
- [ ] Aliases `/users/me/bookings` et `/receiver/requests`
- [ ] 401 si token absent OU invalide OU user supprimé
- [ ] 404 avant 403 sur `/{id}`
- [ ] 403 si non-payer/receiver/coach/user/admin
- [ ] Snake_case noms champs (`payer_user_id`, `created_at`, etc.)
- [ ] Datetime format `+00:00` (pas `Z`)
- [ ] Decimal → number JSON
- [ ] `pricing_snapshot` désérialisé conditionnel
- [ ] LEFT JOIN (pas INNER) sur services/users/slots
- [ ] Projection JOIN différente entre les 3 endpoints (ne pas uniformiser)
- [ ] Pas de JOIN payments (refund_amount NON visible côté booking)
