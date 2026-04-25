# SLICE_34_DB_MAPPING.md — Mapping DB Payment Reads
> Basé sur `routes/payment_routes.py:41–80`.
> Généré le 2026-04-25.

---

## Tables impliquées (2)

| Table | Rôle | Opérations Slice 34 |
|---|---|---|
| `payments` | Source des paiements | **SELECT** uniquement |
| `users` | Noms payer/receiver | **SELECT** (LEFT JOIN sur `/me`) |

> **Aucune écriture** en Slice 34. Pas de transaction. Pas de lock.

---

## Table `payments` — colonnes lues

> Le `SELECT p.*` retourne **toutes** les colonnes. Pas de projection partielle.

| Colonne (probable) | Type | Notes |
|---|---|---|
| `payment_id` | TEXT (PK) | Format `pay_...` |
| `booking_id` | TEXT NULL FK | Peut être null (paiement orphelin) |
| `payer_user_id` | TEXT FK→users | WHERE clause (`/me`) + permissions (`/{id}`) |
| `receiver_user_id` | TEXT FK→users | WHERE clause (`/me`) + permissions (`/{id}`) |
| `amount` | NUMERIC ou INT (centimes) | Sérialisé en float si Decimal |
| `currency` | TEXT | Ex: `'eur'` |
| `status` | TEXT | `'pending'`, `'authorized'`, `'captured'`, `'failed'`, `'cancelled'`, `'refunded'`, `'partially_refunded'` |
| `stripe_checkout_session_id` | TEXT NULL | Set en S30 |
| `stripe_payment_intent_id` | TEXT NULL | Set après création Stripe |
| `stripe_charge_id` | TEXT NULL | Set en S33 (`payment_intent.succeeded`) |
| `metadata` | JSONB | Métadonnées custom |
| `pricing_rule_snapshot` | JSONB ou TEXT | Snapshot règles tarif au moment de la création (S30) — **désérialisation conditionnelle** |
| `idempotency_key` | TEXT NULL | Clé Stripe |
| `created_at` | TIMESTAMPTZ | Tri DESC sur `/me` |
| `updated_at` | TIMESTAMPTZ | |

> ⚠️ **À valider** côté schéma réel : la liste exacte des colonnes dépend des migrations passées. Java doit récupérer **dynamiquement** ou maintenir un DTO **miroir complet**.

### Stratégie Java JPA

**Option A — DTO complet miroir (recommandé)** :
```java
public record PaymentRow(
    String paymentId, String bookingId,
    String payerUserId, String receiverUserId,
    BigDecimal amount, String currency, String status,
    String stripeCheckoutSessionId, String stripePaymentIntentId, String stripeChargeId,
    Map<String,Object> metadata, Object pricingRuleSnapshot,
    String idempotencyKey,
    OffsetDateTime createdAt, OffsetDateTime updatedAt
) {}
```

**Option B — `Map<String,Object>` dynamique** (simpler mais moins typé) :
```java
@Query(value = "SELECT * FROM payments WHERE payment_id=:id", nativeQuery = true)
Optional<Map<String,Object>> findRaw(@Param("id") String id);
```

> Recommandation : **Option A** avec sérialisation Jackson contrôlée pour reproduire les noms snake_case Python.

### Index utilisés (à vérifier)

```sql
-- Index pour /me (CRITIQUE — sinon scan complet)
CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_receiver ON payments(receiver_user_id, created_at DESC);

-- Index pour /{id}
-- (PRIMARY KEY suffit)
```

> ⚠️ **À VALIDER** : la requête `WHERE payer = $1 OR receiver = $1` peut ne pas utiliser efficacement les index séparés. PostgreSQL peut faire un BitmapOr. Si performance insuffisante : envisager une vue ou une UNION ALL (slice future, ne pas changer en S34).

---

## Table `users` — JOIN dans `/me`

| Colonne | Type | Lecture Slice 34 |
|---|---|---|
| `user_id` | TEXT (PK) | clause `ON u.user_id = p.payer_user_id` (et receiver) |
| `name` | TEXT | SELECT alias `payer_name` / `receiver_name` |

### LEFT JOIN
```sql
LEFT JOIN users u_pay  ON u_pay.user_id  = p.payer_user_id
LEFT JOIN users u_recv ON u_recv.user_id = p.receiver_user_id
```

> ⚠️ **LEFT JOIN obligatoire** : si user supprimé (ne devrait pas arriver vu les FK, mais safety net), name = null. **Ne PAS** utiliser INNER JOIN qui filtrerait la row.

---

## Permissions

### `/payments/me`
**Filtrage WHERE** : automatique par requête SQL.
```sql
WHERE p.payer_user_id = $1 OR p.receiver_user_id = $1
```
- Pas de check applicatif additionnel.
- Pas de différenciation `role='admin'` (un admin voit ses propres paiements via `/me`, pas tous les paiements — les admin reads sont sur `/admin/payments`).

### `/payments/{payment_id}`
**Filtrage applicatif** après SELECT global :
```python
if (
    d["payer_user_id"] != user["user_id"]
    and d["receiver_user_id"] != user["user_id"]
    and user.get("role") != "admin"
):
    raise HTTPException(403, "Access denied")
```

| User | Accès |
|---|---|
| Payer du payment | ✅ 200 |
| Receiver du payment | ✅ 200 |
| Admin (role=admin) | ✅ 200 (peut voir n'importe quel payment) |
| Autre user | ❌ 403 |
| Pas de user (auth) | ❌ 401 |

> ⚠️ **3 conditions OR** ; en Java, `&&` Java ↔ `and` Python. Logique :
> ```java
> if (!d.payerUserId().equals(user.userId())
>      && !d.receiverUserId().equals(user.userId())
>      && !"admin".equals(user.role())) {
>     throw new ForbiddenException("Access denied");
> }
> ```

---

## Transactions

| Endpoint | Transaction | Notes |
|---|---|---|
| `/payments/me` | NON | Lecture simple |
| `/payments/{id}` | NON | Lecture simple |

Java : pas de `@Transactional` requis. Spring Data JPA fait des SELECT en autocommit.

> ⚠️ Si vous mettez `@Transactional(readOnly = true)` ça optimise (skip dirty checking JPA) — recommandé pour les services read-only.

---

## Sérialisation

### `Decimal` (Postgres NUMERIC) → `float` (Python) → `number` (JSON)
```python
if isinstance(val, Decimal):
    result[key] = float(val)
```

### Java
```java
@JsonFormat(shape = JsonFormat.Shape.NUMBER)
BigDecimal amount;
```

Ou via `ObjectMapper.configure(SerializationFeature.WRITE_BIGDECIMAL_AS_PLAIN, true)`.

> ⚠️ **Risque précision** : Python `float(Decimal('51.75'))` = `51.75` (OK). Mais `float(Decimal('999999999.999999'))` perd des décimales. Java `BigDecimal` → number JSON peut nécessiter une string si > 15 digits. **Vérifier les amounts max** dans `payments`.

### `datetime` → ISO 8601
Python `datetime.isoformat()` produit :
- Sans timezone : `"2026-04-20T11:37:13.540123"`
- Avec timezone : `"2026-04-20T11:37:13.540123+00:00"`

Java `OffsetDateTime.toString()` produit :
- `"2026-04-20T11:37:13.540123Z"` (note : `Z` au lieu de `+00:00`)

> ⚠️ **Asymétrie** : Python `+00:00`, Java par défaut `Z`. **Configurer Jackson** :
> ```java
> objectMapper.registerModule(new JavaTimeModule()
>     .addSerializer(OffsetDateTime.class, new CustomOffsetSerializer()));
> ```
> Ou utiliser `DateTimeFormatter.ISO_OFFSET_DATE_TIME` qui produit `+00:00`.
>
> **Test critique** : si le front mobile parse strict, `Z` peut casser le `Date` ou nécessiter `dayjs.extend(utc)`.

### `JSONB` → dict / Map
- Python asyncpg avec codec `jsonb` → dict directement
- `pricing_rule_snapshot` peut être TEXT (string) → désérialisé applicativement

### Java
- Hibernate `@Type(JsonType.class)` (hibernate-types) → `Map<String,Object>` ou `JsonNode`
- Si TEXT : DTO field `String` puis `objectMapper.readValue(s, Map.class)` dans le service

---

## Diagramme

```
┌──── GET /api/payments/me ─────────────┐
│ 1. require_auth → user                │
│ 2. SELECT p.*, u_pay.name, u_recv.name│
│      FROM payments p                  │
│      LEFT JOIN users u_pay  ON ...    │
│      LEFT JOIN users u_recv ON ...    │
│      WHERE payer = $uid OR recv = $uid│
│      ORDER BY created_at DESC         │
│ 3. row_to_dict + _deserialize         │
│ 4. return [list]                      │
└───────────────────────────────────────┘

┌──── GET /api/payments/{id} ───────────┐
│ 1. require_auth → user                │
│ 2. SELECT * FROM payments             │
│      WHERE payment_id = $id           │
│ 3. SI row null → 404                  │
│ 4. SI permissions KO → 403            │
│ 5. row_to_dict + _deserialize         │
│ 6. return {dict}                      │
└───────────────────────────────────────┘
```

---

## Concurrence & cache

### Cache HTTP
Aucun cache côté Python. Chaque requête refait le SELECT.

### Java
Possibilité d'ajouter `Cache-Control: private, max-age=0, no-cache` pour aligner. Ou rien.

> ⚠️ Ne **PAS** ajouter de cache CDN/HTTP **partagé** (la réponse est user-scope, et les statuts payment changent souvent via webhook S33).

### Concurrence avec écritures
Une lecture en cours pendant qu'un webhook S33 fait `UPDATE payments SET status='captured'` :
- **PostgreSQL MVCC** : la lecture voit l'état à l'instant T (snapshot isolation).
- Pas de blocking.
- Si le SELECT renvoie `pending` puis le webhook commit `captured` → la prochaine lecture voit `captured`. ✅ Comportement attendu.

---

## Incertitudes / zones grises

| Zone | Question | Action |
|---|---|---|
| Type colonne `pricing_rule_snapshot` | TEXT ou JSONB ? | Tester `SELECT pg_typeof(pricing_rule_snapshot) FROM payments LIMIT 1` ; selon résultat, désérialiser ou non |
| Type `metadata` | JSONB probable | Idem |
| Précision `amount` | Decimal(10,2) ? | Vérifier la migration. Si NUMERIC sans précision → pas de problème. |
| Colonnes "internes" exposées (ex: `idempotency_key`, `stripe_secret`) | Le front en a-t-il besoin ? | Le code Python fait `SELECT *` sans filtrage → on expose **tout**. **Ne pas filtrer en Java** sauf demande explicite (changement de contrat). |
| Index existants | Performance `WHERE payer OR receiver` | Vérifier `EXPLAIN ANALYZE` ; si scan complet → futur slice "perf payments". Ne pas optimiser en S34. |
| `users.name` peut-il être null ? | Champ obligatoire en DB ? | LEFT JOIN protège ; reproduire le LEFT JOIN. |
| Format `OffsetDateTime` Z vs +00:00 | Compat front | **Configurer Java pour `+00:00`** (compat stricte Python). |
