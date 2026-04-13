# SLICE_22_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation Cursor
> Basé sur `admin_routes.py:208–283`, `subscription_routes.py:453–511`.
> Généré le 2026-04-13.

---

## Objectif

Créer le `AdminSubscriptionController` Java (6 endpoints) qui couvre le CRUD plans
et la gestion admin des abonnements. Après S22, le domaine subscription est **intégralement documenté**
(S19 Stripe réseau → S20 webhooks → S21 user endpoints → S22 admin).

---

## 1. Architecture Java cible

```
src/main/java/com/spotu/
├── controller/
│   ├── SubscriptionController.java              ← S21 (existant)
│   └── AdminSubscriptionController.java         ← 🔴 S22 (6 endpoints)
├── service/
│   ├── SubscriptionService.java                 ← S21 (existant — réutilisé pour admin cancel)
│   ├── SubscriptionPlanService.java             ← 🔴 S22 (CRUD plans)
│   └── StripeSubscriptionService.java           ← S21 (existant — cancel)
├── repository/
│   ├── SubscriptionPlanRepository.java          ← S21 (existant — à étendre)
│   └── UserSubscriptionRepository.java          ← S20 (existant — à étendre)
├── dto/
│   ├── CreatePlanRequest.java                   ← 🔴 S22
│   └── UpdatePlanRequest.java                   ← 🔴 S22
```

---

## 2. Controller — `AdminSubscriptionController`

```java
@Slf4j
@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
public class AdminSubscriptionController {

    private final SubscriptionPlanService planService;
    private final SubscriptionService subscriptionService;
    private final AuthService authService;

    // ── 1. GET /admin/subscription-plans ─────────────────────────────────

    @GetMapping("/subscription-plans")
    public List<Map<String, Object>> listAllPlans(HttpServletRequest request) {
        authService.requireRole(request, "admin");
        return planService.listAll();
    }

    // ── 2. POST /admin/subscription-plans ────────────────────────────────

    @PostMapping("/subscription-plans")
    public Map<String, Object> createPlan(@RequestBody CreatePlanRequest body,
                                           HttpServletRequest request) {
        authService.requireRole(request, "admin");
        return planService.create(body);
    }

    // ── 3. PUT /admin/subscription-plans/{planId} ────────────────────────

    @PutMapping("/subscription-plans/{planId}")
    public Map<String, Object> updatePlan(@PathVariable String planId,
                                           @RequestBody Map<String, Object> body,
                                           HttpServletRequest request) {
        authService.requireRole(request, "admin");
        return planService.update(planId, body);
    }

    // ── 4. DELETE /admin/subscription-plans/{planId} ─────────────────────

    @DeleteMapping("/subscription-plans/{planId}")
    public Map<String, Object> deletePlan(@PathVariable String planId,
                                           HttpServletRequest request) {
        authService.requireRole(request, "admin");
        return planService.delete(planId);
    }

    // ── 5. GET /admin/subscriptions ──────────────────────────────────────

    @GetMapping("/subscriptions")
    public List<Map<String, Object>> listSubscriptions(HttpServletRequest request) {
        authService.requireRole(request, "admin");
        return subscriptionService.adminListAll();
    }

    // ── 6. POST /admin/subscriptions/{subscriptionId}/cancel ─────────────

    @PostMapping("/subscriptions/{subscriptionId}/cancel")
    public Map<String, Object> adminCancelSubscription(
            @PathVariable String subscriptionId,
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request) {
        authService.requireRole(request, "admin");
        boolean immediate = body != null && Boolean.TRUE.equals(body.get("immediate"));
        return subscriptionService.adminCancel(subscriptionId, immediate);
    }
}
```

---

## 3. Service — `SubscriptionPlanService`

```java
@Slf4j
@Service
@RequiredArgsConstructor
public class SubscriptionPlanService {

    private final SubscriptionPlanRepository planRepo;
    private final IdGenerator idGenerator;

    // ── List all ────────────────────────────────────────────────────────

    public List<Map<String, Object>> listAll() {
        // SELECT * FROM subscription_plans ORDER BY priority DESC, created_at
        return planRepo.findAllOrderedAdmin();
    }

    // ── Create ──────────────────────────────────────────────────────────

    public Map<String, Object> create(CreatePlanRequest body) {
        if (body.getName() == null || body.getName().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "name is required");
        }

        SubscriptionPlan plan = new SubscriptionPlan();
        plan.setPlanId(idGenerator.generate("plan"));
        plan.setName(body.getName());
        plan.setDescription(body.getDescription());
        plan.setPrice(body.getPrice() != null ? body.getPrice() : BigDecimal.ZERO);
        plan.setDurationDays(body.getDurationDays());
        plan.setExemptPayerFixed(Boolean.TRUE.equals(body.getExemptPayerFixed()));
        plan.setExemptPayerPercent(Boolean.TRUE.equals(body.getExemptPayerPercent()));
        plan.setExemptReceiverFixed(Boolean.TRUE.equals(body.getExemptReceiverFixed()));
        plan.setExemptReceiverPercent(Boolean.TRUE.equals(body.getExemptReceiverPercent()));
        plan.setActive(body.getActive() != null ? body.getActive() : true);
        plan.setPriority(body.getPriority() != null ? body.getPriority() : 0);
        // stripe_product_id et stripe_price_id restent NULL

        planRepo.save(plan);
        return planToMap(plan);  // RETURNING * equivalent
    }

    // ── Update (dynamique) ──────────────────────────────────────────────

    private static final Set<String> ALLOWED_FIELDS = Set.of(
        "name", "description", "price", "duration_days",
        "exempt_payer_fixed", "exempt_payer_percent",
        "exempt_receiver_fixed", "exempt_receiver_percent",
        "active", "priority"
    );

    public Map<String, Object> update(String planId, Map<String, Object> body) {
        // Filtrer les champs autorisés
        Map<String, Object> fields = new LinkedHashMap<>();
        for (var entry : body.entrySet()) {
            if (ALLOWED_FIELDS.contains(entry.getKey())) {
                fields.put(entry.getKey(), entry.getValue());
            }
        }
        if (fields.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No valid fields to update");
        }

        int rowsUpdated = planRepo.dynamicUpdate(planId, fields);
        if (rowsUpdated == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Plan not found");
        }
        return Map.of("success", true);
    }

    // ── Delete ──────────────────────────────────────────────────────────

    public Map<String, Object> delete(String planId) {
        try {
            planRepo.deleteById(planId);
        } catch (DataIntegrityViolationException e) {
            // FK constraint : des abonnements référencent ce plan
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "Ce plan est utilisé par des abonnements existants et ne peut pas être supprimé.");
        }
        // Retourne success: true MÊME si le plan n'existait pas (compat Python)
        return Map.of("success", true);
    }
}
```

---

## 4. Repository additions

### `SubscriptionPlanRepository` (extensions)

```java
// Liste admin (tous plans, SELECT *)
@Query(value = "SELECT * FROM subscription_plans ORDER BY priority DESC, created_at",
       nativeQuery = true)
List<Map<String, Object>> findAllOrderedAdmin();

// Update dynamique — requête native avec StringBuilder
// OU utiliser EntityManager directement :
default int dynamicUpdate(String planId, Map<String, Object> fields) {
    // Construire "UPDATE subscription_plans SET name=$2, price=$3, updated_at=NOW() WHERE plan_id=$1"
    // Utiliser EntityManager.createNativeQuery() ou JdbcTemplate
    ...
}
```

**Option JdbcTemplate (recommandée pour l'UPDATE dynamique)** :

```java
@Repository
@RequiredArgsConstructor
public class SubscriptionPlanCustomRepository {

    private final JdbcTemplate jdbcTemplate;

    public int dynamicUpdate(String planId, Map<String, Object> fields) {
        StringBuilder sql = new StringBuilder("UPDATE subscription_plans SET ");
        List<Object> params = new ArrayList<>();
        params.add(planId);  // $1

        int i = 2;
        for (var entry : fields.entrySet()) {
            if (i > 2) sql.append(", ");
            sql.append(entry.getKey()).append(" = $").append(i++);
            params.add(entry.getValue());
        }
        sql.append(", updated_at = NOW() WHERE plan_id = $1");

        return jdbcTemplate.update(sql.toString(), params.toArray());
    }
}
```

### `UserSubscriptionRepository` (extensions)

```java
// Admin list all (avec JOIN users + plans) — LIMIT 500
@Query(value = """
    SELECT us.*,
           u.name AS user_name, u.email,
           sp.name AS plan_name, sp.price AS plan_price
    FROM user_subscriptions us
    LEFT JOIN users u              ON u.user_id   = us.user_id
    LEFT JOIN subscription_plans sp ON sp.plan_id = us.plan_id
    ORDER BY us.created_at DESC
    LIMIT 500
    """, nativeQuery = true)
List<Map<String, Object>> findAllForAdmin();

// Admin cancel : find by subscription_id (tous statuts)
// Déjà couvert par JpaRepository.findById()
```

---

## 5. Pièges critiques

### P1 — UPDATE dynamique : SQL injection théorique

```
Le code Python construit le SQL dynamiquement avec les NOMS de champs du body.
Le set `allowed` protège contre l'injection (seuls les noms connus sont acceptés).

EN JAVA : Reproduire le même filtre avec ALLOWED_FIELDS.
NE PAS passer les noms de champs non filtrés dans une requête native.
Alternatives sûres : JdbcTemplate avec NamedParameterJdbcTemplate,
ou CriteriaBuilder, ou @DynamicUpdate JPA.
```

### P2 — DELETE sans guard FK

```
Python ne catch pas ForeignKeyViolationError → HTTP 500.
Java : catcher DataIntegrityViolationException → HTTP 409 avec message clair.
C'est une AMÉLIORATION par rapport au Python, pas une régression.
```

### P3 — PUT ne met PAS à jour Stripe

```
Changer price via PUT ne recrée PAS le Stripe Price.
Le cache stripe_price_id en DB devient incohérent.
Ce comportement est VOULU (ou au minimum documenté) dans le code Python.
Ne PAS ajouter de sync Stripe automatique.
Documenter ce comportement dans les notes admin.
```

### P4 — DELETE retourne success:true même si plan inexistant

```
Python : DELETE 0 rows → {"success": true}
Java JpaRepository.deleteById() lève EmptyResultDataAccessException si inexistant.
Options :
a) deleteById + catch → return success (compat Python)
b) Utiliser deleteByPlanId + check rowCount → return success always (compat Python)
c) Vérifier existence + 404 (AMÉLIORATION — mais incompatible Python)

Recommandation : option (b) pour compatibilité stricte.
```

### P5 — Duplication GET plans → N'en implémenter qu'UN

```
Le même chemin /api/admin/subscription-plans est défini dans 2 fichiers Python.
En Java : UN SEUL endpoint dans AdminSubscriptionController.
Comportement : SELECT * + ORDER BY priority DESC, created_at (version admin_routes.py).
```

### P6 — Admin cancel : pas de guard status

```
L'admin peut "annuler" un abonnement déjà cancelled.
Le Stripe cancel sera appelé sur un sub déjà cancelled → peut échouer → log.error.
La DB mettra à jour cancelled_at à NOW() même si déjà cancelled.
Ce n'est PAS une erreur — c'est le comportement Python.
```

---

## 6. Critères de done

| # | Critère | Tests |
|---|---|---|
| D1 | `GET /admin/subscription-plans` retourne tous les plans (actifs + inactifs) + stripe_* | TC-APL-01 |
| D2 | `POST /admin/subscription-plans` crée un plan avec les défauts corrects | TC-CRT-01, 02, 06 |
| D3 | 400 si name absent | TC-CRT-03 |
| D4 | `PUT` update dynamique (champs partiels) | TC-UPD-01, 08 |
| D5 | PUT : champs inconnus ignorés silencieusement | TC-UPD-03 |
| D6 | PUT : 400 si aucun champ valide, 404 si plan absent | TC-UPD-04, 05 |
| D7 | PUT : stripe_* non modifiables | TC-UPD-07 |
| D8 | `DELETE` retourne success:true même si plan absent | TC-DEL-02 |
| D9 | DELETE + FK constraint → 409 (amélioration Java) | TC-DEL-03 |
| D10 | `GET /admin/subscriptions` LEFT JOIN + LIMIT 500 | TC-ASL-01, 02, 03, 04 |
| D11 | benefits_snapshot désérialisé dans la réponse | TC-ASL-01 |
| D12 | `POST cancel` : Stripe AVANT DB | TC-ACA-01 |
| D13 | Admin cancel : pas de guard status (re-cancel OK) | TC-ACA-04 |
| D14 | Admin cancel : skip Stripe si stripe_subscription_id NULL | TC-ACA-05 |
| D15 | Tous les endpoints : 403 si non admin | TC-*-403 |
| D16 | Réponse admin cancel : {success, status} (PAS de message) | TC-ACA-01 |

---

## 7. Bilan du domaine Subscription (S19 → S22)

| Slice | Composant | Statut |
|---|---|---|
| S19 | StripePaymentService (capture/cancel/refund) | ✅ Documenté |
| S20 | SubscriptionWebhookHandler (6 event types) | ✅ Documenté |
| S21 | SubscriptionController (6 user endpoints) | ✅ Documenté |
| **S22** | **AdminSubscriptionController (6 admin endpoints)** | **✅ Documenté** |

**Domaine subscription : 100% couvert.** Aucun endpoint ou handler subscription restant à documenter.
