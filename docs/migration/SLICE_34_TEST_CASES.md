# SLICE_34_TEST_CASES.md — Cas de test Payment Reads
> Basé sur `routes/payment_routes.py:41–80`, BR-34.01 à BR-34.15.
> Généré le 2026-04-25.

---

## Convention : `T34-<CASE>`

Total **24 cas de test**.

---

## 🟢 Nominal — `GET /api/payments/me`

### T34-01 — User a 3 paiements (mix payer + receiver)

**Pré-conditions** :
- `user_001` avec JWT valide
- 3 rows dans `payments` :
  - `pay_001` : payer=user_001, receiver=user_other, status=captured, created_at=2026-04-20T10:00
  - `pay_002` : payer=user_other, receiver=user_001, status=authorized, created_at=2026-04-20T11:00
  - `pay_003` : payer=user_001, receiver=user_002, status=pending, created_at=2026-04-20T09:00
- Plus 1 row `pay_other` (payer/receiver = autres users) — ne doit PAS apparaître

**Action** :
```http
GET /api/payments/me
Authorization: Bearer <jwt user_001>
```

**Résultat HTTP 200** : array de **3 rows** dans l'ordre `pay_002` (10h… non, attends, 11h), `pay_001` (10h), `pay_003` (9h).

**Assertions** :
- 3 éléments
- Ordre `created_at DESC` : `pay_002` → `pay_001` → `pay_003`
- Chaque élément a `payer_name` et `receiver_name` (LEFT JOIN)
- `pricing_rule_snapshot` désérialisé en dict (si stocké comme string JSON)
- Pas de `pay_other` dans la réponse

### T34-02 — User n'a aucun paiement

**Action** : GET `/me` avec user n'ayant ni payer ni receiver dans aucune row.

**Résultat** : HTTP 200, body `[]` (tableau vide).

> ⚠️ Pas 404, pas `{"data": []}`.

### T34-03 — User a 1 seul paiement

**Action** : GET `/me`.

**Résultat** : HTTP 200, array de 1 élément.

### T34-04 — Format datetime ISO avec offset

**Pré-conditions** : payment avec `created_at='2026-04-20 11:37:13.540123+00:00'`.

**Assertion** : la réponse contient `"created_at": "2026-04-20T11:37:13.540123+00:00"` (avec `+00:00`, **pas `Z`**).

### T34-05 — `pricing_rule_snapshot` désérialisation

**Pré-conditions** : un payment avec `pricing_rule_snapshot` stocké comme string JSON `'{"foo":"bar"}'`.

**Assertion** : la réponse contient `"pricing_rule_snapshot": {"foo": "bar"}` (object, pas string).

### T34-06 — `payer_name` / `receiver_name` LEFT JOIN

**Pré-conditions** :
- `pay_orphan` : payer_user_id pointe vers un user existant (`Alice`), receiver_user_id pointe vers un user supprimé (foreign key cascade ou row absent)

**Assertion** :
- `payer_name = "Alice"`
- `receiver_name = null` (pas exclu, juste null)

> ⚠️ Test critique : LEFT JOIN, pas INNER.

---

## 🟢 Nominal — `GET /api/payments/{id}`

### T34-07 — User est payer du payment

**Pré-conditions** : `pay_001`.payer_user_id = user_001.

**Action** : GET `/payments/pay_001` avec JWT user_001.

**Résultat** : HTTP 200, objet payment complet **sans** `payer_name`/`receiver_name`.

### T34-08 — User est receiver du payment

**Pré-conditions** : `pay_002`.receiver_user_id = user_001.

**Résultat** : HTTP 200.

### T34-09 — User est admin (autre user)

**Pré-conditions** :
- `pay_001`.payer = user_buyer, receiver = user_coach
- JWT de user_admin (role='admin'), ni payer ni receiver

**Résultat** : HTTP 200 (admin voit tout).

---

## 🔴 Auth invalide

### T34-10 — Pas de header Authorization ni cookie

**Action** :
```http
GET /api/payments/me
(no auth)
```

**Résultat** : HTTP 401, `{"detail": "Not authenticated"}`.

### T34-11 — Bearer token malformé

**Action** : `Authorization: Bearer not-a-jwt`.

**Résultat** : HTTP 401 (decode_jwt throw → 401).

### T34-12 — JWT expiré

**Action** : `Authorization: Bearer <expired_jwt>`.

**Résultat** : HTTP 401.

### T34-13 — JWT valide mais user supprimé

**Pré-conditions** : JWT pointe vers `user_deleted` qui a été supprimé en DB.

**Résultat** : HTTP 401, `{"detail": "User not found"}`.

### T34-14 — Cookie `winek_token` valide (sans Bearer)

**Action** :
```http
GET /api/payments/me
Cookie: winek_token=<valid_jwt>
```

**Résultat** : HTTP 200 (auth via cookie OK).

> ⚠️ Test critique : doit fonctionner SANS header Authorization.

### T34-15 — Bearer ET cookie présents : Bearer prioritaire

**Action** : header `Authorization: Bearer <jwt_user_A>` + cookie `winek_token=<jwt_user_B>`.

**Résultat** : auth via Bearer (user_A) — cohérent avec `get_token_from_request` qui check Bearer en premier.

---

## 🟠 `/payments/{id}` cas non-trouvé / interdit

### T34-16 — Payment introuvable

**Action** : GET `/payments/pay_nonexistent` avec JWT valide quelconque.

**Résultat** : HTTP 404, `{"detail": "Payment not found"}`.

### T34-17 — Payment existe mais user n'est ni payer/receiver/admin

**Pré-conditions** : `pay_001`.payer = user_A, receiver = user_B.

**Action** : GET `/payments/pay_001` avec JWT user_C (lambda).

**Résultat** : HTTP 403, `{"detail": "Access denied"}`.

> ⚠️ Test critique de la règle 3-conditions OR.

### T34-18 — Ordre 404 → 403

**Pré-conditions** : `pay_existing` appartient à user_A.

**Action 1** : GET `/payments/pay_doesnt_exist` avec user_C lambda → **404**.
**Action 2** : GET `/payments/pay_existing` avec user_C lambda → **403**.

> ⚠️ Asymétrie volontaire (révèle l'existence). À reproduire.

---

## 🟣 Format réponse compat stricte

### T34-19 — `/me` retourne directement un tableau (pas wrapper)

**Assertion** : `Content-Type: application/json` + body commence par `[`, pas `{`.

### T34-20 — `/{id}` retourne directement un objet (pas wrapper)

**Assertion** : body commence par `{`, contient `"payment_id"` à la racine.

### T34-21 — Toutes les colonnes `SELECT *` présentes

**Assertion** : la réponse `/{id}` contient (au minimum) :
```
payment_id, booking_id, payer_user_id, receiver_user_id,
amount, currency, status,
stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id,
metadata, pricing_rule_snapshot, idempotency_key,
created_at, updated_at
```

> ⚠️ **Ne pas masquer** les colonnes "internes". Compat stricte.

### T34-22 — Pas de `payer_name` sur `/{id}`

**Assertion** : la réponse `/{id}` ne contient **PAS** `payer_name` ni `receiver_name`.

> ⚠️ Asymétrie volontaire avec `/me`.

### T34-23 — Snake_case noms de champs

**Assertion** : `payer_user_id` (pas `payerUserId`), `created_at` (pas `createdAt`), etc.

### T34-24 — Decimal → number (pas string)

**Pré-conditions** : `payment.amount = 51.75`.

**Assertion** : JSON `"amount": 51.75` (number, sans guillemets).

---

## Matrice de couverture

| Axe | Cas |
|---|---|
| Nominal `/me` | T34-01, T34-02, T34-03, T34-04, T34-05, T34-06 |
| Nominal `/{id}` | T34-07, T34-08, T34-09 |
| Auth | T34-10 à T34-15 |
| 404/403 | T34-16, T34-17, T34-18 |
| Compat format | T34-19 à T34-24 |

**Total : 24 cas.**

---

## Régression cross-slices

### T34-R1 — Régression S30 : payment créé via S30 visible immédiatement

**Setup** : User crée booking + checkout (S30) → payment row créée avec status='pending'.

**Action** : GET `/me` immédiatement après.

**Résultat** : le nouveau payment apparaît avec status='pending' en première position (`created_at DESC`).

### T34-R2 — Régression S33 : payment captured via webhook visible

**Setup** : Webhook S33 vient de set `status='captured'`.

**Action** : GET `/{id}` post-webhook.

**Résultat** : status='captured', `stripe_charge_id` populé, `updated_at` updated.

### T34-R3 — Régression S31 : payment captured via S31 visible

**Setup** : S31 best-effort a set `status='captured'` (sans webhook).

**Action** : GET `/{id}`.

**Résultat** : status='captured'. Cohérent avec S33 (idempotent UPDATE).

---

## Notes runner Java

- **Testcontainers PostgreSQL** + migrations seed les rows `payments` et `users`.
- **JWT helpers de test** : utiliser `JwtEncoder` Spring pour générer des tokens valides (signés avec la même clé que prod-test).
- **Cookies en MockMvc** :
  ```java
  mockMvc.perform(get("/api/payments/me")
      .cookie(new Cookie("winek_token", token)));
  ```
- **Asserter format datetime** :
  ```java
  String body = mockMvc.andReturn().getResponse().getContentAsString();
  assertThat(body).contains("+00:00");        // pas "Z"
  assertThat(body).doesNotContain("\"Z\"");
  ```
- **Asserter `SELECT *` complet** : utiliser `@JsonAlias` pour mapper, ou comparer aux clés attendues via Jackson `Map`.
- **Permissions matrice** : 4 cas `/{id}` (payer / receiver / admin / lambda) à seeder 4 fois.
- **Liste vide** : seeder un user sans payments, asserter `[]` strict (pas `null`, pas wrapper).
- **JSONAssert STRICT** pour comparer 1:1 avec une réponse Python de référence (capturer un curl Python en test integration).

---

## Cas spéciaux / robustesse

### T34-S1 — User a 1000 paiements (pas de pagination)

**Setup** : seeder 1000 rows pour un user.

**Résultat** : 200, array de 1000 éléments. **Ne pas** paginer.

> ⚠️ Performance : ~5–50ms acceptable. Si > 1s → flag pour slice futur "perf payments".

### T34-S2 — Payment avec `metadata` énorme (>10KB)

**Setup** : `metadata` JSONB contenant 10K caractères.

**Résultat** : 200, metadata sérialisé tel quel. Pas de truncation.

### T34-S3 — Payment avec emojis dans `metadata`

**Setup** : `metadata = {"note": "Réservation 🎉 confirmée"}`.

**Résultat** : 200, emojis préservés en UTF-8.

### T34-S4 — Concurrence : webhook S33 mute pendant le SELECT

**Setup** : un webhook fait UPDATE status='captured' juste avant le SELECT.

**Résultat** : MVCC PostgreSQL → snapshot isolation → la lecture voit l'état au moment du SELECT (avant ou après UPDATE selon timing). Pas de blocking.
