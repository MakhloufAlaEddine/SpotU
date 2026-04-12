# SLICE_01_CURSOR_IMPLEMENTATION_NOTES.md — Consignes d'implémentation pour Cursor
> Basé sur `server.py:183–237` + données DB live + règles métier Slice 01.  
> Généré le 2026-04-12.  
> **Copier-coller directement dans Cursor comme consigne de tâche.**

---

## Objectif

Remplacer les stubs Java existants pour `GET /api/config/booking` et `GET /api/config/commission` par une implémentation réelle lisant la base de données Supabase PostgreSQL.

---

## Fichiers à créer

### 1. `BookingConfigResponse.java` (DTO)

**Package** : `[votre.package].dto.config`

```java
public record BookingConfigResponse(
    boolean enableManualApprovalForServices,
    boolean enablePayLaterForServices,
    int payNowCheckoutMinutes
) {}
```

**Sérialisation JSON** (Jackson) — noms de champs Python attendus :
```java
@JsonProperty("enable_manual_approval_for_services")
@JsonProperty("enable_pay_later_for_services")
@JsonProperty("pay_now_checkout_minutes")
```

**Alternative** : configurer `spring.jackson.property-naming-strategy=SNAKE_CASE` globalement.

---

### 2. `CommissionConfigResponse.java` (DTO)

**Package** : `[votre.package].dto.config`

```java
public record CommissionConfigResponse(
    double payerPercentFee,
    double payerFixedFee,
    double receiverPercentFee,
    double receiverFixedFee,
    double totalPercentFee,
    boolean hasRule
) {}
```

**Sérialisation JSON** attendue (noms Python exacts) :
```
payer_percent_fee
payer_fixed_fee
receiver_percent_fee
receiver_fixed_fee
total_percent_fee
has_rule
```

---

### 3. `ConfigRepository.java` (Repository)

**Package** : `[votre.package].repository`  
**Technologie** : Spring JDBC (`JdbcTemplate` ou `NamedParameterJdbcTemplate`)  
**NE PAS utiliser JPA/Hibernate** pour ces 2 requêtes (tables sans entité JPA complexe).

```java
@Repository
public class ConfigRepository {

    private final JdbcTemplate jdbc;

    public ConfigRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Lit les 3 clés de config booking depuis app_config.
     * Retourne une Map vide si aucune clé n'est trouvée.
     */
    public Map<String, String> fetchBookingConfig() {
        String sql = """
            SELECT config_key, config_value
            FROM app_config
            WHERE config_key IN (
                'enable_manual_approval_for_services',
                'enable_pay_later_for_services',
                'pay_now_checkout_minutes'
            )
        """;
        return jdbc.query(sql, rs -> {
            Map<String, String> map = new HashMap<>();
            while (rs.next()) {
                map.put(rs.getString("config_key"), rs.getString("config_value"));
            }
            return map;
        });
    }

    /**
     * Lit la règle de commission active la plus prioritaire.
     * Retourne Optional.empty() si aucune règle active.
     */
    public Optional<CommissionRow> fetchActiveCommissionRule() {
        String sql = """
            SELECT payer_fixed_fee, payer_percent_fee,
                   receiver_fixed_fee, receiver_percent_fee
            FROM pricing_rules
            WHERE product_type = 'service_booking' AND active = TRUE
            ORDER BY priority DESC, created_at DESC
            LIMIT 1
        """;
        List<CommissionRow> rows = jdbc.query(sql, (rs, rowNum) -> new CommissionRow(
            rs.getDouble("payer_fixed_fee"),
            rs.getDouble("payer_percent_fee"),
            rs.getDouble("receiver_fixed_fee"),
            rs.getDouble("receiver_percent_fee")
        ));
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public record CommissionRow(
        double payerFixedFee,
        double payerPercentFee,
        double receiverFixedFee,
        double receiverPercentFee
    ) {}
}
```

---

### 4. `ConfigService.java` (Service)

**Package** : `[votre.package].service`

```java
@Service
public class ConfigService {

    private final ConfigRepository configRepository;

    public ConfigService(ConfigRepository configRepository) {
        this.configRepository = configRepository;
    }

    public BookingConfigResponse getBookingConfig() {
        Map<String, String> cfg = configRepository.fetchBookingConfig();

        boolean manualApproval = "true".equals(cfg.getOrDefault("enable_manual_approval_for_services", "false"));
        boolean payLater       = "true".equals(cfg.getOrDefault("enable_pay_later_for_services", "false"));
        int checkoutMinutes    = Integer.parseInt(cfg.getOrDefault("pay_now_checkout_minutes", "30"));

        return new BookingConfigResponse(manualApproval, payLater, checkoutMinutes);
    }

    public CommissionConfigResponse getCommissionConfig() {
        return configRepository.fetchActiveCommissionRule()
            .map(row -> {
                double totalPct = row.payerPercentFee() + row.receiverPercentFee();
                return new CommissionConfigResponse(
                    row.payerPercentFee(),
                    row.payerFixedFee(),
                    row.receiverPercentFee(),
                    row.receiverFixedFee(),
                    totalPct,
                    true
                );
            })
            .orElse(new CommissionConfigResponse(0.0, 0.0, 0.0, 0.0, 0.0, false));
    }
}
```

---

### 5. `ConfigController.java` — Modifier les stubs existants

**Package** : `[votre.package].controller`  
**REMPLACER** les méthodes stub existantes (ne pas créer un nouveau contrôleur si ConfigController existe déjà).

```java
@RestController
@RequestMapping("/api/config")
public class ConfigController {

    private final ConfigService configService;

    public ConfigController(ConfigService configService) {
        this.configService = configService;
    }

    @GetMapping("/booking")
    public ResponseEntity<BookingConfigResponse> getBookingConfig() {
        return ResponseEntity.ok(configService.getBookingConfig());
    }

    @GetMapping("/commission")
    public ResponseEntity<CommissionConfigResponse> getCommissionConfig() {
        return ResponseEntity.ok(configService.getCommissionConfig());
    }
}
```

---

### 6. `ConfigRepositoryTest.java` (tests d'intégration)

**Package** : `[votre.package].repository`  
**Technologie** : `@JdbcTest` + `@Sql` pour fixtures

```java
@JdbcTest
@AutoConfigureTestDatabase(replace = Replace.NONE)  // Supabase réel ou Testcontainers
class ConfigRepositoryTest {

    @Autowired JdbcTemplate jdbc;
    ConfigRepository repo;

    @BeforeEach void setUp() { repo = new ConfigRepository(jdbc); }

    @Test
    @Sql("/fixtures/app_config_nominal.sql")
    void fetchBookingConfig_nominal() {
        Map<String, String> cfg = repo.fetchBookingConfig();
        assertThat(cfg).containsEntry("pay_now_checkout_minutes", "5");
    }

    @Test
    @Sql("/fixtures/app_config_empty.sql")
    void fetchBookingConfig_empty_returns_empty_map() {
        assertThat(repo.fetchBookingConfig()).isEmpty();
    }

    @Test
    @Sql("/fixtures/pricing_rules_active.sql")
    void fetchActiveCommissionRule_present() {
        assertThat(repo.fetchActiveCommissionRule()).isPresent();
    }

    @Test
    @Sql("/fixtures/pricing_rules_all_inactive.sql")
    void fetchActiveCommissionRule_absent_returns_empty() {
        assertThat(repo.fetchActiveCommissionRule()).isEmpty();
    }
}
```

---

## Choses à NE PAS faire

| # | Interdit | Raison |
|---|---|---|
| X-01 | `@Cacheable` sur `getBookingConfig()` ou `getCommissionConfig()` | Python ne cache pas. Admin peut modifier les valeurs en live. |
| X-02 | Retourner HTTP 404 si aucune règle active | Python retourne 200 + `has_rule: false`. |
| X-03 | Retourner `currency` dans la réponse commission | Non retourné par Python — rupture de contrat frontend. |
| X-04 | Utiliser `"TRUE".equalsIgnoreCase(...)` pour les booléens | Python est case-sensitive : `== "true"`. Utiliser `"true".equals(...)` strict. |
| X-05 | Faire 3 requêtes séparées pour les 3 clés `app_config` | Python utilise `IN (...)` — 1 seule requête. |
| X-06 | `Math.round()` sur `total_percent_fee` | Python ne fait pas d'arrondi — addition brute. |
| X-07 | Retourner d'autres champs de `pricing_rules` (name, rule_id, etc.) | Non retournés par Python. |
| X-08 | Lever une exception si `pay_now_checkout_minutes` absent | Python retourne `30` silencieusement. |
| X-09 | `product_type` dynamique (query param, config) | Valeur figée `'service_booking'` dans le code Python. |
| X-10 | Sécuriser avec `@PreAuthorize` | Ces endpoints sont publics — aucune auth. |

---

## Validations à respecter

| # | Validation | Source |
|---|---|---|
| V-01 | `enable_*` = `false` si clé absente (pas `null`, pas d'exception) | BR-02, BR-04 |
| V-02 | `pay_now_checkout_minutes` = `30` si clé absente | BR-03 |
| V-03 | `has_rule = false` si aucune règle active pour `service_booking` | BR-08 |
| V-04 | `total_percent_fee` = `payer_percent_fee + receiver_percent_fee` | BR-06 |
| V-05 | `LIMIT 1` et `ORDER BY priority DESC, created_at DESC` | BR-07 |
| V-06 | 6 champs exactement dans la réponse commission | Contrat API |
| V-07 | 3 champs exactement dans la réponse booking | Contrat API |

---

## Critères de fin de tâche

La Slice 01 est terminée quand :

- [ ] `GET /api/config/booking` retourne les valeurs dynamiques de la DB (pas un stub)
- [ ] `GET /api/config/booking` retourne les fallbacks corrects si une clé est absente
- [ ] `GET /api/config/commission` retourne la règle active avec les 6 champs corrects
- [ ] `GET /api/config/commission` retourne `has_rule=false` + tous les frais à 0 si aucune règle active
- [ ] Les noms de champs JSON correspondent exactement au contrat Python (snake_case)
- [ ] Aucun champ supplémentaire n'est retourné (currency, updated_at, etc.)
- [ ] Les 17 cas de tests définis dans `SLICE_01_TEST_CASES.md` passent
- [ ] Le serveur Java répond à `GET /api/config/booking` avec exactement :
  ```json
  {"enable_manual_approval_for_services":false,"enable_pay_later_for_services":false,"pay_now_checkout_minutes":5}
  ```
- [ ] Le serveur Java répond à `GET /api/config/commission` avec exactement :
  ```json
  {"payer_percent_fee":5.0,"payer_fixed_fee":0.0,"receiver_percent_fee":10.0,"receiver_fixed_fee":0.0,"total_percent_fee":15.0,"has_rule":true}
  ```
