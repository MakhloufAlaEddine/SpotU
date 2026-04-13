# SLICE_14_DB_MAPPING.md — Mapping DB de la Slice 14
> Basé sur `booking_routes.py:984–1028`.
> Généré le 2026-02-XX.

---

## Tables utilisées

| Table | Opération | Rôle |
|---|---|---|
| `bookings` | SELECT + UPDATE | Lecture `receiver_user_id`, mise à jour `status` |
| `service_slots` | UPDATE conditionnel | Transition `booked` → `completed` (via sous-requête) |
| `payments` | UPDATE conditionnel | Transition `authorized` → `captured` (DB uniquement) |

---

## Séquence complète des opérations DB

### Étape 0 — Lecture pour vérification d'accès

```sql
-- booking_routes.py:1003–1004
SELECT receiver_user_id
FROM bookings
WHERE booking_id = $1
```

**Rôle :** Récupérer le `receiver_user_id` pour vérifier que l'appelant est autorisé.

**Si aucune ligne retournée :** → HTTP 404

---

### Étape 1 — Transaction atomique (3 UPDATEs)

Les 3 opérations suivantes sont dans une seule transaction `async with conn.transaction()`.

#### 1a. UPDATE bookings

```sql
-- booking_routes.py:1010–1013
UPDATE bookings
SET status = 'completed',
    updated_at = NOW()
WHERE booking_id = $1
```

**Colonnes modifiées :**
- `status` : [toute valeur courante] → `'completed'`
- `updated_at` : horodatage de la mise à jour

> ⚠️ **Piège P1** : Aucune condition sur `status` courant. Cette requête s'exécute même si
> le booking est `refused`, `requested`, `cancelled`, etc. Comportement Python exact à reproduire.

---

#### 1b. UPDATE service_slots (conditionnel)

```sql
-- booking_routes.py:1014–1018
UPDATE service_slots
SET slot_status = 'completed'
WHERE slot_id = (
    SELECT slot_id
    FROM bookings
    WHERE booking_id = $1
)
AND slot_status = 'booked'
```

**Colonne modifiée :**
- `slot_status` : `'booked'` → `'completed'`

> ⚠️ **Piège P2 — Sous-requête corrélée** :
> - Si `slot_id IS NULL` dans `bookings` → la sous-requête retourne `NULL`
>   → `WHERE slot_id = NULL` ne match aucune ligne → UPDATE silencieux (0 lignes, pas d'erreur)
> - Cette sous-requête n'est PAS un JOIN direct. Reproduire exactement en Java
>   (ou utiliser un JOIN équivalent si JDBC simplifie, mais vérifier le comportement NULL).
>
> **Condition `slot_status = 'booked'`** :
> - Si le slot n'est pas en état `booked` (ex: `reserved`, `available`) → UPDATE silencieux.
> - C'est le comportement attendu : seuls les slots réellement verrouillés (booking confirmé)
>   passent à `completed`.

---

#### 1c. UPDATE payments (conditionnel)

```sql
-- booking_routes.py:1019–1022
UPDATE payments
SET status = 'captured',
    updated_at = NOW()
WHERE booking_id = $1
  AND status = 'authorized'
```

**Colonne modifiée :**
- `status` : `'authorized'` → `'captured'`
- `updated_at` : horodatage

> ⚠️ **Piège P3 — DB uniquement, AUCUN appel Stripe** :
> Cette mise à jour n'est qu'un changement d'état interne DB.
> Il n'y a aucun appel à `stripe_service.capture_payment_intent()` ici.
> Java NE DOIT PAS ajouter d'appel Stripe dans cette branche.
>
> **Condition `status = 'authorized'`** :
> - Si payment déjà `captured`, `failed`, ou autre → UPDATE silencieux (0 lignes).
> - Pas de double-capture possible.

---

## Résumé des transitions

| Table | Colonne | Avant | Après | Condition |
|---|---|---|---|---|
| `bookings` | `status` | _toute valeur_ | `completed` | `booking_id = $1` |
| `bookings` | `updated_at` | _ancienne valeur_ | `NOW()` | `booking_id = $1` |
| `service_slots` | `slot_status` | `booked` | `completed` | `slot_id = (subquery)` ET `slot_status = 'booked'` |
| `payments` | `status` | `authorized` | `captured` | `booking_id = $1` ET `status = 'authorized'` |
| `payments` | `updated_at` | _ancienne valeur_ | `NOW()` | idem |

---

## Transaction

**OUI — Transaction atomique** sur les 3 UPDATEs.

```python
# booking_routes.py:1009
async with conn.transaction():
    await conn.execute(...)  # UPDATE bookings
    await conn.execute(...)  # UPDATE service_slots
    await conn.execute(...)  # UPDATE payments
```

En Java, utiliser `@Transactional` sur la méthode de service ou gérer la connexion manuellement.

---

## Mapping réponse → DB

| Champ réponse | Source |
|---|---|
| `success` | Hardcodé `true` si pas d'exception |
| `status` | Hardcodé `"completed"` |
| `booking_id` | Path parameter (recommandation Java) |

> ℹ️ La réponse Python ne relit pas la DB après les UPDATEs.
> Elle retourne directement `{"success": True, "status": "completed"}` sans re-fetch.
> Java peut reproduire ce comportement (pas de SELECT supplémentaire).

---

## Colonnes concernées par table

### `bookings`

| Colonne | Type | Modification |
|---|---|---|
| `booking_id` | varchar (PK) | Utilisé dans WHERE |
| `status` | varchar | SET → `'completed'` |
| `updated_at` | timestamptz | SET → `NOW()` |
| `receiver_user_id` | varchar (FK) | Lu pour contrôle d'accès (SELECT préalable) |
| `slot_id` | varchar (FK nullable) | Lu via sous-requête pour UPDATE service_slots |

### `service_slots`

| Colonne | Type | Modification |
|---|---|---|
| `slot_id` | varchar (PK) | Utilisé dans WHERE (via sous-requête) |
| `slot_status` | varchar | SET → `'completed'` (si `'booked'`) |

### `payments`

| Colonne | Type | Modification |
|---|---|---|
| `payment_id` | varchar (PK) | Non utilisé directement (filtré par `booking_id`) |
| `booking_id` | varchar (FK) | Utilisé dans WHERE |
| `status` | varchar | SET → `'captured'` (si `'authorized'`) |
| `updated_at` | timestamptz | SET → `NOW()` |
