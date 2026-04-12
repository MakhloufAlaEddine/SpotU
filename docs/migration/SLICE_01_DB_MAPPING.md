# SLICE_01_DB_MAPPING.md — Mapping DB exact
> Basé sur inspection directe de la DB Supabase (live) + `server.py:183–237`.  
> Généré le 2026-04-12.

---

## ENDPOINT 1 — GET /api/config/booking

### Table lue : `app_config`

#### Schéma complet (vérifié en DB)

```sql
CREATE TABLE app_config (
    config_key   TEXT NOT NULL,          -- clé primaire de fait (pas de PK déclarée)
    config_value TEXT NOT NULL,          -- toujours une chaîne, même pour les booléens et entiers
    updated_at   TIMESTAMPTZ DEFAULT now()
);
```

> **Point critique** : il n'y a PAS de contrainte PRIMARY KEY déclarée sur `config_key` dans le schéma observé. En pratique, les clés sont uniques (3 lignes, 3 clés distinctes).

#### Requête SQL Python (exacte, `server.py:192–194`)

```sql
SELECT config_key, config_value
FROM app_config
WHERE config_key IN (
    'enable_manual_approval_for_services',
    'enable_pay_later_for_services',
    'pay_now_checkout_minutes'
)
```

#### Lignes actuellement présentes (live, 2026-04-12)

| config_key | config_value | updated_at |
|---|---|---|
| `enable_manual_approval_for_services` | `"false"` | 2026-04-07T15:58:25Z |
| `enable_pay_later_for_services` | `"false"` | 2026-04-01T19:27:10Z |
| `pay_now_checkout_minutes` | `"5"` | 2026-04-07T15:58:40Z |

#### Colonnes utilisées

| Colonne | Utilisée | Role |
|---|---|---|
| `config_key` | OUI | Filtre `IN (...)` et clé du dict Python |
| `config_value` | OUI | Valeur brute (TEXT) à convertir |
| `updated_at` | **NON** | Non retournée dans la réponse |

#### Transformations Python appliquées

```python
cfg = {r["config_key"]: r["config_value"] for r in rows}  # dict TEXT→TEXT

# Boolean : comparaison de chaîne
enable_manual = cfg.get("enable_manual_approval_for_services", "false") == "true"
enable_pay_later = cfg.get("enable_pay_later_for_services", "false") == "true"

# Integer : conversion de chaîne
pay_now_minutes = int(cfg.get("pay_now_checkout_minutes", "30"))
```

#### Logique de fallback

| Clé | Valeur fallback Python | Source |
|---|---|---|
| `enable_manual_approval_for_services` | `"false"` → `false` | `server.py:197` |
| `enable_pay_later_for_services` | `"false"` → `false` | `server.py:198` |
| `pay_now_checkout_minutes` | `"30"` → `30` | `server.py:199` |

#### Reproduction Java recommandée

```java
// Repository : requête JDBC nommée
String sql = """
    SELECT config_key, config_value FROM app_config
    WHERE config_key IN (
        'enable_manual_approval_for_services',
        'enable_pay_later_for_services',
        'pay_now_checkout_minutes'
    )
""";
Map<String, String> cfg = jdbcTemplate.query(sql, rs -> {
    Map<String, String> map = new HashMap<>();
    while (rs.next()) map.put(rs.getString("config_key"), rs.getString("config_value"));
    return map;
});
// Conversions
boolean manualApproval = "true".equals(cfg.getOrDefault("enable_manual_approval_for_services", "false"));
boolean payLater       = "true".equals(cfg.getOrDefault("enable_pay_later_for_services", "false"));
int     checkoutMinutes = Integer.parseInt(cfg.getOrDefault("pay_now_checkout_minutes", "30"));
```

---

## ENDPOINT 2 — GET /api/config/commission

### Table lue : `pricing_rules`

#### Schéma complet (vérifié en DB)

```sql
CREATE TABLE pricing_rules (
    rule_id              TEXT NOT NULL,          -- format "rule_<hex12>"
    product_type         TEXT NOT NULL,          -- ex: "service_booking"
    name                 TEXT NOT NULL,
    payer_fixed_fee      NUMERIC DEFAULT 0,      -- NULL possible théoriquement (default=0)
    payer_percent_fee    NUMERIC DEFAULT 0,      -- idem
    receiver_fixed_fee   NUMERIC DEFAULT 0,      -- idem
    receiver_percent_fee NUMERIC DEFAULT 0,      -- idem
    active               BOOLEAN DEFAULT TRUE,
    priority             INTEGER DEFAULT 0,
    created_at           TIMESTAMPTZ DEFAULT now(),
    updated_at           TIMESTAMPTZ DEFAULT now(),
    description          TEXT,                   -- NULLable
    currency             TEXT DEFAULT 'EUR'
);
```

#### Requête SQL Python (exacte, `server.py:212–218`)

```sql
SELECT payer_fixed_fee,
       payer_percent_fee,
       receiver_fixed_fee,
       receiver_percent_fee
FROM pricing_rules
WHERE product_type = 'service_booking'
  AND active = TRUE
ORDER BY priority DESC, created_at DESC
LIMIT 1
```

#### Lignes actives actuelles (live, 2026-04-12)

| rule_id | product_type | payer_% | payer_fixed | receiver_% | receiver_fixed | active | priority |
|---|---|---|---|---|---|---|---|
| `rule_8f2eb3914d15` | `service_booking` | 5.00 | 0.00 | 10.00 | 0.00 | TRUE | 0 |

> Il y a 7 règles en DB pour `service_booking`, 6 inactives et 1 active. Seule la règle active est retournée.

#### Colonnes utilisées vs disponibles

| Colonne | Utilisée | Retournée | Note |
|---|---|---|---|
| `payer_fixed_fee` | OUI | OUI | NUMERIC → float Python → double Java |
| `payer_percent_fee` | OUI | OUI | idem |
| `receiver_fixed_fee` | OUI | OUI | idem |
| `receiver_percent_fee` | OUI | OUI | idem |
| `active` | OUI (filtre WHERE) | NON | — |
| `product_type` | OUI (filtre WHERE) | NON | valeur figée `'service_booking'` |
| `priority` | OUI (ORDER BY) | NON | — |
| `created_at` | OUI (ORDER BY) | NON | — |
| `rule_id` | NON | NON | Non retourné |
| `name` | NON | NON | Non retourné |
| `currency` | NON | NON | **Non retourné** (présent en DB, ignoré dans la réponse) |
| `description` | NON | NON | Non retourné |

> **IMPORTANT** : `currency` est en DB (`'EUR'` par défaut) mais **n'est pas retourné** dans la réponse Python. Ne pas l'ajouter en Java (rupture de contrat).

#### Transformations Python appliquées

```python
# Conversion NUMERIC → float (asyncpg retourne Decimal)
payer_percent   = float(row["payer_percent_fee"])    # Decimal("5.00") → 5.0
payer_fixed     = float(row["payer_fixed_fee"])       # Decimal("0.00") → 0.0
receiver_percent = float(row["receiver_percent_fee"]) # Decimal("10.00") → 10.0
receiver_fixed   = float(row["receiver_fixed_fee"])   # Decimal("0.00") → 0.0

# total calculé
total_pct = payer_percent + receiver_percent          # 5.0 + 10.0 = 15.0
```

#### Reproduction Java recommandée

```java
String sql = """
    SELECT payer_fixed_fee, payer_percent_fee,
           receiver_fixed_fee, receiver_percent_fee
    FROM pricing_rules
    WHERE product_type = 'service_booking' AND active = TRUE
    ORDER BY priority DESC, created_at DESC
    LIMIT 1
""";
// BigDecimal via JDBC, puis .doubleValue()
// OU utiliser rs.getDouble(...) directement (PostgreSQL NUMERIC → Java double via JDBC)
```

---

## Config applicative utilisée (hors DB)

**Aucune.** Les deux endpoints ne lisent aucune variable d'environnement Spring (`application.yml`, `@Value`, etc.).  
Tout provient exclusivement de la DB.

---

## Points à ne pas briser

| # | Règle |
|---|---|
| NB-01 | La requête sur `app_config` utilise `IN (3 clés)` — NE PAS faire 3 requêtes séparées |
| NB-02 | La requête sur `pricing_rules` utilise `LIMIT 1` — NE PAS paginer ou retourner une liste |
| NB-03 | `product_type = 'service_booking'` est une chaîne figée — NE PAS la rendre configurable |
| NB-04 | `ORDER BY priority DESC, created_at DESC` — reproduire cet ordre exact |
| NB-05 | `currency` est présent en DB mais absent de la réponse — NE PAS l'ajouter |
| NB-06 | La colonne `updated_at` de `app_config` n'est pas retournée — NE PAS l'inclure |
