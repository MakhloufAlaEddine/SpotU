# SLICE_11_BUSINESS_RULES.md — Règles métier
> Basé sur `booking_routes.py:1035–1110`, `BOOKING_FIELDS:69–77`, `001_initial_schema.sql`.
> Généré le 2026-02-XX.

---

## RG-01 — Auth stricte sur tous les endpoints

**Source :** `booking_routes.py:1040, 1064, 1084` — `await require_auth(request, pool)`

Les 3 endpoints appliquent `require_auth`. Contrairement aux slices 04/06/09, ici :
- **Aucune tolérance** au token invalide ou absent
- **401 immédiat** si token manquant, malformé, expiré, ou si l'utilisateur est désactivé
- Pas de mode "optionnel" — jamais de `get_optional_auth`

---

## RG-02 — /me filtre sur user_id (rôle payer)

**Source :** `booking_routes.py:1052` — `WHERE b.user_id = $1`

`GET /bookings/me` retourne **exclusivement** les bookings où l'utilisateur courant est le **payer** (`b.user_id`).

Un coach/receiver qui consulte `/bookings/me` voit ses propres achats de services (s'il est aussi client), pas les bookings qu'il a reçus.

**Implication :** Un même utilisateur peut avoir des bookings dans `/me` ET dans `/received` selon son rôle dans chaque booking.

---

## RG-03 — /received filtre sur receiver_user_id (rôle receiver/coach)

**Source :** `booking_routes.py:1073` — `WHERE b.receiver_user_id = $1`

`GET /bookings/received` retourne **exclusivement** les bookings où l'utilisateur courant est le **receiver** (`b.receiver_user_id`).

**Nota bene :** La colonne `coach_id` est le champ legacy. La colonne `receiver_user_id` est le champ post-migration. Le code Python filtre sur `receiver_user_id` uniquement — **pas de COALESCE dans le WHERE**.

Si un ancien booking a `receiver_user_id=null` et `coach_id=<user_id>`, il n'apparaît **pas** dans `/received`. C'est le comportement Python actuel — le reproduire fidèlement.

---

## RG-04 — Contrôle d'accès au détail — 4 champs + admin

**Source :** `booking_routes.py:1107–1109`

```python
allowed = {d.get("user_id"), d.get("payer_user_id"), d.get("receiver_user_id"), d.get("coach_id")}
if uid not in allowed and user.get("role") != "admin":
    raise HTTPException(403, "Accès refusé")
```

Règle : un utilisateur peut voir le détail d'un booking si son `user_id` est dans **l'un** des 4 champs suivants du booking :
1. `user_id` (payer legacy)
2. `payer_user_id` (payer explicite)
3. `receiver_user_id` (receiver explicite)
4. `coach_id` (receiver legacy)

OU si son `role` est `"admin"`.

**Séquence en Java :**
```
1. Charger le booking (404 si inexistant)
2. Construire le Set : {user_id, payer_user_id, receiver_user_id, coach_id}
3. Si uid ∉ Set ET role != "admin" → lever AccessDeniedException (403)
4. Sinon retourner le booking enrichi
```

**Pièges :**
- Le Set peut contenir `null` (champs nullable) → `Set.contains(uid)` avec uid non-null ne matchera pas les null → comportement correct
- Ne pas ajouter de vérification `!= null` sur le set — laisser Python décider si un null coincide

---

## RG-05 — COALESCE pour le lookup receiver

**Source :** `booking_routes.py:1050` (me) et `booking_routes.py:1096` (détail)

```sql
LEFT JOIN users u_recv ON u_recv.user_id = COALESCE(b.receiver_user_id, b.coach_id)
```

Pour retrouver le nom/photo du receiver, Python utilise `COALESCE(receiver_user_id, coach_id)`.

Raison : la migration des colonnes a renommé `coach_id` → `receiver_user_id`, mais d'anciens bookings peuvent avoir `receiver_user_id=null` avec `coach_id` rempli.

**En Java :** reproduire exactement le COALESCE dans la requête SQL — ne pas tenter de le résoudre en application.

---

## RG-06 — COALESCE pour le lookup payer (détail uniquement)

**Source :** `booking_routes.py:1097` (détail uniquement)

```sql
LEFT JOIN users u_pay ON u_pay.user_id = COALESCE(b.payer_user_id, b.user_id)
```

Même logique : `payer_user_id` est la colonne moderne, `user_id` est le fallback legacy.

**Différence importante :** Dans `/received`, le JOIN payer utilise `b.payer_user_id` directement **sans COALESCE** :
```sql
-- /received — booking_routes.py:1071
LEFT JOIN users u_pay ON u_pay.user_id = b.payer_user_id
```

Ne pas uniformiser les deux — respecter l'asymétrie Python.

---

## RG-07 — pricing_snapshot — parsing conditionnel

**Source :** `booking_routes.py:80–87` — `_deserialize()`

`pricing_snapshot` peut être :
- `null` → retourner null
- Un objet JSONB natif (asyncpg le dé-sérialise automatiquement) → retourner tel quel
- Une chaîne JSON (anciens bookings) → parser et retourner l'objet

La fonction `_deserialize()` est appelée **sur chaque booking** avant sérialisation.

**Contenu typique :**
```json
{
  "base_price": 60.0,
  "commission_rate": 0.10,
  "commission_amount": 6.0,
  "total": 66.0,
  "currency": "EUR"
}
```

---

## RG-08 — Pas de pagination sur aucun endpoint

**Source :** `booking_routes.py:1042–1055, 1066–1076, 1086–1109`

Aucun LIMIT, OFFSET, ou paramètre de pagination dans les 3 endpoints.

Comportement : liste complète retournée. Si un utilisateur a 1000 bookings, tous sont retournés.

**En Java :** Ne pas ajouter de pagination non présente en Python. Retourner toujours `List<BookingDto>` complète.

---

## RG-09 — Doubles chemins (aliases)

**Source :** `booking_routes.py:1035–1036, 1059–1060`

```python
@router.get("/bookings/me")
@router.get("/users/me/bookings")
async def my_bookings(request: Request): ...

@router.get("/bookings/received")
@router.get("/receiver/requests")
async def received_bookings(request: Request): ...
```

Les deux chemins sont **actifs simultanément** en production Python. Le frontend mobile peut utiliser l'un ou l'autre selon la version de l'app.

**En Java :**
```java
@GetMapping({"/bookings/me", "/users/me/bookings"})
public ResponseEntity<List<BookingDto>> myBookings(...) { ... }

@GetMapping({"/bookings/received", "/receiver/requests"})
public ResponseEntity<List<BookingDto>> receivedBookings(...) { ... }
```

---

## RG-10 — Enrichissement asymétrique selon l'endpoint

**Source :** comparaison des 3 SQL dans `booking_routes.py:1042–1055, 1066–1076, 1086–1109`

Les 3 endpoints **ne retournent pas les mêmes champs d'enrichissement** :

| Enrichissement | /me | /received | /détail |
|---|---|---|---|
| Slot horaires + date | ✅ | ❌ | ✅ |
| Receiver name + picture | ✅ | ❌ | ✅ |
| Payer name | ❌ | ✅ | ✅ |
| Payer picture | ❌ | ❌ | ✅ |
| Service images + description | ❌ | ❌ | ✅ |
| Service address | ✅ | ❌ | ✅ |

Cette asymétrie est **intentionnelle** — la liste des bookings reçus est plus légère (pas d'horaires, pas d'adresse).

**En Java :** créer 3 DTOs distincts (ou un DTO commun + des champs nullable) pour refléter cette asymétrie.

---

## RG-11 — Pas de filtre sur le statut

**Source :** `booking_routes.py:1052, 1073`

Aucun filtre sur `b.status` dans `/me` ou `/received`. Tous les statuts sont retournés : `requested`, `awaiting_payment`, `confirmed`, `refused`, `cancelled`, `expired`, `completed`.

**En Java :** ne pas ajouter de filtre de statut. Le frontend filtre côté client si nécessaire.

---

## Cohérence avec les slices précédentes

| Slice | Lien avec Slice 11 |
|---|---|
| Slice 02 (`require_auth`) | Même mécanisme JWT + DB lookup utilisé ici |
| Slice 03 (`GET /users/me`) | Même user courant, même authentification |
| Slice 09 (`GET /services/{id}`) | `services.title`, `services.address`, `services.images` déjà mappés |

---

## Niveau de confiance global

| Règle | Confiance | Source |
|---|---|---|
| RG-01 auth stricte | HAUTE | `require_auth` sans fallback confirmé dans les 3 handlers |
| RG-02 filtre user_id | HAUTE | WHERE explicite ligne 1052 |
| RG-03 filtre receiver_user_id | HAUTE | WHERE explicite ligne 1073 |
| RG-04 accès détail 4 champs | HAUTE | Code lignes 1107-1109 |
| RG-05 COALESCE receiver | HAUTE | SQL lignes 1050, 1096 |
| RG-06 COALESCE payer (détail) | HAUTE | SQL ligne 1097 vs 1071 |
| RG-07 pricing_snapshot | HAUTE | `_deserialize()` code lignes 80-87 |
| RG-08 pas de pagination | HAUTE | Aucun LIMIT dans les 3 SQL |
| RG-09 doubles chemins | HAUTE | `@router.get` décoré deux fois |
| RG-10 enrichissement asymétrique | HAUTE | SELECT différents confirmés |
| RG-11 pas de filtre statut | HAUTE | Aucune clause status dans WHERE |
