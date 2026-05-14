package com.spotu.modules.payments.api;

import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.payments.dto.CheckoutSessionRequestDto;
import com.spotu.modules.payments.service.CheckoutService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/payments/checkout")
public class CheckoutController {

    private final AuthMeService authMeService;
    private final CheckoutService checkoutService;

    public CheckoutController(AuthMeService authMeService, CheckoutService checkoutService) {
        this.authMeService = authMeService;
        this.checkoutService = checkoutService;
    }

    @PostMapping("/session")
    public ResponseEntity<Map<String, Object>> createSession(
            @RequestBody(required = false) CheckoutSessionRequestDto body,
            HttpServletRequest request
    ) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String bookingId = body == null ? null : body.bookingId();
        String originUrl = body == null ? "" : body.originUrl();
        return ResponseEntity.ok(checkoutService.createCheckoutSession(bookingId, originUrl, user.userId()));
    }

    @GetMapping("/status/{sessionId}")
    public ResponseEntity<Map<String, Object>> getStatus(@PathVariable String sessionId) {
        return ResponseEntity.ok(checkoutService.getCheckoutStatus(sessionId));
    }
}
