# SLICE_32_DB_MAPPING.md — Mapping DB Webhook Infrastructure
> Basé sur `webhook_handlers.py:80–117`.
> Généré le 2026-04-20.

---

## Tables impliquées (1)

| Table | Rôle | Opérations Slice 32 |
|---|---|---|
| `stripe_webhook_events` | Idempotence des events Stripe | INSERT ON CONFLICT DO NOTHING + UPDATE status |

> **Aucune autre table** ne reçoit d'écriture en Slice 32. Pas de `payments`, pas de `bookings`, pas de `services`. La logique métier est repoussée aux slices handlers.

---

## Table `stripe_webhook_events` — schéma déduit

| Colonne | Type PG | Lecture | Écriture | Notes |
|---|---|---|---|---|
| `event_id` | TEXT (**PK**) | ON CONFLICT cible | INSERT (1) + WHERE UPDATE | Format Stripe `evt_...` ; clé d'idempotence |
| `event_type` | TEXT | — | INSERT | Ex: `"payment_intent.succeeded"` ; pour analytics/debug |
| `status` | TEXT | — | INSERT `'processing'` puis UPDATE `'success'` / `'error'` / `'ignored'` | Cycle de vie 2 étapes |
| `processed_at` | TIMESTAMPTZ | — | INSERT NOW() | Date de réception |
| `updated_at` | TIMESTAMPTZ | — | INSERT + UPDATE NOW() | Toujours mis à jour |
| `related_id` | TEXT NULL | — | UPDATE | `payment_id` ou `subscription_id` rattaché — **NULL en S32** (handlers stub) |
| `error_message` | TEXT NULL | — | UPDATE (si error) | Tronqué à 500 chars : `str(exc)[:500]` |

### SQL INSERT (claim_event)

```sql
INSERT INTO stripe_webhook_events
       (event_id, event_type, status, processed_at, updated_at)
VALUES ($1, $2, 'processing', NOW(), NOW())
ON CONFLICT (event_id) DO NOTHING
```

### Détection insertion réelle (asyncpg)
```python
result = await conn.execute(...)
inserted = result.split()[-1] == "1"
```

- `result` est le command tag : `"INSERT 0 1"` (inséré) ou `"INSERT 0 0"` (conflict).
- Le dernier token est `1` ou `0`.

### Java — alternatives pour détecter l'insertion
**Option A : `RETURNING`**
```sql
INSERT INTO stripe_webhook_events (...)
VALUES (...)
ON CONFLICT (event_id) DO NOTHING
RETURNING event_id
```
→ retourne 0 ou 1 row. Si 1 row → inséré.

**Option B : Spring Data JPA `@Modifying` + `int` retour**
```java
@Modifying @Query(value = "...", nativeQuery = true)
int claimEvent(...)
```
Le `int` retourné = nombre de lignes insérées (0 ou 1).

**Option C : INSERT ... WHERE NOT EXISTS**
Plus verbeux mais portable.

> Recommandation : **Option B** (la plus simple).

### SQL UPDATE (mark_done)

```sql
UPDATE stripe_webhook_events
   SET status        = $1,                 -- 'success' / 'error' / 'ignored'
       related_id    = $2,                 -- NULL en S32
       error_message = $3,                 -- NULL en succès
       updated_at    = NOW()
 WHERE event_id      = $4
```

> ⚠️ Notons que `processed_at` n'est **PAS** mis à jour à `mark_done` (seulement à l'INSERT initial). Compat stricte = ne pas le re-toucher.

---

## Status — cycle de vie

```
[Stripe POST] → INSERT processing
                    ├── handlers OK     → UPDATE success
                    ├── handlers throw  → UPDATE error (+ error_message)
                    └── (Slice 32 stub) → UPDATE success (toujours)

[Stripe REPOST same event_id] → INSERT ON CONFLICT (no-op) → return idempotent_skip (pas d'UPDATE)
```

### Statuts attendus par valeur

| Status | Quand | Slice |
|---|---|---|
| `'processing'` | Juste après INSERT (avant handlers) | toutes |
| `'success'` | Handlers OK (en S32 : toujours stub OK) | toutes |
| `'error'` | Handlers throw — log + UPDATE error_message | S33+ |
| `'ignored'` | Réservé : event volontairement skipped (signature de la fonction `_mark_done` accepte cette valeur mais elle n'est PAS utilisée dans le code Python actuel) | futur |

---

## Index recommandés (à vérifier en migrations)

```sql
-- PRIMARY KEY
ALTER TABLE stripe_webhook_events ADD PRIMARY KEY (event_id);

-- Index utilitaire pour analytics
CREATE INDEX IF NOT EXISTS idx_swe_event_type_status
  ON stripe_webhook_events(event_type, status);

-- Index temporel (debug)
CREATE INDEX IF NOT EXISTS idx_swe_processed_at
  ON stripe_webhook_events(processed_at DESC);
```

> **À VALIDER** dans les migrations DB existantes. Slice 32 ne crée pas de migration — la table existe déjà.

---

## Transactionnalité

| Étape | Transaction | Notes |
|---|---|---|
| INSERT (claim) | Auto-commit asyncpg | Atomique ON CONFLICT |
| UPDATE (mark_done) | Auto-commit asyncpg | Hors transaction explicite |
| Java | `@Transactional` couvrant INSERT + UPDATE possible mais **pas obligatoire** (les 2 sont indépendants logiquement) | Recommandation : `@Transactional` autour du dispatch entier pour atomicité globale |

### Diagramme

```
  [POST /api/webhook/stripe]
            │
            ├── Lire raw body (bytes)
            ├── Vérifier signature Stripe (try/except → 400)
            ├── Extraire event_id, event_type, obj (ou 400)
            ├── log.info "Webhook reçu"
            │
            ├── pool.acquire()
            │     │
            │     ├── INSERT stripe_webhook_events ON CONFLICT DO NOTHING
            │     │     ├── inserted=False → return {"received": true, "idempotent_skip": true}
            │     │     └── inserted=True → continuer
            │     │
            │     ├── _resolve_payment_id (stub Slice 32 → return None,None)
            │     │
            │     ├── try:
            │     │     dispatch handlers (stub no-op en S32)
            │     │     UPDATE stripe_webhook_events SET status='success'
            │     │   except:
            │     │     log.exception
            │     │     UPDATE stripe_webhook_events SET status='error', error_message=...
            │     │   (PAS de re-raise)
            │     │
            │     └── pool.release
            │
            ├── if pending_notifs (vide en S32) : envoi notifs
            │
            └── return {"received": true}
```

---

## Concurrence

### Cas Stripe re-livraison
Stripe re-livre le même event_id si on ne répond pas 200 dans le délai imparti (~30s). Deux cas :

**Cas A** : 1ère livraison passe (claim OK), 2nde livraison arrive 30s+ après → 2nde fait conflict → idempotent_skip.

**Cas B** : 2 livraisons quasi-simultanées → 2 INSERT en parallèle :
- 1er INSERT gagne (PRIMARY KEY)
- 2nd INSERT → CONFLICT → DO NOTHING → claim returns False → idempotent_skip

> ✅ La PRIMARY KEY garantit l'atomicité côté PostgreSQL même en concurrence.

### Java — pas besoin de SELECT FOR UPDATE
La PRIMARY KEY suffit. Ne **pas ajouter** de lock applicatif.

---

## Incertitudes / zones grises

| Zone | Question | Action |
|---|---|---|
| Type colonne `event_id` | TEXT ou VARCHAR(N) ? | Tester avec `evt_1Nxxx` (~30 chars) — TEXT suffisant |
| Contrainte `status` enum check | CHECK constraint ou TEXT libre ? | Tester en insérant 'success' / 'error' / 'ignored' / valeur arbitraire |
| Colonne supplémentaire `body` JSONB ? | Stocker le body brut Stripe pour debug ? | Non visible dans le code Python — non utilisé en S32. Slice future debug |
| Rétention des events | Purger après N jours ? | Hors périmètre — pas de worker dans le code actuel |
| `processed_at` vs `created_at` | Confusion possible | Le code utilise `processed_at` à l'INSERT et n'a pas de `created_at`. Reproduire cette nomenclature exacte. |

---

## Compat asyncpg → JPA mapping

| asyncpg | Spring/JPA |
|---|---|
| `conn.execute("INSERT ... ON CONFLICT DO NOTHING", ...)` retourne string `"INSERT 0 1"` | `@Modifying @Query(... ON CONFLICT DO NOTHING, nativeQuery=true)` retourne `int` (rows) |
| `result.split()[-1] == "1"` | `claimEvent(...) == 1` |
| `conn.execute(UPDATE ...)` retourne `"UPDATE 1"` | `@Modifying @Query(UPDATE ...)` retourne `int` (rows) |
| `conn.fetchrow(SELECT)` | `Optional<Row>` via `@Query(SELECT)` |
| `await pool.acquire()` async context | `try-with-resources` ou `@Transactional` |
