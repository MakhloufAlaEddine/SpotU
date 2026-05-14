package com.spotu.modules.subscriptions.service;

import com.spotu.error.ApiBadRequestException;
import com.spotu.error.ApiConflictException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.subscriptions.infra.SubscriptionJdbcRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * CRUD plans d'abonnement admin (slice 22), aligné sur {@code admin_routes.py:208–283}.
 */
@Service
public class AdminPlanService {

    private static final Set<String> ALLOWED_UPDATE_FIELDS = Set.of(
            "name", "description", "price", "duration_days",
            "exempt_payer_fixed", "exempt_payer_percent",
            "exempt_receiver_fixed", "exempt_receiver_percent",
            "active", "priority"
    );

    private final SubscriptionJdbcRepository repository;

    public AdminPlanService(SubscriptionJdbcRepository repository) {
        this.repository = repository;
    }

    public List<Map<String, Object>> listAllPlansAdmin() {
        return repository.findAllPlansForAdmin();
    }

    /**
     * Équivalent Python {@code new_id("plan")} : {@code plan_} + 12 hex.
     */
    public static String newPlanId() {
        return "plan_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    public Map<String, Object> createPlan(Map<String, Object> body) {
        Object nameObj = body == null ? null : body.get("name");
        if (nameObj == null || nameObj.toString().isBlank()) {
            throw new ApiBadRequestException("name is required");
        }
        String name = nameObj.toString();
        String description = body.get("description") == null ? null : body.get("description").toString();
        BigDecimal price = BigDecimal.valueOf(toDouble(body.get("price"), 0.0));
        Integer durationDays = body.get("duration_days") == null ? null : toInt(body.get("duration_days"));
        boolean epx = toBool(body.get("exempt_payer_fixed"), false);
        boolean epp = toBool(body.get("exempt_payer_percent"), false);
        boolean erx = toBool(body.get("exempt_receiver_fixed"), false);
        boolean erp = toBool(body.get("exempt_receiver_percent"), false);
        boolean active = toBool(body.get("active"), true);
        int priority = body.get("priority") == null ? 0 : toInt(body.get("priority"));

        String planId = newPlanId();
        repository.insertPlan(planId, name, description, price, durationDays, epx, epp, erx, erp, active, priority);
        return repository.findPlanAdminById(planId)
                .orElseThrow(() -> new IllegalStateException("Plan créé introuvable: " + planId));
    }

    public Map<String, Object> updatePlan(String planId, Map<String, Object> body) {
        if (body == null || body.isEmpty()) {
            throw new ApiBadRequestException("No valid fields to update");
        }
        Map<String, Object> fields = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : body.entrySet()) {
            if (ALLOWED_UPDATE_FIELDS.contains(e.getKey())) {
                fields.put(e.getKey(), e.getValue());
            }
        }
        if (fields.isEmpty()) {
            throw new ApiBadRequestException("No valid fields to update");
        }
        int n = repository.updatePlanDynamic(planId, fields);
        if (n == 0) {
            throw new ApiNotFoundException("Plan not found");
        }
        return Map.of("success", true);
    }

    public Map<String, Object> deletePlan(String planId) {
        try {
            repository.deletePlanById(planId);
        } catch (DataIntegrityViolationException e) {
            throw new ApiConflictException(
                    "Ce plan est utilisé par des abonnements existants et ne peut pas être supprimé."
            );
        }
        return Map.of("success", true);
    }

    private static double toDouble(Object v, double def) {
        if (v == null) {
            return def;
        }
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        return Double.parseDouble(v.toString());
    }

    private static int toInt(Object v) {
        if (v instanceof Number n) {
            return n.intValue();
        }
        return Integer.parseInt(v.toString());
    }

    private static boolean toBool(Object v, boolean def) {
        if (v == null) {
            return def;
        }
        if (v instanceof Boolean b) {
            return b;
        }
        return Boolean.parseBoolean(v.toString());
    }
}
