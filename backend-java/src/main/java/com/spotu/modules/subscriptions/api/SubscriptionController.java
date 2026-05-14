package com.spotu.modules.subscriptions.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.subscriptions.dto.SubscribeRequest;
import com.spotu.modules.subscriptions.service.SubscriptionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Endpoints utilisateur abonnements (slice 21), alignés sur {@code subscription_routes.py}.
 */
@RestController
@RequestMapping("/api")
public class SubscriptionController {

    private final SubscriptionService subscriptionService;
    private final AuthMeService authMeService;
    private final ObjectMapper objectMapper;

    public SubscriptionController(
            SubscriptionService subscriptionService,
            AuthMeService authMeService,
            ObjectMapper objectMapper
    ) {
        this.subscriptionService = subscriptionService;
        this.authMeService = authMeService;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/subscription-plans")
    public List<Map<String, Object>> listPlans() {
        return subscriptionService.listActivePlans();
    }

    @PostMapping(value = "/subscriptions/subscribe", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> subscribe(@RequestBody SubscribeRequest body, HttpServletRequest request) {
        var user = authMeService.requireCurrentUser(request);
        String origin = body == null || body.originUrl() == null ? "" : body.originUrl();
        String planId = body == null ? null : body.planId();
        return subscriptionService.subscribe(user, planId, origin);
    }

    @GetMapping("/subscriptions/checkout/status/{sessionId}")
    public Map<String, Object> checkoutStatus(@PathVariable String sessionId, HttpServletRequest request) {
        var user = authMeService.requireCurrentUser(request);
        return subscriptionService.getCheckoutStatus(user, sessionId);
    }

    @GetMapping("/subscriptions/me")
    public Map<String, Object> mySubscription(HttpServletRequest request) {
        var user = authMeService.requireCurrentUser(request);
        return subscriptionService.getMySubscription(user.userId());
    }

    @GetMapping("/subscriptions/history")
    public List<Map<String, Object>> history(HttpServletRequest request) {
        var user = authMeService.requireCurrentUser(request);
        return subscriptionService.getHistory(user.userId());
    }

    /**
     * Body JSON optionnel ; en cas de JSON invalide, équivalent Python {@code body = {}}.
     */
    @PostMapping("/subscriptions/cancel")
    public Map<String, Object> cancel(HttpServletRequest request) throws IOException {
        var user = authMeService.requireCurrentUser(request);
        boolean immediate = parseCancelImmediate(request);
        return subscriptionService.cancel(user, immediate);
    }

    private boolean parseCancelImmediate(HttpServletRequest request) throws IOException {
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
            // aligné sur subscription_routes.py:340-343
        }
        return false;
    }
}
