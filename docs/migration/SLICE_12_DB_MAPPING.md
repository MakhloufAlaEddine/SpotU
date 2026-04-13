# SLICE_12_DB_MAPPING.md — Mapping base de données
> Basé sur `booking_routes.py:686–723`, `001_initial_schema.sql:42–67, 203–228, 316–331`.
> Généré le 2026-02-XX.

---

## Tables impliquées

| Table | Opération | Condition |
|---|---|---|
| `bookings` | SELECT (lecture) + UPDATE (écriture) | Toujours |
| `payments` | SELECT (lecture PI ID) + UPDATE (statut) | SELECT : toujours — UPDATE : si status IN (...) |
| `service_slots` | UPDATE (libération slot) | Si `slot_id` non null ET slot_status='pending' |

---

## Requête 1 — Lecture booking (pré-transaction)

```sql
SELECT
    booking_id,
    status,
    receiver_user_id,
    slot_id,
    user_id AS payer_user_id   -- alias : bookings.user_id = payer legacy
FROM bookings
WHERE booking_id = $1
```

**Colonnes lues :**
| Colonne DB | Alias | Utilisation |
|---|---|---|
| `booking_id` | `booking_id` | Contrôle existence |
| `status` | `status` | Idempotence + garde statut |
| `receiver_user_id` | `receiver_user_id` | Contrôle accès |
| `slot_id` | `slot_id` | UPDATE conditionnel service_slots |
| `user_id` | `payer_user_id` | Destinataire push notification |

**Note critique :** Python lit `user_id AS payer_user_id`. La colonne réelle est `bookings.user_id` (payer legacy). Ce n'est pas `bookings.payer_user_id`. Ne pas confondre les deux colonnes.

---

## Requête 2 — Lecture payment (pré-transaction)

```sql
SELECT
    stripe_payment_intent_id,
    status AS pay_status
FROM payments
WHERE booking_id = $1
LIMIT 1
```

**Résultat si aucun payment :** `pi_row = None` → Stripe skip total

**Colonnes lues :**
| Colonne DB | Alias | Utilisation |
|---|---|---|
| `stripe_payment_intent_id` | `stripe_payment_intent_id` | ID pour cancel Stripe |
| `status` | `pay_status` | Pas utilisé en logique refuse (conservé pour extension future) |

---

## Transaction atomique — 3 instructions

### UPDATE 1 — Booking → refused

```sql
UPDATE bookings
SET
    status = 'refused',
    updated_at = NOW()
WHERE booking_id = $1
```

**Paramètres :** `$1 = booking_id`
**Colonnes modifiées :** `status`, `updated_at`
**Condition WHERE :** uniquement sur PK — toujours 1 ligne affectée

---

### UPDATE 2 — Payment → cancelled (conditionnel)

```sql
UPDATE payments
SET
    status = 'cancelled',
    updated_at = NOW()
WHERE booking_id = $1
  AND status IN ('requires_authorization', 'authorized')
```

**Paramètres :** `$1 = booking_id`
**Colonnes modifiées :** `status`, `updated_at`
**Comportement si 0 ligne touchée :** pas d'erreur — comportement normal

**Valeurs statut payment annulées ici :**
- `requires_authorization` → PI en attente de capture — pas encore débité
- `authorized` → PI autorisé — pas encore capturé

**Valeurs NON annulées ici (intentionnel) :**
- `pending` → pas de PI — pas d'action
- `captured` → paiement capturé — ne pas annuler sans remboursement (traité par `cancel_booking`)
- `cancelled` → déjà annulé — idempotent via `AND status IN`
- `refunded` → déjà remboursé

---

### UPDATE 3 — Slot → available (conditionnel)

```sql
UPDATE service_slots
SET slot_status = 'available'
WHERE slot_id = $1
  AND slot_status = 'pending'
```

**Paramètres :** `$1 = bk["slot_id"]`
**Condition d'exécution :** uniquement si `bk["slot_id"] is not None`
**Comportement si 0 ligne touchée :** pas d'erreur — comportement normal

**Slot status libérés ici :**
- `pending` uniquement → slot en attente d'acceptation

**Slot status NON libérés (intentionnel) :**
- `reserved` → slot en awaiting_payment — traité par `cancel`
- `booked` → slot confirmé — traité par `cancel`
- `available` → déjà libre

---

## Schéma des tables concernées (colonnes modifiées)

### `bookings` — colonnes modifiées

| Colonne | Type | Avant | Après |
|---|---|---|---|
| `status` | text | `'requested'` | `'refused'` |
| `updated_at` | timestamptz | valeur précédente | `NOW()` |

### `payments` — colonnes modifiées

| Colonne | Type | Avant | Après |
|---|---|---|---|
| `status` | text | `'requires_authorization'` ou `'authorized'` | `'cancelled'` |
| `updated_at` | timestamptz | valeur précédente | `NOW()` |

### `service_slots` — colonnes modifiées

| Colonne | Type | Avant | Après |
|---|---|---|---|
| `slot_status` | text | `'pending'` | `'available'` |

---

## Séquence complète d'exécution (ordre Python)

```
1. acquire connexion pool
2. SELECT booking (lecture)  ← pré-transaction
3. Contrôle accès (memory)
4. Idempotence check (memory)
5. Garde statut (memory)
6. SELECT payment PI (lecture)  ← pré-transaction
7. BEGIN TRANSACTION
   7a. UPDATE bookings → refused
   7b. UPDATE payments → cancelled (si applicable)
   7c. UPDATE service_slots → available (si slot_id non null)
8. COMMIT TRANSACTION
9. release connexion pool
10. Stripe cancel_payment_intent() [HORS TRANSACTION — peut échouer]
11. push notification fire-and-forget [HORS TRANSACTION]
12. return HTTP 200
```

**En Java :** reproduire exactement cette séquence. Les étapes 10 et 11 doivent se passer APRÈS le commit de la transaction, jamais dedans.

---

## Transaction requise

**OUI** — les 3 UPDATEs doivent être atomiques.

Si le UPDATE bookings réussit mais le UPDATE payments échoue → la transaction doit rouler back (état incohérent).

En Spring : `@Transactional` sur la méthode du service.

---

## Mapping réponse

```
{"success": true, "status": "refused", "booking_id": booking_id}
```

| Champ réponse | Source | Valeur |
|---|---|---|
| `success` | Constant | `true` |
| `status` | Constant | `"refused"` |
| `booking_id` | Path param | `booking_id` reçu |

Réponse idempotente (déjà refused) :
```
{"success": true, "status": "refused", "idempotent": true}
```

**Note :** la réponse idempotente n'inclut PAS `"booking_id"`. Respecter cette asymétrie.
