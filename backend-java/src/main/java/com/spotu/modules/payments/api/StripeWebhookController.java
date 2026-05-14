package com.spotu.modules.payments.api;

import com.spotu.modules.payments.service.StripeWebhookService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class StripeWebhookController {

    private final StripeWebhookService stripeWebhookService;

    public StripeWebhookController(StripeWebhookService stripeWebhookService) {
        this.stripeWebhookService = stripeWebhookService;
    }

    @PostMapping(value = "/webhook/stripe", consumes = MediaType.ALL_VALUE)
    public ResponseEntity<Map<String, Object>> stripeWebhook(
            @RequestBody(required = false) byte[] rawBody,
            HttpServletRequest request
    ) {
        byte[] body = rawBody == null ? new byte[0] : rawBody;
        String signature = request.getHeader("Stripe-Signature");
        return ResponseEntity.ok(stripeWebhookService.process(body, signature));
    }
}
