# SLICE_01_API_CONTRACTS.md — Contrats d'API exacts
> Basé sur `server.py:183–237` + réponses API live + données DB live.  
> Généré le 2026-04-12. Chaque champ est vérifié contre le code source Python.

---

## ENDPOINT 1 — GET /api/config/booking

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin complet | `/api/config/booking` |
| Tag FastAPI | `config` |
| Auth requise | **NON** — public, aucun header JWT attendu |
| Rate limiting | **NON** — non enregistré dans le limiter slowapi |
| Idempotent | OUI (lecture seule) |
| Handler Python | `public_booking_config()` — `server.py:184` |

### Query params

**Aucun.**

### Headers

**Aucun header requis.** Accepte mais ignore `Authorization`.

### Body

**Aucun.**

### Réponse — HTTP 200

```json
{
  "enable_manual_approval_for_services": false,
  "enable_pay_later_for_services": false,
  "pay_now_checkout_minutes": 5
}
```

### Schéma de réponse détaillé

| Champ | Type JSON | Type Java | Obligatoire | Source DB | Fallback si clé absente |
|---|---|---|---|---|---|
| `enable_manual_approval_for_services` | `boolean` | `boolean` | OUI | `app_config` WHERE `config_key='enable_manual_approval_for_services'` → `config_value` | `false` |
| `enable_pay_later_for_services` | `boolean` | `boolean` | OUI | `app_config` WHERE `config_key='enable_pay_later_for_services'` → `config_value` | `false` |
| `pay_now_checkout_minutes` | `integer` | `int` | OUI | `app_config` WHERE `config_key='pay_now_checkout_minutes'` → `config_value` | `30` |

### Valeurs actuelles en DB (live, vérifiées le 2026-04-12)

| Clé | Valeur DB | Valeur retournée |
|---|---|---|
| `enable_manual_approval_for_services` | `"false"` (TEXT) | `false` (boolean) |
| `enable_pay_later_for_services` | `"false"` (TEXT) | `false` (boolean) |
| `pay_now_checkout_minutes` | `"5"` (TEXT) | `5` (int) |

> **ATTENTION** : le fallback codé en dur dans Python pour `pay_now_checkout_minutes` est `"30"`, mais la valeur réelle en DB est `"5"`. Si la clé est supprimée de la DB, Java retournera `30` — comportement identique à Python.

### Codes d'erreur

| Code | Condition | Comportement Python actuel |
|---|---|---|
| 200 | Toujours, même si des clés sont absentes | Retourne les fallbacks |
| 500 | DB inaccessible | FastAPI retourne 500 (non géré explicitement dans le handler) |

> Il n'existe **aucune** gestion d'erreur explicite dans `public_booking_config()`. La DB pool exception remonte et FastAPI génère un 500 générique.

### Exemple réaliste — réponse prod actuelle

```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "enable_manual_approval_for_services": false,
  "enable_pay_later_for_services": false,
  "pay_now_checkout_minutes": 5
}
```

---

## ENDPOINT 2 — GET /api/config/commission

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin complet | `/api/config/commission` |
| Tag FastAPI | `config` |
| Auth requise | **NON** — public, aucun header JWT attendu |
| Rate limiting | **NON** |
| Idempotent | OUI (lecture seule) |
| Handler Python | `public_commission_config()` — `server.py:203` |

### Query params

**Aucun.**

### Headers

**Aucun header requis.**

### Body

**Aucun.**

### Réponse — HTTP 200 (règle active trouvée)

```json
{
  "payer_percent_fee": 5.0,
  "payer_fixed_fee": 0.0,
  "receiver_percent_fee": 10.0,
  "receiver_fixed_fee": 0.0,
  "total_percent_fee": 15.0,
  "has_rule": true
}
```

### Réponse — HTTP 200 (aucune règle active)

```json
{
  "payer_percent_fee": 0,
  "payer_fixed_fee": 0,
  "receiver_percent_fee": 0,
  "receiver_fixed_fee": 0,
  "total_percent_fee": 0,
  "has_rule": false
}
```

> **DIFFÉRENCE DE TYPE** : quand `has_rule=false`, Python retourne des littéraux entiers `0` (pas `0.0`). Quand `has_rule=true`, Python retourne des `float` (`0.0`, `5.0`). En JSON les deux sont valides mais le type Java doit être `double` dans les deux cas pour cohérence.

### Schéma de réponse détaillé

| Champ | Type JSON | Type Java | Obligatoire | Source | Note |
|---|---|---|---|---|---|
| `payer_percent_fee` | `number` | `double` | OUI | `pricing_rules.payer_percent_fee` | `float()` en Python → `doubleValue()` en Java |
| `payer_fixed_fee` | `number` | `double` | OUI | `pricing_rules.payer_fixed_fee` | idem |
| `receiver_percent_fee` | `number` | `double` | OUI | `pricing_rules.receiver_percent_fee` | idem |
| `receiver_fixed_fee` | `number` | `double` | OUI | `pricing_rules.receiver_fixed_fee` | idem |
| `total_percent_fee` | `number` | `double` | OUI | Calculé : `payer_percent_fee + receiver_percent_fee` | Addition Python float — voir BR-06 |
| `has_rule` | `boolean` | `boolean` | OUI | Calculé : `row != null` | `false` si aucune ligne active |

### Valeurs actuelles en DB — règle active (live, vérifiées le 2026-04-12)

```
rule_id             = "rule_8f2eb3914d15"
product_type        = "service_booking"
name                = "Test commission E2E"
payer_fixed_fee     = 0.00  (NUMERIC)
payer_percent_fee   = 5.00  (NUMERIC)
receiver_fixed_fee  = 0.00  (NUMERIC)
receiver_percent_fee= 10.00 (NUMERIC)
active              = TRUE
priority            = 0
currency            = "EUR"
```

### Codes d'erreur

| Code | Condition | Comportement Python actuel |
|---|---|---|
| 200 | Toujours (y compris si aucune règle active) | `has_rule: false` + tous les frais à 0 |
| 500 | DB inaccessible | Exception non gérée → 500 FastAPI générique |

### Exemple réaliste — réponse prod actuelle

```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "payer_percent_fee": 5.0,
  "payer_fixed_fee": 0.0,
  "receiver_percent_fee": 10.0,
  "receiver_fixed_fee": 0.0,
  "total_percent_fee": 15.0,
  "has_rule": true
}
```

---

## Différences entre code Python et comportement observable

| # | Différence | Impact |
|---|---|---|
| D1 | Fallback `pay_now_checkout_minutes` = `"30"` dans le code mais valeur DB = `"5"` | Pas d'impact en prod (clé présente). Impact si clé supprimée. |
| D2 | Réponse nulle `has_rule=false` : Python retourne `0` (int) pas `0.0` (float) | JSON valide dans les deux cas. Java doit retourner `double` = `0.0` ou `0` selon choix. |
| D3 | Aucune gestion d'erreur DB explicite | Java doit choisir : propager 500 ou retourner une réponse de fallback avec `has_rule=false` |
