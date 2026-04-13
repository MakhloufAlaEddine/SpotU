# SLICE_14_BUSINESS_RULES.md — Règles métier de la Slice 14
> Basé sur `booking_routes.py:984–1028`.
> Généré le 2026-02-XX.

---

## Règles métier

### BR-01 — Authentification stricte

```
Condition : Token JWT Bearer obligatoire
Échec : HTTP 401
```

L'endpoint `require_auth` vérifie la présence et la validité du token JWT.
Aucune exception : pas d'auth optionnelle ici.

---

### BR-02 — Contrôle d'accès : receiver OU admin

```
Condition : user["user_id"] == booking["receiver_user_id"]
         OU user["role"] == "admin"
Échec : HTTP 403 — "Seul le bénéficiaire peut marquer comme terminé"
```

- Le **receiver** (`receiver_user_id`) peut marquer une réservation comme terminée.
- Un **admin** (`role == "admin"`) peut également le faire.
- Le **payer** (`payer_user_id` / `user_id`) ne peut PAS marquer une réservation comme terminée.
- Un **tiers** ne peut pas non plus.

> ℹ️ Asymétrie par rapport à `/refuse` (receiver uniquement) : `/complete` et `/accept` autorisent l'admin.

---

### BR-03 — Absence de validation du statut courant

```
⚠️ PIÈGE CRITIQUE — Comportement Python à reproduire EXACTEMENT
```

Le code Python **ne vérifie pas** `booking.status` avant de passer à `completed`.
Il n'y a **aucune condition** `if bk["status"] != "accepted"` ou similaire.

**Conséquence :** N'importe quelle réservation peut être marquée `completed`, quel que soit son état actuel :
- `requested` → `completed` ✓ (aucune erreur Python)
- `awaiting_payment` → `completed` ✓
- `accepted` → `completed` ✓ ← cas métier principal attendu
- `confirmed` → `completed` ✓ ← cas métier normal post-paiement
- `refused` → `completed` ✓ (comportement Python, même si absurde)
- `cancelled` → `completed` ✓ (comportement Python, même si absurde)
- `expired` → `completed` ✓

**Java doit reproduire ce comportement** pour assurer la compatibilité stricte avec le Python.
Si l'équipe Java souhaite ajouter une validation (`409` si statut invalide), cela constitue une **divergence volontaire** à documenter dans `KNOWN_GAPS_VS_PYTHON.md`.

---

### BR-04 — Transition booking : [toute valeur] → `completed`

```sql
UPDATE bookings SET status='completed', updated_at=NOW() WHERE booking_id=$1
```

- Aucune condition sur le statut source.
- `updated_at` est toujours mis à jour.

---

### BR-05 — Transition service_slots : `booked` → `completed`

```sql
UPDATE service_slots SET slot_status='completed'
WHERE slot_id = (SELECT slot_id FROM bookings WHERE booking_id=$1)
  AND slot_status='booked'
```

**Scénarios :**

| slot_id | slot_status actuel | Résultat |
|---|---|---|
| Non NULL | `booked` | `slot_status` → `completed` ✓ |
| Non NULL | `reserved` | UPDATE silencieux (0 lignes) |
| Non NULL | `available` | UPDATE silencieux (0 lignes) |
| Non NULL | `completed` | UPDATE silencieux (0 lignes) — idempotent |
| NULL | _n/a_ | Sous-requête → NULL → UPDATE silencieux |

---

### BR-06 — Transition payments : `authorized` → `captured` (DB uniquement)

```sql
UPDATE payments SET status='captured', updated_at=NOW()
WHERE booking_id=$1 AND status='authorized'
```

**Scénarios :**

| pay_status actuel | Résultat |
|---|---|
| `authorized` | `status` → `captured` en DB ✓ |
| `captured` | UPDATE silencieux (idempotent) |
| `requires_authorization` | UPDATE silencieux |
| `cancelled` | UPDATE silencieux |
| `refunded` | UPDATE silencieux |
| NULL / absent | UPDATE silencieux |

> ⚠️ **AUCUN APPEL STRIPE** : La mise à jour de `payments.status` vers `captured` est purement
> interne à la DB. Stripe n'est pas notifié. Ce comportement n'est pas un bug Python :
> dans le flux normal post-`/accept` (Cas A), la capture Stripe a déjà eu lieu lors du `/accept`.
> Ici, le `/complete` se contente de finaliser l'état DB.

---

### BR-07 — Absence de notification push

Le code Python pour la branche `completed` ne contient **aucun appel** à `_push()` ou `send_push_to_user()`.

**Comparaison :**

| Endpoint | Push envoyé |
|---|---|
| `/accept` (Slice 13) | OUI — au payer |
| `/refuse` (Slice 12) | OUI — au payer |
| `/cancel` | OUI — aux deux parties |
| `/complete` (Slice 14) | **NON** |

Java **ne doit pas** ajouter de push notification pour `/complete`.

---

### BR-08 — Idempotence implicite

Il n'existe pas de `early return` comme dans `/accept` et `/refuse`.

```python
# Absent de la branche completed :
# if bk["status"] == "completed":
#     return {"success": True, "status": "completed", "idempotent": True}
```

Si le booking est **déjà** `completed` :
- UPDATE bookings s'exécute (0 changement réel sur `status`, mais `updated_at` est remis à NOW())
- UPDATE service_slots → 0 lignes (`slot_status='completed'` ne match plus `='booked'`)
- UPDATE payments → 0 lignes (`status='captured'` ne match plus `='authorized'`)
- Réponse : `{"success": True, "status": "completed"}` — aucune erreur

> Java peut choisir d'ajouter un `early return` avec `"idempotent": true` (amélioration).
> Ce serait une **divergence acceptable** à noter.

---

## Résumé des règles

| # | Règle | Criticité |
|---|---|---|
| BR-01 | Auth stricte — 401 si absent | CRITIQUE |
| BR-02 | Receiver OU admin — 403 si autre | CRITIQUE |
| BR-03 | Pas de garde sur statut courant | PIÈGE — reproduire exactement |
| BR-04 | bookings → completed, updated_at | OBLIGATOIRE |
| BR-05 | service_slots → completed si booked | OBLIGATOIRE (sous-requête corrélée) |
| BR-06 | payments → captured si authorized (DB seulement) | OBLIGATOIRE (pas de Stripe) |
| BR-07 | Aucune push notification | OBLIGATOIRE — ne pas en ajouter |
| BR-08 | Idempotence implicite (pas d'early return) | À REPRODUIRE (ou divergence documentée) |

---

## Ce qui est HORS scope (intentionnellement exclu)

| Élément | Raison |
|---|---|
| Stripe capture API | Non présent dans le code Python pour cette branche |
| Stripe refund | Non applicable (`complete` n'est pas `cancel`) |
| Push notification | Non présent dans le code Python |
| Workers d'expiry | Non impactés par cette transition |
| WebSockets | Non utilisés |
| Admin booking complet | Admin peut appeler `/complete`, mais pas de dashboard admin spécifique |
