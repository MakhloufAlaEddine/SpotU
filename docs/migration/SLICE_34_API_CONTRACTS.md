# SLICE_34_API_CONTRACTS.md — Contrats API Payment Reads
> Basé sur `routes/payment_routes.py:41–80`.
> Généré le 2026-04-25.

---

## Endpoint 1 — `GET /api/payments/me`

### Auth : JWT obligatoire (`require_auth`)

| Source | Header / Cookie | Notes |
|---|---|---|
| Header | `Authorization: Bearer <jwt>` | Mode mobile / API direct |
| Cookie | `winek_token=<jwt>` | Mode web fallback (HttpOnly recommandé) |

> Si **aucun** des deux n'est présent ou que le JWT est invalide → **401 `{"detail": "Not authenticated"}`** ou **401 `{"detail": "User not found"}`** (si payload OK mais user supprimé en DB).

### Path / Query / Body
- **Path** : aucun
- **Query** : aucun (pas de pagination, pas de filtre statut)
- **Body** : aucun

### Pipeline backend exact

```
1. token = Authorization header Bearer OU cookie winek_token
   → 401 si absent
2. payload = decode_jwt(token)
   → 401 si signature/exp invalide
3. user = SELECT user_id, email, name, role, ... FROM users WHERE user_id=$payload.user_id
   → 401 "User not found" si user supprimé
4. SELECT p.*,
          u_pay.name AS payer_name,
          u_recv.name AS receiver_name
     FROM payments p
     LEFT JOIN users u_pay  ON u_pay.user_id  = p.payer_user_id
     LEFT JOIN users u_recv ON u_recv.user_id = p.receiver_user_id
    WHERE p.payer_user_id = $uid OR p.receiver_user_id = $uid
    ORDER BY p.created_at DESC
5. Pour chaque row :
   - row_to_dict (Decimal→float, datetime→isoformat)
   - _deserialize (parse pricing_rule_snapshot si string)
6. Retour : List[Dict]
```

### Réponse 200 (exemple)

```json
[
  {
    "payment_id": "pay_abc",
    "booking_id": "bkg_xyz",
    "payer_user_id": "u_buyer",
    "receiver_user_id": "u_coach",
    "amount": 51.75,
    "currency": "eur",
    "status": "captured",
    "stripe_checkout_session_id": "cs_test_xxx",
    "stripe_payment_intent_id": "pi_xxx",
    "stripe_charge_id": "ch_xxx",
    "metadata": {"...": "..."},
    "pricing_rule_snapshot": {"...": "..."},
    "created_at": "2026-04-20T11:37:13.540123+00:00",
    "updated_at": "2026-04-20T11:38:01.000000+00:00",
    "payer_name": "Alice",
    "receiver_name": "Bob"
  },
  ...
]
```

> ⚠️ **Toutes les colonnes** de `payments` sont retournées (`SELECT p.*`). Liste exhaustive selon schéma DB courant.

### Cas liste vide

```json
[]
```

HTTP **200**, pas 404. **Ne pas wrapper dans `{data: [], total: 0}`**.

### Erreurs

| Code | Cas | Body |
|---|---|---|
| 401 | Token absent | `{"detail": "Not authenticated"}` |
| 401 | JWT signature/exp invalide | `{"detail": "Invalid token"}` (selon `decode_jwt`) |
| 401 | User supprimé en DB | `{"detail": "User not found"}` |
| 500 | DB indisponible | (FastAPI default) |

### Effets de bord
- **Aucun**. Lecture pure.

---

## Endpoint 2 — `GET /api/payments/{payment_id}`

### Auth : JWT obligatoire (idem `/me`)

### Path / Query / Body
- **Path** : `payment_id` (string, format `pay_...`)
- **Query** : aucun
- **Body** : aucun

### Pipeline backend exact

```
1-3. (auth identique à /me)
4. row = SELECT * FROM payments WHERE payment_id = $payment_id
5. SI row null → 404 "Payment not found"
6. d = row_to_dict(row)
7. Filtre permissions :
   SI d.payer_user_id != user.user_id
   ET d.receiver_user_id != user.user_id
   ET user.role != 'admin'
     → 403 "Access denied"
8. _deserialize(d)
9. Retour : Dict
```

### Réponse 200 (exemple)

```json
{
  "payment_id": "pay_abc",
  "booking_id": "bkg_xyz",
  "payer_user_id": "u_buyer",
  "receiver_user_id": "u_coach",
  "amount": 51.75,
  "currency": "eur",
  "status": "captured",
  "stripe_checkout_session_id": "cs_test_xxx",
  "stripe_payment_intent_id": "pi_xxx",
  "stripe_charge_id": "ch_xxx",
  "metadata": {...},
  "pricing_rule_snapshot": {...},
  "created_at": "2026-04-20T11:37:13.540123+00:00",
  "updated_at": "2026-04-20T11:38:01.000000+00:00"
}
```

> ⚠️ Pas de `payer_name` / `receiver_name` (pas de JOIN ici, contrairement à `/me`).

### Erreurs

| Code | Cas | Body |
|---|---|---|
| 401 | Auth invalide | (idem `/me`) |
| 403 | User n'est ni payer ni receiver ni admin | `{"detail": "Access denied"}` |
| 404 | `payment_id` introuvable | `{"detail": "Payment not found"}` |

> ⚠️ **Ordre** des checks : 401 (auth) → 404 (existence) → 403 (permissions). **Ne pas inverser** 404 et 403 : un user non autorisé doit voir 404 si la ressource n'existe **pas** (et 403 si elle existe mais n'est pas la sienne). Reproduire ce comportement Python exact (404 d'abord car `if not row` est checké avant les permissions).

### Effets de bord
- **Aucun**. Lecture pure.

---

## Comportements communs

### `_deserialize(d)` (lignes 32–36)

```python
def _deserialize(d: dict) -> dict:
    if d.get("pricing_rule_snapshot") and isinstance(d["pricing_rule_snapshot"], str):
        d["pricing_rule_snapshot"] = json.loads(d["pricing_rule_snapshot"])
    return d
```

**Comportement** :
- Si `pricing_rule_snapshot` est une **string JSON** → parse en dict
- Si déjà un dict (asyncpg JSONB codec) → laisse tel quel
- Si null → laisse tel quel

### Java
```java
private Map<String,Object> deserialize(Map<String,Object> d) {
    Object snap = d.get("pricing_rule_snapshot");
    if (snap instanceof String s && !s.isEmpty()) {
        d.put("pricing_rule_snapshot", objectMapper.readValue(s, Map.class));
    }
    return d;
}
```

> ⚠️ **Conditionnel sur le type**. Si la colonne JPA est mappée en `String` → toujours désérialiser. Si mappée en `Map<String,Object>` (JSONB hibernate) → ne rien faire.

### `row_to_dict` (database.py:53–65)

| Type Python (asyncpg) | Conversion |
|---|---|
| `Decimal` | → `float` (perte précision possible si > 15 digits) |
| objet avec `.isoformat()` (datetime, date, time) | → string ISO 8601 |
| autre | inchangé |

### Java
- `BigDecimal` → Jackson sérialise en number (configurer `WRITE_BIGDECIMAL_AS_PLAIN`)
- `OffsetDateTime` / `Instant` → string ISO via `JavaTimeModule`
- Reproduire exactement le format Python `2026-04-20T11:37:13.540123+00:00` (microsecondes).

> ⚠️ Python `datetime.isoformat()` produit **6 chiffres de microsecondes**. Java `Instant.toString()` produit jusqu'à **9 nanosecondes** ou tronque. **Test à valider** sur format exact.

---

## Codes statut résumé

| Code | Cas | Endpoints |
|---|---|---|
| 200 | Succès | both |
| 401 | Auth absente / invalide / user supprimé | both |
| 403 | Permissions insuffisantes | only `/payments/{id}` |
| 404 | Payment introuvable | only `/payments/{id}` |
| 500 | Erreur serveur (DB down, etc.) | both |

---

## Compatibilité format de réponse

| Aspect | Python | Java doit reproduire |
|---|---|---|
| `/me` → liste vide → `[]` (pas 404) | OUI | ✅ |
| `/me` → ordre `created_at DESC` | OUI | ✅ |
| `/me` → JOIN names ajoutés | OUI | ✅ payer_name, receiver_name |
| `/{id}` → pas de JOIN names | OUI | ✅ |
| `/{id}` → 404 avant 403 | OUI | ✅ |
| Decimal → number JSON | OUI | ✅ pas string |
| datetime → ISO 8601 string | OUI | ✅ format `+00:00` (pas `Z`) |
| `pricing_rule_snapshot` parse si string | OUI | ✅ conditionnel |
| `SELECT *` toutes colonnes | OUI | ✅ ne pas filtrer |

---

## Notes sécurité

- **Pas d'info leak en 404 vs 403** : pour un payment_id existant qui n'appartient pas au user → 403 explicite. Pour un payment_id inexistant → 404. **Ce contraste révèle l'existence/non-existence** d'un payment_id à un attaquant qui essaie de bruteforcer. Reproduire **fidèlement le comportement Python** sans "fixer" cette asymétrie (changement de contrat = casse le front qui peut différencier 404 et 403).

- **Pas de rate limiting** au niveau de ces endpoints (à vérifier côté API gateway / `limiter.py`). Reproduire le comportement actuel.

- **Pas de filtrage par `status`** ni de pagination. **Le front charge tout**. Si un user a 10 000 payments, la réponse peut être grosse. **À noter** mais **ne pas ajouter de pagination en S34** (changement de contrat).
