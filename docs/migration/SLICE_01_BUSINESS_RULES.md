# SLICE_01_BUSINESS_RULES.md — Règles métier exactes
> Basé sur `server.py:183–237` + données DB live.  
> Format par règle : `SOURCE` | `NIVEAU DE CONFIANCE` | `AMBIGUÏTÉS`

---

## Règles pour GET /api/config/booking

---

### BR-01 — Lecture de la config de réservation

**Source** : `server.py:192–195`  
**Niveau de confiance** : CERTAIN  

La config est lue depuis la DB à chaque appel. Il n'y a **pas de cache**.  
Chaque requête effectue un `SELECT` frais.

```python
rows = await conn.fetch("SELECT config_key, config_value FROM app_config WHERE config_key IN (...)")
cfg = {r["config_key"]: r["config_value"] for r in rows}
```

**Java** : pas de `@Cacheable`. Appel DB direct à chaque requête (comportement identique à Python).

---

### BR-02 — Conversion booléenne

**Source** : `server.py:197–198`  
**Niveau de confiance** : CERTAIN  

Les valeurs en DB sont des chaînes TEXT (`"true"` ou `"false"`), jamais des booléens natifs.  
La conversion est une comparaison stricte : `config_value == "true"`.

```python
"enable_manual_approval_for_services": cfg.get("...","false") == "true"
```

**Règle exacte** :
- `"true"` → `true`
- `"false"` → `false`
- toute autre valeur (ex: `"TRUE"`, `"1"`, `"yes"`) → `false` (car `!= "true"`)
- clé absente → `false` (fallback `"false" == "true"` → false)

**Java** :
```java
boolean result = "true".equals(cfg.getOrDefault("enable_manual_approval_for_services", "false"));
```

---

### BR-03 — Conversion entière pour `pay_now_checkout_minutes`

**Source** : `server.py:199`  
**Niveau de confiance** : CERTAIN  

```python
int(cfg.get("pay_now_checkout_minutes", "30"))
```

**Règles** :
- La valeur en DB est une chaîne (`"5"`)
- Convertie via `int()` Python → entier strict (pas de décimale)
- Si la chaîne n'est pas un entier valide → `ValueError` Python (exception non gérée → 500)
- Fallback si clé absente : `30` (entier)

**Java** :
```java
int minutes = Integer.parseInt(cfg.getOrDefault("pay_now_checkout_minutes", "30"));
// NumberFormatException si valeur corrompue → laisser propager (comportement Python identique)
```

---

### BR-04 — Ordre des priorités

**Source** : `server.py:196–199`  
**Niveau de confiance** : CERTAIN  

Ordre de priorité dans la construction de la réponse :
1. Valeur en DB si la clé existe
2. Fallback codé en dur si la clé est absente

Il n'existe pas de "config par environnement" ou de surcharge via variable d'env.

---

## Règles pour GET /api/config/commission

---

### BR-05 — Conversion NUMERIC → float

**Source** : `server.py:229–234`  
**Niveau de confiance** : CERTAIN  

asyncpg (driver Python pour PostgreSQL) retourne les colonnes `NUMERIC` sous forme de `Decimal` Python.  
Python appelle `float()` pour convertir.

```python
float(row["payer_percent_fee"])   # Decimal("5.00") → 5.0
```

**Java — JDBC** : `rs.getDouble("payer_percent_fee")` retourne un `double` Java.  
`BigDecimal` via `rs.getBigDecimal(...)` puis `.doubleValue()` est aussi valide.

**Risque** : les NUMERIC(x,y) avec beaucoup de décimales peuvent avoir des erreurs de précision float. Les valeurs actuelles sont entières (5.00, 10.00, 0.00) → pas de risque pratique.

---

### BR-06 — Calcul de `total_percent_fee`

**Source** : `server.py:229`  
**Niveau de confiance** : CERTAIN  

```python
total_pct = float(row["payer_percent_fee"]) + float(row["receiver_percent_fee"])
```

**Règle** : addition simple de deux doubles.  
**Pas d'arrondi** appliqué. `5.0 + 10.0 = 15.0` (exact en IEEE 754).  
**Pas de multiplication** (c'est un taux en %, pas un montant).

**Java** :
```java
double totalPct = payerPctFee + receiverPctFee;  // pas de Math.round()
```

---

### BR-07 — Sélection de la règle active

**Source** : `server.py:212–218`  
**Niveau de confiance** : CERTAIN  

```sql
WHERE product_type = 'service_booking' AND active = TRUE
ORDER BY priority DESC, created_at DESC
LIMIT 1
```

**Règles** :
- `product_type` est figé à `'service_booking'` — pas de paramètre dynamique
- `active = TRUE` filtre les règles désactivées (6 règles inactives ignorées en DB)
- Si plusieurs règles actives : la plus haute priorité gagne
- À priorité égale : la plus récente gagne (`created_at DESC`)
- Actuellement : 1 seule règle active, `priority=0`

---

### BR-08 — Fallback si aucune règle active

**Source** : `server.py:220–228`  
**Niveau de confiance** : CERTAIN  

```python
if not row:
    return {
        "payer_percent_fee": 0,
        "payer_fixed_fee": 0,
        "receiver_percent_fee": 0,
        "receiver_fixed_fee": 0,
        "total_percent_fee": 0,
        "has_rule": False,
    }
```

**Règles** :
- Retourner HTTP 200 (pas 404, pas 204)
- `has_rule: false`
- Tous les frais à `0` (entiers Python, pas `0.0`)
- NE PAS lever d'exception

**Java** : retourner un `CommissionConfigResponse` avec tous les champs à `0.0` et `hasRule=false`.

---

### BR-09 — `has_rule` est calculé, pas stocké

**Source** : `server.py:228, 236`  
**Niveau de confiance** : CERTAIN  

`has_rule` n'existe pas en DB. C'est un champ calculé à la volée :
- `has_rule = True` si une ligne a été trouvée
- `has_rule = False` si `fetchrow()` retourne `None`

---

### BR-10 — Différence de type numérique selon `has_rule`

**Source** : `server.py:220–237`  
**Niveau de confiance** : CERTAIN — AMBIGUÏTÉ MINEURE  

Quand `has_rule=false` : Python retourne des littéraux entiers `0` (pas `0.0`).  
Quand `has_rule=true` : Python retourne des `float` (ex: `5.0`, `0.0`).

En JSON, `0` et `0.0` sont sérialisés différemment (`0` vs `0.0`).  
**Le frontend ne doit pas distinguer les deux** (la spec JSON traite les deux comme des nombres).

**Java** : utiliser `double` dans le DTO dans les deux cas → JSON produira `0.0` même pour `has_rule=false`. Comportement légèrement différent du Python mais fonctionnellement équivalent.

---

### BR-11 — Aucun auth, aucune validation d'entrée

**Source** : `server.py:184, 203`  
**Niveau de confiance** : CERTAIN  

Les deux endpoints :
- N'ont aucun paramètre d'entrée
- Ne valident rien
- Ne vérifient aucun rôle

**Java** : pas de `@PreAuthorize`, pas de `@AuthenticationPrincipal`.

---

### Tableau récapitulatif

| # | Règle | Confiance | Ambiguïté |
|---|---|---|---|
| BR-01 | Pas de cache — DB fresh à chaque call | CERTAIN | Aucune |
| BR-02 | Boolean via `== "true"` (case-sensitive) | CERTAIN | Aucune |
| BR-03 | Integer via `int()` — fallback 30 | CERTAIN | Aucune |
| BR-04 | DB > fallback codé, pas de config env | CERTAIN | Aucune |
| BR-05 | NUMERIC → float via `float()` | CERTAIN | Précision float si valeurs > 6 décimales |
| BR-06 | total = payer_pct + receiver_pct (addition brute) | CERTAIN | Aucune |
| BR-07 | LIMIT 1, ORDER BY priority DESC, created_at DESC | CERTAIN | Aucune |
| BR-08 | Fallback zéro + has_rule=false si pas de règle | CERTAIN | Aucune |
| BR-09 | has_rule calculé, non stocké | CERTAIN | Aucune |
| BR-10 | Type numérique int vs float selon has_rule | CERTAIN | Impact JSON mineur |
| BR-11 | Pas d'auth, pas de validation d'entrée | CERTAIN | Aucune |
