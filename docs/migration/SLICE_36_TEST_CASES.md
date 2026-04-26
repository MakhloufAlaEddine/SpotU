# SLICE_36_TEST_CASES.md — Cas de test Booking Reads (Audit + Régression)
> Basé sur `routes/booking_routes.py:1035–1110`, `SLICE_11_TEST_CASES.md`.
> Généré le 2026-04-25.

---

## ⚠️ Document de référence : `SLICE_11_TEST_CASES.md`

Tous les cas nominaux sont dans S11. **Cette doc S36 ajoute uniquement les cas de régression post-S30/S31/S33/S35.**

---

## Convention : `T36-<CASE>`

Cas de **régression** (numérotés en complément de S11). Total **20 cas**.

---

## 🔄 Régression S30 → S36

### T36-01 — Booking créé via S30 visible via `/bookings/me` immédiatement

**Setup** :
1. Buyer crée booking via `POST /bookings/request` (S30) → `payment_status='unpaid'`, `status='requested'`
2. Aucun délai

**Action** : `GET /api/bookings/me` Java.

**Résultat** :
- HTTP 200, array contient le nouveau booking
- En première position (ordre `created_at DESC`)
- `payment_status='unpaid'`, `status='requested'`
- `expires_at` non-null

### T36-02 — Booking en `awaiting_payment` après S30 instant_booking

**Setup** : booking créé en mode instant (S30 manual_approval=false) → `status='awaiting_payment'`.

**Action** : `GET /api/bookings/me`.

**Résultat** : `status='awaiting_payment'`.

### T36-03 — Booking créé visible via `/bookings/{id}` (permissions payer)

**Setup** : booking créé par `u_payer`.

**Action** : `GET /api/bookings/{bkg_001}` avec JWT `u_payer`.

**Résultat** : 200, payload complet avec JOINs.

### T36-04 — Booking créé visible via `/bookings/received` côté receiver

**Setup** : booking créé avec `receiver_user_id=u_recv`.

**Action** : `GET /api/bookings/received` avec JWT `u_recv`.

**Résultat** : 200, contient le booking.

---

## 🔄 Régression S31 → S36

### T36-05 — `payment_status='paid'` visible après S31 redirect status

**Setup** :
1. Buyer paie via Stripe Checkout
2. Buyer revient via redirect → S31 mute `bookings.payment_status='paid'` (best-effort)

**Action** : `GET /api/bookings/me`.

**Résultat** : `payment_status='paid'`.

### T36-06 — `bookings.status='confirmed'` après S31 best-effort

**Setup** : S31 mute `status='confirmed'` après redirect.

**Action** : `GET /api/bookings/{id}`.

**Résultat** : `status='confirmed'`.

---

## 🔄 Régression S33 → S36

### T36-07 — Webhook `payment_intent.succeeded` mute booking → `/me` voit `confirmed/paid`

**Setup** :
1. S33 webhook PI succeeded reçu
2. UPDATE `bookings SET status='confirmed', payment_status='paid'` (S33 BR)

**Action** : `GET /api/bookings/me`.

**Résultat** :
- `status='confirmed'`
- `payment_status='paid'`

### T36-08 — Webhook `checkout.session.completed` mute booking → idem

**Setup** : S33 Branch A (CSC unpaid+awaiting → confirmed).

**Action** : `GET /api/bookings/me`.

**Résultat** : idem T36-07.

### T36-09 — Webhook `payment_intent.payment_failed` ne mute pas booking

**Setup** : S33 BR : pas d'UPDATE bookings sur PI failed.

**Action** : `GET /api/bookings/me`.

**Résultat** : booking `status` **inchangé** (reste `awaiting_payment` ou `requested`).

### T36-10 — Webhook `payment_intent.canceled` ne mute pas booking

**Setup** : idem.

**Résultat** : booking `status` inchangé.

---

## 🔄 Régression S35 → S36 (CRITIQUE — asymétrie volontaire)

### T36-11 — Refund webhook ne mute pas `bookings.status`

**Setup** :
1. Booking confirmé + payé (S33)
2. S35 webhook `charge.refunded` full → `payments.status='refunded'`

**Action** : `GET /api/bookings/{id}`.

**Résultat** :
- `bookings.status='confirmed'` ← **inchangé** (asymétrie volontaire BR-35.12)
- `bookings.payment_status='paid'` ← **inchangé**
- **PAS** de `refund_amount` dans la réponse (pas de JOIN payments)

> ⚠️ Test critique : le booking semble payé alors que le payment est refunded. **Comportement volontaire**. Si Cursor "améliore" en ajoutant un JOIN payments → casse la compat.

### T36-12 — Refund partiel idem

**Setup** : `partially_refunded` côté payments.

**Résultat** : booking inchangé. `refund_amount` absent de la réponse.

### T36-13 — Front doit faire 2 appels pour avoir refund info

**Action** :
1. `GET /api/bookings/{id}` → booking sans refund info
2. `GET /api/payments/{id}` (S34) → payment avec `refund_amount`, `refund_status`

**Résultat** : 2 réponses cohérentes ; front compose dans son state.

---

## 🔐 Permissions critiques

### T36-14 — Permissions 4-OR : user est `coach_id` (legacy)

**Setup** : booking avec `coach_id=u_coach`, `receiver_user_id=NULL` (legacy).

**Action** : `GET /api/bookings/{id}` avec JWT `u_coach`.

**Résultat** : 200 (coach_id matche le set de permissions).

### T36-15 — Permissions 4-OR : user est `user_id` (legacy)

**Setup** : booking avec `user_id=u_legacy`, `payer_user_id=NULL`.

**Action** : GET avec JWT `u_legacy`.

**Résultat** : 200.

### T36-16 — Permissions 4-OR : user lambda exclu

**Setup** : booking où user_C n'est dans aucun des 4 champs.

**Action** : GET avec JWT user_C.

**Résultat** : 403 `{"detail": "Accès refusé"}`.

### T36-17 — Permissions admin override

**Setup** : booking où admin n'est ni payer ni receiver ni coach.

**Action** : GET avec JWT admin (role='admin').

**Résultat** : 200.

---

## 🌐 Aliases routing

### T36-18 — `/api/users/me/bookings` retourne identique à `/api/bookings/me`

**Action 1** : GET `/api/bookings/me`.
**Action 2** : GET `/api/users/me/bookings`.

**Résultat** : 2 réponses **byte-identique** (même body, même headers).

### T36-19 — `/api/receiver/requests` retourne identique à `/api/bookings/received`

**Idem** pour le 2e alias.

---

## 🔗 Compat strict format réponse

### T36-20 — Liste vide `/me` = `[]`

**Setup** : user sans aucun booking créé.

**Action** : GET `/api/bookings/me`.

**Résultat** : 200, body `[]`. Pas 404, pas wrapper.

---

## Matrice de couverture S36 (uniquement régressions ; nominal = S11)

| Axe | Cas |
|---|---|
| Régression S30 (booking créé) | T36-01 à T36-04 |
| Régression S31 (status best-effort) | T36-05, T36-06 |
| Régression S33 (webhook mute) | T36-07 à T36-10 |
| Régression S35 (refund pas de mute) | T36-11 à T36-13 |
| Permissions 4-OR | T36-14 à T36-17 |
| Aliases | T36-18, T36-19 |
| Compat format | T36-20 |

**Total : 20 cas de régression** (en plus des cas nominaux T11-XX déjà documentés en S11).

---

## Cas nominaux à exécuter depuis S11 (ne pas réécrire)

Voir `/app/docs/migration/SLICE_11_TEST_CASES.md` :
- T11-01 à T11-XX : nominal `/me`, `/received`, `/{id}`
- Cas auth, 404, 403, ordre tri, JOINs LEFT, projections distinctes
- Cas pricing_snapshot, datetime format, snake_case

---

## Notes runner Java

- **Réutiliser le harness S34** : Testcontainers PostgreSQL, MockMvc, JSONAssert STRICT, JWT helpers
- **Seeders communs** :
  ```java
  // Utility S30+S33 pour créer un booking + payment + simuler webhook
  TestSeed seed = new TestSeed(jdbc);
  String bkg = seed.createBooking(payerId, recvId, "service_001");
  seed.simulateWebhookCaptured(bkg);              // S33 état
  seed.simulateWebhookRefunded(bkg);              // S35 état
  ```
- **Asserter aliases identiques** :
  ```java
  String body1 = mockMvc.perform(get("/api/bookings/me").header("Authorization", bearer))
      .andReturn().getResponse().getContentAsString();
  String body2 = mockMvc.perform(get("/api/users/me/bookings").header("Authorization", bearer))
      .andReturn().getResponse().getContentAsString();
  JSONAssert.assertEquals(body1, body2, JSONCompareMode.STRICT);
  ```
- **Asserter pas de JOIN payments** :
  ```java
  String body = mockMvc.perform(get("/api/bookings/" + bkg).header("Authorization", bearer))
      .andReturn().getResponse().getContentAsString();
  assertThat(body).doesNotContain("refund_amount", "refund_status", "stripe_charge_id");
  ```
- **Asserter datetime format** :
  ```java
  assertThat(body).contains("+00:00").doesNotContain("\"Z\"");
  ```
