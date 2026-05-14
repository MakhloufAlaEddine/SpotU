package com.spotu.modules.subscriptions.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.subscriptions.service.AdminPlanService;
import com.spotu.modules.subscriptions.service.SubscriptionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Admin abonnements / plans (slice 22).
 * Un seul {@code GET /api/admin/subscription-plans} canonique (évite la duplication FastAPI
 * {@code admin_routes.py} vs {@code subscription_routes.py}).
 */
@RestController
@RequestMapping("/api/admin")
public class AdminSubscriptionController {

    private final AuthMeService authMeService;
    private final AdminPlanService adminPlanService;
    private final SubscriptionService subscriptionService;
    private final ObjectMapper objectMapper;

    public AdminSubscriptionController(
            AuthMeService authMeService,
            AdminPlanService adminPlanService,
            SubscriptionService subscriptionService,
            ObjectMapper objectMapper
    ) {
        this.authMeService = authMeService;
        this.adminPlanService = adminPlanService;
        this.subscriptionService = subscriptionService;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/subscription-plans")
    public List<Map<String, Object>> listPlans(HttpServletRequest request) {
        authMeService.requireAdmin(request);
        return adminPlanService.listAllPlansAdmin();
    }

    @PostMapping(value = "/subscription-plans", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> createPlan(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        authMeService.requireAdmin(request);
        return adminPlanService.createPlan(body);
    }

    @PutMapping(value = "/subscription-plans/{planId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> updatePlan(
            @PathVariable String planId,
            @RequestBody Map<String, Object> body,
            HttpServletRequest request
    ) {
        authMeService.requireAdmin(request);
        return adminPlanService.updatePlan(planId, body);
    }

    @DeleteMapping("/subscription-plans/{planId}")
    public Map<String, Object> deletePlan(@PathVariable String planId, HttpServletRequest request) {
        authMeService.requireAdmin(request);
        return adminPlanService.deletePlan(planId);
    }

    @GetMapping("/subscriptions")
    public List<Map<String, Object>> listSubscriptions(HttpServletRequest request) {
        authMeService.requireAdmin(request);
        return subscriptionService.listSubscriptionsForAdmin();
    }

    @PostMapping("/subscriptions/{subscriptionId}/cancel")
    public Map<String, Object> adminCancel(
            @PathVariable String subscriptionId,
            HttpServletRequest request
    ) throws IOException {
        authMeService.requireAdmin(request);
        boolean immediate = parseAdminCancelImmediate(request);
        return subscriptionService.adminCancelSubscription(subscriptionId, immediate);
    }

    private boolean parseAdminCancelImmediate(HttpServletRequest request) throws IOException {
        byte[] buf = request.getInputStream().readAllBytes();
        if (buf.length == 0) {
            return false;
        }
        try {
            JsonNode n = objectMapper.readTree(buf);
            if (n != null && n.has("immediate") && n.get("immediate").isBoolean()) {
                return n.get("immediate").booleanValue();
            }
        } catch (Exception ignored) {
            // aligné sur subscription_routes.py:477-481
        }
        return false;
    }
}
