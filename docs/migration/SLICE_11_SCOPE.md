# SLICE_11_SCOPE.md — Cadrage de la Slice 11
> Basé sur `booking_routes.py:1035–1110`, `BOOKING_FIELDS:69–77`, `_fetch_booking:91–100`, `_deserialize:80–87`, `001_initial_schema.sql:42–67`, `server.py:101`.
> Généré le 2026-02-XX.

---

## Justification du choix de cette slice

### Pourquoi les 3 GET booking ensemble ?

Les 3 endpoints GET booking forment un **groupe cohérent et minimal** :

| Critère | Valeur |
|---|---|
| Lecture seule | ✅ Aucun side effect, aucun write DB |
| Auth | ✅ Identique sur les 3 (`require_auth` strict — jamais optionnelle) |
| Projection SQL partagée | ✅ `BOOKING_FIELDS` utilisé dans les 3 |
| Dépendances | ✅ Uniquement `bookings`, `services`, `users`, `service_slots` — pas de Stripe, pas de workers |
| Expérience utilisateur | ✅ Les 3 forment la vue complète "mes réservations" |
| Complexité | ✅ FAIBLE à MOYEN — pas de JSONB complexe sauf `pricing_snapshot` |

### Pourquoi ne pas commencer par le booking write ?

- `POST /bookings/request` : Dépend de `pricing_engine`, `stripe_service`, slots avec `FOR UPDATE NOWAIT`, workers d'expiry → trop de dépendances pour une première slice
- `POST /bookings/{id}/accept` : Logique Stripe payment intent, slots concurrents
- Ces endpoints nécessitent d'abord que les lectures soient en place et testées

---

## Endpoints inclus

| # | Méthode | Chemin Python principal | Alias Python | Chemin Java | Fichier | Lignes |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/bookings/me` | `/api/users/me/bookings` | `/api/bookings/me` | `booking_routes.py` | 1035–1056 |
| 2 | GET | `/api/bookings/received` | `/api/receiver/requests` | `/api/bookings/received` | `booking_routes.py` | 1059–1077 |
| 3 | GET | `/api/bookings/{booking_id}` | (aucun) | `/api/bookings/{bookingId}` | `booking_routes.py` | 1080–1110 |

**Montage dans `server.py:101` :**
```python
api_router.include_router(booking_router, tags=["bookings"])
# Sans préfixe router → routes sous /api/
```

### Aliases Python (double routing)

| Endpoint principal | Alias | Stratégie Java |
|---|---|---|
| `GET /bookings/me` | `GET /users/me/bookings` | Exposer les deux (Spring : 2 `@GetMapping` sur la même méthode) |
| `GET /bookings/received` | `GET /receiver/requests` | Exposer les deux (même méthode Java) |

**Note d'arbitrage :** Les aliases Python sont actifs en production — le frontend mobile peut appeler l'un ou l'autre. Les deux chemins doivent être disponibles en Java.

---

## Endpoints explicitement exclus de cette slice

| Endpoint | Raison |
|---|---|
| `POST /bookings/price-preview` | Logique pricing_engine, write-like |
| `POST /bookings/request` | Write + Stripe + workers + slot locks |
| `POST /bookings` | Alias write |
| `POST /bookings/{id}/accept` | Write + Stripe payment intent |
| `POST /bookings/{id}/pay` | Stripe intégration |
| `POST /bookings/{id}/refuse` | Write |
| `POST/DELETE /bookings/{id}/cancel` | Write + notifications push |
| `PATCH /bookings/{id}/status` | Write |

---

## Auth

### Comportement Python (CONSTAT CERTAIN)

```python
# Les 3 GET — même pattern
user = await require_auth(request, pool)
```

`require_auth` est défini dans `auth_utils.py`. Il :
1. Extrait le JWT du header `Authorization: Bearer <token>`
2. Lève `HTTPException(401, "Non authentifié")` si absent ou invalide
3. Charge l'utilisateur depuis `users` en DB
4. Lève `HTTPException(401, "Utilisateur introuvable ou désactivé")` si not found

→ **Auth STRICTE sur les 3 endpoints** — aucune tolérance au token invalide, contrairement aux slices 04/06/09.

---

## Dépendances

| Dépendance | Type | Endpoint | Détail |
|---|---|---|---|
| Table `bookings` | DB (principale) | Les 3 | `BOOKING_FIELDS` — 22 colonnes |
| Table `services` | DB (JOIN LEFT) | Les 3 | `s.title, s.address, [s.images, s.description]` |
| Table `users` | DB (JOIN LEFT x2) | Me + Détail | `u_recv.name/picture` et `u_pay.name/picture` |
| Table `service_slots` | DB (JOIN LEFT) | Me + Détail | `start_time, end_time, slot_date, slot_type` |
| `_deserialize()` | Fonction Python | Les 3 | Parse `pricing_snapshot` JSON string → dict |
| `require_auth` | Auth util | Les 3 | JWT + DB lookup — `auth_utils.py` |
| `row_to_dict()` | Util DB | Les 3 | Conversion asyncpg Row → dict Python |

---

## Niveau de risque

**MOYEN** (pas élevé, mais attention à 4 points précis)

| Point | Risque |
|---|---|
| `pricing_snapshot` | JSONB qui peut être une string legacy → parsing conditionnel obligatoire |
| `COALESCE(receiver_user_id, coach_id)` | Lookup receiver sur 2 colonnes — erreur fréquente de migration |
| Contrôle d'accès au détail | Set à 4 champs `{user_id, payer_user_id, receiver_user_id, coach_id}` + role admin — règle de visibilité complexe |
| Doubles chemins | Aliases Python actifs en production → Java doit les exposer tous |

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | `pricing_snapshot` peut être string ou dict | Héritage : certains anciens bookings ont `pricing_snapshot` stocké en JSON string dans JSONB. `_deserialize()` gère les deux. En Java : tenter `objectMapper.readValue()` si la valeur est une String, sinon mapper directement |
| P2 | `COALESCE(b.receiver_user_id, b.coach_id)` | Pour le lookup du receiver en `/me` et `/détail`, Python utilise `COALESCE(receiver_user_id, coach_id)`. Idem pour le payer : `COALESCE(payer_user_id, user_id)`. Ne pas utiliser uniquement `receiver_user_id` |
| P3 | Contrôle d'accès — 4 champs | Dans `GET /bookings/{id}`, l'accès est autorisé si le user_id courant est dans `{user_id, payer_user_id, receiver_user_id, coach_id}`. Oublier un champ = fuite ou blocage involontaire |
| P4 | `/me` filtre sur `user_id`, `/received` filtre sur `receiver_user_id` | Les deux sont des UUID utilisateur mais filtrent sur **des colonnes différentes**. Ne pas confondre les deux clauses WHERE |
| P5 | Pas de pagination sur aucun des 3 | Aucun LIMIT, aucun OFFSET. Retourner la liste complète toujours |
| P6 | `slot_date` est un TEXT (pas un DATE) | La colonne `service_slots.slot_date` est de type `text` en base — retourner tel quel, ne pas tenter de parser en `LocalDate` |
