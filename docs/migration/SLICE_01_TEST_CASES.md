# SLICE_01_TEST_CASES.md — Cas de tests pour Cursor
> Basé sur code Python + données DB live.  
> Généré le 2026-04-12. Format utilisable directement dans JUnit 5 + MockMvc ou TestRestTemplate.

---

## Conventions

- `EXPECTED_PYTHON` = réponse exacte que le backend Python retourne actuellement
- `JAVA_MUST_MATCH` = la réponse Java doit être strictement identique (mêmes champs, mêmes types JSON)
- `DB_STATE` = état de la DB au moment du test

---

## Tests pour GET /api/config/booking

---

### TC-BOOKING-01 — Cas nominal (état actuel de la DB)

**Description** : toutes les 3 clés sont présentes avec leurs valeurs réelles.

**DB_STATE** :
```sql
('enable_manual_approval_for_services', 'false')
('enable_pay_later_for_services', 'false')
('pay_now_checkout_minutes', '5')
```

**Requête** :
```
GET /api/config/booking
```

**EXPECTED_PYTHON** :
```json
HTTP 200
{
  "enable_manual_approval_for_services": false,
  "enable_pay_later_for_services": false,
  "pay_now_checkout_minutes": 5
}
```

**JAVA_MUST_MATCH** : identique.  
**Priorité** : CRITIQUE.

---

### TC-BOOKING-02 — Flags à `true`

**Description** : forcer les deux flags à `"true"` en DB.

**DB_STATE** (à configurer via fixture) :
```sql
UPDATE app_config SET config_value = 'true' WHERE config_key IN ('enable_manual_approval_for_services', 'enable_pay_later_for_services');
UPDATE app_config SET config_value = '60' WHERE config_key = 'pay_now_checkout_minutes';
```

**Requête** :
```
GET /api/config/booking
```

**EXPECTED_PYTHON** :
```json
HTTP 200
{
  "enable_manual_approval_for_services": true,
  "enable_pay_later_for_services": true,
  "pay_now_checkout_minutes": 60
}
```

**JAVA_MUST_MATCH** : identique.  
**Priorité** : ÉLEVÉE.

---

### TC-BOOKING-03 — Clé absente → fallback

**Description** : supprimer `pay_now_checkout_minutes` de la DB.

**DB_STATE** :
```sql
DELETE FROM app_config WHERE config_key = 'pay_now_checkout_minutes';
```

**Requête** :
```
GET /api/config/booking
```

**EXPECTED_PYTHON** :
```json
HTTP 200
{
  "enable_manual_approval_for_services": false,
  "enable_pay_later_for_services": false,
  "pay_now_checkout_minutes": 30
}
```

**JAVA_MUST_MATCH** : `pay_now_checkout_minutes` = `30` (fallback codé en dur).  
**Priorité** : ÉLEVÉE (valide BR-03 + BR-04).

---

### TC-BOOKING-04 — Table `app_config` vide

**Description** : aucune ligne en DB (fixture vide ou mock DB qui retourne 0 lignes).

**DB_STATE** : `app_config` retourne 0 lignes pour le `IN (...)`.

**EXPECTED_PYTHON** :
```json
HTTP 200
{
  "enable_manual_approval_for_services": false,
  "enable_pay_later_for_services": false,
  "pay_now_checkout_minutes": 30
}
```

**JAVA_MUST_MATCH** : tous les fallbacks activés.  
**Priorité** : ÉLEVÉE (valide tous les fallbacks simultanément).

---

### TC-BOOKING-05 — Valeur booléenne en majuscules (cas anormal)

**Description** : `config_value = 'TRUE'` (majuscules) — tester la sensibilité à la casse.

**DB_STATE** :
```sql
UPDATE app_config SET config_value = 'TRUE' WHERE config_key = 'enable_manual_approval_for_services';
```

**EXPECTED_PYTHON** : `false` (car Python compare `== "true"`, case-sensitive).  
**JAVA_MUST_MATCH** : `false`.  
**Priorité** : MOYENNE (compatibilité stricte Python).

---

### TC-BOOKING-06 — DB inaccessible

**Description** : connexion DB échoue (mock `DataSource` qui lève une exception).

**EXPECTED_PYTHON** : HTTP 500 (exception non gérée remonte vers FastAPI).  
**JAVA_MUST_MATCH** : HTTP 500.  
**Note** : ne pas retourner 503 ou 200 avec fallback — le comportement Python est 500 brut.  
**Priorité** : MOYENNE.

---

### TC-BOOKING-07 — Champs supplémentaires absents de la réponse

**Description** : vérifier que `updated_at` et `config_key` ne sont pas dans la réponse.

**Requête** :
```
GET /api/config/booking
```

**Assertion** : la réponse JSON ne contient PAS les champs `updated_at`, `config_key`, `config_value`.  
**Priorité** : MOYENNE (guard contre sur-sérialisation).

---

## Tests pour GET /api/config/commission

---

### TC-COMMISSION-01 — Cas nominal (règle active existante)

**Description** : 1 règle active `product_type='service_booking'`.

**DB_STATE** (état actuel) :
```
rule_id             = "rule_8f2eb3914d15"
payer_percent_fee   = 5.00
payer_fixed_fee     = 0.00
receiver_percent_fee= 10.00
receiver_fixed_fee  = 0.00
active              = TRUE
priority            = 0
```

**Requête** :
```
GET /api/config/commission
```

**EXPECTED_PYTHON** :
```json
HTTP 200
{
  "payer_percent_fee": 5.0,
  "payer_fixed_fee": 0.0,
  "receiver_percent_fee": 10.0,
  "receiver_fixed_fee": 0.0,
  "total_percent_fee": 15.0,
  "has_rule": true
}
```

**JAVA_MUST_MATCH** : identique (types `double`).  
**Priorité** : CRITIQUE.

---

### TC-COMMISSION-02 — Aucune règle active

**Description** : toutes les règles `service_booking` ont `active=FALSE`.

**DB_STATE** :
```sql
UPDATE pricing_rules SET active = FALSE WHERE product_type = 'service_booking';
```

**EXPECTED_PYTHON** :
```json
HTTP 200
{
  "payer_percent_fee": 0,
  "payer_fixed_fee": 0,
  "receiver_percent_fee": 0,
  "receiver_fixed_fee": 0,
  "total_percent_fee": 0,
  "has_rule": false
}
```

**JAVA_MUST_MATCH** : HTTP 200, `has_rule=false`, tous les fees à `0.0` (ou `0`, les deux acceptables en JSON).  
**Priorité** : CRITIQUE (valide BR-08).

---

### TC-COMMISSION-03 — Aucune règle `service_booking` du tout

**Description** : table `pricing_rules` vide ou aucune règle pour `service_booking`.

**EXPECTED_PYTHON** : identique à TC-COMMISSION-02.  
**JAVA_MUST_MATCH** : idem.  
**Priorité** : ÉLEVÉE.

---

### TC-COMMISSION-04 — Plusieurs règles actives, vérification de la priorité

**Description** : 2 règles actives avec des priorités différentes.

**DB_STATE** (via fixture) :
```
Règle A : priority=1, payer_percent=5.0,  created_at=2026-01-01
Règle B : priority=0, payer_percent=10.0, created_at=2026-01-02
```

**EXPECTED_PYTHON** : Règle A retournée (`priority DESC` → 1 > 0).
```json
{ "payer_percent_fee": 5.0, "has_rule": true, ... }
```

**Priorité** : ÉLEVÉE (valide BR-07 ORDER BY priority).

---

### TC-COMMISSION-05 — Priorités égales, tri par date

**Description** : 2 règles actives, même priorité, dates différentes.

**DB_STATE** :
```
Règle A : priority=0, created_at=2026-01-01, payer_percent=3.0
Règle B : priority=0, created_at=2026-01-02, payer_percent=7.0
```

**EXPECTED_PYTHON** : Règle B retournée (`created_at DESC` → 2026-01-02 > 2026-01-01).
```json
{ "payer_percent_fee": 7.0, "has_rule": true, ... }
```

**Priorité** : ÉLEVÉE (valide BR-07 ORDER BY created_at DESC).

---

### TC-COMMISSION-06 — Calcul `total_percent_fee`

**Description** : vérifier l'addition exacte.

**DB_STATE** :
```
payer_percent_fee   = 3.50
receiver_percent_fee= 7.25
```

**EXPECTED_PYTHON** : `"total_percent_fee": 10.75`  
**JAVA_MUST_MATCH** : `10.75` (pas d'arrondi).  
**Priorité** : ÉLEVÉE (valide BR-06).

---

### TC-COMMISSION-07 — Champs absents de la réponse

**Description** : vérifier que `rule_id`, `name`, `currency`, `description`, `active`, `priority`, `created_at`, `updated_at` ne sont PAS dans la réponse.

**Assertion** : réponse JSON contient exactement 6 champs : `payer_percent_fee`, `payer_fixed_fee`, `receiver_percent_fee`, `receiver_fixed_fee`, `total_percent_fee`, `has_rule`.  
**Priorité** : ÉLEVÉE (guard contre sur-sérialisation).

---

### TC-COMMISSION-08 — Règle inactive ignorée

**Description** : seule règle en DB est `active=FALSE`.

**EXPECTED_PYTHON** : `has_rule: false`, tous les fees à 0.  
**Priorité** : ÉLEVÉE (valide le filtre `WHERE active = TRUE`).

---

### TC-COMMISSION-09 — DB inaccessible

**Description** : mock `DataSource` qui lève une exception.

**EXPECTED_PYTHON** : HTTP 500.  
**JAVA_MUST_MATCH** : HTTP 500.  
**Priorité** : MOYENNE.

---

### TC-COMMISSION-10 — Compatibilité stricte Python : pas de champs supplémentaires

**Description** : test de contrat strict — la réponse Java ne doit contenir aucun champ hors contrat.

**Champs attendus** : exactement `{"payer_percent_fee", "payer_fixed_fee", "receiver_percent_fee", "receiver_fixed_fee", "total_percent_fee", "has_rule"}`.

**Assertion** : `responseBody.keySet().size() == 6`.  
**Priorité** : CRITIQUE (compatibilité frontend).

---

## Matrice de couverture

| Test Case | Cas nominal | Fallback | Priorité DB | Absence données | Erreur DB | Contrat strict |
|---|---|---|---|---|---|---|
| TC-BOOKING-01 | ✓ | | | | | |
| TC-BOOKING-02 | ✓ | | | | | |
| TC-BOOKING-03 | | ✓ | | | | |
| TC-BOOKING-04 | | ✓ | | ✓ | | |
| TC-BOOKING-05 | | | | | | ✓ |
| TC-BOOKING-06 | | | | | ✓ | |
| TC-BOOKING-07 | | | | | | ✓ |
| TC-COMMISSION-01 | ✓ | | | | | |
| TC-COMMISSION-02 | | ✓ | | ✓ | | |
| TC-COMMISSION-03 | | ✓ | | ✓ | | |
| TC-COMMISSION-04 | | | ✓ | | | |
| TC-COMMISSION-05 | | | ✓ | | | |
| TC-COMMISSION-06 | ✓ | | | | | |
| TC-COMMISSION-07 | | | | | | ✓ |
| TC-COMMISSION-08 | | ✓ | | | | |
| TC-COMMISSION-09 | | | | | ✓ | |
| TC-COMMISSION-10 | | | | | | ✓ |
